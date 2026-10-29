import { z } from "zod";
import { EDIT_SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT } from "@/engine/ai/prompts";
import { OperationListSchema } from "@/engine/scene/operations";

/**
 * Adaptador opcional para modelos de lenguaje con API compatible con OpenAI
 * (por ejemplo Ollama o LM Studio corriendo gratis en tu computadora). La
 * clave, si existe, vive solo en el servidor y nunca llega al navegador.
 *
 * Variables de entorno:
 *   WORLDFORGE_LLM_BASE_URL   p. ej. http://localhost:11434/v1
 *   WORLDFORGE_LLM_MODEL      p. ej. qwen2.5:7b-instruct
 *   WORLDFORGE_LLM_API_KEY    opcional
 */

export const runtime = "nodejs";

const BASE_URL = process.env.WORLDFORGE_LLM_BASE_URL?.replace(/\/+$/, "") ?? "";
const MODEL = process.env.WORLDFORGE_LLM_MODEL ?? "";
const API_KEY = process.env.WORLDFORGE_LLM_API_KEY ?? "";
const configured = Boolean(BASE_URL && MODEL);

const RequestSchema = z.object({
  mode: z.enum(["edit", "plan"]),
  prompt: z.string().min(1).max(2000),
  context: z.string().max(24000).optional(),
});

// Límite simple por IP: 20 pedidos por minuto.
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 20;
}

export async function GET() {
  return Response.json({
    local: { id: "forge-1", name: "Forge 1 (local)", available: true },
    connected: configured ? { id: "openai-compatible", name: `Modelo conectado: ${MODEL}`, available: true } : { id: "openai-compatible", name: "Modelo conectado", available: false },
  });
}

export async function POST(req: Request) {
  if (!configured) return Response.json({ error: "No hay un modelo conectado. Configurá WORLDFORGE_LLM_BASE_URL y WORLDFORGE_LLM_MODEL." }, { status: 503 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) return Response.json({ error: "Demasiados pedidos seguidos. Esperá un minuto." }, { status: 429 });
  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Pedido inválido." }, { status: 400 });
  }
  const system = body.mode === "plan" ? PLAN_SYSTEM_PROMPT : EDIT_SYSTEM_PROMPT;
  const user = body.mode === "edit" && body.context ? `Escena actual:\n${body.context}\n\nInstrucción: ${body.prompt}` : body.prompt;
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}) },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return Response.json({ error: `El modelo respondió con error ${res.status}.` }, { status: 502 });
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(content.replace(/^```(?:json)?|```$/g, "").trim());
    } catch {
      return Response.json({ error: "El modelo no devolvió JSON válido." }, { status: 502 });
    }
    if (body.mode === "edit") {
      const ops = OperationListSchema.safeParse((parsed as { operations?: unknown })?.operations);
      if (!ops.success) return Response.json({ error: "El modelo devolvió operaciones inválidas.", details: ops.error.issues.slice(0, 3) }, { status: 422 });
      return Response.json({ operations: ops.data, model: MODEL });
    }
    // El plan se valida en el cliente contra WorldPlanSchema (completando valores faltantes).
    return Response.json({ plan: parsed, model: MODEL });
  } catch (err) {
    const msg = err instanceof Error && err.name === "TimeoutError" ? "El modelo tardó demasiado." : "No se pudo conectar con el modelo.";
    return Response.json({ error: msg }, { status: 502 });
  }
}
