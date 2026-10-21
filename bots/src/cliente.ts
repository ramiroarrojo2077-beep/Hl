import Anthropic from "@anthropic-ai/sdk";
import type { Esfuerzo } from "./almacen.ts";

export const MODELO = process.env.BOTS_MODELO ?? "claude-opus-5-5";
const ESFUERZOS: Esfuerzo[] = ["low", "medium", "high", "xhigh", "max"];
// Opus 5.5 usa "medium" por defecto; "high" da trabajos más cuidados a cambio de más tiempo y tokens.
export const ESFUERZO: Esfuerzo = ESFUERZOS.includes(process.env.BOTS_ESFUERZO as Esfuerzo)
  ? (process.env.BOTS_ESFUERZO as Esfuerzo)
  : "medium";

// Sin reintentos propios del SDK: los reintentos los coordina cupo.ts para todos los bots juntos.
export const client = new Anthropic({ maxRetries: 0 });

// Si el modelo rechaza un pedido, la API reintenta sola con otro modelo.
export const BETA_FALLBACK = "server-side-fallback-2026-07-01";
