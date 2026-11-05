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
