// Ejecución aislada: corre un comando (por ejemplo, las pruebas de un proyecto) sobre una COPIA de una
// carpeta de la computadora. Lo que haga el comando no toca los archivos de verdad, no ve las claves de
// Gravity ni las variables del motor, tiene tiempo límite y, donde el sistema lo permite (Linux con
// espacios de nombres de usuario), corre sin red. La copia se borra al terminar.

import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { COMPUTADORA, DATOS, nuevoId } from "./almacen.ts";

export const MAX_BYTES_COPIA = 150 * 1024 * 1024;
export const MAX_ARCHIVOS_COPIA = 20_000;
const LIMITE_SALIDA = 30_000;
const SHELL = existsSync("/bin/bash") ? "/bin/bash" : (["/system/bin/sh", "/bin/sh"].find((s) => existsSync(s)) ?? "sh");

// Solo pasan variables inofensivas: nada de claves, tokens ni configuración del motor.
const VARIABLES_PERMITIDAS = ["PATH", "LANG", "LC_ALL", "TERM", "TZ", "ANDROID_ROOT", "ANDROID_DATA", "NODE_PATH"];

let sinRedDisponible: boolean | null = null;
/** ¿Se puede cortar la red del comando? (unshare con espacio de usuario y de red, sin ser root). */
export function puedeCortarRed(): boolean {
  if (sinRedDisponible === null) {
    try {
      sinRedDisponible = spawnSync("unshare", ["-rn", "true"], { timeout: 3000 }).status === 0;
    } catch {
      sinRedDisponible = false;
    }
  }
  return sinRedDisponible;
}

/** Tamaño y cantidad de archivos de una carpeta, cortando apenas pasa los topes. */
function medir(carpeta: string): { bytes: number; archivos: number } {
  let bytes = 0;
  let archivos = 0;
  const pila = [carpeta];
  while (pila.length) {
    const actual = pila.pop()!;
    for (const e of readdirSync(actual, { withFileTypes: true })) {
      const ruta = path.join(actual, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) pila.push(ruta);
      else if (e.isFile()) {
        archivos++;
        bytes += statSync(ruta).size;
        if (bytes > MAX_BYTES_COPIA || archivos > MAX_ARCHIVOS_COPIA) return { bytes, archivos };
      }
    }
  }
  return { bytes, archivos };
}

export interface ResultadoAislado {
  codigo: number | null;
  salida: string;
  segundos: number;
  sinRed: boolean;
  cortadoPorTiempo: boolean;
}

/**
 * Corre `comando` en una copia de `carpeta` (relativa a la computadora; "" = toda la computadora).
 * Los enlaces simbólicos no se copian (podrían apuntar afuera de la copia).
 */
export async function ejecutarAislado(carpeta: string, comando: string, op: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ResultadoAislado> {
  const origen = path.resolve(COMPUTADORA, carpeta || ".");
  const relativa = path.relative(COMPUTADORA, origen);
  if (relativa.startsWith("..") || path.isAbsolute(relativa)) throw new Error("La carpeta tiene que estar dentro de la computadora.");
  if (!existsSync(origen) || !lstatSync(origen).isDirectory()) throw new Error(`No existe la carpeta «${carpeta}».`);
  const m = medir(origen);
  if (m.bytes > MAX_BYTES_COPIA || m.archivos > MAX_ARCHIVOS_COPIA) {
    throw new Error(`La carpeta es muy grande para copiarla (más de ${MAX_BYTES_COPIA / 1048576} MB o ${MAX_ARCHIVOS_COPIA} archivos): elegí una subcarpeta.`);
  }
  const base = path.join(DATOS, "aislado", nuevoId());
  const copia = path.join(base, "trabajo");
  const casa = path.join(base, "casa");
  mkdirSync(casa, { recursive: true });
  try {
    cpSync(origen, copia, { recursive: true, filter: (f) => !lstatSync(f).isSymbolicLink() });
    const env: NodeJS.ProcessEnv = Object.fromEntries(VARIABLES_PERMITIDAS.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
    Object.assign(env, { HOME: casa, TMPDIR: casa, GRAVITY_AISLADO: "1" });
    const sinRed = puedeCortarRed();
    const [programa, args] = sinRed ? ["unshare", ["-rn", SHELL, "-c", comando]] : [SHELL, ["-c", comando]];
    const inicio = Date.now();
    return await new Promise<ResultadoAislado>((resolve, reject) => {
      const proceso = spawn(programa, args as string[], { env, cwd: copia });
      let salida = "";
      let cortado = false;
      const sumar = (d: Buffer) => {
        if (salida.length < LIMITE_SALIDA * 2) salida += d.toString();
      };
      proceso.stdout.on("data", sumar);
      proceso.stderr.on("data", sumar);
      const limite = Math.min(Math.max(op.timeoutMs ?? 120_000, 1000), 10 * 60_000);
      const reloj = setTimeout(() => {
        cortado = true;
        proceso.kill("SIGKILL");
      }, limite);
      op.signal?.addEventListener("abort", () => proceso.kill("SIGKILL"), { once: true });
      proceso.on("error", (err) => {
        clearTimeout(reloj);
        reject(err);
      });
      proceso.on("close", (codigo) => {
        clearTimeout(reloj);
        if (salida.length > LIMITE_SALIDA) salida = `${salida.slice(0, LIMITE_SALIDA / 2)}\n… (salida recortada) …\n${salida.slice(-LIMITE_SALIDA / 2)}`;
        resolve({ codigo, salida, segundos: Math.round((Date.now() - inicio) / 100) / 10, sinRed, cortadoPorTiempo: cortado });
      });
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

export function resultadoComoTexto(r: ResultadoAislado): string {
  const estado = r.cortadoPorTiempo ? "se cortó por tiempo" : r.codigo === 0 ? "terminó bien (código 0)" : `terminó con código ${r.codigo}`;
  return [
    `[Ejecución aislada en una copia · ${estado} · ${r.segundos} s · ${r.sinRed ? "sin red" : "con red (este sistema no permite cortarla)"} · sin claves de Gravity · los cambios se descartaron]`,
    r.salida.trim() || "(sin salida)",
  ].join("\n");
}
