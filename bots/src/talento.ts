// Inteligencia del equipo, calculada con datos reales:
// - Confianza: qué tan seguido un compañero termina bien lo que le encargan (tareas del equipo y de proyectos).
// - Carga: cuánto trabajo abierto tiene ahora.
// - Afinidad: cuánto se parece su puesto/descripción al encargo.
// Con eso se elige a quién delegar («auto»), quién reemplaza a alguien que falló (agentes de respaldo) y
// los mentores reciben el trabajo de sus aprendices para devolverles una enseñanza.

import { agregarNota, ajustes, buscarBot, directos, listarBots, listarTareas, TERMINALES, type Bot, type Tarea } from "./almacen.ts";
import { bus } from "./eventos.ts";
import { gastoBotHoy } from "./gasto.ts";
import { listarProyectos } from "./proyectos.ts";

export interface Confianza {
  puntaje: number; // 0 a 100
  nivel: "sin datos" | "baja" | "media" | "alta";
  completas: number;
  parciales: number;
  fallidas: number;
  total: number;
}

const abierta = (t: Tarea) => !TERMINALES.includes(t.estado);
const PESO: Partial<Record<Tarea["estado"], number>> = { completa: 1, parcial: 0.5, bloqueada: 0.25, fallida: 0, vencida: 0 };

/** Confianza de un compañero según sus resultados (con suavizado: con pocos datos queda cerca de 50). */
export function confianzaDe(botId: string): Confianza {
  let suma = 0;
  let total = 0;
  let completas = 0;
  let parciales = 0;
  let fallidas = 0;
  for (const t of listarTareas()) {
    if (t.paraId !== botId) continue;
    const p = PESO[t.estado];
    if (p === undefined) continue;
    suma += p;
    total++;
    if (t.estado === "completa") completas++;
    else if (t.estado === "parcial") parciales++;
    else if (t.estado === "fallida" || t.estado === "vencida") fallidas++;
  }
  for (const pr of listarProyectos()) {
    for (const t of pr.tareas) {
      if (t.asignadoA !== botId) continue;
      if (t.estado === "completada") { suma += 1; total++; completas++; }
      else if (t.estado === "fallida") { total++; fallidas++; }
    }
  }
  const puntaje = Math.round(((suma + 1) / (total + 2)) * 100);
  const nivel = total < 3 ? "sin datos" : puntaje >= 75 ? "alta" : puntaje >= 50 ? "media" : "baja";
  return { puntaje, nivel, completas, parciales, fallidas, total };
}

/** Trabajo abierto: tareas del equipo y de proyectos sin terminar. */
export function cargaDe(botId: string): number {
  const equipo = listarTareas().filter((t) => t.paraId === botId && abierta(t)).length;
  const proyectos = listarProyectos().reduce((n, p) => n + p.tareas.filter((t) => t.asignadoA === botId && (t.estado === "pendiente" || t.estado === "en_curso")).length, 0);
  return equipo + proyectos;
}

const PALABRAS_VACIAS = new Set("de la el los las un una y o a en con para por que del al se su sus es lo como más mas sin sobre".split(" "));
const palabras = (s: string) => new Set(s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9ñ]+/).filter((w) => w.length > 3 && !PALABRAS_VACIAS.has(w)).map((w) => w.slice(0, 6)));

/** Cuánto se parece lo que sabe hacer el compañero al encargo (0 a 1). */
export function afinidad(bot: Bot, texto: string): number {
  const perfil = palabras(`${bot.titulo} ${bot.descripcion}`);
  const pedido = palabras(texto);
  if (!perfil.size || !pedido.size) return 0;
  let comunes = 0;
  for (const w of pedido) if (perfil.has(w)) comunes++;
  return Math.min(1, comunes / Math.min(6, pedido.size));
}

export interface Eleccion { bot: Bot; razon: string; puntos: number }

