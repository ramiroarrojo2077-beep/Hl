// Gravity Data Lab: análisis de tablas reales de la computadora (CSV, TSV, JSON y Excel .xlsx).
// Todo se calcula acá, con los datos del archivo: perfil de columnas, agrupar, comparar períodos,
// anomalías, pronósticos con intervalo, transformaciones y un informe exportable. El modelo solo se usa
// para traducir una pregunta en lenguaje natural a una consulta estructurada, que también se ejecuta acá.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { z } from "zod";
import { COMPUTADORA } from "./almacen.ts";

export const MAX_FILAS = 200_000;
const MAX_BYTES = 40 * 1024 * 1024;

export type Valor = string | number | null;
export interface Tabla { columnas: string[]; filas: Valor[][] }

// ---- Lectura ----

function rutaSegura(ruta: string): string {
  const abs = path.resolve(COMPUTADORA, ruta);
  if (abs !== COMPUTADORA && !abs.startsWith(COMPUTADORA + path.sep)) throw new Error("El archivo tiene que estar en la computadora.");
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`No existe el archivo ${ruta}.`);
  if (statSync(abs).size > MAX_BYTES) throw new Error("El archivo es demasiado grande (más de 40 MB).");
  return abs;
}

const aNumero = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  // 1.234,56 o 1,234.56 o 1234.56
  let n = t.replace(/[$€%\s]/g, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(n)) n = n.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+,\d+$/.test(n)) n = n.replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(n)) n = n.replace(/,/g, "");
  const v = Number(n);
  return Number.isFinite(v) && /^-?[\d.]+(e-?\d+)?$/i.test(n) ? v : null;
};

/** CSV/TSV con comillas (RFC 4180) y separador detectado (coma, punto y coma o tabulación). */
export function parsearCsv(texto: string): Tabla {
  const limpio = texto.replace(/^﻿/, "");
  const primera = limpio.split(/\r?\n/, 1)[0] ?? "";
  const sep = [",", ";", "\t", "|"].map((c) => [c, primera.split(c).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i]!;
    if (comillas) {
      if (c === '"') { if (limpio[i + 1] === '"') { campo += '"'; i++; } else comillas = false; }
      else campo += c;
    } else if (c === '"' && !campo) comillas = true;
    else if (c === sep) { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && limpio[i + 1] === "\n") i++;
      fila.push(campo); campo = "";
      if (fila.some((x) => x.trim())) filas.push(fila);
      fila = [];
      if (filas.length > MAX_FILAS) break;
    } else campo += c;
  }
  if (campo || fila.length) { fila.push(campo); if (fila.some((x) => x.trim())) filas.push(fila); }
  const [cab = [], ...resto] = filas;
  return tipar({ columnas: nombresUnicos(cab), filas: resto.map((f) => cab.map((_, i) => f[i] ?? "")) });
}

function nombresUnicos(cab: string[]): string[] {
  const vistos = new Map<string, number>();
  return cab.map((c, i) => {
    const base = c.trim() || `columna_${i + 1}`;
    const n = vistos.get(base) ?? 0;
    vistos.set(base, n + 1);
    return n ? `${base}_${n + 1}` : base;
  });
}

/** Convierte a número las columnas que son números (más del 90 % de sus valores no vacíos). */
function tipar(t: { columnas: string[]; filas: (string | number | null)[][] }): Tabla {
  const filas = t.filas.map((f) => f.map((v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v)));
  t.columnas.forEach((_, j) => {
    const vals = filas.map((f) => f[j]).filter((v) => v != null);
    const nums = vals.map((v) => (typeof v === "number" ? v : aNumero(String(v))));
    if (vals.length && nums.filter((n) => n != null).length / vals.length >= 0.9) filas.forEach((f) => { const v = f[j]; f[j] = v == null ? null : typeof v === "number" ? v : aNumero(String(v)); });
  });
  return { columnas: t.columnas, filas };
}

