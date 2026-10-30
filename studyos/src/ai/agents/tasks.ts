import { z } from 'zod';
import { generateJson } from '../client';
import { docContext } from '../rag';
import { getSettings } from '@/stores/settings';
import { ITEM_TYPE_LABEL, type Item, type ItemType } from '@/lib/items';
import { GROUNDING, itemFormatInstructions, parseItems, styleGuide, difficultyLabel } from './common';
import { reviewItems } from './reviewer';

// Task Generator Agent: diseña actividades a partir de una instrucción libre,
// del material del estudiante o de sus errores reales; adapta la dificultad,
// genera criterios de evaluación, pistas y solución paso a paso.

export interface WeakSpot {
  concept: string;
  score: number;
  attempts: number;
  mistakes: string[]; // respuestas incorrectas reales del estudiante
}

export interface TaskGenInput {
  instruction: string;
  subjectName?: string;
  topic?: string;
  level?: string;
  difficulty: number; // 1..5 efectivo
  adaptiveNote?: string;
  count?: number;
  types: ItemType[] | 'auto';
  estimatedMinutes?: number;
  objectives?: string[];
  docId?: string;
  extraContext?: string;
  modality: 'individual' | 'grupal';
  multimedia: boolean;
  progressive: boolean;
  weak?: WeakSpot[];
  avoid: string[];
  signal?: AbortSignal;
  onProgress?: (p: number, d: string) => void;
}

const taskSchema = z.object({
  title: z.string(),
  description: z.string().default(''),
  objectives: z.array(z.string()).default([]),
  topic: z.string().default(''),
  level: z.string().default(''),
  estimatedMinutes: z.coerce.number().default(30),
  focusConcepts: z.array(z.string()).default([]),
  items: z.array(z.unknown()),
});

export interface GeneratedTask {
  title: string;
  description: string;
  objectives: string[];
  topic: string;
  level: string;
  estimatedMinutes: number;
  focusConcepts: string[];
  items: Item[];
  notes: string[];
  model: string;
  provider: string;
}

function systemPrompt(input: TaskGenInput, withSource: boolean) {
  return `Sos el Task Generator Agent de StudyOS: un docente que diseña tareas personalizadas, no cuestionarios genéricos. ${styleGuide()}
Principios:
- Cada ejercicio trabaja un concepto concreto y tiene un propósito (comprender, aplicar, analizar o transferir).
- Variá contextos y formatos: problemas contextualizados de la vida real, análisis, interpretación de gráficos/tablas, procedimientos. Evitá repetir la misma estructura con otros números.
- Ajustá la dificultad al nivel pedido${input.progressive ? ' y ordená los ejercicios de menor a mayor dificultad' : ''}.
- Las pistas guían sin revelar; la solución paso a paso explica el razonamiento.
- En actividades abiertas definí criterios de evaluación observables.
- Si la modalidad es grupal, incluí consignas que requieran discusión o reparto de roles.
- Matemática: incluí procedimientos; Lengua: comprensión, análisis y escritura; Ciencias: conceptos, experimentos y gráficos; Historia/Geografía: fuentes, líneas de tiempo (usar "order"), comparaciones y desarrollo; Idiomas: vocabulario, comprensión y escritura.
${itemFormatInstructions({ allowMedia: input.multimedia, withSource })}
${GROUNDING}`;
}

function userPrompt(input: TaskGenInput, material: string | null, count: number | undefined, avoid: string[]) {
  const types = input.types === 'auto' ? 'elegí los tipos más adecuados para el tema y la instrucción (variados)' : input.types.map((t) => `${ITEM_TYPE_LABEL[t]} (${t})`).join(', ');
  const weak = input.weak?.length
    ? `\nCONCEPTOS A REFORZAR (datos reales del estudiante):\n${input.weak
        .map((w) => `- ${w.concept}: dominio ${Math.round(w.score * 100)}% en ${w.attempts} intentos.${w.mistakes.length ? ` Errores cometidos: ${w.mistakes.slice(0, 4).map((m) => `«${m}»`).join('; ')}` : ''}`)
        .join('\n')}\nDiseñá la tarea para atacar esos errores: primero un ejercicio que haga visible el error típico, luego práctica guiada y al final aplicación.`
    : '';
  return `${material ? `MATERIAL DE REFERENCIA:\n${material}\n\n` : ''}INSTRUCCIÓN DEL ESTUDIANTE: «${input.instruction}»
${input.subjectName ? `Materia: ${input.subjectName}\n` : ''}${input.topic ? `Tema: ${input.topic}\n` : ''}${input.level ? `Año/nivel: ${input.level}\n` : ''}Dificultad: ${difficultyLabel(input.difficulty)} (${input.difficulty}/5)${input.adaptiveNote ? ` — ${input.adaptiveNote}` : ''}
Cantidad de ejercicios: ${count ?? 'la que indique la instrucción (entre 5 y 15 si no dice)'}
Tipos: ${types}
${input.estimatedMinutes ? `Duración estimada: ${input.estimatedMinutes} minutos\n` : ''}${input.objectives?.length ? `Objetivos de aprendizaje: ${input.objectives.join('; ')}\n` : ''}Modalidad: ${input.modality}${weak}${avoid.length ? `\nNO repitas estas consignas usadas antes por el estudiante:\n- ${avoid.slice(-40).join('\n- ')}` : ''}
Devolvé {"title","description","objectives":[...],"topic","level","estimatedMinutes","focusConcepts":[...],"items":[...]}`;
}

