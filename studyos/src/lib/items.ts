import { z } from 'zod';
import { newId } from './ids';

// Modelo unificado de preguntas/ejercicios. Lo usan los exámenes y SmartTasks.
// La IA devuelve JSON que se valida con zod y luego se normaliza con
// normalizeItem(), que descarta ítems incoherentes en lugar de inventar datos.

export const ITEM_TYPES = ['mcq', 'tf', 'short', 'numeric', 'fill', 'match', 'order', 'essay', 'problem'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  mcq: 'Opción múltiple',
  tf: 'Verdadero o falso',
  short: 'Respuesta corta',
  numeric: 'Respuesta numérica',
  fill: 'Completar espacios',
  match: 'Relacionar conceptos',
  order: 'Ordenar secuencia',
  essay: 'Desarrollo',
  problem: 'Resolución de problemas',
};

export const LAB_SIMS = ['projectile', 'pendulum', 'molecules', 'separation', 'cell', 'solar', 'surface', 'solids'] as const;
export type LabSimId = (typeof LAB_SIMS)[number];

export interface Criterion {
  id: string;
  description: string;
  points: number;
}

export type Media =
  | { kind: 'chart'; expression: string; xMin: number; xMax: number; title?: string }
  | { kind: 'table'; headers: string[]; rows: string[][]; title?: string }
  | { kind: 'diagram'; nodes: string[]; edges: { from: string; to: string; label?: string }[]; title?: string }
  | { kind: 'lab'; simId: LabSimId; params?: Record<string, number>; instructions: string };

export interface Item {
  id: string;
  type: ItemType;
  prompt: string;
  concept: string;
  difficulty: number;
  points: number;
  hints: string[];
  solutionSteps: string[];
  explanation: string;
  sourcePage?: number;
  media?: Media;
  rubric?: Criterion[];
  // Claves de corrección (no se muestran antes de responder)
  options?: string[];
  correctIndex?: number;
  correctBool?: boolean;
  acceptedAnswers?: string[];
  correctNumber?: number;
  tolerance?: number;
  unit?: string;
  blanks?: string[][];
  pairs?: { left: string; right: string }[];
  sequence?: string[];
  finalAnswer?: string;
}

const num = z.union([z.number(), z.string()]).transform((v) => (typeof v === 'number' ? v : Number(String(v).replace(',', '.'))));
const str = z.union([z.string(), z.number(), z.boolean()]).transform((v) => String(v));
const strArr = z.array(str).catch([]);

export const mediaSchema = z
  .object({
    kind: z.enum(['chart', 'table', 'diagram', 'lab']),
    expression: str.optional(),
    xMin: num.optional(),
    xMax: num.optional(),
    title: str.optional(),
    headers: strArr.optional(),
    rows: z.array(strArr).optional(),
    nodes: strArr.optional(),
    edges: z.array(z.object({ from: str, to: str, label: str.optional() })).optional(),
    simId: str.optional(),
    params: z.record(z.string(), num).optional(),
    instructions: str.optional(),
  })
  .partial()
  .passthrough();

export const rawItemSchema = z
  .object({
    type: z.string(),
    prompt: str,
    concept: str.optional(),
    difficulty: num.optional(),
    points: num.optional(),
    hints: strArr.optional(),
    solutionSteps: strArr.optional(),
    explanation: str.optional(),
    sourcePage: num.optional().nullable(),
    media: mediaSchema.optional().nullable(),
    rubric: z.array(z.object({ description: str, points: num })).optional().nullable(),
    options: strArr.optional().nullable(),
    correctIndex: num.optional().nullable(),
    correctBool: z.union([z.boolean(), z.string()]).optional().nullable(),
    acceptedAnswers: strArr.optional().nullable(),
    correctNumber: num.optional().nullable(),
    tolerance: num.optional().nullable(),
    unit: str.optional().nullable(),
    blanks: z.array(z.union([strArr, str])).optional().nullable(),
    pairs: z.array(z.object({ left: str, right: str })).optional().nullable(),
    sequence: strArr.optional().nullable(),
    finalAnswer: str.optional().nullable(),
  })
  .passthrough();

export type RawItem = z.infer<typeof rawItemSchema>;

