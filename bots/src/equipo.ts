import { mkdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import {
  COMPUTADORA,
  TERMINALES,
  agregarRegla,
  agregarTarea,
  ahora,
  buscarBot,
  buscarTarea,
  crearBot,
  directos,
  guardarEstado,
  guardarTareas,
  jefes,
  listarBots,
  listarTareas,
  nuevoId,
  validarJefe,
  MAX_BOTS,
  type Bot,
  type EstadoTarea,
  type Tarea,
} from "./almacen.ts";
import { emitir } from "./eventos.ts";

const MAX_ABIERTAS_POR_BOT = 3;
const MAX_ABIERTAS_TOTAL = 90;
const MAX_POR_LLAMADA = 30;
const PRESUPUESTO_DEFECTO = 1;
const PRESUPUESTO_MAX = 5;
const PLAZO_DEFECTO_MIN = 120;
const REVISAR_CADA_MS = 10_000;
const ESPERA_AGRUPAR_MS = 30_000;
const AVISAR_DESPUES_MS = 20 * 60_000;
const REINTENTO_MS = 2 * 60_000;
const MAX_INTENTOS = 3;

export const abierta = (t: Tarea) => !TERMINALES.includes(t.estado);

// ---- Conexión con el bucle de los bots (se define en agente.ts, sin importarlo acá) ----

interface Ganchos {
  encolarTarea: (botId: string, tareaId: string) => void;
  encolarResultados: (botId: string, padreId: string | null) => void;
  hayResultadosEnCola: (botId: string, padreId: string | null) => boolean;
  tareaEnCola: (botId: string, tareaId: string) => boolean;
  quitarDeCola: (botId: string, tareaId: string) => void;
  // Corta el turno del bot si está trabajando en esa tarea.
  cortarTarea: (botId: string, tareaId: string) => void;
}

let ganchos: Ganchos | null = null;

export function conectarEquipo(g: Ganchos): void {
  ganchos = g;
}

// ---- Contexto del turno en curso de cada bot ----

export interface Entrega {
  estado: "completa" | "parcial" | "bloqueada";
  resumen: string;
  archivos: string[];
}

interface TurnoTarea {
  tareaId: string;
  entrega: Entrega | null;
}

const turnos = new Map<string, TurnoTarea>();

export const tareaDelTurno = (botId: string): string | null => turnos.get(botId)?.tareaId ?? null;

export function empezarTurnoDeTarea(botId: string, tareaId: string): Tarea | null {
  const t = buscarTarea(tareaId);
  if (!t || !(t.estado === "pendiente" || t.estado === "esperando_equipo")) return null;
  t.estado = "en_curso";
  t.inicio ??= ahora();
  guardarTareas();
  turnos.set(botId, { tareaId, entrega: null });
  emitir("tarea", vistaTarea(t));
  return t;
}

export function sumarGasto(botId: string, usd: number): { tarea: Tarea; agotado: boolean } | null {
  const turno = turnos.get(botId);
  const t = turno ? buscarTarea(turno.tareaId) : undefined;
  if (!t) return null;
  t.gastoUsd += usd;
  guardarTareas();
  return { tarea: t, agotado: t.gastoUsd >= t.presupuestoUsd };
}

export type FinTurno = "normal" | "maximo" | "rechazo" | "error" | "cancelado" | "vencido" | "pausa";

// Cierra la tarea del turno según cómo terminó. `textoFinal` es lo último que dijo el bot.
export function terminarTurnoDeTarea(botId: string, fin: FinTurno, textoFinal: string): void {
  const turno = turnos.get(botId);
  turnos.delete(botId);
  const t = turno ? buscarTarea(turno.tareaId) : undefined;
  if (!t || !abierta(t)) return;
  if (t.estado === "cancelada" || t.estado === "vencida") return;
  const subtareasAbiertas = listarTareas().some((s) => s.padreId === t.id && abierta(s));
  if (fin === "cancelado") return cerrar(t, "cancelada", textoFinal || "Cancelada.");
  if (fin === "vencido") return cerrar(t, "vencida", textoFinal || "Se venció el plazo.");
  if (fin === "pausa") {
    // Se detuvo todo Gravity: la tarea vuelve a la cola tal cual.
    t.estado = "pendiente";
    guardarTareas();
    emitir("tarea", vistaTarea(t));
    return;
  }
  if (fin === "error") {
    t.intentos++;
    if (t.intentos > MAX_INTENTOS) return cerrar(t, "fallida", "No se pudo completar después de varios intentos.");
    t.estado = "pendiente";
    t.reintentarDesde = new Date(Date.now() + REINTENTO_MS).toISOString();
    guardarTareas();
    emitir("tarea", vistaTarea(t));
    return;
  }
  if (fin === "rechazo") return cerrar(t, "fallida", "El modelo no quiso seguir con esta tarea.");
  if (turno?.entrega) {
    const e = turno.entrega;
    t.archivos = e.archivos;
    return cerrar(t, e.estado, e.resumen);
  }
  if (subtareasAbiertas) {
    t.estado = "esperando_equipo";
    guardarTareas();
    emitir("tarea", vistaTarea(t));
    return;
  }
  cerrar(t, fin === "maximo" ? "parcial" : "completa", textoFinal.slice(0, 20_000) || "(sin texto final)");
}

function cerrar(t: Tarea, estado: EstadoTarea, resultado: string): void {
  t.estado = estado;
  t.resultado = resultado;
  t.fin = ahora();
  guardarTareas();
  emitir("tarea", vistaTarea(t));
  // Las subtareas de una tarea que se cierra ya no le sirven a nadie.
  if (estado === "cancelada" || estado === "vencida") {
    for (const s of listarTareas()) if (s.padreId === t.id && abierta(s)) cancelarTarea(s.id, "Se cerró la tarea de la que dependía.");
  }
  revisarAvisos();
}

export function cancelarTarea(id: string, motivo = "Cancelada."): boolean {
  const t = buscarTarea(id);
  if (!t || !abierta(t)) return false;
  const estabaEnCurso = t.estado === "en_curso";
  ganchos?.quitarDeCola(t.paraId, t.id);
  cerrar(t, "cancelada", motivo);
  if (estabaEnCurso) ganchos?.cortarTarea(t.paraId, t.id);
  return true;
}

// ---- Avisos de resultados al manager ----

const claveGrupo = (deId: string, padreId: string | null) => `${deId}|${padreId ?? ""}`;

export function revisarAvisos(): void {
  if (!ganchos) return;
  const t0 = Date.now();
  const grupos = new Map<string, Tarea[]>();
  for (const t of listarTareas()) {
    if (abierta(t) || t.avisada) continue;
    const k = claveGrupo(t.deId, t.padreId);
    grupos.set(k, [...(grupos.get(k) ?? []), t]);
  }
  for (const sinAvisar of grupos.values()) {
    const { deId, padreId } = sinAvisar[0]!;
    if (!buscarBot(deId)) {
      for (const t of sinAvisar) t.avisada = true;
      guardarTareas();
      continue;
    }
    if (ganchos.hayResultadosEnCola(deId, padreId)) continue;
    const lotes = new Set(sinAvisar.map((t) => t.loteId));
    const delLote = listarTareas().filter((t) => t.deId === deId && t.padreId === padreId && lotes.has(t.loteId));
    const todoTerminado = delLote.every((t) => !abierta(t));
    const hayBloqueada = sinAvisar.some((t) => t.estado === "bloqueada");
    const masVieja = Math.min(...sinAvisar.map((t) => Date.parse(t.fin ?? t.creada)));
    const ultima = Math.max(...sinAvisar.map((t) => Date.parse(t.fin ?? t.creada)));
    const padre = padreId ? buscarTarea(padreId) : undefined;
    const padreApurado = !!padre && Date.parse(padre.venceEn) - t0 < 10 * 60_000;
    const motivo = todoTerminado || hayBloqueada || t0 - masVieja > AVISAR_DESPUES_MS || padreApurado;
    // Se espera un poco para juntar resultados que llegan casi juntos, salvo que ya estén todos.
    if (motivo && (todoTerminado || t0 - ultima > ESPERA_AGRUPAR_MS)) ganchos.encolarResultados(deId, padreId);
  }
}

// Junta, al empezar el turno, los resultados todavía no avisados de ese grupo.
export function resultadosParaAvisar(deId: string, padreId: string | null): Tarea[] {
  return listarTareas().filter((t) => t.deId === deId && t.padreId === padreId && !abierta(t) && !t.avisada);
}

export function marcarAvisadas(ts: Tarea[]): void {
  for (const t of ts) t.avisada = true;
  guardarTareas();
}

// Plazos vencidos y reintentos programados.
function revisarPlazos(): void {
  const t0 = Date.now();
  for (const t of listarTareas()) {
    if (!abierta(t)) continue;
    if (Date.parse(t.venceEn) <= t0) {
      if (t.estado === "en_curso") {
        cerrar(t, "vencida", "Se venció el plazo mientras trabajaba.");
        ganchos?.cortarTarea(t.paraId, t.id);
      } else {
        ganchos?.quitarDeCola(t.paraId, t.id);
        cerrar(t, "vencida", "Se venció el plazo antes de terminar.");
      }
      continue;
    }
    if (t.estado === "pendiente" && (!t.reintentarDesde || Date.parse(t.reintentarDesde) <= t0) && !ganchos?.tareaEnCola(t.paraId, t.id)) {
      if (buscarBot(t.paraId)) ganchos?.encolarTarea(t.paraId, t.id);
      else cerrar(t, "cancelada", "El compañero ya no existe.");
    }
  }
}

export function iniciarEquipo(): void {
  // Al arrancar: lo que estaba en curso vuelve a la cola.
  for (const t of listarTareas()) if (t.estado === "en_curso") t.estado = "pendiente";
  guardarTareas();
  revisarPlazos();
  revisarAvisos();
  setInterval(() => {
    revisarPlazos();
    revisarAvisos();
  }, REVISAR_CADA_MS).unref();
}

// ---- Vistas ----

export function vistaTarea(t: Tarea) {
  return {
    id: t.id,
    loteId: t.loteId,
    trabajo: t.trabajo,
    deId: t.deId,
    deNombre: buscarBot(t.deId)?.nombre ?? "(ya no está)",
    paraId: t.paraId,
    paraNombre: t.paraNombre,
    titulo: t.titulo,
    instrucciones: t.instrucciones,
    entregable: t.entregable,
    estado: t.estado,
    resultado: t.resultado,
    archivos: t.archivos,
    carpeta: t.carpeta,
    creada: t.creada,
    inicio: t.inicio,
    fin: t.fin,
    venceEn: t.venceEn,
    presupuestoUsd: t.presupuestoUsd,
    gastoUsd: t.gastoUsd,
    padreId: t.padreId,
    reunionId: t.reunionId,
  };
}

// ---- Crear tareas (desde `delegar` o desde el acta de una reunión) ----

export interface Encargo {
  para: string;
  titulo: string;
  instrucciones: string;
  entregable: string;
}

function resolverMiembro(manager: Bot, para: string, permitidos: Bot[]): Bot | string {
  const p = para.trim().toLowerCase();
  const encontrados = permitidos.filter((b) => b.id === para.trim() || b.nombre.toLowerCase() === p);
  if (encontrados.length === 1) return encontrados[0]!;
  if (encontrados.length > 1) return `Hay más de un «${para}» en tu equipo: usá el id.`;
  return `«${para}» no está en el equipo directo de ${manager.nombre}.`;
}

export function crearTareas(
  manager: Bot,
  trabajo: string,
  encargos: Encargo[],
  opciones: { plazoMin?: number | null; presupuestoUsd?: number | null; padreId?: string | null; reunionId?: string | null; permitidos?: Bot[] },
): Tarea[] {
  if (encargos.length === 0) throw new Error("No hay encargos.");
  if (encargos.length > MAX_POR_LLAMADA) throw new Error(`Como mucho ${MAX_POR_LLAMADA} encargos por vez.`);
  const permitidos = opciones.permitidos ?? directos(manager.id);
  const abiertas = listarTareas().filter(abierta);
  if (abiertas.length + encargos.length > MAX_ABIERTAS_TOTAL) {
    throw new Error(`Hay demasiadas tareas abiertas en todo Gravity (máximo ${MAX_ABIERTAS_TOTAL}). Esperá a que terminen algunas.`);
  }
  const destinos = encargos.map((e) => resolverMiembro(manager, e.para, permitidos));
  const errores = destinos.filter((d): d is string => typeof d === "string");
  if (errores.length) throw new Error(`${errores.join(" ")} Tu equipo directo: ${permitidos.map((b) => `${b.nombre} (${b.id})`).join(", ") || "nadie"}.`);
  for (const bot of new Set(destinos as Bot[])) {
    const propias = abiertas.filter((t) => t.paraId === bot.id).length;
    const nuevas = (destinos as Bot[]).filter((b) => b === bot).length;
    if (propias + nuevas > MAX_ABIERTAS_POR_BOT) throw new Error(`${bot.nombre} ya tiene ${propias} tareas abiertas (máximo ${MAX_ABIERTAS_POR_BOT}).`);
  }

  const padre = opciones.padreId ? buscarTarea(opciones.padreId) : undefined;
  let plazo = Math.min(1440, Math.max(10, Math.round(opciones.plazoMin ?? PLAZO_DEFECTO_MIN))) * 60_000;
  if (padre) {
    const resta = Date.parse(padre.venceEn) - Date.now() - 5 * 60_000;
    if (resta < 10 * 60_000) throw new Error("No queda tiempo en tu tarea para delegar: entregá lo que tengas.");
    plazo = Math.min(plazo, resta);
  }
  const presupuesto = Math.min(PRESUPUESTO_MAX, Math.max(0.05, opciones.presupuestoUsd ?? PRESUPUESTO_DEFECTO));
  const loteId = nuevoId();
  const base = manager.carpetaEquipo ?? `equipos/${manager.id}/`;
  const creadas: Tarea[] = [];
  encargos.forEach((e, i) => {
    const bot = destinos[i] as Bot;
    const id = `t_${nuevoId()}`;
    const carpeta = `${base}${id}/`;
    mkdirSync(path.join(COMPUTADORA, carpeta), { recursive: true });
    const t: Tarea = {
      id,
      loteId,
      trabajo,
      deId: manager.id,
      paraId: bot.id,
      paraNombre: bot.nombre,
      titulo: e.titulo,
      instrucciones: e.instrucciones,
      entregable: e.entregable,
      estado: "pendiente",
      resultado: "",
      archivos: [],
      carpeta,
      creada: ahora(),
      inicio: null,
      fin: null,
      venceEn: new Date(Date.now() + plazo).toISOString(),
      intentos: 0,
      reintentarDesde: null,
      presupuestoUsd: presupuesto,
      gastoUsd: 0,
      padreId: opciones.padreId ?? null,
      reunionId: opciones.reunionId ?? null,
      avisada: false,
    };
    agregarTarea(t);
    creadas.push(t);
    emitir("tarea", vistaTarea(t));
    ganchos?.encolarTarea(bot.id, t.id);
  });
  return creadas;
}

// ---- Crear un equipo entero de una vez ----

export interface NuevoEquipo {
  manager: { nombre: string; titulo: string; descripcion: string };
  reportaA: string | null;
  miembros: { nombre: string; titulo: string; descripcion: string }[];
  carpetaLibre: boolean;
}

export function crearEquipo(d: NuevoEquipo): { manager: Bot; miembros: Bot[] } {
  if (listarBots().length + 1 + d.miembros.length > MAX_BOTS) {
    throw new Error(`Con este equipo pasarías los ${MAX_BOTS} compañeros. Quedan ${MAX_BOTS - listarBots().length} lugares.`);
  }
  const error = validarJefe(null, d.reportaA);
  if (error) throw new Error(error);
  if (d.reportaA && jefes(d.reportaA).length + 2 >= 3 && d.miembros.length) {
    throw new Error("Ese manager ya está en el tercer nivel: su equipo no puede tener otro nivel debajo.");
  }
  const manager = crearBot({ ...d.manager, cargo: "manager", reportaA: d.reportaA, esfuerzo: "medium" }, false);
  const miembros = d.miembros.map((m) => crearBot({ ...m, cargo: "miembro", reportaA: manager.id, esfuerzo: "low" }, false));
  mkdirSync(path.join(COMPUTADORA, manager.carpetaEquipo!), { recursive: true });
  // Por defecto el equipo escribe en su carpeta sin pedir permiso: es donde vive su trabajo.
  if (d.carpetaLibre) agregarRegla("editor", manager.carpetaEquipo!, { tipo: "equipo", managerId: manager.id });
  guardarEstado();
  return { manager, miembros };
}

// ---- Herramientas para los bots ----
// Todos los bots tienen las mismas herramientas en el mismo orden (cambiar de cargo no cambia la lista);
// lo que cada cargo puede hacer lo controla el sistema al ejecutarlas.

export const EntradaDelegar = z.strictObject({
  trabajo: z.string().describe("Título corto del trabajo que agrupa estos encargos"),
  encargos: z
    .array(
      z.strictObject({
        para: z.string().describe("Nombre o id de alguien de tu equipo directo"),
        titulo: z.string().describe("Título corto del encargo"),
        instrucciones: z.string().describe("Qué hacer, con qué fuentes y cuándo está terminado. Completo: no ve tu conversación"),
        entregable: z.string().describe("Qué tiene que devolver; los archivos van en la carpeta de la tarea"),
      }),
    )
    .describe("Un encargo por persona (como mucho 3 abiertos por persona)"),
  plazo_min: z.number().nullable().describe("Minutos para terminar (10 a 1440; null = 120)"),
  presupuesto_usd: z.number().nullable().describe("Tope de gasto por encargo en dólares (null = 1, máximo 5)"),
});

export const EntradaTareas = z.strictObject({
  accion: z.enum(["listar", "ver", "cancelar"]),
  id: z.string().nullable().describe("Id de la tarea (t_…) para ver o cancelar"),
});

export const EntradaEntregar = z.strictObject({
  tarea_id: z.string().describe("La tarea en la que estás trabajando ahora"),
  estado: z.enum(["completa", "parcial", "bloqueada"]),
  resumen: z.string().describe("Para tu manager: qué hiciste o encontraste, con números y rutas. Si está bloqueada, qué falta y qué proponés"),
  archivos: z.array(z.string()).describe("Rutas de los entregables en la computadora; [] si no hay"),
});

export function herramientasEquipo(botId: string): BetaRunnableTool[] {
  const delegar = betaZodTool({
    name: "delegar",
    description:
      "Solo managers: reparte encargos a tu equipo directo. Cada persona trabaja por su cuenta en su carpeta y, cuando terminan, te llegan los resultados juntos en un mensaje [Resultados de tu equipo]. No esperes ni consultes en bucle: después de delegar, terminá tu turno contándole al usuario qué repartiste.",
    inputSchema: EntradaDelegar,
    run: (e) => {
      const bot = buscarBot(botId);
      if (!bot) throw new Error("El bot ya no existe.");
      if (bot.cargo !== "manager") throw new Error("Tu cargo no permite delegar. Si te falta algo, decíselo al usuario o, si estás en una tarea, entregala como bloqueada con tu pregunta.");
      const padreId = tareaDelTurno(botId);
      const creadas = crearTareas(bot, e.trabajo, e.encargos, { plazoMin: e.plazo_min, presupuestoUsd: e.presupuesto_usd, padreId });
      const lista = creadas.map((t) => `- ${t.id} → ${t.paraNombre}: «${t.titulo}» (carpeta ${t.carpeta})`).join("\n");
      return `Trabajo «${e.trabajo}» repartido en ${creadas.length} encargo(s), cada uno con US$${creadas[0]!.presupuestoUsd.toFixed(2)} y plazo hasta ${new Date(creadas[0]!.venceEn).toLocaleTimeString("es")}:\n${lista}\nCuando terminen te llegan los resultados solos. Terminá tu turno ahora.`;
    },
  });

  const tareas = betaZodTool({
    name: "tareas",
    description: "Lista tus tareas (las que delegaste y las que te asignaron), mirá una en detalle o cancelá una que delegaste.",
    inputSchema: EntradaTareas,
    run: (e) => {
      if (e.accion === "listar") {
        const mias = listarTareas()
          .filter((t) => t.deId === botId || t.paraId === botId)
          .filter((t) => abierta(t) || Date.now() - Date.parse(t.fin ?? t.creada) < 86_400_000)
          .slice(-40);
        if (!mias.length) return "No tenés tareas recientes.";
        return mias
          .map((t) => `${t.id} [${t.estado}] ${t.deId === botId ? `→ ${t.paraNombre}` : `de ${buscarBot(t.deId)?.nombre ?? "?"}`}: «${t.titulo}» (${t.trabajo})`)
          .join("\n");
      }
      const t = e.id ? buscarTarea(e.id) : undefined;
      if (!t || (t.deId !== botId && t.paraId !== botId)) throw new Error("No tenés una tarea con ese id.");
      if (e.accion === "ver") return JSON.stringify(vistaTarea(t));
      if (t.deId !== botId) throw new Error("Solo podés cancelar tareas que delegaste vos.");
      return cancelarTarea(t.id, `Cancelada por ${buscarBot(botId)?.nombre ?? "su manager"}.`) ? "Tarea cancelada." : "La tarea ya estaba cerrada.";
    },
  });

  const entregar = betaZodTool({
    name: "entregar",
    description:
      "Cuando estás trabajando en una tarea asignada por tu manager, entregala con este resultado. Si te falta información, entregala como bloqueada con tu pregunta.",
    inputSchema: EntradaEntregar,
    run: (e) => {
      const turno = turnos.get(botId);
      if (!turno) throw new Error("Ahora no estás trabajando en ninguna tarea asignada: respondé normalmente.");
      if (turno.tareaId !== e.tarea_id) throw new Error(`Estás trabajando en la tarea ${turno.tareaId}, no en ${e.tarea_id}.`);
      const abiertas = listarTareas().filter((t) => t.padreId === turno.tareaId && abierta(t)).length;
      if (abiertas) throw new Error(`Tenés ${abiertas} subtareas abiertas: terminá tu turno y esperá sus resultados, o cancelalas con \`tareas\`.`);
      turno.entrega = { estado: e.estado, resumen: e.resumen.slice(0, 20_000), archivos: e.archivos.slice(0, 50) };
      return "Entrega registrada. Terminá tu turno con un resumen breve.";
    },
  });

  return [delegar, tareas, entregar];
}
