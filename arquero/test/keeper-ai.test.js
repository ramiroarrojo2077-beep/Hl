import { test } from "node:test";
import assert from "node:assert/strict";
import { ARCOS, judgeShot } from "../js/keeper-ai.js";

const arco = ARCOS.f5;
const base = { arco, radio: 0.11, dificultad: "normal", suerte: 0.5 };

test("ataja un remate lento al centro", () => {
  assert.equal(judgeShot({ ...base, x: 0.2, y: 0.8, tiempo: 0.6 }).resultado, "atajada");
});

test("no llega a un remate rápido al ángulo", () => {
  const r = judgeShot({ ...base, x: 1.3, y: 1.8, tiempo: 0.35 });
  assert.equal(r.resultado, "gol");
  // Las manos quedan entre el centro y la pelota.
  assert.ok(r.manos.x > 0 && r.manos.x < 1.3);
});

test("con más tiempo llega al ángulo", () => {
  assert.equal(judgeShot({ ...base, x: 1.3, y: 1.8, tiempo: 0.8 }).resultado, "atajada");
});

test("afuera y palo", () => {
  assert.equal(judgeShot({ ...base, x: 2, y: 0.5, tiempo: 0.4 }).resultado, "afuera");
  assert.equal(judgeShot({ ...base, x: 0, y: 2.6, tiempo: 0.4 }).detalle, "arriba");
  assert.equal(judgeShot({ ...base, x: 1.5, y: 0.5, tiempo: 0.4 }).resultado, "palo");
});

test("la dificultad cambia el resultado", () => {
  const tiro = { ...base, x: 1.0, y: 0.3, tiempo: 0.35 };
  assert.equal(judgeShot({ ...tiro, dificultad: "facil" }).resultado, "gol");
  assert.equal(judgeShot({ ...tiro, dificultad: "imposible" }).resultado, "atajada");
});
