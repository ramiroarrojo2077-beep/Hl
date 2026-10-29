import type { Vec2, Vec3 } from "./types";

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const deg = (r: number) => (r * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;
export const round = (v: number, decimals = 3) => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};
export const roundVec3 = (v: readonly number[], decimals = 3): Vec3 => [
  round(v[0]!, decimals),
  round(v[1]!, decimals),
  round(v[2]!, decimals),
];
export const dist2 = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Rectángulo orientado en el plano XZ (centro, medias dimensiones, rotación Y). */
export interface Obb2 {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  rot: number;
}

/** Test de separación de ejes entre dos rectángulos orientados. */
export function obbOverlap(a: Obb2, b: Obb2, margin = 0): boolean {
  const axes = [a.rot, a.rot + Math.PI / 2, b.rot, b.rot + Math.PI / 2];
  for (const ang of axes) {
    const ax = Math.cos(ang);
    const az = -Math.sin(ang);
    const project = (o: Obb2) => {
      const c = o.cx * ax + o.cz * az;
      const ux = Math.cos(o.rot), uz = -Math.sin(o.rot);
      const vx = Math.sin(o.rot), vz = Math.cos(o.rot);
      const r = Math.abs(o.hx * (ux * ax + uz * az)) + Math.abs(o.hz * (vx * ax + vz * az));
      return [c - r, c + r] as const;
    };
    const [a0, a1] = project(a);
    const [b0, b1] = project(b);
    if (a1 + margin <= b0 || b1 + margin <= a0) return false;
  }
  return true;
}

export function pointInObb(x: number, z: number, o: Obb2, margin = 0): boolean {
  const dx = x - o.cx;
  const dz = z - o.cz;
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  // Rotación inversa alrededor de Y (convención three.js: x' = x cos + z sin).
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= o.hx + margin && Math.abs(lz) <= o.hz + margin;
}

/** Longitud total y acumulada de una polilínea. */
export function polylineLengths(points: readonly Vec2[], closed: boolean): { total: number; cumulative: number[] } {
  const cumulative = [0];
  let total = 0;
  const n = points.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    cumulative.push(total);
  }
  return { total, cumulative };
}

/** Punto y dirección a una distancia s sobre la polilínea. */
export function samplePolyline(
  points: readonly Vec2[],
  closed: boolean,
  lengths: { total: number; cumulative: number[] },
  s: number,
): { x: number; z: number; dx: number; dz: number } {
  const n = points.length;
  const { total, cumulative } = lengths;
  if (total <= 0) return { x: points[0]![0], z: points[0]![1], dx: 1, dz: 0 };
  let d = closed ? ((s % total) + total) % total : clamp(s, 0, total);
  // Búsqueda binaria del segmento.
  let lo = 0;
  let hi = cumulative.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cumulative[mid]! <= d) lo = mid;
    else hi = mid - 1;
  }
  const a = points[lo]!;
  const b = points[(lo + 1) % n]!;
  const segLen = cumulative[lo + 1]! - cumulative[lo]!;
  const t = segLen > 0 ? (d - cumulative[lo]!) / segLen : 0;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  return { x: a[0] + dx * t, z: a[1] + dz * t, dx: dx / len, dz: dz / len };
}

/** Redondea las esquinas de una polilínea con arcos (para rutas de vehículos). */
export function filletPolyline(points: readonly Vec2[], closed: boolean, radius: number, steps = 5): Vec2[] {
  const n = points.length;
  if (n < 3) return points.map((p) => [p[0], p[1]] as Vec2);
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const isEnd = !closed && (i === 0 || i === n - 1);
    if (isEnd) {
      out.push([p[0], p[1]]);
      continue;
    }
    const prev = points[(i - 1 + n) % n]!;
    const next = points[(i + 1) % n]!;
    const d1x = prev[0] - p[0], d1z = prev[1] - p[1];
    const d2x = next[0] - p[0], d2z = next[1] - p[1];
    const l1 = Math.hypot(d1x, d1z), l2 = Math.hypot(d2x, d2z);
    const cross = Math.abs(d1x * d2z - d1z * d2x) / (l1 * l2 || 1);
    if (cross < 0.05) {
      out.push([p[0], p[1]]);
      continue;
    }
    const r = Math.min(radius, l1 * 0.45, l2 * 0.45);
    const a: Vec2 = [p[0] + (d1x / l1) * r, p[1] + (d1z / l1) * r];
    const b: Vec2 = [p[0] + (d2x / l2) * r, p[1] + (d2z / l2) * r];
    // Curva de Bézier cuadrática con el vértice como control.
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * p[0] + t * t * b[0], u * u * a[1] + 2 * u * t * p[1] + t * t * b[1]]);
    }
  }
  return out;
}

/** Spline Catmull-Rom cerrada o abierta muestreada a paso aproximado. */
export function catmullRom(points: readonly Vec2[], closed: boolean, spacing: number): Vec2[] {
  const n = points.length;
  if (n < 2) return points.map((p) => [p[0], p[1]] as Vec2);
  const out: Vec2[] = [];
  const segs = closed ? n : n - 1;
  const get = (i: number) => (closed ? points[((i % n) + n) % n]! : points[clamp(i, 0, n - 1)]!);
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(2, Math.ceil(len / spacing));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  if (!closed) out.push([points[n - 1]![0], points[n - 1]![1]]);
  return out;
}
