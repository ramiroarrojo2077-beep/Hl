import { z } from 'zod';
import { generateJson } from '../client';
import { parseItems, itemFormatInstructions } from './common';
import { correctAnswerText, type Item } from '@/lib/items';

// Quality Reviewer: segunda pasada que verifica coherencia con el material y
// claves de corrección. Lo que no pasa la revisión se marca o se reemplaza.

const summaryReviewSchema = z.object({
  ok: z.boolean(),
  issues: z.array(z.string()).default([]),
});

export async function reviewSummary(summary: string, material: string, signal?: AbortSignal) {
  const { data } = await generateJson(summaryReviewSchema, {
    system: `Sos un revisor de calidad de material educativo. Comparás un resumen con el material original y detectás: afirmaciones que no están en el material y no están marcadas "(fuera del material)", citas [p. N] que no corresponden al contenido de esa página, errores conceptuales y omisiones graves. Sé específico y breve. Si todo está bien, ok=true e issues vacío.`,
    messages: [{ role: 'user', content: `MATERIAL:\n${material}\n\n=====\nRESUMEN A REVISAR:\n${summary}\n\nDevolvé {"ok": boolean, "issues": ["..."]}` }],
    signal,
  });
  return data;
}

const itemReviewSchema = z.object({
  problems: z.array(z.object({ index: z.number(), problem: z.string(), fixed: z.unknown().optional().nullable() })).default([]),
});

/** Revisa claves de corrección; corrige o descarta los ítems con errores. */
export async function reviewItems(items: Item[], material: string | undefined, signal?: AbortSignal): Promise<{ items: Item[]; notes: string[] }> {
  if (!items.length) return { items, notes: [] };
  const listing = items.map((it, i) => ({ index: i, type: it.type, prompt: it.prompt, options: it.options, clave: correctAnswerText(it), solutionSteps: it.solutionSteps }));
  const { data } = await generateJson(itemReviewSchema, {
    system: `Sos un revisor de calidad de evaluaciones. Para cada ítem verificá que la clave de corrección sea correcta (rehacé los cálculos), que haya una sola respuesta correcta, que la consigna sea clara y que no contradiga el material. Reportá SOLO los ítems con problemas. Si podés corregirlo, incluí "fixed" con el ítem completo corregido.\n${itemFormatInstructions({ allowMedia: false, withSource: !!material })}`,
    messages: [{ role: 'user', content: `${material ? `MATERIAL:\n${material.slice(0, 40000)}\n\n` : ''}ÍTEMS:\n${JSON.stringify(listing)}\n\nDevolvé {"problems":[{"index":N,"problem":"...","fixed":{...}|null}]}` }],
    signal,
  });
  const out = items.slice();
  const notes: string[] = [];
  const drop = new Set<number>();
  for (const p of data.problems) {
    if (p.index < 0 || p.index >= items.length) continue;
    if (p.fixed) {
      const { items: fixed } = parseItems([{ ...(items[p.index] as object), ...(p.fixed as object) }]);
      if (fixed[0]) {
        out[p.index] = { ...fixed[0], id: items[p.index].id, media: fixed[0].media ?? items[p.index].media };
        notes.push(`Ítem ${p.index + 1} corregido por el revisor: ${p.problem}`);
        continue;
      }
    }
    drop.add(p.index);
    notes.push(`Ítem ${p.index + 1} descartado por el revisor: ${p.problem}`);
  }
  return { items: out.filter((_, i) => !drop.has(i)), notes };
}
