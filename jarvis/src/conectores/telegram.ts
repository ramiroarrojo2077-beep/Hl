import { TELEGRAM_CHAT_ID, TELEGRAM_TOKEN } from "../config.ts";
import { emitir } from "../eventos.ts";
import type { Propuesta } from "../almacen.ts";

// Bot de Telegram: es el canal para que Jarvis te encuentre cuando no estás en la compu.
// Te manda los avisos con botones para aprobar respuestas, y le podés hablar o mandar audios.

export interface ManejadoresTelegram {
  onMensaje: (texto: string) => Promise<string>;
  onAudio: (audio: Buffer, tipo: string) => Promise<string>;
  onEnviar: (propuestaId: string) => Promise<string>;
  onDescartar: (propuestaId: string) => Promise<string>;
  onEditar: (propuestaId: string, texto: string) => Propuesta | undefined;
}

interface Actualizacion {
  update_id: number;
  message?: MensajeTelegram;
  callback_query?: { id: string; data?: string; message?: MensajeTelegram };
}

interface MensajeTelegram {
  message_id: number;
  chat: { id: number };
  from?: { first_name?: string };
  text?: string;
  voice?: { file_id: string; mime_type?: string };
  audio?: { file_id: string; mime_type?: string };
  reply_to_message?: { message_id: number };
}

const API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const MAX_LARGO = 4000;

let estado: "apagado" | "conectado" | "sin_chat" | "error" = TELEGRAM_TOKEN ? "error" : "apagado";
let manejadores: ManejadoresTelegram;
// Mensaje de Telegram → propuesta, para poder corregir un borrador respondiéndolo.
const propuestasPorMensaje = new Map<number, string>();

export function estadoTelegram() {
  return { estado };
}

async function api<T>(metodo: string, cuerpo: Record<string, unknown>, tiempoMs = 15_000): Promise<T> {
  const res = await fetch(`${API}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(tiempoMs),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(json.description ?? `Telegram respondió ${res.status}`);
  return json.result;
}

function cambiarEstado(nuevo: typeof estado): void {
  if (estado === nuevo) return;
  estado = nuevo;
  emitir("estado", null);
}

export function iniciarTelegram(m: ManejadoresTelegram): void {
  if (!TELEGRAM_TOKEN) return;
  manejadores = m;
  void bucle();
}

async function bucle(): Promise<void> {
  let offset = 0;
  for (;;) {
    try {
      const actualizaciones = await api<Actualizacion[]>(
        "getUpdates",
        { offset, timeout: 50, allowed_updates: ["message", "callback_query"] },
        65_000,
      );
      cambiarEstado(TELEGRAM_CHAT_ID ? "conectado" : "sin_chat");
      for (const a of actualizaciones) {
        offset = a.update_id + 1;
        await manejar(a).catch((err) => console.warn(`[telegram] ${(err as Error).message}`));
      }
    } catch (err) {
      console.warn(`[telegram] ${(err as Error).message}`);
      cambiarEstado("error");
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}

function enviarTexto(chatId: number | string, texto: string, extra: Record<string, unknown> = {}) {
  return api<{ message_id: number }>("sendMessage", { chat_id: chatId, text: texto.slice(0, MAX_LARGO), ...extra });
}

async function manejar(a: Actualizacion): Promise<void> {
  if (a.callback_query) {
    const { id, data = "", message } = a.callback_query;
    if (!message || String(message.chat.id) !== TELEGRAM_CHAT_ID) return;
    const [accion, propuestaId] = data.split(":");
    const resultado = accion === "enviar" ? await manejadores.onEnviar(propuestaId) : await manejadores.onDescartar(propuestaId);
    await api("answerCallbackQuery", { callback_query_id: id, text: resultado.slice(0, 190) });
    await api("editMessageReplyMarkup", {
      chat_id: message.chat.id,
      message_id: message.message_id,
      reply_markup: { inline_keyboard: [] },
    }).catch(() => {});
    await enviarTexto(message.chat.id, resultado, { reply_to_message_id: message.message_id });
    return;
  }

  const mensaje = a.message;
  if (!mensaje) return;
  const chatId = mensaje.chat.id;

  // Solo obedece a tu chat. Si todavía no está configurado, te dice cuál es.
  if (!TELEGRAM_CHAT_ID) {
    console.log(`[telegram] Tu TELEGRAM_CHAT_ID es ${chatId}. Ponelo en el .env y reiniciá Jarvis.`);
    await enviarTexto(chatId, `Hola. Tu chat ID es ${chatId}.\nPonelo en TELEGRAM_CHAT_ID dentro del archivo .env de Jarvis y reiniciala.`);
    return;
  }
  if (String(chatId) !== TELEGRAM_CHAT_ID) return;

  const propuestaRespondida = mensaje.reply_to_message && propuestasPorMensaje.get(mensaje.reply_to_message.message_id);
  if (propuestaRespondida && mensaje.text) {
    const propuesta = manejadores.onEditar(propuestaRespondida, mensaje.text);
    if (propuesta) await notificar("Listo, corregí el borrador:", propuesta);
    return;
  }

  let texto = mensaje.text?.trim() ?? "";
  const audio = mensaje.voice ?? mensaje.audio;
  if (audio) {
    const archivo = await api<{ file_path: string }>("getFile", { file_id: audio.file_id });
    const res = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${archivo.file_path}`);
    texto = await manejadores.onAudio(Buffer.from(await res.arrayBuffer()), audio.mime_type ?? "audio/ogg");
    if (!texto) {
      await enviarTexto(chatId, "No te entendí el audio.");
      return;
    }
  }
  if (!texto) return;
  if (texto === "/start") {
    await enviarTexto(chatId, "Acá estoy. Escribime o mandame un audio cuando quieras.");
    return;
  }

  await api("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  const respuesta = await manejadores.onMensaje(texto);
  await enviarTexto(chatId, respuesta || "Listo.");
}

// Te manda un aviso y, si hay un borrador de respuesta, los botones para aprobarlo.
export async function notificar(texto: string, propuesta?: Propuesta): Promise<void> {
  if (estado !== "conectado") return;
  let cuerpo = texto;
  let extra: Record<string, unknown> = {};
  if (propuesta) {
    const canal = propuesta.canal === "email" ? "mail" : "WhatsApp";
    cuerpo +=
      `\n\n✏️ Respuesta sugerida por ${canal} a ${propuesta.paraNombre}:` +
      (propuesta.asunto ? `\nAsunto: ${propuesta.asunto}` : "") +
      `\n\n${propuesta.texto}\n\n(Para cambiarla, respondé este mensaje con el texto nuevo.)`;
    extra = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Enviar", callback_data: `enviar:${propuesta.id}` },
            { text: "🗑️ Descartar", callback_data: `descartar:${propuesta.id}` },
          ],
        ],
      },
    };
  }
  try {
    const enviado = await enviarTexto(TELEGRAM_CHAT_ID, cuerpo, extra);
    if (propuesta) propuestasPorMensaje.set(enviado.message_id, propuesta.id);
  } catch (err) {
    console.warn(`[telegram] no se pudo avisar: ${(err as Error).message}`);
  }
}
