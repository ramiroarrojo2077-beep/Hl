import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const A = await import("../src/almacen.ts");
const { PLANTILLAS_EQUIPO } = await import("../src/plantillas.ts");
const { crearEquipo } = await import("../src/equipo.ts");
const Code = await import("../src/codigo.ts");
const E = await import("../src/equipo-codigo.ts");
const P = await import("../src/proyectos.ts");

test("plantilla «Programación»: líder técnico + arquitectura, frontend, backend, pruebas, revisión y DevOps", () => {
  const t = PLANTILLAS_EQUIPO.find((x) => x.id === "programacion");
  assert.ok(t);
  assert.equal(t.nombre, "Programación");
  assert.equal(t.manager.titulo, "Líder técnico");
  assert.deepEqual(t.miembros.map((m) => [m.titulo, m.cantidad]), [["Arquitecto de software", 1], ["Programador frontend", 2], ["Programador backend", 2], ["Tester", 1], ["Revisor de código", 1], ["DevOps", 1]]);
  assert.equal(t.total, 9);
  assert.equal(PLANTILLAS_EQUIPO[0].id, "programacion", "aparece primero");
});

test("roles desde el título del puesto", () => {
  assert.deepEqual(["Arquitecto de software", "Programador frontend", "Programador backend", "Tester", "QA", "Revisor de código", "DevOps", "Documentador técnico", "Diseñador de interfaces", "Programador"].map(E.rolDeTitulo), ["arquitecto", "frontend", "backend", "tester", "tester", "revisor", "devops", "documentador", "disenador", "programador"]);
});

test("vincular el equipo a un proyecto de Gravity Code: carpeta, roles, proyecto de tareas y permiso de escritura", () => {
  const t = PLANTILLAS_EQUIPO.find((x) => x.id === "programacion");
  const { manager, miembros } = crearEquipo({ plantilla: t.id, reportaA: null, carpetaLibre: true, puestos: t.miembros.map((m) => ({ titulo: m.titulo, descripcion: m.descripcion, cantidad: m.cantidad })) });
  assert.equal(miembros.length, 8);
  Code.crearProyectoCodigo("tienda", "web", "");
  const e = E.vincularEquipoCodigo("tienda", manager.id, { escribirSinPermiso: true, probarSinPermiso: true });
  const leido = E.leerEquipo("tienda");
  assert.equal(leido.coordinadorId, manager.id);
  assert.deepEqual(leido.miembros.map((m) => m.rol).sort(), ["arquitecto", "backend", "backend", "devops", "frontend", "frontend", "revisor", "tester"]);
  const p = P.buscarProyecto(e.proyectoId);
  assert.equal(p.carpeta, "codigo/tienda/");
  assert.equal(p.coordinadorId, manager.id);
  assert.match(A.buscarBot(miembros[0].id).descripcion, /Proyecto: codigo\/tienda\//);
  assert.ok(A.listarReglas().some((r) => r.herramienta === "editor" && r.patron === "codigo/tienda/" && r.alcance.managerId === manager.id), "puede escribir en la carpeta del proyecto");
  assert.equal(E.puedeProbarSinPermiso(miembros[3].id, "codigo/tienda/"), true);
  assert.throws(() => E.vincularEquipoCodigo("tienda", manager.id, { escribirSinPermiso: false, probarSinPermiso: false }), /ya tiene equipo/);
  assert.throws(() => E.vincularEquipoCodigo("no-existe", manager.id, { escribirSinPermiso: false, probarSinPermiso: false }), /No existe/);
});
