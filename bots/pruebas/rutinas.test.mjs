import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const R = await import("../src/rutinas.ts");

test("recordatorio de una sola vez: valida la fecha, corre una vez y no se repite", () => {
  const manana = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const h = R.normalizarHorario({ tipo: "una", fecha: manana, hora: "9:05" });
  assert.deepEqual(h, { tipo: "una", fecha: manana, hora: "09:05" });
  assert.throws(() => R.normalizarHorario({ tipo: "una", fecha: "2020-01-01", hora: "10:00" }), /ya pasaron/);
  assert.throws(() => R.normalizarHorario({ tipo: "una", fecha: "mañana", hora: "10:00" }), /AAAA-MM-DD/);
  const r = { horario: h, creada: new Date().toISOString(), ultimaEjecucion: null };
  const proxima = R.proximaEjecucion(r);
  assert.equal(proxima.getHours(), 9);
  assert.equal(proxima.getMinutes(), 5);
  assert.ok(R.proximaEjecucion({ ...r, ultimaEjecucion: new Date().toISOString() }).getTime() > Date.now() + 1e12, "después de correr no vuelve");
  assert.match(R.describirHorario(h), /una vez/);
});
