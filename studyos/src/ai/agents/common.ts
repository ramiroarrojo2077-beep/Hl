import { z } from 'zod';
import { getSettings } from '@/stores/settings';
import { LAB_SIMS, normalizeItem, rawItemSchema, promptSimilarity, type Item } from '@/lib/items';

// Piezas compartidas por los agentes. Todos los agentes usan el mismo modelo
// configurado con roles e instrucciones separadas (no hace falta un modelo por agente).

export function styleGuide(): string {
  const s = getSettings();
  const dialect = s.profile.dialect === 'rioplatense' ? 'español rioplatense (voseo: "vos tenés", "fijate")' : 'español neutro';
  return `Escribí en ${dialect}. Nivel educativo del estudiante: ${s.profile.level || 'no especificado'}${s.profile.name ? `. Se llama ${s.profile.name}` : ''}.`;
}

export const GROUNDING = `REGLAS DE VERACIDAD
- Cuando recibas MATERIAL del estudiante, basate en él. Después de cada dato tomado del material, citá su ubicación con el formato exacto [p. N] (o [diap. N] / [sec. N], el mismo prefijo que aparece en el material).
- No inventes datos, fechas, fórmulas ni citas. No cites páginas que no aparecen en el material.
- Si agregás conocimiento general que no está en el material, marcalo con "(fuera del material)".
- Si el material es insuficiente, contradictorio o ilegible para lo pedido, decilo explícitamente.
- Si no estás seguro de algo, decí que no estás seguro en lugar de afirmarlo.`;

export const LAB_SIM_DESCRIPTIONS: Record<(typeof LAB_SIMS)[number], string> = {
  projectile: 'Tiro oblicuo (params: v0 m/s, angle grados, g m/s², h0 m)',
  pendulum: 'Péndulo simple (params: length m, g, amplitude grados, damping)',
  molecules: 'Visor de moléculas 3D (params: molecule índice 0=H2O 1=CO2 2=CH4 3=NH3 4=O2 5=etanol 6=NaCl 7=benceno)',
  separation: 'Separación magnética de mezclas en una cinta (params: magnet 0-100 intensidad, ironPct %, speed)',
  cell: 'Célula animal/vegetal con organelas (params: plant 0 o 1)',
  solar: 'Sistema solar con órbitas (params: speed días/s)',
  surface: 'Superficie 3D z=f(x,y) (params: a, b)',
  solids: 'Sólidos geométricos con volumen y área (params: solid índice 0=cubo 1=prisma 2=cilindro 3=cono 4=esfera 5=pirámide, a, b, h)',
};

export function itemFormatInstructions(opts: { allowMedia: boolean; withSource: boolean }): string {
  const media = opts.allowMedia
    ? `- media (opcional, solo si aporta): {"kind":"chart","expression":"x^2-4","xMin":-5,"xMax":5,"title":"..."} para graficar una función (expresión con x, usar ^, sqrt(), sin(), etc.) | {"kind":"table","headers":[...],"rows":[[...]],"title":"..."} | {"kind":"diagram","nodes":["A","B"],"edges":[{"from":"A","to":"B","label":"..."}]} | {"kind":"lab","simId":"...","params":{...},"instructions":"qué observar"} donde simId es uno de:\n${Object.entries(LAB_SIM_DESCRIPTIONS).map(([k, v]) => `    · ${k}: ${v}`).join('\n')}\n  No inventes imágenes: si un ejercicio necesitaría una imagen que no podés generar, usá tabla, gráfico o diagrama.`
    : '- media: no incluir.';
  return `FORMATO DE CADA ÍTEM (objeto JSON):
- type: "mcq" | "tf" | "short" | "numeric" | "fill" | "match" | "order" | "essay" | "problem"
- prompt: consigna completa y autocontenida. En "fill" marcá cada espacio con ___ (tres guiones bajos).
- concept: concepto evaluado, 2 a 5 palabras, con el mismo nombre en todos los ítems del mismo concepto.
- difficulty: 1 a 5
- points: 1 salvo essay/problem (la suma de sus criterios)
- hints: 1 a 3 pistas progresivas que orientan SIN revelar la respuesta
- solutionSteps: pasos de resolución explicados (obligatorio en problem y numeric)
- explanation: por qué la respuesta correcta lo es y cuál es el error típico
${opts.withSource ? '- sourcePage: número de página/diapositiva del material de donde sale, o null\n' : ''}Campos según el tipo:
- mcq: options (3 a 5, una sola correcta, distractores plausibles), correctIndex (desde 0)
- tf: correctBool (true/false)
- short: acceptedAnswers (variantes breves aceptables, ej. ["fotosíntesis","la fotosíntesis"]); rubric opcional
- numeric: correctNumber, tolerance (margen absoluto aceptado), unit (o null)
- fill: blanks: lista con una lista de respuestas aceptadas por cada ___, en orden
- match: pairs: [{"left":"...","right":"..."}] (3 a 6 pares, derechos distintos)
- order: sequence: elementos en el orden correcto (3 a 7)
- essay: rubric: [{"description":"criterio observable","points":N}] (2 a 5 criterios)
- problem: finalAnswer (texto), correctNumber (si el resultado es numérico), tolerance, unit, solutionSteps y rubric (criterios del procedimiento)
${media}
VERIFICÁ cada clave de corrección antes de responder: hacé el cálculo, confirmá que la opción marcada es la única correcta y que el resultado numérico es exacto.`;
}

export const rawItemsSchema = z.object({ items: z.array(z.unknown()) }).passthrough();

/** Valida ítems crudos; devuelve los válidos y los motivos de descarte. */
export function parseItems(raw: unknown[], avoid: string[] = []): { items: Item[]; rejected: string[] } {
  const items: Item[] = [];
  const rejected: string[] = [];
  for (const r of raw) {
    const p = rawItemSchema.safeParse(r);
    if (!p.success) {
      rejected.push('ítem con formato inválido');
      continue;
    }
    const { item, error } = normalizeItem(p.data);
    if (!item) {
      rejected.push(error ?? 'ítem inválido');
      continue;
    }
    const dup = [...avoid, ...items.map((i) => i.prompt)].some((a) => promptSimilarity(a, item.prompt) > 0.72);
    if (dup) {
      rejected.push('ítem repetido');
      continue;
    }
    items.push(item);
  }
  return { items, rejected };
}

export function difficultyLabel(d: number) {
  return ['', 'Principiante', 'Básico', 'Intermedio', 'Avanzado', 'Experto', 'Adaptativo'][d] ?? 'Intermedio';
}
