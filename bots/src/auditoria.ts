// Auditor: revisa permisos, errores de herramientas y resultados (tareas, proyectos, rutinas y
// aprobaciones) con los datos reales del motor. No cambia nada: arma un informe que el usuario lee
// o le pasa a un compañero para que lo analice.

import { ajustes, conversacion, listarBots, listarReglas, listarRutinas, listarTareas, TERMINALES, type Bot } from "./almacen.ts";
import { listarAprobaciones } from "./agente.ts";
import { normalizarBloqueadas } from "./herramientas.ts";
import { listarProyectos, progreso } from "./proyectos.ts";

export type Nivel = "alto" | "medio" | "info";
export interface Hallazgo {
  nivel: Nivel;
  area: "permisos" | "errores" | "tareas" | "proyectos" | "rutinas" | "aprobaciones";
  texto: string;
  botId?: string;
}
export interface Informe {
  fecha: string;
  revisados: { compañeros: number; tareas: number; proyectos: number; rutinas: number };
  hallazgos: Hallazgo[];
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

  // Aprobaciones
  for (const a of listarAprobaciones()) {
    if (ahoraMs - Date.parse(a.creada) > HORA) h.push({ nivel: "medio", area: "aprobaciones", botId: a.botId, texto: `${nombre(a.botId)} espera tu aprobación hace más de una hora: ${a.titulo}.` });
  }

  h.sort((x, y) => ORDEN[x.nivel] - ORDEN[y.nivel]);
  return { fecha: new Date().toISOString(), revisados: { compañeros: bots.length, tareas: tareas.length, proyectos: proyectos.length, rutinas: rutinas.length }, hallazgos: h };
}

/** El informe como texto, para pasárselo a un compañero que lo analice. */
export function informeComoTexto(i: Informe): string {
  const n = { alto: "ALTO", medio: "MEDIO", info: "INFO" };
  return [
    `[Auditoría de Gravity · ${i.fecha.slice(0, 16).replace("T", " ")}] Revisé ${i.revisados.compañeros} compañeros, ${i.revisados.tareas} tareas, ${i.revisados.proyectos} proyectos activos y ${i.revisados.rutinas} rutinas.`,
    i.hallazgos.length ? i.hallazgos.map((x) => `- [${n[x.nivel]}] (${x.area}) ${x.texto}`).join("\n") : "Sin hallazgos.",
    "Analizá este informe: qué es urgente, la causa probable de cada problema y qué propondrías cambiar (permisos, tareas, rutinas). No cambies nada sin preguntarme.",
  ].join("\n\n");
}
