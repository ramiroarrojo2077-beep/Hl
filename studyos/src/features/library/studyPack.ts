import { db, logActivity, type Task } from '@/lib/db';
import { newId } from '@/lib/ids';
import { initialSrs } from '@/lib/srs';
import { summarizeDocument } from '@/ai/agents/summary';
import { generateTask } from '@/ai/agents/tasks';
import { generateExamItems } from '@/ai/agents/exam';
import { generateFlashcards } from '@/ai/agents/flashcards';
import { directVideo } from '@/ai/agents/video';
import { getSettings } from '@/stores/settings';
import { aiErrorMessage, isAbort } from '@/ai/types';
import type { JobCtx } from '@/stores/jobs';

// "Explicame todo este tema": a partir de un documento genera, en orden, un
// resumen para examen, una tarea de 10 ejercicios, un examen de práctica,
// flashcards y el guion de un video, y abre una clase con el profesor.
// Cada paso se guarda apenas termina; si uno falla, los demás siguen.

export interface PackResult {
  sessionId: string;
  done: string[];
  failed: string[];
}

export async function buildStudyPack(docId: string, ctx: JobCtx): Promise<PackResult> {
  const doc = await db.documents.get(docId);
  if (!doc) throw new Error('Documento no encontrado');
  const s = getSettings();
  const done: string[] = [];
  const failed: string[] = [];
  const step = async (label: string, p: number, fn: () => Promise<void>) => {
    if (ctx.signal.aborted) throw new DOMException('Cancelado', 'AbortError');
    ctx.progress(p, label);
    try {
      await fn();
      done.push(label);
    } catch (e) {
      if (isAbort(e)) throw e;
      failed.push(`${label}: ${aiErrorMessage(e)}`);
    }
  };

  await step('Resumen para examen', 0.02, async () => {
    const r = await summarizeDocument({ docId, mode: 'exam', depth: 4, length: 'medium', signal: ctx.signal });
    await db.summaries.add({ id: newId(), docId, subjectId: doc.subjectId, title: `Resumen para examen — ${doc.title}`, mode: 'exam', depth: 4, length: 'medium', content: r.content, invalidCitations: r.invalid, review: r.review ? { ...r.review, at: Date.now() } : undefined, provider: r.provider, model: r.model, createdAt: Date.now() });
  });

  await step('Tarea con 10 ejercicios', 0.25, async () => {
    const g = await generateTask({ instruction: `Diez ejercicios variados sobre «${doc.title}», de menor a mayor dificultad`, docId, difficulty: 3, count: 10, types: 'auto', modality: 'individual', multimedia: true, progressive: true, avoid: [], signal: ctx.signal, level: s.profile.level });
    const now = Date.now();
    const task: Task = { id: newId(), subjectId: doc.subjectId, title: g.title, description: g.description, objectives: g.objectives, topic: g.topic, level: g.level, difficulty: 3, modality: 'individual', estimatedMinutes: g.estimatedMinutes, status: 'pending', origin: 'document', instruction: 'Paquete de estudio', sourceDocId: docId, focusConcepts: g.focusConcepts, items: g.items, provider: g.provider, model: g.model, createdAt: now, updatedAt: now };
    await db.tasks.add(task);
  });

  await step('Examen de práctica', 0.5, async () => {
    const g = await generateExamItems({ topic: '', docId, difficulty: 3, count: 10, types: ['mcq', 'tf', 'short', 'fill', 'problem'], signal: ctx.signal });
    await db.exams.add({ id: newId(), subjectId: doc.subjectId, docId, title: g.title || `Examen — ${doc.title}`, topic: doc.title, difficulty: 3, mode: 'practice', items: g.items, provider: g.provider, model: g.model, createdAt: Date.now() });
  });

  await step('Flashcards', 0.7, async () => {
    const cards = await generateFlashcards({ docId, count: 15, difficulty: 3, signal: ctx.signal });
    const deckId = newId();
    const now = Date.now();
    await db.decks.add({ id: deckId, subjectId: doc.subjectId, docId, name: `Flashcards — ${doc.title}`, createdAt: now });
    await db.cards.bulkAdd(cards.map((c) => ({ id: newId(), deckId, front: c.front, back: c.back, concept: c.concept, sourcePage: c.sourcePage ?? undefined, ...initialSrs(now), createdAt: now, updatedAt: now })));
  });

  await step('Guion de video', 0.85, async () => {
    const v = await directVideo({ prompt: `Video que explique los conceptos centrales de «${doc.title}» con animaciones y un ejemplo`, docId, targetSeconds: 75, presenter: s.avatar.character, signal: ctx.signal });
    await db.videos.add({ id: newId(), subjectId: doc.subjectId, docId, prompt: 'Paquete de estudio', title: v.script.title, script: v.script, createdAt: Date.now(), updatedAt: Date.now() });
  });

  const sessionId = newId();
  await db.tutorSessions.add({ id: sessionId, subjectId: doc.subjectId, docId, title: `Clase: ${doc.title}`, mode: 'patient', level: 3, createdAt: Date.now(), updatedAt: Date.now() });
  await logActivity({ type: 'pack', title: `Paquete de estudio de «${doc.title}»`, refId: docId, route: `/library/${docId}?tab=study`, subjectId: doc.subjectId });
  ctx.progress(1, failed.length ? `Listo con ${failed.length} paso(s) fallido(s)` : 'Listo');
  return { sessionId, done, failed };
}
