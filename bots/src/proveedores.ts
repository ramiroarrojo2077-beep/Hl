// Modelos gratis detrás de la misma interfaz que usa todo el motor (la API de mensajes de Anthropic).
//
// Si no hay clave de Anthropic, el cliente recibe este fetch: traduce cada pedido a /v1/messages
// al proveedor que haya y la respuesta de vuelta, así el resto del código no cambia. Cadena:
//   1. Google Gemini (clave gratis de aistudio.google.com): Flash y, cuando se agota su cupo, Flash-Lite.
//   2. Respaldo: OpenRouter (clave gratis) con el mejor modelo gratuito que acepte herramientas.
// Si uno se queda sin cupo o falla, se pasa al siguiente sin cortar la conversación.

import { randomBytes } from "node:crypto";

type Json = Record<string, unknown>;

const GEMINI_BASE = (process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
const OPENROUTER_BASE = (process.env.OPENROUTER_API_BASE ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
const CLAVE_GEMINI = process.env.GEMINI_API_KEY ?? "";
const CLAVE_OPENROUTER = process.env.OPENROUTER_API_KEY ?? "";
// "-latest" apunta siempre al último Flash de Google; Flash-Lite tiene un cupo diario aparte y más grande.
const MODELOS_GEMINI = (process.env.GRAVITY_GEMINI_MODELOS ?? "gemini-flash-latest,gemini-flash-lite-latest")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const MODELO_RESPALDO = process.env.GRAVITY_RESPALDO_MODELO ?? "";
const ESPERA_RED_MS = 120_000;

export const hayGemini = !!CLAVE_GEMINI;
export const hayRespaldo = !!CLAVE_OPENROUTER;

/** Para mostrar en la interfaz. */
export function describirProveedor(): string {
  const partes = [];
  if (hayGemini) partes.push(`Google Gemini (${MODELOS_GEMINI.join(", ")})`);
  if (hayRespaldo) partes.push(`respaldo gratis de OpenRouter${MODELO_RESPALDO ? ` (${MODELO_RESPALDO})` : ""}`);
  return partes.join(" + ") || "sin proveedor";
}

// ---------------------------------------------------------------- Forma neutra del pedido

interface Imagen {
  mime: string;
  datos: string;
}

interface Resultado {
  id: string;
  nombre: string;
  texto: string;
  error: boolean;
  imagenes: Imagen[];
}

type Turno =
  | { rol: "usuario"; textos: string[]; imagenes: Imagen[]; resultados: Resultado[] }
  | { rol: "modelo"; texto: string; llamadas: { id: string; nombre: string; entrada: Json }[] };

interface Herramienta {
  nombre: string;
  descripcion: string;
  esquema: Json;
}

interface Pedido {
  sistema: string;
  turnos: Turno[];
  herramientas: Herramienta[];
  esquemaSalida: Json | null;
  maxTokens: number;
}

interface Respuesta {
  bloques: Json[];
  fin: "end_turn" | "tool_use" | "max_tokens" | "refusal";
  entrada: number;
  salida: number;
  modelo: string;
}

class ErrorProveedor extends Error {
  readonly status: number;
  /** Segundos que pide esperar el proveedor, si dijo. */
  readonly esperar: number | null;
  /** Se agotó el cupo (del día o del minuto): conviene pasar al siguiente. */
  readonly sinCupo: boolean;
  constructor(status: number, mensaje: string, esperar: number | null = null, sinCupo = false) {
    super(mensaje);
    this.status = status;
    this.esperar = esperar;
    this.sinCupo = sinCupo;
  }
}

const nuevoId = (prefijo: string) => `${prefijo}${randomBytes(12).toString("hex")}`;

const textoDeBloques = (contenido: unknown): string => {
  if (typeof contenido === "string") return contenido;
  if (!Array.isArray(contenido)) return "";
  return contenido
    .map((b: Json) => (b.type === "text" ? String(b.text ?? "") : ""))
    .filter(Boolean)
    .join("\n");
};

const imagenesDe = (contenido: unknown): Imagen[] =>
  Array.isArray(contenido)
    ? contenido
        .filter((b: Json) => b.type === "image" && (b.source as Json)?.type === "base64")
        .map((b: Json) => ({ mime: String((b.source as Json).media_type), datos: String((b.source as Json).data) }))
    : [];

// Esquema de la herramienta de memoria, que en la API de Anthropic viene incorporado.
const ESQUEMA_MEMORIA: Json = {
  type: "object",
  properties: {
    command: { type: "string", enum: ["view", "create", "str_replace", "insert", "delete", "rename"] },
    path: { type: "string", description: "Ruta dentro de /memories (view, create, str_replace, insert, delete)" },
    file_text: { type: "string", description: "create: contenido completo del archivo" },
    old_str: { type: "string", description: "str_replace: texto exacto a reemplazar" },
    new_str: { type: "string", description: "str_replace: texto nuevo" },
    insert_line: { type: "integer", description: "insert: número de línea después de la cual insertar" },
    insert_text: { type: "string", description: "insert: texto a insertar" },
    view_range: { type: "array", items: { type: "integer" }, description: "view: [desde, hasta], opcional" },
    old_path: { type: "string", description: "rename: ruta actual" },
    new_path: { type: "string", description: "rename: ruta nueva" },
  },
  required: ["command"],
};

const DESCRIPCION_MEMORIA =
  "Tu memoria persistente: archivos en /memories que sobreviven entre conversaciones. Miralos (view /memories) antes de empezar algo y guardá lo que aprendas. Comandos: view, create, str_replace, insert, delete, rename.";

/** Traduce el cuerpo de un pedido a /v1/messages a la forma neutra. */
function traducirPedido(cuerpo: Json): Pedido {
  const sistema = typeof cuerpo.system === "string" ? cuerpo.system : textoDeBloques(cuerpo.system);
  let mensajes = (cuerpo.messages as Json[]) ?? [];

  // Con compactación, lo anterior al último resumen ya no cuenta: se arranca desde ahí.
  let resumen = "";
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const c = mensajes[i]!.content;
    const bloque = Array.isArray(c) ? c.find((b: Json) => b.type === "compaction") : undefined;
    if (bloque) {
      resumen = String((bloque as Json).content ?? "");
      mensajes = mensajes.slice(i);
      break;
    }
  }

  const turnos: Turno[] = [];
  const nombres = new Map<string, string>();
  const usuario = () => {
    const ultimo = turnos.at(-1);
    if (ultimo?.rol === "usuario") return ultimo;
    const nuevo: Turno = { rol: "usuario", textos: [], imagenes: [], resultados: [] };
    turnos.push(nuevo);
    return nuevo;
  };
  if (resumen) usuario().textos.push(`[Resumen de la conversación anterior]\n${resumen}`);

  for (const m of mensajes) {
    const contenido = m.content;
    if (m.role === "system") {
      const texto = textoDeBloques(contenido);
      if (texto) usuario().textos.push(`<aviso_del_sistema>\n${texto}\n</aviso_del_sistema>`);
      continue;
    }
    if (m.role === "user") {
      const u = usuario();
      if (typeof contenido === "string") {
        u.textos.push(contenido);
        continue;
      }
      for (const b of (contenido as Json[]) ?? []) {
        if (b.type === "text") u.textos.push(String(b.text ?? ""));
        else if (b.type === "image") u.imagenes.push(...imagenesDe([b]));
        else if (b.type === "tool_result") {
          const id = String(b.tool_use_id);
          const nombre = nombres.get(id);
          const texto = textoDeBloques(b.content) || (b.is_error ? "Error." : "(sin salida)");
          // Un resultado sin su llamada (cortada por un resumen) pasa como texto.
          if (!nombre) u.textos.push(`[Resultado de herramienta]\n${texto}`);
          else u.resultados.push({ id, nombre, texto, error: !!b.is_error, imagenes: imagenesDe(b.content) });
        } else if (b.type === "document") u.textos.push("[Documento adjunto omitido]");
      }
      continue;
    }
    // assistant
    const modelo: Turno = { rol: "modelo", texto: "", llamadas: [] };
    const textos: string[] = [];
    for (const b of typeof contenido === "string" ? [{ type: "text", text: contenido }] : ((contenido as Json[]) ?? [])) {
      if (b.type === "text") textos.push(String(b.text ?? ""));
      else if (b.type === "tool_use") {
        const id = String(b.id);
        nombres.set(id, String(b.name));
        modelo.llamadas.push({ id, nombre: String(b.name), entrada: (b.input as Json) ?? {} });
      } else if (b.type === "server_tool_use") {
        const e = (b.input as Json) ?? {};
        textos.push(e.query ? `[Busqué en la web: ${e.query}]` : e.url ? `[Leí ${e.url}]` : "");
      } else if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        const vistos = (b.content as Json[]).filter((r) => r.url).map((r) => `- ${r.title ?? ""} ${r.url}`);
        if (vistos.length) textos.push(`[Resultados]\n${vistos.join("\n")}`);
      }
      // thinking, redacted_thinking, compaction y demás: no se reenvían.
    }
    modelo.texto = textos.filter(Boolean).join("\n\n");
    if (modelo.texto || modelo.llamadas.length) turnos.push(modelo);
  }

  // Cada llamada tiene que tener su resultado en el turno siguiente.
  for (let i = 0; i < turnos.length; i++) {
    const t = turnos[i]!;
    if (t.rol !== "modelo" || !t.llamadas.length) continue;
    let siguiente = turnos[i + 1];
    if (siguiente?.rol !== "usuario") {
      siguiente = { rol: "usuario", textos: [], imagenes: [], resultados: [] };
      turnos.splice(i + 1, 0, siguiente);
    }
    for (const l of t.llamadas) {
      if (!siguiente.resultados.some((r) => r.id === l.id)) {
        siguiente.resultados.push({ id: l.id, nombre: l.nombre, texto: "Sin resultado (se interrumpió).", error: true, imagenes: [] });
      }
    }
  }
  if (turnos[0]?.rol !== "usuario") turnos.unshift({ rol: "usuario", textos: ["(Seguimos.)"], imagenes: [], resultados: [] });

  const herramientas: Herramienta[] = [];
  for (const h of (cuerpo.tools as Json[]) ?? []) {
    const tipo = String(h.type ?? "custom");
    if (tipo === "custom" || (h.input_schema && !tipo.includes("_20"))) {
      herramientas.push({ nombre: String(h.name), descripcion: String(h.description ?? ""), esquema: (h.input_schema as Json) ?? { type: "object" } });
    } else if (tipo.startsWith("memory_")) {
      herramientas.push({ nombre: String(h.name ?? "memory"), descripcion: DESCRIPCION_MEMORIA, esquema: ESQUEMA_MEMORIA });
    }
    // Las herramientas del servidor de Anthropic (web_search, web_fetch) no existen acá: el motor
    // agrega sus propias versiones cuando no hay clave de Anthropic.
  }

  const formato = (cuerpo.output_config as Json | undefined)?.format as Json | undefined;
  return {
    sistema,
    turnos,
    herramientas,
    esquemaSalida: formato?.type === "json_schema" ? ((formato.schema as Json) ?? null) : null,
    maxTokens: Number(cuerpo.max_tokens ?? 8192),
  };
}

