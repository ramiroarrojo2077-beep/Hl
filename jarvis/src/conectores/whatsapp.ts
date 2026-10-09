import { rm } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  isJidGroup,
  isJidStatusBroadcast,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from "baileys";
import { CARPETA_DATOS, WHATSAPP_ACTIVO, WHATSAPP_GRUPOS } from "../config.ts";
import { emitir } from "../eventos.ts";

// WhatsApp personal vinculado como "dispositivo" (igual que WhatsApp Web): escaneás un QR una vez.
// Usa una librería no oficial (Baileys); WhatsApp puede limitar cuentas que la usan para spam.

export interface MensajeWhatsapp {
  id: string;
  jid: string;
  nombre: string;
  grupo?: string;
  texto: string;
  deMi: boolean;
  fecha: string;
}

const CARPETA_SESION = path.join(CARPETA_DATOS, "whatsapp");
const MAX_MENSAJES = 300;

let socket: WASocket | undefined;
let estado: "apagado" | "esperando_qr" | "conectando" | "conectado" | "error" = WHATSAPP_ACTIVO ? "conectando" : "apagado";
let qrActual = "";
let alRecibir: (mensaje: MensajeWhatsapp) => void = () => {};
let transcribir: ((audio: Buffer, tipo: string) => Promise<string>) | undefined;

const mensajes: MensajeWhatsapp[] = [];
const contactos = new Map<string, string>();
const grupos = new Map<string, string>();

const silencio = {
  level: "silent",
  child: () => silencio,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export function estadoWhatsapp() {
  return { estado, qr: estado === "esperando_qr" ? qrActual : "" };
}

function cambiarEstado(nuevo: typeof estado): void {
  estado = nuevo;
  emitir("estado", null);
}

export function iniciarWhatsapp(
  onMensaje: (mensaje: MensajeWhatsapp) => void,
  transcriptor?: (audio: Buffer, tipo: string) => Promise<string>,
): void {
  if (!WHATSAPP_ACTIVO) return;
  alRecibir = onMensaje;
  transcribir = transcriptor;
  void conectar();
}

async function conectar(): Promise<void> {
  cambiarEstado("conectando");
  const { state, saveCreds } = await useMultiFileAuthState(CARPETA_SESION);
  let version: [number, number, number] | undefined;
  try {
    version = (await fetchLatestBaileysVersion()).version;
  } catch {}

  const sock = makeWASocket({
    auth: state,
    ...(version ? { version } : {}),
    logger: silencio,
    browser: Browsers.appropriate("Jarvis"),
    // Si queda "en línea", el celular deja de recibir notificaciones.
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  socket = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrActual = await QRCode.toDataURL(qr, { margin: 1, width: 280 });
      cambiarEstado("esperando_qr");
      emitir("whatsapp_qr", { qr: qrActual });
      console.log("[whatsapp] Escaneá el QR desde la interfaz de Jarvis (WhatsApp > Dispositivos vinculados).");
      console.log(await QRCode.toString(qr, { type: "terminal", small: true }));
    }
    if (connection === "open") {
      qrActual = "";
      console.log("[whatsapp] conectado");
      cambiarEstado("conectado");
    }
    if (connection === "close") {
      if (socket !== sock) return;
      const codigo = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      if (codigo === DisconnectReason.loggedOut) {
        // Se desvinculó desde el celular: se borra la sesión y se pide un QR nuevo.
        console.log("[whatsapp] sesión cerrada, hace falta escanear el QR de nuevo");
        await rm(CARPETA_SESION, { recursive: true, force: true });
      }
      cambiarEstado("conectando");
      setTimeout(() => void conectar(), codigo === DisconnectReason.restartRequired ? 500 : 5000);
    }
  });

  sock.ev.on("contacts.upsert", (lista) => {
    for (const c of lista) if (c.name || c.notify) contactos.set(c.id, c.name || c.notify!);
  });
  sock.ev.on("contacts.update", (lista) => {
    for (const c of lista) if (c.id && (c.name || c.notify)) contactos.set(c.id, c.name || c.notify!);
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      try {
        await procesar(sock, m);
      } catch (err) {
        console.warn(`[whatsapp] no se pudo procesar un mensaje: ${(err as Error).message}`);
      }
    }
  });
}

