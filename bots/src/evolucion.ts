// Gravity Evolution (experimental): mira cómo se usa Gravity de verdad (gasto, resultados, errores,
// herramientas usadas, rutinas, automatizaciones) y propone cambios concretos. No cambia nada solo: cada
// propuesta se aplica cuando el usuario toca «Aplicar» (y queda en el historial), o se descarta.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATOS, ahora, ajustes, buscarBot, cambiarAjustes, conversacion, crearRutina, directos, guardarEstado, listarBots, listarRutinas, listarTareas, type Bot } from "./almacen.ts";
import { gastoPorBotDesde } from "./gasto.ts";
import { GRUPOS_HERRAMIENTAS, normalizarBloqueadas } from "./herramientas.ts";
import { confianzaDe } from "./talento.ts";
import { crearAutomatizacion, listarAutomatizaciones } from "./automatizaciones.ts";
import { emitir } from "./eventos.ts";

export interface Propuesta {
  id: string;
  titulo: string;
  porque: string;
  efecto: string;
}
interface Interna extends Propuesta { aplicar: () => void }

const ARCHIVO = path.join(DATOS, "evolucion.json");
interface Registro { historial: { fecha: string; id: string; titulo: string }[]; descartadas: Record<string, string> }
const leer = (): Registro => (existsSync(ARCHIVO) ? (JSON.parse(readFileSync(ARCHIVO, "utf8")) as Registro) : { historial: [], descartadas: {} });
const escribir = (r: Registro) => writeFileSync(ARCHIVO, JSON.stringify(r, null, 2));
const DIA = 86_400_000;

/** Herramientas que usó un compañero en sus últimos mensajes. */
function herramientasUsadas(bot: Bot): { usadas: Set<string>; mensajes: number } {
  const ms = conversacion(bot.id).mensajes.slice(-300);
  const usadas = new Set<string>();
  for (const m of ms) if (Array.isArray(m.content)) for (const b of m.content as { type?: string; name?: string }[]) if (b?.type === "tool_use" && b.name) usadas.add(b.name);
  return { usadas, mensajes: ms.length };
}

