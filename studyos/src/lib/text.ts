import { normalizeText } from './items';

// Utilidades de texto para documentos: limpieza, fragmentación con referencia a
// página, detección de fórmulas y palabras clave, y búsqueda léxica BM25 que
// funciona sin conexión ni API.

export const STOPWORDS = new Set(
  (
    'a al algo algunas algunos ante antes como con contra cual cuales cuando de del desde donde dos el ella ellas ellos en entre era eran es esa esas ese eso esos esta estaba estado estan estas este esto estos fue fueron ha hace hacia han hasta hay la las le les lo los mas me mi mientras muy nada ni no nos o otra otras otro otros para pero poco por porque que quien se sea segun ser si sido sin sobre son su sus tambien tanto te tiene tienen todo todos tu un una unas uno unos y ya the of and to in is are for on with as by be this that from or an at it its which can also'
  ).split(' '),
);

export function cleanText(s: string): string {
  return s
    .replace(/­/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/(\w)-\n(\w)/g, '$1$2') // palabras cortadas al final de línea
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function tokenize(s: string): string[] {
  return normalizeText(s)
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export interface PageText {
  page: number;
  text: string;
}

export interface ChunkDraft {
  page: number;
  order: number;
  heading?: string;
  text: string;
}

/** Divide cada página en fragmentos de ~maxChars respetando párrafos. */
export function chunkPages(pages: PageText[], maxChars = 1100, headingsByPage: Map<number, string> = new Map()): ChunkDraft[] {
  const out: ChunkDraft[] = [];
  let order = 0;
  let lastHeading: string | undefined;
  for (const p of pages) {
    if (headingsByPage.has(p.page)) lastHeading = headingsByPage.get(p.page);
    const paras = p.text.split(/\n{2,}|\n(?=[A-ZÁÉÍÓÚÑ0-9•\-–])/).map((x) => x.trim()).filter(Boolean);
    let buf = '';
    const flush = () => {
      if (buf.trim()) out.push({ page: p.page, order: order++, heading: lastHeading, text: buf.trim() });
      buf = '';
    };
    for (const para of paras) {
      if (para.length > maxChars) {
        flush();
        const sentences = para.split(/(?<=[.!?])\s+/);
        for (const s of sentences) {
          if ((buf + ' ' + s).length > maxChars) flush();
          buf += (buf ? ' ' : '') + s;
        }
        flush();
        continue;
      }
      if ((buf + '\n' + para).length > maxChars) flush();
      buf += (buf ? '\n' : '') + para;
    }
    flush();
  }
  return out;
}

const FORMULA_RE = /(?:[A-Za-zα-ωΑ-Ω]\s*[=≈≤≥<>]\s*[^\s].{0,60})|(?:[∑∫√π∆Δ±×÷^²³])|(?:\b(?:sin|cos|tan|log|ln)\s*\()|(?:\d+\s*[x×*/]\s*\d+\s*=)|(?:[A-Z][a-z]?\d*(?:\s*\+\s*[A-Z][a-z]?\d*)+\s*(?:→|->|⇌))/;

export function detectFormulas(text: string, page: number): { text: string; page: number }[] {
  const out: { text: string; page: number }[] = [];
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (l.length < 3 || l.length > 140) continue;
    const letters = (l.match(/[a-záéíóúñ]/gi) ?? []).length;
    const symbols = (l.match(/[=+\-*/^()√∑∫πΔ²³<>≤≥→]/g) ?? []).length;
    if (FORMULA_RE.test(l) && symbols >= 2 && symbols / Math.max(1, letters) > 0.08) out.push({ text: l, page });
  }
  return out.slice(0, 40);
}

/** Palabras clave por TF-IDF simple entre páginas. */
export function extractKeywords(pages: PageText[], k = 15): string[] {
  const df = new Map<string, number>();
  const tf = new Map<string, number>();
  for (const p of pages) {
    const toks = tokenize(p.text);
    const seen = new Set<string>();
    for (const t of toks) {
      if (/^\d+$/.test(t)) continue;
      tf.set(t, (tf.get(t) ?? 0) + 1);
      if (!seen.has(t)) {
        df.set(t, (df.get(t) ?? 0) + 1);
        seen.add(t);
      }
    }
  }
  const n = Math.max(1, pages.length);
  const scored = [...tf.entries()]
    .filter(([w, c]) => c >= 2 && w.length > 3)
    .map(([w, c]) => [w, c * Math.log(1 + n / (df.get(w) ?? 1))] as const)
    .sort((a, b) => b[1] - a[1]);
  return scored.slice(0, k).map(([w]) => w);
}

// --- BM25 -----------------------------------------------------------------

export interface Bm25Doc {
  id: string;
  text: string;
}

export class Bm25 {
  private docs: { id: string; tf: Map<string, number>; len: number }[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;
  constructor(docs: Bm25Doc[], private k1 = 1.4, private b = 0.75) {
    for (const d of docs) {
      const toks = tokenize(d.text);
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ id: d.id, tf, len: toks.length });
    }
    this.avgLen = this.docs.reduce((s, d) => s + d.len, 0) / Math.max(1, this.docs.length);
  }
  search(query: string, k = 8): { id: string; score: number }[] {
    const q = [...new Set(tokenize(query))];
    const N = this.docs.length;
    const res: { id: string; score: number }[] = [];
    for (const d of this.docs) {
      let s = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        s += idf * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.len) / (this.avgLen || 1))));
      }
      if (s > 0) res.push({ id: d.id, score: s });
    }
    return res.sort((a, b) => b.score - a.score).slice(0, k);
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** Selecciona fragmentos repartidos a lo largo del documento hasta llenar el presupuesto. */
export function spreadSelect<T extends { text: string }>(items: T[], budgetChars: number): T[] {
  const total = items.reduce((s, c) => s + c.text.length, 0);
  if (total <= budgetChars) return items;
  const ratio = budgetChars / total;
  const out: T[] = [];
  let acc = 0;
  let used = 0;
  for (const it of items) {
    acc += it.text.length * ratio;
    if (acc >= used + it.text.length * 0.5 && used + it.text.length <= budgetChars) {
      out.push(it);
      used += it.text.length;
    }
  }
  return out;
}

/** Extrae los números de página citados con el formato [p. N] o [p. N-M]. */
export function extractCitations(text: string): number[] {
  const out: number[] = [];
  const re = /\[(?:p|pág|diap|sec)\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(Number(m[1]));
    if (m[2]) out.push(Number(m[2]));
  }
  return out;
}

/** Marca como inválidas las citas a páginas inexistentes en el documento. */
export function validateCitations(text: string, pageCount: number): { text: string; invalid: number[] } {
  const invalid: number[] = [];
  const out = text.replace(/\[(p|pág|diap|sec)\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?\]/gi, (full, _k, a, b) => {
    const pa = Number(a);
    const pb = b ? Number(b) : pa;
    if (pa < 1 || pb > pageCount || pa > pb) {
      invalid.push(pa);
      return '[cita no verificada]';
    }
    return full;
  });
  return { text: out, invalid };
}
