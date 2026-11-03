import { DATOS } from "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const A = await import("../src/almacen.ts");
const R = await import("../src/respaldo.ts");

test("exporta un zip válido sin secretos y lo vuelve a extraer", () => {
  A.crearBot({ nombre: "Rita", titulo: "Analista", descripcion: "x" });
  mkdirSync(path.join(DATOS, "computadora", "p"), { recursive: true });
  writeFileSync(path.join(DATOS, "computadora", "p", "nota.txt"), "hola");
  writeFileSync(path.join(DATOS, ".clave-conexiones"), "secreto");
  const zip = path.join(tmpdir(), `respaldo-${Date.now()}.zip`);
  const r = R.exportar(zip);
  assert.ok(r.archivos >= 2);
  try {
    const lista = execFileSync("unzip", ["-l", zip]).toString();
    assert.match(lista, /estado\.json/);
    assert.doesNotMatch(lista, /clave-conexiones/);
  } catch (err) {
    if (err.code !== "ENOENT") throw err; // sin unzip en el sistema: se valida solo con extraer()
  }
  const destino = path.join(tmpdir(), `restaurado-${Date.now()}`);
  R.extraer(zip, destino);
  assert.equal(readFileSync(path.join(destino, "computadora", "p", "nota.txt"), "utf8"), "hola");
  assert.match(readFileSync(path.join(destino, "estado.json"), "utf8"), /Rita/);
  assert.ok(!existsSync(path.join(destino, ".clave-conexiones")));
});

test("rechaza rutas que escapan de la carpeta y zips que no son de Gravity", () => {
  const malo = path.join(tmpdir(), `malo-${Date.now()}.zip`);
  // zip mínimo armado con el propio exportador no sirve para "../": se arma a mano con python si está.
  try {
    execFileSync("python3", ["-I", "-c", `import zipfile;z=zipfile.ZipFile(${JSON.stringify(malo)},'w');z.writestr('gravity-respaldo.json','{"formato":1}');z.writestr('estado.json','{}');z.writestr('../escape.txt','x');z.close()`]);
  } catch {
    return; // sin python no se puede armar el caso
  }
  assert.throws(() => R.extraer(malo, path.join(tmpdir(), `x-${Date.now()}`)), /Ruta inválida/);
  const ajeno = path.join(tmpdir(), `ajeno-${Date.now()}.zip`);
  execFileSync("python3", ["-I", "-c", `import zipfile;z=zipfile.ZipFile(${JSON.stringify(ajeno)},'w');z.writestr('foto.jpg','x');z.close()`]);
  assert.throws(() => R.extraer(ajeno, path.join(tmpdir(), `y-${Date.now()}`)), /No es un respaldo de Gravity/);
});
