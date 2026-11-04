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

test("el tope de gasto propio se cuenta por compañero y la auditoría lo avisa", async () => {
  const G = await import("../src/gasto.ts");
  const AU = await import("../src/auditoria.ts");
  const bot = A.crearBot({ nombre: "Gasta", titulo: "Analista", descripcion: "x" });
  bot.topeDiarioUsd = 0.001;
  G.registrarUso(bot.id, { model: "claude-opus-5-5", usage: { input_tokens: 10_000, output_tokens: 1_000 }, content: [] });
  assert.ok(G.gastoBotHoy(bot.id) >= 0.001);
  assert.ok(AU.auditar().hallazgos.some((h) => h.botId === bot.id && /tope de gasto/.test(h.texto)));
});

test("el historial de acciones guarda y filtra por compañero", async () => {
  const AC = await import("../src/actividad.ts");
  AC.registrar({ botId: "b1", tipo: "herramienta", que: "Corriendo ls", ok: true, detalle: "x" });
  AC.registrar({ botId: "b2", tipo: "aprobacion", que: "Enviar correo", ok: false, detalle: "Negada por el usuario." });
  assert.equal(AC.leerActividad().length, 2);
  assert.deepEqual(AC.leerActividad({ botId: "b2" }).map((r) => r.que), ["Enviar correo"]);
});

test("crear un equipo nuevo desde un compañero pide aprobación siempre", async () => {
  const bot = A.crearBot({ nombre: "Prop", titulo: "Manager", descripcion: "x" });
  A.ajustes().autoAprobar = true;
  const pedido = H.necesitaAprobacion("equipo_nuevo", { accion: "crear", propuesta: "p123" }, bot);
  A.ajustes().autoAprobar = false;
  assert.ok(pedido, "pide aprobación aunque esté Aprobar todo solo");
  assert.equal(pedido.patron, "", "sin «siempre permitir»");
  assert.equal(H.necesitaAprobacion("equipo_nuevo", { accion: "proponer", objetivo: "x" }, bot), null, "proponer no crea nada");
  const t = (await H.herramientasDe(bot.id)).get("equipo_nuevo");
  assert.match(await t.run({ accion: "crear", objetivo: null, propuesta: "p123" }), /no existe o venció/);
});

test("los errores de herramientas quedan en la memoria del compañero (últimos 40)", async () => {
  const AC = await import("../src/actividad.ts");
  const { readFileSync } = await import("node:fs");
  const path = (await import("node:path")).default;
  const bot = A.crearBot({ nombre: "Errático", titulo: "x", descripcion: "x" });
  for (let i = 0; i < 45; i++) AC.anotarError(bot.id, "bash", `falló el comando ${i}`);
  AC.anotarError(bot.id, "bash", "El trabajo se detuvo.");
  const t = readFileSync(path.join(A.raizMemoria(bot.id), "errores-recientes.md"), "utf8");
  assert.equal(t.split("\n").filter((l) => l.startsWith("- ")).length, 40);
  assert.match(t, /falló el comando 44/);
  assert.doesNotMatch(t, /falló el comando 4\b/);
  assert.doesNotMatch(t, /se detuvo/);
});
