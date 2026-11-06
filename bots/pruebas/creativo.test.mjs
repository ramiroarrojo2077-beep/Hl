import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

// Gemini falso: devuelve una imagen PNG o audio PCM según el modelo pedido.
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8ffbf1e0005ff02fea7d2ba0000000049454e44ae426082", "hex");
const pedidos = [];
const srv = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    pedidos.push({ url: req.url, clave: req.headers["x-goog-api-key"], cuerpo: JSON.parse(b) });
    const audio = req.url.includes("tts");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ candidates: [{ content: { parts: audio ? [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: Buffer.alloc(4800).toString("base64") } }] : [{ text: "Listo" }, { inlineData: { mimeType: "image/png", data: PNG.toString("base64") } }] } }] }));
  });
});
await new Promise((r) => srv.listen(0, r));
process.env.GEMINI_API_KEY = "clave-de-prueba";
process.env.GEMINI_API_BASE = `http://127.0.0.1:${srv.address().port}/v1beta`;
const A = await import("../src/almacen.ts");
const C = await import("../src/creativo.ts");

test("Creative Studio: imagen y edición con Gemini, voz WAV, presentación HTML y SVG seguro", async () => {
  const r = await C.generarImagen("Un faro al atardecer", { aspecto: "16:9" }, AbortSignal.timeout(5000));
  assert.equal(r.rutas.length, 1);
  assert.match(r.rutas[0], /^creativo\/imagenes\/un-faro-al-atardecer\.png$/);
  assert.deepEqual(readFileSync(path.join(A.COMPUTADORA, r.rutas[0])), PNG);
  assert.equal(pedidos[0].clave, "clave-de-prueba");
  assert.deepEqual(pedidos[0].cuerpo.generationConfig.imageConfig, { aspectRatio: "16:9" });
  // editar: manda la imagen original
  await C.generarImagen("Agregale un barco", { base: r.rutas[0] }, AbortSignal.timeout(5000));
  assert.equal(pedidos[1].cuerpo.contents[0].parts[1].inline_data.mime_type, "image/png");
  // voz
  const v = await C.generarVoz("Hola equipo", "Puck", "", AbortSignal.timeout(5000));
  const w = readFileSync(path.join(A.COMPUTADORA, v));
  assert.equal(w.toString("ascii", 0, 4), "RIFF");
  assert.equal(w.readUInt32LE(24), 24000);
  assert.equal(w.length, 44 + 4800);
  assert.equal(pedidos[2].cuerpo.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Puck");
  // presentación: HTML autosuficiente, escapado, y se rehace desde el JSON editado
  const p = { titulo: "Plan <2027>", subtitulo: "Equipo", diapositivas: [{ tipo: "portada", titulo: "Plan", puntos: [], nota: "hola" }, { tipo: "numeros", titulo: "Cifras", puntos: ["30% — más ventas"], nota: "" }] };
  const html = C.htmlPresentacion(p);
  assert.match(html, /Plan &lt;2027&gt;/);
  assert.match(html, /<b>30%<\/b><span>más ventas<\/span>/);
  assert.doesNotMatch(html, /https?:\/\//, "sin recursos externos");
  mkdirSync(path.join(A.COMPUTADORA, "creativo/presentaciones"), { recursive: true });
  writeFileSync(path.join(A.COMPUTADORA, "creativo/presentaciones/plan.json"), JSON.stringify(p));
  assert.equal(C.rehacerPresentacion("creativo/presentaciones/plan.json"), "creativo/presentaciones/plan.html");
  // SVG: se limpia lo peligroso y se conserva el dibujo
  const sucio = '```svg\n<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><foreignObject><div>x</div></foreignObject><a href="https://malo.com"><circle cx="5" cy="5" r="4" fill="url(https://x/y)" stroke="url(#g)"/></a><use href="#g"/></svg>\n```';
  const limpio = C.sanitizarSvg(sucio);
  assert.doesNotMatch(limpio, /script|onload|foreignObject|malo\.com|https:\/\/x/);
  assert.match(limpio, /<circle cx="5"/);
  assert.match(limpio, /url\(#g\)/);
  assert.match(limpio, /href="#g"/);
  assert.equal(C.sanitizarSvg("no es svg"), null);
  srv.close();
});
