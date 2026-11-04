// Gravity Architect: el usuario describe un objetivo y el modelo propone un equipo (manager y
// miembros, algunos temporales), qué herramientas tiene cada uno, rutinas, un proyecto con tareas y
// el flujo de trabajo. La propuesta se muestra para revisar: no se crea nada hasta que el usuario
// la aplica, y al aplicarla se usan las mismas funciones que la interfaz (equipo, permisos,
// rutinas y proyecto).

import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { crearRutina, guardarEstado, listarBots, MAX_BOTS, type Bot } from "./almacen.ts";
import { client, MODELO, BETA_FALLBACK } from "./cliente.ts";
import { llamar } from "./cupo.ts";
import { registrarUso } from "./gasto.ts";
import { crearEquipo } from "./equipo.ts";
import { GRUPOS_HERRAMIENTAS, normalizarBloqueadas } from "./herramientas.ts";
import { agregarTarea, crearProyecto, listarProyectos, type Proyecto } from "./proyectos.ts";
import { normalizarHorario } from "./rutinas.ts";
import { emitir } from "./eventos.ts";

const GRUPOS = Object.keys(GRUPOS_HERRAMIENTAS) as [string, ...string[]];
const Persona = z.object({
  nombre: z.string().describe("Nombre de pila corto"),
  titulo: z.string().describe("Puesto, por ejemplo «Investigadora de mercado»"),
  descripcion: z.string().describe("Qué hace, cómo trabaja y qué entrega, en 2 a 4 oraciones"),
  apagar: z.array(z.enum(GRUPOS)).describe("Grupos de herramientas que NO necesita (mínimo privilegio)"),
});
export const Propuesta = z.object({
  resumen: z.string().describe("La propuesta en 2 o 3 oraciones"),
  manager: Persona,
  miembros: z
    .array(Persona.extend({ temporal: z.boolean().describe("true si solo hace falta para esta misión") }))
    .describe("Entre 1 y 6 miembros"),
  rutinas: z
    .array(
      z.object({
        quien: z.string().describe("Nombre del compañero que la ejecuta"),
        nombre: z.string(),
        instrucciones: z.string().describe("Qué hacer en cada ejecución y qué entregar"),
        frecuencia: z.enum(["diaria", "semanal"]),
        hora: z.string().describe("HH:MM, 24 horas"),
        dia: z.number().int().describe("Solo semanal: 0 domingo … 6 sábado; si es diaria, 1"),
      }),
    )
    .describe("Como mucho 3 rutinas, solo si el objetivo es recurrente"),
  proyecto: z.object({
    nombre: z.string(),
    objetivo: z.string(),
    tareas: z
      .array(
        z.object({
          titulo: z.string(),
          detalle: z.string(),
          criterio: z.string().describe("Cómo se verifica que está terminada"),
          responsable: z.string().describe("Nombre del compañero"),
          depende_de: z.array(z.number().int()).describe("Números (desde 1) de tareas anteriores de esta lista"),
        }),
      )
      .describe("Entre 3 y 12 tareas en orden"),
  }),
  flujo: z.array(z.string()).describe("El flujo de trabajo en 3 a 7 pasos"),
  riesgos: z.array(z.string()).describe("Hasta 4 riesgos o cosas que el usuario tiene que decidir o conectar"),
});
export type Propuesta = z.infer<typeof Propuesta>;

function esquema(s: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...resto } = z.toJSONSchema(s, { reused: "inline" });
  return resto;
}

const SISTEMA = `Sos Gravity Architect. Diseñás equipos de compañeros de IA dentro de Gravity para cumplir el objetivo del usuario.
Cada compañero es un agente persistente con memoria, una computadora compartida (terminal y archivos), búsqueda web, y opcionalmente: mensajes de WhatsApp/Telegram/redes, apps conectadas (correo, Microsoft 365, MCP), delegar a su equipo, reuniones, rutinas programadas, proyectos y análisis de videos.
Grupos de herramientas que se pueden apagar: ${Object.entries(GRUPOS_HERRAMIENTAS).map(([id, g]) => `${id} (${g.nombre})`).join("; ")}.
Reglas:
- Equipo chico y concreto: un manager que coordina y de 1 a 6 miembros con puestos distintos. Nombres de pila en castellano.
- Mínimo privilegio: apagá a cada uno lo que no necesita. Solo quien tiene que hablar con terceros mantiene mensajes o conexiones (y todo envío igual pide aprobación).
- Marcá como temporal a quien solo hace falta para esta misión.
- Tareas verificables con responsable y dependencias reales. Rutinas solo si el objetivo es recurrente.
- No inventes datos del usuario ni prometas integraciones que no están: si hace falta conectar algo (correo, WhatsApp, una cuenta), ponelo en riesgos.
- Respondé en el idioma del usuario.`;

