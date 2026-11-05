// Canales de conversación por equipo, por proyecto o libres, más #anuncios. El usuario y los compañeros
// escriben; mencionar a alguien con @Nombre le avisa (con los últimos mensajes como contexto) y contesta en
// el canal con la herramienta `canales`. #anuncios lo llena Gravity solo con lo importante (tareas
// terminadas o trabadas, reuniones cerradas, proyectos completos).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATOS, ahora, buscarBot, directos, listarBots, listarTareas, nuevoId, type Bot } from "./almacen.ts";
import { bus, emitir } from "./eventos.ts";
import { gastoBotHoy } from "./gasto.ts";
import { listarProyectos } from "./proyectos.ts";

export interface MensajeCanal { id: string; fecha: string; autor: string; nombre: string; texto: string; menciones: string[] }
export interface Canal { id: string; nombre: string; tipo: "anuncios" | "equipo" | "proyecto" | "libre"; refId: string | null; descripcion: string; creado: string; mensajes: MensajeCanal[] }

const ARCHIVO = path.join(DATOS, "canales.json");
const MAX_MENSAJES = 500;
const TOPE_AVISOS_HORA = 20;
let canales: Canal[] = existsSync(ARCHIVO) ? (JSON.parse(readFileSync(ARCHIVO, "utf8")) as Canal[]) : [];
let timer: NodeJS.Timeout | null = null;
const guardar = () => { timer ??= setTimeout(() => { timer = null; writeFileSync(ARCHIVO, JSON.stringify(canales)); }, 300); };
export const vaciarCanales = () => { if (timer) { clearTimeout(timer); timer = null; } writeFileSync(ARCHIVO, JSON.stringify(canales)); };

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "canal";

/** Crea los canales que faltan: #anuncios, uno por equipo (manager con gente) y uno por proyecto activo. */
export function asegurarCanales(): void {
  let cambio = false;
  const crear = (c: Omit<Canal, "id" | "creado" | "mensajes">) => { canales.push({ ...c, id: `c_${nuevoId()}`, creado: ahora(), mensajes: [] }); cambio = true; };
  if (!canales.some((c) => c.tipo === "anuncios")) crear({ nombre: "anuncios", tipo: "anuncios", refId: null, descripcion: "Lo importante de Gravity: tareas terminadas o trabadas, reuniones cerradas y proyectos completos." });
  for (const m of listarBots().filter((b) => b.cargo === "manager" && directos(b.id).length)) {
    if (!canales.some((c) => c.tipo === "equipo" && c.refId === m.id)) crear({ nombre: `equipo-${slug(m.nombre)}`, tipo: "equipo", refId: m.id, descripcion: `Equipo de ${m.nombre} (${m.titulo}).` });
  }
  for (const p of listarProyectos().filter((x) => x.estado === "activo")) {
    if (!canales.some((c) => c.tipo === "proyecto" && c.refId === p.id)) crear({ nombre: `proyecto-${slug(p.nombre)}`, tipo: "proyecto", refId: p.id, descripcion: p.objetivo.slice(0, 200) });
  }
  if (cambio) guardar();
}