const TYPE_ALIASES: Record<string, ItemType> = {
  multiple_choice: 'mcq', multiplechoice: 'mcq', choice: 'mcq', opcion_multiple: 'mcq',
  true_false: 'tf', truefalse: 'tf', boolean: 'tf', verdadero_falso: 'tf',
  short_answer: 'short', corta: 'short', text: 'short',
  number: 'numeric', numerica: 'numeric',
  fill_blank: 'fill', fill_in_the_blank: 'fill', cloze: 'fill', completar: 'fill',
  matching: 'match', relacionar: 'match',
  ordering: 'order', sequence: 'order', ordenar: 'order',
  long: 'essay', desarrollo: 'essay', open: 'essay',
  procedure: 'problem', steps: 'problem', problema: 'problem',
};

function clampInt(v: unknown, min: number, max: number, def: number) {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : def;
  return Math.min(max, Math.max(min, n));
}

export function countBlanks(text: string) {
  return (text.match(/_{3,}/g) ?? []).length;
}

/** Convierte un ítem crudo de la IA en un Item válido o devuelve el motivo del rechazo. */
export function normalizeItem(raw: RawItem): { item?: Item; error?: string } {
  const t = raw.type.toLowerCase().trim().replace(/[\s-]+/g, '_');
  const type: ItemType | undefined = (ITEM_TYPES as readonly string[]).includes(t) ? (t as ItemType) : TYPE_ALIASES[t];
  if (!type) return { error: `tipo desconocido "${raw.type}"` };
  const prompt = raw.prompt.trim();
  if (prompt.length < 3) return { error: 'consigna vacía' };

  const base: Item = {
    id: newId(),
    type,
    prompt,
    concept: (raw.concept ?? '').trim() || 'General',
    difficulty: clampInt(raw.difficulty, 1, 5, 3),
    points: clampInt(raw.points, 1, 20, type === 'essay' || type === 'problem' ? 3 : 1),
    hints: (raw.hints ?? []).map((h) => h.trim()).filter(Boolean).slice(0, 4),
    solutionSteps: (raw.solutionSteps ?? []).map((h) => h.trim()).filter(Boolean),
    explanation: (raw.explanation ?? '').trim(),
  };
  if (raw.sourcePage != null && Number.isFinite(raw.sourcePage) && raw.sourcePage > 0) base.sourcePage = Math.round(raw.sourcePage);
  const media = normalizeMedia(raw.media);
  if (media) base.media = media;
  if (raw.rubric?.length) {
    base.rubric = raw.rubric
      .filter((c) => c.description.trim())
      .map((c) => ({ id: newId(), description: c.description.trim(), points: Math.max(0.5, Math.min(10, Number.isFinite(c.points) ? c.points : 1)) }));
  }

  switch (type) {
    case 'mcq': {
      const options = (raw.options ?? []).map((o) => o.trim()).filter(Boolean);
      if (options.length < 2) return { error: 'opción múltiple con menos de 2 opciones' };
      if (new Set(options.map(normalizeText)).size !== options.length) return { error: 'opciones repetidas' };
      const ci = raw.correctIndex;
      if (ci == null || !Number.isInteger(ci) || ci < 0 || ci >= options.length) return { error: 'índice correcto inválido' };
      return { item: { ...base, options, correctIndex: ci } };
    }
    case 'tf': {
      const v = raw.correctBool;
      const b = typeof v === 'boolean' ? v : typeof v === 'string' ? /^(true|verdadero|v|si|sí)$/i.test(v.trim()) ? true : /^(false|falso|f|no)$/i.test(v.trim()) ? false : undefined : undefined;
      if (b === undefined) return { error: 'verdadero/falso sin respuesta' };
      return { item: { ...base, correctBool: b } };
    }
    case 'short': {
      const acc = (raw.acceptedAnswers ?? []).map((a) => a.trim()).filter(Boolean);
      if (!acc.length && !base.rubric?.length) return { error: 'respuesta corta sin respuestas aceptadas ni criterios' };
      return { item: { ...base, acceptedAnswers: acc } };
    }
    case 'numeric': {
      const n = raw.correctNumber;
      if (n == null || !Number.isFinite(n)) return { error: 'numérica sin valor correcto' };
      const tol = raw.tolerance != null && Number.isFinite(raw.tolerance) && raw.tolerance >= 0 ? raw.tolerance : Math.max(Math.abs(n) * 0.001, 1e-9);
      return { item: { ...base, correctNumber: n, tolerance: tol, unit: raw.unit?.trim() || undefined } };
    }
    case 'fill': {
      const blanks = (raw.blanks ?? []).map((b) => (Array.isArray(b) ? b : [b]).map((s) => s.trim()).filter(Boolean)).filter((b) => b.length);
      const count = countBlanks(prompt);
      if (!count) return { error: 'completar sin espacios ___' };
      if (blanks.length !== count) return { error: `completar: ${count} espacios y ${blanks.length} respuestas` };
      return { item: { ...base, blanks } };
    }
    case 'match': {
      const pairs = (raw.pairs ?? []).filter((p) => p.left.trim() && p.right.trim());
      if (pairs.length < 2) return { error: 'relacionar con menos de 2 pares' };
      if (new Set(pairs.map((p) => normalizeText(p.right))).size !== pairs.length) return { error: 'relacionar con respuestas repetidas' };
      return { item: { ...base, pairs } };
    }
    case 'order': {
      const seq = (raw.sequence ?? []).map((s) => s.trim()).filter(Boolean);
      if (seq.length < 3) return { error: 'ordenar con menos de 3 elementos' };
      if (new Set(seq.map(normalizeText)).size !== seq.length) return { error: 'ordenar con elementos repetidos' };
      return { item: { ...base, sequence: seq } };
    }
    case 'essay': {
      if (!base.rubric?.length) return { error: 'desarrollo sin criterios de evaluación' };
      base.points = Math.round(base.rubric.reduce((s, c) => s + c.points, 0) * 2) / 2;
      return { item: base };
    }
    case 'problem': {
      const fa = raw.finalAnswer?.trim();
      const n = raw.correctNumber;
      if (!fa && (n == null || !Number.isFinite(n))) return { error: 'problema sin resultado final' };
      if (!base.solutionSteps.length) return { error: 'problema sin pasos de resolución' };
      const item: Item = { ...base, finalAnswer: fa || String(n) };
      if (n != null && Number.isFinite(n)) {
        item.correctNumber = n;
        item.tolerance = raw.tolerance != null && Number.isFinite(raw.tolerance) && raw.tolerance >= 0 ? raw.tolerance : Math.max(Math.abs(n) * 0.01, 1e-9);
        item.unit = raw.unit?.trim() || undefined;
      }
      if (!item.rubric?.length) {
        item.rubric = [
          { id: newId(), description: 'Plantea correctamente el procedimiento', points: 1 },
          { id: newId(), description: 'Desarrolla los cálculos sin errores', points: 1 },
          { id: newId(), description: 'Llega al resultado correcto', points: 1 },
        ];
      }
      item.points = Math.round(item.rubric.reduce((s, c) => s + c.points, 0) * 2) / 2;
      return { item };
    }
  }
}

