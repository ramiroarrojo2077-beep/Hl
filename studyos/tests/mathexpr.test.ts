import { describe, expect, it } from 'vitest';
import { compile, tryCompile } from '../src/lib/mathexpr';

describe('parser de expresiones', () => {
  it.each([
    ['2x + 1', { x: 3 }, 7],
    ['x^2 - 4', { x: 3 }, 5],
    ['3(x+1)', { x: 1 }, 6],
    ['sin(pi/2)', {}, 1],
    ['sqrt(16) + abs(-2)', {}, 6],
    ['y = x^2', { x: 4 }, 16],
    ['2^3^2', {}, 512],
    ['-x^2', { x: 3 }, -9],
    ['sen(0) + ln(e)', {}, 1],
  ])('%s', (expr, scope, v) => expect(compile(expr, ['x', 'y']).call(null, scope as Record<string, number>)).toBeCloseTo(v));
  it('acepta funciones de dos variables', () => expect(compile('x*y + a', ['x', 'y', 'a'])({ x: 2, y: 3, a: 1 })).toBe(7));
  it('informa errores en lugar de evaluar código', () => {
    expect(tryCompile('alert(1)').error).toBeTruthy();
    expect(tryCompile('2 +').error).toBeTruthy();
    expect(tryCompile('(2+3').error).toMatch(/paréntesis/);
  });
});
