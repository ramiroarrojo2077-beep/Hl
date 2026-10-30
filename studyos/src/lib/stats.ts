import { db } from './db';
import { addDays, startOfDay, DAY } from './format';
import { masteryLevel } from './mastery';

// Estadísticas calculadas solo con datos registrados en el dispositivo.
// Tiempo de estudio = sesiones Focus + duración real de exámenes y tareas +
// tiempo medido respondiendo flashcards. No se estiman minutos de otras acciones.

export interface DayMinutes {
  day: number;
  minutes: number;
}

export interface StudyStats {
  last7: DayMinutes[];
  weekMinutes: number;
  streak: number;
  masteredConcepts: number;
  overallMastery: number | null;
  conceptsWithData: number;
}

const CAP = 180;

export async function studyMinutesByDay(from: number, to: number): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  const add = (t: number, min: number) => {
    if (t < from || t >= to || !(min > 0)) return;
    const d = startOfDay(t);
    map.set(d, (map.get(d) ?? 0) + min);
  };
  const [focus, exams, tasks, reviews] = await Promise.all([
    db.focus.where('startedAt').between(from, to).toArray(),
    db.examAttempts.where('startedAt').between(from - DAY, to).toArray(),
    db.taskAttempts.where('updatedAt').between(from, to + DAY).toArray(),
    db.reviews.where('reviewedAt').between(from, to).toArray(),
  ]);
  for (const f of focus) add(f.startedAt, f.focusedMinutes);
  for (const a of exams) if (a.finishedAt) add(a.startedAt, Math.min(CAP, (a.finishedAt - a.startedAt) / 60000));
  for (const a of tasks) {
    const end = a.submittedAt ?? a.updatedAt;
    // Borradores que se retomaron otro día: solo cuenta si empezó y terminó el mismo día.
    if (startOfDay(end) === startOfDay(a.startedAt)) add(a.startedAt, Math.min(CAP, (end - a.startedAt) / 60000));
  }
  for (const r of reviews) add(r.reviewedAt, Math.min(2, (r.durationMs ?? 0) / 60000));
  return map;
}

export async function activeDays(from: number): Promise<Set<number>> {
  const days = new Set<number>();
  const [act, rev, focus] = await Promise.all([
    db.activity.where('at').aboveOrEqual(from).toArray(),
    db.reviews.where('reviewedAt').aboveOrEqual(from).toArray(),
    db.focus.where('startedAt').aboveOrEqual(from).toArray(),
  ]);
  for (const a of act) if (a.type !== 'import') days.add(startOfDay(a.at));
  for (const r of rev) days.add(startOfDay(r.reviewedAt));
  for (const f of focus) days.add(startOfDay(f.startedAt));
  return days;
}

/** Días seguidos con actividad de estudio, terminando hoy (o ayer si hoy todavía no estudió). */
export function computeStreak(days: Set<number>, today = startOfDay()): number {
  let d = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export async function getStudyStats(): Promise<StudyStats> {
  const today = startOfDay();
  const from = addDays(today, -6);
  const byDay = await studyMinutesByDay(from, addDays(today, 1));
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(from, i);
    return { day, minutes: Math.round(byDay.get(day) ?? 0) };
  });
  // Semana calendario (lunes a domingo)
  const dow = (new Date(today).getDay() + 6) % 7;
  const weekStart = addDays(today, -dow);
  const weekMap = await studyMinutesByDay(weekStart, addDays(today, 1));
  const weekMinutes = [...weekMap.values()].reduce((s, v) => s + v, 0);
  const streak = computeStreak(await activeDays(addDays(today, -400)), today);
  const mastery = await db.mastery.toArray();
  const withData = mastery.filter((m) => m.attempts > 0);
  return {
    last7,
    weekMinutes,
    streak,
    masteredConcepts: withData.filter((m) => masteryLevel(m) === 'mastered').length,
    overallMastery: withData.length ? withData.reduce((s, m) => s + m.score, 0) / withData.length : null,
    conceptsWithData: withData.length,
  };
}

/** Progreso de una materia: promedio del dominio de sus conceptos con datos. */
export async function subjectProgress(): Promise<Map<string, { score: number; concepts: number }>> {
  const out = new Map<string, { score: number; concepts: number }>();
  const all = await db.mastery.toArray();
  const groups = new Map<string, number[]>();
  for (const m of all) {
    if (!m.subjectId || m.attempts === 0) continue;
    groups.set(m.subjectId, [...(groups.get(m.subjectId) ?? []), m.score]);
  }
  for (const [k, v] of groups) out.set(k, { score: v.reduce((s, x) => s + x, 0) / v.length, concepts: v.length });
  return out;
}
