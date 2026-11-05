import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// Embeddings falsos: «perro» y «can» van a la misma dimensión (sinónimos); «auto» a otra.
let pedidos = 0;
const servidor = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    pedidos++;
    const d = JSON.parse(b);
    const vec = (t) => { const v = new Array(256).fill(0.001); if (/perro|can\b/i.test(t)) v[0] = 1; if (/auto/i.test(t)) v[1] = 1; return v; };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ embeddings: d.requests.map((r) => ({ values: vec(r.content.parts[0].text) })) }));
  });
});
await new Promise((r) => servidor.listen(0, r));
process.env.GEMINI_API_KEY = "prueba";
process.env.GEMINI_API_BASE = `http://127.0.0.1:${servidor.address().port}`;

const A = await import("../src/almacen.ts");
const R = await import("../src/recuerdos.ts");

test("recordar encuentra sinónimos con embeddings y no vuelve a pedir lo que ya tiene", async () => {
  const bot = A.crearBot({ nombre: "Memo", titulo: "x", descripcion: "x" });
  const dir = A.raizMemoria(bot.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "mascotas.md"), "El perro del cliente se llama Toby y come balanceado.");
  writeFileSync(path.join(dir, "autos.md"), "El auto de la empresa es un Fiat.");
  assert.equal(R.buscar(bot.id, "can", "memoria").length, 0, "por palabras no lo encuentra");
  const h = await R.buscarSemantico(bot.id, "can", "memoria");
  assert.ok(h.length >= 1 && /Toby/.test(h[0].texto), "por significado sí");
  assert.ok(!h.some((x) => /Fiat/.test(x.texto)), "no trae lo que no tiene que ver");
  const antes = pedidos;
  await R.buscarSemantico(bot.id, "can", "memoria");
  assert.equal(pedidos, antes, "usa los vectores guardados");
  servidor.close();
});
