// Copia de seguridad de los datos de Gravity: un .zip común (se abre en cualquier compu) con todo lo de
// la carpeta de datos — compañeros, conversaciones, memoria, rutinas, tareas, reuniones, mensajería y la
// computadora de los bots. Quedan afuera los secretos de las conexiones (se vuelven a conectar) y las
// sesiones. Restaurar no borra nada: la carpeta anterior queda al lado como gravity-antes-<fecha>.

import { closeSync, cpSync, existsSync, mkdirSync, openSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";
import { DATOS, vaciarEscrituras } from "./almacen.ts";

const FORMATO = 1;
const MANIFIESTO = "gravity-respaldo.json";
// No viajan en el respaldo: claves de las conexiones y sesiones abiertas de otros dispositivos.
const EXCLUIDOS = new Set([".clave-conexiones", "conexiones.json", "sesiones.json"]);
const MAX_ARCHIVO = 200 * 1024 * 1024;
const MAX_TOTAL = 2 * 1024 * 1024 * 1024;
const MAX_ENTRADAS = 60_000;

export interface ResumenRespaldo {
  archivos: number;
  bytes: number;
  omitidos: string[];
}

function listar(dir: string, base = ""): { ruta: string; abs: string; tam: number }[] {
  const salida: { ruta: string; abs: string; tam: number }[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    const abs = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) salida.push(...listar(abs, rel));
    else if (e.isFile() && !EXCLUIDOS.has(rel) && !e.name.endsWith(".tmp")) salida.push({ ruta: rel, abs, tam: statSync(abs).size });
  }
  return salida;
}

