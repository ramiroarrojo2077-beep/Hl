import { z } from 'zod';

// Guion de video: lista de escenas basadas en plantillas programáticas que el
// motor sabe animar. La IA solo puede elegir entre estas plantillas y escenas
// 3D, por eso el guion se valida antes de renderizar.

export const TEMPLATES = ['title', 'bullets', 'diagram', 'process', 'comparison', 'formula', 'chart', 'scene3d', 'quiz'] as const;
export type Template = (typeof TEMPLATES)[number];

export const PRESETS_3D = ['magnetic-separation', 'molecule', 'orbits', 'diffusion', 'wave', 'cell', 'projectile', 'surface'] as const;
export type Preset3D = (typeof PRESETS_3D)[number];

export const TEMPLATE_LABEL: Record<Template, string> = {
  title: 'Título animado',
  bullets: 'Ideas clave',
  diagram: 'Diagrama de conceptos',
  process: 'Proceso paso a paso',
  comparison: 'Comparación',
  formula: 'Fórmula',
  chart: 'Gráfico animado',
  scene3d: 'Escena 3D',
  quiz: 'Pregunta final',
};

export const PRESET_LABEL: Record<Preset3D, string> = {
  'magnetic-separation': 'Separación magnética en cinta transportadora (planta de reciclaje)',
  molecule: 'Molécula 3D girando (param molecule: H2O, CO2, CH4, NH3, O2, NaCl)',
  orbits: 'Órbitas planetarias',
  diffusion: 'Difusión de partículas entre dos zonas',
  wave: 'Onda transversal (params amplitude, frequency)',
  cell: 'Célula con organelas',
  projectile: 'Tiro oblicuo con trayectoria (params v0, angle)',
  surface: 'Superficie matemática 3D',
};

const str = z.union([z.string(), z.number()]).transform(String);

export const sceneSchema = z.object({
  template: z.enum(TEMPLATES),
  narration: z.string().min(1),
  heading: str.optional().nullable(),
  duration: z.coerce.number().optional().nullable(),
  bullets: z.array(str).optional().nullable(),
  nodes: z.array(str).optional().nullable(),
  edges: z.array(z.object({ from: str, to: str, label: str.optional().nullable() })).optional().nullable(),
  steps: z.array(str).optional().nullable(),
  left: z.object({ title: str, points: z.array(str) }).optional().nullable(),
  right: z.object({ title: str, points: z.array(str) }).optional().nullable(),
  formula: str.optional().nullable(),
  formulaNote: str.optional().nullable(),
  bars: z.object({ labels: z.array(str), values: z.array(z.coerce.number()), unit: str.optional().nullable() }).optional().nullable(),
  expression: str.optional().nullable(),
  preset3d: z.enum(PRESETS_3D).optional().nullable(),
  params3d: z.record(z.string(), z.union([z.number(), z.string()])).optional().nullable(),
  labels3d: z.array(str).optional().nullable(),
  question: str.optional().nullable(),
  options: z.array(str).optional().nullable(),
  answerIndex: z.coerce.number().optional().nullable(),
  camera: z.enum(['static', 'push', 'pan', 'orbit']).optional().nullable().catch('push'),
  transition: z.enum(['fade', 'slide', 'zoom', 'wipe']).optional().nullable().catch('fade'),
});

export const scriptSchema = z.object({
  title: z.string(),
  scenes: z.array(z.unknown()).min(1),
});

export type RawScene = z.infer<typeof sceneSchema>;

export interface Scene extends Omit<RawScene, 'duration'> {
  id: string;
  duration: number;
}

export interface VideoScript {
  title: string;
  style: 'cosmos' | 'chalk' | 'clean';
  presenter: 'seed' | 'twist' | 'robot' | null;
  scenes: Scene[];
}

/** Duración estimada por la narración (~2.6 palabras/segundo) con mínimo por plantilla. */
export function estimateDuration(s: Pick<RawScene, 'narration' | 'template'>, rate = 1): number {
  const words = s.narration.trim().split(/\s+/).length;
  const min = s.template === 'title' ? 4 : s.template === 'scene3d' ? 7 : 5;
  return Math.max(min, Math.round((words / (2.6 * rate) + 1.2) * 10) / 10);
}
