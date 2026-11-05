import { DATOS } from "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const { COMPUTADORA } = await import("../src/almacen.ts");
const { ejecutarAislado, resultadoComoTexto } = await import("../src/aislado.ts");

test("corre en una copia: no toca los archivos reales, no ve claves y respeta el tiempo", async () => {
  const dir = path.join(COMPUTADORA, "proy");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "dato.txt"), "original");
  process.env.GEMINI_API_KEY = "secreta-de-prueba";
  const r = await ejecutarAislado("proy", 'cat dato.txt; echo cambiado > dato.txt; touch nuevo.txt; echo "clave=[$GEMINI_API_KEY]"; echo "casa=$HOME"');
  delete process.env.GEMINI_API_KEY;
  assert.equal(r.codigo, 0);
  assert.match(r.salida, /original/);
  assert.match(r.salida, /clave=\[\]/, "las claves no pasan");
  assert.equal(readFileSync(path.join(dir, "dato.txt"), "utf8"), "original", "el archivo real no cambia");
  assert.ok(!existsSync(path.join(dir, "nuevo.txt")));
  assert.deepEqual(readdirSync(path.join(DATOS, "aislado")), [], "la copia se borra");
  const lento = await ejecutarAislado("proy", "sleep 5", { timeoutMs: 1000 });
  assert.ok(lento.cortadoPorTiempo);
  assert.match(resultadoComoTexto(lento), /se cortó por tiempo/);
  await assert.rejects(ejecutarAislado("../..", "true"), /dentro de la computadora/);
});
