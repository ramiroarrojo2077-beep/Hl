import { describe, expect, it } from 'vitest';
import { Bm25, chunkPages, extractCitations, validateCitations, detectFormulas } from '../src/lib/text';
import { extractJson } from '../src/ai/json';
import { extractPlainText } from '../src/import/office';

describe('fragmentación y búsqueda', () => {
  const pages = [
    { page: 1, text: 'La estequiometría estudia las proporciones en que reaccionan las sustancias.\n\nUn mol contiene 6,022 × 10²³ partículas.' },
    { page: 2, text: 'Los enlaces covalentes se forman al compartir electrones.\n\nEl enlace iónico ocurre entre metales y no metales.' },
  ];
  it('cada fragmento conserva su página', () => {
    const c = chunkPages(pages, 80);
    expect(c.length).toBeGreaterThanOrEqual(3);
    expect(c.every((x) => x.page === 1 || x.page === 2)).toBe(true);
  });
  it('BM25 encuentra el fragmento relevante', () => {
    const c = chunkPages(pages, 80).map((x, i) => ({ id: String(i), text: x.text, page: x.page }));
    const bm = new Bm25(c);
    const top = bm.search('enlace iónico metales')[0];
    expect(c[Number(top.id)].page).toBe(2);
  });
  it('detecta fórmulas', () => expect(detectFormulas('Texto\nF = m · a\nE = mc²', 1).length).toBeGreaterThanOrEqual(1));
});

describe('citas', () => {
  it('extrae y valida páginas citadas', () => {
    expect(extractCitations('Dato [p. 2] y otro [p. 3-4]')).toEqual([2, 3, 4]);
    const v = validateCitations('Dato [p. 2] y otro [p. 9]', 3);
    expect(v.invalid).toEqual([9]);
    expect(v.text).toContain('[cita no verificada]');
  });
});

describe('extractJson', () => {
  it('lee JSON dentro de bloques de código o con texto alrededor', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Acá va: {"a":{"b":[1,2]}} listo')).toEqual({ a: { b: [1, 2] } });
  });
  it('falla con JSON truncado', () => expect(() => extractJson('{"a": [1, 2')).toThrow());
});

describe('texto pegado', () => {
  it('divide en secciones por títulos', () => {
    const r = extractPlainText('# Tema 1\n' + 'a'.repeat(900) + '\n\n# Tema 2\nb');
    expect(r.pages.length).toBe(2);
    expect(r.pages[1].headings[0].text).toBe('Tema 2');
  });
});
