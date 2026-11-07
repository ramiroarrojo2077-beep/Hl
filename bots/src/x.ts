// Publicar en X (API oficial v2) con las claves de la app de desarrollador del usuario (OAuth 1.0a, contexto
// de usuario): publicaciones con hasta 4 imágenes, hilos, respuestas, borrar y leer las propias. También la
// cola de publicaciones programadas. Las claves se guardan cifradas en conexiones.ts; acá llegan ya descifradas.

import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { COMPUTADORA, DATOS, ahora, nuevoId } from "./almacen.ts";

export interface CredencialesX { apiKey: string; apiSecret: string; accessToken: string; accessSecret: string }
const API = () => (process.env.X_API_BASE ?? "https://api.x.com").replace(/\/$/, "");
const SUBIDA_V1 = () => (process.env.X_UPLOAD_BASE ?? "https://upload.twitter.com").replace(/\/$/, "");
export const MAX_PESO = 280;
export const MAX_IMAGENES = 4;

// ---- OAuth 1.0a (HMAC-SHA1) ----

/** Codificación de OAuth (RFC 3986): todo menos A-Z a-z 0-9 - . _ ~ */
export const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Cabecera Authorization firmada. `extra` son los parámetros que entran en la firma además de los de la URL:
 * los de un cuerpo application/x-www-form-urlencoded (los cuerpos JSON y multipart no entran).
 */
export function firmarOAuth1(metodo: string, url: string, c: CredencialesX, extra: Record<string, string> = {}, fijo?: { nonce: string; timestamp: string }): string {
  const u = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: c.apiKey,
    oauth_nonce: fijo?.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: fijo?.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_token: c.accessToken,
    oauth_version: "1.0",
  };
  const pares: [string, string][] = [...Object.entries(oauth), ...Object.entries(extra), ...[...u.searchParams.entries()]].map(([k, v]) => [pct(k), pct(v)]);
  pares.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const base = [metodo.toUpperCase(), pct(`${u.origin}${u.pathname}`), pct(pares.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
  const firma = createHmac("sha1", `${pct(c.apiSecret)}&${pct(c.accessSecret)}`).update(base).digest("base64");
  return "OAuth " + Object.entries({ ...oauth, oauth_signature: firma }).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(", ");
}

// ---- Largo de una publicación (como lo cuenta X) ----

const URL_RE = /https?:\/\/[^\s]+/g;
/** Peso de un texto: la mayoría de los caracteres latinos pesan 1; CJK y emojis, 2; cada enlace, 23. */
export function peso(texto: string): number {
  let total = 0;
  const sinUrls = texto.replace(URL_RE, () => { total += 23; return ""; });
  const segmentador = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("es", { granularity: "grapheme" }) : null;
  const grafemas = segmentador ? [...segmentador.segment(sinUrls)].map((s) => s.segment) : [...sinUrls];
  for (const g of grafemas) {
    if (/\p{Extended_Pictographic}/u.test(g)) { total += 2; continue; }
    const cp = g.codePointAt(0)!;
    const liviano = cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);
    total += liviano ? 1 : 2;
  }
  return total;
}

/**
 * Parte un texto largo en un hilo: corta en párrafos, después en oraciones y por último en palabras, y
 * numera cada parte (1/3, 2/3…) si hay más de una. Ninguna parte pasa el máximo.
 */
