import path from "node:path";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { DATOS, ajustes } from "./almacen.ts";
import { emitir } from "./eventos.ts";

// Estimación del gasto a precio de lista, en dólares por millón de tokens.
const PRECIOS: Record<string, { entrada: number; salida: number; cache5m: number; cache1h: number; lectura: number }> = {
  "claude-opus-5-5": { entrada: 4, salida: 20, cache5m: 5, cache1h: 8, lectura: 0.2 },
  "claude-opus-5": { entrada: 5, salida: 25, cache5m: 6.25, cache1h: 10, lectura: 0.5 },
  "claude-opus-4-8": { entrada: 5, salida: 25, cache5m: 6.25, cache1h: 10, lectura: 0.5 },
  "claude-sonnet-5-5": { entrada: 2, salida: 10, cache5m: 2.5, cache1h: 4, lectura: 0.2 },
  "claude-haiku-5-5": { entrada: 0.1, salida: 0.5, cache5m: 0.125, cache1h: 0.2, lectura: 0.01 },
};
const POR_BUSQUEDA = 0.01;
const ARCHIVO = path.join(DATOS, "gasto.json");
const DIAS_GUARDADOS = 60;

interface Dia {
  total: number;
  llamadas: number;
  busquedas: number;
  porBot: Record<string, number>;
}

let registro: Record<string, Dia> = {};
try {
  registro = JSON.parse(readFileSync(ARCHIVO, "utf8"));
} catch {
  // Sin gasto previo.
}

export function hoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const gastoHoy = (): number => registro[hoy()]?.total ?? 0;

export function topeHoy(): number {
  const a = ajustes();
  return a.topeDiarioUsd + (a.extra?.dia === hoy() ? a.extra.usd : 0);
}

// "tope" si se pasó el tope del día, "suave" desde el 80 % (no arranca trabajo automático nuevo), o null.
export function nivelGasto(): "tope" | "suave" | null {
  const tope = topeHoy();
  if (tope <= 0) return null;
  const g = gastoHoy();
  if (g >= tope) return "tope";
  if (g >= tope * 0.8) return "suave";
  return null;
}

export function costoDe(m: Anthropic.Beta.BetaMessage): number {
  // Los modelos gratis (Gemini, Mistral) no suman gasto.
  if (!PRECIOS[m.model] && !m.model.startsWith("claude")) return 0;
  const p = PRECIOS[m.model] ?? PRECIOS["claude-opus-5-5"]!;
  const u = m.usage;
  const cache5m = u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  const cache1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const creacionSinDetalle = Math.max(0, (u.cache_creation_input_tokens ?? 0) - cache5m - cache1h);
  let usd =
    (u.input_tokens * p.entrada +
      u.output_tokens * p.salida +
      (cache5m + creacionSinDetalle) * p.cache5m +
      cache1h * p.cache1h +
      (u.cache_read_input_tokens ?? 0) * p.lectura) /
    1e6;
  // La compactación del contexto se factura aparte y no está en los totales de arriba.
  for (const it of u.iterations ?? []) {
    if (it.type === "compaction") usd += (it.input_tokens * p.entrada + it.output_tokens * p.salida) / 1e6;
  }
  usd += (u.server_tool_use?.web_search_requests ?? 0) * POR_BUSQUEDA;
  return usd;
}

let ultimoAviso = 0;
let guardado: NodeJS.Timeout | null = null;

// Suma el costo de una respuesta. Devuelve los dólares de esa respuesta.
export function registrarUso(botId: string, m: Anthropic.Beta.BetaMessage): number {
  const usd = costoDe(m);
  const d = (registro[hoy()] ??= { total: 0, llamadas: 0, busquedas: 0, porBot: {} });
  d.total += usd;
  d.llamadas++;
  d.busquedas += m.usage.server_tool_use?.web_search_requests ?? 0;
  d.porBot[botId] = (d.porBot[botId] ?? 0) + usd;
  guardado ??= setTimeout(() => {
    guardado = null;
    const dias = Object.keys(registro).sort();
    for (const viejo of dias.slice(0, Math.max(0, dias.length - DIAS_GUARDADOS))) delete registro[viejo];
    writeFileSync(`${ARCHIVO}.tmp`, JSON.stringify(registro));
    renameSync(`${ARCHIVO}.tmp`, ARCHIVO);
  }, 1000);
  if (Date.now() - ultimoAviso > 5000) {
    ultimoAviso = Date.now();
    emitir("gasto", resumenGasto());
  }
  return usd;
}

export function resumenGasto() {
  const d = registro[hoy()] ?? { total: 0, llamadas: 0, busquedas: 0, porBot: {} };
  return { hoy: d.total, tope: topeHoy(), nivel: nivelGasto(), llamadas: d.llamadas, busquedas: d.busquedas, porBot: d.porBot };
}
