import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import path from "node:path";

const A = await import("../src/almacen.ts");
const C = await import("../src/codigo.ts");
const G = await import("../src/git.ts");
const yo = { nombre: "Vos", email: "vos@gravity.local" };

test("Git Manager: repo, commit, estado, ramas, merge y contenido del último commit (sin git instalado)", async () => {
  C.crearProyectoCodigo("app", "node");
  const dir = path.join(A.COMPUTADORA, "codigo/app");
  assert.equal((await G.estado("app")).repo, false);
  await G.iniciar("app");
  let e = await G.estado("app");
  assert.equal(e.repo, true);
  assert.ok(e.cambios.some((c) => c.ruta === "index.js" && /nuevo/.test(c.estado)));
  assert.ok(!e.cambios.some((c) => c.ruta.includes("equipo.json")));
  const oid = await G.commit("app", "Primer commit", yo);
  assert.match(oid, /^[0-9a-f]{40}$/);
  e = await G.estado("app");
  assert.equal(e.cambios.length, 0);
  assert.equal(e.historial[0].mensaje, "Primer commit");
  assert.equal(e.rama, "main");
  await assert.rejects(G.commit("app", "nada", yo), /No hay cambios/);
  // rama nueva con un cambio y un borrado
  await G.crearRama("app", "carrito");
  writeFileSync(path.join(dir, "carrito.js"), "export const items = [];\n");
  unlinkSync(path.join(dir, "README.md"));
  e = await G.estado("app");
  assert.deepEqual(e.cambios.map((c) => c.ruta).sort(), ["README.md", "carrito.js"]);
  await assert.rejects(G.cambiarRama("app", "main"), /cambios sin guardar/);
  await G.commit("app", "Carrito", yo);
  assert.equal(await G.enHead("app", "carrito.js"), "export const items = [];\n");
  // volver a main: el archivo de la rama no está; unir trae el cambio
  await G.cambiarRama("app", "main");
  assert.equal(await G.enHead("app", "carrito.js"), null);
  assert.match(await G.unir("app", "carrito", yo), /Unida/);
  assert.equal(readFileSync(path.join(dir, "carrito.js"), "utf8"), "export const items = [];\n");
  assert.deepEqual((await G.estado("app")).ramas.sort(), ["carrito", "main"]);
  await assert.rejects(G.ponerRemoto("app", "http://malo.com/x"), /github/);
  await G.ponerRemoto("app", "https://github.com/yo/app.git");
  assert.equal((await G.estado("app")).remoto, "https://github.com/yo/app.git");
  await assert.rejects(G.subir("app", null), /conectar GitHub/);
});
