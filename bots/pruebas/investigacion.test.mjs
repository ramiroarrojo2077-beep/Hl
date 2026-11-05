import { DATOS } from "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";

const A = await import("../src/almacen.ts");
const D = await import("../src/documentos.ts");
const I = await import("../src/investigacion.ts");
const K = await import("../src/canales.ts");
const { exportarCarpeta } = await import("../src/respaldo.ts");
const { buscarTodo: buscar } = await import("../src/buscador.ts");

test("documentos: texto de PDF (FlateDecode) y Word, partes y búsqueda; el buscador global entra a los PDF", () => {
  mkdirSync(path.join(A.COMPUTADORA, "docs"), { recursive: true });
  const contenido = Buffer.from("BT /F1 12 Tf 72 712 Td (Contrato de alquiler) Tj ET\nBT 72 690 Td [(El inquilino paga ) -300 (el dep\\363sito)] TJ ET\nBT 72 670 Td (Vigencia: 24 meses) Tj ET");
  const comp = deflateSync(contenido);
  const pdf = Buffer.concat([Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${comp.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), comp, Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1")]);
  writeFileSync(path.join(A.COMPUTADORA, "docs/contrato.pdf"), pdf);
  const t = D.textoDeDocumento("docs/contrato.pdf");
  assert.match(t, /Contrato de alquiler/);
  assert.match(t, /El inquilino paga el depósito/);
  assert.match(t, /Vigencia: 24 meses/);
  // Word
  const dir = path.join(DATOS, "docx-fuente");
  mkdirSync(path.join(dir, "word"), { recursive: true });
  writeFileSync(path.join(dir, "word/document.xml"), '<w:document><w:body><w:p><w:r><w:t>Informe anual</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Ventas </w:t></w:r><w:r><w:t>&amp; costos</w:t></w:r></w:p></w:body></w:document>');
  exportarCarpeta(dir, path.join(A.COMPUTADORA, "docs/informe.docx"));
  assert.equal(D.textoDeDocumento("docs/informe.docx"), "Informe anual\nVentas & costos");
  // documento largo: partes y búsqueda
  const largo = Array.from({ length: 3000 }, (_, i) => `Línea ${i} ${i === 2500 ? "cláusula de rescisión anticipada" : "texto común"}`).join("\n");
  writeFileSync(path.join(A.COMPUTADORA, "docs/largo.txt"), largo);
  const tl = D.textoDeDocumento("docs/largo.txt");
  assert.ok(D.cantidadPartes(tl) > 5);
  const r = D.buscarEnDocumento(tl, "rescision anticipada");
  assert.equal(r.length, 1);
  assert.match(D.parte(tl, r[0].parte), /cláusula de rescisión anticipada/);
  assert.ok(buscar("vigencia meses").some((x) => x.titulo === "docs/contrato.pdf"), "el buscador global encuentra texto dentro del PDF");
});

test("investigación: fuentes de los compañeros y manuales; monitor de cambios con diferencias, anuncio y caída", async () => {
  const b = A.crearBot({ nombre: "Ivo", titulo: "Investigador", descripcion: "x" });
  A.conversacion(b.id).mensajes.push({ role: "assistant", content: [{ type: "server_tool_use", id: "s1", name: "web_fetch", input: { url: "https://ejemplo.org/informe" } }, { type: "web_search_tool_result", tool_use_id: "s2", content: [{ type: "web_search_result", url: "https://datos.gob.ar/x", title: "Datos abiertos" }] }] });
  I.agregarFuente({ url: "https://manual.com/a", titulo: "Mi fuente", etiquetas: ["clave"] });
  const fs = I.listarFuentes();
  assert.deepEqual(fs.map((f) => f.url).sort(), ["https://datos.gob.ar/x", "https://ejemplo.org/informe", "https://manual.com/a"]);
  assert.equal(I.listarFuentes("clave").length, 1);
  let pagina = "Precio: 100\nStock: sí\nEnvío gratis";
  const leer = async () => { if (pagina === null) throw new Error("La página respondió 404."); return `https://tienda.com/p\n\n${pagina}`; };
  const m = I.crearMonitor({ url: "https://tienda.com/p", nombre: "Producto", cadaHoras: 1 });
  await I.revisar(m.id, leer);
  assert.equal(I.listarMonitores()[0].cambios.length, 0, "la primera revisión es la base");
  pagina = "Precio: 120\nStock: sí\nEnvío gratis";
  await I.revisar(m.id, leer);
  const c = I.listarMonitores()[0].cambios[0];
  assert.deepEqual([c.agregadas, c.quitadas], [["Precio: 120"], ["Precio: 100"]]);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(K.buscarCanal("anuncios").mensajes.some((x) => /Cambió la página «Producto»/.test(x.texto)));
  pagina = null;
  await I.revisar(m.id, leer);
  assert.match(I.estadoMonitor(I.listarMonitores()[0]), /No responde: La página respondió 404/);
  assert.deepEqual(I.diferencias("a\nbbb\nccc", "bbb\nddd"), { agregadas: ["ddd"], quitadas: ["ccc"] });
});
