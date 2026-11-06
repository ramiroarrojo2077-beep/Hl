import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const R = await import("../src/robotlab.ts");

test("guion del presentador y del profesor: recorta, valida preguntas y no deja preguntas al presentar", async () => {
  const s = AbortSignal.timeout(5000), original = R.ia.json;
  let sistema = "";
  R.ia.json = async (sis) => { sistema = sis; return { titulo: "El agua", partes: [{ texto: "Hola, hoy vemos el ciclo del agua.", puntos: ["Evaporación", "Condensación", "Lluvia", "Sobra"], gesto: "saludo" }, { texto: "El sol evapora el agua.", puntos: ["Sol"], gesto: "explicar" }], preguntas: [{ pregunta: "¿Qué evapora el agua?", opciones: ["El sol", "La luna"], correcta: 0, explicacion: "El calor del sol." }, { pregunta: "Mala", opciones: ["a"], correcta: 3, explicacion: "" }] }; };
  const p = await R.guion({ tema: "ciclo del agua", modo: "ensenar", partes: 2 }, s);
  assert.match(sistema, /profesor/);
  assert.equal(p.partes[0].puntos.length, 3, "hasta 3 puntos en el holograma");
  assert.equal(p.preguntas.length, 1, "se descartan preguntas inválidas");
  const q = await R.guion({ tema: "ciclo del agua", modo: "presentar" }, s);
  assert.equal(q.preguntas.length, 0);
  R.ia.json = async () => ({ titulo: "x", partes: [{ texto: "a", puntos: [], gesto: "volar" }], preguntas: [] });
  await assert.rejects(R.guion({ tema: "x".repeat(5), modo: "presentar" }, s), /formato/);
  R.ia.json = original;
});