/** Saca del esquema lo que solo entiende Anthropic. */
function limpiarEsquema(esquema: unknown): unknown {
  if (Array.isArray(esquema)) return esquema.map(limpiarEsquema);
  if (!esquema || typeof esquema !== "object") return esquema;
  const salida: Json = {};
  for (const [k, v] of Object.entries(esquema as Json)) {
    if (k === "$schema" || k === "strict" || k === "eager_input_streaming") continue;
    salida[k] = limpiarEsquema(v);
  }
  return salida;
}

// ---------------------------------------------------------------- Google Gemini

/** Firmas de razonamiento de Gemini: hay que devolverlas con cada llamada a herramienta del turno. */
const firmas = new Map<string, string>();
const FIRMA_COMODIN = "skip_thought_signature_validator";

function recordarFirma(id: string, firma: string): void {
  firmas.set(id, firma);
  if (firmas.size > 5000) firmas.delete(firmas.keys().next().value!);
}

async function pedirGemini(p: Pedido, modelo: string, signal?: AbortSignal | null): Promise<Respuesta> {
  const contents = p.turnos.map((t) => {
    if (t.rol === "modelo") {
      const parts: Json[] = [];
      if (t.texto) parts.push({ text: t.texto });
      t.llamadas.forEach((l, i) => {
        const firma = firmas.get(l.id) ?? (i === 0 ? FIRMA_COMODIN : undefined);
        parts.push({ functionCall: { name: l.nombre, args: l.entrada }, ...(firma ? { thoughtSignature: firma } : {}) });
      });
      return { role: "model", parts };
    }
    const parts: Json[] = [
      ...t.resultados.map((r) => ({ functionResponse: { name: r.nombre, response: r.error ? { error: r.texto } : { output: r.texto } } })),
      ...t.resultados.flatMap((r) => r.imagenes).map((i) => ({ inlineData: { mimeType: i.mime, data: i.datos } })),
      ...t.textos.filter(Boolean).map((text) => ({ text })),
      ...t.imagenes.map((i) => ({ inlineData: { mimeType: i.mime, data: i.datos } })),
    ];
    return { role: "user", parts: parts.length ? parts : [{ text: "(Seguí.)" }] };
  });

  const cuerpo: Json = {
    contents,
    generationConfig: {
      maxOutputTokens: Math.min(p.maxTokens, 65_536),
      thinkingConfig: { includeThoughts: true },
      ...(p.esquemaSalida ? { responseMimeType: "application/json", responseJsonSchema: limpiarEsquema(p.esquemaSalida) } : {}),
    },
  };
  if (p.sistema) cuerpo.systemInstruction = { parts: [{ text: p.sistema }] };
  if (p.herramientas.length) {
    cuerpo.tools = [
      {
        functionDeclarations: p.herramientas.map((h) => ({
          name: h.nombre,
          description: h.descripcion,
          parametersJsonSchema: limpiarEsquema(h.esquema),
        })),
      },
    ];
  }

  const datos = await postJson(`${GEMINI_BASE}/models/${encodeURIComponent(modelo)}:generateContent`, cuerpo, { "x-goog-api-key": CLAVE_GEMINI }, signal, errorGemini);

  const candidato = (datos.candidates as Json[] | undefined)?.[0];
  const uso = (datos.usageMetadata as Json) ?? {};
  const entrada = Number(uso.promptTokenCount ?? 0);
  const salida = Number(uso.candidatesTokenCount ?? 0) + Number(uso.thoughtsTokenCount ?? 0);
  const version = String(datos.modelVersion ?? modelo);
  if (!candidato) {
    const motivo = (datos.promptFeedback as Json | undefined)?.blockReason;
    if (motivo) return { bloques: [], fin: "refusal", entrada, salida, modelo: version };
    throw new ErrorProveedor(502, "Gemini no devolvió respuesta.");
  }

  const bloques: Json[] = [];
  let pensamiento = "";
  let texto = "";
  const cerrarTexto = () => {
    if (texto) bloques.push({ type: "text", text: texto, citations: null });
    texto = "";
  };
  for (const parte of ((candidato.content as Json | undefined)?.parts as Json[]) ?? []) {
    if (parte.thought && typeof parte.text === "string") pensamiento += parte.text;
    else if (typeof parte.text === "string") texto += parte.text;
    else if (parte.functionCall) {
      cerrarTexto();
      const llamada = parte.functionCall as Json;
      const id = nuevoId("toolu_");
      if (typeof parte.thoughtSignature === "string") recordarFirma(id, parte.thoughtSignature);
      bloques.push({ type: "tool_use", id, name: String(llamada.name), input: (llamada.args as Json) ?? {} });
    }
  }
  cerrarTexto();
  if (pensamiento.trim()) bloques.unshift({ type: "thinking", thinking: pensamiento.trim(), signature: "" });

  const final = String(candidato.finishReason ?? "STOP");
  if (final === "MALFORMED_FUNCTION_CALL" || final === "UNEXPECTED_TOOL_CALL") {
    throw new ErrorProveedor(502, "Gemini armó mal una llamada a herramienta.");
  }
  const llamo = bloques.some((b) => b.type === "tool_use");
  const fin: Respuesta["fin"] = ["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY"].includes(final)
    ? "refusal"
    : final === "MAX_TOKENS"
      ? "max_tokens"
      : llamo
        ? "tool_use"
        : "end_turn";
  return { bloques, fin, entrada, salida, modelo: version };
}

