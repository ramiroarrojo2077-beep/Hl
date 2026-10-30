import { z } from 'zod';
import { generateJson } from '../client';
import { docContext } from '../rag';
import { getSettings } from '@/stores/settings';
import { GROUNDING, styleGuide } from './common';

// Visual Agent: mapas conceptuales con relaciones reales entre conceptos.

const mapSchema = z.object({
  title: z.string(),
  nodes: z.array(z.object({ id: z.coerce.string(), label: z.string(), description: z.string().optional().nullable(), page: z.coerce.number().optional().nullable() })),
  edges: z.array(z.object({ source: z.coerce.string(), target: z.coerce.string(), label: z.string().optional().nullable() })),
});

export type MapDraft = z.infer<typeof mapSchema>;

const SYSTEM = () => `Sos el Visual Agent de StudyOS. ${styleGuide()} Construí mapas conceptuales: el nodo raíz es el tema central; los nodos son conceptos (1-5 palabras); cada arista tiene un verbo de enlace que expresa la relación real ("es un tipo de", "produce", "se mide en", "depende de"). No conectes conceptos sin relación explícita en el material. Entre 8 y 25 nodos. ${GROUNDING}`;

export async function generateConceptMap(input: { docId?: string; text?: string; topic?: string; signal?: AbortSignal }): Promise<MapDraft> {
  let material = input.text ?? '';
  if (input.docId) material = (await docContext(input.docId, Math.min(getSettings().ai.contextChars, 40000), input.topic)).text;
  const { data } = await generateJson(mapSchema, {
    system: SYSTEM(),
    messages: [{ role: 'user', content: `${material ? `MATERIAL:\n${material}\n\n` : ''}${input.topic ? `Tema central: ${input.topic}\n` : ''}Devolvé {"title","nodes":[{"id","label","description","page"}],"edges":[{"source","target","label"}]}. "page" es la página del material donde aparece el concepto (o null).` }],
    signal: input.signal,
  });
  return sanitize(data);
}

export async function expandConcept(input: { concept: string; existing: string[]; docId?: string; signal?: AbortSignal }): Promise<MapDraft> {
  const material = input.docId ? (await docContext(input.docId, 20000, input.concept)).text : '';
  const { data } = await generateJson(mapSchema, {
    system: SYSTEM(),
    messages: [{ role: 'user', content: `${material ? `MATERIAL:\n${material}\n\n` : ''}Expandí el concepto «${input.concept}» con 3 a 6 subconceptos o conceptos relacionados nuevos. Conceptos ya presentes en el mapa (no los repitas como nodos nuevos): ${input.existing.join(', ')}. Usá id "root" para «${input.concept}» y conectá los nuevos nodos con él o entre sí. Devolvé {"title","nodes","edges"}.` }],
    signal: input.signal,
  });
  return sanitize(data);
}

function sanitize(d: MapDraft): MapDraft {
  const seen = new Set<string>();
  const nodes = d.nodes.filter((n) => n.label.trim() && !seen.has(n.id) && seen.add(n.id));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = d.edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);
  return { title: d.title, nodes, edges };
}
