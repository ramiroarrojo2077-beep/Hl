import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const A = await import("../src/almacen.ts");
const V = await import("../src/versiones.ts");

test("versiones: guarda la anterior, restaura y no sale de la computadora", () => {
  const abs = path.join(A.COMPUTADORA, "docs", "plan.md");
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, "versión 1");
  V.guardarVersion("docs/plan.md");
  writeFileSync(abs, "versión 2");
  const xs = V.listarVersiones("docs/plan.md");
  assert.equal(xs.length, 1);
  V.restaurarVersion("docs/plan.md", xs[0].id);
  assert.equal(readFileSync(abs, "utf8"), "versión 1");
  assert.equal(V.listarVersiones("docs/plan.md").length, 2, "lo que había quedó como versión");
  assert.deepEqual(V.listarVersiones("../estado.json"), []);
  assert.throws(() => V.restaurarVersion("docs/plan.md", "../../estado.json"), /inválida/);
  for (let i = 0; i < 25; i++) V.guardarVersion("docs/plan.md");
  assert.ok(V.listarVersiones("docs/plan.md").length <= 20);
});
