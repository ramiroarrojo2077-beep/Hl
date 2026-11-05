import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const A = await import("../src/almacen.ts");
const P = await import("../src/proyectos.ts");
const { auditar, informeComoTexto } = await import("../src/auditoria.ts");

test("sugerencias para mejorar el flujo, sacadas de los datos reales", () => {
  assert.equal(auditar().sugerencias.length, 0, "sin datos no inventa sugerencias");
  for (const n of ["Ana", "Beto", "Caro", "Dani"]) A.crearBot({ nombre: n, titulo: "Analista", descripcion: "x" });
  const p = P.crearProyecto({ nombre: "Compras", objetivo: "Bajar costos" });
  for (const t of ["Uno", "Dos", "Tres"]) P.agregarTarea(p.id, { titulo: t });
  const i = auditar();
  const enlaces = i.sugerencias.map((s) => s.enlace);
  assert.ok(enlaces.includes("#/arquitecto"), "4 compañeros sin manager → Architect");
  assert.ok(enlaces.includes(`#/proyectos/${p.id}`), "3 tareas sin responsable → el proyecto");
  assert.match(informeComoTexto(i), /Sugerencias:/);
});

test("idioma por compañero: el prompt le pide hablar en ese idioma", async () => {
  const { sistemaDe } = await import("../src/agente.ts");
  const b = A.crearBot({ nombre: "Emma", titulo: "Ventas", descripcion: "x" });
  assert.doesNotMatch(sistemaDe(b), /## Idioma/, "castellano por defecto");
  b.idioma = "en";
  assert.match(sistemaDe(b), /## Idioma[\s\S]*inglés/);
});
