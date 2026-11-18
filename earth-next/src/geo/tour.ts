/**
 * Recorridos de cámara: puntos clave, interpolación suave y generadores
 * (vuelo cinematográfico entre dos lugares, órbita alrededor de un punto, seguimiento de ruta).
 * Módulo puro: no depende de Cesium para poder probarse y reutilizarse.
 */
import type { LonLat } from "./coords.ts";
import { direct, haversine, slerpLonLat, sphericalBearing, toUnit, fromUnit, pathLength, inverse } from "./geodesy.ts";

export type Easing = "linear" | "ease-in-out" | "smooth";

export interface CameraPose {
  lon: number;
  lat: number;
  /** Altura elipsoidal de la cámara (m) */
  height: number;
  /** Rumbo (°, 0 = norte) */
  heading: number;
  /** Cabeceo (°, −90 = mirando hacia abajo) */
  pitch: number;
  roll: number;
}

export interface Keyframe extends CameraPose {
  id: string;
  /** Segundos para llegar a este punto desde el anterior (ignorado en el primero) */
  duration: number;
  /** Segundos de pausa en este punto */
  hold: number;
  easing: Easing;
  label?: string;
  /** Texto para el narrador (síntesis de voz) */
  narration?: string;
}

export interface Tour {
  id: string;
  name: string;
  keyframes: Keyframe[];
  createdAt: string;
  updatedAt: string;
}

let idCounter = 0;
export function newId(prefix = "k"): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function ease(kind: Easing, u: number): number {
  const t = Math.min(1, Math.max(0, u));
  switch (kind) {
    case "linear":
      return t;
    case "ease-in-out":
      return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    case "smooth":
      return -(Math.cos(Math.PI * t) - 1) / 2;
  }
}

/** Diferencia angular más corta b−a en grados (−180, 180]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

export function tourDuration(keyframes: Keyframe[]): number {
  let t = 0;
  keyframes.forEach((k, i) => {
    if (i > 0) t += Math.max(0, k.duration);
    t += Math.max(0, k.hold);
  });
  return t;
}

export interface TourSample {
  pose: CameraPose;
  /** Índice del punto clave de destino (o actual en pausa) */
  index: number;
  /** true mientras la cámara está detenida en un punto */
  holding: boolean;
}

/** Pose de la cámara en el segundo `t` del recorrido. */
export function sampleTour(keyframes: Keyframe[], t: number): TourSample | null {
  const n = keyframes.length;
  if (n === 0) return null;
  if (n === 1) return { pose: pick(keyframes[0]!), index: 0, holding: true };
  let clock = Math.max(0, t);
  // pausa inicial
  const first = keyframes[0]!;
  if (clock <= first.hold) return { pose: pick(first), index: 0, holding: true };
  clock -= first.hold;
  for (let i = 1; i < n; i++) {
    const k = keyframes[i]!;
    const dur = Math.max(0, k.duration);
    if (clock <= dur && dur > 0) {
      const u = ease(k.easing, clock / dur);
      return { pose: interpolate(keyframes, i - 1, u), index: i, holding: false };
    }
    clock -= dur;
    if (clock <= k.hold) return { pose: pick(k), index: i, holding: true };
    clock -= k.hold;
  }
  return { pose: pick(keyframes[n - 1]!), index: n - 1, holding: true };
}

function pick(k: CameraPose): CameraPose {
  return { lon: k.lon, lat: k.lat, height: k.height, heading: k.heading, pitch: k.pitch, roll: k.roll };
}

/** Interpola entre keyframes[i] y keyframes[i+1] con Catmull-Rom (continuidad C1). */
export function interpolate(kfs: CameraPose[], i: number, u: number): CameraPose {
  const k1 = kfs[i]!;
  const k2 = kfs[i + 1] ?? k1;
  const k0 = kfs[i - 1] ?? k1;
  const k3 = kfs[i + 2] ?? k2;
  // Posición: Catmull-Rom sobre vectores unitarios, luego normalización.
  const v = [toUnit(k0), toUnit(k1), toUnit(k2), toUnit(k3)];
  const angular = haversine(k1, k2, 1);
  let pos: LonLat;
  if (angular > 2.5) {
    pos = slerpLonLat(k1, k2, u); // tramos casi antípodas: gran círculo
  } else {
    pos = fromUnit([0, 1, 2].map((c) => catmullRom(v[0]![c]!, v[1]![c]!, v[2]![c]!, v[3]![c]!, u)) as [number, number, number]);
  }
  // Altura: interpolación en escala logarítmica (transiciones orbitales naturales).
  const lh = (h: number) => Math.log(Math.max(1, h));
  const height = Math.exp(catmullRom(lh(k0.height), lh(k1.height), lh(k2.height), lh(k3.height), u));
  // Ángulos: desenrollar respecto de k1 para tomar siempre el camino corto.
  const h1 = k1.heading;
  const h0 = h1 - angleDelta(k0.heading, h1);
  const h2 = h1 + angleDelta(h1, k2.heading);
  const h3 = h2 + angleDelta(k2.heading, k3.heading);
  const heading = (((catmullRom(h0, h1, h2, h3, u) % 360) + 360) % 360);
  const pitch = Math.max(-90, Math.min(90, catmullRom(k0.pitch, k1.pitch, k2.pitch, k3.pitch, u)));
  const roll = catmullRom(k0.roll, k1.roll, k2.roll, k3.roll, u);
  return { lon: pos.lon, lat: pos.lat, height, heading, pitch, roll };
}

function kf(p: CameraPose, duration: number, easing: Easing = "smooth", extra: Partial<Keyframe> = {}): Keyframe {
  return { id: newId(), ...p, duration, hold: 0, easing, ...extra };
}

