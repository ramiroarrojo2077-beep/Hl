import { generate } from '../client';
import { docBatches, docContext } from '../rag';
import { getSettings } from '@/stores/settings';
import { validateCitations } from '@/lib/text';
import type { SummaryMode } from '@/lib/db';
import { GROUNDING, styleGuide } from './common';
import { reviewSummary } from './reviewer';

export const SUMMARY_MODES: Record<SummaryMode, { label: string; hint: string; instructions: string }> = {
  quick: { label: 'Rápido', hint: 'Conceptos esenciales', instructions: 'Resumen rápido: solo los conceptos esenciales, en viñetas cortas, con las definiciones clave en negrita.' },
  full: { label: 'Completo', hint: 'Todo el material desarrollado', instructions: 'Resumen completo: cubrí todo el material en orden, con títulos y subtítulos, definiciones, fórmulas, ejemplos y comparaciones que aparezcan.' },
  exam: { label: 'Para examen', hint: 'Priorizado para evaluación', instructions: 'Resumen para examen: priorizá lo más evaluable (definiciones, fórmulas, procedimientos, diferencias entre conceptos, datos clave). Terminá con una sección "Para repasar antes del examen" con 5-10 preguntas típicas (sin respuestas).' },
  visual: { label: 'Visual', hint: 'Esquemas y diagramas', instructions: 'Resumen visual: organizá la información con tablas comparativas en Markdown, esquemas jerárquicos con viñetas anidadas y diagramas de flujo en texto con flechas (A → B → C). Pocas oraciones largas.' },
  simple: { label: 'Simplificado', hint: 'Lenguaje sencillo y ejemplos', instructions: 'Resumen simplificado: lenguaje sencillo, oraciones cortas y un ejemplo cotidiano por concepto (marcando los ejemplos propios como "(ejemplo fuera del material)").' },
};

const LENGTH = { short: 'breve (≈250 palabras)', medium: 'de extensión media (≈600 palabras)', long: 'extenso (≈1200+ palabras)' } as const;

function systemPrompt(mode: SummaryMode, depth: number, length: keyof typeof LENGTH) {
  return `Sos el agente de resúmenes de StudyOS. ${styleGuide()}
${SUMMARY_MODES[mode].instructions}
Profundidad ${depth}/5 (1 = superficial, 5 = muy detallado). Extensión ${LENGTH[length]}.
Formato: Markdown. Fórmulas en LaTeX entre $...$ o $$...$$. Usá títulos (##), negritas para conceptos clave y viñetas.
${GROUNDING}`;
}

export interface SummaryOptions {
  docId: string;
  mode: SummaryMode;
  depth: number;
  length: keyof typeof LENGTH;
  focus?: string;
  signal?: AbortSignal;
  onProgress?: (p: number, detail: string) => void;
  onText?: (full: string) => void;
}

export async function summarizeDocument(o: SummaryOptions): Promise<{ content: string; invalid: number[]; review?: { ok: boolean; issues: string[] }; model: string; provider: string }> {
  const budget = getSettings().ai.contextChars;
  const { doc, batches } = await docBatches(o.docId, budget);
  if (!batches.length) throw new Error('El documento no tiene texto procesado para resumir.');
  let material: string;
  let notes = '';
  if (o.focus?.trim()) {
    material = (await docContext(o.docId, budget, o.focus)).text;
  } else if (batches.length === 1) {
    material = batches[0];
  } else {
    // Map-reduce: notas con citas por bloque y luego síntesis final. Así se cubre el documento entero.
    const parts: string[] = [];
    for (let i = 0; i < batches.length; i++) {
      o.onProgress?.(i / (batches.length + 1), `Leyendo parte ${i + 1} de ${batches.length}`);
      const r = await generate({
        system: `Tomá notas exhaustivas y fieles del fragmento de material. Conservá definiciones, fórmulas, datos y ejemplos, con su cita [p. N]. ${GROUNDING}`,
        messages: [{ role: 'user', content: `MATERIAL (parte ${i + 1}/${batches.length} de «${doc.title}»):\n${batches[i]}` }],
        signal: o.signal,
        maxTokens: 8000,
      });
      parts.push(r.text);
    }
    notes = parts.join('\n\n');
    material = notes;
  }
  o.onProgress?.(batches.length / (batches.length + 1), 'Redactando resumen');
  const res = await generate({
    system: systemPrompt(o.mode, o.depth, o.length),
    messages: [{ role: 'user', content: `MATERIAL de «${doc.title}» (${doc.pageCount} ${doc.unitLabel.toLowerCase()}s)${notes ? ' — notas por partes, ya con citas' : ''}:\n${material}\n\n${o.focus ? `Enfocá el resumen en: ${o.focus}\n` : ''}Escribí el resumen.` }],
    signal: o.signal,
    onText: o.onText ? (_d, full) => o.onText!(full) : undefined,
  });
  const { text, invalid } = validateCitations(res.text, doc.pageCount);
  let review: { ok: boolean; issues: string[] } | undefined;
  if (getSettings().ai.reviewer) {
    o.onProgress?.(0.95, 'Revisando calidad');
    try {
      review = await reviewSummary(text, (batches.length === 1 ? batches[0] : notes || material).slice(0, budget), o.signal);
    } catch {
      review = undefined;
    }
  }
  return { content: text, invalid, review, model: res.model, provider: res.provider };
}
