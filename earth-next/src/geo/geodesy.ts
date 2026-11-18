/**
 * Geodesia sobre el elipsoide WGS84.
 * - Distancias y rumbos: Vincenty (inverso/directo) con respaldo esférico cuando
 *   el método iterativo no converge (puntos casi antípodas).
 * - Áreas: exceso esférico sobre la esfera autálica (latitudes autálicas).
 */
import type { LonLat } from "./coords.ts";

export const WGS84 = {
  a: 6378137,
  f: 1 / 298.257223563,
  get b() {
    return this.a * (1 - this.f);
  },
};

/** Radio de la esfera autálica (misma superficie que el elipsoide). */
export const AUTHALIC_RADIUS = 6371007.181;
export const MEAN_RADIUS = 6371008.8;

const DEG = Math.PI / 180;

export interface InverseResult {
  distance: number; // metros
  initialBearing: number; // grados [0,360)
  finalBearing: number;
  method: "vincenty" | "spherical";
}

export function haversine(a: LonLat, b: LonLat, radius = MEAN_RADIUS): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(s)));
}

function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function sphericalBearing(a: LonLat, b: LonLat): number {
  const φ1 = a.lat * DEG;
  const φ2 = b.lat * DEG;
  const Δλ = (b.lon - a.lon) * DEG;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return wrap360(Math.atan2(y, x) / DEG);
}

export function inverse(p1: LonLat, p2: LonLat): InverseResult {
  const { a, f } = WGS84;
  const b = WGS84.b;
  const L = (p2.lon - p1.lon) * DEG;
  const U1 = Math.atan((1 - f) * Math.tan(p1.lat * DEG));
  const U2 = Math.atan((1 - f) * Math.tan(p2.lat * DEG));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);

  let λ = L;
  let sinλ = 0;
  let cosλ = 0;
  let sinσ = 0;
  let cosσ = 0;
  let σ = 0;
  let cos2α = 0;
  let cos2σm = 0;
  let iter = 0;
  let λPrev: number;
  do {
    sinλ = Math.sin(λ);
    cosλ = Math.cos(λ);
    const t1 = cosU2 * sinλ;
    const t2 = cosU1 * sinU2 - sinU1 * cosU2 * cosλ;
    sinσ = Math.sqrt(t1 * t1 + t2 * t2);
    if (sinσ === 0) {
      return { distance: 0, initialBearing: 0, finalBearing: 0, method: "vincenty" };
    }
    cosσ = sinU1 * sinU2 + cosU1 * cosU2 * cosλ;
    σ = Math.atan2(sinσ, cosσ);
    const sinα = (cosU1 * cosU2 * sinλ) / sinσ;
    cos2α = 1 - sinα * sinα;
    cos2σm = cos2α !== 0 ? cosσ - (2 * sinU1 * sinU2) / cos2α : 0;
    const C = (f / 16) * cos2α * (4 + f * (4 - 3 * cos2α));
    λPrev = λ;
    λ = L + (1 - C) * f * sinα * (σ + C * sinσ * (cos2σm + C * cosσ * (-1 + 2 * cos2σm * cos2σm)));
    if (Math.abs(λ) > Math.PI * 1.5) break;
  } while (Math.abs(λ - λPrev) > 1e-12 && ++iter < 200);

  if (iter >= 200 || Math.abs(λ) > Math.PI * 1.5) {
    // Sin convergencia (casi antípodas): respaldo esférico, error < 0.5 %.
    const d = haversine(p1, p2, AUTHALIC_RADIUS);
    const br = sphericalBearing(p1, p2);
    return { distance: d, initialBearing: br, finalBearing: wrap360(sphericalBearing(p2, p1) + 180), method: "spherical" };
  }

  const uSq = (cos2α * (a * a - b * b)) / (b * b);
  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const Δσ =
    B *
    sinσ *
    (cos2σm + (B / 4) * (cosσ * (-1 + 2 * cos2σm * cos2σm) - (B / 6) * cos2σm * (-3 + 4 * sinσ * sinσ) * (-3 + 4 * cos2σm * cos2σm)));
  const distance = b * A * (σ - Δσ);
  const α1 = Math.atan2(cosU2 * sinλ, cosU1 * sinU2 - sinU1 * cosU2 * cosλ);
  const α2 = Math.atan2(cosU1 * sinλ, -sinU1 * cosU2 + cosU1 * sinU2 * cosλ);
  return { distance, initialBearing: wrap360(α1 / DEG), finalBearing: wrap360(α2 / DEG), method: "vincenty" };
}