export interface FlightOptions {
  /** Duración total en segundos (por defecto, según la distancia) */
  duration?: number;
  /** Altura final de la cámara sobre el destino (m) */
  arrivalHeight?: number;
  /** Cabeceo final (°) */
  arrivalPitch?: number;
  /** Número de puntos clave intermedios */
  samples?: number;
}

/** Duración sugerida para un vuelo según la distancia (s). */
export function suggestedFlightDuration(distanceMeters: number): number {
  return Math.min(22, Math.max(4, 3 + 3.2 * Math.log10(1 + distanceMeters / 1000)));
}

/**
 * Genera un vuelo cinematográfico: despegue, arco (orbital si la distancia es grande),
 * aproximación y llegada mirando el destino.
 */
export function flightBetween(from: CameraPose, to: LonLat, opts: FlightOptions = {}): Keyframe[] {
  const d = haversine(from, to);
  const total = opts.duration ?? suggestedFlightDuration(d);
  const arrivalHeight = opts.arrivalHeight ?? Math.max(400, Math.min(25000, d * 0.02 + 1500));
  const arrivalPitch = opts.arrivalPitch ?? -35;
  const samples = Math.max(3, opts.samples ?? 7);
  // Altura de crucero: proporcional a la distancia; > 1000 km sube a vista orbital.
  const peak = Math.max(from.height, arrivalHeight, Math.min(12_000_000, d * 0.55));
  // La cámara llega desplazada hacia atrás para encuadrar el destino con el cabeceo final.
  const backoff = arrivalHeight / Math.tan((Math.max(10, -arrivalPitch) * Math.PI) / 180);
  const approachBearing = d > 1 ? sphericalBearing(from, to) : from.heading;
  const end = direct(to, (approachBearing + 180) % 360, backoff);
  const keyframes: Keyframe[] = [kf(from, 0)];
  for (let s = 1; s <= samples; s++) {
    const u = s / (samples + 1);
    const pos = slerpLonLat(from, end, u);
    const bump = Math.sin(Math.PI * u);
    const base = Math.exp(Math.log(Math.max(1, from.height)) * (1 - u) + Math.log(arrivalHeight) * u);
    const height = Math.max(base, base + (peak - base) * bump);
    const toTarget = sphericalBearing(pos, to);
    const pitch = from.pitch * (1 - u) + arrivalPitch * u - (90 + Math.min(from.pitch, arrivalPitch)) * bump * (peak > 200_000 ? 0.9 : 0.4);
    keyframes.push(
      kf({ lon: pos.lon, lat: pos.lat, height, heading: toTarget, pitch: Math.max(-90, Math.min(-5, pitch)), roll: 0 }, total / (samples + 1), "linear"),
    );
  }
  keyframes.push(kf({ lon: end.lon, lat: end.lat, height: arrivalHeight, heading: approachBearing, pitch: arrivalPitch, roll: 0 }, total / (samples + 1), "linear"));
  // Suavizado global: primer y último tramo con aceleración/frenado.
  keyframes[1]!.easing = "ease-in-out";
  keyframes[keyframes.length - 1]!.easing = "smooth";
  return keyframes;
}

/** Órbita alrededor de un punto de interés. */
export function orbitAround(target: LonLat, opts: { radius: number; height: number; startBearing?: number; turns?: number; duration?: number; steps?: number }): Keyframe[] {
  const steps = opts.steps ?? 12;
  const turns = opts.turns ?? 1;
  const duration = opts.duration ?? 24;
  const start = opts.startBearing ?? 180;
  const pitch = -Math.atan2(opts.height, opts.radius) * (180 / Math.PI);
  const out: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const bearing = (start + (360 * turns * i) / steps) % 360;
    const p = direct(target, bearing, opts.radius);
    out.push(kf({ lon: p.lon, lat: p.lat, height: opts.height, heading: (bearing + 180) % 360, pitch, roll: 0 }, i === 0 ? 0 : duration / steps, "linear"));
  }
  return out;
}

/** Seguimiento de una ruta (polilínea) a una altura sobre el terreno dada, mirando hacia adelante. */
export function followRoute(route: (LonLat & { ground?: number })[], opts: { heightAboveGround: number; speed: number; pitch?: number; maxKeyframes?: number }): Keyframe[] {
  if (route.length < 2) return [];
  const total = pathLength(route);
  const max = opts.maxKeyframes ?? 40;
  const step = Math.max(total / max, 1);
  // Remuestreo a distancia constante.
  const pts: (LonLat & { ground: number })[] = [];
  let carry = 0;
  pts.push({ ...route[0]!, ground: route[0]!.ground ?? 0 });
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    const inv = inverse(a, b);
    let pos = step - carry;
    while (pos <= inv.distance) {
      const p = direct(a, inv.initialBearing, pos);
      const t = inv.distance > 0 ? pos / inv.distance : 0;
      pts.push({ ...p, ground: (a.ground ?? 0) * (1 - t) + (b.ground ?? 0) * t });
      pos += step;
    }
    carry = inv.distance - (pos - step);
  }
  const last = route[route.length - 1]!;
  pts.push({ ...last, ground: last.ground ?? 0 });
  const pitch = opts.pitch ?? -20;
  return pts.map((p, i) => {
    const next = pts[Math.min(pts.length - 1, i + 1)]!;
    const prev = pts[Math.max(0, i - 1)]!;
    const heading = i < pts.length - 1 ? sphericalBearing(p, next) : sphericalBearing(prev, p);
    const dist = i === 0 ? 0 : haversine(prev, p);
    return kf({ lon: p.lon, lat: p.lat, height: p.ground + opts.heightAboveGround, heading, pitch, roll: 0 }, i === 0 ? 0 : dist / Math.max(1, opts.speed), "linear");
  });
}
