// Proyectos: un objetivo con tareas (dependencias, responsable, prioridad, plazo y un criterio de
// "listo" verificable), su carpeta en la computadora y el historial de cambios. El progreso sale de las
// tareas completadas, no de porcentajes inventados. Cuando una tarea queda lista para arrancar (sus
// dependencias terminadas) y tiene responsable, Gravity se la pasa a ese compañero.

import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { COMPUTADORA, DATOS, ahora, buscarBot, nuevoId, programarEscritura } from "./almacen.ts";
import { emitir } from "./eventos.ts";

export const ESTADOS_TAREA = ["pendiente", "planificando", "en_curso", "verificando", "esperando_aprobacion", "pausada", "reintentando", "completada", "fallida", "cancelada"] as const;
export type EstadoTarea = (typeof ESTADOS_TAREA)[number];
const CERRADAS: EstadoTarea[] = ["completada", "fallida", "cancelada"];

export interface TareaProyecto {
  id: string;
  titulo: string;
  detalle: string;
  criterio: string;
  estado: EstadoTarea;
  asignadoA: string | null;
  dependeDe: string[];
  prioridad: 1 | 2 | 3;
  vence: string | null;
  resultado: string | null;
  avisada: boolean;
  creada: string;
  actualizada: string;
}

export interface Proyecto {
  id: string;
  nombre: string;
  objetivo: string;
  estado: "activo" | "pausado" | "terminado" | "archivado";
  coordinadorId: string | null;
  // Etiquetas libres para agrupar y filtrar (ej.: «cliente X», «marketing»).
  etiquetas?: string[];
  carpeta: string;
  tareas: TareaProyecto[];
  // quien: "usuario", "gravity" o el id de un compañero.
  historial: { fecha: string; quien: string; que: string }[];
  creado: string;
  actualizado: string;
}

const ARCHIVO = path.join(DATOS, "proyectos.json");
const MAX_PROYECTOS = 200;
const MAX_TAREAS = 300;
const MAX_HISTORIAL = 300;

let proyectos: Proyecto[] = [];
try {
  proyectos = JSON.parse(readFileSync(ARCHIVO, "utf8")) as Proyecto[];
} catch {
  // Sin proyectos todavía.
}

const guardar = () => programarEscritura(ARCHIVO, () => proyectos);

export const listarProyectos = (): Proyecto[] => proyectos;
export const buscarProyecto = (id: string): Proyecto | undefined => proyectos.find((p) => p.id === id || p.nombre.toLowerCase() === id.trim().toLowerCase());

function slug(texto: string): string {
  return (
    texto
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "proyecto"
  );
}

function anotar(p: Proyecto, quien: string, que: string): void {
  p.historial.push({ fecha: ahora(), quien, que });
  if (p.historial.length > MAX_HISTORIAL) p.historial.splice(0, p.historial.length - MAX_HISTORIAL);
  p.actualizado = ahora();
}

const nombreDe = (quien: string) => (quien === "usuario" ? "Vos" : quien === "gravity" ? "Gravity" : (buscarBot(quien)?.nombre ?? quien));

/** Progreso real: tareas completadas sobre las que siguen en juego (las canceladas no cuentan). */
export function progreso(p: Proyecto): { hechas: number; total: number; porcentaje: number; bloqueadas: number; vencidas: number } {
  const vivas = p.tareas.filter((t) => t.estado !== "cancelada");
  const hechas = vivas.filter((t) => t.estado === "completada").length;
  const ahoraMs = Date.now();
  return {
    hechas,
    total: vivas.length,
    porcentaje: vivas.length ? Math.round((hechas / vivas.length) * 100) : 0,
    bloqueadas: vivas.filter((t) => !CERRADAS.includes(t.estado) && !lista(p, t)).length,
    vencidas: vivas.filter((t) => t.vence && !CERRADAS.includes(t.estado) && Date.parse(t.vence) < ahoraMs).length,
  };
}

