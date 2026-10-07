import {
  ELEVENLABS_API_KEY,
  ELEVENLABS_MODELO,
  ELEVENLABS_VOZ,
  GEMINI_API_KEY,
  GEMINI_MODELO,
  GROQ_API_KEY,
} from "./config.ts";

// Oído: pasa audio a texto con Whisper en Groq (gratis y muy rápido) o, si no hay clave, con Gemini.
// Voz: texto a audio con ElevenLabs. Si no está o se terminó el cupo, la interfaz usa la voz del sistema.

export function puedeTranscribir(): boolean {
  return Boolean(GROQ_API_KEY || GEMINI_API_KEY);
}

function extension(tipo: string): string {
  if (tipo.includes("ogg")) return "ogg";
  if (tipo.includes("mp4") || tipo.includes("m4a") || tipo.includes("aac")) return "m4a";
  if (tipo.includes("mpeg") || tipo.includes("mp3")) return "mp3";
  if (tipo.includes("wav")) return "wav";
  return "webm";
}

export async function transcribir(audio: Buffer, tipo: string): Promise<string> {
  const mime = tipo.split(";")[0].trim() || "audio/webm";
  if (GROQ_API_KEY) {
    try {
      return await conGroq(audio, mime);
    } catch (err) {
      if (!GEMINI_API_KEY) throw err;
      console.warn(`[voz] Groq falló, pruebo con Gemini: ${(err as Error).message}`);
    }
  }
  if (GEMINI_API_KEY) return conGemini(audio, mime);
  throw new Error("Para entender audio hace falta GROQ_API_KEY o GEMINI_API_KEY.");
}

async function conGroq(audio: Buffer, mime: string): Promise<string> {
  const formulario = new FormData();
  formulario.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `audio.${extension(mime)}`);
  formulario.append("model", "whisper-large-v3-turbo");
  formulario.append("language", "es");
  formulario.append("response_format", "json");
  // Ayuda a que escriba bien la palabra clave.
  formulario.append("prompt", "Jarvis.");
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    body: formulario,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { text?: string }).text?.trim() ?? "";
}

async function conGemini(audio: Buffer, mime: string): Promise<string> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODELO}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mime, data: audio.toString("base64") } },
            {
              text: 'Transcribí exactamente lo que se dice en este audio, en el idioma original. La asistente se llama "Jarvis". Respondé solo con la transcripción, sin comillas ni comentarios. Si no se entiende nada o no habla nadie, respondé vacío.',
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  return (json.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("")
    .trim();
}

// ---------- ElevenLabs ----------

interface VozElevenLabs {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  verified_languages?: { language?: string }[];
}

const API_ELEVENLABS = "https://api.elevenlabs.io";
const PREDETERMINADAS_FEMENINAS = ["Sarah", "Laura", "Alice", "Matilda", "Jessica", "Charlotte", "Lily", "Rachel"];
const MAX_CACHE_AUDIO = 40;

let vozId = ELEVENLABS_VOZ;
let pausaHasta = 0;
const cacheAudio = new Map<string, Buffer>();

export function vozNatural(): boolean {
  return Boolean(ELEVENLABS_API_KEY) && pausaHasta < Date.now();
}

async function pedirElevenLabs(ruta: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API_ELEVENLABS}${ruta}`, {
    ...init,
    headers: { "xi-api-key": ELEVENLABS_API_KEY, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const detalle = (await res.text().catch(() => "")).slice(0, 300);
    // Sin cupo o clave inválida: se descansa media hora y mientras tanto habla la voz del sistema.
    if ([401, 402, 429].includes(res.status) || /quota|credits/i.test(detalle)) pausaHasta = Date.now() + 30 * 60_000;
    throw new Error(`ElevenLabs HTTP ${res.status}: ${detalle}`);
  }
  return res;
}

export async function listarVoces(): Promise<VozElevenLabs[]> {
  if (!ELEVENLABS_API_KEY) throw new Error("Falta ELEVENLABS_API_KEY.");
  const res = await pedirElevenLabs("/v2/voices?page_size=100");
  return ((await res.json()) as { voices?: VozElevenLabs[] }).voices ?? [];
}

function hablaEspanol(v: VozElevenLabs): boolean {
  const etiquetas = Object.values(v.labels ?? {}).join(" ").toLowerCase();
  return (
    /spanish|español|latin|argentin|mexican|castilian/.test(etiquetas) ||
    (v.verified_languages ?? []).some((l) => l.language?.toLowerCase().startsWith("es"))
  );
}

// Prioridad: voces tuyas en español (diseñadas o clonadas) > cualquier voz femenina en español > predeterminadas femeninas.
async function elegirVoz(): Promise<string> {
  if (vozId) return vozId;
  const voces = await listarVoces();
  const femenina = (v: VozElevenLabs) => (v.labels?.gender ?? "").toLowerCase() === "female";
  const propia = (v: VozElevenLabs) => v.category !== "premade";
  const elegida =
    voces.find((v) => propia(v) && hablaEspanol(v)) ??
    voces.find((v) => femenina(v) && hablaEspanol(v)) ??
    PREDETERMINADAS_FEMENINAS.map((n) => voces.find((v) => v.name.startsWith(n))).find(Boolean) ??
    voces.find(femenina) ??
    voces[0];
  if (!elegida) throw new Error("Tu cuenta de ElevenLabs no tiene voces disponibles.");
  vozId = elegida.voice_id;
  console.log(`[voz] ElevenLabs: uso la voz "${elegida.name}" (${vozId}). Podés fijar otra con ELEVENLABS_VOZ.`);
  return vozId;
}

export async function sintetizar(texto: string): Promise<Buffer> {
  const limpio = texto.replace(/https?:\/\/\S+/g, "").trim().slice(0, 1200);
  if (!limpio) throw new Error("No hay texto para decir.");
  const guardado = cacheAudio.get(limpio);
  if (guardado) return guardado;

  const voz = await elegirVoz();
  const res = await pedirElevenLabs(`/v1/text-to-speech/${voz}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: limpio,
      model_id: ELEVENLABS_MODELO,
      ...(/v2_5/.test(ELEVENLABS_MODELO) ? { language_code: "es" } : {}),
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
    }),
  });
  const audio = Buffer.from(await res.arrayBuffer());
  cacheAudio.set(limpio, audio);
  if (cacheAudio.size > MAX_CACHE_AUDIO) cacheAudio.delete(cacheAudio.keys().next().value!);
  return audio;
}
