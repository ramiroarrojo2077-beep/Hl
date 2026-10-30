import { z } from 'zod';
import { generateJson } from '../client';
import { docContext } from '../rag';
import { getSettings } from '@/stores/settings';
import { ITEM_TYPE_LABEL, type Item, type ItemType } from '@/lib/items';
import { GROUNDING, itemFormatInstructions, parseItems, styleGuide, difficultyLabel } from './common';
import { reviewItems } from './reviewer';

export interface ExamGenInput {
  subjectName?: string;
  topic: string;
  docId?: string;
  difficulty: number;
  count: number;
  types: ItemType[];
  avoid?: string[];
  signal?: AbortSignal;
  onProgress?: (p: number, d: string) => void;
}

const examSchema = z.object({ title: z.string().default('Examen'), items: z.array(z.unknown()) });

export async function generateExamItems(input: ExamGenInput): Promise<{ title: string; items: Item[]; notes: string[]; model: string; provider: string }> {
  const budget = getSettings().ai.contextChars;
  const ctx = input.docId ? await docContext(input.docId, budget, input.topic || undefined) : null;
  const notes: string[] = [];
  const dist = distribute(input.count, input.types);
  const ask = (n: Record<string, number>, avoid: string[]) => `${ctx ? `MATERIAL («${ctx.doc.title}»):\n${ctx.text}\n\n` : ''}Generá un examen${input.subjectName ? ` de ${input.subjectName}` : ''} sobre: ${input.topic || (ctx ? 'todo el material' : 'el tema indicado')}.
Dificultad: ${difficultyLabel(input.difficulty)} (${input.difficulty}/5), con algunos ítems un nivel por debajo y por encima.
Cantidad por tipo: ${Object.entries(n).map(([t, c]) => `${c} de ${ITEM_TYPE_LABEL[t as ItemType]} (${t})`).join(', ')}.
Cubrí conceptos distintos; no repitas la misma pregunta con otras palabras.${avoid.length ? `\nNo repitas estas consignas ya usadas:\n- ${avoid.slice(-30).join('\n- ')}` : ''}
Devolvé {"title":"...","items":[...]}`;
  input.onProgress?.(0.1, 'Generando preguntas');
  const { data, meta } = await generateJson(examSchema, {
    system: `Sos el agente de exámenes de StudyOS. ${styleGuide()}\n${itemFormatInstructions({ allowMedia: true, withSource: !!ctx })}\n${GROUNDING}`,
    messages: [{ role: 'user', content: ask(dist, input.avoid ?? []) }],
    signal: input.signal,
  });
  let { items, rejected } = parseItems(data.items, input.avoid);
  if (rejected.length) notes.push(`Se descartaron ${rejected.length} ítems inválidos (${[...new Set(rejected)].slice(0, 3).join(', ')}).`);
  // Si faltan ítems, pedimos solo los que faltan una vez.
  const missing = input.count - items.length;
  if (missing > 0) {
    input.onProgress?.(0.45, 'Completando preguntas faltantes');
    const more = await generateJson(examSchema, {
      system: `Sos el agente de exámenes de StudyOS. ${styleGuide()}\n${itemFormatInstructions({ allowMedia: true, withSource: !!ctx })}\n${GROUNDING}`,
      messages: [{ role: 'user', content: ask(distribute(missing, input.types), [...(input.avoid ?? []), ...items.map((i) => i.prompt)]) }],
      signal: input.signal,
    });
    const extra = parseItems(more.data.items, [...(input.avoid ?? []), ...items.map((i) => i.prompt)]);
    items = [...items, ...extra.items].slice(0, input.count);
  }
  if (getSettings().ai.reviewer && items.length) {
    input.onProgress?.(0.7, 'Verificando claves de corrección');
    try {
      const r = await reviewItems(items, ctx?.text, input.signal);
      items = r.items;
      notes.push(...r.notes);
    } catch {
      notes.push('No se pudo completar la revisión de calidad.');
    }
  }
  if (!items.length) throw new Error('No se obtuvieron preguntas válidas. Probá de nuevo o con otro modelo.');
  return { title: data.title, items, notes, model: meta.model, provider: meta.provider };
}

/** Reparte la cantidad total entre los tipos pedidos. */
export function distribute(count: number, types: ItemType[]): Record<string, number> {
  const t = types.length ? types : (['mcq', 'tf', 'short'] as ItemType[]);
  const out: Record<string, number> = {};
  t.forEach((ty, i) => (out[ty] = Math.floor(count / t.length) + (i < count % t.length ? 1 : 0)));
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}