async function textoDe(m: WAMessage): Promise<string> {
  const c = m.message;
  if (!c) return "";
  const msg = c.ephemeralMessage?.message ?? c.viewOnceMessage?.message ?? c.viewOnceMessageV2?.message ?? c;
  const texto = msg.conversation ?? msg.extendedTextMessage?.text ?? msg.imageMessage?.caption ?? msg.videoMessage?.caption;
  if (texto) return texto;
  if (msg.audioMessage) {
    if (transcribir && !m.key.fromMe) {
      try {
        const audio = await downloadMediaMessage(m, "buffer", {});
        const transcripcion = await transcribir(audio, msg.audioMessage.mimetype ?? "audio/ogg");
        if (transcripcion) return `[audio] ${transcripcion}`;
      } catch (err) {
        console.warn(`[whatsapp] no se pudo transcribir un audio: ${(err as Error).message}`);
      }
    }
    return "[audio]";
  }
  if (msg.imageMessage) return "[foto]";
  if (msg.videoMessage) return "[video]";
  if (msg.documentMessage) return `[documento ${msg.documentMessage.fileName ?? ""}]`.trim();
  if (msg.stickerMessage) return "[sticker]";
  if (msg.locationMessage) return "[ubicación]";
  if (msg.contactMessage) return "[contacto]";
  return "";
}

async function procesar(sock: WASocket, m: WAMessage): Promise<void> {
  const jid = m.key.remoteJid;
  if (!jid || isJidStatusBroadcast(jid) || jid.endsWith("@newsletter") || jid.endsWith("@broadcast")) return;
  const esGrupo = Boolean(isJidGroup(jid));
  if (esGrupo && !WHATSAPP_GRUPOS) return;

  const deMi = Boolean(m.key.fromMe);
  const autor = esGrupo ? (m.key.participant ?? jid) : jid;
  if (m.pushName && !deMi) contactos.set(autor, contactos.get(autor) ?? m.pushName);

  const texto = await textoDe(m);
  if (!texto) return;

  let grupo: string | undefined;
  if (esGrupo) {
    if (!grupos.has(jid)) grupos.set(jid, (await sock.groupMetadata(jid).catch(() => undefined))?.subject ?? "grupo");
    grupo = grupos.get(jid);
  }

  const mensaje: MensajeWhatsapp = {
    id: m.key.id ?? "",
    jid,
    nombre: deMi ? "Yo" : (contactos.get(autor) ?? m.pushName ?? autor.split("@")[0]),
    grupo,
    texto,
    deMi,
    fecha: new Date(Number(m.messageTimestamp ?? Date.now() / 1000) * 1000).toISOString(),
  };
  mensajes.push(mensaje);
  if (mensajes.length > MAX_MENSAJES) mensajes.splice(0, mensajes.length - MAX_MENSAJES);
  if (!deMi) alRecibir(mensaje);
}

export function mensajesRecientes(contacto?: string, cantidad = 15): MensajeWhatsapp[] {
  let lista = mensajes;
  if (contacto) {
    const destino = buscarContacto(contacto);
    const consulta = normalizar(contacto);
    lista = lista.filter((m) => (destino && m.jid === destino.jid) || normalizar(m.nombre).includes(consulta));
  }
  return lista.slice(-cantidad);
}

export function noLeidosWhatsapp(desde: string): number {
  return mensajes.filter((m) => !m.deMi && m.fecha > desde).length;
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

// Acepta un número ("+54 9 11 1234-5678") o un nombre de alguien que ya te escribió.
export function buscarContacto(consulta: string): { jid: string; nombre: string } | null {
  if (consulta.includes("@")) return { jid: consulta, nombre: contactos.get(consulta) ?? consulta.split("@")[0] };
  const digitos = consulta.replace(/\D/g, "");
  if (digitos.length >= 8 && !/[a-z]/i.test(consulta)) return { jid: `${digitos}@s.whatsapp.net`, nombre: consulta };
  const buscado = normalizar(consulta);
  for (const [jid, nombre] of contactos) if (normalizar(nombre) === buscado) return { jid, nombre };
  for (const [jid, nombre] of contactos) if (normalizar(nombre).includes(buscado)) return { jid, nombre };
  for (const m of [...mensajes].reverse()) if (m.grupo && normalizar(m.grupo).includes(buscado)) return { jid: m.jid, nombre: m.grupo };
  return null;
}

export async function enviarWhatsapp(jid: string, texto: string): Promise<void> {
  if (!socket || estado !== "conectado") throw new Error("WhatsApp no está conectado.");
  await socket.sendMessage(jid, { text: texto });
  mensajes.push({ id: "", jid, nombre: "Yo", texto, deMi: true, fecha: new Date().toISOString() });
}
