// Cada archivo de prueba corre en su propio proceso (node --test) con una carpeta de datos nueva:
// esto tiene que importarse ANTES que cualquier módulo del motor.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.BOTS_DATOS = mkdtempSync(path.join(tmpdir(), "gravity-prueba-"));
// Sin red: si algo intentara hablar con un modelo, falla enseguida en vez de colgarse.
process.env.ANTHROPIC_API_KEY = "prueba";
process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:9";
for (const k of ["GEMINI_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "GRAVITY_PROVEEDOR"]) delete process.env[k];
export const DATOS = process.env.BOTS_DATOS;