function normalizeMedia(m: z.infer<typeof mediaSchema> | null | undefined): Media | undefined {
  if (!m || !m.kind) return undefined;
  if (m.kind === 'chart' && m.expression) {
    const xMin = Number.isFinite(m.xMin) ? (m.xMin as number) : -10;
    const xMax = Number.isFinite(m.xMax) && (m.xMax as number) > xMin ? (m.xMax as number) : xMin + 20;
    return { kind: 'chart', expression: m.expression, xMin, xMax, title: m.title };
  }
  if (m.kind === 'table' && m.headers?.length && m.rows?.length) {
    return { kind: 'table', headers: m.headers, rows: m.rows.map((r) => r.slice(0, m.headers!.length)), title: m.title };
  }
  if (m.kind === 'diagram' && m.nodes?.length) {
    return { kind: 'diagram', nodes: m.nodes, edges: (m.edges ?? []).filter((e) => m.nodes!.includes(e.from) && m.nodes!.includes(e.to)), title: m.title };
  }
  if (m.kind === 'lab' && m.simId && (LAB_SIMS as readonly string[]).includes(m.simId)) {
    return { kind: 'lab', simId: m.simId as LabSimId, params: m.params, instructions: m.instructions ?? 'Observá la simulación y respondé.' };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Corrección automática (determinística)
// ---------------------------------------------------------------------------

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,;:!?¡¿"'`()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Interpreta números escritos por estudiantes: "3,5", "1/4", "2.5 m/s", "-3e2", "50%". */
export function parseNumber(input: string): number | null {
  let s = input.trim().replace(/\s+/g, ' ');
  if (!s) return null;
  const pct = /%\s*$/.test(s);
  s = s.replace(/%\s*$/, '');
  const frac = s.match(/^(-?\d+(?:[.,]\d+)?)\s*\/\s*(-?\d+(?:[.,]\d+)?)/);
  if (frac) {
    const a = Number(frac[1].replace(',', '.'));
    const b = Number(frac[2].replace(',', '.'));
    if (b === 0) return null;
    return a / b;
  }
  // Quita separador de miles "1.234,5" -> "1234.5"
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  const m = s.replace(',', '.').match(/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i);
  if (!m) return null;
  const v = Number(m[0]);
  if (!Number.isFinite(v)) return null;
  return pct ? v / 100 : v;
}

export function textMatches(answer: string, accepted: string[]): boolean {
  const a = normalizeText(answer);
  if (!a) return false;
  for (const acc of accepted) {
    const b = normalizeText(acc);
    if (!b) continue;
    if (a === b) return true;
    const na = parseNumber(answer);
    const nb = parseNumber(acc);
    if (na !== null && nb !== null && /^[-+\d.,/%\se]+$/i.test(acc.trim())) {
      if (Math.abs(na - nb) <= Math.max(Math.abs(nb) * 1e-6, 1e-9)) return true;
      continue;
    }
    // Tolerancia a errores de tipeo en respuestas de texto de más de 4 letras
    if (b.length > 4 && /[a-z]/.test(b)) {
      const dist = levenshtein(a, b);
      if (dist / Math.max(a.length, b.length) <= 0.15) return true;
    }
  }
  return false;
}

export function isAnswered(item: Item, answer: unknown): boolean {
  if (answer === undefined || answer === null) return false;
  switch (item.type) {
    case 'mcq':
      return typeof answer === 'number';
    case 'tf':
      return typeof answer === 'boolean';
    case 'fill':
      return Array.isArray(answer) && answer.some((a) => String(a ?? '').trim());
    case 'match':
      return typeof answer === 'object' && Object.keys(answer as object).length > 0;
    case 'order':
      return Array.isArray(answer) && answer.length > 0;
    case 'problem': {
      const a = answer as { work?: string; final?: string };
      return !!(a.work?.trim() || a.final?.trim());
    }
    default:
      return typeof answer === 'string' && answer.trim().length > 0;
  }
}

export interface AutoGrade {
  /** null = requiere corrección por criterios (IA o revisión manual) */
  score: number | null;
  max: number;
  correct: boolean | null;
  feedback: string;
  /** Parte que falta evaluar por criterios (problemas: procedimiento) */
  needsRubric: boolean;
  autoPart?: number;
}

/** Corrige todo lo que se puede corregir sin IA. */
export function autoGrade(item: Item, answer: unknown): AutoGrade {
  const max = item.points;
  if (!isAnswered(item, answer)) return { score: 0, max, correct: false, feedback: 'Sin responder.', needsRubric: false };
  switch (item.type) {
    case 'mcq': {
      const ok = answer === item.correctIndex;
      return { score: ok ? max : 0, max, correct: ok, feedback: ok ? 'Correcto.' : `La opción correcta era: "${item.options![item.correctIndex!]}".`, needsRubric: false };
    }
    case 'tf': {
      const ok = answer === item.correctBool;
      return { score: ok ? max : 0, max, correct: ok, feedback: ok ? 'Correcto.' : `La afirmación es ${item.correctBool ? 'verdadera' : 'falsa'}.`, needsRubric: false };
    }
    case 'numeric': {
      const v = parseNumber(String(answer));
      if (v === null) return { score: 0, max, correct: false, feedback: 'No se pudo interpretar el número ingresado.', needsRubric: false };
      const ok = Math.abs(v - item.correctNumber!) <= (item.tolerance ?? 0);
      return { score: ok ? max : 0, max, correct: ok, feedback: ok ? 'Correcto.' : `El valor esperado era ${fmtNum(item.correctNumber!)}${item.unit ? ' ' + item.unit : ''}.`, needsRubric: false };
    }
    case 'short': {
      const acc = item.acceptedAnswers ?? [];
      if (acc.length && textMatches(String(answer), acc)) return { score: max, max, correct: true, feedback: 'Correcto.', needsRubric: false };
      // No coincide literalmente: puede estar bien expresado de otra forma.
      return { score: null, max, correct: null, feedback: '', needsRubric: true };
    }
    case 'fill': {
      const arr = (answer as unknown[]).map((a) => String(a ?? ''));
      const blanks = item.blanks!;
      let ok = 0;
      const wrong: string[] = [];
      blanks.forEach((acc, i) => {
        if (textMatches(arr[i] ?? '', acc)) ok++;
        else wrong.push(`espacio ${i + 1}: "${acc[0]}"`);
      });
      const score = Math.round((ok / blanks.length) * max * 100) / 100;
      return { score, max, correct: ok === blanks.length, feedback: ok === blanks.length ? 'Todos los espacios son correctos.' : `Correctos ${ok}/${blanks.length}. Esperado → ${wrong.join('; ')}.`, needsRubric: false };
    }
    case 'match': {
      const map = answer as Record<string, number>;
      const pairs = item.pairs!;
      let ok = 0;
      pairs.forEach((_, i) => {
        if (map[String(i)] === i) ok++;
      });
      const score = Math.round((ok / pairs.length) * max * 100) / 100;
      return { score, max, correct: ok === pairs.length, feedback: ok === pairs.length ? 'Todas las relaciones son correctas.' : `Relaciones correctas: ${ok}/${pairs.length}.`, needsRubric: false };
    }
    case 'order': {
      const arr = (answer as string[]).map(normalizeText);
      const seq = item.sequence!.map(normalizeText);
      let ok = 0;
      seq.forEach((s, i) => {
        if (arr[i] === s) ok++;
      });
      const score = Math.round((ok / seq.length) * max * 100) / 100;
      return { score, max, correct: ok === seq.length, feedback: ok === seq.length ? 'Orden correcto.' : `Posiciones correctas: ${ok}/${seq.length}. Orden esperado: ${item.sequence!.join(' → ')}.`, needsRubric: false };
    }
    case 'essay':
      return { score: null, max, correct: null, feedback: '', needsRubric: true };
    case 'problem': {
      const a = answer as { work?: string; final?: string };
      let autoPart: number | undefined;
      if (item.correctNumber !== undefined && a.final?.trim()) {
        const v = parseNumber(a.final);
        autoPart = v !== null && Math.abs(v - item.correctNumber) <= (item.tolerance ?? 0) ? 1 : 0;
      }
      return { score: null, max, correct: null, feedback: '', needsRubric: true, autoPart };
    }
  }
}

export function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 10000) / 10000).replace('.', ',');
}

