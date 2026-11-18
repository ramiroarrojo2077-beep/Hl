/**
 * Cliente del asistente: usa la IA del servidor (SSE) si está disponible y, si no,
 * el modo básico local. Emite texto incremental, acciones, estado y fuentes.
 */
import { apiUrl, serverStatus } from "./api.ts";
import { localAssistant } from "./assistant-local.ts";
import type { AssistantAction } from "../ui/assistant-actions.ts";
import type { Source } from "./assistant-types.ts";

export interface AssistantRequestContext {
  lang: string;
  camera: { lat: number; lon: number; height: number; heading: number; pitch: number };
  view: { west: number; south: number; east: number; north: number };
  selection: { title: string; lat: number; lon: number } | null;
  sceneTime: string;
  layers: string[];
  center: { lat: number; lon: number };
}

export interface AssistantHandlers {
  onText: (delta: string) => void;
  onAction: (a: AssistantAction) => void;
  onStatus: (s: string) => void;
  onSources: (s: Source[]) => void;
  onMode: (mode: "ai" | "basic") => void;
}

let conversationId: string | undefined;

export function resetConversation(): void {
  conversationId = undefined;
}

export async function ask(message: string, ctx: AssistantRequestContext, h: AssistantHandlers, opts: { useAi: boolean; signal?: AbortSignal }): Promise<void> {
  const status = await serverStatus();
  if (opts.useAi && status.ai) {
    h.onMode("ai");
    const ok = await askServer(message, ctx, h, opts.signal);
    if (ok) return;
  }
  h.onMode("basic");
  const r = await localAssistant(message, { lang: ctx.lang, center: ctx.center, sceneTime: new Date(ctx.sceneTime) });
  h.onText(r.text);
  r.actions.forEach(h.onAction);
  h.onSources(r.sources);
}

/** Devuelve false si el servidor indicó que no hay IA (para usar el modo básico). */
async function askServer(message: string, ctx: AssistantRequestContext, h: AssistantHandlers, signal?: AbortSignal): Promise<boolean> {
  const { center: _c, ...context } = ctx;
  void _c;
  const res = await fetch(apiUrl("/api/assistant"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ conversationId, message, context }),
    signal,
  });
  if (res.status === 503) return false;
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (!data) continue;
      const payload = JSON.parse(data) as Record<string, unknown>;
      if (event === "text") h.onText(String(payload["delta"] ?? ""));
      else if (event === "action") h.onAction({ tool: String(payload["tool"]), input: payload["input"] as Record<string, unknown> });
      else if (event === "status") h.onStatus(String(payload["message"] ?? ""));
      else if (event === "sources") h.onSources((payload["sources"] as Source[]) ?? []);
      else if (event === "conversation") conversationId = String(payload["id"]);
      else if (event === "error") throw new Error(String(payload["message"] ?? "Error del asistente"));
    }
  }
  return true;
}
