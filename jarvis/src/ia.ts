import { PROVEEDORES, RAZONAMIENTO, type Proveedor } from "./config.ts";

// Todos los proveedores gratuitos que usa Jarvis (Gemini, Groq, OpenRouter, Ollama) hablan el
// formato de chat de OpenAI, así que un solo cliente sirve para todos.

export interface LlamadaHerramienta {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  // Gemini manda acá su "thought signature" y exige recibirla de vuelta tal cual.
  extra_content?: unknown;
}

export interface MensajeIA {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: LlamadaHerramienta[];
  tool_call_id?: string;
  name?: string;
}

export interface DefinicionHerramienta {
  type: "function";
  function: { name: string; description: string; parameters?: Record<string, unknown> };
}

export interface OpcionesIA {
  mensajes: MensajeIA[];
  herramientas?: DefinicionHerramienta[];
  json?: boolean;
  // Si está, la respuesta llega en vivo de a pedazos.
  onTexto?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface RespuestaIA {
  texto: string;
  llamadas: LlamadaHerramienta[];
  proveedor: string;
}

export class ErrorIA extends Error {
  readonly estado?: number;
  readonly esperarMs?: number;
  constructor(message: string, estado?: number, esperarMs?: number) {
    super(message);
    this.estado = estado;
    this.esperarMs = esperarMs;
  }
}

const TIEMPO_MAXIMO_MS = 90_000;
// Un proveedor que se quedó sin cupo gratis se saltea un rato.
const enPausaHasta = new Map<string, number>();

export function proveedoresActivos(): { nombre: string; modelo: string; disponible: boolean }[] {
  return PROVEEDORES.map((p) => ({
    nombre: p.nombre,
    modelo: p.modelo,
    disponible: (enPausaHasta.get(p.nombre) ?? 0) < Date.now(),
  }));
}

export async function completar(opciones: OpcionesIA): Promise<RespuestaIA> {
  if (PROVEEDORES.length === 0) {
    throw new ErrorIA("No hay ninguna IA configurada. Poné GEMINI_API_KEY o GROQ_API_KEY en el archivo .env.");
  }
  const ordenados = [...PROVEEDORES].sort(
    (a, b) => Number((enPausaHasta.get(a.nombre) ?? 0) > Date.now()) - Number((enPausaHasta.get(b.nombre) ?? 0) > Date.now()),
  );

  let ultimoError: unknown;
  for (const proveedor of ordenados) {
    let empezo = false;
    try {
      return await llamar(proveedor, {
        ...opciones,
        onTexto: opciones.onTexto
          ? (delta) => {
              empezo = true;
              opciones.onTexto!(delta);
            }
          : undefined,
      });
    } catch (err) {
      if (opciones.signal?.aborted) throw err;
      ultimoError = err;
      if (err instanceof ErrorIA && (err.estado === 429 || err.estado === 503)) {
        enPausaHasta.set(proveedor.nombre, Date.now() + (err.esperarMs ?? 60_000));
      }
      console.warn(`[ia] ${proveedor.nombre} falló: ${err instanceof Error ? err.message : err}`);
      // Si ya se mostró parte de la respuesta, cambiar de proveedor la duplicaría.
      if (empezo) throw err;
    }
  }
  throw ultimoError instanceof Error ? ultimoError : new ErrorIA("Ninguna IA respondió.");
}

function prepararMensajes(mensajes: MensajeIA[], proveedor: Proveedor): MensajeIA[] {
  const esGemini = proveedor.nombre === "gemini";
  return mensajes.map((m) => {
    const copia: MensajeIA = { ...m };
    if (!esGemini) {
      delete copia.name;
      if (copia.tool_calls) copia.tool_calls = copia.tool_calls.map(({ extra_content: _, ...resto }) => resto);
    }
    return copia;
  });
}

async function llamar(proveedor: Proveedor, opciones: OpcionesIA): Promise<RespuestaIA> {
  const cuerpo: Record<string, unknown> = {
    model: proveedor.modelo,
    messages: prepararMensajes(opciones.mensajes, proveedor),
    stream: Boolean(opciones.onTexto),
  };
  if (opciones.herramientas?.length) cuerpo.tools = opciones.herramientas;
  if (opciones.json) cuerpo.response_format = { type: "json_object" };
  if (proveedor.nombre === "gemini" || proveedor.nombre === "groq") cuerpo.reasoning_effort = RAZONAMIENTO;

  const limite = AbortSignal.timeout(TIEMPO_MAXIMO_MS);
  const respuesta = await fetch(`${proveedor.url}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${proveedor.clave}` },
    body: JSON.stringify(cuerpo),
    signal: opciones.signal ? AbortSignal.any([opciones.signal, limite]) : limite,
  });

  if (!respuesta.ok) {
    const detalle = (await respuesta.text().catch(() => "")).slice(0, 400);
    const reintentar = Number(respuesta.headers.get("retry-after"));
    throw new ErrorIA(
      `HTTP ${respuesta.status} ${detalle}`,
      respuesta.status,
      Number.isFinite(reintentar) && reintentar > 0 ? reintentar * 1000 : undefined,
    );
  }

  if (!opciones.onTexto) {
    const json = (await respuesta.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: LlamadaHerramienta[] } }[];
    };
    const mensaje = json.choices?.[0]?.message;
    return {
      texto: mensaje?.content ?? "",
      llamadas: normalizarLlamadas(mensaje?.tool_calls ?? []),
      proveedor: proveedor.nombre,
    };
  }

  return leerStream(respuesta, proveedor, opciones.onTexto);
}

