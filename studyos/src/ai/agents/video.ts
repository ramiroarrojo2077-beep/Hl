import { generateJson } from '../client';
import { docContext } from '../rag';
import { newId } from '@/lib/ids';
import { PRESET_LABEL, PRESETS_3D, TEMPLATE_LABEL, TEMPLATES, estimateDuration, sceneSchema, scriptSchema, type Scene, type VideoScript } from '@/features/video/types';
import { GROUNDING, styleGuide } from './common';

// Video Director: convierte un pedido en un guion de escenas sobre plantillas
// programáticas. No promete animaciones arbitrarias: solo puede usar las
// plantillas y escenas 3D que el motor implementa.

export async function directVideo(input: { prompt: string; docId?: string; targetSeconds: number; presenter: VideoScript['presenter']; signal?: AbortSignal }): Promise<{ script: VideoScript; notes: string[] }> {
  const ctx = input.docId ? await docContext(input.docId, 30000, input.prompt) : null;
  const { data } = await generateJson(scriptSchema, {
    system: `Sos el Video Director de StudyOS. ${styleGuide()} Escribís guiones de videos educativos cortos y dinámicos, con narración clara y un recurso visual por escena.
Plantillas disponibles (campo template) y sus campos:
${TEMPLATES.map((t) => `- ${t}: ${TEMPLATE_LABEL[t]}`).join('\n')}
  · title: heading
  · bullets: heading, bullets (3-5 frases de ≤ 8 palabras)
  · diagram: heading, nodes (3-7), edges [{from,to,label}] (from/to deben ser nodos)
  · process: heading, steps (3-6)
  · comparison: heading, left {title, points}, right {title, points}
  · formula: heading, formula (texto plano, ej. "F = m · a"), formulaNote
  · chart: heading, bars {labels, values, unit} o expression (función de x)
  · scene3d: heading, preset3d (uno de: ${PRESETS_3D.map((p) => `${p} = ${PRESET_LABEL[p]}`).join('; ')}), params3d, labels3d (rótulos a mostrar)
  · quiz: question, options (3-4), answerIndex
Campos comunes: narration (lo que dice el narrador, 1-3 oraciones), camera (static|push|pan|orbit), transition (fade|slide|zoom|wipe).
Estructura: empezá con title, alterná plantillas (no más de 2 iguales seguidas), usá scene3d cuando el tema tenga un proceso físico/químico/biológico representable con los presets, y terminá con un resumen (bullets) y un quiz.
Si el pedido menciona algo que ningún preset representa (por ejemplo un personaje o lugar específico), representalo con diagramas o procesos y no lo prometas en la narración.
${GROUNDING}`,
    messages: [{ role: 'user', content: `${ctx ? `MATERIAL («${ctx.doc.title}»):\n${ctx.text}\n\n` : ''}PEDIDO: ${input.prompt}\nDuración objetivo: ≈${input.targetSeconds} segundos en total.\nDevolvé {"title","scenes":[...]}` }],
    signal: input.signal,
  });
  const notes: string[] = [];
  const scenes: Scene[] = [];
  for (const raw of data.scenes) {
    const p = sceneSchema.safeParse(raw);
    if (!p.success) {
      notes.push(`Se descartó una escena con formato inválido (${p.error.issues[0]?.path.join('.')}).`);
      continue;
    }
    const s = p.data;
    if (s.template === 'scene3d' && !s.preset3d) {
      notes.push('Una escena 3D no indicaba una escena disponible y se convirtió en ideas clave.');
      scenes.push({ ...s, template: 'bullets', bullets: s.labels3d ?? [s.heading ?? ''], id: newId(), duration: estimateDuration({ ...s, template: 'bullets' }) });
      continue;
    }
    if (s.template === 'diagram' && !(s.nodes?.length)) continue;
    if (s.template === 'quiz' && (!s.question || !(s.options?.length))) continue;
    scenes.push({ ...s, id: newId(), duration: estimateDuration(s) });
  }
  if (!scenes.length) throw new Error('El guion generado no tenía escenas válidas. Probá de nuevo.');
  return { script: { title: data.title, style: 'cosmos', presenter: input.presenter, scenes }, notes };
}
