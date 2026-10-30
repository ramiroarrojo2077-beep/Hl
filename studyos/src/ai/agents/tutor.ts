import { generate } from '../client';
import { formatChunks, retrieve } from '../rag';
import type { Msg } from '../types';
import type { TutorMode } from '@/lib/db';
import { GROUNDING, LAB_SIM_DESCRIPTIONS, styleGuide } from './common';

export const TUTOR_MODES: Record<TutorMode, { label: string; desc: string; prompt: string }> = {
  patient: {
    label: 'Profesor paciente',
    desc: 'Explica en detalle, paso a paso',
    prompt: 'Explicá con paciencia y en detalle, paso a paso, con analogías y un ejemplo. Al final hacé UNA pregunta corta para comprobar la comprensión.',
  },
  direct: {
    label: 'Profesor directo',
    desc: 'Explicaciones breves y precisas',
    prompt: 'Respondé de forma breve y precisa (≈120 palabras como máximo salvo que te pidan más). Sin introducciones ni relleno.',
  },
  socratic: {
    label: 'Método socrático',
    desc: 'Te guía con preguntas',
    prompt: 'Usá el método socrático: no des la respuesta final. Guiá con UNA pregunta por vez, partiendo de lo que el estudiante sabe, y validá su razonamiento. Si el estudiante pide explícitamente la respuesta o se traba tres veces, explicala.',
  },
  exam: {
    label: 'Preparación de examen',
    desc: 'Práctica intensiva con preguntas',
    prompt: 'Modo práctica de examen: hacé preguntas de examen de a una. Cuando el estudiante responde, corregí con criterio explícito (qué está bien, qué falta), explicá el error si lo hay y seguí con la próxima pregunta, ajustando la dificultad según cómo le va. Llevá la cuenta de aciertos.',
  },
  visual: {
    label: 'Aprendizaje visual',
    desc: 'Diagramas, esquemas y simulaciones',
    prompt: `Priorizá lo visual: esquemas con viñetas anidadas, tablas comparativas en Markdown, diagramas de flujo en texto (A → B → C) y fórmulas en LaTeX. Cuando una simulación del laboratorio 3D ayude, insertá el marcador [[lab:ID]] con uno de estos ID: ${Object.entries(LAB_SIM_DESCRIPTIONS).map(([k, v]) => `${k} (${v.split(' (')[0]})`).join(', ')}. Para desarrollar un ejercicio en la pizarra insertá [[pizarra: enunciado del ejercicio]].`,
  },
  language: {
    label: 'Profesor de idiomas',
    desc: 'Conversación y corrección',
    prompt: 'Sos profesor de idiomas. Conversá en el idioma objetivo al nivel indicado. Cuando el estudiante cometa errores, corregilos al final de tu respuesta en una sección breve "Correcciones" con el formato ❌ original → ✅ corregido (explicación corta en español). Proponé 1-2 palabras de vocabulario útiles y hacé una pregunta para seguir la conversación.',
  },
};

const LEVELS = ['', 'muy simple, como para alguien que recién empieza', 'sencillo', 'intermedio', 'avanzado', 'experto, con rigor y terminología técnica'];

export interface TutorTurn {
  mode: TutorMode;
  level: number;
  targetLanguage?: string;
  history: Msg[];
  docIds: string[];
  subjectName?: string;
  weakConcepts?: string[];
  voice: boolean;
  extraContext?: string;
  signal?: AbortSignal;
  onText: (full: string) => void;
}

export async function tutorReply(t: TutorTurn): Promise<{ text: string; citations: { page: number; docId: string }[] }> {
  const last = t.history[t.history.length - 1];
  const query = typeof last?.content === 'string' ? last.content : '';
  // Para la búsqueda se usa también el turno anterior del tutor (las preguntas de seguimiento suelen ser cortas).
  const prevAssistant = [...t.history].reverse().find((m) => m.role === 'assistant');
  const q = `${query}\n${typeof prevAssistant?.content === 'string' ? prevAssistant.content.slice(0, 300) : ''}`;
  const chunks = t.docIds.length ? await retrieve(t.docIds, q, 6, t.signal) : [];
  const material = chunks.length ? formatChunks(chunks, t.docIds.length > 1) : '';
  const system = `Sos el profesor virtual de StudyOS (Tutor Agent). ${styleGuide()}
MODO: ${TUTOR_MODES[t.mode].label}. ${TUTOR_MODES[t.mode].prompt}
COMPLEJIDAD: ${t.level}/5 (${LEVELS[t.level]}).${t.mode === 'language' && t.targetLanguage ? `\nIDIOMA OBJETIVO: ${t.targetLanguage}.` : ''}${t.subjectName ? `\nMATERIA: ${t.subjectName}.` : ''}${t.weakConcepts?.length ? `\nConceptos en los que el estudiante viene fallando (según sus resultados reales): ${t.weakConcepts.join(', ')}. Tenelos en cuenta si vienen al caso.` : ''}
Recordá lo conversado en esta sesión y adaptate a las respuestas del estudiante: si se equivoca, identificá el error concreto; si acierta, subí un poco el nivel.
Si el estudiante pide "otra forma", cambiá de enfoque (analogía, ejemplo, gráfico o procedimiento distinto), no repitas lo mismo.
Fórmulas en LaTeX ($...$). ${t.voice ? 'Esta respuesta se va a leer en voz alta: oraciones claras, sin tablas, sin listas largas y con la menor cantidad de símbolos posible.' : 'Usá Markdown.'}
${GROUNDING}${material ? '' : '\nEn esta sesión no hay material del estudiante disponible para esta pregunta: respondé con conocimiento general, indicando cuando algo sea discutible o si no estás seguro.'}`;
  const messages: Msg[] = t.history.slice(-24).map((m, i, arr) =>
    i === arr.length - 1 && m.role === 'user' && (material || t.extraContext)
      ? { role: 'user', content: `${t.extraContext ? `CONTEXTO:\n${t.extraContext}\n\n` : ''}${material ? `MATERIAL RELEVANTE DEL ESTUDIANTE:\n${material}\n\n` : ''}PREGUNTA/MENSAJE:\n${m.content}` }
      : m,
  );
  const res = await generate({ system, messages, signal: t.signal, onText: (_d, full) => t.onText(full) });
  return { text: res.text, citations: chunks.map((c) => ({ page: c.page, docId: c.docId })) };
}