function errorGemini(status: number, cuerpo: Json, cabeceras: Headers): ErrorProveedor {
  const e = (cuerpo.error as Json) ?? {};
  const mensaje = String(e.message ?? `Gemini respondió ${status}`);
  const detalles = JSON.stringify(e.details ?? "");
  if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(mensaje + detalles) || status === 401 || status === 403) {
    return new ErrorProveedor(401, "La clave de Gemini no es válida. Revisala en la app.");
  }
  if (status === 429) {
    const espera = /"retryDelay":"(\d+(?:\.\d+)?)s"/.exec(detalles)?.[1] ?? cabeceras.get("retry-after");
    return new ErrorProveedor(429, `Gemini: sin cupo por ahora. ${mensaje}`, espera ? Math.ceil(Number(espera)) : null, true);
  }
  if (status === 404) return new ErrorProveedor(404, `Gemini: el modelo no está disponible. ${mensaje}`, null, true);
  return new ErrorProveedor(status >= 500 ? 503 : status, `Gemini: ${mensaje}`);
}

/** Búsqueda web con Google (grounding de Gemini). Devuelve un resumen con las fuentes. */
export async function buscarConGoogle(consulta: string, signal?: AbortSignal | null): Promise<string> {
  if (!hayGemini) throw new Error("La búsqueda web necesita la clave de Gemini.");
  let ultimo: unknown;
  for (const modelo of MODELOS_GEMINI) {
    try {
      const datos = await postJson(
        `${GEMINI_BASE}/models/${encodeURIComponent(modelo)}:generateContent`,
        {
          contents: [{ role: "user", parts: [{ text: `Buscá en la web y resumí con datos concretos (cifras, fechas, nombres): ${consulta}` }] }],
          tools: [{ google_search: {} }],
        },
        { "x-goog-api-key": CLAVE_GEMINI },
        signal,
        errorGemini,
      );
      const candidato = (datos.candidates as Json[] | undefined)?.[0];
      const texto = (((candidato?.content as Json | undefined)?.parts as Json[]) ?? []).map((p) => (p.thought ? "" : String(p.text ?? ""))).join("");
      const fuentes = (((candidato?.groundingMetadata as Json | undefined)?.groundingChunks as Json[]) ?? [])
        .map((c) => c.web as Json | undefined)
        .filter((w): w is Json => !!w?.uri)
        .map((w) => `- ${w.title ?? ""}: ${w.uri}`);
      return `${texto.trim() || "Sin resultados."}${fuentes.length ? `\n\nFuentes:\n${fuentes.join("\n")}` : ""}`;
    } catch (err) {
      ultimo = err;
      if (!(err instanceof ErrorProveedor) || !err.sinCupo) throw err;
    }
  }
  throw ultimo instanceof Error ? ultimo : new Error("No se pudo buscar.");
}