export function dividirHilo(texto: string, max = MAX_PESO): string[] {
  const limpio = texto.trim();
  if (!limpio) return [];
  if (peso(limpio) <= max) return [limpio];
  const reserva = 7; // " 12/12"
  const tope = max - reserva;
  const trozos: string[] = [];
  const meter = (pieza: string) => {
    const ult = trozos.length ? trozos[trozos.length - 1]! : null;
    const junto = ult === null ? pieza : `${ult}${/\n$/.test(ult) ? "" : " "}${pieza}`;
    if (ult !== null && peso(junto) <= tope) trozos[trozos.length - 1] = junto;
    else trozos.push(pieza);
  };
  for (const parrafo of limpio.split(/\n{2,}/)) {
    const oraciones = parrafo.match(/[^.!?…]+[.!?…]+["»)]*\s*|[^.!?…]+$/g) ?? [parrafo];
    let primera = true;
    for (const o of oraciones.map((x) => x.trim()).filter(Boolean)) {
      if (peso(o) <= tope) { if (primera && trozos.length) trozos.push(o); else meter(o); }
      else for (const palabra of o.split(/\s+/)) {
        if (peso(palabra) > tope) { let resto = palabra; while (resto) { let n = tope; while (peso(resto.slice(0, n)) > tope) n--; trozos.push(resto.slice(0, n)); resto = resto.slice(n); } }
        else meter(palabra);
      }
      primera = false;
    }
  }
  return trozos.length > 1 ? trozos.map((t, i) => `${t} ${i + 1}/${trozos.length}`) : trozos;
}

// ---- API ----

async function llamar(c: CredencialesX, metodo: string, url: string, op: { json?: unknown; multipart?: FormData; ms?: number } = {}): Promise<Record<string, unknown>> {
  const r = await fetch(url, {
    method: metodo,
    headers: { authorization: firmarOAuth1(metodo, url, c), "user-agent": "Gravity", ...(op.json ? { "content-type": "application/json" } : {}) },
    body: op.json ? JSON.stringify(op.json) : op.multipart,
    signal: AbortSignal.timeout(op.ms ?? 30_000),
  });
  const texto = await r.text();
  let j: Record<string, unknown> = {};
  try { j = texto ? JSON.parse(texto) : {}; } catch { /* respuesta sin JSON */ }
  if (r.ok) return j;
  const detalle = String((j.detail as string) ?? ((j.errors as { message?: string }[] | undefined)?.[0]?.message) ?? (j.title as string) ?? "").slice(0, 300);
  if (r.status === 401) throw Object.assign(new Error("X rechazó las claves: revisá que sean de la misma app y que el Access Token se haya generado después de darle permiso de escritura."), { status: 401 });
  if (r.status === 403) throw Object.assign(new Error(`X no permite esta acción con estas claves${detalle ? ` (${detalle})` : ""}. Revisá que la app tenga permisos «Read and write» y que tu plan de la API lo incluya.`), { status: 403 });
  if (r.status === 429) {
    const reset = Number(r.headers.get("x-rate-limit-reset") ?? 0);
    throw Object.assign(new Error(`Llegaste al límite de la API de X${reset ? `; se libera ${new Date(reset * 1000).toLocaleString("es-AR")}` : ""}.`), { status: 429 });
  }
  if (r.status === 402) throw Object.assign(new Error("Tu plan de la API de X no tiene crédito para esta acción."), { status: 402 });
  throw Object.assign(new Error(`X respondió ${r.status}${detalle ? `: ${detalle}` : ""}.`), { status: r.status });
}

export async function yo(c: CredencialesX): Promise<{ id: string; usuario: string; nombre: string }> {
  const r = await llamar(c, "GET", `${API()}/2/users/me`);
  const d = (r.data ?? {}) as { id?: string; username?: string; name?: string };
  if (!d.id) throw new Error("X no devolvió el usuario.");
  return { id: d.id, usuario: d.username ?? "", nombre: d.name ?? "" };
}

const TIPOS_IMG: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
/** Lee una imagen de la computadora para adjuntarla (PNG, JPG, WEBP o GIF, hasta 5 MB). */
export function imagenDeRuta(ruta: string): { datos: Buffer; mime: string; nombre: string } {
  const abs = path.resolve(COMPUTADORA, ruta);
  if (!abs.startsWith(COMPUTADORA + path.sep) || !existsSync(abs) || !statSync(abs).isFile()) throw new Error(`No está en la computadora: ${ruta}`);
  const mime = TIPOS_IMG[path.extname(abs).toLowerCase()];
  if (!mime) throw new Error(`${path.basename(abs)}: X acepta PNG, JPG, WEBP o GIF.`);
  if (statSync(abs).size > 5 * 1024 * 1024) throw new Error(`${path.basename(abs)} pasa los 5 MB.`);
  return { datos: readFileSync(abs), mime, nombre: path.basename(abs) };
}

/** Sube una imagen y devuelve su id de medio (endpoint v2; si no está, el v1.1). */
export async function subirImagen(c: CredencialesX, img: { datos: Buffer; mime: string; nombre: string }): Promise<string> {
  const form = () => { const f = new FormData(); f.append("media", new Blob([new Uint8Array(img.datos)], { type: img.mime }), img.nombre); return f; };
  try {
    const f = form();
    f.append("media_category", "tweet_image");
    const r = await llamar(c, "POST", `${API()}/2/media/upload`, { multipart: f, ms: 120_000 });
    const id = String(((r.data ?? {}) as { id?: string }).id ?? r.media_id_string ?? "");
    if (id) return id;
  } catch (err) {
    const st = (err as { status?: number }).status;
    if (st !== 404 && st !== 400 && st !== 405) throw err;
  }
  const r = await llamar(c, "POST", `${SUBIDA_V1()}/1.1/media/upload.json`, { multipart: form(), ms: 120_000 });
  const id = String(r.media_id_string ?? "");
  if (!id) throw new Error("X no devolvió el id de la imagen.");
  return id;
}

export async function postear(c: CredencialesX, texto: string, op: { medios?: string[]; responderA?: string | null } = {}): Promise<{ id: string; texto: string }> {
  const t = texto.trim();
  if (!t && !op.medios?.length) throw new Error("La publicación está vacía.");
  if (peso(t) > MAX_PESO) throw new Error(`La publicación pesa ${peso(t)} de ${MAX_PESO}: dividila en un hilo.`);
  const r = await llamar(c, "POST", `${API()}/2/tweets`, { json: { text: t, ...(op.medios?.length ? { media: { media_ids: op.medios } } : {}), ...(op.responderA ? { reply: { in_reply_to_tweet_id: op.responderA } } : {}) } });
  const d = (r.data ?? {}) as { id?: string; text?: string };
  if (!d.id) throw new Error("X no devolvió la publicación.");
  return { id: d.id, texto: d.text ?? t };
}

/**
 * Publica uno o varios textos como hilo (cada uno responde al anterior). Las imágenes van en la primera
 * publicación. Si una parte falla, lo publicado queda y el error dice desde dónde seguir.
 */
export async function publicarHilo(c: CredencialesX, textos: string[], imagenes: string[] = [], responderA: string | null = null): Promise<{ ids: string[]; usuario: string; urls: string[] }> {
  const partes = textos.map((t) => t.trim()).filter(Boolean);
  if (!partes.length && !imagenes.length) throw new Error("No hay nada para publicar.");
  if (imagenes.length > MAX_IMAGENES) throw new Error(`Hasta ${MAX_IMAGENES} imágenes por publicación.`);
  for (const [i, t] of partes.entries()) if (peso(t) > MAX_PESO) throw new Error(`La parte ${i + 1} pesa ${peso(t)} de ${MAX_PESO}.`);
  const imgs = imagenes.map(imagenDeRuta);
  const quien = await yo(c);
  const medios: string[] = [];
  for (const img of imgs) medios.push(await subirImagen(c, img));
  const ids: string[] = [];
  let anterior = responderA;
  for (const [i, t] of (partes.length ? partes : [""]).entries()) {
    try {
      const r = await postear(c, t, { medios: i === 0 ? medios : [], responderA: anterior });
      ids.push(r.id);
      anterior = r.id;
    } catch (err) {
      if (!ids.length) throw err;
      throw new Error(`Se publicaron ${ids.length} de ${partes.length} partes (${ids.map((x) => urlDe(quien.usuario, x)).join(", ")}). Falló la parte ${i + 1}: ${(err as Error).message}`);
    }
  }
  return { ids, usuario: quien.usuario, urls: ids.map((x) => urlDe(quien.usuario, x)) };
}
export const urlDe = (usuario: string, id: string) => `https://x.com/${usuario || "i/web"}/status/${id}`;

export async function borrar(c: CredencialesX, id: string): Promise<void> {
  if (!/^\d{1,25}$/.test(id)) throw new Error("Id de publicación inválido.");
  const r = await llamar(c, "DELETE", `${API()}/2/tweets/${id}`);
  if ((r.data as { deleted?: boolean } | undefined)?.deleted === false) throw new Error("X no la borró.");
}

export async function mias(c: CredencialesX, max = 10): Promise<{ id: string; texto: string; fecha: string; metricas: Record<string, number> }[]> {
  const u = await yo(c);
  const r = await llamar(c, "GET", `${API()}/2/users/${u.id}/tweets?max_results=${Math.min(100, Math.max(5, max))}&tweet.fields=created_at,public_metrics`);
  return ((r.data ?? []) as { id: string; text: string; created_at?: string; public_metrics?: Record<string, number> }[]).map((t) => ({ id: t.id, texto: t.text, fecha: t.created_at ?? "", metricas: t.public_metrics ?? {} }));
}

// ---- Programadas e historial ----

export interface Programada { id: string; conexion: string; textos: string[]; imagenes: string[]; cuando: string; estado: "pendiente" | "publicando" | "publicada" | "error" | "cancelada"; resultado: { urls: string[] } | null; error: string | null; creada: string }
export interface Publicada { conexion: string; usuario: string; ids: string[]; urls: string[]; texto: string; fecha: string; quien: string; borrada?: boolean }
const ARCHIVO = path.join(DATOS, "x.json");
const est: { programadas: Programada[]; historial: Publicada[] } = existsSync(ARCHIVO) ? JSON.parse(readFileSync(ARCHIVO, "utf8")) : { programadas: [], historial: [] };
const guardar = () => writeFileSync(ARCHIVO, JSON.stringify(est, null, 1));
// Si Gravity se cortó mientras publicaba, no se reintenta sola (podría duplicarse): queda para revisar.
for (const p of est.programadas) if (p.estado === "publicando") Object.assign(p, { estado: "error", error: "Se interrumpió mientras se publicaba: fijate en X si salió antes de volver a programarla." });
export const programadas = () => est.programadas.filter((p) => p.estado !== "cancelada").sort((a, b) => a.cuando.localeCompare(b.cuando)).slice(-100);
export const historial = () => est.historial.slice().reverse().slice(0, 100);
export function anotar(p: Omit<Publicada, "fecha">): void { est.historial.push({ ...p, fecha: ahora() }); if (est.historial.length > 300) est.historial.splice(0, est.historial.length - 300); guardar(); }
export function marcarBorrada(id: string): void { for (const h of est.historial) if (h.ids.includes(id)) h.borrada = true; guardar(); }
export function programar(d: { conexion: string; textos: string[]; imagenes: string[]; cuando: string }): Programada {
  const t = Date.parse(d.cuando);
  if (!Number.isFinite(t)) throw new Error("Fecha inválida.");
  if (t < Date.now() + 30_000) throw new Error("Elegí un momento del futuro (al menos un minuto).");
  if (t > Date.now() + 365 * 86_400_000) throw new Error("Hasta un año para adelante.");
  for (const [i, x] of d.textos.entries()) if (peso(x) > MAX_PESO) throw new Error(`La parte ${i + 1} pesa ${peso(x)} de ${MAX_PESO}.`);
  for (const r of d.imagenes) imagenDeRuta(r);
  const p: Programada = { id: nuevoId(), ...d, cuando: new Date(t).toISOString(), estado: "pendiente", resultado: null, error: null, creada: ahora() };
  est.programadas.push(p);
  guardar();
  return p;
}
export function cancelar(id: string): void {
  const p = est.programadas.find((x) => x.id === id);
  if (!p) throw new Error("No existe esa publicación programada.");
  if (p.estado !== "pendiente") throw new Error("Ya no está pendiente.");
  p.estado = "cancelada";
  guardar();
}
/** Publica las que llegaron a su hora. `credenciales` resuelve la conexión (devuelve null si ya no existe). */
export async function revisarProgramadas(credenciales: (id: string) => CredencialesX | null, alPublicar?: () => void): Promise<number> {
  let n = 0;
  for (const p of est.programadas) {
    if (p.estado !== "pendiente" || Date.parse(p.cuando) > Date.now()) continue;
    p.estado = "publicando";
    guardar();
    try {
      const c = credenciales(p.conexion);
      if (!c) throw new Error("La conexión de X ya no existe.");
      const r = await publicarHilo(c, p.textos, p.imagenes);
      p.estado = "publicada"; p.resultado = { urls: r.urls };
      anotar({ conexion: p.conexion, usuario: r.usuario, ids: r.ids, urls: r.urls, texto: p.textos.join("\n\n"), quien: "programada" });
      n++;
    } catch (err) {
      p.estado = "error"; p.error = (err as Error).message.slice(0, 500);
    }
    guardar();
  }
  if (n) alPublicar?.();
  return n;
}
