import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const A = await import("../src/almacen.ts");
const AU = await import("../src/automatizaciones.ts");
const { emitir } = await import("../src/eventos.ts");

test("si una tarea queda bloqueada, le llega el pedido al compañero elegido (una sola vez)", async () => {
  AU.iniciarAutomatizaciones();
  const jefa = A.crearBot({ nombre: "Rita", titulo: "Coordinadora", descripcion: "x" });
  const dev = A.crearBot({ nombre: "Dino", titulo: "Dev", descripcion: "x" });
  const regla = AU.crearAutomatizacion({ nombre: "Destrabar", evento: "tarea_bloqueada", botId: jefa.id, instrucciones: "Proponé una solución." });
  const tarea = { id: "t1", estado: "bloqueada", titulo: "Login", paraId: dev.id, paraNombre: "Dino", resultado: "Falta la clave de la API" };
  emitir("tarea", tarea);
  emitir("tarea", tarea);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(AU.listarAutomatizaciones().find((x) => x.id === regla.id).disparos, 1, "una sola vez por evento");
  emitir("tarea", { ...tarea, id: "t2", paraId: jefa.id });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(AU.listarAutomatizaciones().find((x) => x.id === regla.id).disparos, 1, "no se dispara por su propia tarea");
  AU.cambiarAutomatizacion(regla.id, false);
  emitir("tarea", { ...tarea, id: "t3" });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(AU.listarAutomatizaciones().find((x) => x.id === regla.id).disparos, 1, "pausada no dispara");
  assert.throws(() => AU.crearAutomatizacion({ nombre: "x", evento: "inventado", botId: jefa.id, instrucciones: "x" }), /Evento/);
});
