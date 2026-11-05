// Texto de documentos de la computadora: PDF, Word (.docx), OpenDocument (.odt), PowerPoint (.pptx) y
// texto plano. Sin dependencias: los .docx/.odt/.pptx son zip con XML; del PDF se leen los flujos de texto
// (con FlateDecode) y los operadores Tj/TJ. Los PDF escaneados (imágenes) no tienen texto: se avisa.
// Los documentos largos se dividen en partes numeradas para leerlas por tramos y buscar adentro.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { inflateRawSync, inflateSync } from "node:zlib";
import { COMPUTADORA } from "./almacen.ts";

export const EXT_DOCUMENTOS = /\.(pdf|docx|odt|pptx|txt|md|csv|json|html?|xml|rtf)$/i;
const PARTE = 8000;
const cache = new Map<string, { mtime: number; texto: string }>();

function entradasZip(buf: Buffer, filtro: RegExp): Map<string, Buffer> {
  const salida = new Map<string, Buffer>();
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error("El archivo no es un documento válido (zip dañado).");
  const n = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10), comp = buf.readUInt32LE(p + 20), ln = buf.readUInt16LE(p + 28), le = buf.readUInt16LE(p + 30), lc = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const nombre = buf.subarray(p + 46, p + 46 + ln).toString("utf8");
    p += 46 + ln + le + lc;
    if (!filtro.test(nombre)) continue;
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const cuerpo = buf.subarray(ini, ini + comp);
    salida.set(nombre, metodo === 8 ? inflateRawSync(cuerpo, { maxOutputLength: 100 * 1024 * 1024 }) : cuerpo);
  }
  return salida;
}
const desescapar = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
const xmlATexto = (xml: string, parrafo: RegExp) => desescapar(xml.replace(parrafo, "\n").replace(/<w:tab\/>|<text:tab\/>/g, "\t").replace(/<[^>]+>/g, "")).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/** Texto de un PDF: flujos (FlateDecode o sin comprimir) y cadenas de los operadores de texto. */
export function textoPdf(buf: Buffer): string {
  const bin = buf.toString("latin1");
  const partes: string[] = [];
  const re = /<<([\s\S]*?)>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bin))) {
    const ini = m.index + m[0].length;
    const fin = bin.indexOf("endstream", ini);
    if (fin < 0) break;
    const dic = m[1]!;
    if (/\/Subtype\s*\/Image|\/Type\s*\/XObject/.test(dic) && !/\/Subtype\s*\/Form/.test(dic)) { re.lastIndex = fin; continue; }
    let datos = buf.subarray(ini, fin);
    if (/\/FlateDecode/.test(dic)) { try { datos = inflateSync(datos); } catch { try { datos = inflateSync(datos.subarray(0, datos.length - 2)); } catch { re.lastIndex = fin; continue; } } }
    else if (/\/Filter/.test(dic)) { re.lastIndex = fin; continue; }
    const s = datos.toString("latin1");
    if (!/T[Jj]|'/.test(s)) { re.lastIndex = fin; continue; }
    let linea = "";
    for (const op of s.matchAll(/\[((?:\([^)\\]*(?:\\.[^)\\]*)*\)|[^\]])*)\]\s*TJ|\(((?:[^)\\]|\\.)*)\)\s*(?:Tj|'|")|(T\*|Td|TD|Tm|ET)/g)) {
      if (op[3]) { if (op[3] !== "Tm" || linea.length > 0) { partes.push(linea); linea = ""; } continue; }
      const cadenas = op[1] !== undefined ? [...op[1].matchAll(/\(((?:[^)\\]|\\.)*)\)|(-?\d+(?:\.\d+)?)/g)].map((x) => (x[1] !== undefined ? x[1] : Number(x[2]) < -200 ? "\u0001" : "")) : [op[2]!];
      linea += cadenas.join("").replace(/\u0001/g, " ").replace(/\\([nrtbf()\\]|\d{1,3})/g, (_, e: string) => ({ n: "\n", r: "", t: "\t", b: "", f: "", "(": "(", ")": ")", "\\": "\\" }[e] ?? String.fromCharCode(parseInt(e, 8))));
    }
    if (linea) partes.push(linea);
    re.lastIndex = fin;
  }
  return partes.map((x) => x.replace(/[ \t]{2,}/g, " ").trim()).filter(Boolean).join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Texto de un documento de la computadora (con caché por fecha de modificación). */
export function textoDeDocumento(ruta: string): string {
  const abs = path.resolve(COMPUTADORA, ruta);
  if (abs !== COMPUTADORA && !abs.startsWith(COMPUTADORA + path.sep)) throw new Error("El archivo tiene que estar en la computadora.");
  const info = statSync(abs);
  if (info.size > 60 * 1024 * 1024) throw new Error("El documento pasa los 60 MB.");
  const c = cache.get(abs);
  if (c && c.mtime === info.mtimeMs) return c.texto;
  const ext = path.extname(abs).toLowerCase();
  const buf = readFileSync(abs);
  let texto: string;
  if (ext === ".pdf") texto = textoPdf(buf);
  else if (ext === ".docx") texto = xmlATexto(entradasZip(buf, /^word\/document\.xml$/).get("word/document.xml")?.toString("utf8") ?? "", /<\/w:p>/g);
  else if (ext === ".odt") texto = xmlATexto(entradasZip(buf, /^content\.xml$/).get("content.xml")?.toString("utf8") ?? "", /<\/text:p>|<\/text:h>/g);
  else if (ext === ".pptx") {
    const diapos = [...entradasZip(buf, /^ppt\/slides\/slide\d+\.xml$/)].sort((a, b) => Number(/(\d+)\.xml$/.exec(a[0])![1]) - Number(/(\d+)\.xml$/.exec(b[0])![1]));
    texto = diapos.map(([, x], i) => `--- Diapositiva ${i + 1} ---\n${xmlATexto(x.toString("utf8"), /<\/a:p>/g)}`).join("\n\n");
  } else if (/\.html?$/.test(ext)) texto = buf.toString("utf8").replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  else texto = buf.toString("utf8");
  cache.set(abs, { mtime: info.mtimeMs, texto });
  if (cache.size > 60) cache.delete(cache.keys().next().value!);
  return texto;
}

export const cantidadPartes = (texto: string) => Math.max(1, Math.ceil(texto.length / PARTE));
export const parte = (texto: string, n: number) => texto.slice((n - 1) * PARTE, n * PARTE);

/** Busca en las partes de un documento y devuelve las que coinciden, con un extracto. */
export function buscarEnDocumento(texto: string, consulta: string, max = 8): { parte: number; extracto: string; coincidencias: number }[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const terminos = norm(consulta).split(/\s+/).filter((w) => w.length > 2);
  if (!terminos.length) return [];
  const salida: { parte: number; extracto: string; coincidencias: number }[] = [];
  for (let n = 1; n <= cantidadPartes(texto); n++) {
    const p = parte(texto, n), pn = norm(p);
    const c = terminos.reduce((a, t) => a + (pn.split(t).length - 1), 0);
    if (!c || !terminos.every((t) => pn.includes(t))) continue;
    const i = Math.max(0, pn.indexOf(terminos[0]!) - 120);
    salida.push({ parte: n, coincidencias: c, extracto: p.slice(i, i + 360).replace(/\s+/g, " ").trim() });
  }
  return salida.sort((a, b) => b.coincidencias - a.coincidencias).slice(0, max);
}
