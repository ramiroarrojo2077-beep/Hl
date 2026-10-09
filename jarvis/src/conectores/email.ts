import { ImapFlow, type FetchMessageObject } from "imapflow";
import nodemailer, { type Transporter } from "nodemailer";
import { simpleParser } from "mailparser";
import { CUENTAS_EMAIL, type CuentaEmail } from "../config.ts";
import { emitir } from "../eventos.ts";

// Gmail, Yahoo, iCloud y cualquier correo con IMAP. Escucha en vivo (IMAP IDLE): cuando entra un mail,
// avisa al instante. Nunca marca mails como leídos ni los borra.

export interface Email {
  cuenta: string;
  uid: number;
  messageId: string;
  references: string[];
  de: string;
  deNombre: string;
  responderA: string;
  asunto: string;
  texto: string;
  fecha: string;
  leido: boolean;
}

interface Conexion {
  cuenta: CuentaEmail;
  cliente?: ImapFlow;
  ultimoUid: number;
  noLeidos: number;
  estado: "conectando" | "conectado" | "error";
  error?: string;
  reintentos: number;
  reconexion?: NodeJS.Timeout;
  cola: Promise<void>;
}

const MAX_TEXTO = 3000;
const MINUTOS_RECUENTO = 3;

const conexiones: Conexion[] = CUENTAS_EMAIL.map((cuenta) => ({
  cuenta,
  ultimoUid: 0,
  noLeidos: 0,
  estado: "conectando",
  reintentos: 0,
  cola: Promise.resolve(),
}));
const transportes = new Map<string, Transporter>();
let alRecibir: (email: Email) => void = () => {};

export function iniciarEmail(onNuevo: (email: Email) => void): void {
  alRecibir = onNuevo;
  for (const c of conexiones) void conectar(c);
  setInterval(() => {
    for (const c of conexiones) if (c.estado === "conectado") encolar(c, () => contarNoLeidos(c));
  }, MINUTOS_RECUENTO * 60_000).unref();
}

export function estadoEmail() {
  return conexiones.map((c) => ({ cuenta: c.cuenta.usuario, estado: c.estado, noLeidos: c.noLeidos, error: c.error }));
}

export function cuentasEmail(): string[] {
  return conexiones.map((c) => c.cuenta.usuario);
}

function avisarCambio(): void {
  emitir("estado", null);
}

// Las operaciones sobre una misma casilla van de a una.
function encolar(c: Conexion, tarea: () => Promise<void>): Promise<void> {
  c.cola = c.cola.then(tarea).catch((err) => console.warn(`[email] ${c.cuenta.usuario}: ${err?.message ?? err}`));
  return c.cola;
}

function reconectar(c: Conexion): void {
  if (c.reconexion) return;
  const espera = Math.min(5 * 60_000, 5000 * 2 ** c.reintentos++);
  c.reconexion = setTimeout(() => {
    c.reconexion = undefined;
    void conectar(c);
  }, espera);
}

async function conectar(c: Conexion): Promise<void> {
  const cliente = new ImapFlow({
    host: c.cuenta.imap,
    port: 993,
    secure: true,
    auth: { user: c.cuenta.usuario, pass: c.cuenta.clave },
    logger: false,
  });
  c.cliente = cliente;
  c.estado = "conectando";
  avisarCambio();

  cliente.on("error", (err: Error) => console.warn(`[email] ${c.cuenta.usuario}: ${err.message}`));
  cliente.on("close", () => {
    if (c.cliente !== cliente) return;
    c.estado = "error";
    c.error ??= "Se cortó la conexión";
    avisarCambio();
    reconectar(c);
  });
  cliente.on("exists", () => void encolar(c, () => revisarNuevos(c)));

  try {
    await cliente.connect();
    const buzon = await cliente.mailboxOpen("INBOX");
    // La primera vez arranca desde ahora: no anuncia mails viejos.
    if (!c.ultimoUid) c.ultimoUid = buzon.uidNext - 1;
    c.estado = "conectado";
    c.error = undefined;
    c.reintentos = 0;
    console.log(`[email] ${c.cuenta.usuario} conectado`);
    avisarCambio();
    await encolar(c, async () => {
      await revisarNuevos(c);
      await contarNoLeidos(c);
    });
  } catch (err) {
    const autenticacion = (err as { authenticationFailed?: boolean }).authenticationFailed;
    c.error = autenticacion
      ? "Usuario o clave incorrectos (en Gmail usá una contraseña de aplicación)"
      : `No se pudo conectar: ${(err as Error).message}`;
    c.estado = "error";
    console.warn(`[email] ${c.cuenta.usuario}: ${c.error}`);
    avisarCambio();
    if (c.cliente === cliente) c.cliente = undefined;
    cliente.close();
    reconectar(c);
  }
}

