import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const A = await import("../src/almacen.ts");
const Q = await import("../src/arquitecto.ts");
const P = await import("../src/proyectos.ts");
const AU = await import("../src/auditoria.ts");

const propuesta = {
  resumen: "Equipo para lanzar la tienda.",
  manager: { nombre: "Mora", titulo: "Coordinadora", descripcion: "Coordina.", apagar: ["video"] },
  miembros: [
    { nombre: "Iván", titulo: "Investigador", descripcion: "Investiga.", apagar: ["mensajes", "conexiones"], temporal: true },
    { nombre: "Sol", titulo: "Redactora", descripcion: "Escribe.", apagar: ["computadora"], temporal: false },
  ],
  rutinas: [{ quien: "Iván", nombre: "Precios", instrucciones: "Revisar precios.", frecuencia: "diaria", hora: "9:00", dia: 1 }],
  proyecto: {
    nombre: "Tienda",
    objetivo: "Abrir la tienda online",
    tareas: [
      { titulo: "Investigar competencia", detalle: "x", criterio: "informe.md", responsable: "Iván", depende_de: [] },
      { titulo: "Textos", detalle: "x", criterio: "textos.md", responsable: "Sol", depende_de: [1] },
    ],
  },
  flujo: ["Investigar", "Escribir"],
  riesgos: [],
};

test("el Arquitecto aplica la propuesta: equipo, permisos, temporales, rutina y proyecto con dependencias", async () => {
  Q.Propuesta.parse(propuesta);
  const r = Q.aplicar(structuredClone(propuesta));
  assert.equal(r.creados, 3);
  const bots = A.listarBots();
  const ivan = bots.find((b) => b.nombre === "Iván");
  assert.deepEqual(ivan.bloqueadas, ["mensajes", "conexiones"]);
  assert.ok(ivan.temporal?.mision, "Iván es temporal");
  assert.equal(bots.find((b) => b.nombre === "Sol").temporal, undefined);
  assert.equal(ivan.reportaA, r.managerId);
  assert.equal(A.listarRutinas(ivan.id).length, 1);
  const p = P.buscarProyecto(r.proyecto.id);
  assert.equal(p.coordinadorId, r.managerId);
  assert.deepEqual(p.tareas[1].dependeDe, [p.tareas[0].id]);
  // Un segundo equipo con el mismo proyecto no choca por el nombre.
  const r2 = Q.aplicar(structuredClone(propuesta));
  assert.equal(r2.proyecto.nombre, "Tienda (2)");
});

test("la auditoría encuentra tareas vencidas y avisa quién puede enviar afuera", () => {
  const p = P.crearProyecto({ nombre: "Viejo", objetivo: "" });
  P.agregarTarea(p.id, { titulo: "Atrasada", vence: "2020-01-01" });
  A.crearBot({ nombre: "Eli", titulo: "Ventas", descripcion: "x", puedeEnviarAfuera: true });
  const i = AU.auditar();
  assert.ok(i.hallazgos.some((h) => h.area === "proyectos" && /vencida/.test(h.texto)));
  assert.ok(i.hallazgos.some((h) => h.area === "permisos" && /Eli/.test(h.texto)));
  assert.match(AU.informeComoTexto(i), /Auditoría de Gravity/);
});
