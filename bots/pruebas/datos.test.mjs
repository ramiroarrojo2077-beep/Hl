import { DATOS } from "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";

const { COMPUTADORA } = await import("../src/almacen.ts");
const D = await import("../src/datos.ts");
const { exportarCarpeta } = await import("../src/respaldo.ts");

test("Data Lab: CSV con coma decimal, perfil, consultas por mes, comparar, anomalías, pronóstico, limpiar y unir", () => {
  mkdirSync(path.join(COMPUTADORA, "datos"), { recursive: true });
  const filas = ["fecha;producto;ventas;region"];
  const meses = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
  meses.forEach((m, i) => { for (let d = 1; d <= 4; d++) filas.push(`${m}-0${d};${d % 2 ? "Café" : "Té"};${(100 + i * 10 + d).toString()},5;${d % 2 ? "Norte" : "Sur"}`); });
  filas.push("2026-06-09;Café;9999,0;Norte"); // anomalía
  filas.push("2026-06-09;Café;9999,0;Norte"); // duplicado
  filas.push(";;;");
  writeFileSync(path.join(COMPUTADORA, "datos/ventas.csv"), filas.join("\n"));
  const t = D.leerTabla("datos/ventas.csv");
  assert.deepEqual(t.columnas, ["fecha", "producto", "ventas", "region"]);
  assert.equal(t.filas.length, 26, "la fila vacía no cuenta");
  const p = D.perfil(t);
  assert.equal(p.find((c) => c.nombre === "ventas").tipo, "número");
  assert.equal(p.find((c) => c.nombre === "fecha").tipo, "fecha");
  assert.equal(p.find((c) => c.nombre === "ventas").min, 101.5);
  const porProducto = D.consultar(t, { filtros: [{ columna: "region", op: "=", valor: "Norte" }], agrupar: "producto", periodo: null, metrica: "contar", columna: null, orden: "valor_desc", limite: null });
  assert.deepEqual(porProducto.grupos.map((g) => [g.grupo, g.valor]), [["Café", 14]]);
  const porMes = D.consultar(t, { filtros: [], agrupar: "fecha", periodo: "mes", metrica: "suma", columna: "ventas", orden: "grupo", limite: null });
  assert.equal(porMes.grupos.length, 6);
  assert.equal(porMes.grupos[0].grupo, "2026-01");
  assert.equal(porMes.grupos[0].valor, 101.5 + 102.5 + 103.5 + 104.5);
  const cmp = D.compararPeriodos(t, "fecha", "ventas", "mes");
  assert.match(cmp.resumen, /^2026-06: .* contra 2026-05/);
  const an = D.anomalias(t, "ventas");
  assert.equal(an.filas[0].valor, 9999);
  // pronóstico sobre una serie limpia (sin la anomalía): tendencia creciente y el intervalo contiene el valor
  const limpia = D.transformar(t, { quitarVacias: true, quitarDuplicados: true, recortarEspacios: true, normalizarColumnas: true, columnas: null, filtros: [{ columna: "ventas", op: "<", valor: 1000 }], unirCon: null });
  assert.equal(limpia.filas.length, 24);
  const pr = D.pronosticar(limpia, "fecha", "ventas", "mes", 2);
  assert.ok(pr.tendencia > 0 && pr.proximos.length === 2 && pr.proximos[0].bajo <= pr.proximos[0].valor && pr.proximos[0].valor <= pr.proximos[0].alto);
  // unir con otra tabla por clave
  writeFileSync(path.join(COMPUTADORA, "datos/precios.csv"), "producto,precio\nCafé,10\nTé,7\n");
  const unida = D.transformar(t, { quitarVacias: true, quitarDuplicados: true, recortarEspacios: true, normalizarColumnas: false, columnas: ["producto", "ventas", "precio"], filtros: [], unirCon: { ruta: "datos/precios.csv", clave: "producto", claveOtra: null } });
  assert.deepEqual(unida.filas[0].slice(0, 3), ["Café", 101.5, 10]);
  const ruta = D.guardarEnComputadora("ventas-limpio.csv", D.aCsv(limpia));
  assert.equal(D.leerTabla(ruta).filas.length, 24);
  const md = D.informe("datos/ventas.csv", t, { consulta: porMes, anomalias: { ...an, columna: "ventas" }, pronostico: pr });
  assert.match(md, /## Columnas[\s\S]*## suma de ventas por fecha \(mes\)[\s\S]*## Anomalías en ventas[\s\S]*## Pronóstico/);
});

test("Data Lab lee un Excel .xlsx real (textos compartidos, números y celdas vacías)", () => {
  const dir = path.join(DATOS, "xlsx-fuente");
  mkdirSync(path.join(dir, "xl/worksheets"), { recursive: true });
  writeFileSync(path.join(dir, "xl/sharedStrings.xml"), '<?xml version="1.0"?><sst><si><t>Cliente</t></si><si><t>Monto</t></si><si><t>Ana &amp; Co</t></si><si><r><t>Be</t></r><r><t>to</t></r></si></sst>');
  writeFileSync(path.join(dir, "xl/worksheets/sheet1.xml"), '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>150.5</v></c></row><row r="3"><c r="A3" t="s"><v>3</v></c><c r="C3" t="inlineStr"><is><t>extra</t></is></c></row></sheetData></worksheet>');
  writeFileSync(path.join(dir, "xl/workbook.xml"), "<workbook/>");
  exportarCarpeta(dir, path.join(COMPUTADORA, "datos/clientes.xlsx"));
  const t = D.leerTabla("datos/clientes.xlsx");
  assert.deepEqual(t.columnas, ["Cliente", "Monto", "columna_3"]);
  assert.deepEqual(t.filas, [["Ana & Co", 150.5, null], ["Beto", null, "extra"]]);
  assert.throws(() => D.leerTabla("../afuera.csv"), /computadora/);
});