/** Una tarea está lista para arrancar cuando todas sus dependencias están completadas. */
function lista(p: Proyecto, t: TareaProyecto): boolean {
  return t.dependeDe.every((d) => p.tareas.find((x) => x.id === d)?.estado === "completada");
}

export interface DatosProyecto {
  nombre: string;
  objetivo: string;
  coordinadorId?: string | null;
}

export function crearProyecto(d: DatosProyecto, quien = "usuario"): Proyecto {
  if (proyectos.length >= MAX_PROYECTOS) throw new Error(`Podés tener hasta ${MAX_PROYECTOS} proyectos: archivá o borrá alguno.`);
  const nombre = d.nombre.trim().slice(0, 120);
  if (!nombre) throw new Error("El proyecto necesita un nombre.");
  if (proyectos.some((p) => p.nombre.toLowerCase() === nombre.toLowerCase())) throw new Error(`Ya hay un proyecto «${nombre}».`);
  if (d.coordinadorId && !buscarBot(d.coordinadorId)) throw new Error("No existe ese compañero.");
  const id = nuevoId();
  const p: Proyecto = {
    id,
    nombre,
    objetivo: d.objetivo.trim().slice(0, 4000),
    estado: "activo",
    coordinadorId: d.coordinadorId ?? null,
    carpeta: `proyectos/${slug(nombre)}-${id.slice(0, 4)}/`,
    tareas: [],
    historial: [],
    creado: ahora(),
    actualizado: ahora(),
  };
  mkdirSync(path.join(COMPUTADORA, p.carpeta), { recursive: true });
  anotar(p, quien, "Proyecto creado.");
  proyectos.push(p);
  guardar();
  emitir("proyectos", { id });
  return p;
}