// ---------------------------------------------------------------- OpenRouter (respaldo gratis)

let catalogo: { modelos: string[]; hasta: number } | null = null;

// Preferencias entre los modelos gratis, de mejor a peor para trabajar con herramientas.
const PREFERIDOS = [/deepseek.*(v3|r1|chat)/i, /qwen3.*(235b|max|coder)/i, /kimi-k2/i, /gpt-oss-120b/i, /glm-4\.[5-9]/i, /llama-4-maverick/i, /qwen3/i, /mistral/i, /gemma-3/i, /llama/i];

/** Los mejores modelos gratis de OpenRouter que aceptan herramientas, de mejor a peor. */
async function modelosGratis(signal?: AbortSignal | null): Promise<string[]> {
  if (MODELO_RESPALDO) return [MODELO_RESPALDO];
  if (catalogo && catalogo.hasta > Date.now()) return catalogo.modelos;
  try {
    const res = await fetch(`${OPENROUTER_BASE}/models`, { signal: signal ?? AbortSignal.timeout(20_000) });
    const datos = (await res.json()) as { data?: Json[] };
    const gratis = (datos.data ?? []).filter((m) => {
      const precio = (m.pricing as Json) ?? {};
      const cero = Number(precio.prompt ?? 1) === 0 && Number(precio.completion ?? 1) === 0;
      const herramientas = ((m.supported_parameters as string[]) ?? []).includes("tools");
      return cero && herramientas && Number(m.context_length ?? 0) >= 32_000;
    });
    const puntaje = (id: string) => {
      const i = PREFERIDOS.findIndex((r) => r.test(id));
      return i === -1 ? PREFERIDOS.length : i;
    };
    const modelos = gratis
      .sort((a, b) => puntaje(String(a.id)) - puntaje(String(b.id)) || Number(b.context_length ?? 0) - Number(a.context_length ?? 0))
      .map((m) => String(m.id))
      .slice(0, 4);
    if (modelos.length) catalogo = { modelos, hasta: Date.now() + 6 * 3600_000 };
    return modelos.length ? modelos : ["openrouter/auto"];
  } catch {
    return catalogo?.modelos ?? ["deepseek/deepseek-chat-v3.1:free"];
  }
}