// Lector mínimo de .xlsx: zip en memoria + la primera hoja + textos compartidos.
function leerZip(buf: Buffer): Map<string, Buffer> {
  const salida = new Map<string, Buffer>();
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error("No es un archivo Excel válido.");
  const cantidad = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  for (let k = 0; k < cantidad; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("El Excel está dañado.");
    const metodo = buf.readUInt16LE(p + 10), comprimido = buf.readUInt32LE(p + 20), largoN = buf.readUInt16LE(p + 28), largoE = buf.readUInt16LE(p + 30), largoC = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const nombre = buf.subarray(p + 46, p + 46 + largoN).toString("utf8");
    p += 46 + largoN + largoE + largoC;
    if (!/^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml|workbook\.xml)$/.test(nombre)) continue;
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const cuerpo = buf.subarray(ini, ini + comprimido);
    salida.set(nombre, metodo === 8 ? inflateRawSync(cuerpo, { maxOutputLength: 200 * 1024 * 1024 }) : cuerpo);
  }
  return salida;
}
const desescapar = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
const columnaDe = (ref: string) => { let n = 0; for (const c of ref.replace(/\d+/g, "")) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };

export function parsearXlsx(buf: Buffer): Tabla {
  const z = leerZip(buf);
  const compartidas = [...(z.get("xl/sharedStrings.xml")?.toString("utf8") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => desescapar([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  const hoja = [...z.keys()].filter((k) => k.startsWith("xl/worksheets/")).sort()[0];
  if (!hoja) throw new Error("El Excel no tiene hojas.");
  const xml = z.get(hoja)!.toString("utf8");
  const filas: Valor[][] = [];
  for (const f of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const fila: Valor[] = [];
    for (const c of f[1]!.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!, dentro = c[2] ?? "";
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const tipo = /t="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(dentro)?.[1];
      let valor: Valor = null;
      if (tipo === "s") valor = compartidas[Number(v)] ?? "";
      else if (tipo === "inlineStr") valor = desescapar([...dentro.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
      else if (tipo === "str" || tipo === "e") valor = v != null ? desescapar(v) : null;
      else if (tipo === "b") valor = v === "1" ? "VERDADERO" : "FALSO";
      else valor = v != null && v !== "" ? Number(v) : null;
      fila[ref ? columnaDe(ref) : fila.length] = valor;
    }
    filas.push(Array.from(fila, (x) => x ?? null));
    if (filas.length > MAX_FILAS) break;
  }
  const [cab = [], ...resto] = filas;
  const ancho = Math.max(cab.length, ...resto.slice(0, 50).map((f) => f.length));
  return tipar({ columnas: nombresUnicos(Array.from({ length: ancho }, (_, i) => String(cab[i] ?? ""))), filas: resto.map((f) => Array.from({ length: ancho }, (_, i) => f[i] ?? null)) });
}

export function leerTabla(ruta: string): Tabla {
  const abs = rutaSegura(ruta);
  const ext = path.extname(abs).toLowerCase();
  if (ext === ".xlsx") return parsearXlsx(readFileSync(abs));
  if (ext === ".json") {
    const d = JSON.parse(readFileSync(abs, "utf8")) as unknown;
    const xs = Array.isArray(d) ? d : Array.isArray((d as { datos?: unknown })?.datos) ? (d as { datos: unknown[] }).datos : null;
    if (!xs || !xs.every((x) => x && typeof x === "object")) throw new Error("El JSON tiene que ser una lista de objetos.");
    const columnas = [...new Set(xs.flatMap((x) => Object.keys(x as object)))];
    return tipar({ columnas, filas: xs.slice(0, MAX_FILAS).map((x) => columnas.map((c) => { const v = (x as Record<string, unknown>)[c]; return v == null ? null : typeof v === "number" ? v : String(v); })) });
  }
  if ([".csv", ".tsv", ".txt"].includes(ext)) return parsearCsv(readFileSync(abs, "utf8"));
  throw new Error("Formatos que lee Data Lab: .csv, .tsv, .txt, .json y .xlsx.");
}

// ---- Perfil ----

export interface Columna {
  nombre: string;
  tipo: "número" | "fecha" | "texto";
  vacios: number;
  distintos: number;
  min?: number | string; max?: number | string; media?: number; mediana?: number; desvio?: number; suma?: number;
  frecuentes?: { valor: string; n: number }[];
}

const esFecha = (s: string) => /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/.test(s) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s);
export function aFecha(v: Valor): Date | null {
  if (v == null) return null;
  const s = String(v).trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  const d = m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))) : esFecha(s) ? new Date(s.length === 10 ? `${s}T00:00:00Z` : s) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}
const numeros = (t: Tabla, j: number) => t.filas.map((f) => f[j]).filter((v): v is number => typeof v === "number");
const mediana = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : 0; };
const redondo = (n: number) => Math.round(n * 1000) / 1000;

export function perfil(t: Tabla): Columna[] {
  return t.columnas.map((nombre, j) => {
    const vals = t.filas.map((f) => f[j]);
    const llenos = vals.filter((v) => v != null);
    const c: Columna = { nombre, tipo: "texto", vacios: vals.length - llenos.length, distintos: new Set(llenos.map(String)).size };
    const ns = numeros(t, j);
    if (llenos.length && ns.length === llenos.length) {
      const media = ns.reduce((a, b) => a + b, 0) / ns.length;
      Object.assign(c, { tipo: "número", min: Math.min(...ns), max: Math.max(...ns), media: redondo(media), mediana: redondo(mediana(ns)), suma: redondo(ns.reduce((a, b) => a + b, 0)), desvio: redondo(Math.sqrt(ns.reduce((a, b) => a + (b - media) ** 2, 0) / Math.max(1, ns.length - 1))) });
    } else if (llenos.length && llenos.filter((v) => aFecha(v)).length / llenos.length >= 0.9) {
      const fs = llenos.map(aFecha).filter((d): d is Date => !!d).map((d) => d.toISOString().slice(0, 10)).sort();
      Object.assign(c, { tipo: "fecha", min: fs[0], max: fs.at(-1) });
    }
    if (c.tipo !== "número") {
      const cuenta = new Map<string, number>();
      for (const v of llenos) cuenta.set(String(v), (cuenta.get(String(v)) ?? 0) + 1);
      c.frecuentes = [...cuenta].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([valor, n]) => ({ valor, n }));
    }
    return c;
  });
}

