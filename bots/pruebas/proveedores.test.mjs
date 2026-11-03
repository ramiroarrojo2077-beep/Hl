import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// Gemini falso: devuelve una llamada a herramienta sin los campos opcionales.
const servidor = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "mensajes", args: { accion: "enviar", texto: "hola" } }, thoughtSignature: "x" }] }, finishReason: "STOP" }] }));
  });
});
await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
process.env.GEMINI_API_KEY = "x";
process.env.GEMINI_API_BASE = `http://127.0.0.1:${servidor.address().port}/v1beta`;
process.env.GRAVITY_GEMINI_MODELOS = "m";
const { fetchGratis } = await import("../src/proveedores.ts");

test("completa con null los campos opcionales que Gemini omite", async () => {
  const nulo = (t) => ({ anyOf: [{ type: t }, { type: "null" }] });
  const cuerpo = {
    max_tokens: 100,
    messages: [{ role: "user", content: "hola" }],
    tools: [{ type: "custom", name: "mensajes", input_schema: { type: "object", properties: { accion: { type: "string" }, clave: nulo("string"), texto: nulo("string"), motivo: nulo("string") }, required: ["accion", "clave", "texto", "motivo"] } }],
  };
  const r = await fetchGratis("http://x/v1/messages", { method: "POST", body: JSON.stringify(cuerpo) });
  const uso = (await r.json()).content.find((b) => b.type === "tool_use");
  assert.deepEqual(uso.input, { accion: "enviar", texto: "hola", clave: null, motivo: null });
  servidor.close();
});
