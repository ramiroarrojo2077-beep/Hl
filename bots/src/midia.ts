// Mi día: objetivos con hitos, el plan del día (lo propone el modelo con tus pendientes reales) y el
// resumen del día (sale de lo que pasó de verdad: tareas, acciones, aprobaciones, reuniones y gasto).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { DATOS, ahora, buscarBot, listarBots, listarReuniones, listarRutinas, listarTareas, nuevoId } from "./almacen.ts";
import { leerActividad } from "./actividad.ts";
import { gastoHoy } from "./gasto.ts";
import { listarProyectos } from "./proyectos.ts";

export interface Hito { id: string; texto: string; hecho: boolean; fecha: string | null }
export interface Objetivo { id: string; titulo: string; descripcion: string; fechaLimite: string | null; proyectoId: string | null; hitos: Hito[]; creado: string; cerrado: string | null }
export interface ItemPlan { hora: string; actividad: string; motivo: string; tipo: "tarea" | "reunion" | "objetivo" | "recordatorio" | "pausa" | "otro" }
interface Datos { objetivos: Objetivo[]; planes: Record<string, { creado: string; disponibilidad: string; items: ItemPlan[] }> }

const ARCHIVO = path.join(DATOS, "midia.json");
let datos: Datos = existsSync(ARCHIVO) ? (JSON.parse(readFileSync(ARCHIVO, "utf8")) as Datos) : { objetivos: [], planes: {} };
const guardar = () => writeFileSync(ARCHIVO, JSON.stringify(datos, null, 1));
export const hoy = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ---- Objetivos ----

export const progresoObjetivo = (o: Objetivo) => (o.hitos.length ? Math.round((o.hitos.filter((h) => h.hecho).length / o.hitos.length) * 100) : 0);
export const listarObjetivos = () => datos.objetivos;
export function crearObjetivo(d: { titulo: string; descripcion?: string; fechaLimite?: string | null; proyectoId?: string | null; hitos?: string[] }): Objetivo {
  if (!d.titulo.trim()) throw new Error("Falta el título.");
  if (d.proyectoId && !listarProyectos().some((p) => p.id === d.proyectoId)) throw new Error("No existe ese proyecto.");
  const o: Objetivo = { id: nuevoId(), titulo: d.titulo.trim().slice(0, 200), descripcion: (d.descripcion ?? "").slice(0, 2000), fechaLimite: d.fechaLimite || null, proyectoId: d.proyectoId ?? null, hitos: (d.hitos ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 30).map((texto) => ({ id: nuevoId(), texto: texto.slice(0, 200), hecho: false, fecha: null })), creado: ahora(), cerrado: null };
  datos.objetivos.push(o);
  guardar();
  return o;
}
export function cambiarObjetivo(id: string, d: { hito?: string; hecho?: boolean; agregarHito?: string; cerrar?: boolean; borrar?: boolean }): Objetivo | null {
  const o = datos.objetivos.find((x) => x.id === id);
  if (!o) throw new Error("No existe ese objetivo.");
  if (d.borrar) { datos.objetivos = datos.objetivos.filter((x) => x !== o); guardar(); return null; }
  if (d.hito) { const h = o.hitos.find((x) => x.id === d.hito); if (!h) throw new Error("No existe ese hito."); h.hecho = !!d.hecho; h.fecha = h.hecho ? ahora() : null; }
  if (d.agregarHito?.trim()) o.hitos.push({ id: nuevoId(), texto: d.agregarHito.trim().slice(0, 200), hecho: false, fecha: null });
  if (d.cerrar !== undefined) o.cerrado = d.cerrar ? ahora() : null;
  guardar();
  return o;
}

// ---- Pendientes reales (para planificar) ----