export function cambiarProyecto(id: string, d: Partial<Pick<Proyecto, "nombre" | "objetivo" | "estado" | "coordinadorId" | "etiquetas">>, quien = "usuario"): Proyecto {
  const p = buscarProyecto(id);
  if (!p) throw new Error("No existe ese proyecto.");
  if (d.coordinadorId && !buscarBot(d.coordinadorId)) throw new Error("No existe ese compañero.");
  const cambios: string[] = [];
  if (d.nombre !== undefined && d.nombre.trim() && d.nombre.trim() !== p.nombre) {
    p.nombre = d.nombre.trim().slice(0, 120);
    cambios.push("nombre");
  }
  if (d.objetivo !== undefined && d.objetivo !== p.objetivo) {
    p.objetivo = d.objetivo.slice(0, 4000);
    cambios.push("objetivo");
  }
  if (d.estado && d.estado !== p.estado) {
    p.estado = d.estado;
    cambios.push(`estado: ${d.estado}`);
  }
  if (d.etiquetas) {
    const nuevas = [...new Set(d.etiquetas.map((e) => e.trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 10);
    if (nuevas.join(",") !== (p.etiquetas ?? []).join(",")) {
      p.etiquetas = nuevas;
      cambios.push(`etiquetas: ${nuevas.join(", ") || "ninguna"}`);
    }
  }
  if (d.coordinadorId !== undefined && d.coordinadorId !== p.coordinadorId) {
    p.coordinadorId = d.coordinadorId;
    cambios.push(`coordinación: ${d.coordinadorId ? nombreDe(d.coordinadorId) : "nadie"}`);
  }
  if (cambios.length) anotar(p, quien, `Cambios: ${cambios.join(", ")}.`);
  guardar();
  emitir("proyectos", { id: p.id });
  if (p.estado === "activo") void despachar(p);
  return p;
}

export function borrarProyecto(id: string): boolean {
  const i = proyectos.findIndex((p) => p.id === id);
  if (i < 0) return false;
  // La carpeta de la computadora no se borra: puede tener entregables.
  proyectos.splice(i, 1);
  guardar();
  emitir("proyectos", { id });
  return true;
}

export interface DatosTarea {
  titulo: string;
  detalle?: string;
  criterio?: string;
  asignadoA?: string | null;
  dependeDe?: string[];
  prioridad?: 1 | 2 | 3;
  vence?: string | null;
}

function validarDependencias(p: Proyecto, tareaId: string | null, deps: string[]): string[] {
  const limpias = [...new Set(deps.map((d) => d.trim()).filter(Boolean))];
  for (const d of limpias) {
    if (d === tareaId) throw new Error("Una tarea no puede depender de sí misma.");
    if (!p.tareas.some((t) => t.id === d)) throw new Error(`No existe la tarea ${d} en este proyecto.`);
  }
  // Sin ciclos: desde las dependencias no se puede volver a esta tarea.
  if (tareaId) {
    const visitar = [...limpias];
    const vistas = new Set<string>();
    while (visitar.length) {
      const actual = visitar.pop()!;
      if (actual === tareaId) throw new Error("Esas dependencias forman un ciclo.");
      if (vistas.has(actual)) continue;
      vistas.add(actual);
      visitar.push(...(p.tareas.find((t) => t.id === actual)?.dependeDe ?? []));
    }
  }
  return limpias;
}

function fechaValida(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new Error("La fecha límite no es válida (usá AAAA-MM-DD).");
  return new Date(t).toISOString();
}

export function agregarTarea(id: string, d: DatosTarea, quien = "usuario"): TareaProyecto {
  const p = buscarProyecto(id);
  if (!p) throw new Error("No existe ese proyecto.");
  if (p.tareas.length >= MAX_TAREAS) throw new Error(`Un proyecto puede tener hasta ${MAX_TAREAS} tareas.`);
  const titulo = d.titulo.trim().slice(0, 200);
  if (!titulo) throw new Error("La tarea necesita un título.");
  if (d.asignadoA && !buscarBot(d.asignadoA)) throw new Error("No existe ese compañero.");
  const t: TareaProyecto = {
    id: `t${nuevoId().slice(0, 6)}`,
    titulo,
    detalle: (d.detalle ?? "").slice(0, 6000),
    criterio: (d.criterio ?? "").slice(0, 1000),
    estado: "pendiente",
    asignadoA: d.asignadoA ?? null,
    dependeDe: validarDependencias(p, null, d.dependeDe ?? []),
    prioridad: d.prioridad ?? 2,
    vence: fechaValida(d.vence),
    resultado: null,
    avisada: false,
    creada: ahora(),
    actualizada: ahora(),
  };
  p.tareas.push(t);
  anotar(p, quien, `Tarea agregada: «${t.titulo}»${t.asignadoA ? ` (responsable: ${nombreDe(t.asignadoA)})` : ""}.`);
  guardar();
  emitir("proyectos", { id: p.id });
  void despachar(p);
  return t;
}

export interface CambiosTarea extends Partial<DatosTarea> {
  estado?: EstadoTarea;
  resultado?: string | null;
}

export function cambiarTarea(id: string, tareaId: string, d: CambiosTarea, quien = "usuario"): TareaProyecto {
  const p = buscarProyecto(id);
  if (!p) throw new Error("No existe ese proyecto.");
  const t = p.tareas.find((x) => x.id === tareaId);
  if (!t) throw new Error("No existe esa tarea en el proyecto.");
  if (d.asignadoA && !buscarBot(d.asignadoA)) throw new Error("No existe ese compañero.");
  // Un compañero no puede dar por completada una tarea sin decir qué entregó.
  if (d.estado === "completada" && quien !== "usuario" && !(d.resultado ?? t.resultado)?.trim()) {
    throw new Error("Para completar una tarea contá el resultado: qué hiciste, dónde quedó y cómo se verifica el criterio.");
  }
  if (d.estado === "en_curso" && !lista(p, t)) throw new Error("Esa tarea depende de otras que todavía no están completadas.");
  // Revisión cruzada: si la completa un compañero que no es el coordinador, queda «verificando» y el
  // coordinador la revisa antes de cerrarla (las que dependen de ella esperan la revisión).
  const coord = p.coordinadorId && p.coordinadorId !== quien && quien !== "usuario" && quien !== "gravity" ? buscarBot(p.coordinadorId) : undefined;
  const revisar = d.estado === "completada" && !!coord && !coord.archivado;
  if (revisar) d = { ...d, estado: "verificando" };
  const cambios: string[] = [];
  if (d.titulo?.trim()) t.titulo = d.titulo.trim().slice(0, 200);
  if (d.detalle !== undefined) t.detalle = d.detalle.slice(0, 6000);
  if (d.criterio !== undefined) t.criterio = d.criterio.slice(0, 1000);
  if (d.prioridad) t.prioridad = d.prioridad;
  if (d.vence !== undefined) t.vence = fechaValida(d.vence);
  if (d.dependeDe) t.dependeDe = validarDependencias(p, t.id, d.dependeDe);
  if (d.asignadoA !== undefined && d.asignadoA !== t.asignadoA) {
    t.asignadoA = d.asignadoA;
    t.avisada = false;
    cambios.push(`responsable: ${d.asignadoA ? nombreDe(d.asignadoA) : "nadie"}`);
  }
  if (d.resultado !== undefined && d.resultado !== t.resultado) {
    t.resultado = d.resultado ? d.resultado.slice(0, 6000) : null;
    cambios.push("resultado anotado");
  }
  if (d.estado && d.estado !== t.estado) {
    cambios.push(`estado: ${d.estado.replace("_", " ")}`);
    t.estado = d.estado;
    if (d.estado === "pendiente" || d.estado === "reintentando") t.avisada = false;
  }
  t.actualizada = ahora();
  if (cambios.length) anotar(p, quien, `«${t.titulo}»: ${cambios.join(", ")}.`);
  if (p.tareas.every((x) => CERRADAS.includes(x.estado)) && p.tareas.some((x) => x.estado === "completada") && p.estado === "activo") {
    anotar(p, "gravity", "Todas las tareas quedaron cerradas.");
  }
  guardar();
  emitir("proyectos", { id: p.id });
  void despachar(p);
  if (revisar) void pedirRevision(p, t, coord!.id, quien);
  return t;
}

async function pedirRevision(p: Proyecto, t: TareaProyecto, revisorId: string, autorId: string): Promise<void> {
  const { enviarMensaje } = await import("./agente.ts");
  enviarMensaje(
    revisorId,
    [
      `[Proyecto «${p.nombre}» · revisión de la tarea ${t.id}] ${nombreDe(autorId)} dio por terminada «${t.titulo}».`,
      t.criterio && `Listo cuando: ${t.criterio}`,
      `Resultado que entregó: ${t.resultado ?? "(sin resultado)"}`,
      `Revisala siguiendo la habilidad «Revisión cruzada» (leé los archivos, verificá el criterio). Si está bien, marcala "completada" con la herramienta \`proyectos\` (proyecto ${p.id}, tarea ${t.id}) con tu dictamen en el resultado. Si falta algo, marcala "reintentando" y escribí en el resultado exactamente qué corregir: se la vuelvo a pasar a ${nombreDe(autorId)}.`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  anotar(p, "gravity", `«${t.titulo}» pasó a revisión de ${nombreDe(revisorId)}.`);
  guardar();
  emitir("proyectos", { id: p.id });
}

export function borrarTarea(id: string, tareaId: string): boolean {
  const p = buscarProyecto(id);
  if (!p) return false;
  const i = p.tareas.findIndex((t) => t.id === tareaId);
  if (i < 0) return false;
  const [t] = p.tareas.splice(i, 1);
  for (const x of p.tareas) x.dependeDe = x.dependeDe.filter((d) => d !== tareaId);
  anotar(p, "usuario", `Tarea borrada: «${t!.titulo}».`);
  guardar();
  emitir("proyectos", { id: p.id });
  return true;
}

/** Pasa a cada responsable las tareas que quedaron listas para arrancar (una sola vez por tarea). */
async function despachar(p: Proyecto): Promise<void> {
  if (p.estado !== "activo") return;
  const listas = p.tareas.filter((t) => (t.estado === "pendiente" || t.estado === "reintentando") && t.asignadoA && !t.avisada && lista(p, t) && buscarBot(t.asignadoA));
  if (!listas.length) return;
  // Se marcan antes de la espera: dos despachos seguidos (agregar dos tareas) no la mandan dos veces.
  for (const t of listas) t.avisada = true;
  // Import tardío: agente.ts usa estas herramientas, así se evita el ciclo al cargar.
  const { enviarMensaje } = await import("./agente.ts");
  for (const t of listas) {
    t.actualizada = ahora();
    const deps = t.dependeDe.map((d) => p.tareas.find((x) => x.id === d)).filter(Boolean) as TareaProyecto[];
    enviarMensaje(
      t.asignadoA!,
      [
        `[Proyecto «${p.nombre}» · tarea ${t.id}] ${t.estado === "reintentando" ? "Para corregir: " : ""}${t.titulo}`,
        t.estado === "reintentando" && t.resultado ? `Lo que marcó la revisión: ${t.resultado}` : "",
        t.detalle && `Detalle: ${t.detalle}`,
        t.criterio && `Listo cuando: ${t.criterio}`,
        t.vence && `Fecha límite: ${t.vence.slice(0, 10)}`,
        deps.length ? `Ya terminado antes:\n${deps.map((x) => `- ${x.titulo}: ${x.resultado ?? "(sin resultado anotado)"}`).join("\n")}` : "",
        `Trabajá en la carpeta ${p.carpeta} de la computadora. Al empezar marcala "en_curso" y al terminar "completada" con el resultado, usando la herramienta \`proyectos\` (proyecto ${p.id}, tarea ${t.id}). Si no podés, marcala "fallida" y explicá por qué.`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    anotar(p, "gravity", `«${t.titulo}» lista para arrancar: se la pasó a ${nombreDe(t.asignadoA!)}.`);
  }
  guardar();
  emitir("proyectos", { id: p.id });
}

/** Resumen para un compañero (herramienta). */
export function describirProyecto(p: Proyecto): string {
  const pr = progreso(p);
  const linea = (t: TareaProyecto) =>
    `- ${t.id} [${t.estado}] ${t.titulo}${t.asignadoA ? ` → ${nombreDe(t.asignadoA)}` : ""}${t.dependeDe.length ? ` (depende de ${t.dependeDe.join(", ")})` : ""}${t.vence ? ` · vence ${t.vence.slice(0, 10)}` : ""}`;
  return [
    `Proyecto «${p.nombre}» (${p.id}) · ${p.estado} · ${pr.hechas}/${pr.total} tareas completadas`,
    `Objetivo: ${p.objetivo || "(sin objetivo)"}`,
    `Carpeta: ${p.carpeta}`,
    p.coordinadorId ? `Coordina: ${nombreDe(p.coordinadorId)}` : "",
    "Tareas:",
    ...(p.tareas.length ? p.tareas.map(linea) : ["(todavía no hay tareas)"]),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Al borrar un compañero: sus tareas quedan sin responsable. */
export function quitarBotDeProyectos(botId: string): void {
  let cambio = false;
  for (const p of proyectos) {
    if (p.coordinadorId === botId) {
      p.coordinadorId = null;
      cambio = true;
    }
    for (const t of p.tareas) {
      if (t.asignadoA === botId) {
        t.asignadoA = null;
        t.avisada = false;
        cambio = true;
      }
    }
  }
  if (cambio) guardar();
}
