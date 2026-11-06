import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const A = await import("../src/almacen.ts");
const P = await import("../src/proyectos.ts");
const E = await import("../src/equipo.ts");
const M = await import("../src/midia.ts");

test("Mi día: objetivos con hitos, pendientes reales y resumen del día", () => {
  const o = M.crearObjetivo({ titulo: "Lanzar la tienda", fechaLimite: "2026-12-01", hitos: ["Catálogo", "Pagos", "Envíos"] });
  assert.equal(M.progresoObjetivo(o), 0);
  M.cambiarObjetivo(o.id, { hito: o.hitos[0].id, hecho: true });
  assert.equal(M.progresoObjetivo(M.listarObjetivos()[0]), 33);
  M.cambiarObjetivo(o.id, { agregarHito: "Publicidad" });
  assert.equal(M.listarObjetivos()[0].hitos.length, 4);
  const b = A.crearBot({ nombre: "Selene", titulo: "Asistente", descripcion: "x", cargo: "manager" });
  const ayu = A.crearBot({ nombre: "Ayu", titulo: "Ayudante", descripcion: "x", reportaA: b.id });
  A.crearRutina({ botId: b.id, nombre: "Llamar al contador", instrucciones: "x", habilidadId: null, horario: { tipo: "una", fecha: M.hoy(), hora: "15:00" }, activa: true });
  const p = P.crearProyecto({ nombre: "Tienda", objetivo: "x" });
  P.agregarTarea(p.id, { titulo: "Subir fotos", prioridad: 1, vence: "2026-11-10" });
  const pe = M.pendientes();
  assert.deepEqual(pe.recordatorios.map((r) => [r.hora, r.nombre]), [["15:00", "Llamar al contador"]]);
  assert.equal(pe.proyectos[0].titulo, "Subir fotos");
  assert.equal(pe.objetivos[0].proximoHito, "Pagos");
  const [t] = E.crearTareas(b, "x", [{ para: ayu.id, titulo: "Presupuesto", instrucciones: "x", entregable: "x" }], {});
  t.estado = "completa"; t.fin = new Date().toISOString();
  const r = M.resumenDelDia();
  assert.deepEqual(r.completadas, ["Presupuesto — Ayu"]);
  assert.deepEqual(r.hitos, ["Catálogo (Lanzar la tienda)"]);
  assert.equal(M.cambiarObjetivo(o.id, { borrar: true }), null);
  assert.equal(M.listarObjetivos().length, 0);
});
