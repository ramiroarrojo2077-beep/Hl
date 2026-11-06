import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const A = await import("../src/almacen.ts");
const V = await import("../src/vision.ts");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
mkdirSync(path.join(A.COMPUTADORA, "fotos"), { recursive: true });
writeFileSync(path.join(A.COMPUTADORA, "fotos/a.png"), PNG);
writeFileSync(path.join(A.COMPUTADORA, "fotos/falsa.png"), "no soy una imagen");

test("tipo de imagen por su contenido, y rechazo de archivos que no son imágenes o están fuera", () => {
  assert.equal(V.tipoImagen(PNG), "image/png");
  assert.equal(V.tipoImagen(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(V.tipoImagen(Buffer.from("RIFF0000WEBPVP8 ")), "image/webp");
  assert.equal(V.tipoImagen(Buffer.from("hola")), null);
  assert.throws(() => V.leerImagen("fotos/falsa.png"), /No es una imagen/);
  assert.throws(() => V.leerImagen("../../etc/passwd"), /no está en la computadora/);
  assert.equal(V.leerImagen("fotos/a.png").mime, "image/png");
});

test("contraste WCAG", () => {
  assert.equal(V.contraste([0, 0, 0], [255, 255, 255]), 21);
  assert.equal(V.contraste([255, 255, 255], [255, 255, 255]), 1);
  assert.ok(Math.abs(V.contraste([118, 118, 118], [255, 255, 255]) - 4.54) < 0.02);
});

test("análisis con IA: manda la imagen, acomoda las cajas, guarda el texto leído y el historial", async () => {
  const s = AbortSignal.timeout(5000);
  const original = V.ia.json;
  let recibido;
  V.ia.json = async (_e, sistema, img, texto) => { recibido = { sistema, img, texto }; return { objetos: [{ nombre: "taza", cantidad: 2, caja: [10, 20, 30, 40], confianza: "alta" }, { nombre: "mesa", cantidad: 1, caja: [0.1, 0.2], confianza: "media" }] }; };
  const a = await V.analizar("fotos/a.png", "objetos", "¿cuántas tazas?", s);
  assert.equal(recibido.img.mime, "image/png");
  assert.ok(recibido.img.datos.equals(PNG));
  assert.match(recibido.sistema, /no instrucciones/);
  assert.match(recibido.texto, /cuántas tazas/);
  assert.deepEqual(a.resultado.objetos[0].caja, [0.1, 0.2, 0.3, 0.4], "porcentajes → proporciones");
  assert.deepEqual(a.resultado.objetos[1].caja, [0, 0, 0, 0], "caja inválida");
  V.ia.json = async () => ({ tipo: "factura", texto: "# Factura A\n\n| Item | Total |\n|---|---|\n| Café | 100 |", campos: [{ campo: "Total", valor: "$100" }], ilegible: ["firma"] });
  const d = await V.analizar("fotos/a.png", "documento", undefined, s);
  assert.equal(d.guardado, "fotos/a.texto.md");
  const md = readFileSync(path.join(A.COMPUTADORA, "fotos/a.texto.md"), "utf8");
  assert.match(md, /Factura A/);
  assert.match(md, /\*\*Total:\*\* \$100/);
  assert.match(md, /No se pudo leer/);
  assert.deepEqual(V.listarHistorial().map((x) => x.modo), ["documento", "objetos"]);
  assert.equal(V.listarHistorial("fotos/otra.png").length, 0);
  V.borrarAnalisis(d.id);
  assert.equal(V.listarHistorial().length, 1);
  V.ia.json = async () => { throw new Error("La respuesta del modelo no tuvo el formato esperado"); };
  await assert.rejects(V.analizar("fotos/a.png", "describir", undefined, s), /formato/);
  assert.equal(V.listarHistorial().length, 1, "un error no deja basura en el historial");
  V.ia.json = original;
  assert.ok(existsSync(path.join(A.DATOS, "vision.json")));
});