interface DeltaLlamada {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
  extra_content?: unknown;
}

async function leerStream(
  respuesta: Response,
  proveedor: Proveedor,
  onTexto: (delta: string) => void,
): Promise<RespuestaIA> {
  let texto = "";
  const llamadas: LlamadaHerramienta[] = [];
  let resto = "";

  const procesarLinea = (linea: string) => {
    if (!linea.startsWith("data:")) return;
    const datos = linea.slice(5).trim();
    if (!datos || datos === "[DONE]") return;
    let chunk: { choices?: { delta?: { content?: string | null; tool_calls?: DeltaLlamada[] } }[]; error?: { message?: string } };
    try {
      chunk = JSON.parse(datos);
    } catch {
      return;
    }
    if (chunk.error) throw new ErrorIA(chunk.error.message ?? "Error en la respuesta");
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.content) {
      texto += delta.content;
      onTexto(delta.content);
    }
    for (const parte of delta?.tool_calls ?? []) {
      // Algunos proveedores no mandan "index"; en ese caso se ubica por id.
      let i = typeof parte.index === "number" ? parte.index : parte.id ? llamadas.findIndex((l) => l.id === parte.id) : llamadas.length - 1;
      if (i < 0) i = llamadas.length;
      llamadas[i] ??= { id: "", type: "function", function: { name: "", arguments: "" } };
      const llamada = llamadas[i];
      if (parte.id) llamada.id = parte.id;
      if (parte.function?.name) llamada.function.name += parte.function.name;
      if (parte.function?.arguments) llamada.function.arguments += parte.function.arguments;
      if (parte.extra_content) llamada.extra_content = parte.extra_content;
    }
  };

  const lector = respuesta.body!.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    resto += value;
    const lineas = resto.split("\n");
    resto = lineas.pop() ?? "";
    for (const linea of lineas) procesarLinea(linea.trim());
  }
  procesarLinea(resto.trim());

  return { texto, llamadas: normalizarLlamadas(llamadas.filter(Boolean)), proveedor: proveedor.nombre };
}

function normalizarLlamadas(llamadas: LlamadaHerramienta[]): LlamadaHerramienta[] {
  return llamadas.map((l, i) => ({
    ...l,
    id: l.id || `llamada_${Date.now()}_${i}`,
    type: "function",
    function: { name: l.function.name, arguments: l.function.arguments || "{}" },
  }));
}

// Pide un JSON y lo devuelve parseado, tolerando que venga envuelto en ```json.
export async function completarJson<T>(mensajes: MensajeIA[]): Promise<T> {
  const { texto } = await completar({ mensajes, json: true });
  const limpio = texto.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const inicio = limpio.indexOf("{");
  const fin = limpio.lastIndexOf("}");
  return JSON.parse(limpio.slice(inicio, fin + 1)) as T;
}
