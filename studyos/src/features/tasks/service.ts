import { db, logActivity, type ItemResult, type Task, type TaskAttempt, type TaskStatus } from '@/lib/db';
import { newId } from '@/lib/ids';
import { adaptiveDifficulty, conceptKey, recordMastery, weakConcepts } from '@/lib/mastery';
import { answerText, normalizeText, type ItemType } from '@/lib/items';
import { generateTask, taskComment, type WeakSpot } from '@/ai/agents/tasks';
import { gradeItems, totals } from '@/ai/agents/grader';
import { aiConfigured } from '@/stores/settings';
import type { JobCtx } from '@/stores/jobs';

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Pendiente',
  in_progress: 'En progreso',
  completed: 'Completada',
  graded: 'Corregida',
  needs_review: 'Necesita repaso',
};

export interface CreateTaskInput {
  instruction: string;
  subjectId?: string;
  topic?: string;
  level?: string;
  difficulty: number; // 1..6
  count?: number;
  types: ItemType[] | 'auto';
  estimatedMinutes?: number;
  objectives?: string[];
  docId?: string;
  extraContext?: string;
  modality: 'individual' | 'grupal';
  multimedia: boolean;
  progressive: boolean;
  dueDate?: number;
  origin: Task['origin'];
  focusConcepts?: string[];
  parentTaskId?: string;
}

