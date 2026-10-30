import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { adaptiveDifficulty, applyEvent, masteryLevel, recordMastery, weakConcepts } from '../src/lib/mastery';
import { computeStreak } from '../src/lib/stats';
import { addDays, startOfDay } from '../src/lib/format';

describe('dominio por concepto', () => {
  it('media móvil exponencial con los resultados', () => {
    let m = applyEvent(undefined, { concept: 'División de fracciones' }, { at: 1, correct: 1, source: 'task', refId: 't' });
    expect(m.score).toBe(1);
    m = applyEvent(m, { concept: 'División de fracciones' }, { at: 2, correct: 0, source: 'task', refId: 't' });
    expect(m.score).toBeCloseTo(0.65);
    expect(m.attempts).toBe(2);
  });
  it('niveles: necesita repaso, en progreso, dominado', () => {
    expect(masteryLevel({ score: 0.4, attempts: 2 })).toBe('weak');
    expect(masteryLevel({ score: 0.7, attempts: 2 })).toBe('learning');
    expect(masteryLevel({ score: 0.9, attempts: 3 })).toBe('mastered');
    expect(masteryLevel({ score: 0.9, attempts: 1 })).toBe('learning');
  });
  it('dificultad adaptativa sube con el dominio', () => {
    expect(adaptiveDifficulty([])).toBe(2);
    expect(adaptiveDifficulty([{ score: 0.3, attempts: 3 }])).toBe(1);
    expect(adaptiveDifficulty([{ score: 0.95, attempts: 3 }])).toBe(5);
  });
  it('8 aciertos y 2 errores en división: la división queda como concepto débil', async () => {
    const entries = [
      ...Array.from({ length: 8 }, () => ({ subjectId: 'mat', concept: 'Suma de fracciones', correct: 1 })),
      { subjectId: 'mat', concept: 'División de fracciones', correct: 0 },
      { subjectId: 'mat', concept: 'División de fracciones', correct: 0 },
    ];
    await recordMastery(entries, 'task', 'x');
    const weak = await weakConcepts('mat');
    expect(weak[0].concept).toBe('División de fracciones');
    expect(weak.some((w) => w.concept === 'Suma de fracciones')).toBe(false);
  });
});

describe('racha', () => {
  it('cuenta días seguidos hasta hoy o ayer', () => {
    const today = startOfDay(new Date(2026, 4, 10));
    const d = new Set([today, addDays(today, -1), addDays(today, -2), addDays(today, -4)]);
    expect(computeStreak(d, today)).toBe(3);
    expect(computeStreak(new Set([addDays(today, -1)]), today)).toBe(1);
    expect(computeStreak(new Set([addDays(today, -3)]), today)).toBe(0);
  });
});
