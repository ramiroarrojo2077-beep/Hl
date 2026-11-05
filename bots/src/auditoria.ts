// Auditor: revisa permisos, errores de herramientas y resultados (tareas, proyectos, rutinas y
// aprobaciones) con los datos reales del motor. No cambia nada: arma un informe que el usuario lee
// o le pasa a un compañero para que lo analice.

import { ajustes, conversacion, listarBots, listarReglas, listarRutinas, listarTareas, TERMINALES, type Bot } from "./almacen.ts";
import { listarAprobaciones } from "./agente.ts";
import { normalizarBloqueadas } from "./herramientas.ts";
import { gastoBotHoy, gastoPorBotDesde } from "./gasto.ts";
import { listarAutomatizaciones } from "./automatizaciones.ts";
import { leerActividad } from "./actividad.ts";
import { listarProyectos, progreso } from "./proyectos.ts";

export type Nivel = "alto" | "medio" | "info";
export interface Hallazgo {
  nivel: Nivel;
  area: "permisos" | "errores" | "tareas" | "proyectos" | "rutinas" | "aprobaciones" | "conflictos";
  texto: string;
  botId?: string;
}
export interface Sugerencia {
  texto: string;
  // Pantalla de Gravity donde se hace el cambio (la interfaz la muestra como enlace).
  enlace: string;
  accion: string;
}
export interface Informe {
  fecha: string;
  revisados: { compañeros: number; tareas: number; proyectos: number; rutinas: number };
  hallazgos: Hallazgo[];
  sugerencias: Sugerencia[];
}

const HORA = 3600_000;
const ORDEN: Record<Nivel, number> = { alto: 0, medio: 1, info: 2 };

/** Errores de herramientas en los últimos mensajes de la conversación de un compañero. */
function erroresDe(bot: Bot): { cantidad: number; ultimo: string | null } {
  const mensajes = conversacion(bot.id).mensajes.slice(-200);
  let cantidad = 0;
  let ultimo: string | null = null;
  for (const m of mensajes) {
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (const b of m.content as { type?: string; is_error?: boolean; content?: unknown }[]) {
      if (b?.type !== "tool_result" || !b.is_error) continue;
      cantidad++;
      const t = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((x: { text?: string }) => x?.text ?? "").join(" ") : "";
      if (t.trim()) ultimo = t.trim().replace(/\s+/g, " ").slice(0, 160);
    }
  }
  return { cantidad, ultimo };
}

