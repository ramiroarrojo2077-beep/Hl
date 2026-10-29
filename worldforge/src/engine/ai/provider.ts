import { OperationListSchema, type Operation } from "../scene/operations";
import { WorldPlanSchema, type WorldPlan } from "../generation/plan";
import { detectFeatures, planWorld } from "../generation/planner";
import { normalize } from "./text";
import type { WorldDoc } from "../types";

/** Cliente del adaptador opcional de modelos conectados (siempre con respaldo local). */

export interface ProviderStatus {
  local: { id: string; name: string; available: boolean };
  connected: { id: string; name: string; available: boolean };
}

export async function fetchProviderStatus(): Promise<ProviderStatus | null> {
  try {
    const res = await fetch("/api/ai", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as ProviderStatus;
  } catch {
    return null;
  }
}

/** Resumen compacto de la escena para dar contexto al modelo. */
export function sceneSummary(doc: WorldDoc, selection: string[]): string {
  const counts: Record<string, number> = {};
  for (const e of Object.values(doc.entities)) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const sel = selection
    .slice(0, 12)
    .map((id) => doc.entities[id])
    .filter(Boolean)
    .map((e) => {
      const extra = e!.type === "building" ? ` ${e!.props.kind}, ${e!.props.floors} pisos, ${e!.props.wall}` : e!.type === "npc" ? ` ${e!.props.behavior}` : "";
      return `- ${e!.name} (${e!.type}${extra})`;
    });
  const buildings = Object.values(doc.entities)
    .filter((e) => e.type === "building")
    .slice(0, 30)
    .map((e) => (e.type === "building" ? `${e.name}:${e.props.kind}/${e.props.floors}p` : ""))
    .join(", ");
  return [
    `Mundo: ${doc.name}. Hora ${doc.environment.timeOfDay.toFixed(1)}, clima ${doc.weather.type}, bioma ${doc.terrain.biome}, agua ${doc.terrain.waterEnabled ? "sí" : "no"}.`,
    `Cantidades: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    sel.length ? `Selección:\n${sel.join("\n")}` : "Selección: ninguna",
    buildings ? `Edificios: ${buildings}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function interpretWithProvider(prompt: string, doc: WorldDoc, selection: string[]): Promise<{ operations: Operation[]; model: string }> {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "edit", prompt, context: sceneSummary(doc, selection) }),
  });
  const data = (await res.json()) as { operations?: unknown; model?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Error del modelo conectado");
  // Validación también en el cliente: nunca se confía en la respuesta tal cual.
  const ops = OperationListSchema.safeParse(data.operations);
  if (!ops.success) throw new Error("El modelo devolvió operaciones inválidas");
  return { operations: ops.data, model: data.model ?? "modelo" };
}

/** Pide un plan al modelo conectado y lo combina con el plan local para completar faltantes. */
export async function planWithProvider(prompt: string): Promise<{ plan: WorldPlan; model: string }> {
  const res = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "plan", prompt }) });
  const data = (await res.json()) as { plan?: Record<string, unknown>; model?: string; error?: string };
  if (!res.ok || !data.plan) throw new Error(data.error ?? "Error del modelo conectado");
  const base = planWorld(prompt).plan;
  const merged = deepMerge(base as unknown as Record<string, unknown>, data.plan);
  merged.features = detectFeatures(normalize(prompt));
  merged.seed = base.seed;
  const parsed = WorldPlanSchema.safeParse(merged);
  if (!parsed.success) throw new Error("El plan del modelo no es válido");
  return { plan: parsed.data, model: data.model ?? "modelo" };
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) out[k] = deepMerge(a[k] as Record<string, unknown>, v as Record<string, unknown>);
    else if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}
