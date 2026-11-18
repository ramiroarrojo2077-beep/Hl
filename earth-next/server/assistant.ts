/**
 * Asistente geográfico con Claude (Messages API + herramientas, bucle en el servidor).
 * Las conversaciones se guardan en memoria del servidor y se extienden siempre agregando
 * mensajes al final (nunca se reescriben), como requiere el razonamiento preservado del modelo.
 */
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { ACTION_TOOLS, SCHEMAS, TOOL_DEFINITIONS, runDataTool, type ToolName } from "./assistant-tools.ts";
import type { Source } from "./geodata.ts";

export const MODEL = process.env.EARTH_AI_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.EARTH_AI_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max";
const MAX_TURNS_PER_REQUEST = 12;
const MAX_CONVERSATION_MESSAGES = 160;
const CONVERSATION_TTL_MS = 2 * 3600_000;

let client: Anthropic | null = null;
export function aiAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

const SYSTEM_PROMPT = `Sos el asistente geográfico integrado en EARTH NEXT, un globo terráqueo 3D (CesiumJS) con terreno, edificios de OpenStreetMap, imágenes satelitales actuales e históricas, clima e iluminación astronómica.

Podés consultar datos con herramientas (geocode, elevation, measure, sun_and_moon, weather, wikipedia, ranking, nearby_places, web_search) y controlar el globo del usuario con herramientas de ACCIÓN (fly_to, view_from_space, set_scene_time, set_layers, compare_imagery, show_markers, draw_path, play_tour, set_navigation_mode, open_street_level, weather_layers, narrate). Las acciones se ejecutan en el navegador del usuario en el orden en que las llamás.

Reglas:
- Nunca inventes coordenadas, alturas, distancias, fechas ni datos geográficos. Obtenelos con herramientas. Si no hay datos suficientes, decilo claramente y sugerí qué se podría consultar.
- Para ir a un lugar nombrado, primero usá geocode y luego fly_to con las coordenadas obtenidas.
- Para distancias usá measure (geodesia WGS84) y, si ayuda, draw_path para mostrarla.
- Distinguí siempre la naturaleza del dato: observado (estaciones, radar, satélite), modelo/pronóstico (Open-Meteo) o efecto visual simulado.
- Las imágenes históricas son archivos reales (Esri Wayback, Landsat, MODIS, Sentinel-2). No existen imágenes de antes de 1984 en la app; si te piden reconstrucciones del pasado remoto, aclará que serían hipotéticas.
- No afirmes que existen imágenes en tiempo real, modelos 3D detallados o panorámicas donde no lo sabés.
- Explicaciones geológicas: apoyate en wikipedia o web_search y citá la fuente.
- La "vista actual" del usuario viene en el bloque [Contexto] de cada mensaje.
- Respondé en el idioma del usuario, de forma breve y clara (2–6 oraciones salvo que pidan detalle). Usá unidades métricas salvo que pidan otras. Las horas de sun_and_moon vienen en UTC: convertilas a hora local del lugar.
- Al final, no hace falta listar fuentes: la interfaz muestra automáticamente las fuentes de las herramientas que usaste.`;

const SERVER_TOOLS: Anthropic.Beta.BetaToolUnion[] = [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }];

interface Conversation {
  messages: Anthropic.Beta.BetaMessageParam[];
  updated: number;
}

const conversations = new Map<string, Conversation>();

function prune() {
  const now = Date.now();
  for (const [id, c] of conversations) if (now - c.updated > CONVERSATION_TTL_MS) conversations.delete(id);
  while (conversations.size > 500) conversations.delete(conversations.keys().next().value!);
}

export interface AssistantContext {
  lang: string;
  camera?: { lat: number; lon: number; height: number; heading: number; pitch: number };
  view?: { west: number; south: number; east: number; north: number };
  selection?: { title: string; lat: number; lon: number } | null;
  sceneTime?: string;
  layers?: string[];
}

export type Emit = (event: "text" | "action" | "status" | "sources" | "done" | "error" | "conversation", data: unknown) => void;

function contextText(ctx: AssistantContext): string {
  const parts: string[] = [];
  if (ctx.camera) parts.push(`cámara: lat ${ctx.camera.lat.toFixed(5)}, lon ${ctx.camera.lon.toFixed(5)}, altura ${Math.round(ctx.camera.height)} m, rumbo ${Math.round(ctx.camera.heading)}°, cabeceo ${Math.round(ctx.camera.pitch)}°`);
  if (ctx.view) parts.push(`vista visible aprox.: O ${ctx.view.west.toFixed(3)}, S ${ctx.view.south.toFixed(3)}, E ${ctx.view.east.toFixed(3)}, N ${ctx.view.north.toFixed(3)}`);
  if (ctx.selection) parts.push(`elemento seleccionado: "${ctx.selection.title}" en ${ctx.selection.lat.toFixed(5)}, ${ctx.selection.lon.toFixed(5)}`);
  if (ctx.sceneTime) parts.push(`hora de la escena (UTC): ${ctx.sceneTime}`);
  if (ctx.layers?.length) parts.push(`capas activas: ${ctx.layers.join(", ")}`);
  parts.push(`idioma de la interfaz: ${ctx.lang}`);
  return `[Contexto]\n${parts.join("\n")}`;
}

