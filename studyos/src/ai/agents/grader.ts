import { z } from 'zod';
import { generateJson } from '../client';
import { aiConfigured } from '@/stores/settings';
import { answerText, autoGrade, type Item } from '@/lib/items';
import type { ItemResult } from '@/lib/db';
import { styleGuide } from './common';

// Corrección: primero lo determinístico (opción múltiple, V/F, numéricas,
// completar, relacionar, ordenar). Las respuestas abiertas se evalúan con
// criterios explícitos por IA, con nivel de confianza, y quedan disponibles para
// revisión manual. Sin IA configurada, quedan "pendientes de revisión".

const gradeSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      criteria: z.array(z.object({ index: z.number(), awarded: z.number(), comment: z.string().default('') })),
      feedback: z.string(),
      confidence: z.enum(['alta', 'media', 'baja']).catch('media'),
    }),
  ),
});

export async function gradeItems(items: Item[], answers: Record<string, unknown>, signal?: AbortSignal, context?: string): Promise<Record<string, ItemResult>> {
  const results: Record<string, ItemResult> = {};
  const open: { item: Item; auto: ReturnType<typeof autoGrade> }[] = [];
  for (const item of items) {
    const a = answers[item.id];
    const g = autoGrade(item, a);
    if (g.score !== null) {
      results[item.id] = { score: g.score, max: g.max, correct: g.correct, feedback: g.feedback, gradedBy: 'auto' };
    } else {
      open.push({ item, auto: g });
    }
  }
  if (!open.length) return results;

  if (!aiConfigured()) {
    for (const { item, auto } of open) {
      const part = auto.autoPart;
      results[item.id] = {
        score: 0,
        max: item.points,
        correct: null,
        feedback: part === 1 ? 'El resultado final es correcto. El procedimiento queda pendiente de revisión manual.' : 'Pendiente de revisión: configurá un proveedor de IA o corregila manualmente con los criterios.',
        gradedBy: 'pending',
        criteria: rubricOf(item).map((c) => ({ ...c, awarded: 0, comment: '' })),
      };
    }
    return results;
  }

  const payload = open.map(({ item, auto }) => ({
    id: item.id,
    tipo: item.type,
    consigna: item.prompt,
    respuesta_estudiante: answerText(item, answers[item.id]),
    referencia: item.finalAnswer ?? item.acceptedAnswers?.join(' / ') ?? '',
    pasos_referencia: item.solutionSteps,
    resultado_final_verificado: auto.autoPart === undefined ? null : auto.autoPart === 1 ? 'correcto' : 'incorrecto',
    criterios: rubricOf(item).map((c, i) => ({ index: i, descripcion: c.description, puntos: c.points })),
  }));

  const { data } = await generateJson(gradeSchema, {
    system: `Sos un docente que corrige con criterios explícitos. ${styleGuide()}
Para cada respuesta: asigná a cada criterio un puntaje entre 0 y su máximo (podés usar medios puntos), con un comentario breve que cite qué hizo o qué faltó. El feedback general explica qué está bien, qué corregir y por qué, sin humillar. No regales puntos por respuestas vacías o irrelevantes, pero aceptá formulaciones distintas a la referencia si son correctas. Si la respuesta es ambigua o no podés evaluarla con seguridad, usá confidence "baja".`,
    messages: [{ role: 'user', content: `${context ? `MATERIAL DE REFERENCIA:\n${context.slice(0, 20000)}\n\n` : ''}RESPUESTAS A CORREGIR:\n${JSON.stringify(payload)}\n\nDevolvé {"results":[{"id":"...","criteria":[{"index":0,"awarded":N,"comment":"..."}],"feedback":"...","confidence":"alta|media|baja"}]}` }],
    signal,
  });

  for (const { item } of open) {
    const r = data.results.find((x) => x.id === item.id);
    const rubric = rubricOf(item);
    if (!r) {
      results[item.id] = { score: 0, max: item.points, correct: null, feedback: 'La IA no devolvió corrección para este ítem. Queda pendiente de revisión.', gradedBy: 'pending', criteria: rubric.map((c) => ({ ...c, awarded: 0, comment: '' })) };
      continue;
    }
    const criteria = rubric.map((c, i) => {
      const got = r.criteria.find((x) => x.index === i);
      const awarded = Math.max(0, Math.min(c.points, Math.round((got?.awarded ?? 0) * 2) / 2));
      return { ...c, awarded, comment: got?.comment ?? '' };
    });
    const total = criteria.reduce((s, c) => s + c.points, 0) || 1;
    const got = criteria.reduce((s, c) => s + c.awarded, 0);
    const score = Math.round((got / total) * item.points * 100) / 100;
    results[item.id] = { score, max: item.points, correct: score >= item.points * 0.999 ? true : score === 0 ? false : null, feedback: r.feedback, gradedBy: 'ai', criteria, confidence: r.confidence };
  }
  return results;
}

function rubricOf(item: Item) {
  if (item.rubric?.length) return item.rubric;
  return [{ id: 'c0', description: `Responde correctamente: ${item.acceptedAnswers?.[0] ?? item.finalAnswer ?? 'según la consigna'}`, points: item.points }];
}

export function totals(results: Record<string, ItemResult>) {
  let score = 0;
  let max = 0;
  for (const r of Object.values(results)) {
    score += r.score;
    max += r.max;
  }
  return { score: Math.round(score * 100) / 100, max };
}
