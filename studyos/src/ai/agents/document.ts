import { z } from 'zod';
import { generate, generateJson } from '../client';
import { docContext } from '../rag';
import { getSettings } from '@/stores/settings';
import { GROUNDING } from './common';

// Document Agent: OCR por visión (opcional) y análisis de conceptos con páginas.

export async function visionOcr(dataB64: string, mime: string, signal?: AbortSignal): Promise<string> {
  const r = await generate({
    system: 'Transcribí fielmente TODO el texto visible en la imagen, respetando títulos, listas, fórmulas (en LaTeX entre $...$) y tablas (en Markdown). No agregues nada que no esté en la imagen. Si una parte es ilegible, escribí [ilegible]. Si no hay texto, respondé exactamente: [sin texto]',
    messages: [{ role: 'user', content: [{ type: 'image', mime, data: dataB64 }, { type: 'text', text: 'Transcribí el texto de esta imagen.' }] }],
    signal,
    maxTokens: 8000,
  });
  return r.text.trim() === '[sin texto]' ? '' : r.text;
}

const conceptsSchema = z.object({
  concepts: z.array(z.object({ name: z.string(), page: z.coerce.number().nullable().optional(), definition: z.string().nullable().optional() })),
});

export async function analyzeConcepts(docId: string, signal?: AbortSignal) {
  const ctx = await docContext(docId, getSettings().ai.contextChars);
  const { data } = await generateJson(conceptsSchema, {
    system: `Sos el Document Agent de StudyOS. Identificá los conceptos importantes del material (10 a 30), cada uno con la página donde se define o explica mejor y una definición de una línea tomada del material. ${GROUNDING}`,
    messages: [{ role: 'user', content: `MATERIAL («${ctx.doc.title}»):\n${ctx.text}\n\nDevolvé {"concepts":[{"name","page","definition"}]}` }],
    signal,
  });
  return data.concepts.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), page: c.page && c.page > 0 && c.page <= ctx.doc.pageCount ? c.page : undefined, definition: c.definition ?? undefined }));
}
