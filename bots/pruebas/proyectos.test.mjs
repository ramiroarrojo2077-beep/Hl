import { DATOS } from "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

const A = await import("../src/almacen.ts");
const P = await import("../src/proyectos.ts");

test("proyecto con dependencias, progreso real y despacho al responsable", async () => {
  const ana = A.crearBot({ nombre: "Ana", titulo: "Programadora", descripcion: "x" });
  const p = P.crearProyecto({ nombre: "App de estudios", objetivo: "Calendario y tareas" });
  assert.ok(existsSync(path.join(DATOS, "computadora", p.carpeta)), "crea la carpeta del proyecto");
  const t1 = P.agregarTarea(p.id, { titulo: "Requisitos", criterio: "requisitos.md" });
  const t2 = P.agregarTarea(p.id, { titulo: "Prototipo", dependeDe: [t1.id], asignadoA: ana.id });
  assert.throws(() => P.cambiarTarea(p.id, t1.id, { dependeDe: [t2.id] }), /ciclo/);
  assert.throws(() => P.cambiarTarea(p.id, t2.id, { estado: "en_curso" }, ana.id), /depende/);
  assert.deepEqual([P.progreso(p).hechas, P.progreso(p).total, P.progreso(p).bloqueadas], [0, 2, 1]);
  assert.equal(A.conversacion(ana.id).mensajes.length, 0, "no se despacha una tarea bloqueada");
  assert.throws(() => P.cambiarTarea(p.id, t1.id, { estado: "completada" }, ana.id), /resultado/, "un compañero no completa sin resultado");
  P.cambiarTarea(p.id, t1.id, { estado: "completada", resultado: "requisitos.md listo" }, ana.id);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(P.progreso(p).porcentaje, 50);
  assert.ok(P.buscarProyecto(p.id).tareas.find((t) => t.id === t2.id).avisada, "la tarea desbloqueada se le pasa a Ana");
  assert.match(P.buscarProyecto(p.id).historial.at(-1).que, /se la pasó a Ana/);
});

test("al borrar un compañero sus tareas quedan sin responsable", () => {
  const b = A.crearBot({ nombre: "Beto", titulo: "Tester", descripcion: "x" });
  const p = P.crearProyecto({ nombre: "Otro", objetivo: "", coordinadorId: b.id });
  const t = P.agregarTarea(p.id, { titulo: "Probar", asignadoA: b.id });
  P.quitarBotDeProyectos(b.id);
  assert.equal(P.buscarProyecto(p.id).coordinadorId, null);
  assert.equal(P.buscarProyecto(p.id).tareas.find((x) => x.id === t.id).asignadoA, null);
});
