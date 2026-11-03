// Bots de Telegram conectados (Conexiones): lo que les escriben entra a Mensajes como una conversación
// más y las respuestas de los compañeros salen por la API oficial de bots. Recibe con getUpdates (pedido
// largo), así que anda en el celular sin servidor público ni webhook.

import { readFileSync } from "node:fs";
import path from "node:path";
import { DATOS, programarEscritura } from "./almacen.ts";
import { botsTelegram, llamarTelegram } from "./conexiones.ts";
import { bus } from "./eventos.ts";
import { APP_TELEGRAM, recibir, resultadoSaliente, tomarSalientesDe } from "./mensajeria.ts";

const ARCHIVO = path.join(DATOS, "telegram.json");
const MAX_TEXTO = 4096;

let desplazamientos: Record<string, number> = {};
try {
  desplazamientos = JSON.parse(readFileSync(ARCHIVO, "utf8")) as Record<string, number>;
} catch {
  // Primera vez.
}

const activos = new Map<string, AbortController>();
const dormir = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

interface Mensaje {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  from?: { is_bot?: boolean; first_name?: string; last_name?: string; username?: string };
  chat: { id: number; type: string; title?: string; first_name?: string; last_name?: string; username?: string };
  photo?: unknown;
  voice?: unknown;
  video?: unknown;
  document?: unknown;
  sticker?: { emoji?: string };
}

const nombreDe = (x: { first_name?: string; last_name?: string; username?: string } | undefined) =>
  [x?.first_name, x?.last_name].filter(Boolean).join(" ") || (x?.username ? `@${x.username}` : "Alguien");

function textoDe(m: Mensaje): string {
  const texto = (m.text ?? m.caption ?? "").trim();
  const adjunto = m.photo ? "[mandó una foto]" : m.voice ? "[mandó un audio]" : m.video ? "[mandó un video]" : m.document ? "[mandó un archivo]" : m.sticker ? `[sticker ${m.sticker.emoji ?? ""}]` : "";
  return [adjunto, texto].filter(Boolean).join(" ");
}

function entrar(conexionId: string, cuenta: string, m: Mensaje): void {
  if (m.from?.is_bot) return; // nunca contestarle a otro bot (evita bucles)
  const texto = textoDe(m);
  if (!texto) return;
  const esGrupo = m.chat.type !== "private";
  recibir({
    app: APP_TELEGRAM,
    appNombre: `Telegram ${cuenta}`,
    clave: `${APP_TELEGRAM}|${conexionId}:${m.chat.id}`,
    conversacion: esGrupo ? (m.chat.title ?? "Grupo") : nombreDe(m.chat),
    esGrupo,
    puedeResponder: true,
    mensajes: [{ de: nombreDe(m.from), texto, hora: m.date * 1000, propio: false }],
  });
}

async function escuchar(bot: { id: string; cuenta: string; token: string }, signal: AbortSignal): Promise<void> {
  let espera = 2000;
  let webhookBorrado = false;
  while (!signal.aborted) {
    try {
      const { resultado } = await llamarTelegram(
        bot.token,
        "getUpdates",
        { offset: (desplazamientos[bot.id] ?? 0) || undefined, timeout: 25, allowed_updates: ["message"] },
        AbortSignal.any([signal, AbortSignal.timeout(40_000)]),
      );
      for (const u of (resultado as { update_id: number; message?: Mensaje }[]) ?? []) {
        desplazamientos[bot.id] = u.update_id + 1;
        if (u.message) entrar(bot.id, bot.cuenta, u.message);
      }
      programarEscritura(ARCHIVO, () => desplazamientos);
      espera = 2000;
    } catch (err) {
      if (signal.aborted) return;
      const e = err as Error & { status?: number; esperar?: number };
      // 409: el bot tenía un webhook configurado; getUpdates no anda hasta sacarlo.
      if (e.status === 409 && !webhookBorrado) {
        webhookBorrado = true;
        await llamarTelegram(bot.token, "deleteWebhook").catch(() => {});
        continue;
      }
      await dormir(e.esperar ? e.esperar * 1000 : espera, signal);
      espera = Math.min(espera * 2, 60_000);
    }
  }
}

let mandando = false;
async function mandarPendientes(): Promise<void> {
  if (mandando) return;
  mandando = true;
  try {
    const bots = new Map(botsTelegram().map((b) => [b.id, b]));
    for (const s of tomarSalientesDe(APP_TELEGRAM)) {
      const [conexionId, chatId] = s.clave.slice(APP_TELEGRAM.length + 1).split(":");
      const bot = bots.get(conexionId ?? "");
      if (!bot || !chatId) {
        resultadoSaliente(s.id, false, "El bot de Telegram de esta conversación ya no está conectado.");
        continue;
      }
      try {
        for (let i = 0; i < s.texto.length; i += MAX_TEXTO) {
          await llamarTelegram(bot.token, "sendMessage", { chat_id: Number(chatId), text: s.texto.slice(i, i + MAX_TEXTO) });
        }
        resultadoSaliente(s.id, true, null);
      } catch (err) {
        const e = err as Error & { esperar?: number };
        if (e.esperar) await dormir(e.esperar * 1000);
        resultadoSaliente(s.id, false, e.message.slice(0, 280));
      }
    }
  } finally {
    mandando = false;
  }
}

/** Arranca y frena los oyentes según los bots conectados; manda las respuestas apenas aparecen. */
export function iniciarTelegram(): void {
  const revisar = () => {
    const bots = botsTelegram();
    const ids = new Set(bots.map((b) => b.id));
    for (const [id, control] of activos) {
      if (!ids.has(id)) {
        control.abort();
        activos.delete(id);
      }
    }
    for (const b of bots) {
      if (activos.has(b.id)) continue;
      const control = new AbortController();
      activos.set(b.id, control);
      void escuchar(b, control.signal);
    }
    if (bots.length) void mandarPendientes();
  };
  bus.on("evento", (tipo: string, datos: Record<string, unknown>) => {
    if (tipo === "mensajeria-saliente" && datos.estado === "pendiente" && String(datos.clave ?? "").startsWith(`${APP_TELEGRAM}|`)) void mandarPendientes();
    if (tipo === "conexiones") revisar();
  });
  setInterval(revisar, 15_000).unref();
  revisar();
}
