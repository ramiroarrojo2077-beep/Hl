import type Anthropic from "@anthropic-ai/sdk";
import type { Conversacion, Origen } from "./almacen.ts";

// Lo que la interfaz muestra de una conversación, derivado del historial que se manda a la API.
export type Item =
  | { tipo: "usuario"; texto: string; fecha: string | null }
  | { tipo: "origen"; clase: Origen["tipo"]; etiqueta: string; detalle: string; texto: string; fecha: string }
  | { tipo: "bot"; texto: string }
  | { tipo: "nota"; texto: string }
  | { tipo: "accion"; herramienta: string; texto: string; detalle: string | null; error: boolean }
  | { tipo: "aviso"; texto: string; error: boolean; fecha: string | null };

const MAX_ITEMS = 400;
const MAX_DETALLE = 4000;

const recortar = (s: string) => (s.length > MAX_DETALLE ? `${s.slice(0, MAX_DETALLE)}\n…` : s);

function textoDeResultado(content: Anthropic.Beta.BetaToolResultBlockParam["content"]): string {
  if (typeof content === "string") return content;
  return (content ?? []).map((b) => (b.type === "text" ? b.text : `[${b.type}]`)).join("\n");
}

function describir(nombre: string, e: Record<string, unknown>): string {
  const s = (k: string) => String(e[k] ?? "");
  switch (nombre) {
    case "bash":
      return e.command ? s("command") : "Reinició la terminal";
    case "read":
      return `Leyó ${s("file_path")}`;
    case "write":
      return `Escribió ${s("file_path")}`;
    case "edit":
      return `Editó ${s("file_path")}`;
    case "glob":
      return `Buscó archivos ${s("pattern")}`;
    case "grep":
      return `Buscó «${s("pattern")}» en los archivos`;
    case "memory": {
      const ruta = s("path") || s("old_path");
      if (e.command === "view") return "Revisó su memoria";
      if (e.command === "delete") return `Borró de su memoria ${ruta}`;
      return `Guardó en su memoria ${ruta}`;
    }
    case "rutinas": {
      const verbos: Record<string, string> = { listar: "Revisó sus rutinas", crear: "Creó la rutina", modificar: "Modificó la rutina", borrar: "Borró la rutina" };
      return `${verbos[s("accion")] ?? "Rutinas"}${e.nombre ? ` «${s("nombre")}»` : ""}`;
    }
    case "habilidades": {
      const verbos: Record<string, string> = { listar: "Revisó las habilidades", leer: "Leyó la habilidad", guardar: "Guardó la habilidad" };
      return `${verbos[s("accion")] ?? "Habilidades"}${e.nombre ? ` «${s("nombre")}»` : ""}`;
    }
    case "delegar": {
      const encargos = Array.isArray(e.encargos) ? (e.encargos as { para?: string }[]) : [];
      return `Repartió «${s("trabajo")}» en ${encargos.length} encargo(s): ${encargos.map((x) => x.para ?? "?").join(", ")}`;
    }
    case "tareas":
      return e.accion === "cancelar" ? `Canceló la tarea ${s("id")}` : "Revisó las tareas";
    case "entregar":
      return `Entregó la tarea ${s("tarea_id")} (${s("estado")})`;
    case "reunion":
      return `${e.accion === "programar" ? "Programó" : "Convocó"} la reunión «${s("titulo")}»`;
    case "conexion":
      return `${s("conexion")} · ${s("accion")}`;
    case "mensajes": {
      // La clave es "paquete|conversación": se muestra solo la conversación.
      const donde = s("clave").split("|").slice(1).join("|");
      const verbos: Record<string, string> = { listar: "Revisó sus conversaciones", leer: "Leyó", enviar: "Escribió en", derivar: "Te pasó" };
      return `${verbos[s("accion")] ?? "Mensajes"}${donde ? ` «${donde}»` : ""}`;
    }
    default:
      return nombre;
  }
}

const MARCA = /^\[(\d{4}-\d\d-\d\d \d\d:\d\d)\] /;

export function vistaConversacion(c: Conversacion): Item[] {
  const resultados = new Map<string, { texto: string; error: boolean }>();
  const busquedas = new Map<string, string>();
  for (const m of c.mensajes) {
    if (typeof m.content === "string") continue;
    for (const b of m.content) {
      if (b.type === "tool_result") resultados.set(b.tool_use_id, { texto: textoDeResultado(b.content), error: !!b.is_error });
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        busquedas.set(b.tool_use_id, b.content.map((r) => `${r.title} — ${r.url}`).join("\n"));
      }
    }
  }
  const origenes = new Map(c.origenes.map((o) => [o.indice, o]));

  const items: Item[] = [];
  const notas = [...c.notas];
  const volcarNotas = (hasta: number) => {
    while (notas.length && notas[0]!.despuesDe <= hasta) {
      const n = notas.shift()!;
      items.push({ tipo: "aviso", texto: n.texto, error: n.tipo === "error", fecha: n.fecha });
    }
  };

  c.mensajes.forEach((m, i) => {
    volcarNotas(i);
    // Los mensajes de sistema son del arnés para el bot: no se muestran.
    if (m.role === "system") return;
    const bloques = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
    for (const b of bloques) {
      if (b.type === "text" && b.text.trim()) {
        if (m.role === "assistant") {
          items.push({ tipo: "bot", texto: b.text });
          continue;
        }
        const marca = MARCA.exec(b.text);
        const texto = marca ? b.text.slice(marca[0].length) : b.text;
        const origen = origenes.get(i);
        if (origen) items.push({ tipo: "origen", clase: origen.tipo, etiqueta: origen.etiqueta, detalle: origen.detalle, texto, fecha: marca?.[1] ?? origen.fecha });
        else items.push({ tipo: "usuario", texto, fecha: marca?.[1] ?? null });
      } else if (b.type === "thinking" && b.thinking.trim()) {
        items.push({ tipo: "nota", texto: b.thinking.trim() });
      } else if (b.type === "tool_use") {
        const r = resultados.get(b.id);
        items.push({
          tipo: "accion",
          herramienta: b.name,
          texto: describir(b.name, b.input as Record<string, unknown>),
          detalle: r && (b.name === "bash" || b.name === "delegar" || b.name === "conexion" || b.name === "mensajes" || r.error) ? recortar(r.texto) : null,
          error: r?.error ?? false,
        });
      } else if (b.type === "server_tool_use") {
        const e = b.input as { query?: string; url?: string };
        items.push({
          tipo: "accion",
          herramienta: b.name,
          texto: e.query ? `Buscó en la web: ${e.query}` : e.url ? `Leyó ${e.url}` : b.name,
          detalle: busquedas.get(b.id) ?? null,
          error: false,
        });
      } else if (b.type === "compaction") {
        items.push({ tipo: "aviso", texto: "Se resumió la conversación anterior para liberar contexto.", error: false, fecha: null });
      }
    }
  });
  volcarNotas(Infinity);
  return items.slice(-MAX_ITEMS);
}
