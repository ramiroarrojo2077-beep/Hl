import { z } from 'zod';
import { generateJson } from '../client';
import { styleGuide } from './common';

// Pasos para desarrollar un ejercicio en la pizarra. Cada paso puede tener una
// verificación para que el estudiante lo intente antes de verlo.

const stepsSchema = z.object({
  title: z.string(),
  steps: z.array(
    z.object({
      title: z.string(),
      latex: z.string().nullable().optional(),
      text: z.string().nullable().optional(),
      explanation: z.string(),
      check: z.object({ kind: z.enum(['numeric', 'expression', 'text']), expected: z.string(), prompt: z.string() }).nullable().optional(),
    }),
  ),
});

export type BoardSteps = z.infer<typeof stepsSchema>;

export async function boardSteps(problem: string, signal?: AbortSignal): Promise<BoardSteps> {
  const { data } = await generateJson(stepsSchema, {
    system: `Sos el profesor de StudyOS explicando en una pizarra. ${styleGuide()} Descomponé la resolución en 3 a 8 pasos. En cada paso: título corto, lo que se escribe en la pizarra (latex: LaTeX sin $; o text si no es matemático), y la explicación del razonamiento (1-3 oraciones, para leer en voz alta). En 1 a 3 pasos clave agregá "check" para que el estudiante lo intente: kind "numeric" (expected = número), "expression" (expected = expresión equivalente, por ejemplo "x^2-4") o "text" (expected = respuesta breve), y prompt = qué tiene que escribir. Verificá cada cálculo.`,
    messages: [{ role: 'user', content: `Ejercicio: ${problem}\nDevolvé {"title","steps":[{"title","latex","text","explanation","check"}]}` }],
    signal,
  });
  return data;
}

const judgeSchema = z.object({ correct: z.boolean(), feedback: z.string() });

export async function judgeStep(problem: string, step: string, expected: string, answer: string, signal?: AbortSignal) {
  const { data } = await generateJson(judgeSchema, {
    system: `Evaluá si la respuesta del estudiante a un paso de resolución es correcta o equivalente a la esperada. ${styleGuide()} Si no lo es, explicá brevemente el error sin dar la respuesta completa.`,
    messages: [{ role: 'user', content: `Ejercicio: ${problem}\nPaso: ${step}\nEsperado: ${expected}\nRespuesta del estudiante: ${answer}\nDevolvé {"correct":bool,"feedback":"..."}` }],
    signal,
  });
  return data;
}