// ---- Consultas estructuradas (lo que pide la interfaz, la herramienta de los compañeros o la pregunta en lenguaje natural) ----

export const Filtro = z.object({ columna: z.string(), op: z.enum(["=", "!=", ">", ">=", "<", "<=", "contiene"]), valor: z.union([z.string(), z.number()]) });
export const Consulta = z.object({
  filtros: z.array(Filtro).describe("Condiciones que tienen que cumplir las filas ([] = todas)"),
  agrupar: z.string().nullable().describe("Columna por la que agrupar, o null"),
  periodo: z.enum(["dia", "semana", "mes", "trimestre", "año"]).nullable().describe("Si agrupar es una columna de fecha, el período; si no, null"),
  metrica: z.enum(["contar", "suma", "promedio", "minimo", "maximo", "mediana"]),
  columna: z.string().nullable().describe("Columna numérica para la métrica (null para contar)"),
  orden: z.enum(["valor_desc", "valor_asc", "grupo"]).describe("Orden del resultado"),
  limite: z.number().nullable().describe("Cuántos grupos devolver (null = todos, máximo 200)"),
});
export type Consulta = z.infer<typeof Consulta>;

const indice = (t: Tabla, c: string) => { const j = t.columnas.indexOf(c); if (j < 0) throw new Error(`No existe la columna «${c}». Columnas: ${t.columnas.join(", ")}.`); return j; };

export function filtrar(t: Tabla, filtros: z.infer<typeof Filtro>[]): Tabla {
  const fs = filtros.map((f) => ({ ...f, j: indice(t, f.columna) }));
  return { columnas: t.columnas, filas: t.filas.filter((fila) => fs.every((f) => {
    const v = fila[f.j];
    if (f.op === "contiene") return v != null && String(v).toLowerCase().includes(String(f.valor).toLowerCase());
    const a = typeof v === "number" ? v : v == null ? null : String(v);
    const b = typeof a === "number" ? Number(f.valor) : String(f.valor);
    if (a == null) return f.op === "!=";
    switch (f.op) { case "=": return a == b; case "!=": return a != b; case ">": return a > b; case ">=": return a >= b; case "<": return a < b; default: return a <= b; }
  })) };
}