export function pendientes(fecha = hoy()) {
  const proyectos = listarProyectos().filter((p) => p.estado === "activo").flatMap((p) => p.tareas.filter((t) => t.estado === "pendiente" || t.estado === "en_curso").map((t) => ({ proyecto: p.nombre, titulo: t.titulo, prioridad: t.prioridad, vence: t.vence, responsable: t.asignadoA ? buscarBot(t.asignadoA)?.nombre ?? "?" : "vos" })));
  const recordatorios = listarRutinas().filter((r) => r.activa && r.horario.tipo === "una" && r.horario.fecha === fecha).map((r) => ({ hora: (r.horario as { hora: string }).hora, nombre: r.nombre, de: buscarBot(r.botId)?.nombre ?? "" }));
  const diarias = listarRutinas().filter((r) => r.activa && r.horario.tipo === "diaria").map((r) => ({ hora: (r.horario as { hora: string }).hora, nombre: r.nombre, de: buscarBot(r.botId)?.nombre ?? "" }));
  const reuniones = listarRutinas().filter((r) => r.activa && r.reunion && (r.horario.tipo === "diaria" || (r.horario.tipo === "una" && r.horario.fecha === fecha))).map((r) => ({ hora: (r.horario as { hora: string }).hora, titulo: r.nombre }));
  const objetivos = datos.objetivos.filter((o) => !o.cerrado).map((o) => ({ titulo: o.titulo, fechaLimite: o.fechaLimite, progreso: progresoObjetivo(o), proximoHito: o.hitos.find((h) => !h.hecho)?.texto ?? null }));
  return { proyectos, recordatorios, diarias, reuniones, objetivos };
}

// ---- Calendario del equipo: lo que viene en los próximos días (datos reales) ----

export async function calendario(dias = 14): Promise<{ fecha: string; hora: string; tipo: "rutina" | "reunion" | "recordatorio" | "vence" | "objetivo"; titulo: string; quien: string }[]> {
  const { proximaEjecucion } = await import("./rutinas.ts");
  const fin = Date.now() + dias * 86_400_000;
  const xs: { fecha: string; hora: string; tipo: "rutina" | "reunion" | "recordatorio" | "vence" | "objetivo"; titulo: string; quien: string }[] = [];
  const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  for (const r of listarRutinas().filter((x) => x.activa)) {
    let d = proximaEjecucion(r);
    for (let k = 0; k < 20 && d.getTime() <= fin; k++) {
      if (d.getTime() >= Date.now() - 3600_000) xs.push({ fecha: hoy(d), hora: hm(d), tipo: r.reunion ? "reunion" : r.horario.tipo === "una" ? "recordatorio" : "rutina", titulo: r.nombre, quien: buscarBot(r.botId)?.nombre ?? "" });
      if (r.horario.tipo === "una") break;
      const paso = r.horario.tipo === "intervalo" ? r.horario.minutos * 60_000 : r.horario.tipo === "diaria" ? 86_400_000 : 7 * 86_400_000;
      if (r.horario.tipo === "intervalo" && r.horario.minutos < 360) break; // las muy frecuentes se muestran una vez
      d = new Date(d.getTime() + paso);
    }
  }
  for (const p of listarProyectos().filter((x) => x.estado === "activo")) for (const t of p.tareas) if (t.vence && t.estado !== "completada" && Date.parse(t.vence) <= fin) xs.push({ fecha: t.vence.slice(0, 10), hora: "", tipo: "vence", titulo: `${t.titulo} (${p.nombre})`, quien: t.asignadoA ? buscarBot(t.asignadoA)?.nombre ?? "" : "vos" });
  for (const o of datos.objetivos) if (!o.cerrado && o.fechaLimite && Date.parse(o.fechaLimite) <= fin) xs.push({ fecha: o.fechaLimite, hora: "", tipo: "objetivo", titulo: o.titulo, quien: "vos" });
  return xs.sort((a, b) => `${a.fecha} ${a.hora || "99"}`.localeCompare(`${b.fecha} ${b.hora || "99"}`)).slice(0, 200);
}

// ---- Plan del día (el modelo ordena; los datos son los reales) ----

const Plan = z.object({ items: z.array(z.object({ hora: z.string().describe("HH:MM"), actividad: z.string(), motivo: z.string().describe("Por qué a esa hora o qué la justifica (prioridad, vencimiento, hito)"), tipo: z.enum(["tarea", "reunion", "objetivo", "recordatorio", "pausa", "otro"]) })).max(20) });

