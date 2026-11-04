import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const A = await import("../src/almacen.ts");
const H = await import("../src/herramientas.ts");

test("las herramientas apagadas no se le mandan al modelo ni quedan para ejecutar", async () => {
  const bot = A.crearBot({ nombre: "Caro", titulo: "Atención", descripcion: "x" });
  const todas = await H.herramientasDe(bot.id);
  assert.ok(todas.has("bash") && todas.has("mensajes"), "por defecto tiene todo");

  bot.bloqueadas = H.normalizarBloqueadas(["computadora", "mensajes", "inventado"]);
  assert.deepEqual(bot.bloqueadas, ["computadora", "mensajes"], "descarta grupos que no existen");
  const mapa = await H.herramientasDe(bot.id);
  for (const n of ["bash", "read", "write", "edit", "glob", "grep", "mensajes"]) assert.ok(!mapa.has(n), `${n} apagada`);
  assert.ok(mapa.has("entregar") && mapa.has("memory"), "entregar y la memoria quedan siempre");
  const nombres = H.definiciones(mapa, bot.id).map((d) => d.name);
  assert.ok(!nombres.includes("bash") && !nombres.includes("mensajes"));

  bot.bloqueadas = ["web"];
  const sinWeb = H.definiciones(await H.herramientasDe(bot.id), bot.id).map((d) => d.name);
  assert.ok(!sinWeb.includes("web_search") && !sinWeb.includes("web_fetch"), "sin búsqueda web del servidor");
  assert.ok(sinWeb.includes("bash"), "lo demás vuelve a estar");
});
