import { db, logActivity, type Exam, type ExamAttempt, type ItemResult } from '@/lib/db';
import { recordMastery } from '@/lib/mastery';
import { gradeItems, totals } from '@/ai/agents/grader';

export async function gradeExam(exam: Exam, attempt: ExamAttempt, signal?: AbortSignal): Promise<ExamAttempt> {
  let context: string | undefined;
  if (exam.docId) {
    const { docContext } = await import('@/ai/rag');
    context = (await docContext(exam.docId, 20000, exam.topic).catch(() => null))?.text;
  }
  const results = await gradeItems(exam.items, attempt.answers, signal, context);
  const { score, max } = totals(results);
  const done: ExamAttempt = { ...attempt, results, score, maxScore: max, status: 'graded', finishedAt: attempt.finishedAt ?? Date.now() };
  await db.examAttempts.put(done);
  await recordMastery(
    exam.items.filter((it) => results[it.id] && results[it.id].gradedBy !== 'pending').map((it) => ({ subjectId: exam.subjectId, concept: it.concept, correct: results[it.id].max ? results[it.id].score / results[it.id].max : 0 })),
    'exam',
    exam.id,
  );
  await logActivity({ type: 'exam', title: `Examen «${exam.title}»: ${score}/${max}`, refId: exam.id, route: `/exams/${exam.id}`, subjectId: exam.subjectId });
  return done;
}

export async function overrideExamResult(exam: Exam, attempt: ExamAttempt, itemId: string, r: ItemResult) {
  const results = { ...attempt.results, [itemId]: r };
  const { score, max } = totals(results);
  await db.examAttempts.update(attempt.id, { results, score, maxScore: max });
  const it = exam.items.find((i) => i.id === itemId);
  if (it) await recordMastery([{ subjectId: exam.subjectId, concept: it.concept, correct: r.max ? r.score / r.max : 0 }], 'exam', exam.id);
}

/** Conceptos con más errores (errores frecuentes y temas a repasar). */
export function errorConcepts(exam: Exam, results: Record<string, ItemResult>) {
  const m = new Map<string, { lost: number; total: number; count: number }>();
  for (const it of exam.items) {
    const r = results[it.id];
    if (!r) continue;
    const c = m.get(it.concept) ?? { lost: 0, total: 0, count: 0 };
    c.lost += r.max - r.score;
    c.total += r.max;
    if (r.score < r.max) c.count++;
    m.set(it.concept, c);
  }
  return [...m.entries()].filter(([, v]) => v.lost > 0).map(([concept, v]) => ({ concept, ratio: 1 - v.lost / v.total, wrong: v.count })).sort((a, b) => a.ratio - b.ratio);
}
