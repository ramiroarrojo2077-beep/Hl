// Buscador global: compañeros, conversaciones, proyectos y tareas, reuniones, memoria de los
// compañeros y archivos de la computadora. Búsqueda de texto local (todas las palabras deben estar).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { COMPUTADORA, conversacion, listarBots, listarReuniones, raizMemoria } from "./almacen.ts";
import { listarProyectos } from "./proyectos.ts";
import { textoDeDocumento } from "./documentos.ts";

export interface Resultado {
  tipo: "compañero" | "conversación" | "proyecto" | "tarea" | "reunión" | "memoria" | "archivo";
  titulo: string;
  extracto: string;
  enlace: string;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function textoDe(contenido: unknown): string {
  if (typeof contenido === "string") return contenido;
  if (!Array.isArray(contenido)) return "";
  return contenido.map((b: { type?: string; text?: string }) => (b?.type === "text" ? (b.text ?? "") : "")).join(" ");
}

function extracto(texto: string, terminos: string[]): string {
  const n = norm(texto);
  const i = Math.max(0, n.indexOf(terminos[0]!));
  const desde = Math.max(0, i - 60);
  return `${desde ? "…" : ""}${texto.slice(desde, desde + 180).replace(/\s+/g, " ").trim()}${desde + 180 < texto.length ? "…" : ""}`;
}

function archivos(dir: string, max = 800): string[] {
  if (!existsSync(dir)) return [];
  const salida: string[] = [];
  const pila = [dir];
  while (pila.length && salida.length < max) {
    const actual = pila.pop()!;
    for (const e of readdirSync(actual, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const abs = path.join(actual, e.name);
      if (e.isDirectory()) pila.push(abs);
      else if (e.isFile()) salida.push(abs);
    }
  }
  return salida;
}

const ES_TEXTO = /\.(md|txt|csv|json|html?|ya?ml|log|tsv|js|ts|py|css)$/i;

export function buscarTodo(consulta: string, limite = 60): Resultado[] {
  const terminos = norm(consulta).split(/\s+/).filter((t) => t.length > 1);
  if (!terminos.length) return [];
  const coincide = (t: string) => { const n = norm(t); return terminos.every((x) => n.includes(x)); };
  const r: Resultado[] = [];
  const bots = listarBots();

  for (const b of bots) {
    const t = `${b.nombre} ${b.titulo} ${b.descripcion}`;
    if (coincide(t)) r.push({ tipo: "compañero", titulo: `${b.nombre} · ${b.titulo}`, extracto: b.descripcion.slice(0, 180), enlace: `#/chats/${b.id}` });
  }
  for (const p of listarProyectos()) {
    if (coincide(`${p.nombre} ${p.objetivo}`)) r.push({ tipo: "proyecto", titulo: p.nombre, extracto: p.objetivo.slice(0, 180), enlace: `#/proyectos/${p.id}` });
    for (const t of p.tareas) {
      const texto = `${t.titulo} ${t.detalle} ${t.criterio} ${t.resultado ?? ""}`;
      if (coincide(texto)) r.push({ tipo: "tarea", titulo: `${t.titulo} · ${p.nombre}`, extracto: extracto(texto, terminos), enlace: `#/proyectos/${p.id}` });
    }
  }
  for (const reu of listarReuniones().slice(0, 200)) {
    const texto = `${reu.titulo} ${reu.agenda} ${reu.acta?.resumen ?? ""} ${(reu.acta?.decisiones ?? []).join(" ")}`;
    if (coincide(texto)) r.push({ tipo: "reunión", titulo: reu.titulo, extracto: extracto(texto, terminos), enlace: `#/reuniones/${reu.id}` });
  }
  for (const b of bots) {
    const ms = conversacion(b.id).mensajes;
    let n = 0;
    for (let i = ms.length - 1; i >= 0 && n < 3; i--) {
      const m = ms[i]!;
      if (m.role !== "user" && m.role !== "assistant") continue;
      const texto = textoDe(m.content);
      if (!texto || texto.startsWith("<") || !coincide(texto)) continue;
      r.push({ tipo: "conversación", titulo: `${m.role === "user" ? "Vos" : b.nombre} en el chat con ${b.nombre}`, extracto: extracto(texto, terminos), enlace: `#/chats/${b.id}` });
      n++;
    }
    for (const a of archivos(raizMemoria(b.id), 200)) {
      if (!ES_TEXTO.test(a) || statSync(a).size > 500_000) continue;
      const texto = readFileSync(a, "utf8");
      if (coincide(`${path.basename(a)} ${texto}`)) r.push({ tipo: "memoria", titulo: `${b.nombre}: ${path.relative(raizMemoria(b.id), a)}`, extracto: extracto(texto, terminos), enlace: `#/chats/${b.id}/memoria` });
    }
  }
  for (const a of archivos(COMPUTADORA)) {
    const rel = path.relative(COMPUTADORA, a);
    let texto = "";
    if (ES_TEXTO.test(a) && statSync(a).size <= 500_000) texto = readFileSync(a, "utf8");
    // PDF, Word, OpenDocument y PowerPoint: se busca dentro de su texto.
    else if (/\.(pdf|docx|odt|pptx)$/i.test(a)) { try { texto = textoDeDocumento(rel); } catch { texto = ""; } }
    if (coincide(`${rel} ${texto}`)) r.push({ tipo: "archivo", titulo: rel, extracto: texto ? extracto(texto, terminos) : "", enlace: `#/computadora` });
    if (r.length >= limite * 2) break;
  }
  return r.slice(0, limite);
}