/** Errores reales del estudiante en un concepto (respuestas incorrectas registradas). */
export async function mistakesFor(concept: string, subjectId?: string, limit = 5): Promise<string[]> {
  const key = normalizeText(concept);
  const out: string[] = [];
  const attempts = await db.taskAttempts.orderBy('updatedAt').reverse().limit(30).toArray();
  for (const a of attempts) {
    if (!a.results) continue;
    const task = await db.tasks.get(a.taskId);
    if (!task || (subjectId && task.subjectId !== subjectId)) continue;
    for (const it of task.items) {
      const r = a.results[it.id];
      if (r && r.score < r.max * 0.6 && normalizeText(it.concept) === key) out.push(`Consigna: ${it.prompt.slice(0, 140)} → respondió: ${answerText(it, a.answers[it.id]).slice(0, 160)}`);
      if (out.length >= limit) return out;
    }
  }
  const exAttempts = await db.examAttempts.orderBy('startedAt').reverse().limit(20).toArray();
  for (const a of exAttempts) {
    const ex = await db.exams.get(a.examId);
    if (!ex || (subjectId && ex.subjectId !== subjectId)) continue;
    for (const it of ex.items) {
      const r = a.results[it.id];
      if (r && r.score < r.max * 0.6 && normalizeText(it.concept) === key) out.push(`Consigna: ${it.prompt.slice(0, 140)} → respondió: ${answerText(it, a.answers[it.id]).slice(0, 160)}`);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export async function previousPrompts(subjectId?: string, limit = 60): Promise<string[]> {
  const tasks = subjectId ? await db.tasks.where('subjectId').equals(subjectId).toArray() : await db.tasks.orderBy('createdAt').reverse().limit(20).toArray();
  return tasks.flatMap((t) => t.items.map((i) => i.prompt)).slice(-limit);
}

export async function createTask(input: CreateTaskInput, ctx: JobCtx): Promise<Task> {
  const subject = input.subjectId ? await db.subjects.get(input.subjectId) : undefined;
  // Dificultad adaptativa: se calcula con el dominio real de la materia/conceptos.
  let difficulty = Math.min(5, input.difficulty);
  let adaptiveNote: string | undefined;
  let weak: WeakSpot[] = [];
  if (input.focusConcepts?.length) {
    for (const c of input.focusConcepts) {
      const m = await db.mastery.get(conceptKey(input.subjectId, c));
      weak.push({ concept: c, score: m?.score ?? 0, attempts: m?.attempts ?? 0, mistakes: await mistakesFor(c, input.subjectId) });
    }
  }
  if (input.difficulty === 6) {
    const pool = input.focusConcepts?.length ? weak : await weakConcepts(input.subjectId, 8).then((w) => w.map((m) => ({ concept: m.concept, score: m.score, attempts: m.attempts, mistakes: [] as string[] })));
    const all = input.subjectId ? await db.mastery.where('subjectId').equals(input.subjectId).toArray() : await db.mastery.toArray();
    difficulty = adaptiveDifficulty(pool.length ? pool : all);
    adaptiveNote = all.some((m) => m.attempts)
      ? `ajustada al desempeño real: dominio promedio ${Math.round((all.filter((m) => m.attempts).reduce((s, m) => s + m.score, 0) / Math.max(1, all.filter((m) => m.attempts).length)) * 100)}% en ${all.filter((m) => m.attempts).length} conceptos`
      : 'sin datos previos del estudiante: empezar en nivel básico e ir subiendo';
    if (!weak.length && pool.length) weak = await Promise.all(pool.slice(0, 4).map(async (w) => ({ ...w, mistakes: await mistakesFor(w.concept, input.subjectId) })));
  }
  const avoid = await previousPrompts(input.subjectId);
  const g = await generateTask({
    instruction: input.instruction,
    subjectName: subject?.name,
    topic: input.topic,
    level: input.level,
    difficulty,
    adaptiveNote,
    count: input.count,
    types: input.types,
    estimatedMinutes: input.estimatedMinutes,
    objectives: input.objectives,
    docId: input.docId,
    extraContext: input.extraContext,
    modality: input.modality,
    multimedia: input.multimedia,
    progressive: input.progressive,
    weak: weak.length ? weak : undefined,
    avoid,
    signal: ctx.signal,
    onProgress: (p, d) => ctx.progress(p, d),
  });
  const now = Date.now();
  const task: Task = {
    id: newId(),
    subjectId: input.subjectId,
    title: g.title,
    description: g.description,
    objectives: g.objectives.length ? g.objectives : input.objectives ?? [],
    topic: g.topic,
    level: g.level,
    difficulty: input.difficulty,
    modality: input.modality,
    estimatedMinutes: input.estimatedMinutes ?? g.estimatedMinutes,
    dueDate: input.dueDate,
    status: 'pending',
    origin: input.origin,
    instruction: input.instruction,
    sourceDocId: input.docId,
    parentTaskId: input.parentTaskId,
    focusConcepts: g.focusConcepts,
    items: g.items,
    aiComment: g.notes.length ? g.notes.join(' ') : undefined,
    provider: g.provider,
    model: g.model,
    createdAt: now,
    updatedAt: now,
  };
  await db.tasks.add(task);
  await syncDueEvent(task);
  await logActivity({ type: 'task-created', title: `Nueva tarea: ${task.title}`, refId: task.id, route: `/tasks/${task.id}`, subjectId: task.subjectId });
  ctx.progress(1, 'Tarea lista');
  return task;
}

export async function syncDueEvent(task: Task) {
  const existing = await db.events.where('taskId').equals(task.id).first();
  if (!task.dueDate) {
    if (existing) await db.events.delete(existing.id);
    return;
  }
  const ev = { title: `Entrega: ${task.title}`, type: 'task' as const, start: task.dueDate, allDay: true, subjectId: task.subjectId, taskId: task.id, done: task.status === 'graded' || task.status === 'completed' };
  if (existing) await db.events.update(existing.id, ev);
  else await db.events.add({ id: newId(), ...ev });
}

export async function getDraft(taskId: string): Promise<TaskAttempt> {
  const drafts = await db.taskAttempts.where('taskId').equals(taskId).filter((a) => a.status === 'draft').toArray();
  if (drafts.length) return drafts.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const now = Date.now();
  const a: TaskAttempt = { id: newId(), taskId, startedAt: now, updatedAt: now, answers: {}, hintsUsed: {}, revealed: {}, status: 'draft' };
  await db.taskAttempts.add(a);
  return a;
}

/** Corrige un intento, actualiza el dominio por concepto y el estado de la tarea. */
export async function submitAttempt(task: Task, attempt: TaskAttempt, signal?: AbortSignal): Promise<TaskAttempt> {
  let context: string | undefined;
  if (task.sourceDocId) {
    const { docContext } = await import('@/ai/rag');
    context = (await docContext(task.sourceDocId, 20000, task.topic || task.title).catch(() => null))?.text;
  }
  const results = await gradeItems(task.items, attempt.answers, signal, context);
  // Las pistas usadas reducen levemente el puntaje registrado en el dominio, no la nota.
  const { score, max } = totals(results);
  const ratio = max ? score / max : 0;
  const pending = Object.values(results).some((r) => r.gradedBy === 'pending');
  let feedback: string | undefined;
  if (aiConfigured() && !pending) {
    try {
      const summary = task.items.map((it, i) => `${i + 1}. [${it.concept}] ${results[it.id]?.score}/${results[it.id]?.max} — ${results[it.id]?.feedback ?? ''}`).join('\n');
      const c = await taskComment(`Tarea: ${task.title}\nPuntaje: ${score}/${max}\n${summary}`, signal);
      feedback = `${c.comment}${c.recommendations.length ? `\n\n**Para practicar:**\n${c.recommendations.map((r) => `- ${r}`).join('\n')}` : ''}`;
    } catch {
      feedback = undefined;
    }
  }
  const now = Date.now();
  const graded: TaskAttempt = { ...attempt, results, score, maxScore: max, feedback, status: 'graded', submittedAt: now, updatedAt: now };
  await db.taskAttempts.put(graded);
  await applyMastery(task, graded);
  const status: TaskStatus = pending ? 'completed' : ratio < 0.6 ? 'needs_review' : 'graded';
  await db.tasks.update(task.id, { status, lastScore: ratio, updatedAt: now });
  await syncDueEvent({ ...task, status });
  await logActivity({ type: 'task-graded', title: `Corregiste «${task.title}»: ${Math.round(ratio * 100)}%`, refId: task.id, route: `/tasks/${task.id}`, subjectId: task.subjectId });
  return graded;
}

async function applyMastery(task: Task, attempt: TaskAttempt) {
  const entries: { subjectId?: string; concept: string; correct: number }[] = [];
  for (const it of task.items) {
    const r = attempt.results?.[it.id];
    if (!r || r.gradedBy === 'pending') continue;
    const hints = attempt.hintsUsed[it.id] ?? 0;
    const base = r.max ? r.score / r.max : 0;
    entries.push({ subjectId: task.subjectId, concept: it.concept, correct: Math.max(0, base - hints * 0.1) });
  }
  await recordMastery(entries, 'task', task.id);
}

/** Reemplaza la corrección de un ítem por una revisión manual y recalcula todo. */
export async function overrideResult(task: Task, attempt: TaskAttempt, itemId: string, r: ItemResult) {
  const results = { ...(attempt.results ?? {}), [itemId]: r };
  const { score, max } = totals(results);
  const ratio = max ? score / max : 0;
  await db.taskAttempts.update(attempt.id, { results, score, maxScore: max, updatedAt: Date.now() });
  const pending = Object.values(results).some((x) => x.gradedBy === 'pending');
  await db.tasks.update(task.id, { lastScore: ratio, status: pending ? 'completed' : ratio < 0.6 ? 'needs_review' : 'graded', updatedAt: Date.now() });
  const it = task.items.find((i) => i.id === itemId);
  if (it) await recordMastery([{ subjectId: task.subjectId, concept: it.concept, correct: r.max ? r.score / r.max : 0 }], 'task', task.id);
}

/** Conceptos con errores en un intento corregido. */
export function failedConcepts(task: Task, attempt: TaskAttempt): string[] {
  const out = new Set<string>();
  for (const it of task.items) {
    const r = attempt.results?.[it.id];
    if (r && r.max && r.score / r.max < 0.75) out.add(it.concept);
  }
  return [...out];
}
