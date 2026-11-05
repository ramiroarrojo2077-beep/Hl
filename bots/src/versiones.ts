// Versiones de los archivos de la computadora: antes de que un compañero (write/edit) o el usuario (editor)
// cambie un archivo, se guarda la versión anterior en DATOS/versiones/<ruta>/<fecha>. Quedan las últimas
// 20 por archivo (hasta 2 MB cada una) y se pueden restaurar.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { COMPUTADORA, DATOS } from "./almacen.ts";

const RAIZ = path.join(DATOS, "versiones");
const MAX_POR_ARCHIVO = 20;
const MAX_BYTES = 2_000_000;

/** Ruta relativa segura dentro de la computadora, o null si escapa. */
function relativa(abs: string): string | null {
  const rel = path.relative(COMPUTADORA, path.resolve(COMPUTADORA, abs));
  return !rel || rel.startsWith("..") || path.isAbsolute(rel) ? null : rel;
}
const carpetaDe = (rel: string) => path.join(RAIZ, rel);

export function guardarVersion(ruta: string): void {
  try {
    const rel = relativa(ruta);
    if (!rel) return;
    const abs = path.join(COMPUTADORA, rel);
    if (!existsSync(abs)) return;
    const info = statSync(abs);
    if (!info.isFile() || info.size > MAX_BYTES) return;
    const dir = carpetaDe(rel);
    mkdirSync(dir, { recursive: true });
    // Dos cambios en el mismo milisegundo no se pisan: se numeran.
    const base = new Date().toISOString().replace(/[:.]/g, "-");
    let nombre = `${base}.v`;
    for (let n = 1; existsSync(path.join(dir, nombre)); n++) nombre = `${base}~${String(n).padStart(3, "0")}.v`;
    copyFileSync(abs, path.join(dir, nombre));
    const viejas = readdirSync(dir).sort();
    for (const v of viejas.slice(0, Math.max(0, viejas.length - MAX_POR_ARCHIVO))) rmSync(path.join(dir, v), { force: true });
  } catch (err) {
    console.warn("Versiones:", (err as Error).message);
  }
}

export function listarVersiones(ruta: string): { id: string; fecha: string; tamano: number }[] {
  const rel = relativa(ruta);
  if (!rel) return [];
  const dir = carpetaDe(rel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((v) => v.endsWith(".v"))
    .sort()
    .reverse()
    .map((v) => ({ id: v, fecha: v.slice(0, -2).replace(/~\d+$/, "").replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "$1:$2:$3.$4Z"), tamano: statSync(path.join(dir, v)).size }));
}

export function restaurarVersion(ruta: string, id: string): void {
  const rel = relativa(ruta);
  if (!rel || !/^[\w~-]+\.v$/.test(id)) throw new Error("Versión inválida.");
  const origen = path.join(carpetaDe(rel), id);
  if (!existsSync(origen)) throw new Error("No existe esa versión.");
  const destino = path.join(COMPUTADORA, rel);
  // Lo actual también queda como versión, por si te arrepentís.
  guardarVersion(destino);
  mkdirSync(path.dirname(destino), { recursive: true });
  copyFileSync(origen, destino);
}

/** Contenido de una versión guardada (para comparar con el actual). */
export function leerVersion(ruta: string, id: string): Buffer {
  const rel = relativa(ruta);
  if (!rel || !/^[\w~-]+\.v$/.test(id)) throw new Error("Versión inválida.");
  const f = path.join(carpetaDe(rel), id);
  if (!existsSync(f)) throw new Error("No existe esa versión.");
  return readFileSync(f);
}