export function auditar(): Informe {
  const h: Hallazgo[] = [];
  const bots = listarBots();
  const ahoraMs = Date.now();

  // Permisos
  if (ajustes().autoAprobar) h.push({ nivel: "alto", area: "permisos", texto: "«Aprobar todo solo» está prendido: comandos, archivos y envíos a terceros salen sin pedirte permiso." });
  for (const r of listarReglas()) {
    const amplia = r.patron === "*" || r.patron === "" || r.patron === "/";
    if (r.alcance.tipo === "global" && (amplia || r.herramienta === "externo" || r.herramienta === "mensajes")) {
      h.push({ nivel: "medio", area: "permisos", texto: `Regla «siempre permitir» amplia: ${r.herramienta} ${r.patron || "(todo)"} para todos los compañeros.` });
    }
  }
  for (const b of bots) {
    const fuera = normalizarBloqueadas(b.bloqueadas);
    if (b.puedeEnviarAfuera && !fuera.includes("mensajes") && !fuera.includes("conexiones")) {
      h.push({ nivel: "info", area: "permisos", botId: b.id, texto: `${b.nombre} puede mandar mensajes y correos afuera (cada envío igual pide aprobación).` });
    }
  }

  // Topes de gasto propios
  for (const b of bots) {
    if (b.topeDiarioUsd && gastoBotHoy(b.id) >= b.topeDiarioUsd) h.push({ nivel: "medio", area: "permisos", botId: b.id, texto: `${b.nombre} llegó a su tope de gasto de hoy (US$ ${b.topeDiarioUsd}): no arranca tareas ni rutinas solo.` });
  }

  // Errores de herramientas
  for (const b of bots) {
    const e = erroresDe(b);
    if (e.cantidad >= 3) h.push({ nivel: e.cantidad >= 8 ? "alto" : "medio", area: "errores", botId: b.id, texto: `${b.nombre}: ${e.cantidad} errores de herramientas en sus últimos mensajes.${e.ultimo ? ` Último: «${e.ultimo}»` : ""}` });
  }

  // Tareas del equipo
  const tareas = listarTareas();
  const nombre = (id: string) => bots.find((b) => b.id === id)?.nombre ?? "alguien que ya no está";
  for (const t of tareas) {
    const fin = Date.parse(t.fin ?? t.creada);
    if ((t.estado === "bloqueada" || t.estado === "fallida") && ahoraMs - fin < 7 * 24 * HORA) {
      h.push({ nivel: "medio", area: "tareas", botId: t.paraId, texto: `Tarea «${t.titulo}» de ${nombre(t.paraId)} quedó ${t.estado}.` });
    } else if (!TERMINALES.includes(t.estado) && ahoraMs - Date.parse(t.creada) > 24 * HORA) {
      h.push({ nivel: "info", area: "tareas", botId: t.paraId, texto: `Tarea «${t.titulo}» de ${nombre(t.paraId)} lleva más de un día abierta.` });
    }
  }

  // Proyectos
  const proyectos = listarProyectos().filter((p) => p.estado === "activo");
  for (const p of proyectos) {
    const g = progreso(p);
    if (g.vencidas) h.push({ nivel: "alto", area: "proyectos", texto: `Proyecto «${p.nombre}»: ${g.vencidas} tarea(s) vencida(s).` });
    const fallidas = p.tareas.filter((t) => t.estado === "fallida").length;
    if (fallidas) h.push({ nivel: "medio", area: "proyectos", texto: `Proyecto «${p.nombre}»: ${fallidas} tarea(s) fallida(s).` });
    const sinResp = p.tareas.filter((t) => !t.asignadoA && t.estado === "pendiente").length;
    if (sinResp) h.push({ nivel: "info", area: "proyectos", texto: `Proyecto «${p.nombre}»: ${sinResp} tarea(s) sin responsable.` });
  }

  // Rutinas
  const rutinas = listarRutinas();
  for (const r of rutinas) {
    const ult = r.ejecuciones.at(-1);
    if (r.activa && ult?.estado === "error") h.push({ nivel: "medio", area: "rutinas", botId: r.botId, texto: `Rutina «${r.nombre}» de ${nombre(r.botId)} falló la última vez: ${ult.resumen.slice(0, 160)}` });
  }

  // Conflictos: dos compañeros cambiaron el mismo archivo con poco tiempo de diferencia (uno puede haber
  // pisado lo del otro). Sale del historial real de acciones.
  for (const c of conflictosDeArchivos(bots)) h.push({ nivel: "medio", area: "conflictos", texto: c });

  // Aprobaciones
  for (const a of listarAprobaciones()) {
    if (ahoraMs - Date.parse(a.creada) > HORA) h.push({ nivel: "medio", area: "aprobaciones", botId: a.botId, texto: `${nombre(a.botId)} espera tu aprobación hace más de una hora: ${a.titulo}.` });
  }

  h.sort((x, y) => ORDEN[x.nivel] - ORDEN[y.nivel]);
  return { fecha: new Date().toISOString(), revisados: { compañeros: bots.length, tareas: tareas.length, proyectos: proyectos.length, rutinas: rutinas.length }, hallazgos: h, sugerencias: sugerir(bots, tareas, proyectos, rutinas) };
}

/**
 * Sugerencias para mejorar cómo trabaja el equipo, sacadas de lo que pasó de verdad (no inventa
 * datos). Solo propone: cada una lleva a la pantalla donde el usuario decide si la aplica.
 */
