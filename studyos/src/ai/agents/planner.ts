import { z } from 'zod';
import { generateJson } from '../client';
import { styleGuide } from './common';

// Study Planner: interpreta un pedido en lenguaje natural. El calendario lo arma
// luego lib/planner.ts de forma determinística (y editable).

const planReqSchema = z.object({
  subjectName: z.string().default(''),
  examDate: z.string().nullable().default(null),
  topics: z.array(z.string()).default([]),
  topicsUnnamed: z.boolean().default(false),
  minutesPerDay: z.coerce.number().nullable().default(null),
  notes: z.string().default(''),
});

export type PlanRequest = z.infer<typeof planReqSchema>;

export async function parsePlanRequest(text: string, subjects: string[], signal?: AbortSignal): Promise<PlanRequest> {
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  const { data } = await generateJson(planReqSchema, {
    system: `Sos el Study Planner de StudyOS. ${styleGuide()} Extraé del pedido del estudiante los datos para armar un plan de estudio. Hoy es ${iso} (${today.toLocaleDateString('es-AR', { weekday: 'long' })}). Convertí fechas relativas ("dentro de siete días", "el viernes") a una fecha absoluta YYYY-MM-DD. Si menciona una cantidad de temas sin nombrarlos, devolvé nombres "Tema 1".."Tema N" y topicsUnnamed=true. No inventes temas concretos que el estudiante no mencionó. Materias existentes: ${subjects.join(', ') || 'ninguna'}.`,
    messages: [{ role: 'user', content: `${text}\n\nDevolvé {"subjectName","examDate":"YYYY-MM-DD"|null,"topics":[...],"topicsUnnamed":bool,"minutesPerDay":número|null,"notes":"aclaraciones"}` }],
    signal,
  });
  return data;
}