/** Texto de la respuesta correcta para mostrar después de corregir. */
export function correctAnswerText(item: Item): string {
  switch (item.type) {
    case 'mcq':
      return item.options![item.correctIndex!];
    case 'tf':
      return item.correctBool ? 'Verdadero' : 'Falso';
    case 'numeric':
      return `${fmtNum(item.correctNumber!)}${item.unit ? ' ' + item.unit : ''}`;
    case 'short':
      return item.acceptedAnswers?.join(' / ') || 'Ver criterios';
    case 'fill':
      return item.blanks!.map((b, i) => `${i + 1}) ${b[0]}`).join('  ');
    case 'match':
      return item.pairs!.map((p) => `${p.left} → ${p.right}`).join('; ');
    case 'order':
      return item.sequence!.join(' → ');
    case 'essay':
      return 'Respuesta abierta (ver criterios)';
    case 'problem':
      return item.finalAnswer ?? '';
  }
}

/** Texto plano de la respuesta del estudiante (para IA, exportación y tutor). */
export function answerText(item: Item, answer: unknown): string {
  if (!isAnswered(item, answer)) return '(sin responder)';
  switch (item.type) {
    case 'mcq':
      return item.options![answer as number];
    case 'tf':
      return answer ? 'Verdadero' : 'Falso';
    case 'fill':
      return (answer as string[]).map((a, i) => `${i + 1}) ${a ?? ''}`).join('  ');
    case 'match': {
      const map = answer as Record<string, number>;
      return item.pairs!.map((p, i) => `${p.left} → ${map[String(i)] !== undefined ? item.pairs![map[String(i)]].right : '?'}`).join('; ');
    }
    case 'order':
      return (answer as string[]).join(' → ');
    case 'problem': {
      const a = answer as { work?: string; final?: string };
      return `Procedimiento: ${a.work?.trim() || '(vacío)'}\nResultado: ${a.final?.trim() || '(vacío)'}`;
    }
    default:
      return String(answer);
  }
}

/** Similitud de Jaccard entre consignas, para evitar ejercicios repetidos. */
export function promptSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeText(a).split(' ').filter((w) => w.length > 2));
  const tb = new Set(normalizeText(b).split(' ').filter((w) => w.length > 2));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Orden determinístico pseudoaleatorio (para mezclar opciones de relacionar/ordenar de forma estable). */
export function seededShuffle<T>(arr: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    const j = Math.abs(h ^ (h >>> 16)) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
