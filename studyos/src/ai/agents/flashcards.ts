import { z } from 'zod';
import { generateJson } from '../client';
import { docContext } from '../rag';
import { getSettings } from '@/stores/settings';
import { GROUNDING, styleGuide } from './common';

const cardsSchema = z.object({
  cards: z.array(z.object({ front: z.string(), back: z.string(), concept: z.string().default(''), sourcePage: z.coerce.number().nullable().optional() })),
});

export async function generateFlashcards(input: { docId?: string; topic?: string; count: number; difficulty: number; signal?: AbortSignal }) {
  const ctx = input.docId ? await docContext(input.docId, getSettings().ai.contextChars, input.topic) : null;
  const { data } = await generateJson(cardsSchema, {
    system: `Sos el agente de flashcards de StudyOS. ${styleGuide()} Cada tarjeta evalúa UNA idea (principio de información mínima). Frente: pregunta concreta o término; dorso: respuesta breve y exacta (fórmulas en LaTeX $...$). Evitá tarjetas de sí/no. ${GROUNDING}`,
    messages: [{ role: 'user', content: `${ctx ? `MATERIAL («${ctx.doc.title}»):\n${ctx.text}\n\n` : ''}Creá ${input.count} flashcards${input.topic ? ` sobre ${input.topic}` : ''}, dificultad ${input.difficulty}/5. Devolvé {"cards":[{"front","back","concept","sourcePage"}]}` }],
    signal: input.signal,
  });
  return data.cards.filter((c) => c.front.trim() && c.back.trim()).slice(0, input.count);
}
