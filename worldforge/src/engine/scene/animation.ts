import type { Keyframe, Track } from "../types";

/** Interpola una pista de keyframes en el tiempo t. */
export function sampleTrack(track: Track, t: number): number[] | null {
  const keys = [...track.keys].sort((a, b) => a.t - b.t);
  if (!keys.length) return null;
  if (t <= keys[0]!.t) return [...keys[0]!.value];
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return [...last.value];
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1]!.t < t) i++;
  const a = keys[i]!, b = keys[i + 1]!;
  return interpolate(a, b, (t - a.t) / Math.max(1e-6, b.t - a.t));
}

function interpolate(a: Keyframe, b: Keyframe, u: number): number[] {
  if (a.ease === "step") return [...a.value];
  const s = a.ease === "smooth" ? u * u * (3 - 2 * u) : u;
  return a.value.map((v, k) => v + ((b.value[k] ?? v) - v) * s);
}

/** Inserta o reemplaza un keyframe en el instante t (mantiene orden). */
export function upsertKey(keys: Keyframe[], key: Keyframe): Keyframe[] {
  const out = keys.filter((k) => Math.abs(k.t - key.t) > 1e-3);
  out.push(key);
  return out.sort((a, b) => a.t - b.t);
}
