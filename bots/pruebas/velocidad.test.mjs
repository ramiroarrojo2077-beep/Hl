import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";

// Gemini falso que contesta en partes, con 400 ms entre cada una (como un modelo real escribiendo).
const pedidos = [];
const srv = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    pedidos.push({ url: req.url, cuerpo: JSON.parse(b) });
    if (!req.url.includes("streamGenerateContent")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: "entero" }] }, finishReason: "STOP" }] })); return; }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const partes = [{ text: "Hola, " }, { text: "ya te " }, { text: "contesto." }, { functionCall: { name: "memory", args: { command: "view", path: "/memories" } } }];
    partes.forEach((p, i) => setTimeout(() => {
      const ultimo = i === partes.length - 1;
      res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [p] }, ...(ultimo ? { finishReason: "STOP" } : {}) }], ...(ultimo ? { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 } } : {}) })}\r\n\r\n`);
      if (ultimo) res.end();
    }, 400 * (i + 1)));
  });
});
await new Promise((r) => srv.listen(0, r));
process.env.GEMINI_API_KEY = "x";
process.env.GEMINI_API_BASE = `http://127.0.0.1:${srv.address().port}/v1beta`;
const P = await import("../src/proveedores.ts");

test("Gemini en vivo: el texto llega mientras se escribe y las herramientas al final", async () => {
  const cliente = new Anthropic({ apiKey: "gratis", baseURL: "http://modelos-gratis.invalid", fetch: P.fetchGratis, maxRetries: 0 });
  const t0 = Date.now();
  let primero = null;
  let texto = "";
  const s = cliente.messages.stream({ model: "gravity-rapido", max_tokens: 1000, messages: [{ role: "user", content: "hola" }], tools: [{ name: "memory", description: "x", input_schema: { type: "object", properties: { command: { type: "string" }, path: { type: "string" } } } }] });
  s.on("text", (d) => { primero ??= Date.now() - t0; texto += d; });
  const m = await s.finalMessage();
  const total = Date.now() - t0;
  assert.equal(texto, "Hola, ya te contesto.");
  assert.ok(primero < 700, `el primer texto llegó a los ${primero} ms`);
  assert.ok(total >= 1500, "y el mensaje completo al final");
  assert.equal(m.content.find((b) => b.type === "tool_use").name, "memory");
  assert.equal(m.stop_reason, "tool_use");
  assert.match(pedidos[0].url, /streamGenerateContent\?alt=sse/);
  // «Rápido» con esfuerzo bajo: sin razonamiento previo
  await cliente.messages.create({ model: "gravity-rapido", max_tokens: 100, output_config: { effort: "low" }, messages: [{ role: "user", content: "hola" }] });
  assert.equal(pedidos.at(-1).cuerpo.generationConfig.thinkingConfig.thinkingBudget, 0);
  srv.close();
});

test("historial largo con modelos gratis: se recortan resultados viejos y, si hace falta, turnos viejos", () => {
  const turnos = [];
  for (let i = 0; i < 60; i++) {
    turnos.push({ rol: "usuario", textos: [`pregunta ${i}`], imagenes: [], resultados: i ? [{ id: `t${i}`, nombre: "read", texto: "x".repeat(5000), error: false, imagenes: [] }] : [] });
    turnos.push({ rol: "modelo", texto: `respuesta ${i}`, llamadas: [{ id: `t${i + 1}`, nombre: "read", entrada: { file_path: "a" } }] });
  }
  const r = P.recortarHistorial(turnos, 20_000);
  const tam = JSON.stringify(r).length;
  assert.ok(tam < 30_000, `quedó en ${tam} caracteres`);
  assert.equal(r[0].rol, "usuario");
  assert.equal(r[0].resultados.length, 0, "empieza en un mensaje del usuario, sin resultados sueltos");
  assert.match(r[0].textos[0], /Se dejaron afuera \d+ mensajes viejos/);
  assert.equal(r.at(-1).texto, "respuesta 59", "lo último queda intacto");
  assert.equal(r.at(-2).resultados[0].texto.length, 5000, "los resultados recientes no se tocan");
  assert.equal(P.recortarHistorial(turnos.slice(0, 4)).length, 4, "una charla corta no se toca");
});