async function pedirOpenRouter(p: Pedido, modelo: string, signal?: AbortSignal | null): Promise<Respuesta> {
  const messages: Json[] = [];
  if (p.sistema) messages.push({ role: "system", content: p.sistema });
  for (const t of p.turnos) {
    if (t.rol === "modelo") {
      messages.push({
        role: "assistant",
        content: t.texto || null,
        ...(t.llamadas.length
          ? { tool_calls: t.llamadas.map((l) => ({ id: l.id, type: "function", function: { name: l.nombre, arguments: JSON.stringify(l.entrada) } })) }
          : {}),
      });
      continue;
    }
    for (const r of t.resultados) messages.push({ role: "tool", tool_call_id: r.id, content: r.error ? `ERROR: ${r.texto}` : r.texto });
    const imagenes = [...t.resultados.flatMap((r) => r.imagenes), ...t.imagenes];
    const texto = t.textos.filter(Boolean).join("\n\n");
    if (imagenes.length) {
      messages.push({
        role: "user",
        content: [
          ...(texto ? [{ type: "text", text: texto }] : []),
          ...imagenes.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.datos}` } })),
        ],
      });
    } else if (texto) messages.push({ role: "user", content: texto });
  }

  const cuerpo: Json = { model: modelo, messages, max_tokens: Math.min(p.maxTokens, 16_000) };
  if (p.herramientas.length) {
    cuerpo.tools = p.herramientas.map((h) => ({ type: "function", function: { name: h.nombre, description: h.descripcion, parameters: limpiarEsquema(h.esquema) } }));
  }
  if (p.esquemaSalida) cuerpo.response_format = { type: "json_schema", json_schema: { name: "salida", schema: limpiarEsquema(p.esquemaSalida) } };

  const datos = await postJson(
    `${OPENROUTER_BASE}/chat/completions`,
    cuerpo,
    { authorization: `Bearer ${CLAVE_OPENROUTER}`, "x-title": "Gravity" },
    signal,
    errorOpenRouter,
  );
  if (datos.error) throw errorOpenRouter(Number((datos.error as Json).code ?? 502), datos, new Headers());
  const eleccion = (datos.choices as Json[] | undefined)?.[0];
  const mensaje = (eleccion?.message as Json) ?? {};
  const uso = (datos.usage as Json) ?? {};
  const bloques: Json[] = [];
  const razonamiento = String(mensaje.reasoning ?? mensaje.reasoning_content ?? "").trim();
  if (razonamiento) bloques.push({ type: "thinking", thinking: razonamiento, signature: "" });
  let texto = typeof mensaje.content === "string" ? mensaje.content : textoDeBloques(mensaje.content);
  // Algunos modelos dejan el JSON pedido entre ```json … ```.
  if (p.esquemaSalida) texto = texto.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
  if (texto.trim()) bloques.push({ type: "text", text: texto, citations: null });
  for (const l of (mensaje.tool_calls as Json[]) ?? []) {
    const f = (l.function as Json) ?? {};
    let entrada: Json;
    try {
      entrada = f.arguments ? (JSON.parse(String(f.arguments)) as Json) : {};
    } catch {
      throw new ErrorProveedor(502, `El modelo ${modelo} armó mal una llamada a herramienta.`);
    }
    bloques.push({ type: "tool_use", id: nuevoId("toolu_"), name: String(f.name), input: entrada });
  }
  const final = String(eleccion?.finish_reason ?? "stop");
  const llamo = bloques.some((b) => b.type === "tool_use");
  return {
    bloques,
    fin: final === "content_filter" ? "refusal" : final === "length" ? "max_tokens" : llamo ? "tool_use" : "end_turn",
    entrada: Number(uso.prompt_tokens ?? 0),
    salida: Number(uso.completion_tokens ?? 0),
    modelo: String(datos.model ?? modelo),
  };
}

function errorOpenRouter(status: number, cuerpo: Json, cabeceras: Headers): ErrorProveedor {
  const e = (cuerpo.error as Json) ?? {};
  const mensaje = String(e.message ?? `OpenRouter respondió ${status}`);
  if (status === 401 || status === 403) return new ErrorProveedor(401, "La clave de respaldo (OpenRouter) no es válida. Revisala en la app.");
  if (status === 429 || status === 402) {
    const espera = cabeceras.get("retry-after");
    return new ErrorProveedor(429, `OpenRouter: sin cupo gratis por ahora. ${mensaje}`, espera ? Math.ceil(Number(espera)) : null, true);
  }
  if (status === 404 || status === 400) return new ErrorProveedor(status, `OpenRouter: ${mensaje}`, null, true);
  return new ErrorProveedor(status >= 500 ? 503 : status, `OpenRouter: ${mensaje}`);
}

// ---------------------------------------------------------------- HTTP

async function postJson(
  url: string,
  cuerpo: Json,
  cabeceras: Record<string, string>,
  signal: AbortSignal | null | undefined,
  aError: (status: number, cuerpo: Json, cabeceras: Headers) => ErrorProveedor,
): Promise<Json> {
  const limite = AbortSignal.timeout(ESPERA_RED_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...cabeceras },
      body: JSON.stringify(cuerpo),
      signal: signal ? AbortSignal.any([signal, limite]) : limite,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ErrorProveedor(503, `Sin conexión con el proveedor: ${(err as Error).message}`);
  }
  const texto = await res.text();
  let datos: Json = {};
  try {
    datos = texto ? (JSON.parse(texto) as Json) : {};
  } catch {
    datos = { error: { message: texto.slice(0, 300) } };
  }
  if (!res.ok) throw aError(res.status, datos, res.headers);
  return datos;
}

// ---------------------------------------------------------------- Cadena de proveedores

interface Eslabon {
  clave: string;
  pedir: (p: Pedido, signal?: AbortSignal | null) => Promise<Respuesta>;
}

/** Hasta cuándo no se prueba cada eslabón (sin cupo o caído). */
const pausados = new Map<string, number>();

async function eslabones(signal?: AbortSignal | null): Promise<Eslabon[]> {
  const lista: Eslabon[] = [];
  if (hayGemini) for (const m of MODELOS_GEMINI) lista.push({ clave: `gemini:${m}`, pedir: (p, s) => pedirGemini(p, m, s) });
  if (hayRespaldo) {
    for (const m of await modelosGratis(signal)) lista.push({ clave: `openrouter:${m}`, pedir: (p, s) => pedirOpenRouter(p, m, s) });
  }
  return lista;
}

async function responder(p: Pedido, signal?: AbortSignal | null): Promise<Respuesta> {
  const lista = await eslabones(signal);
  if (!lista.length) throw new ErrorProveedor(401, "No hay ninguna clave cargada (Anthropic, Gemini u OpenRouter).");
  let ultimo: ErrorProveedor | null = null;
  let esperaMinima = Infinity;
  for (const e of lista) {
    const hasta = pausados.get(e.clave) ?? 0;
    if (hasta > Date.now()) {
      esperaMinima = Math.min(esperaMinima, (hasta - Date.now()) / 1000);
      continue;
    }
    // Una llamada mal armada a una herramienta suele salir bien al segundo intento.
    for (let intento = 0; intento < 2; intento++) {
      try {
        const r = await e.pedir(p, signal);
        pausados.delete(e.clave);
        return r;
      } catch (err) {
        if (signal?.aborted) throw err;
        if (!(err instanceof ErrorProveedor)) throw err;
        ultimo = err;
        if (err.status === 401) throw err;
        if (err.status === 502 && intento === 0) continue;
        // Sin cupo: se deja descansar ese eslabón lo que pidió (o un rato) y se pasa al siguiente.
        const pausa = err.sinCupo ? Math.max(err.esperar ?? 60, 30) : 20;
        pausados.set(e.clave, Date.now() + pausa * 1000);
        esperaMinima = Math.min(esperaMinima, pausa);
        break;
      }
    }
  }
  throw new ErrorProveedor(
    429,
    ultimo?.message ?? "Todos los modelos gratis están sin cupo por ahora.",
    Number.isFinite(esperaMinima) ? Math.ceil(esperaMinima) : 60,
    true,
  );
}

// ---------------------------------------------------------------- fetch para el cliente de Anthropic

const tipoDeError = (status: number) =>
  status === 401 ? "authentication_error" : status === 429 ? "rate_limit_error" : status === 400 || status === 404 ? "invalid_request_error" : "api_error";

function respuestaDeError(err: ErrorProveedor): Response {
  // 404/400 de un modelo que ya se salteó llegan acá solo si no quedó ninguno: para el motor es "sin cupo".
  const status = err.status === 404 ? 429 : err.status;
  const cabeceras: Record<string, string> = { "content-type": "application/json" };
  if (err.esperar != null) cabeceras["retry-after"] = String(err.esperar);
  return new Response(JSON.stringify({ type: "error", error: { type: tipoDeError(status), message: err.message } }), { status, headers: cabeceras });
}

function mensajeAnthropic(r: Respuesta): Json {
  return {
    id: nuevoId("msg_"),
    type: "message",
    role: "assistant",
    model: r.modelo,
    content: r.bloques,
    stop_reason: r.fin,
    stop_sequence: null,
    usage: { input_tokens: r.entrada, output_tokens: r.salida, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}

/** El mensaje entero como eventos SSE, igual que la API de streaming de Anthropic. */
function comoEventos(m: Json): string {
  const evento = (tipo: string, datos: Json) => `event: ${tipo}\ndata: ${JSON.stringify({ type: tipo, ...datos })}\n\n`;
  let salida = evento("message_start", { message: { ...m, content: [], stop_reason: null, usage: { ...(m.usage as Json), output_tokens: 0 } } });
  (m.content as Json[]).forEach((b, index) => {
    if (b.type === "text") {
      salida += evento("content_block_start", { index, content_block: { type: "text", text: "" } });
      salida += evento("content_block_delta", { index, delta: { type: "text_delta", text: b.text } });
    } else if (b.type === "thinking") {
      salida += evento("content_block_start", { index, content_block: { type: "thinking", thinking: "", signature: "" } });
      salida += evento("content_block_delta", { index, delta: { type: "thinking_delta", thinking: b.thinking } });
    } else if (b.type === "tool_use") {
      salida += evento("content_block_start", { index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
      salida += evento("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input ?? {}) } });
    }
    salida += evento("content_block_stop", { index });
  });
  salida += evento("message_delta", { delta: { stop_reason: m.stop_reason, stop_sequence: null }, usage: { output_tokens: (m.usage as Json).output_tokens } });
  salida += evento("message_stop", {});
  return salida;
}

/** fetch que atiende los pedidos del cliente de Anthropic con Gemini y el respaldo gratis. */
export async function fetchGratis(entrada: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
  if ((init?.method ?? "GET").toUpperCase() !== "POST" || !url.pathname.endsWith("/v1/messages")) {
    return respuestaDeError(new ErrorProveedor(404, `Esta función no está disponible con modelos gratis (${url.pathname}).`));
  }
  const signal = init?.signal ?? null;
  let cuerpo: Json;
  try {
    cuerpo = JSON.parse(String(init?.body ?? "{}")) as Json;
  } catch {
    return respuestaDeError(new ErrorProveedor(400, "Pedido ilegible."));
  }
  let r: Respuesta;
  try {
    r = await responder(traducirPedido(cuerpo), signal);
  } catch (err) {
    if (err instanceof ErrorProveedor) return respuestaDeError(err);
    throw err;
  }
  const m = mensajeAnthropic(r);
  if (cuerpo.stream) return new Response(comoEventos(m), { status: 200, headers: { "content-type": "text/event-stream" } });
  return new Response(JSON.stringify(m), { status: 200, headers: { "content-type": "application/json" } });
}