export function distance(p1: LonLat, p2: LonLat): number {
  return inverse(p1, p2).distance;
}

/** Problema directo de Vincenty: punto a `dist` metros desde `p` con rumbo `bearingDeg`. */
export function direct(p: LonLat, bearingDeg: number, dist: number): LonLat {
  const { a, f } = WGS84;
  const b = WGS84.b;
  const α1 = bearingDeg * DEG;
  const sinα1 = Math.sin(α1);
  const cosα1 = Math.cos(α1);
  const tanU1 = (1 - f) * Math.tan(p.lat * DEG);
  const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1);
  const sinU1 = tanU1 * cosU1;
  const σ1 = Math.atan2(tanU1, cosα1);
  const sinα = cosU1 * sinα1;
  const cos2α = 1 - sinα * sinα;
  const uSq = (cos2α * (a * a - b * b)) / (b * b);
  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  let σ = dist / (b * A);
  let σPrev: number;
  let cos2σm = 0;
  let sinσ = 0;
  let cosσ = 0;
  let iter = 0;
  do {
    cos2σm = Math.cos(2 * σ1 + σ);
    sinσ = Math.sin(σ);
    cosσ = Math.cos(σ);
    const Δσ =
      B *
      sinσ *
      (cos2σm + (B / 4) * (cosσ * (-1 + 2 * cos2σm * cos2σm) - (B / 6) * cos2σm * (-3 + 4 * sinσ * sinσ) * (-3 + 4 * cos2σm * cos2σm)));
    σPrev = σ;
    σ = dist / (b * A) + Δσ;
  } while (Math.abs(σ - σPrev) > 1e-12 && ++iter < 100);
  const x = sinU1 * sinσ - cosU1 * cosσ * cosα1;
  const φ2 = Math.atan2(sinU1 * cosσ + cosU1 * sinσ * cosα1, (1 - f) * Math.sqrt(sinα * sinα + x * x));
  const λ = Math.atan2(sinσ * sinα1, cosU1 * cosσ - sinU1 * sinσ * cosα1);
  const C = (f / 16) * cos2α * (4 + f * (4 - 3 * cos2α));
  const L = λ - (1 - C) * f * sinα * (σ + C * sinσ * (cos2σm + C * cosσ * (-1 + 2 * cos2σm * cos2σm)));
  let lon = p.lon + L / DEG;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lat: φ2 / DEG, lon };
}

/** Puntos equiespaciados sobre la geodésica entre a y b (incluye extremos). */
export function interpolateGeodesic(a: LonLat, b: LonLat, count: number): LonLat[] {
  const n = Math.max(2, Math.floor(count));
  const inv = inverse(a, b);
  const out: LonLat[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    if (i === 0) out.push({ ...a });
    else if (i === n - 1) out.push({ ...b });
    else if (inv.method === "vincenty") out.push(direct(a, inv.initialBearing, inv.distance * t));
    else out.push(slerpLonLat(a, b, t));
  }
  return out;
}