export async function planificar(disponibilidad: string, signal: AbortSignal): Promise<{ items: ItemPlan[] }> {
  const { client, MODELO, BETA_FALLBACK } = await import("./cliente.ts");
  const { llamar } = await import("./cupo.ts");
  const { registrarUso } = await import("./gasto.ts");
  const p = pendientes();
  const { $schema: _, ...schema } = z.toJSONSchema(Plan, { reused: "inline" });
  const mensaje = await llamar("midia", "usuario", signal, () =>
    client.beta.messages.create({
      model: MODELO, max_tokens: 3000, betas: [BETA_FALLBACK], fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema" as const, schema } },
      system: "Armás el plan del día del usuario con sus pendientes reales. Respetá su disponibilidad, poné primero lo urgente y lo que vence antes, agrupá tareas parecidas, dejá pausas cortas y no inventes compromisos que no están en los datos (podés sugerir avanzar un hito de un objetivo). Las tareas que hace un compañero no ocupan tiempo del usuario, salvo revisarlas. Respondé en el idioma del usuario.",
      messages: [{ role: "user", content: `Hoy es ${hoy()}. Disponibilidad: ${disponibilidad || "no la dijo (asumí 9 a 18 h)"}.\n\nPendientes (JSON):\n${JSON.stringify(p)}` }],
    }, { signal }),
  );
  registrarUso("midia", mensaje);
  const texto = mensaje.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("").trim();
  let plan: z.infer<typeof Plan>;
  try { plan = Plan.parse(JSON.parse(texto)); } catch { throw new Error("El plan vino incompleto. Probá de nuevo."); }
  plan.items.sort((a, b) => a.hora.localeCompare(b.hora));
  datos.planes[hoy()] = { creado: ahora(), disponibilidad, items: plan.items };
  for (const k of Object.keys(datos.planes).sort().slice(0, -14)) delete datos.planes[k];
  guardar();
  return plan;
}
export const planDe = (fecha = hoy()) => datos.planes[fecha] ?? null;

// ---- Resumen del día (datos reales, sin modelo) ----

export function resumenDelDia(fecha = hoy()) {
  const delDia = (iso: string | null | undefined) => !!iso && hoy(new Date(iso)) === fecha;
  const tareas = listarTareas().filter((t) => delDia(t.fin));
  const proyectos = listarProyectos().flatMap((p) => p.tareas.filter((t) => t.estado === "completada" && delDia(t.actualizada)).map((t) => `${t.titulo} (${p.nombre})`));
  const actividad = leerActividad({ limite: 500 }).filter((r) => delDia(r.fecha));
  const porBot = new Map<string, number>();
  for (const r of actividad) if (r.tipo === "herramienta") porBot.set(r.botId, (porBot.get(r.botId) ?? 0) + 1);
  const aprobaciones = actividad.filter((r) => r.tipo === "aprobacion");
  const reuniones = listarReuniones().filter((r) => delDia(r.creada ?? null));
  const objetivos = datos.objetivos.flatMap((o) => o.hitos.filter((h) => h.hecho && delDia(h.fecha)).map((h) => `${h.texto} (${o.titulo})`));
  return {
    fecha,
    completadas: tareas.filter((t) => t.estado === "completa").map((t) => `${t.titulo} — ${t.paraNombre}`),
    trabadas: tareas.filter((t) => t.estado === "bloqueada" || t.estado === "fallida" || t.estado === "vencida").map((t) => `${t.titulo} — ${t.paraNombre} (${t.estado})`),
    proyectos,
    hitos: objetivos,
    acciones: [...porBot].map(([id, n]) => ({ nombre: buscarBot(id)?.nombre ?? "alguien", n })).sort((a, b) => b.n - a.n),
    errores: actividad.filter((r) => r.tipo === "herramienta" && !r.ok).length,
    aprobadas: aprobaciones.filter((r) => r.ok).length,
    negadas: aprobaciones.filter((r) => !r.ok).length,
    reuniones: reuniones.map((r) => r.titulo),
    gasto: fecha === hoy() ? gastoHoy() : null,
    compañeros: listarBots().length,
    pendientes: pendientes(fecha).proyectos.length,
  };
}