export async function generateTask(input: TaskGenInput): Promise<GeneratedTask> {
  const budget = getSettings().ai.contextChars;
  const ctx = input.docId ? await docContext(input.docId, budget, input.topic || input.instruction) : null;
  const material = ctx ? `«${ctx.doc.title}»\n${ctx.text}` : input.extraContext ?? null;
  const notes: string[] = [];
  input.onProgress?.(0.1, 'Diseñando la tarea');
  const { data, meta } = await generateJson(taskSchema, {
    system: systemPrompt(input, !!ctx),
    messages: [{ role: 'user', content: userPrompt(input, material, input.count, input.avoid) }],
    signal: input.signal,
  });
  let { items, rejected } = parseItems(data.items, input.avoid);
  if (rejected.length) notes.push(`Se descartaron ${rejected.length} ejercicios inválidos o repetidos.`);
  const target = input.count ?? Math.max(items.length, 5);
  if (items.length < target) {
    input.onProgress?.(0.45, 'Completando ejercicios');
    const more = await generateJson(z.object({ items: z.array(z.unknown()) }), {
      system: systemPrompt(input, !!ctx),
      messages: [{ role: 'user', content: userPrompt({ ...input, instruction: `${input.instruction} (agregá ejercicios nuevos para completar la tarea «${data.title}»)` }, material, target - items.length, [...input.avoid, ...items.map((i) => i.prompt)]) + '\nDevolvé {"items":[...]}' }],
      signal: input.signal,
    });
    items = [...items, ...parseItems(more.data.items, [...input.avoid, ...items.map((i) => i.prompt)]).items].slice(0, target);
  }
  if (getSettings().ai.reviewer && items.length) {
    input.onProgress?.(0.7, 'Verificando soluciones');
    try {
      const r = await reviewItems(items, material ?? undefined, input.signal);
      items = r.items;
      notes.push(...r.notes);
    } catch {
      notes.push('No se pudo completar la revisión de calidad.');
    }
  }
  if (input.progressive) items = items.map((it, i) => ({ it, i })).sort((a, b) => a.it.difficulty - b.it.difficulty || a.i - b.i).map((x) => x.it);
  if (!items.length) throw new Error(rejected.some((r) => r === 'ítem repetido') ? 'La IA solo propuso ejercicios que repetían otros que ya hiciste. Probá de nuevo o cambiá el tema.' : 'No se obtuvieron ejercicios válidos. Probá de nuevo o con otro modelo.');
  return {
    title: data.title,
    description: data.description,
    objectives: data.objectives,
    topic: data.topic || input.topic || '',
    level: data.level || input.level || '',
    estimatedMinutes: Math.max(5, Math.round(data.estimatedMinutes || items.length * 4)),
    focusConcepts: data.focusConcepts.length ? data.focusConcepts : [...new Set(items.map((i) => i.concept))],
    items,
    notes,
    model: meta.model,
    provider: meta.provider,
  };
}

const commentSchema = z.object({ comment: z.string(), recommendations: z.array(z.string()).default([]) });

/** Comentario global de la IA después de corregir una tarea. */
export async function taskComment(summary: string, signal?: AbortSignal) {
  const { data } = await generateJson(commentSchema, {
    system: `Sos un docente que da devoluciones constructivas y concretas. ${styleGuide()} No uses frases vacías. Señalá patrones de error y qué practicar. No diagnostiques capacidades personales.`,
    messages: [{ role: 'user', content: `${summary}\n\nDevolvé {"comment":"2-4 oraciones","recommendations":["acción concreta", "..."]}` }],
    signal,
  });
  return data;
}
