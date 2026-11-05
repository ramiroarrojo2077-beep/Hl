import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const A = await import("../src/almacen.ts");
const E = await import("../src/equipo.ts");
const V = await import("../src/evolucion.ts");
const { listarAutomatizaciones } = await import("../src/automatizaciones.ts");

test("Gravity Evolution: propone con datos reales y aplica solo lo que el usuario elige", () => {
  assert.equal(V.propuestas().propuestas.length, 0, "sin datos no propone nada");
  const jefa = A.crearBot({ nombre: "Rita", titulo: "Coordinadora", descripcion: "x", cargo: "manager" });
  const dev = A.crearBot({ nombre: "Dino", titulo: "Dev", descripcion: "x", reportaA: jefa.id });
  const pro = A.crearBot({ nombre: "Pia", titulo: "Dev senior", descripcion: "x", reportaA: jefa.id });
  const cerrar = (t, estado) => { t.estado = estado; t.resultado = estado; t.fin = new Date().toISOString(); };
  for (let i = 0; i < 4; i++) { const [t] = E.crearTareas(jefa, "x", [{ para: dev.id, titulo: `mal ${i}`, instrucciones: "x", entregable: "x" }], {}); cerrar(t, i % 2 ? "fallida" : "bloqueada"); }
  for (let i = 0; i < 4; i++) { const [t] = E.crearTareas(jefa, "x", [{ para: pro.id, titulo: `bien ${i}`, instrucciones: "x", entregable: "x" }], {}); cerrar(t, "completa"); }
  const ids = V.propuestas().propuestas.map((p) => p.id);
  assert.ok(ids.includes(`mentor:${dev.id}:${pro.id}`), "Pia (confiable) mentora de Dino (falla seguido)");
  assert.ok(ids.includes("respaldo"));
  assert.ok(ids.includes(`flujo:${jefa.id}`));
  assert.equal(A.buscarBot(dev.id).mentorId ?? null, null, "proponer no cambia nada");
  V.aplicarPropuesta(`mentor:${dev.id}:${pro.id}`);
  assert.equal(A.buscarBot(dev.id).mentorId, pro.id);
  V.aplicarPropuesta(`flujo:${jefa.id}`);
  assert.ok(listarAutomatizaciones().some((a) => a.botId === jefa.id && a.evento === "tarea_bloqueada"));
  V.descartarPropuesta("respaldo");
  const r = V.propuestas();
  assert.ok(!r.propuestas.some((p) => p.id === "respaldo" || p.id.startsWith("mentor:") || p.id.startsWith("flujo:")));
  assert.equal(r.historial.length, 2);
  assert.throws(() => V.aplicarPropuesta("inventada"), /ya no corresponde/);
});
