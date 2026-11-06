import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const A = await import("../src/almacen.ts");
const C = await import("../src/codigo.ts");
const E = await import("../src/equipo-codigo.ts");
const P = await import("../src/proyectos.ts");
const { necesitaAprobacion } = await import("../src/herramientas.ts");
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

test("equipo de programación de 12: roles, proyecto en la carpeta del código, permisos y encargo al coordinador", async () => {
  assert.deepEqual(E.repartirRoles(11), { arquitecto: 1, tester: 2, revisor: 1, debugger: 1, disenador: 1, documentador: 1, frontend: 2, backend: 2 });
  C.crearProyectoCodigo("tienda", "web");
  const e = E.armarEquipoCodigo("tienda", { cantidad: 12, escribirSinPermiso: true, probarSinPermiso: true });
  assert.equal(1 + e.lideres.length + e.miembros.length, 12);
  const pr = P.buscarProyecto(e.proyectoId);
  assert.equal(pr.carpeta, "codigo/tienda/", "las tareas apuntan a la carpeta del código");
  assert.equal(pr.coordinadorId, e.coordinadorId);
  const dev = A.buscarBot(e.miembros.find((m) => m.rol === "backend").id);
  assert.equal(dev.reportaA, e.coordinadorId);
  // escribir en la carpeta del proyecto no pide permiso; fuera sí
  assert.equal(necesitaAprobacion("write", { file_path: "codigo/tienda/app.js", content: "x" }, dev), null);
  assert.ok(necesitaAprobacion("write", { file_path: "otra/app.js", content: "x" }, dev));
  // probar en copia aislada del proyecto no pide permiso; un comando normal sí
  assert.equal(necesitaAprobacion("probar_aislado", { carpeta: "codigo/tienda", comando: "npm test && echo ok" }, dev), null);
  assert.ok(necesitaAprobacion("bash", { command: "rm -rf codigo" }, dev));
  assert.throws(() => E.armarEquipoCodigo("tienda", { cantidad: 5, escribirSinPermiso: true, probarSinPermiso: true }), /ya tiene equipo/);
  // el encargo le llega al coordinador con todo el equipo y el proyecto donde cargar tareas
  await E.encargar("tienda", "Carrito de compras con pagos");
  await espera(50);
  const txt = JSON.stringify(A.conversacion(e.coordinadorId).mensajes);
  assert.match(txt, /Carrito de compras con pagos/);
  assert.match(txt, new RegExp(`proyecto ${pr.id}`));
  assert.ok(e.miembros.every((m) => txt.includes(m.id)), "lista a los 11 con su id");
  // sumar gente
  E.sumarAlEquipo("tienda", 3, "backend");
  const st = E.estadoEquipo("tienda");
  assert.equal(st.integrantes.length, 15);
  assert.equal(st.integrantes.filter((x) => x.rol === "Programador backend").length, 5);
});

test("equipo grande (45): sub-equipos con líderes", () => {
  C.crearProyectoCodigo("plataforma", "node");
  const e = E.armarEquipoCodigo("plataforma", { cantidad: 45, escribirSinPermiso: false, probarSinPermiso: false });
  assert.equal(1 + e.lideres.length + e.miembros.length, 45);
  assert.equal(e.lideres.length, 3);
  for (const l of e.lideres) {
    const b = A.buscarBot(l);
    assert.equal(b.cargo, "manager");
    assert.equal(b.reportaA, e.coordinadorId);
    assert.ok(A.directos(l).length >= 12);
  }
  assert.ok(A.listarBots().length <= A.MAX_BOTS);
  assert.throws(() => E.armarEquipoCodigo("tienda2", { cantidad: 61, escribirSinPermiso: true, probarSinPermiso: true }), /No existe|3 a 60/);
});
