// Búsqueda en lo que un compañero ya sabe: su memoria, sus conversaciones pasadas y la carpeta de su
// equipo. Búsqueda de texto local (BM25 sobre fragmentos), sin servicios de afuera. Cada compañero solo
// ve lo suyo y lo de su equipo: la memoria de otro compañero no aparece.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { COMPUTADORA, DATOS, buscarBot, conversacion, programarEscritura, raizMemoria } from "./almacen.ts";
import { CLAVE_GEMINI, GEMINI_BASE, hayGemini } from "./proveedores.ts";
import { listarProyectos } from "./proyectos.ts";

export type Alcance = "memoria" | "conversaciones" | "equipo" | "todo";

interface Fragmento {
  fuente: "memoria" | "conversación" | "equipo";
  donde: string;
  texto: string;
}

export interface Hallazgo extends Fragmento {
  puntaje: number;
}

const VACIAS = new Set(
  "a al algo algun alguna ante antes como con contra cual cuando de del desde donde durante e el ella ellas ellos en entre era es esa ese eso esta este esto fue ha hay la las le les lo los mas me mi mis muy ni no nos o otra otro para pero por porque que se si sin sobre su sus te tu tus un una uno y ya yo the of and to in is it".split(" "),
);

export function palabras(texto: string): string[] {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9ñ]+/)
    .filter((p) => p.length > 1 && !VACIAS.has(p));
}

/** Corta un texto largo en fragmentos de ~600 caracteres respetando párrafos. */
function trozos(texto: string, max = 600): string[] {
  const salida: string[] = [];
  let actual = "";
  for (const parrafo of texto.split(/\n\s*\n/)) {
    if (actual && actual.length + parrafo.length > max) {
      salida.push(actual);
      actual = "";
    }
    if (parrafo.length > max) {
      for (let i = 0; i < parrafo.length; i += max) salida.push(parrafo.slice(i, i + max));
    } else actual = actual ? `${actual}\n\n${parrafo}` : parrafo;
  }
  if (actual.trim()) salida.push(actual);
  return salida;
}

const ES_TEXTO = /\.(md|txt|csv|json|html?|ya?ml|log|tsv)$/i;

function archivosDe(dir: string, base: string, max = 400): { rel: string; abs: string }[] {
  if (!existsSync(dir)) return [];
  const salida: { rel: string; abs: string }[] = [];
  const pila = [dir];
  while (pila.length && salida.length < max) {
    const actual = pila.pop()!;
    for (const e of readdirSync(actual, { withFileTypes: true })) {
      const abs = path.join(actual, e.name);
      if (e.isDirectory()) pila.push(abs);
      else if (e.isFile() && ES_TEXTO.test(e.name) && statSync(abs).size <= 1_000_000) salida.push({ rel: path.join(base, path.relative(dir, abs)), abs });
    }
  }
  return salida;
}

function textoDeContenido(contenido: unknown): string {
  if (typeof contenido === "string") return contenido;
  if (!Array.isArray(contenido)) return "";
  return contenido
    .map((b: { type?: string; text?: string }) => (b?.type === "text" ? (b.text ?? "") : ""))
    .filter(Boolean)
    .join("\n");
}

/** Carpetas de equipo que ve un compañero: la suya (si es manager) y la de su manager. */
function carpetasDeEquipo(botId: string): string[] {
  const bot = buscarBot(botId);
  if (!bot) return [];
  const carpetas = new Set<string>();
  if (bot.carpetaEquipo) carpetas.add(bot.carpetaEquipo);
  const jefe = bot.reportaA ? buscarBot(bot.reportaA) : undefined;
  if (jefe?.carpetaEquipo) carpetas.add(jefe.carpetaEquipo);
  // Memoria de proyecto: la carpeta de cada proyecto donde coordina o tiene tareas (no la de otros).
  for (const p of proyectosDe(botId)) carpetas.add(p.carpeta);
  return [...carpetas];
}