export function listarCanales(): Canal[] {
  asegurarCanales();
  return canales;
}
export const buscarCanal = (id: string) => canales.find((c) => c.id === id || c.nombre === id.replace(/^#/, ""));

/** Quiénes forman parte de un canal (para avisar y para dejar publicar a los compañeros). */
export function miembros(c: Canal): Bot[] {
  if (c.tipo === "equipo" && c.refId) { const m = buscarBot(c.refId); return m ? [m, ...directos(m.id)] : []; }
  if (c.tipo === "proyecto" && c.refId) {
    const p = listarProyectos().find((x) => x.id === c.refId);
    const ids = new Set([p?.coordinadorId, ...(p?.tareas.map((t) => t.asignadoA) ?? [])].filter((x): x is string => !!x));
    return [...ids].map(buscarBot).filter((b): b is Bot => !!b && !b.archivado);
  }
  return listarBots();
}

export function crearCanal(nombre: string, descripcion = ""): Canal {
  const n = slug(nombre);
  if (canales.some((c) => c.nombre === n)) throw new Error(`Ya existe #${n}.`);
  const c: Canal = { id: `c_${nuevoId()}`, nombre: n, tipo: "libre", refId: null, descripcion: descripcion.slice(0, 300), creado: ahora(), mensajes: [] };
  canales.push(c);
  guardar();
  emitir("canal", { id: c.id });
  return c;
}
export function borrarCanal(id: string): void {
  const c = buscarCanal(id);
  if (!c) return;
  if (c.tipo !== "libre") throw new Error("Solo se borran los canales que creaste vos.");
  canales = canales.filter((x) => x !== c);
  guardar();
  emitir("canal", { id });
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** @Nombre (o @nombre-con-guiones) de compañeros que existen. */
export function menciones(texto: string): Bot[] {
  const bots = listarBots();
  const salida = new Map<string, Bot>();
  for (const m of texto.matchAll(/@([\p{L}\p{N}_.-]{2,40})/gu)) {
    const q = norm(m[1]!).replace(/[-_.]+$/, "");
    const b = bots.find((x) => norm(x.nombre) === q || norm(x.nombre).replace(/\s+/g, "-") === q || norm(x.nombre.split(" ")[0]!) === q);
    if (b) salida.set(b.id, b);
  }
  return [...salida.values()];
}

const avisosRecientes = new Map<string, number[]>();
const contexto = (c: Canal, n = 12) => c.mensajes.slice(-n).map((m) => `${m.nombre}: ${m.texto.slice(0, 600)}`).join("\n");

/** Publica un mensaje. autor: "usuario", "gravity" o el id de un compañero. Avisa a los mencionados. */
export async function publicar(canalId: string, autor: string, texto: string): Promise<MensajeCanal> {
  const c = buscarCanal(canalId);
  if (!c) throw new Error("No existe ese canal.");
  const limpio = texto.trim().slice(0, 8000);
  if (!limpio) throw new Error("El mensaje está vacío.");
  const bot = autor !== "usuario" && autor !== "gravity" ? buscarBot(autor) : undefined;
  if (autor !== "usuario" && autor !== "gravity") {
    if (!bot) throw new Error("No existe ese compañero.");
    if (c.tipo === "anuncios") throw new Error("En #anuncios publica solo Gravity y el usuario.");
    if (!miembros(c).some((b) => b.id === bot.id) && c.tipo !== "libre") throw new Error(`No formás parte de #${c.nombre}.`);
  }
  const ms = menciones(limpio).filter((b) => b.id !== autor && !b.archivado);
  const m: MensajeCanal = { id: nuevoId(), fecha: ahora(), autor, nombre: autor === "usuario" ? "Vos" : autor === "gravity" ? "Gravity" : bot!.nombre, texto: limpio, menciones: ms.map((b) => b.id) };
  c.mensajes.push(m);
  if (c.mensajes.length > MAX_MENSAJES) c.mensajes.splice(0, c.mensajes.length - MAX_MENSAJES);
  guardar();
  emitir("canal", { id: c.id, mensaje: m });
  // Avisos a los mencionados (con tope por canal: evita cadenas infinitas entre compañeros).
  const t = Date.now();
  const recientes = (avisosRecientes.get(c.id) ?? []).filter((x) => t - x < 3600_000);
  if (ms.length) {
    const { enviarMensaje } = await import("./agente.ts");
    for (const b of ms) {
      if (recientes.length >= TOPE_AVISOS_HORA) break;
      if (autor !== "usuario" && b.topeDiarioUsd && gastoBotHoy(b.id) >= b.topeDiarioUsd) continue;
      recientes.push(t);
      enviarMensaje(b.id, `[Canal #${c.nombre}] ${m.nombre} te mencionó: ${limpio}\n\nÚltimos mensajes del canal:\n${contexto(c)}\n\nRespondé en el canal con la herramienta canales (accion publicar, canal "${c.nombre}"). Si no hace falta responder, no publiques nada.`);
    }
    avisosRecientes.set(c.id, recientes);
  }
  return m;
}

/** Texto para resumir (lo usa la interfaz con el modelo). */
export const textoParaResumen = (c: Canal, n = 120) => c.mensajes.filter((m) => !m.texto.startsWith("Resumen del canal")).slice(-n).map((m) => `[${m.fecha.slice(0, 16).replace("T", " ")}] ${m.nombre}: ${m.texto}`).join("\n");

// ---- Anuncios automáticos ----

const anunciados = new Set<string>();
function anunciar(clave: string, texto: string): void {
  if (anunciados.has(clave)) return;
  anunciados.add(clave);
  const c = listarCanales().find((x) => x.tipo === "anuncios");
  if (c) void publicar(c.id, "gravity", texto).catch(() => {});
}

export function iniciarCanales(): void {
  bus.on("evento", (tipo: string, d: Record<string, unknown>) => {
    if (tipo === "tarea" && d?.id) {
      const t = listarTareas().find((x) => x.id === d.id);
      if (!t || t.padreId) return; // solo lo de primer nivel: las subtareas quedan en su equipo
      const de = buscarBot(t.deId)?.nombre ?? "su manager";
      if (t.estado === "completa") anunciar(`t:${t.id}:c`, `✅ ${t.paraNombre} completó «${t.titulo}» (encargo de ${de}).`);
      else if (t.estado === "fallida" || t.estado === "bloqueada") anunciar(`t:${t.id}:${t.estado}`, `⚠️ «${t.titulo}» de ${t.paraNombre} quedó ${t.estado}${t.resultado ? `: ${t.resultado.slice(0, 200)}` : ""}.`);
    }
    if (tipo === "reunion" && d?.id && d.estado === "terminada") {
      const acta = d.acta as { resumen?: string } | null;
      anunciar(`r:${String(d.id)}`, `📝 Terminó la reunión «${String(d.titulo ?? "")}». ${String(acta?.resumen ?? "").slice(0, 400)}`);
    }
    if (tipo === "proyectos") {
      for (const p of listarProyectos()) {
        if (p.tareas.length && p.tareas.every((t) => t.estado === "completada")) anunciar(`p:${p.id}:${p.tareas.length}`, `🎉 El proyecto «${p.nombre}» tiene todas sus tareas completas (${p.tareas.length}).`);
      }
    }
  });
}