async function contarNoLeidos(c: Conexion): Promise<void> {
  if (!c.cliente?.usable) return;
  const uids = await c.cliente.search({ seen: false }, { uid: true });
  const cantidad = uids ? uids.length : 0;
  if (cantidad !== c.noLeidos) {
    c.noLeidos = cantidad;
    avisarCambio();
  }
}

function esGmail(c: Conexion): boolean {
  return c.cuenta.imap === "imap.gmail.com";
}

async function revisarNuevos(c: Conexion): Promise<void> {
  const cliente = c.cliente;
  if (!cliente?.usable) return;
  const rango = `${c.ultimoUid + 1}:*`;
  // En Gmail, las promociones no merecen un aviso.
  const promociones = new Set(
    esGmail(c) ? (await cliente.search({ uid: rango, gmraw: "category:promotions" }, { uid: true })) || [] : [],
  );
  const mensajes: FetchMessageObject[] = [];
  for await (const m of cliente.fetch(rango, { uid: true, flags: true, source: { maxLength: 300_000 } }, { uid: true })) {
    if (m.uid > c.ultimoUid) mensajes.push(m);
  }
  if (mensajes.length === 0) return;
  c.ultimoUid = Math.max(c.ultimoUid, ...mensajes.map((m) => m.uid));
  for (const m of mensajes) {
    if (promociones.has(m.uid)) continue;
    alRecibir(await parsear(c.cuenta.usuario, m));
  }
  await contarNoLeidos(c);
}

function limpiarTexto(texto: string): string {
  return texto
    .split("\n")
    .filter((linea) => !linea.trimStart().startsWith(">"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXTO);
}

async function parsear(cuenta: string, m: FetchMessageObject): Promise<Email> {
  const correo = await simpleParser(m.source ?? Buffer.alloc(0));
  const remitente = correo.from?.value[0];
  const responderA = correo.replyTo?.value[0]?.address ?? remitente?.address ?? "";
  const texto =
    correo.text ??
    (typeof correo.html === "string" ? correo.html.replace(/<style[\s\S]*?<\/style>|<[^>]+>/g, " ").replace(/\s+/g, " ") : "");
  const references = correo.references ? (Array.isArray(correo.references) ? correo.references : [correo.references]) : [];
  return {
    cuenta,
    uid: m.uid,
    messageId: correo.messageId ?? "",
    references,
    de: remitente?.address ?? "",
    deNombre: remitente?.name || remitente?.address || "Desconocido",
    responderA,
    asunto: correo.subject ?? "(sin asunto)",
    texto: limpiarTexto(texto),
    fecha: (correo.date ?? new Date()).toISOString(),
    leido: m.flags?.has("\\Seen") ?? false,
  };
}

export async function leerEmails(cantidad = 5, soloNoLeidos = true, cuenta?: string): Promise<Email[]> {
  const elegidas = conexiones.filter((c) => c.estado === "conectado" && (!cuenta || c.cuenta.usuario === cuenta));
  if (elegidas.length === 0) throw new Error("No hay ninguna cuenta de correo conectada.");
  const todos: Email[] = [];
  for (const c of elegidas) {
    await encolar(c, async () => {
      const cliente = c.cliente!;
      const uids = (await cliente.search(soloNoLeidos ? { seen: false } : { all: true }, { uid: true })) || [];
      const ultimos = uids.slice(-cantidad);
      if (ultimos.length === 0) return;
      for await (const m of cliente.fetch(ultimos.join(","), { uid: true, flags: true, source: { maxLength: 300_000 } }, { uid: true })) {
        todos.push(await parsear(c.cuenta.usuario, m));
      }
    });
  }
  return todos.sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, cantidad);
}

export async function enviarEmail(envio: {
  cuenta?: string;
  para: string;
  asunto: string;
  texto: string;
  enRespuestaA?: { messageId: string; references: string[] };
}): Promise<void> {
  const conexion = conexiones.find((c) => c.cuenta.usuario === envio.cuenta) ?? conexiones[0];
  if (!conexion) throw new Error("No hay ninguna cuenta de correo configurada.");
  const { cuenta } = conexion;
  let transporte = transportes.get(cuenta.usuario);
  if (!transporte) {
    // iCloud solo acepta STARTTLS en el 587; el resto usa SSL en el 465.
    const starttls = cuenta.smtp === "smtp.mail.me.com";
    transporte = nodemailer.createTransport({
      host: cuenta.smtp,
      port: starttls ? 587 : 465,
      secure: !starttls,
      auth: { user: cuenta.usuario, pass: cuenta.clave },
    });
    transportes.set(cuenta.usuario, transporte);
  }
  const respuesta = envio.enRespuestaA?.messageId;
  await transporte.sendMail({
    from: cuenta.usuario,
    to: envio.para,
    subject: envio.asunto,
    text: envio.texto,
    ...(respuesta
      ? { inReplyTo: respuesta, references: [...(envio.enRespuestaA?.references ?? []), respuesta] }
      : {}),
  });
}
