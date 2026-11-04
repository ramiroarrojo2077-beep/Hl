// Automatizaciones condicionales: «si pasa X, que tal compañero haga Y». Escuchan los eventos del motor
// (tareas del equipo que quedan bloqueadas, fallan o se completan; tareas de proyectos que fallan;
// reuniones que terminan) y le mandan al compañero elegido la indicación con los datos del evento.
// Cada evento dispara una sola vez por regla, y hay un tope de 20 disparos por hora por regla.

import { readFileSync } from "node:fs";
import path from "node:path";
import { DATOS, ahora, buscarBot, nuevoId, programarEscritura } from "./almacen.ts";
import { bus } from "./eventos.ts";

export const EVENTOS = {
  tarea_bloqueada: "Una tarea del equipo queda bloqueada",
  tarea_fallida: "Una tarea del equipo falla",
  tarea_completa: "Una tarea del equipo se completa",
  reunion_terminada: "Una reunión termina",
} as const;
export type Evento = keyof typeof EVENTOS;

export interface Automatizacion {
  id: string;
  nombre: string;
  evento: Evento;
  botId: string;
  instrucciones: string;
  activa: boolean;
  creada: string;
  disparos: number;
  ultimo: string | null;
}

const ARCHIVO = path.join(DATOS, "automatizaciones.json");
const TOPE_HORA = 20;
let reglas: Automatizacion[] = [];
try {
  reglas = JSON.parse(readFileSync(ARCHIVO, "utf8")) as Automatizacion[];
} catch {
  // Todavía no hay.
}
const guardar = () => programarEscritura(ARCHIVO, () => reglas);
const vistos = new Set<string>();
const recientes = new Map<string, number[]>();

export const listarAutomatizaciones = () => reglas;

export function crearAutomatizacion(d: { nombre: string; evento: Evento; botId: string; instrucciones: string }): Automatizacion {
  if (!(d.evento in EVENTOS)) throw new Error("Evento desconocido.");
  if (!buscarBot(d.botId)) throw new Error("No existe ese compañero.");
  if (reglas.length >= 50) throw new Error("Podés tener hasta 50 automatizaciones.");
  const a: Automatizacion = { id: nuevoId(), nombre: d.nombre.trim().slice(0, 80), evento: d.evento, botId: d.botId, instrucciones: d.instrucciones.trim().slice(0, 4000), activa: true, creada: ahora(), disparos: 0, ultimo: null };
  reglas.push(a);
  guardar();
  return a;
}

export function cambiarAutomatizacion(id: string, activa: boolean): Automatizacion {
  const a = reglas.find((x) => x.id === id);
  if (!a) throw new Error("No existe esa automatización.");
  a.activa = activa;
  guardar();
  return a;
}

export function borrarAutomatizacion(id: string): boolean {
  const antes = reglas.length;
  reglas = reglas.filter((x) => x.id !== id);
  guardar();
  return reglas.length < antes;
}

/** Dispara las reglas de un evento. `clave` evita disparar dos veces por la misma cosa. */
export async function disparar(evento: Evento, clave: string, descripcion: string, origenBotId: string | null = null): Promise<number> {
  let n = 0;
  for (const a of reglas) {
    if (!a.activa || a.evento !== evento) continue;
    // Un compañero no se dispara a sí mismo por su propia tarea (evita bucles).
    if (origenBotId && origenBotId === a.botId && evento !== "reunion_terminada") continue;
    const k = `${a.id}:${clave}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    const bot = buscarBot(a.botId);
    if (!bot || bot.archivado) continue;
    const t = Date.now();
    const r = (recientes.get(a.id) ?? []).filter((x) => t - x < 3600_000);
    if (r.length >= TOPE_HORA) continue;
    r.push(t);
    recientes.set(a.id, r);
    a.disparos++;
    a.ultimo = ahora();
    const { enviarMensaje } = await import("./agente.ts");
    enviarMensaje(a.botId, `[Automatización «${a.nombre}»] ${EVENTOS[evento]}: ${descripcion}\n\nQué hacer: ${a.instrucciones}`);
    n++;
  }
  if (n) guardar();
  return n;
}

export function iniciarAutomatizaciones(): void {
  bus.on("evento", (tipo: string, d: Record<string, unknown>) => {
    if (tipo === "tarea" && d?.id) {
      const estado = String(d.estado ?? "");
      const ev: Evento | null = estado === "bloqueada" ? "tarea_bloqueada" : estado === "fallida" ? "tarea_fallida" : estado === "completa" ? "tarea_completa" : null;
      if (!ev) return;
      const desc = `«${String(d.titulo ?? "")}» de ${String(d.paraNombre ?? "un compañero")}${d.resultado ? `. Resultado: ${String(d.resultado).slice(0, 600)}` : ""}`;
      void disparar(ev, `tarea:${String(d.id)}:${estado}`, desc, String(d.paraId ?? "") || null);
    }
    if (tipo === "reunion" && d?.id && d.estado === "terminada") {
      const acta = d.acta as { resumen?: string } | null;
      void disparar("reunion_terminada", `reunion:${String(d.id)}`, `«${String(d.titulo ?? "")}». Acta: ${String(acta?.resumen ?? "(sin acta)").slice(0, 800)}`);
    }
  });
}
