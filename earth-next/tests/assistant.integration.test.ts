/**
 * Prueba de integración del bucle del asistente contra un servidor que emula el
 * streaming de la Messages API (sin red ni clave real).
 * Verifica: ejecución de herramientas de datos (measure) en el servidor, reenvío de
 * acciones al navegador (fly_to), texto incremental, fuentes y que el historial sólo
 * se extiende al final (contenido del asistente reenviado sin cambios).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

interface Captured {
  body: { messages: { role: string; content: unknown }[]; tools: { name: string }[]; fallbacks?: unknown; output_config?: unknown };
}

const requests: Captured[] = [];
let server: http.Server;

function sse(events: [string, unknown][]): string {
  return events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
}

function messageStart(id: string) {
  return ["message_start", { type: "message_start", message: { id, type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }] as [string, unknown];
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw) as Captured["body"];
      requests.push({ body });
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      if (requests.length === 1) {
        // Turno 1: dos herramientas en paralelo (datos + acción)
        res.end(
          sse([
            messageStart("msg_1"),
            ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_m", name: "measure", input: {} } }],
            ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"points":[{"lat":-54.8019,"lon":-68.303},' } }],
            ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"lat":-22.1048,"lon":-65.5962}]}' } }],
            ["content_block_stop", { type: "content_block_stop", index: 0 }],
            ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_f", name: "fly_to", input: {} } }],
            ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"lat":-54.8019,"lon":-68.303,"height_m":20000}' } }],
            ["content_block_stop", { type: "content_block_stop", index: 1 }],
            ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 40 } }],
            ["message_stop", { type: "message_stop" }],
          ]),
        );
      } else {
        res.end(
          sse([
            messageStart("msg_2"),
            ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
            ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "La distancia es de " } }],
            ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "unos 3638 km." } }],
            ["content_block_stop", { type: "content_block_stop", index: 0 }],
            ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 12 } }],
            ["message_stop", { type: "message_stop" }],
          ]),
        );
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  process.env["ANTHROPIC_API_KEY"] = "test-key";
  process.env["ANTHROPIC_BASE_URL"] = `http://127.0.0.1:${port}`;
});

afterAll(() => server.close());

describe("bucle del asistente", () => {
  it("ejecuta herramientas, reenvía acciones y responde con fuentes", async () => {
    const { runAssistant } = await import("../server/assistant.ts");
    const events: { e: string; d: Record<string, unknown> }[] = [];
    await runAssistant({
      message: "Calculá la distancia entre Ushuaia y La Quiaca y llevame a Ushuaia",
      context: { lang: "es", camera: { lat: 0, lon: 0, height: 2e7, heading: 0, pitch: -90 } },
      emit: (e, d) => events.push({ e, d: d as Record<string, unknown> }),
      signal: new AbortController().signal,
    });

    const actions = events.filter((x) => x.e === "action");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.d["tool"]).toBe("fly_to");
    expect((actions[0]!.d["input"] as { height_m: number }).height_m).toBe(20000);

    const text = events.filter((x) => x.e === "text").map((x) => x.d["delta"]).join("");
    expect(text).toBe("La distancia es de unos 3638 km.");

    const sources = events.find((x) => x.e === "sources")!.d["sources"] as { name: string }[];
    expect(sources.some((s) => s.name.includes("geodésico"))).toBe(true);
    expect(events.at(-1)!.e).toBe("done");

    // Segundo pedido: historial = usuario, asistente (sin cambios), resultados de herramientas.
    expect(requests).toHaveLength(2);
    const second = requests[1]!.body;
    expect(second.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const assistantContent = second.messages[1]!.content as { type: string; id: string }[];
    expect(assistantContent.map((b) => b.id)).toEqual(["toolu_m", "toolu_f"]);
    const results = second.messages[2]!.content as { type: string; tool_use_id: string; content: string; is_error?: boolean }[];
    expect(results.map((r) => r.tool_use_id)).toEqual(["toolu_m", "toolu_f"]);
    const measured = JSON.parse(results[0]!.content) as { total_distance_km: number };
    // Ushuaia–La Quiaca ≈ 3638 km (geodésica WGS84)
    expect(measured.total_distance_km).toBeGreaterThan(3600);
    expect(measured.total_distance_km).toBeLessThan(3680);
    expect(results[1]!.content).toContain("Acción enviada");

    // Primer pedido: contexto de la vista + herramientas + fallback de servidor
    const first = requests[0]!.body;
    const firstUser = first.messages[0]!.content as { type: string; text: string }[];
    expect(firstUser[0]!.text).toContain("[Contexto]");
    expect(first.tools.some((t) => t.name === "web_search")).toBe(true);
    expect(first.fallbacks).toBe("default");
  });

  it("rechaza entradas inválidas de herramientas sin ejecutarlas", async () => {
    const { SCHEMAS } = await import("../server/assistant-tools.ts");
    expect(SCHEMAS.fly_to.safeParse({ lat: 120, lon: 0 }).success).toBe(false);
    expect(SCHEMAS.compare_imagery.safeParse({ source: "wayback", date: "ayer" }).success).toBe(false);
    expect(SCHEMAS.set_layers.safeParse({ enable: ["population", "no-existe"] }).success).toBe(false);
  });
});