export function clavePeriodo(d: Date, p: NonNullable<Consulta["periodo"]>): string {
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (p === "dia") return d.toISOString().slice(0, 10);
  if (p === "mes") return `${y}-${String(m + 1).padStart(2, "0")}`;
  if (p === "trimestre") return `${y}-T${Math.floor(m / 3) + 1}`;
  if (p === "año") return String(y);
  const lunes = new Date(Date.UTC(y, m, d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
  return `sem ${lunes.toISOString().slice(0, 10)}`;
}

function aplicarMetrica(xs: number[], metrica: Consulta["metrica"], n: number): number {
  if (metrica === "contar") return n;
  if (!xs.length) return 0;
  if (metrica === "suma") return redondo(xs.reduce((a, b) => a + b, 0));
  if (metrica === "promedio") return redondo(xs.reduce((a, b) => a + b, 0) / xs.length);
  if (metrica === "minimo") return Math.min(...xs);
  if (metrica === "maximo") return Math.max(...xs);
  return redondo(mediana(xs));
}

export interface Resultado { grupos: { grupo: string; valor: number; n: number }[]; filas: number; descripcion: string }

export function consultar(t0: Tabla, q: Consulta): Resultado {
  const t = filtrar(t0, q.filtros);
  const jv = q.metrica === "contar" || !q.columna ? -1 : indice(t, q.columna);
  const jg = q.agrupar ? indice(t, q.agrupar) : -1;
  const grupos = new Map<string, { xs: number[]; n: number }>();
  for (const f of t.filas) {
    let g = "Total";
    if (jg >= 0) {
      const v = f[jg];
      if (q.periodo) { const d = aFecha(v); if (!d) continue; g = clavePeriodo(d, q.periodo); } else g = v == null ? "(vacío)" : String(v);
    }
    const e = grupos.get(g) ?? { xs: [], n: 0 };
    e.n++;
    if (jv >= 0 && typeof f[jv] === "number") e.xs.push(f[jv] as number);
    grupos.set(g, e);
  }
  let xs = [...grupos].map(([grupo, e]) => ({ grupo, valor: aplicarMetrica(e.xs, q.metrica, e.n), n: e.n }));
  xs.sort((a, b) => (q.orden === "grupo" || q.periodo ? a.grupo.localeCompare(b.grupo, "es", { numeric: true }) : q.orden === "valor_asc" ? a.valor - b.valor : b.valor - a.valor));
  xs = xs.slice(0, Math.min(200, q.limite ?? 200));
  const desc = `${q.metrica}${q.columna ? ` de ${q.columna}` : ""}${q.agrupar ? ` por ${q.agrupar}${q.periodo ? ` (${q.periodo})` : ""}` : ""}${q.filtros.length ? ` · filtros: ${q.filtros.map((f) => `${f.columna} ${f.op} ${f.valor}`).join(", ")}` : ""}`;
  return { grupos: xs, filas: t.filas.length, descripcion: desc };
}

// ---- Comparar períodos, anomalías y pronóstico ----

export function compararPeriodos(t: Tabla, colFecha: string, colValor: string | null, periodo: NonNullable<Consulta["periodo"]>, metrica: Consulta["metrica"] = "suma") {
  const r = consultar(t, { filtros: [], agrupar: colFecha, periodo, metrica: colValor ? metrica : "contar", columna: colValor, orden: "grupo", limite: null });
  const serie = r.grupos;
  const cambios = serie.map((g, i) => ({ ...g, cambio: i ? (serie[i - 1]!.valor ? Math.round(((g.valor - serie[i - 1]!.valor) / Math.abs(serie[i - 1]!.valor)) * 1000) / 10 : null) : null }));
  const ult = cambios.at(-1), ant = cambios.at(-2);
  return { serie: cambios, resumen: ult && ant ? `${ult.grupo}: ${ult.valor} contra ${ant.grupo}: ${ant.valor} (${ult.cambio == null ? "sin base" : `${ult.cambio > 0 ? "+" : ""}${ult.cambio}%`}).` : "Hace falta al menos dos períodos para comparar." };
}

/** Valores inusuales: fuera de 1,5 veces el rango intercuartílico (y su z-score). */
export function anomalias(t: Tabla, columna: string) {
  const j = indice(t, columna);
  const ns = numeros(t, j);
  if (ns.length < 8) return { limites: null, filas: [] as { fila: number; valor: number; z: number }[], nota: "Hacen falta al menos 8 valores para buscar anomalías." };
  const s = [...ns].sort((a, b) => a - b);
  const q = (p: number) => { const k = (s.length - 1) * p, i = Math.floor(k); return s[i]! + (s[Math.min(i + 1, s.length - 1)]! - s[i]!) * (k - i); };
  const q1 = q(0.25), q3 = q(0.75), iqr = q3 - q1, bajo = q1 - 1.5 * iqr, alto = q3 + 1.5 * iqr;
  const media = ns.reduce((a, b) => a + b, 0) / ns.length, desvio = Math.sqrt(ns.reduce((a, b) => a + (b - media) ** 2, 0) / Math.max(1, ns.length - 1)) || 1;
  const filas = t.filas.map((f, i) => ({ fila: i + 2, v: f[j] })).filter((x): x is { fila: number; v: number } => typeof x.v === "number" && (x.v < bajo || x.v > alto)).map((x) => ({ fila: x.fila, valor: x.v, z: redondo((x.v - media) / desvio) })).sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 100);
  return { limites: { bajo: redondo(bajo), alto: redondo(alto) }, filas, nota: filas.length ? `${filas.length} valor(es) fuera de [${redondo(bajo)}, ${redondo(alto)}].` : "No hay valores inusuales." };
}

/**
 * Pronóstico lineal sobre la serie por período, con intervalo de predicción al 95 %.
 * Es una tendencia: se marca como estimación y con su incertidumbre.
 */
export function pronosticar(t: Tabla, colFecha: string, colValor: string | null, periodo: NonNullable<Consulta["periodo"]>, pasos = 3) {
  const { serie } = compararPeriodos(t, colFecha, colValor, periodo);
  const n = serie.length;
  if (n < 4) return { serie, proximos: [], nota: "Hacen falta al menos 4 períodos para pronosticar." };
  const xs = serie.map((_, i) => i), ys = serie.map((g) => g.valor);
  const mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const b = xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0) / sxx, a0 = my - b * mx;
  const residuos = ys.map((y, i) => y - (a0 + b * i));
  const se = Math.sqrt(residuos.reduce((a, r) => a + r * r, 0) / Math.max(1, n - 2));
  const tcrit = [12.71, 4.3, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23][Math.min(9, n - 3)] ?? 2;
  const ss = ys.reduce((a, y) => a + (y - my) ** 2, 0);
  const r2 = ss ? redondo(1 - residuos.reduce((a, r) => a + r * r, 0) / ss) : 0;
  const proximos = Array.from({ length: Math.min(12, Math.max(1, pasos)) }, (_, k) => {
    const x = n + k, y = a0 + b * x, m = tcrit * se * Math.sqrt(1 + 1 / n + (x - mx) ** 2 / sxx);
    return { paso: k + 1, valor: redondo(y), bajo: redondo(y - m), alto: redondo(y + m) };
  });
  return { serie, proximos, tendencia: redondo(b), r2, nota: `Estimación lineal (R² ${r2}): ${b >= 0 ? "sube" : "baja"} ${Math.abs(redondo(b))} por ${periodo}. El intervalo es al 95 %; con pocos datos o cambios bruscos, tomalo con cuidado.` };
}