function calcular(): Interna[] {
  const xs: Interna[] = [];
  const bots = listarBots();
  const gasto = gastoPorBotDesde(7);
  const semana = listarTareas().filter((t) => Date.now() - Date.parse(t.fin ?? t.creada) < 14 * DIA);
  const actualizar = (b: Bot, cambios: Partial<Bot>) => { Object.assign(b, cambios); guardarEstado(); emitir("bots"); };

  for (const b of bots) {
    const conf = confianzaDe(b.id);
    // 1. Modelo rápido para quien gasta bastante y le va bien.
    if ((gasto[b.id] ?? 0) >= 1 && !b.modelo && conf.nivel === "alta") {
      xs.push({ id: `rapido:${b.id}`, titulo: `Probar el modelo Rápido con ${b.nombre}`, porque: `Gastó US$ ${(gasto[b.id] ?? 0).toFixed(2)} en 7 días y termina bien el ${conf.puntaje}% de lo que le encargan.`, efecto: `Perfil de ${b.nombre} → Modelo: Rápido (lo podés volver a Automático cuando quieras).`, aplicar: () => actualizar(b, { modelo: "rapido" }) });
    }
    // 2. Mentor para quien falla seguido, si en su equipo hay alguien confiable.
    if (conf.nivel === "baja" && !b.mentorId) {
      const jefe = b.reportaA ? buscarBot(b.reportaA) : undefined;
      const pares = [...(jefe ? [jefe, ...directos(jefe.id)] : bots)].filter((x) => x.id !== b.id && !x.archivado);
      const mejor = pares.map((x) => ({ x, c: confianzaDe(x.id) })).filter((y) => y.c.nivel === "alta").sort((a, c) => c.c.puntaje - a.c.puntaje)[0];
      if (mejor) xs.push({ id: `mentor:${b.id}:${mejor.x.id}`, titulo: `Que ${mejor.x.nombre} sea mentor de ${b.nombre}`, porque: `${b.nombre} tiene confianza ${conf.puntaje}% (${conf.fallidas} de ${conf.total} mal) y ${mejor.x.nombre} ${mejor.c.puntaje}%.`, efecto: `${mejor.x.nombre} revisa cada tarea que termine ${b.nombre} y le manda una devolución.`, aplicar: () => actualizar(b, { mentorId: mejor.x.id }) });
    }
    // 3. Permisos mínimos: grupos de herramientas que nunca usa.
    const { usadas, mensajes } = herramientasUsadas(b);
    if (mensajes >= 60) {
      const apagadas = normalizarBloqueadas(b.bloqueadas);
      const sinUso = Object.entries(GRUPOS_HERRAMIENTAS).filter(([g, def]) => !["computadora", "web", "equipo", "proyectos"].includes(g) && !apagadas.includes(g) && !def.herramientas.some((h) => usadas.has(h))).map(([g]) => g);
      if (sinUso.length) xs.push({ id: `permisos:${b.id}:${sinUso.join(",")}`, titulo: `Apagarle a ${b.nombre} lo que no usa`, porque: `En sus últimos ${mensajes} mensajes no usó: ${sinUso.map((g) => GRUPOS_HERRAMIENTAS[g]!.nombre).join("; ")}.`, efecto: "Menos permisos = menos riesgo. Se vuelven a prender en su Perfil.", aplicar: () => actualizar(b, { bloqueadas: [...apagadas, ...sinUso] }) });
    }
  }
  // 4. Respaldo automático si fallan tareas.
  const malas = semana.filter((t) => t.estado === "fallida" || t.estado === "vencida");
  if (malas.length >= 2 && !ajustes().respaldoAutomatico) {
    xs.push({ id: "respaldo", titulo: "Prender los agentes de respaldo", porque: `En 14 días ${malas.length} tareas del equipo fallaron o se vencieron.`, efecto: "Si una tarea falla, otro miembro del equipo la retoma una vez con el mismo presupuesto.", aplicar: () => { cambiarAjustes({ respaldoAutomatico: true }); emitir("ajustes"); } });
  }
  // 5. Flujo para tareas trabadas.
  const trabadas = semana.filter((t) => t.estado === "bloqueada" || t.estado === "fallida");
  const manager = bots.filter((b) => b.cargo === "manager").sort((a, c) => listarTareas().filter((t) => t.deId === c.id).length - listarTareas().filter((t) => t.deId === a.id).length)[0];
  if (trabadas.length >= 2 && manager && !listarAutomatizaciones().some((a) => a.activa && (a.evento === "tarea_bloqueada" || a.evento === "tarea_fallida"))) {
    xs.push({ id: `flujo:${manager.id}`, titulo: `Que ${manager.nombre} revise solo las tareas trabadas`, porque: `${trabadas.length} tareas quedaron bloqueadas o fallidas en 14 días y nadie las revisa automáticamente.`, efecto: `Automatización: cuando una tarea queda bloqueada, ${manager.nombre} averigua qué pasa y propone cómo destrabarla.`, aplicar: () => { crearAutomatizacion({ nombre: "Destrabar tareas", evento: "tarea_bloqueada", botId: manager.id, instrucciones: "Averiguá por qué quedó bloqueada (resultado, archivos, a quién le falta qué) y proponé cómo destrabarla. Si necesitás algo mío, preguntame." }); emitir("automatizaciones"); } });
  }
  // 6. Resumen diario si el equipo trabaja mucho y no hay rutinas.
  if (manager && listarTareas().filter((t) => Date.now() - Date.parse(t.creada) < 7 * DIA).length >= 10 && !listarRutinas(manager.id).length) {
    xs.push({ id: `resumen:${manager.id}`, titulo: `Resumen diario de ${manager.nombre}`, porque: "El equipo hizo 10 o más encargos esta semana y no hay ninguna rutina.", efecto: `Rutina diaria a las 18:30: ${manager.nombre} resume lo hecho, lo pendiente y lo trabado.`, aplicar: () => { crearRutina({ botId: manager.id, nombre: "Resumen del día", instrucciones: "Resumí lo que hizo el equipo hoy (tareas terminadas, con dónde quedó cada cosa), lo pendiente y lo trabado. Corto y en viñetas.", habilidadId: null, horario: { tipo: "diaria", hora: "18:30" }, activa: true }); emitir("rutinas", { botId: manager.id }); } });
  }
  return xs;
}

export function propuestas(): { propuestas: Propuesta[]; historial: Registro["historial"] } {
  const r = leer();
  const vigentes = calcular().filter((p) => !r.descartadas[p.id] || Date.now() - Date.parse(r.descartadas[p.id]!) > 30 * DIA);
  return { propuestas: vigentes.map(({ aplicar: _, ...p }) => p), historial: r.historial.slice(-30).reverse() };
}

/** Aplica una propuesta que sigue vigente (se recalcula: si ya no corresponde, no hace nada). */
export function aplicarPropuesta(id: string): Propuesta {
  const p = calcular().find((x) => x.id === id);
  if (!p) throw new Error("Esa propuesta ya no corresponde (cambiaron los datos).");
  p.aplicar();
  const r = leer();
  r.historial.push({ fecha: ahora(), id: p.id, titulo: p.titulo });
  escribir(r);
  const { aplicar: _, ...vista } = p;
  return vista;
}

export function descartarPropuesta(id: string): void {
  const r = leer();
  r.descartadas[id] = ahora();
  escribir(r);
}