/** Elige al mejor candidato para un encargo según afinidad, carga, confianza y disponibilidad. */
export function elegirMiembro(candidatos: Bot[], texto: string, excluir: Set<string> = new Set()): Eleccion | null {
  let mejor: Eleccion | null = null;
  for (const b of candidatos) {
    if (excluir.has(b.id) || b.archivado) continue;
    const af = afinidad(b, texto);
    const carga = cargaDe(b.id);
    const conf = confianzaDe(b.id);
    const sinPlata = b.topeDiarioUsd ? gastoBotHoy(b.id) >= b.topeDiarioUsd : false;
    const puntos = af * 3 + conf.puntaje / 50 - carga * 0.8 - (sinPlata ? 5 : 0);
    if (!mejor || puntos > mejor.puntos) {
      mejor = { bot: b, puntos, razon: `afinidad ${Math.round(af * 100)}%, ${carga} trabajo(s) abierto(s), confianza ${conf.nivel === "sin datos" ? "sin datos" : `${conf.puntaje}%`}${sinPlata ? ", llegó a su tope de gasto" : ""}` };
    }
  }
  return mejor;
}

// ---- Agentes de respaldo y mentores (escuchan los cierres de tareas) ----

const vistos = new Set<string>();

async function reemplazar(t: Tarea): Promise<void> {
  if (!ajustes().respaldoAutomatico || /\(respaldo\)$/.test(t.titulo)) return;
  const manager = buscarBot(t.deId);
  if (!manager) return;
  const eleccion = elegirMiembro(directos(manager.id), `${t.titulo} ${t.instrucciones}`, new Set([t.paraId]));
  if (!eleccion) return;
  const { crearTareas } = await import("./equipo.ts");
  try {
    const [nueva] = crearTareas(manager, t.trabajo, [{
      para: eleccion.bot.id,
      titulo: `${t.titulo} (respaldo)`.slice(0, 200),
      instrucciones: `${t.instrucciones}\n\n[Respaldo] ${t.paraNombre} no pudo terminarla (${t.estado}): ${t.resultado.slice(0, 1500)}\nLo que haya avanzado está en ${t.carpeta}. Retomá desde ahí.`,
      entregable: t.entregable,
    }], { presupuestoUsd: t.presupuestoUsd, padreId: t.padreId });
    agregarNota(manager.id, "aviso", `Respaldo automático: «${t.titulo}» de ${t.paraNombre} quedó ${t.estado}; se la pasé a ${eleccion.bot.nombre} (${eleccion.razon}). Tarea ${nueva?.id}.`);
  } catch (err) {
    console.warn("Respaldo:", (err as Error).message);
  }
}

async function pedirDevolucion(t: Tarea): Promise<void> {
  const aprendiz = buscarBot(t.paraId);
  const mentor = aprendiz?.mentorId ? buscarBot(aprendiz.mentorId) : undefined;
  if (!aprendiz || !mentor || mentor.archivado || mentor.id === aprendiz.id) return;
  if (mentor.topeDiarioUsd && gastoBotHoy(mentor.id) >= mentor.topeDiarioUsd) return;
  const { enviarMensaje } = await import("./agente.ts");
  enviarMensaje(mentor.id, [
    `[Mentoría] ${aprendiz.nombre} (${aprendiz.titulo}), tu aprendiz, terminó una tarea: «${t.titulo}» → ${t.estado}.`,
    `Instrucciones que tenía: ${t.instrucciones.slice(0, 1500)}`,
    `Su resultado: ${t.resultado.slice(0, 2500)}`,
    t.archivos.length ? `Archivos: ${t.archivos.join(", ")} (carpeta ${t.carpeta})` : `Carpeta: ${t.carpeta}`,
    "Revisalo (podés leer los archivos) y mandale con la herramienta `ensenar` una devolución breve: qué estuvo bien, qué mejorar y el procedimiento recomendado paso a paso. Si no hay nada que enseñar, no mandes nada.",
  ].join("\n"));
}

export function iniciarTalento(): void {
  bus.on("evento", (tipo: string, d: Record<string, unknown>) => {
    if (tipo !== "tarea" || !d?.id) return;
    const t = listarTareas().find((x) => x.id === d.id);
    if (!t || abierta(t)) return;
    const k = `${t.id}:${t.estado}`;
    if (vistos.has(k)) return;
    vistos.add(k);
    if (t.estado === "fallida" || t.estado === "vencida") void reemplazar(t);
    if (t.estado === "completa" || t.estado === "parcial" || t.estado === "bloqueada" || t.estado === "fallida") void pedirDevolucion(t);
  });
}

/** Aprendices de un mentor (para darle la herramienta `ensenar` solo a quien tiene alguno). */
export const aprendicesDe = (mentorId: string): Bot[] => listarBots().filter((b) => b.mentorId === mentorId);
