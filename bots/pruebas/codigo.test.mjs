import { DATOS } from "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const { COMPUTADORA } = await import("../src/almacen.ts");
const C = await import("../src/codigo.ts");
const { extraerZip } = await import("../src/respaldo.ts");
const esperar = async (p, id) => { for (let i = 0; i < 200; i++) { const e = C.listarEjecuciones(p).find((x) => x.id === id); if (e.estado !== "corriendo") return e; await new Promise((r) => setTimeout(r, 50)); } throw new Error("no terminó"); };

test("Gravity Code: crear, memoria, buscar, reemplazar, archivos, ejecutar de verdad y exportar", async () => {
  const p = C.crearProyectoCodigo("Mi app", "node", "Suma números");
  assert.equal(p.carpeta, "codigo/Mi app");
  assert.ok(p.memoria && /Memoria técnica · Mi app/.test(C.leerMemoriaCodigo("Mi app")));
  assert.throws(() => C.crearProyectoCodigo("Mi app", "node"), /Ya existe/);
  assert.throws(() => C.crearProyectoCodigo("../afuera", "node"), /inválido/);
  const b = C.buscarEnProyecto("Mi app", "sumar");
  assert.ok(b.coincidencias.some((x) => x.ruta === "codigo/Mi app/index.js" && x.linea === 1));
  const r = C.reemplazarEnProyecto("Mi app", "sumar", "sumarDos");
  assert.equal(r.archivos, 2);
  assert.match(readFileSync(path.join(COMPUTADORA, "codigo/Mi app/index.test.js"), "utf8"), /sumarDos/);
  // ejecutar en la carpeta real: las pruebas pasan
  const ok = await esperar("Mi app", C.ejecutarEnProyecto("Mi app", "node --test", false).id);
  assert.equal(ok.estado, "ok", ok.salida);
  // romper la prueba: el error se ve tal cual
  writeFileSync(path.join(COMPUTADORA, "codigo/Mi app/index.test.js"), 'import test from "node:test";\nimport assert from "node:assert/strict";\ntest("falla", () => assert.equal(1, 2));\n');
  const mal = await esperar("Mi app", C.ejecutarEnProyecto("Mi app", "node --test", false).id);
  assert.equal(mal.estado, "error");
  // aislado: lo que escribe no queda
  const ais = await esperar("Mi app", C.ejecutarEnProyecto("Mi app", "echo hola > nuevo.txt && cat nuevo.txt", true).id);
  assert.equal(ais.estado, "ok"); assert.match(ais.salida, /hola/);
  assert.ok(!existsSync(path.join(COMPUTADORA, "codigo/Mi app/nuevo.txt")));
  // detener un comando largo
  const largo = C.ejecutarEnProyecto("Mi app", "sleep 20", false);
  assert.ok(C.detenerEjecucion(largo.id));
  assert.equal((await esperar("Mi app", largo.id)).estado, "cortado");
  // archivos
  C.crearCarpeta("Mi app", "src/util");
  C.renombrar("Mi app", "README.md", "src/LEEME.md");
  assert.ok(existsSync(path.join(COMPUTADORA, "codigo/Mi app/src/LEEME.md")));
  assert.throws(() => C.renombrar("Mi app", "src/LEEME.md", "../../fuera.md"), /dentro del proyecto/);
  C.borrar("Mi app", "src/LEEME.md");
  assert.ok(!existsSync(path.join(COMPUTADORA, "codigo/Mi app/src/LEEME.md")));
  // exportar y volver a abrir el zip
  const zip = path.join(DATOS, "mi-app.zip");
  assert.ok(C.exportarProyecto("Mi app", zip) >= 3);
  const destino = path.join(DATOS, "extraido");
  extraerZip(zip, destino, { quitarRaiz: true });
  assert.match(readFileSync(path.join(destino, "index.js"), "utf8"), /sumarDos/);
  assert.ok(existsSync(path.join(destino, ".gravity", "memoria.md")), "la memoria viaja con el proyecto");
  // borrar el proyecto lo manda a la papelera
  C.borrarProyecto("Mi app");
  assert.equal(C.listarProyectosCodigo().length, 0);
  await assert.rejects(C.importarGithub("no es un repo", null, null), /dueño\/nombre/);
});

test("Developer Pro: plantilla API con pruebas que pasan, dependencias, problemas con línea y despliegue", async () => {
  C.crearProyectoCodigo("api demo", "api");
  const ok = await esperar("api demo", C.ejecutarEnProyecto("api demo", "node --test", false).id);
  assert.equal(ok.estado, "ok", ok.salida);
  writeFileSync(path.join(COMPUTADORA, "codigo/api demo/package.json"), JSON.stringify({ dependencies: { express: "^4.18.0", zod: "4.6.5" }, devDependencies: { "@types/node": "~22.1.0" } }));
  const fake = async (u) => (u.includes("express") ? { version: "5.1.0" } : u.includes("zod") ? { version: "4.6.5" } : u.includes("%40types%2Fnode") || u.includes("@types%2Fnode") ? { version: "22.20.0" } : null);
  const deps = await C.dependencias("api demo", fake);
  assert.deepEqual(deps.map((d) => [d.nombre, d.estado]), [["express", "mayor"], ["zod", "al día"], ["@types/node", "menor"]]);
  // un error con archivo y línea se vuelve un enlace
  writeFileSync(path.join(COMPUTADORA, "codigo/api demo/servidor.test.js"), 'import test from "node:test";\nimport assert from "node:assert/strict";\n\ntest("falla", () => {\n  assert.equal(1, 2);\n});\n');
  const mal = await esperar("api demo", C.ejecutarEnProyecto("api demo", "node --test", false).id);
  const pr = C.problemas("api demo", mal.salida);
  assert.ok(pr.some((x) => x.ruta === "codigo/api demo/servidor.test.js" && x.linea === 5), JSON.stringify(pr));
  const creados = C.prepararDespliegue("api demo");
  assert.deepEqual(creados.sort(), [".dockerignore", "DESPLIEGUE.md", "Dockerfile"]);
  assert.match(readFileSync(path.join(COMPUTADORA, "codigo/api demo/Dockerfile"), "utf8"), /FROM node:22-alpine/);
  assert.deepEqual(C.prepararDespliegue("api demo"), [], "no pisa lo que ya existe");
  const ent = await C.entorno("api demo");
  assert.ok(ent.tipo.includes("Node.js") && ent.herramientas.find((h) => h.nombre === "node").version.startsWith("v"));
});
