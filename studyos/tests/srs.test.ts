import { describe, expect, it } from 'vitest';
import { estimatedRetention, initialSrs, review } from '../src/lib/srs';

const DAY = 86_400_000;

describe('SM-2', () => {
  it('intervalos 1, 6 y luego intervalo × ease con "Bien"', () => {
    let s = initialSrs(0);
    s = review(s, 4, 0);
    expect(s.interval).toBe(1);
    s = review(s, 4, DAY);
    expect(s.interval).toBe(6);
    s = review(s, 4, 7 * DAY);
    expect(s.interval).toBe(15); // 6 × 2.5
  });
  it('un fallo reinicia la tarjeta y cuenta un lapso', () => {
    let s = review(review(initialSrs(0), 4, 0), 4, DAY);
    s = review(s, 1, 7 * DAY);
    expect(s.interval).toBe(1);
    expect(s.reps).toBe(0);
    expect(s.lapses).toBe(1);
  });
  it('el factor de facilidad nunca baja de 1.3', () => {
    let s = initialSrs(0);
    for (let i = 0; i < 20; i++) s = review(s, 0, i * DAY);
    expect(s.ease).toBe(1.3);
  });
  it('"Fácil" da intervalos más largos que "Bien"', () => {
    const b = review(review(initialSrs(0), 4, 0), 4, DAY);
    const f = review(review(initialSrs(0), 5, 0), 5, DAY);
    expect(f.interval).toBeGreaterThan(b.interval);
  });
  it('la retención estimada es 90% al vencer el intervalo', () => {
    const s = review(review(initialSrs(0), 4, 0), 4, DAY);
    expect(estimatedRetention(s, DAY + s.interval * DAY)).toBeCloseTo(0.9, 2);
  });
});