/** Extrae fuentes citadas por la búsqueda web en los bloques de texto. */
function citationSources(content: Anthropic.Beta.BetaContentBlock[]): Source[] {
  const out: Source[] = [];
  for (const b of content) {
    if (b.type !== "text" || !b.citations) continue;
    for (const c of b.citations) {
      if (c.type === "web_search_result_location") out.push({ name: c.title ?? c.url, url: c.url });
    }
  }
  return out;
}

export async function runAssistant(params: { conversationId?: string; message: string; context: AssistantContext; emit: Emit; signal: AbortSignal }): Promise<void> {
  prune();
  const { emit, signal } = params;
  let id = params.conversationId && conversations.has(params.conversationId) ? params.conversationId : undefined;
  if (!id) {
    id = randomUUID();
    conversations.set(id, { messages: [], updated: Date.now() });
  }
  const convo = conversations.get(id)!;
  if (convo.messages.length > MAX_CONVERSATION_MESSAGES) {
    id = randomUUID();
    conversations.set(id, { messages: [], updated: Date.now() });
    emit("status", { message: "La conversación era muy larga: se inició una nueva." });
  }
  const conv = conversations.get(id)!;
  emit("conversation", { id });

  conv.messages.push({
    role: "user",
    content: [
      { type: "text", text: contextText(params.context) },
      { type: "text", text: params.message.slice(0, 4000) },
    ],
  });

  const sources: Source[] = [];
  const anthropic = getClient();
  let jsonRetries = 0;

  for (let turn = 0; turn < MAX_TURNS_PER_REQUEST; turn++) {
    if (signal.aborted) return;
    const stream = anthropic.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 16000,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: [...TOOL_DEFINITIONS, ...SERVER_TOOLS],
        messages: conv.messages,
        output_config: { effort: EFFORT },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { signal },
    );
    stream.on("text", (delta) => emit("text", { delta }));

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
      emit("status", { message: "Reintentando…" });
      continue;
    }

    conv.updated = Date.now();
    sources.push(...citationSources(message.content));

    if (message.stop_reason === "refusal") {
      conv.messages.push({ role: "assistant", content: message.content });
      emit("error", { message: "El modelo no pudo responder a este pedido." });
      break;
    }
    if (message.stop_reason === "pause_turn") {
      conv.messages.push({ role: "assistant", content: message.content });
      continue;
    }

    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    conv.messages.push({ role: "assistant", content: message.content });
    if (toolUses.length === 0 || message.stop_reason === "end_turn") break;
    if (message.stop_reason === "max_tokens") {
      // Entrada de herramienta posiblemente truncada: no se ejecuta.
      conv.messages.push({
        role: "user",
        content: toolUses.map((t) => ({ type: "tool_result" as const, tool_use_id: t.id, is_error: true, content: "Entrada truncada (max_tokens); repetí la llamada con menos datos." })),
      });
      continue;
    }

    // Ejecuta todas las herramientas del turno; los resultados vuelven en un único mensaje.
    const results = await Promise.all(
      toolUses.map(async (t): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const name = t.name as ToolName;
        const schema = SCHEMAS[name];
        if (!schema) return { type: "tool_result", tool_use_id: t.id, is_error: true, content: `Herramienta desconocida: ${t.name}` };
        const parsed = schema.safeParse(t.input);
        if (!parsed.success) {
          return { type: "tool_result", tool_use_id: t.id, is_error: true, content: `Entrada inválida: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
        }
        if (ACTION_TOOLS.has(name)) {
          emit("action", { tool: name, input: parsed.data });
          return { type: "tool_result", tool_use_id: t.id, content: "Acción enviada al globo del usuario." };
        }
        emit("status", { message: statusLabel(name) });
        try {
          const r = await runDataTool(name, parsed.data, { lang: params.context.lang, sceneTime: params.context.sceneTime });
          sources.push(...r.sources);
          return { type: "tool_result", tool_use_id: t.id, content: r.content.slice(0, 30000), is_error: r.isError };
        } catch (err) {
          return { type: "tool_result", tool_use_id: t.id, is_error: true, content: `Error al consultar: ${err instanceof Error ? err.message : String(err)}` };
        }
      }),
    );
    conv.messages.push({ role: "user", content: results });
  }

  const unique = [...new Map(sources.map((s) => [`${s.name}|${s.url ?? ""}`, s])).values()];
  emit("sources", { sources: unique });
  emit("done", { conversationId: id });
}

function statusLabel(name: ToolName): string {
  const labels: Partial<Record<ToolName, string>> = {
    geocode: "Buscando el lugar…",
    reverse_geocode: "Identificando la ubicación…",
    elevation: "Consultando elevaciones…",
    measure: "Calculando distancias…",
    sun_and_moon: "Calculando posición del Sol y la Luna…",
    weather: "Consultando modelos meteorológicos…",
    wikipedia: "Leyendo Wikipedia…",
    ranking: "Consultando Wikidata…",
    nearby_places: "Buscando lugares en OpenStreetMap…",
  };
  return labels[name] ?? "Consultando…";
}
