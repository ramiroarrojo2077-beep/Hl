import Anthropic from "@anthropic-ai/sdk";
import type { Esfuerzo } from "./almacen.ts";
import { describirProveedor, fetchGratis, hayGemini, hayRespaldo } from "./proveedores.ts";

// Con clave de Anthropic se usa Claude. Sin ella, Google Gemini (gratis) y, si se acaba su cupo,
// el mejor modelo gratuito de OpenRouter: ver proveedores.ts.
export const PROVEEDOR: "anthropic" | "gratis" = process.env.ANTHROPIC_API_KEY || !(hayGemini || hayRespaldo) ? "anthropic" : "gratis";

export const MODELO = process.env.BOTS_MODELO ?? "claude-opus-5-5";
/** Lo que se muestra en la interfaz como modelo. */
export const MODELO_VISIBLE = PROVEEDOR === "anthropic" ? MODELO : describirProveedor();
const ESFUERZOS: Esfuerzo[] = ["low", "medium", "high", "xhigh", "max"];
// Opus 5.5 usa "medium" por defecto; "high" da trabajos más cuidados a cambio de más tiempo y tokens.
export const ESFUERZO: Esfuerzo = ESFUERZOS.includes(process.env.BOTS_ESFUERZO as Esfuerzo)
  ? (process.env.BOTS_ESFUERZO as Esfuerzo)
  : "medium";

// Sin reintentos propios del SDK: los reintentos los coordina cupo.ts para todos los bots juntos.
export const client =
  PROVEEDOR === "anthropic"
    ? new Anthropic({ maxRetries: 0 })
    : new Anthropic({ apiKey: "gratis", baseURL: "http://modelos-gratis.invalid", fetch: fetchGratis, maxRetries: 0 });

// Si el modelo rechaza un pedido, la API reintenta sola con otro modelo.
export const BETA_FALLBACK = "server-side-fallback-2026-07-01";