// ---- Transformaciones (generan un archivo nuevo; el original no se toca) ----

export const Transformacion = z.object({
  quitarVacias: z.boolean().default(true),
  quitarDuplicados: z.boolean().default(false),
  recortarEspacios: z.boolean().default(true),
  normalizarColumnas: z.boolean().default(false),
  columnas: z.array(z.string()).nullable().default(null),
  filtros: z.array(Filtro).default([]),
  unirCon: z.object({ ruta: z.string(), clave: z.string(), claveOtra: z.string().nullable().default(null) }).nullable().default(null),
});

const normalizarNombre = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "columna";

export function transformar(t0: Tabla, op: z.infer<typeof Transformacion>): Tabla {
  let t: Tabla = { columnas: [...t0.columnas], filas: t0.filas.map((f) => [...f]) };
  if (op.recortarEspacios) t.filas = t.filas.map((f) => f.map((v) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") || null : v)));
  if (op.quitarVacias) t.filas = t.filas.filter((f) => f.some((v) => v != null && v !== ""));
  t = filtrar(t, op.filtros);
  if (op.unirCon) {
    const otra = leerTabla(op.unirCon.ruta);
    const ja = indice(t, op.unirCon.clave), jb = indice(otra, op.unirCon.claveOtra ?? op.unirCon.clave);
    const mapa = new Map(otra.filas.map((f) => [String(f[jb]), f]));
    const extra = otra.columnas.map((c, i) => [c, i] as const).filter(([, i]) => i !== jb);
    t = { columnas: [...t.columnas, ...extra.map(([c]) => (t.columnas.includes(c) ? `${c}_2` : c))], filas: t.filas.map((f) => { const o = mapa.get(String(f[ja])); return [...f, ...extra.map(([, i]) => (o ? o[i] ?? null : null))]; }) };
  }
  if (op.columnas?.length) { const js = op.columnas.map((c) => indice(t, c)); t = { columnas: op.columnas, filas: t.filas.map((f) => js.map((j) => f[j] ?? null)) }; }
  if (op.quitarDuplicados) { const vistos = new Set<string>(); t.filas = t.filas.filter((f) => { const k = JSON.stringify(f); if (vistos.has(k)) return false; vistos.add(k); return true; }); }
  if (op.normalizarColumnas) t.columnas = nombresUnicos(t.columnas.map(normalizarNombre));
  return t;
}

const csvCampo = (v: Valor) => (v == null ? "" : typeof v === "number" ? String(v) : /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const aCsv = (t: Tabla) => [t.columnas.map(csvCampo).join(","), ...t.filas.map((f) => f.map(csvCampo).join(","))].join("\n") + "\n";

/** Guarda en la computadora (datos/…) sin pisar: si existe, agrega un número. Devuelve la ruta relativa. */
export function guardarEnComputadora(nombre: string, contenido: string): string {
  const dir = path.join(COMPUTADORA, "datos");
  mkdirSync(dir, { recursive: true });
  const base = nombre.replace(/[^\w.-]+/g, "_");
  const ext = path.extname(base), raiz = base.slice(0, base.length - ext.length);
  let rel = `datos/${base}`;
  for (let n = 2; existsSync(path.join(COMPUTADORA, rel)); n++) rel = `datos/${raiz}-${n}${ext}`;
  writeFileSync(path.join(COMPUTADORA, rel), contenido);
  return rel;
}

/** Informe en Markdown con perfil, la consulta, anomalías y pronóstico (lo que el usuario haya calculado). */
export function informe(ruta: string, t: Tabla, partes: { consulta?: Resultado; anomalias?: ReturnType<typeof anomalias> & { columna: string }; pronostico?: ReturnType<typeof pronosticar> }): string {
  const p = perfil(t);
  const lineas = [`# Informe de datos · ${path.basename(ruta)}`, "", `Archivo: \`${ruta}\` · ${t.filas.length} filas · ${t.columnas.length} columnas · generado ${new Date().toISOString().slice(0, 16).replace("T", " ")} por Gravity Data Lab.`, "", "## Columnas", "", "| Columna | Tipo | Vacíos | Distintos | Mín | Máx | Media | Mediana |", "|---|---|---|---|---|---|---|---|"];
  for (const c of p) lineas.push(`| ${c.nombre} | ${c.tipo} | ${c.vacios} | ${c.distintos} | ${c.min ?? ""} | ${c.max ?? ""} | ${c.media ?? ""} | ${c.mediana ?? ""} |`);
  if (partes.consulta) { lineas.push("", `## ${partes.consulta.descripcion}`, "", "| Grupo | Valor | Filas |", "|---|---|---|"); for (const g of partes.consulta.grupos) lineas.push(`| ${g.grupo} | ${g.valor} | ${g.n} |`); }
  if (partes.anomalias) { lineas.push("", `## Anomalías en ${partes.anomalias.columna}`, "", partes.anomalias.nota); for (const a of partes.anomalias.filas.slice(0, 30)) lineas.push(`- Fila ${a.fila}: ${a.valor} (z = ${a.z})`); }
  if (partes.pronostico?.proximos.length) { lineas.push("", "## Pronóstico (estimación)", "", partes.pronostico.nota ?? "", "", "| Paso | Valor | Intervalo 95 % |", "|---|---|---|"); for (const x of partes.pronostico.proximos) lineas.push(`| +${x.paso} | ${x.valor} | ${x.bajo} a ${x.alto} |`); }
  return lineas.join("\n") + "\n";
}