function proyectosDe(botId: string): { carpeta: string }[] {
  try {
    return listarProyectos().filter((p) => p.coordinadorId === botId || p.tareas.some((t) => t.asignadoA === botId));
  } catch {
    return [];
  }
}

function fragmentosDe(botId: string, alcance: Alcance): Fragmento[] {
  const salida: Fragmento[] = [];
  if (alcance === "memoria" || alcance === "todo") {
    for (const a of archivosDe(raizMemoria(botId), "/memories")) {
      for (const t of trozos(readFileSync(a.abs, "utf8"))) salida.push({ fuente: "memoria", donde: a.rel, texto: t });
    }
  }
  if (alcance === "conversaciones" || alcance === "todo") {
    const c = conversacion(botId);
    c.mensajes.forEach((m, i) => {
      if (m.role !== "user" && m.role !== "assistant") return;
      const texto = textoDeContenido(m.content).trim();
      // Se saltean los resultados de herramientas y los avisos internos largos.
      if (!texto || texto.startsWith("<")) return;
      for (const t of trozos(texto)) salida.push({ fuente: "conversación", donde: `${m.role === "user" ? "usuario" : "vos"} · mensaje ${i + 1}`, texto: t });
    });
  }
  if (alcance === "equipo" || alcance === "todo") {
    for (const carpeta of carpetasDeEquipo(botId)) {
      for (const a of archivosDe(path.join(COMPUTADORA, carpeta), carpeta)) {
        for (const t of trozos(readFileSync(a.abs, "utf8"))) salida.push({ fuente: "equipo", donde: a.rel, texto: t });
      }
    }
  }
  return salida;
}

/** BM25 sobre los fragmentos del compañero. Devuelve los mejores, con su puntaje. */
export function buscar(botId: string, consulta: string, alcance: Alcance = "todo", limite = 8): Hallazgo[] {
  const terminos = [...new Set(palabras(consulta))];
  if (!terminos.length) return [];
  const docs = fragmentosDe(botId, alcance).map((f) => ({ f, ps: palabras(f.texto) }));
  if (!docs.length) return [];
  const promedio = docs.reduce((n, d) => n + d.ps.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const t of terminos) df.set(t, docs.filter((d) => d.ps.includes(t)).length);
  const k1 = 1.2;
  const b = 0.75;
  const hallazgos: Hallazgo[] = [];
  for (const d of docs) {
    let puntaje = 0;
    for (const t of terminos) {
      const n = df.get(t) ?? 0;
      if (!n) continue;
      const tf = d.ps.filter((p) => p === t || (t.length > 4 && p.startsWith(t.slice(0, -1)))).length;
      if (!tf) continue;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      puntaje += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.ps.length) / promedio));
    }
    if (puntaje > 0) hallazgos.push({ ...d.f, puntaje: Math.round(puntaje * 100) / 100 });
  }
  // Sin repetir el mismo fragmento (memoria copiada en varias partes).
  const vistos = new Set<string>();
  return hallazgos
    .sort((x, y) => y.puntaje - x.puntaje)
    .filter((h) => {
      const clave = h.texto.slice(0, 120);
      if (vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    })
    .slice(0, limite);
}

// ---- Búsqueda semántica (con la clave de Gemini): encuentra lo que dice lo mismo con otras palabras ----
// Los vectores de cada fragmento se guardan por hash en DATOS/embeddings.json (256 dimensiones), así
// solo se piden a Google los fragmentos nuevos. Si algo falla, queda la búsqueda por palabras.

const MODELO_EMB = process.env.GRAVITY_EMBEDDINGS ?? "gemini-embedding-001";
const DIM = 256;
const ARCHIVO_EMB = path.join(DATOS, "embeddings.json");
let cacheEmb: Record<string, number[]> | null = null;
const hashDe = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 24);

