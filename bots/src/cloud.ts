// Gravity Cloud: vincular otros Gravity (en una PC, un servidor propio o la nube) con su dirección y su
// clave, y usarlos para lo pesado: compilar o probar un proyecto de Gravity Code allá, ver su estado,
// mandarle mensajes a sus compañeros y guardar copias de seguridad cifradas. La clave se guarda cifrada
// (igual que las de las conexiones) y las copias viajan cifradas con AES-256-GCM.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DATOS, ahora, nuevoId } from "./almacen.ts";
import { cifrarSecreto, descifrarSecreto } from "./conexiones.ts";
import { carpetaProyecto } from "./codigo.ts";
import { exportar as exportarRespaldo, exportarCarpeta } from "./respaldo.ts";

export interface Servidor {
  id: string;
  nombre: string;
  url: string;
  clave: string; // cifrada
  creado: string;
  historial: { fecha: string; ok: boolean; ms: number; error?: string }[];
  ultimo: { fecha: string; ok: boolean; ms: number; compañeros?: number; trabajando?: number; gastoHoy?: number; cpu?: number; memoriaMb?: number; error?: string } | null;
}

const ARCHIVO = path.join(DATOS, "servidores.json");
let servidores: Servidor[] = existsSync(ARCHIVO) ? (JSON.parse(readFileSync(ARCHIVO, "utf8")) as Servidor[]) : [];
const guardar = () => writeFileSync(ARCHIVO, JSON.stringify(servidores, null, 1));
const sesiones = new Map<string, string>();
const vista = (s: Servidor) => ({ ...s, clave: undefined });
export const listarServidores = () => servidores.map(vista);
const buscar = (id: string) => { const s = servidores.find((x) => x.id === id); if (!s) throw new Error("No existe ese servidor."); return s; };

