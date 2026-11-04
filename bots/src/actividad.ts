// Historial unificado de acciones: qué herramienta usó cada compañero y con qué resultado, y qué
// decidió el usuario en cada aprobación. Se guarda en DATOS/actividad.jsonl (se recorta solo).

import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATOS } from "./almacen.ts";

export interface Registro {
  fecha: string;
  botId: string;
  tipo: "herramienta" | "aprobacion";
  que: string;
  ok: boolean;
  detalle: string;
}

const ARCHIVO = path.join(DATOS, "actividad.jsonl");
const MAX_BYTES = 4_000_000;

export function registrar(r: Omit<Registro, "fecha">): void {
  try {
    const linea = JSON.stringify({ fecha: new Date().toISOString(), ...r, detalle: r.detalle.replace(/\s+/g, " ").slice(0, 240) });
    appendFileSync(ARCHIVO, `${linea}\n`);
    // Si creció demasiado, se queda con la segunda mitad.
    if (statSync(ARCHIVO).size > MAX_BYTES) {
      const lineas = readFileSync(ARCHIVO, "utf8").split("\n").filter(Boolean);
      writeFileSync(ARCHIVO, `${lineas.slice(Math.floor(lineas.length / 2)).join("\n")}\n`);
    }
  } catch (err) {
    console.warn("Actividad:", (err as Error).message);
  }
}

export function leerActividad(opciones: { botId?: string | null; limite?: number } = {}): Registro[] {
  if (!existsSync(ARCHIVO)) return [];
  const limite = Math.min(Math.max(opciones.limite ?? 100, 1), 500);
  const salida: Registro[] = [];
  const lineas = readFileSync(ARCHIVO, "utf8").split("\n");
  for (let i = lineas.length - 1; i >= 0 && salida.length < limite; i--) {
    if (!lineas[i]) continue;
    try {
      const r = JSON.parse(lineas[i]!) as Registro;
      if (!opciones.botId || r.botId === opciones.botId) salida.push(r);
    } catch {}
  }
  return salida;
}
