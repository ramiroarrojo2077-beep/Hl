import { describe, expect, it } from 'vitest';
import { autoGrade, normalizeItem, parseNumber, promptSimilarity, rawItemSchema, textMatches, type Item } from '../src/lib/items';

const mk = (raw: Record<string, unknown>) => normalizeItem(rawItemSchema.parse(raw));

describe('normalizeItem', () => {
  it('acepta una opción múltiple válida', () => {
    const r = mk({ type: 'mcq', prompt: '¿2+2?', options: ['3', '4', '5'], correctIndex: 1, concept: 'Suma' });
    expect(r.item?.correctIndex).toBe(1);
    expect(r.item?.concept).toBe('Suma');
  });
  it('rechaza índice correcto fuera de rango y opciones repetidas', () => {
    expect(mk({ type: 'mcq', prompt: '¿2+2?', options: ['3', '4'], correctIndex: 5 }).error).toBeTruthy();
    expect(mk({ type: 'mcq', prompt: '¿2+2?', options: ['4', '4 '], correctIndex: 0 }).error).toMatch(/repetidas/);
  });
  it('mapea alias de tipos y V/F en texto', () => {
    expect(mk({ type: 'true_false', prompt: 'El agua hierve a 100 °C al nivel del mar', correctBool: 'verdadero' }).item?.correctBool).toBe(true);
  });
  it('valida que completar tenga tantos espacios como respuestas', () => {
    expect(mk({ type: 'fill', prompt: 'La ___ es la unidad de ___', blanks: [['célula']] }).error).toMatch(/2 espacios/);
    expect(mk({ type: 'fill', prompt: 'La ___ es la unidad de ___', blanks: [['célula'], ['vida']] }).item?.blanks).toHaveLength(2);
  });
  it('exige criterios en desarrollo y suma sus puntos', () => {
    expect(mk({ type: 'essay', prompt: 'Explicá la Revolución Francesa' }).error).toBeTruthy();
    const r = mk({ type: 'essay', prompt: 'Explicá la Revolución Francesa', rubric: [{ description: 'Causas', points: 2 }, { description: 'Consecuencias', points: 3 }] });
    expect(r.item?.points).toBe(5);
  });
  it('exige pasos en problemas y agrega criterios por defecto', () => {
    expect(mk({ type: 'problem', prompt: 'Calculá 3·4', correctNumber: 12 }).error).toMatch(/pasos/);
    const r = mk({ type: 'problem', prompt: 'Calculá 3·4', correctNumber: 12, solutionSteps: ['3·4 = 12'] });
    expect(r.item?.rubric?.length).toBe(3);
  });
});

describe('parseNumber', () => {
  it.each([
    ['3,5', 3.5],
    ['7/2', 3.5],
    ['2.5 m/s', 2.5],
    ['1.234,5', 1234.5],
    ['-3e2', -300],
    ['50%', 0.5],
  ])('%s → %d', (s, n) => expect(parseNumber(s)).toBeCloseTo(n));
  it('devuelve null si no hay número', () => expect(parseNumber('hola')).toBeNull());
});

describe('textMatches', () => {
  it('ignora mayúsculas, tildes y puntuación', () => expect(textMatches('Fotosintesis.', ['fotosíntesis'])).toBe(true));
  it('tolera un error de tipeo en palabras largas', () => expect(textMatches('mitocondira', ['mitocondria'])).toBe(true));
  it('no acepta respuestas distintas', () => expect(textMatches('núcleo', ['mitocondria'])).toBe(false));
  it('compara respuestas numéricas', () => expect(textMatches('0,5', ['1/2'])).toBe(true));
});

describe('autoGrade', () => {
  const base = { id: 'x', concept: 'c', difficulty: 2, points: 1, hints: [], solutionSteps: [], explanation: '' };
  it('corrige opción múltiple', () => {
    const it: Item = { ...base, type: 'mcq', prompt: '?', options: ['a', 'b'], correctIndex: 1 };
    expect(autoGrade(it, 1).score).toBe(1);
    expect(autoGrade(it, 0).score).toBe(0);
  });
  it('corrige numéricas con tolerancia', () => {
    const it: Item = { ...base, type: 'numeric', prompt: '?', correctNumber: 9.81, tolerance: 0.01 };
    expect(autoGrade(it, '9,81').correct).toBe(true);
    expect(autoGrade(it, '9.9').correct).toBe(false);
  });
  it('da puntaje parcial en completar, relacionar y ordenar', () => {
    const fill: Item = { ...base, points: 2, type: 'fill', prompt: '___ y ___', blanks: [['a'], ['b']] };
    expect(autoGrade(fill, ['a', 'x']).score).toBe(1);
    const match: Item = { ...base, type: 'match', prompt: '?', pairs: [{ left: '1', right: 'A' }, { left: '2', right: 'B' }] };
    expect(autoGrade(match, { '0': 0, '1': 0 }).score).toBe(0.5);
    const order: Item = { ...base, type: 'order', prompt: '?', sequence: ['x', 'y', 'z'] };
    expect(autoGrade(order, ['x', 'z', 'y']).score).toBeCloseTo(1 / 3, 2);
  });
  it('deriva desarrollo y respuestas cortas no literales a corrección por criterios', () => {
    const short: Item = { ...base, type: 'short', prompt: '?', acceptedAnswers: ['fotosíntesis'] };
    expect(autoGrade(short, 'el proceso por el que las plantas producen glucosa').needsRubric).toBe(true);
    expect(autoGrade(short, 'fotosintesis').score).toBe(1);
  });
  it('en problemas verifica el resultado final y deja el procedimiento a criterios', () => {
    const p: Item = { ...base, points: 3, type: 'problem', prompt: '?', correctNumber: 12, tolerance: 0.1, finalAnswer: '12', solutionSteps: ['…'] };
    const g = autoGrade(p, { work: '3·4', final: '12' });
    expect(g.needsRubric).toBe(true);
    expect(g.autoPart).toBe(1);
  });
  it('sin respuesta vale cero', () => {
    const it: Item = { ...base, type: 'tf', prompt: '?', correctBool: true };
    expect(autoGrade(it, undefined).score).toBe(0);
  });
});

describe('promptSimilarity', () => {
  it('detecta consignas casi iguales', () => expect(promptSimilarity('Calculá el área de un círculo de radio 3', 'Calculá el área de un círculo de radio 3 cm')).toBeGreaterThan(0.72));
  it('distingue consignas distintas', () => expect(promptSimilarity('Calculá el área de un círculo', 'Nombrá las capas de la Tierra')).toBeLessThan(0.2));
});