export async function proponer(objetivo: string, signal: AbortSignal): Promise<Propuesta> {
  const libres = MAX_BOTS - listarBots().length;
  if (libres < 2) throw new Error(`No hay lugar para un equipo nuevo: tenés ${listarBots().length} de ${MAX_BOTS} compañeros. Archivá o borrá alguno.`);
  const existentes = listarBots().map((b) => `${b.nombre} (${b.titulo})`).join(", ") || "ninguno";
  const mensaje = await llamar("arquitecto", "usuario", signal, () =>
    client.beta.messages.create(
      {
        model: MODELO,
        max_tokens: 16000,
        betas: [BETA_FALLBACK],
        fallbacks: "default",
        output_config: { effort: "medium", format: { type: "json_schema" as const, schema: esquema(Propuesta) } },
        system: SISTEMA,
        messages: [{ role: "user", content: `Objetivo: ${objetivo}\n\nCompañeros que ya existen (no los repitas): ${existentes}.\nLugares libres: ${libres} (el equipo nuevo no puede pasarse).` }],
      },
      { signal },
    ),
  );
  registrarUso("arquitecto", mensaje);
  if (mensaje.stop_reason === "refusal") throw new Error("El modelo no quiso responder.");
  const texto = mensaje.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  let p: Propuesta;
  try {
    p = Propuesta.parse(JSON.parse(texto));
  } catch {
    throw new Error("La propuesta vino incompleta. Probá de nuevo o describí el objetivo con más detalle.");
  }
  p.miembros = p.miembros.slice(0, Math.min(6, libres - 1));
  p.rutinas = p.rutinas.slice(0, 3);
  p.proyecto.tareas = p.proyecto.tareas.slice(0, 12);
  return p;
}

/** Crea lo propuesto (después de que el usuario la revisó, y quizás la editó). */
export function aplicar(p: Propuesta): { managerId: string; creados: number; proyecto: Proyecto } {
  const { manager, miembros } = crearEquipo({
    manager: { nombre: p.manager.nombre, titulo: p.manager.titulo, descripcion: p.manager.descripcion },
    miembros: p.miembros.map((m) => ({ nombre: m.nombre, titulo: m.titulo, descripcion: m.descripcion })),
    reportaA: null,
    carpetaLibre: true,
  });
  const todos: { bot: Bot; datos: Propuesta["manager"] & { temporal?: boolean } }[] = [
    { bot: manager, datos: p.manager },
    ...miembros.map((bot, i) => ({ bot, datos: p.miembros[i]! })),
  ];
  for (const { bot, datos } of todos) {
    bot.bloqueadas = normalizarBloqueadas(datos.apagar);
    if (datos.temporal) bot.temporal = { mision: p.proyecto.objetivo || p.resumen };
  }
  const porNombre = (n: string) => todos.find((x) => x.bot.nombre.toLowerCase() === n.trim().toLowerCase())?.bot;
  for (const r of p.rutinas) {
    const quien = porNombre(r.quien) ?? manager;
    try {
      crearRutina({
        botId: quien.id,
        nombre: r.nombre.slice(0, 80),
        instrucciones: r.instrucciones.slice(0, 8000),
        habilidadId: null,
        horario: normalizarHorario(r.frecuencia === "semanal" ? { tipo: "semanal", dia: r.dia, hora: r.hora } : { tipo: "diaria", hora: r.hora }),
        activa: true,
        reunion: null,
      });
    } catch (err) {
      console.warn("Arquitecto: rutina salteada:", (err as Error).message);
    }
  }
  guardarEstado();
  const proyecto = crearProyecto({ nombre: nombreLibre(p.proyecto.nombre), objetivo: p.proyecto.objetivo, coordinadorId: manager.id }, "gravity");
  const ids: string[] = [];
  for (const t of p.proyecto.tareas) {
    const deps = t.depende_de.map((n) => ids[n - 1]).filter((x): x is string => !!x);
    const creada = agregarTarea(proyecto.id, { titulo: t.titulo, detalle: t.detalle, criterio: t.criterio, asignadoA: (porNombre(t.responsable) ?? manager).id, dependeDe: deps }, "gravity");
    ids.push(creada.id);
  }
  emitir("bots");
  emitir("rutinas", {});
  return { managerId: manager.id, creados: todos.length, proyecto };
}

function nombreLibre(nombre: string): string {
  // crearProyecto no acepta nombres repetidos: se numera.
  const base = nombre.trim().slice(0, 110) || "Proyecto";
  const usados = new Set(listarProyectos().map((x) => x.nombre.toLowerCase()));
  let n = base;
  for (let i = 2; usados.has(n.toLowerCase()); i++) n = `${base} (${i})`;
  return n;
}
