import { USUARIO, superaUmbral } from "./config.ts";
import { ahora, datos, guardar, nuevoId, type Aviso, type Propuesta } from "./almacen.ts";
import { emitir } from "./eventos.ts";
import { enviarEmail } from "./conectores/email.ts";
import { enviarWhatsapp } from "./conectores/whatsapp.ts";
import { notificar } from "./conectores/telegram.ts";

// Avisos que Jarvis te da por su cuenta y respuestas que prepara. Nada se envía sin tu aprobación:
// las respuestas quedan como propuestas hasta que tocás "Enviar" (en la interfaz, la API o Telegram).

export function estaActiva(): boolean {
  return datos.activa;
}

export function cambiarActiva(activa: boolean): void {
  datos.activa = activa;
  guardar();
  emitir("activa", { activa });
  emitir("estado", null);
}

export function crearPropuesta(p: Omit<Propuesta, "id" | "estado" | "fecha">): Propuesta {
  const propuesta: Propuesta = { ...p, id: nuevoId(), estado: "pendiente", fecha: ahora() };
  datos.propuestas.push(propuesta);
  guardar();
  emitir("propuesta", propuesta);
  return propuesta;
}

export function registrarAviso(
  aviso: Omit<Aviso, "id" | "fecha">,
  opciones: { propuesta?: Propuesta; forzarVoz?: boolean } = {},
): Aviso {
  const completo: Aviso = { ...aviso, id: nuevoId(), fecha: ahora(), propuestaId: opciones.propuesta?.id };
  datos.avisos.push(completo);
  guardar();
  // Con Jarvis desactivada, el aviso queda anotado pero no te interrumpe.
  const interrumpir = datos.activa && (opciones.forzarVoz || superaUmbral(completo.importancia));
  emitir("aviso", { aviso: completo, propuesta: opciones.propuesta, hablar: interrumpir });
  if (interrumpir) void notificar(completo.texto, opciones.propuesta);
  return completo;
}

function buscarPendiente(id: string): Propuesta {
  const propuesta = datos.propuestas.find((p) => p.id === id);
  if (!propuesta) throw new Error("No existe esa propuesta.");
  if (propuesta.estado !== "pendiente") throw new Error(`Esa propuesta ya fue ${propuesta.estado}.`);
  return propuesta;
}

export function editarPropuesta(id: string, cambios: { texto?: string; asunto?: string }): Propuesta {
  const propuesta = buscarPendiente(id);
  if (cambios.texto?.trim()) propuesta.texto = cambios.texto.trim();
  if (cambios.asunto?.trim()) propuesta.asunto = cambios.asunto.trim();
  guardar();
  emitir("propuesta", propuesta);
  return propuesta;
}

export async function enviarPropuesta(id: string, cambios: { texto?: string; asunto?: string } = {}): Promise<Propuesta> {
  const propuesta = editarPropuesta(id, cambios);
  try {
    if (propuesta.canal === "email") {
      await enviarEmail({
        cuenta: propuesta.cuenta,
        para: propuesta.para,
        asunto: propuesta.asunto ?? "",
        texto: propuesta.texto,
        enRespuestaA: propuesta.enRespuestaA,
      });
    } else {
      await enviarWhatsapp(propuesta.para, propuesta.texto);
    }
    propuesta.estado = "enviada";
    propuesta.error = undefined;
  } catch (err) {
    propuesta.estado = "error";
    propuesta.error = (err as Error).message;
  }
  guardar();
  emitir("propuesta", propuesta);
  if (propuesta.estado === "error") {
    // Queda pendiente de nuevo para poder reintentar.
    propuesta.estado = "pendiente";
    guardar();
    throw new Error(`No se pudo enviar: ${propuesta.error}`);
  }
  return propuesta;
}

export function descartarPropuesta(id: string): Propuesta {
  const propuesta = buscarPendiente(id);
  propuesta.estado = "descartada";
  guardar();
  emitir("propuesta", propuesta);
  return propuesta;
}

export function describirPropuesta(p: Propuesta): string {
  const canal = p.canal === "email" ? "mail" : "WhatsApp";
  return `Borrador de ${canal} para ${p.paraNombre} listo. Esperando que ${USUARIO} lo apruebe.`;
}
