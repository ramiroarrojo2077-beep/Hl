// Repetición espaciada: variante del algoritmo SM-2 (Piotr Woźniak, SuperMemo 2, 1987).
//
// Cada tarjeta guarda: ease (factor de facilidad, inicia en 2.5, mínimo 1.3),
// interval (días hasta la próxima revisión), reps (aciertos consecutivos) y lapses.
// Tras cada repaso el estudiante califica su recuerdo con calidad q en 0..5:
//   q < 3  → fallo: reps = 0, interval = 1 día (la tarjeta vuelve mañana), lapses++.
//   q >= 3 → acierto: reps++; interval = 1 (1.º acierto), 6 (2.º) y luego
//            round(interval * ease). En "Difícil" (q=3) se multiplica por 1.2 en vez de ease.
// El ease se ajusta siempre: ease += 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02).
// En la interfaz: Otra vez = 1, Difícil = 3, Bien = 4, Fácil = 5 (Fácil agrega un 30% al intervalo).
//
// Retención estimada: suponemos que el intervalo se eligió para recordar ~90% al
// vencer, y que el olvido es exponencial: R(t) = 0.9^(t / interval). Es una
// estimación del modelo, no una medición; la tasa real de aciertos se calcula
// aparte a partir del historial de repasos.

import { addDays, startOfDay } from './format';

export interface SrsState {
  ease: number;
  interval: number;
  reps: number;
  lapses: number;
  due: number;
  lastReview?: number;
}

export const GRADE_BUTTONS = [
  { q: 1, label: 'Otra vez', key: '1' },
  { q: 3, label: 'Difícil', key: '2' },
  { q: 4, label: 'Bien', key: '3' },
  { q: 5, label: 'Fácil', key: '4' },
] as const;

export function initialSrs(now = Date.now()): SrsState {
  return { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: now };
}

export function review(state: SrsState, q: number, now = Date.now()): SrsState {
  const quality = Math.max(0, Math.min(5, Math.round(q)));
  let { ease, interval, reps, lapses } = state;
  ease = Math.max(1.3, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  if (quality < 3) {
    reps = 0;
    interval = 1;
    lapses += 1;
  } else {
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 6;
    else interval = Math.round(interval * (quality === 3 ? 1.2 : ease));
    if (quality === 5) interval = Math.round(interval * 1.3) || 1;
    interval = Math.max(1, Math.min(interval, 3650));
  }
  const due = startOfDay(addDays(now, interval)) + 4 * 3600_000; // disponible desde las 4 a.m.
  return { ease: Math.round(ease * 1000) / 1000, interval, reps, lapses, due, lastReview: now };
}

/** Intervalo resultante si se elige q (para mostrar en los botones). */
export function previewInterval(state: SrsState, q: number): number {
  return review(state, q).interval;
}

export function estimatedRetention(state: SrsState, now = Date.now()): number {
  if (!state.lastReview || state.interval <= 0) return 0;
  const elapsed = (now - state.lastReview) / 86_400_000;
  return Math.pow(0.9, elapsed / state.interval);
}

export function isDue(state: SrsState, now = Date.now()) {
  return state.due <= now;
}