/** Fecha y hora en el formato de MS-DOS que usa el zip. */
function fechaDos(d: Date): { hora: number; fecha: number } {
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    fecha: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Escribe un zip (deflate) con las entradas dadas, en orden. Devuelve los bytes sin comprimir. */
function escribirZip(destino: string, entradas: { ruta: string; leer: () => Buffer; mtime: Date }[]): number {
  if (entradas.length > MAX_ENTRADAS) throw new Error("Hay demasiados archivos para un zip.");
  const fd = openSync(destino, "w");
  const central: Buffer[] = [];
  let desplazamiento = 0;
  let total = 0;
  const escribir = (b: Buffer) => {
    writeSync(fd, b);
    desplazamiento += b.length;
  };
  const agregar = (nombre: string, datos: Buffer, mtime: Date) => {
    const nom = Buffer.from(nombre, "utf8");
    const comprimido = deflateRawSync(datos, { level: 6 });
    const usarDeflate = comprimido.length < datos.length;
    const cuerpo = usarDeflate ? comprimido : datos;
    const crc = crc32(datos);
    const { hora, fecha } = fechaDos(mtime);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(usarDeflate ? 8 : 0, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(fecha, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(cuerpo.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nom.length, 26);
    local.writeUInt16LE(0, 28);
    const inicio = desplazamiento;
    escribir(local);
    escribir(nom);
    escribir(cuerpo);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(usarDeflate ? 8 : 0, 10);
    c.writeUInt16LE(hora, 12);
    c.writeUInt16LE(fecha, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(cuerpo.length, 20);
    c.writeUInt32LE(datos.length, 24);
    c.writeUInt16LE(nom.length, 28);
    c.writeUInt32LE(inicio, 42);
    central.push(c, nom);
  };
  try {
    for (const e of entradas) {
      const datos = e.leer();
      total += datos.length;
      if (total > MAX_TOTAL) throw new Error("Los datos pasan los 2 GB: borrá archivos grandes de la computadora de los bots y probá de nuevo.");
      agregar(e.ruta, datos, e.mtime);
    }
    const inicioCentral = desplazamiento;
    for (const b of central) escribir(b);
    const fin = Buffer.alloc(22);
    fin.writeUInt32LE(0x06054b50, 0);
    fin.writeUInt16LE(entradas.length, 8);
    fin.writeUInt16LE(entradas.length, 10);
    fin.writeUInt32LE(desplazamiento - inicioCentral, 12);
    fin.writeUInt32LE(inicioCentral, 16);
    escribir(fin);
  } finally {
    closeSync(fd);
  }
  return total;
}

/** Escribe el respaldo en `destino` (zip con deflate). */
export function exportar(destino: string): ResumenRespaldo {
  vaciarEscrituras();
  const todos = listar(DATOS);
  const omitidos = todos.filter((a) => a.tam > MAX_ARCHIVO).map((a) => a.ruta);
  const archivos = todos.filter((a) => a.tam <= MAX_ARCHIVO);
  const manifiesto = Buffer.from(JSON.stringify({ formato: FORMATO, app: "Gravity", creado: new Date().toISOString(), excluidos: [...EXCLUIDOS], omitidos }, null, 2));
  const total = escribirZip(destino, [
    { ruta: MANIFIESTO, leer: () => manifiesto, mtime: new Date() },
    ...archivos.map((a) => ({ ruta: a.ruta, leer: () => readFileSyncSeguro(a.abs), mtime: statSync(a.abs).mtime })),
  ]);
  return { archivos: archivos.length, bytes: total, omitidos };
}

/** Zip de una carpeta cualquiera (por ejemplo un proyecto de código), sin node_modules ni .git. */
export function exportarCarpeta(dir: string, destino: string, prefijo = ""): number {
  const archivos = listar(dir).filter((a) => a.tam <= MAX_ARCHIVO && !/(^|\/)(node_modules|\.git)\//.test(a.ruta));
  escribirZip(destino, archivos.map((a) => ({ ruta: prefijo ? `${prefijo}/${a.ruta}` : a.ruta, leer: () => readFileSyncSeguro(a.abs), mtime: statSync(a.abs).mtime })));
  return archivos.length;
}

/**
 * Extrae un zip común en `destino` (carpeta nueva) validando rutas, tamaños y CRC. Con `quitarRaiz`,
 * si todo está dentro de una sola carpeta (como los zip de GitHub), se saca ese nivel.
 */
export function extraerZip(zip: string, destino: string, op: { quitarRaiz?: boolean; maxBytes?: number } = {}): number {
  const fd = openSync(zip, "r");
  let archivos = 0;
  let bytes = 0;
  const max = op.maxBytes ?? 300 * 1024 * 1024;
  try {
    const entradas = leerIndice(fd, statSync(zip).size).filter((e) => !e.nombre.endsWith("/"));
    const raices = new Set(entradas.map((e) => e.nombre.split("/")[0]));
    const quitar = op.quitarRaiz && raices.size === 1 && entradas.every((e) => e.nombre.includes("/")) ? [...raices][0]!.length + 1 : 0;
    mkdirSync(destino, { recursive: true });
    for (const e of entradas) {
      if (!rutaValida(e.nombre)) throw new Error(`Ruta inválida en el zip: ${e.nombre}`);
      const nombre = e.nombre.slice(quitar);
      if (!nombre) continue;
      bytes += e.tam;
      if (e.tam > MAX_ARCHIVO || bytes > max) throw new Error("El zip es demasiado grande.");
      const cab = Buffer.alloc(30);
      readSync(fd, cab, 0, 30, e.local);
      if (cab.readUInt32LE(0) !== 0x04034b50) throw new Error("El zip está dañado.");
      const inicio = e.local + 30 + cab.readUInt16LE(26) + cab.readUInt16LE(28);
      const cuerpo = Buffer.alloc(e.comprimido);
      readSync(fd, cuerpo, 0, e.comprimido, inicio);
      const datos = e.metodo === 8 ? inflateRawSync(cuerpo, { maxOutputLength: MAX_ARCHIVO }) : e.metodo === 0 ? cuerpo : null;
      if (!datos) throw new Error(`Compresión no soportada en ${e.nombre}.`);
      if (datos.length !== e.tam || crc32(datos) !== e.crc) throw new Error(`El archivo ${e.nombre} llegó dañado.`);
      const abs = path.join(destino, ...nombre.split("/"));
      if (!abs.startsWith(destino + path.sep)) throw new Error(`Ruta inválida en el zip: ${e.nombre}`);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, datos);
      archivos++;
    }
  } finally {
    closeSync(fd);
  }
  return archivos;
}

function readFileSyncSeguro(abs: string): Buffer {
  const fd = openSync(abs, "r");
  try {
    const tam = statSync(abs).size;
    const b = Buffer.alloc(tam);
    let leidos = 0;
    while (leidos < tam) {
      const n = readSync(fd, b, leidos, tam - leidos, leidos);
      if (!n) break;
      leidos += n;
    }
    return b.subarray(0, leidos);
  } finally {
    closeSync(fd);
  }
}

interface Entrada {
  nombre: string;
  metodo: number;
  crc: number;
  comprimido: number;
  tam: number;
  local: number;
}

function leerIndice(fd: number, tamArchivo: number): Entrada[] {
  const cola = Math.min(tamArchivo, 65_557);
  const b = Buffer.alloc(cola);
  readSync(fd, b, 0, cola, tamArchivo - cola);
  let fin = -1;
  for (let i = cola - 22; i >= 0; i--) if (b.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error("El archivo no es un zip válido.");
  const cantidad = b.readUInt16LE(fin + 10);
  const tamCentral = b.readUInt32LE(fin + 12);
  const inicioCentral = b.readUInt32LE(fin + 16);
  if (cantidad > MAX_ENTRADAS || inicioCentral + tamCentral > tamArchivo) throw new Error("El zip está dañado.");
  const c = Buffer.alloc(tamCentral);
  readSync(fd, c, 0, tamCentral, inicioCentral);
  const entradas: Entrada[] = [];
  let p = 0;
  for (let i = 0; i < cantidad; i++) {
    if (c.readUInt32LE(p) !== 0x02014b50) throw new Error("El zip está dañado.");
    const largoNombre = c.readUInt16LE(p + 28);
    const largoExtra = c.readUInt16LE(p + 30);
    const largoComentario = c.readUInt16LE(p + 32);
    entradas.push({
      metodo: c.readUInt16LE(p + 10),
      crc: c.readUInt32LE(p + 16),
      comprimido: c.readUInt32LE(p + 20),
      tam: c.readUInt32LE(p + 24),
      local: c.readUInt32LE(p + 42),
      nombre: c.subarray(p + 46, p + 46 + largoNombre).toString("utf8"),
    });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return entradas;
}

/** Ruta relativa segura dentro de la carpeta de datos (sin "..", sin absolutas, sin barras invertidas). */
function rutaValida(nombre: string): boolean {
  if (!nombre || nombre.includes("\\") || nombre.startsWith("/") || nombre.includes("\0")) return false;
  return nombre.split("/").every((parte) => parte !== ".." && parte !== ".");
}

/** Extrae y valida el respaldo en `destino` (carpeta nueva). Tira un Error con un mensaje para mostrar. */
export function extraer(zip: string, destino: string): ResumenRespaldo {
  const tamArchivo = statSync(zip).size;
  const fd = openSync(zip, "r");
  let archivos = 0;
  let bytes = 0;
  try {
    const entradas = leerIndice(fd, tamArchivo);
    if (!entradas.some((e) => e.nombre === MANIFIESTO)) throw new Error("No es un respaldo de Gravity (falta gravity-respaldo.json).");
    if (!entradas.some((e) => e.nombre === "estado.json")) throw new Error("El respaldo no tiene los datos de los compañeros (estado.json).");
    mkdirSync(destino, { recursive: true });
    for (const e of entradas) {
      if (e.nombre.endsWith("/")) continue;
      if (!rutaValida(e.nombre)) throw new Error(`Ruta inválida en el respaldo: ${e.nombre}`);
      if (EXCLUIDOS.has(e.nombre)) continue;
      if (e.tam > MAX_ARCHIVO || e.comprimido > MAX_ARCHIVO) throw new Error(`Archivo demasiado grande en el respaldo: ${e.nombre}`);
      bytes += e.tam;
      if (bytes > MAX_TOTAL) throw new Error("El respaldo es demasiado grande.");
      const cab = Buffer.alloc(30);
      readSync(fd, cab, 0, 30, e.local);
      if (cab.readUInt32LE(0) !== 0x04034b50) throw new Error("El zip está dañado.");
      const inicio = e.local + 30 + cab.readUInt16LE(26) + cab.readUInt16LE(28);
      const cuerpo = Buffer.alloc(e.comprimido);
      readSync(fd, cuerpo, 0, e.comprimido, inicio);
      const datos = e.metodo === 8 ? inflateRawSync(cuerpo, { maxOutputLength: MAX_ARCHIVO }) : e.metodo === 0 ? cuerpo : null;
      if (!datos) throw new Error(`Compresión no soportada en ${e.nombre}.`);
      if (datos.length !== e.tam || crc32(datos) !== e.crc) throw new Error(`El archivo ${e.nombre} llegó dañado.`);
      if (e.nombre === MANIFIESTO) {
        const m = JSON.parse(datos.toString("utf8")) as { formato?: number };
        if ((m.formato ?? 0) > FORMATO) throw new Error("El respaldo es de una versión más nueva de Gravity: actualizá la app primero.");
        continue;
      }
      const abs = path.join(destino, ...e.nombre.split("/"));
      if (!abs.startsWith(destino + path.sep)) throw new Error(`Ruta inválida en el respaldo: ${e.nombre}`);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, datos);
      archivos++;
    }
    JSON.parse(readFileSyncSeguro(path.join(destino, "estado.json")).toString("utf8"));
  } catch (err) {
    rmSync(destino, { recursive: true, force: true });
    throw err;
  } finally {
    closeSync(fd);
  }
  return { archivos, bytes, omitidos: [] };
}

/**
 * Cambia la carpeta de datos por la restaurada. La actual queda como gravity-antes-<fecha> al lado
 * (se puede volver atrás a mano) y las conexiones de este dispositivo se conservan.
 * Después hay que reiniciar el motor (el que llama sale del proceso).
 */
export function aplicar(restaurada: string): string {
  vaciarEscrituras();
  const sello = new Date().toISOString().replace(/[:.]/g, "-");
  const anterior = path.join(path.dirname(DATOS), `${path.basename(DATOS)}-antes-${sello}`);
  if (existsSync(DATOS)) {
    for (const nombre of EXCLUIDOS) {
      const actual = path.join(DATOS, nombre);
      if (existsSync(actual)) cpSync(actual, path.join(restaurada, nombre));
    }
    renameSync(DATOS, anterior);
  }
  renameSync(restaurada, DATOS);
  return anterior;
}

/** Carpetas hermanas de la de datos para trabajar sin tocar la actual. */
export const rutaTemporal = (nombre: string) => path.join(path.dirname(DATOS), `${path.basename(DATOS)}-${nombre}-${Date.now()}`);
