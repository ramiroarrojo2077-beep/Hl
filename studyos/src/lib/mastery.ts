import { db, type ConceptMastery, type MasteryEvent } from './db';
import { normalizeText } from './items';

// Dominio por concepto, calculado SOLO a partir de resultados reales
// (exámenes, tareas, flashcards). score es una media móvil exponencial de los
// aciertos (0..1), con alfa 0.35: los resultados recientes pesan más.
// Umbrales: < 0.6 necesita repaso, 0.6–0.85 en progreso, >= 0.85 dominado
// (y al menos 3 intentos para considerarlo dominado).

const ALPHA = 0.35;

export function conceptKey(subjectId: string | undefined, concept: string) {
  return `${subjectId ?? '_'}::${normalizeText(concept)}`;
}

export type MasteryLevel = 'new' | 'weak' | 'learning' | 'mastered';

export function masteryLevel(m: Pick<ConceptMastery, 'score' | 'attempts'>): MasteryLevel {
  if (m.attempts === 0) return 'new';
  if (m.score < 0.6) return 'weak';
  if (m.score >= 0.85 && m.attempts >= 3) return 'mastered';
  return 'learning';
}

export const MASTERY_LABEL: Record<MasteryLevel, string> = {
  new: 'Sin datos',
  weak: 'Necesita repaso',
  learning: 'En progreso',
  mastered: 'Dominado',
};

export function applyEvent(m: ConceptMastery | undefined, base: { subjectId?: string; concept: string }, ev: MasteryEvent): ConceptMastery {
  const cur: ConceptMastery = m ?? {
    id: conceptKey(base.subjectId, base.concept),
    subjectId: base.subjectId,
    concept: base.concept.trim(),
    attempts: 0,
    correctSum: 0,
    score: 0,
    lastSeen: ev.at,
    history: [],
  };
  const score = cur.attempts === 0 ? ev.correct : cur.score * (1 - ALPHA) + ev.correct * ALPHA;
  return {
    ...cur,
    attempts: cur.attempts + 1,
    correctSum: cur.correctSum + ev.correct,
    score: Math.round(score * 1000) / 1000,
    lastSeen: ev.at,
    history: [...cur.history, ev].slice(-40),
  };
}

export async function recordMastery(entries: { subjectId?: string; concept: string; correct: number }[], source: MasteryEvent['source'], refId: string) {
  const at = Date.now();
  await db.transaction('rw', db.mastery, async () => {
    for (const e of entries) {
      if (!e.concept?.trim()) continue;
      const id = conceptKey(e.subjectId, e.concept);
      const cur = await db.mastery.get(id);
      await db.mastery.put(applyEvent(cur, e, { at, correct: Math.max(0, Math.min(1, e.correct)), source, refId }));
    }
  });
}

/** Conceptos más débiles con datos reales, para recomendaciones y tareas de refuerzo. */
export async function weakConcepts(subjectId?: string, limit = 6): Promise<ConceptMastery[]> {
  const all = subjectId ? await db.mastery.where('subjectId').equals(subjectId).toArray() : await db.mastery.toArray();
  return all
    .filter((m) => m.attempts > 0 && m.score < 0.75)
    .sort((a, b) => a.score - b.score || b.lastSeen - a.lastSeen)
    .slice(0, limit);
}

/** Dificultad adaptativa 1..5 según el dominio de los conceptos relevantes. */
export function adaptiveDifficulty(ms: Pick<ConceptMastery, 'score' | 'attempts'>[]): number {
  const withData = ms.filter((m) => m.attempts > 0);
  if (!withData.length) return 2;
  const avg = withData.reduce((s, m) => s + m.score, 0) / withData.length;
  if (avg < 0.4) return 1;
  if (avg < 0.6) return 2;
  if (avg < 0.75) return 3;
  if (avg < 0.9) return 4;
  return 5;
}

/** Cambio en el dominio de un concepto entre dos momentos (para mostrar mejoras). */
export function improvementSince(m: ConceptMastery, since: number): { before: number | null; after: number } {
  const prev = m.history.filter((h) => h.at < since);
  if (!prev.length) return { before: null, after: m.score };
  let s = prev[0].correct;
  for (const h of prev.slice(1)) s = s * (1 - ALPHA) + h.correct * ALPHA;
  return { before: Math.round(s * 1000) / 1000, after: m.score };
}
