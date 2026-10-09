import path from "node:path";

const env = process.env;

function lista(valor: string | undefined): string[] {
  return (valor ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const RAIZ = path.resolve(import.meta.dirname, "..");
export const CARPETA_DATOS = path.resolve(RAIZ, env.JARVIS_DATOS ?? "datos");

export const USUARIO = env.JARVIS_USUARIO?.trim() || "jefe";
export const HOST = env.JARVIS_HOST?.trim() || "127.0.0.1";
export const PUERTO = Number(env.PORT ?? env.JARVIS_PUERTO ?? 3700);
// Obligatorio si el servidor escucha fuera de esta compu (JARVIS_HOST distinto de 127.0.0.1).
export const TOKEN = env.JARVIS_TOKEN?.trim() || "";
export const ZONA_HORARIA = env.TZ?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
export const CIUDAD = env.JARVIS_CIUDAD?.trim() || "";

// "low" responde más rápido; "medium" o "high" piensan más.
export const RAZONAMIENTO = env.JARVIS_RAZONAMIENTO?.trim() || "low";

// Desde qué importancia un aviso entrante se dice en voz alta y se manda a Telegram.
const IMPORTANCIAS = ["baja", "media", "alta"] as const;
export type Importancia = (typeof IMPORTANCIAS)[number];
export const AVISAR_DESDE: Importancia = IMPORTANCIAS.includes(env.JARVIS_AVISAR_DESDE as Importancia)
  ? (env.JARVIS_AVISAR_DESDE as Importancia)
  : "media";
export function superaUmbral(importancia: Importancia): boolean {
  return IMPORTANCIAS.indexOf(importancia) >= IMPORTANCIAS.indexOf(AVISAR_DESDE);
}

// "HH:MM": a esa hora Jarvis te arma un resumen del día. Vacío lo desactiva.
export const RESUMEN_DIARIO = /^\d{1,2}:\d{2}$/.test(env.JARVIS_RESUMEN_DIARIO ?? "") ? env.JARVIS_RESUMEN_DIARIO! : "";

export interface Proveedor {
  nombre: "gemini" | "groq" | "openrouter" | "ollama";
  url: string;
  clave: string;
  modelo: string;
}

const PROVEEDORES_DISPONIBLES: Proveedor[] = [
  {
    nombre: "gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/openai",
    clave: env.GEMINI_API_KEY?.trim() ?? "",
    modelo: env.GEMINI_MODELO?.trim() || "gemini-flash-latest",
  },
  {
    nombre: "groq",
    url: "https://api.groq.com/openai/v1",
    clave: env.GROQ_API_KEY?.trim() ?? "",
    modelo: env.GROQ_MODELO?.trim() || "openai/gpt-oss-120b",
  },
  {
    nombre: "openrouter",
    url: "https://openrouter.ai/api/v1",
    clave: env.OPENROUTER_API_KEY?.trim() ?? "",
    modelo: env.OPENROUTER_MODELO?.trim() ?? "",
  },
  {
    nombre: "ollama",
    url: (env.OLLAMA_URL?.trim() || "http://localhost:11434") + "/v1",
    clave: "ollama",
    modelo: env.OLLAMA_MODELO?.trim() ?? "",
  },
];

// Se usan en este orden: si uno falla o se queda sin cupo gratis, sigue el próximo.
const orden = lista(env.JARVIS_PROVEEDORES);
export const PROVEEDORES: Proveedor[] = PROVEEDORES_DISPONIBLES.filter((p) =>
  p.nombre === "ollama" || p.nombre === "openrouter" ? Boolean(p.modelo) && (p.nombre === "ollama" || p.clave) : p.clave,
).sort((a, b) => {
  const ia = orden.indexOf(a.nombre);
  const ib = orden.indexOf(b.nombre);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
});

export const GEMINI_API_KEY = env.GEMINI_API_KEY?.trim() ?? "";
export const GEMINI_MODELO = env.GEMINI_MODELO?.trim() || "gemini-flash-latest";
export const GROQ_API_KEY = env.GROQ_API_KEY?.trim() ?? "";
export const TAVILY_API_KEY = env.TAVILY_API_KEY?.trim() ?? "";

// Voz natural (opcional). Sin ELEVENLABS_VOZ, Jarvis elige sola una voz femenina en español de tu cuenta.
export const ELEVENLABS_API_KEY = env.ELEVENLABS_API_KEY?.trim() ?? "";
export const ELEVENLABS_VOZ = env.ELEVENLABS_VOZ?.trim() ?? "";
export const ELEVENLABS_MODELO = env.ELEVENLABS_MODELO?.trim() || "eleven_flash_v2_5";

export interface CuentaEmail {
  usuario: string;
  clave: string;
  imap: string;
  smtp: string;
}

const SERVIDORES_EMAIL: Record<string, { imap: string; smtp: string }> = {
  "gmail.com": { imap: "imap.gmail.com", smtp: "smtp.gmail.com" },
  "googlemail.com": { imap: "imap.gmail.com", smtp: "smtp.gmail.com" },
  "yahoo.com": { imap: "imap.mail.yahoo.com", smtp: "smtp.mail.yahoo.com" },
  "yahoo.com.ar": { imap: "imap.mail.yahoo.com", smtp: "smtp.mail.yahoo.com" },
  "icloud.com": { imap: "imap.mail.me.com", smtp: "smtp.mail.me.com" },
  "me.com": { imap: "imap.mail.me.com", smtp: "smtp.mail.me.com" },
};

// EMAIL_CUENTAS=yo@gmail.com:clavedeaplicacion,otro@gmail.com:otraclave
export const CUENTAS_EMAIL: CuentaEmail[] = lista(env.EMAIL_CUENTAS).flatMap((entrada) => {
  const separador = entrada.indexOf(":");
  if (separador === -1) return [];
  const usuario = entrada.slice(0, separador).trim();
  const clave = entrada.slice(separador + 1).replace(/\s+/g, "");
  const dominio = usuario.split("@")[1]?.toLowerCase() ?? "";
  const servidores = SERVIDORES_EMAIL[dominio] ?? { imap: `imap.${dominio}`, smtp: `smtp.${dominio}` };
  return [{ usuario, clave, imap: env.EMAIL_IMAP_HOST?.trim() || servidores.imap, smtp: env.EMAIL_SMTP_HOST?.trim() || servidores.smtp }];
});

export const WHATSAPP_ACTIVO = env.WHATSAPP_ACTIVO === "1";
export const WHATSAPP_GRUPOS = env.WHATSAPP_GRUPOS === "1";

export const TELEGRAM_TOKEN = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
export const TELEGRAM_CHAT_ID = env.TELEGRAM_CHAT_ID?.trim() ?? "";

// Para noticias y clima.
export const PAIS = (env.JARVIS_PAIS?.trim() || "AR").toUpperCase();