function cache(): Record<string, number[]> {
  if (!cacheEmb) {
    try {
      cacheEmb = JSON.parse(readFileSync(ARCHIVO_EMB, "utf8")) as Record<string, number[]>;
    } catch {
      cacheEmb = {};
    }
  }
  return cacheEmb;
}

async function embeber(textos: string[], tarea: "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT"): Promise<number[][]> {
  const c = cache();
  const faltan = [...new Set(textos.filter((t) => !c[`${tarea[10]}:${hashDe(t)}`]))];
  for (let i = 0; i < faltan.length; i += 100) {
    const lote = faltan.slice(i, i + 100);
    const r = await fetch(`${GEMINI_BASE}/models/${MODELO_EMB}:batchEmbedContents`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": CLAVE_GEMINI },
      body: JSON.stringify({ requests: lote.map((t) => ({ model: `models/${MODELO_EMB}`, content: { parts: [{ text: t.slice(0, 2000) }] }, taskType: tarea, outputDimensionality: DIM })) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`embeddings ${r.status}`);
    const d = (await r.json()) as { embeddings?: { values: number[] }[] };
    lote.forEach((t, j) => {
      const v = d.embeddings?.[j]?.values;
      if (v?.length) c[`${tarea[10]}:${hashDe(t)}`] = v.map((x) => Math.round(x * 1e4) / 1e4);
    });
  }
  // Tope de 20 000 vectores: si se pasa, se descartan los más viejos.
  const claves = Object.keys(c);
  if (claves.length > 20_000) for (const k of claves.slice(0, claves.length - 20_000)) delete c[k];
  programarEscritura(ARCHIVO_EMB, () => c);
  return textos.map((t) => c[`${tarea[10]}:${hashDe(t)}`] ?? []);
}

function coseno(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let p = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    p += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? p / Math.sqrt(na * nb) : 0;
}

/** Búsqueda combinada: significado (embeddings) + palabras (BM25). Sin Gemini o si falla, solo palabras. */
export async function buscarSemantico(botId: string, consulta: string, alcance: Alcance = "todo", limite = 8): Promise<Hallazgo[]> {
  if (!hayGemini || !consulta.trim()) return buscar(botId, consulta, alcance, limite);
  try {
    const frags = fragmentosDe(botId, alcance).slice(-600);
    if (!frags.length) return [];
    const [q] = await embeber([consulta], "RETRIEVAL_QUERY");
    const vs = await embeber(frags.map((f) => f.texto), "RETRIEVAL_DOCUMENT");
    const porPalabras = new Map(buscar(botId, consulta, alcance, 60).map((h) => [h.texto, h.puntaje]));
    const maxBm = Math.max(1, ...porPalabras.values());
    const vistos = new Set<string>();
    return frags
      .map((f, i) => ({ ...f, puntaje: Math.round((0.7 * coseno(q!, vs[i]!) + 0.3 * ((porPalabras.get(f.texto) ?? 0) / maxBm)) * 100) / 100 }))
      .filter((h) => h.puntaje >= 0.45)
      .sort((x, y) => y.puntaje - x.puntaje)
      .filter((h) => {
        const k = h.texto.slice(0, 120);
        if (vistos.has(k)) return false;
        vistos.add(k);
        return true;
      })
      .slice(0, limite);
  } catch (err) {
    console.warn("Búsqueda semántica:", (err as Error).message);
    return buscar(botId, consulta, alcance, limite);
  }
}

export function formatear(hallazgos: Hallazgo[], consulta: string): string {
  if (!hallazgos.length) return `No encontré nada sobre «${consulta}» en tu memoria, tus conversaciones ni los archivos de tu equipo.`;
  return [
    `Encontré ${hallazgos.length} fragmento(s) sobre «${consulta}». Puede estar desactualizado: verificalo antes de usarlo como un hecho.`,
    ...hallazgos.map((h, i) => `\n[${i + 1}] ${h.fuente} · ${h.donde}\n${h.texto.trim()}`),
  ].join("\n");
}
