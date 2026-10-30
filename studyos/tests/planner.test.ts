import { describe, expect, it } from 'vitest';
import { buildPlan } from '../src/lib/planner';
import { addDays, startOfDay } from '../src/lib/format';

describe('planificador', () => {
  const start = new Date(2026, 3, 6, 10).getTime(); // lunes
  it('examen en 7 días con 5 temas: todos los temas, repasos y repaso final antes del examen', () => {
    const exam = addDays(startOfDay(start), 7);
    const r = buildPlan({ examDate: exam, topics: ['A', 'B', 'C', 'D', 'E'], minutesPerDay: 90, startDate: start });
    const learn = r.sessions.filter((s) => s.kind === 'learn');
    expect(learn.map((s) => s.topic).sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(r.sessions.some((s) => s.kind === 'review')).toBe(true);
    expect(r.sessions.some((s) => s.kind === 'final')).toBe(true);
    expect(Math.max(...r.sessions.map((s) => s.start))).toBeLessThan(exam);
    // nunca supera el máximo diario
    const perDay = new Map<number, number>();
    for (const s of r.sessions) perDay.set(s.day, (perDay.get(s.day) ?? 0) + s.minutes);
    for (const v of perDay.values()) expect(v).toBeLessThanOrEqual(90);
  });
  it('respeta los días de descanso', () => {
    const r = buildPlan({ examDate: addDays(startOfDay(start), 10), topics: ['A', 'B', 'C'], minutesPerDay: 60, startDate: start, restDays: [0, 6] });
    for (const s of r.sessions) expect([0, 6]).not.toContain(new Date(s.day).getDay());
  });
  it('avisa si la fecha ya pasó', () => {
    expect(buildPlan({ examDate: start - 86_400_000, topics: ['A'], minutesPerDay: 60, startDate: start }).warnings[0]).toMatch(/posterior/);
  });
});