function sugerir(bots: Bot[], tareas: ReturnType<typeof listarTareas>, proyectos: ReturnType<typeof listarProyectos>, rutinas: ReturnType<typeof listarRutinas>): Sugerencia[] {
  const out: Sugerencia[] = [];
  const ahoraMs = Date.now();
  const flujos = listarAutomatizaciones().filter((a) => a.activa);
  const hay = (ev: string) => flujos.some((a) => a.evento === ev);
  const semana = tareas.filter((t) => ahoraMs - Date.parse(t.fin ?? t.creada) < 7 * 24 * HORA);
  const trabadas = semana.filter((t) => t.estado === "bloqueada" || t.estado === "fallida");
  if (trabadas.length >= 2 && !hay("tarea_bloqueada") && !hay("tarea_fallida")) {
    out.push({ texto: `Esta semana ${trabadas.length} tareas quedaron bloqueadas o fallaron y nadie las revisa solo.`, accion: "Conectar un flujo: cuando una tarea se traba, un manager averigua qué pasó", enlace: "#/automatizaciones" });
  }
  const hechas = semana.filter((t) => t.estado === "completa").length;
  if (hechas >= 5 && !hay("tarea_completada")) {
    out.push({ texto: `Se completaron ${hechas} tareas esta semana sin que nadie junte los resultados.`, accion: "Conectar un flujo que resuma cada resultado en la carpeta del proyecto", enlace: "#/automatizaciones" });
  }
  const sueltos = bots.filter((b) => b.cargo !== "manager" && !b.reportaA);
  if (bots.length >= 4 && sueltos.length >= 3 && !bots.some((b) => b.cargo === "manager")) {
    out.push({ texto: `Tenés ${bots.length} compañeros y ninguno coordina: el trabajo se reparte solo a mano.`, accion: "Armar un equipo con un manager (Gravity Architect)", enlace: "#/arquitecto" });
  }
  for (const b of bots) {
    const e = erroresDe(b);
    if (e.cantidad >= 5) out.push({ texto: `${b.nombre} se equivoca seguido con sus herramientas (${e.cantidad} errores recientes).`, accion: `Prender el modo enseñanza de ${b.nombre} para ver cada paso, o darle la habilidad «Aprender de errores»`, enlace: `#/chats/${b.id}/perfil` });
  }
  const gasto = gastoPorBotDesde(7);
  for (const b of bots) {
    const usd = gasto[b.id] ?? 0;
    if (usd >= 2 && b.modelo !== "rapido" && !b.topeDiarioUsd) out.push({ texto: `${b.nombre} gastó US$ ${usd.toFixed(2)} en 7 días con el modelo de siempre.`, accion: `Probar el modelo Rápido o ponerle un tope diario a ${b.nombre}`, enlace: `#/chats/${b.id}/perfil` });
  }
  for (const p of proyectos) {
    const sinResp = p.tareas.filter((t) => !t.asignadoA && t.estado === "pendiente").length;
    if (sinResp >= 3) out.push({ texto: `El proyecto «${p.nombre}» tiene ${sinResp} tareas sin responsable.`, accion: "Asignarlas en el proyecto", enlace: `#/proyectos/${p.id}` });
  }
  for (const r of rutinas) {
    const ult = r.ejecuciones.slice(-3);
    if (r.activa && ult.length === 3 && ult.every((x) => x.estado === "error")) out.push({ texto: `La rutina «${r.nombre}» falló sus últimas 3 veces.`, accion: "Revisar sus instrucciones o pausarla", enlace: `#/chats/${r.botId}/rutinas` });
  }
  const lider = bots.find((b) => b.cargo === "manager") ?? bots[0];
  if (!rutinas.length && lider && bots.length >= 2 && tareas.length >= 10) {
    out.push({ texto: "El equipo trabaja seguido pero no tiene rutinas: todo arranca cuando vos pedís.", accion: `Programarle a ${lider.nombre} un resumen diario o una revisión semanal`, enlace: `#/chats/${lider.id}/rutinas` });
  }
  return out.slice(0, 8);
}

export function conflictosDeArchivos(bots: Bot[], ventanaMin = 30): string[] {
  const nombre = (id: string) => bots.find((b) => b.id === id)?.nombre ?? "alguien";
  const porRuta = new Map<string, { botId: string; t: number }[]>();
  const desde = Date.now() - 24 * HORA;
  for (const r of leerActividad({ limite: 500 })) {
    if (r.tipo !== "herramienta" || !r.ok) continue;
    const m = /^(?:Escribiendo|Editando) (.+)$/.exec(r.que);
    const t = Date.parse(r.fecha);
    if (!m || t < desde) continue;
    const ruta = m[1]!.trim();
    porRuta.set(ruta, [...(porRuta.get(ruta) ?? []), { botId: r.botId, t }]);
  }
  const salida: string[] = [];
  for (const [ruta, xs] of porRuta) {
    xs.sort((a, b) => a.t - b.t);
    for (let i = 1; i < xs.length; i++) {
      const a = xs[i - 1]!, b = xs[i]!;
      if (a.botId !== b.botId && b.t - a.t < ventanaMin * 60_000) {
        salida.push(`Posible conflicto en ${ruta}: ${nombre(a.botId)} y ${nombre(b.botId)} lo cambiaron con ${Math.max(1, Math.round((b.t - a.t) / 60_000))} min de diferencia. Revisá sus versiones (Computadora o Gravity Code > Cambios).`);
        break;
      }
    }
  }
  return salida.slice(0, 10);
}

/** El informe como texto, para pasárselo a un compañero que lo analice. */
export function informeComoTexto(i: Informe): string {
  const n = { alto: "ALTO", medio: "MEDIO", info: "INFO" };
  return [
    `[Auditoría de Gravity · ${i.fecha.slice(0, 16).replace("T", " ")}] Revisé ${i.revisados.compañeros} compañeros, ${i.revisados.tareas} tareas, ${i.revisados.proyectos} proyectos activos y ${i.revisados.rutinas} rutinas.`,
    i.hallazgos.length ? i.hallazgos.map((x) => `- [${n[x.nivel]}] (${x.area}) ${x.texto}`).join("\n") : "Sin hallazgos.",
    ...(i.sugerencias.length ? [`Sugerencias:\n${i.sugerencias.map((x) => `- ${x.texto} → ${x.accion}`).join("\n")}`] : []),
    "Analizá este informe: qué es urgente, la causa probable de cada problema y qué propondrías cambiar (permisos, tareas, rutinas). No cambies nada sin preguntarme.",
  ].join("\n\n");
}