export function agregarServidor(d: { nombre: string; url: string; clave: string }): ReturnType<typeof vista> {
  let u: URL;
  try { u = new URL(d.url); } catch { throw new Error("Dirección inválida (ej.: https://mi-pc.ejemplo.com o http://192.168.0.10:3001)."); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("La dirección empieza con http:// o https://.");
  if (!d.clave) throw new Error("Falta la clave de ese Gravity (BOTS_CLAVE o la que pusiste en sus Ajustes).");
  const s: Servidor = { id: nuevoId(), nombre: d.nombre.trim().slice(0, 60) || u.host, url: u.origin, clave: cifrarSecreto(d.clave), creado: ahora(), historial: [], ultimo: null };
  servidores.push(s);
  guardar();
  return vista(s);
}
export function quitarServidor(id: string): void {
  servidores = servidores.filter((s) => s.id !== id);
  sesiones.delete(id);
  guardar();
}

async function entrar(s: Servidor): Promise<string> {
  const r = await fetch(`${s.url}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clave: descifrarSecreto<string>(s.clave) }), signal: AbortSignal.timeout(15_000) });
  if (r.status === 401) throw new Error("La clave de ese Gravity no es correcta.");
  // Un Gravity que no pide sesión (en la misma máquina, o abierto en su red) no tiene /api/login.
  if (r.status === 404) {
    const e = await fetch(`${s.url}/api/estado`, { signal: AbortSignal.timeout(15_000) });
    if (e.ok) { sesiones.set(s.id, "-"); return "-"; }
  }
  if (!r.ok) throw new Error(`El servidor respondió ${r.status} al iniciar sesión.`);
  const cookie = /gravity_sesion=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1];
  if (!cookie) throw new Error("El servidor no devolvió sesión (¿es un Gravity?).");
  sesiones.set(s.id, cookie);
  return cookie;
}

/** Pedido autenticado a otro Gravity (reintenta una vez iniciando sesión si venció). */
export async function pedir(id: string, metodo: string, ruta: string, cuerpo?: unknown, op: { binario?: Buffer; crudo?: boolean; ms?: number } = {}): Promise<unknown> {
  const s = buscar(id);
  for (let intento = 0; intento < 2; intento++) {
    const cookie = sesiones.get(id) ?? (await entrar(s));
    const r = await fetch(`${s.url}${ruta}`, {
      method: metodo,
      headers: { ...(cookie !== "-" ? { cookie: `gravity_sesion=${cookie}` } : {}), ...(op.binario ? { "content-type": "application/octet-stream" } : cuerpo !== undefined ? { "content-type": "application/json" } : {}) },
      body: op.binario ? new Uint8Array(op.binario) : cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(op.ms ?? 60_000),
    });
    if (r.status === 401 && intento === 0) { sesiones.delete(id); continue; }
    if (op.crudo) { if (!r.ok) throw new Error(`El servidor respondió ${r.status}.`); return Buffer.from(await r.arrayBuffer()); }
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) throw new Error(j.error ?? `El servidor respondió ${r.status}.`);
    return j;
  }
  throw new Error("No se pudo iniciar sesión en ese servidor.");
}

/** Monitor: disponibilidad, tiempo de respuesta y métricas (compañeros, trabajando, gasto, CPU, memoria). */
export async function revisar(id: string): Promise<Servidor["ultimo"]> {
  const s = buscar(id);
  const t0 = Date.now();
  let u: NonNullable<Servidor["ultimo"]>;
  try {
    const e = (await pedir(id, "GET", "/api/estado", undefined, { ms: 20_000 })) as { bots?: { estado?: string }[]; gasto?: { hoy?: number } };
    const rend = (await pedir(id, "GET", "/api/rendimiento", undefined, { ms: 20_000 }).catch(() => null)) as { cpu?: number; memoria?: { rss?: number } } | null;
    u = { fecha: ahora(), ok: true, ms: Date.now() - t0, compañeros: e.bots?.length ?? 0, trabajando: e.bots?.filter((b) => b.estado === "trabajando").length ?? 0, gastoHoy: e.gasto?.hoy ?? 0, cpu: rend?.cpu, memoriaMb: rend?.memoria?.rss ? Math.round(rend.memoria.rss / 1048576) : undefined };
  } catch (err) {
    u = { fecha: ahora(), ok: false, ms: Date.now() - t0, error: (err as Error).message.slice(0, 200) };
  }
  s.ultimo = u;
  s.historial.push({ fecha: u.fecha, ok: u.ok, ms: u.ms, ...(u.error ? { error: u.error } : {}) });
  if (s.historial.length > 100) s.historial.splice(0, s.historial.length - 100);
  guardar();
  return u;
}
export function iniciarMonitorServidores(): void {
  setInterval(() => { for (const s of servidores) void revisar(s.id).catch(() => {}); }, 10 * 60_000).unref();
}

/** Sube un proyecto de Gravity Code a ese servidor (zip; allá se crea o se actualiza). */
export async function subirProyecto(id: string, proyecto: string): Promise<{ archivos: number }> {
  const dir = mkdtempSync(path.join(tmpdir(), "gravity-subir-"));
  try {
    const zip = path.join(dir, "p.zip");
    exportarCarpeta(carpetaProyecto(proyecto), zip);
    return (await pedir(id, "POST", `/api/code/importar-zip?p=${encodeURIComponent(proyecto)}`, undefined, { binario: readFileSync(zip), ms: 300_000 })) as { archivos: number };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Corre un comando del proyecto en el servidor (antes lo sube) y devuelve el trabajo para seguirlo. */
export async function ejecutarRemoto(id: string, proyecto: string, comando: string, limites: { memoriaMb?: number | null; cpuSeg?: number | null } = {}): Promise<unknown> {
  await subirProyecto(id, proyecto);
  return pedir(id, "POST", `/api/code/ejecutar?p=${encodeURIComponent(proyecto)}`, { comando, aislado: false, ...limites });
}
export const trabajosRemotos = (id: string, proyecto?: string) => pedir(id, "GET", `/api/code/ejecuciones${proyecto ? `?p=${encodeURIComponent(proyecto)}` : ""}`);

/** Trae un archivo del servidor (por ejemplo, el APK compilado) a la computadora local. */
export async function traerArchivo(id: string, ruta: string, destino: string): Promise<number> {
  const b = (await pedir(id, "GET", `/api/computadora/archivo?ruta=${encodeURIComponent(ruta)}&descargar=1`, undefined, { crudo: true, ms: 300_000 })) as Buffer;
  writeFileSync(destino, b);
  return b.length;
}

// ---- Copias cifradas (sincronización y respaldo remoto) ----

const MAGIA = Buffer.from("GRAVITY-COPIA-1\n");
export function cifrarCopia(datos: Buffer, clave: string): Buffer {
  const sal = randomBytes(16), iv = randomBytes(12);
  const k = scryptSync(clave, sal, 32);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const cuerpo = Buffer.concat([c.update(datos), c.final()]);
  return Buffer.concat([MAGIA, sal, iv, c.getAuthTag(), cuerpo]);
}
export function descifrarCopia(datos: Buffer, clave: string): Buffer {
  if (!datos.subarray(0, MAGIA.length).equals(MAGIA)) throw new Error("No es una copia cifrada de Gravity.");
  let p = MAGIA.length;
  const sal = datos.subarray(p, (p += 16)), iv = datos.subarray(p, (p += 12)), tag = datos.subarray(p, (p += 16));
  const d = createDecipheriv("aes-256-gcm", scryptSync(clave, sal, 32), iv);
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(datos.subarray(p)), d.final()]); } catch { throw new Error("La clave no corresponde a esa copia (o está dañada)."); }
}

/** Manda una copia de seguridad completa, cifrada con la clave del servidor, a ese Gravity. */
export async function enviarCopia(id: string): Promise<{ ruta: string; bytes: number }> {
  const s = buscar(id);
  const dir = mkdtempSync(path.join(tmpdir(), "gravity-copia-"));
  try {
    const zip = path.join(dir, "copia.zip");
    exportarRespaldo(zip);
    const cifrada = cifrarCopia(readFileSync(zip), descifrarSecreto<string>(s.clave));
    return (await pedir(id, "POST", "/api/cloud/recibir", undefined, { binario: cifrada, ms: 600_000 })) as { ruta: string; bytes: number };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** Trae una copia cifrada del servidor y la deja descifrada (zip) para restaurarla desde Ajustes. */
export async function traerCopia(id: string, ruta: string, destino: string): Promise<number> {
  const s = buscar(id);
  const b = (await pedir(id, "GET", `/api/computadora/archivo?ruta=${encodeURIComponent(ruta)}&descargar=1`, undefined, { crudo: true, ms: 600_000 })) as Buffer;
  const zip = descifrarCopia(b, descifrarSecreto<string>(s.clave));
  writeFileSync(destino, zip);
  return zip.length;
}

// ---- Cola distribuida: varios comandos repartidos entre los servidores que respondan ----

/**
 * Reparte los comandos entre los servidores vinculados que estén disponibles, empezando por los más libres
 * (menos compañeros trabajando, menos CPU). El proyecto se sube una vez a cada servidor que reciba trabajo.
 * Si un servidor falla al recibirlo, el comando pasa al siguiente disponible.
 */
export async function repartir(proyecto: string, comandos: string[], limites: { memoriaMb?: number | null; cpuSeg?: number | null } = {}): Promise<{ comando: string; servidor?: string; nombre?: string; trabajo?: unknown; error?: string }[]> {
  if (!comandos.length) throw new Error("Escribí al menos un comando.");
  const estados = await Promise.all(servidores.map(async (s) => ({ s, u: await revisar(s.id).catch(() => null) })));
  const libres = estados.filter((x) => x.u?.ok).sort((a, b) => (a.u!.trabajando ?? 0) - (b.u!.trabajando ?? 0) || (a.u!.cpu ?? 0) - (b.u!.cpu ?? 0)).map((x) => x.s);
  if (!libres.length) throw new Error("Ningún servidor vinculado responde ahora.");
  const subidos = new Set<string>(), caidos = new Set<string>();
  const res: { comando: string; servidor?: string; nombre?: string; trabajo?: unknown; error?: string }[] = [];
  let turno = 0;
  for (const comando of comandos) {
    let hecho = false, ultimoError = "";
    for (let i = 0; i < libres.length && !hecho; i++) {
      const s = libres[(turno + i) % libres.length]!;
      if (caidos.has(s.id)) continue;
      try {
        if (!subidos.has(s.id)) { await subirProyecto(s.id, proyecto); subidos.add(s.id); }
        const trabajo = await pedir(s.id, "POST", `/api/code/ejecutar?p=${encodeURIComponent(proyecto)}`, { comando, aislado: false, ...limites });
        res.push({ comando, servidor: s.id, nombre: s.nombre, trabajo });
        turno = (turno + i + 1) % libres.length;
        hecho = true;
      } catch (err) {
        caidos.add(s.id);
        ultimoError = (err as Error).message;
      }
    }
    if (!hecho) res.push({ comando, error: ultimoError || "Ningún servidor pudo recibirlo." });
  }
  return res;
}
