import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const A = await import("../src/almacen.ts");
const R = await import("../src/recuerdos.ts");

test("recordar busca en lo propio y lo del equipo, no en la memoria de otros", () => {
  const jefa = A.crearBot({ nombre: "Sofía", titulo: "Líder", descripcion: "x", cargo: "manager" });
  const ana = A.crearBot({ nombre: "Ana", titulo: "Analista", descripcion: "x", reportaA: jefa.id });
  const beto = A.crearBot({ nombre: "Beto", titulo: "Otro", descripcion: "x" });
  mkdirSync(A.raizMemoria(ana.id), { recursive: true });
  writeFileSync(path.join(A.raizMemoria(ana.id), "precios.md"), "Precio mayorista de remeras: 4500 pesos.");
  mkdirSync(A.raizMemoria(beto.id), { recursive: true });
  writeFileSync(path.join(A.raizMemoria(beto.id), "secreto.md"), "Precio secreto de remeras: 999.");
  const eq = path.join(A.COMPUTADORA, jefa.carpetaEquipo);
  mkdirSync(eq, { recursive: true });
  writeFileSync(path.join(eq, "plan.md"), "Lanzar remeras de algodón orgánico en marzo.");
  A.agregarMensajes(ana.id, { role: "user", content: "El envío a Córdoba tarda 4 días." });

  const r = R.buscar(ana.id, "precio remeras");
  assert.match(r[0].texto, /4500/);
  assert.ok(!r.some((h) => /999/.test(h.texto)), "no ve la memoria de Beto");
  assert.match(R.buscar(ana.id, "envío Córdoba", "conversaciones")[0].texto, /4 días/);
  assert.match(R.buscar(ana.id, "algodón", "equipo")[0].texto, /orgánico/);
  assert.match(R.formatear([], "nada"), /No encontré/);
});

test("la memoria de un proyecto la ven solo quienes participan", async () => {
  const A = await import("../src/almacen.ts");
  const P = await import("../src/proyectos.ts");
  const R = await import("../src/recuerdos.ts");
  const { writeFileSync } = await import("node:fs");
  const path = (await import("node:path")).default;
  const dentro = A.crearBot({ nombre: "Dentro", titulo: "x", descripcion: "x" });
  const fuera = A.crearBot({ nombre: "Fuera", titulo: "x", descripcion: "x" });
  const p = P.crearProyecto({ nombre: "Secreto", objetivo: "x" });
  P.agregarTarea(p.id, { titulo: "Algo", asignadoA: dentro.id });
  writeFileSync(path.join(A.COMPUTADORA, p.carpeta, "notas.md"), "La contraseña del wifi de la oficina es zanahoria.");
  assert.ok(R.buscar(dentro.id, "wifi oficina", "equipo").some((h) => /zanahoria/.test(h.texto)));
  assert.equal(R.buscar(fuera.id, "wifi oficina", "equipo").length, 0);
});