/** Interpolación esférica (gran círculo) entre dos puntos, t ∈ [0,1]. */
export function slerpLonLat(a: LonLat, b: LonLat, t: number): LonLat {
  const va = toUnit(a);
  const vb = toUnit(b);
  const dot = Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const ω = Math.acos(dot);
  if (ω < 1e-12) return { ...a };
  const s = Math.sin(ω);
  const k1 = Math.sin((1 - t) * ω) / s;
  const k2 = Math.sin(t * ω) / s;
  return fromUnit([k1 * va[0] + k2 * vb[0], k1 * va[1] + k2 * vb[1], k1 * va[2] + k2 * vb[2]]);
}

export function toUnit(p: LonLat): [number, number, number] {
  const φ = p.lat * DEG;
  const λ = p.lon * DEG;
  return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
}

export function fromUnit(v: [number, number, number]): LonLat {
  const r = Math.hypot(v[0], v[1], v[2]);
  return { lat: Math.asin(v[2] / r) / DEG, lon: Math.atan2(v[1], v[0]) / DEG };
}

/** Longitud de una polilínea geodésica. */
export function pathLength(points: LonLat[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1]!, points[i]!);
  return total;
}

/**
 * Área de un polígono simple (anillo exterior) en m², por exceso esférico sobre la
 * esfera autálica con latitudes autálicas (preserva el área del elipsoide WGS84).
 * Los lados se interpretan como arcos de gran círculo.
 */
export function polygonArea(ring: LonLat[]): number {
  const pts = stripClosing(ring);
  if (pts.length < 3) return 0;
  return Math.abs(sphericalExcessArea(pts));
}

function stripClosing(ring: LonLat[]): LonLat[] {
  if (ring.length > 1) {
    const f = ring[0]!;
    const l = ring[ring.length - 1]!;
    if (f.lat === l.lat && f.lon === l.lon) return ring.slice(0, -1);
  }
  return ring;
}

/**
 * Área por exceso esférico sobre la esfera autálica, con latitudes convertidas a
 * latitud autálica para preservar el área del elipsoide.
 */
function sphericalExcessArea(pts: LonLat[]): number {
  const e2 = WGS84.f * (2 - WGS84.f);
  const e = Math.sqrt(e2);
  const qp = 1 - ((1 - e2) / (2 * e)) * Math.log((1 - e) / (1 + e));
  const authalic = (latDeg: number) => {
    const s = Math.sin(latDeg * DEG);
    const q = (1 - e2) * (s / (1 - e2 * s * s) - (1 / (2 * e)) * Math.log((1 - e * s) / (1 + e * s)));
    return Math.asin(Math.max(-1, Math.min(1, q / qp)));
  };
  // Fórmula de L'Huilier por segmentos (trapecios esféricos) — estable para áreas chicas.
  let total = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    let dλ = (p2.lon - p1.lon) * DEG;
    if (dλ > Math.PI) dλ -= 2 * Math.PI;
    if (dλ < -Math.PI) dλ += 2 * Math.PI;
    const β1 = authalic(p1.lat);
    const β2 = authalic(p2.lat);
    total += 2 * Math.atan2(Math.tan(dλ / 2) * (Math.tan(β1 / 2) + Math.tan(β2 / 2)), 1 + Math.tan(β1 / 2) * Math.tan(β2 / 2));
  }
  return total * AUTHALIC_RADIUS * AUTHALIC_RADIUS;
}

/** Perímetro de un anillo (cerrándolo). */
export function ringPerimeter(ring: LonLat[]): number {
  const pts = stripClosing(ring);
  if (pts.length < 2) return 0;
  return pathLength([...pts, pts[0]!]);
}

/** Centroide aproximado (media de vectores unitarios) — útil para etiquetas. */
export function centroid(points: LonLat[]): LonLat {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    const v = toUnit(p);
    x += v[0];
    y += v[1];
    z += v[2];
  }
  return fromUnit([x, y, z]);
}

/** Punto en polígono (lon/lat planos; válido para polígonos que no cruzan el antimeridiano). */
export function pointInRing(p: LonLat, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.lat > p.lat !== b.lat > p.lat && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}
