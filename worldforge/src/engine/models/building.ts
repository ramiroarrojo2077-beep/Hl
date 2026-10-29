import type { BufferGeometry } from "three";
import { Rng } from "../rng";
import type { BuildingProps, MaterialPreset } from "../types";
import { MeshBuilder } from "./builder";

/**
 * Generador de geometría de edificios a partir de parámetros. Produce una
 * geometría por "parte" (paredes, ventanas, techo, molduras, neón...) y cajas
 * de colisión en espacio local. El frente del edificio mira a +Z.
 */

export type BuildingPart = "wall" | "roof" | "trim" | "winLit" | "winDark" | "neon" | "detail" | "door";

export interface ColliderBox {
  center: [number, number, number];
  size: [number, number, number];
}

export interface BuildingModel {
  parts: Map<BuildingPart, BufferGeometry>;
  colliders: ColliderBox[];
  height: number;
}

export function roofPreset(p: BuildingProps): MaterialPreset {
  switch (p.roof) {
    case "thatch":
      return "thatch";
    case "dome":
      return p.style === "scifi" ? "metal" : "glass";
    case "flat":
    case "crenellated":
      return p.wall === "stone" ? "stone" : "concrete";
    case "spire":
      return p.style === "futuristic" || p.style === "scifi" ? "metal" : "tiles";
    default:
      return p.style === "futuristic" || p.style === "scifi" ? "metal" : "tiles";
  }
}

export function trimPreset(p: BuildingProps): MaterialPreset {
  if (p.style === "medieval" || p.style === "tropical" || p.wall === "timber") return "wood";
  if (p.style === "futuristic" || p.style === "scifi") return "metal";
  return "plaster";
}

const cache = new Map<string, BuildingModel>();
const MAX_CACHE = 600;

export function buildingKey(p: BuildingProps): string {
  return [p.kind, p.style, p.shape, p.width, p.depth, p.floors, p.floorHeight, p.roof, p.windows, p.balconies, p.neon, p.seed, p.wall].join("|");
}

export function getBuildingModel(p: BuildingProps): BuildingModel {
  const key = buildingKey(p);
  const hit = cache.get(key);
  if (hit) return hit;
  const model = buildBuilding(p);
  if (cache.size > MAX_CACHE) {
    const first = cache.keys().next().value;
    if (first !== undefined) {
      cache.get(first)?.parts.forEach((g) => g.dispose());
      cache.delete(first);
    }
  }
  cache.set(key, model);
  return model;
}

export function buildBuilding(p: BuildingProps): BuildingModel {
  const b = new MeshBuilder();
  const rng = new Rng(p.seed);
  const colliders: ColliderBox[] = [];
  let height: number;
  switch (p.kind) {
    case "castle":
      height = buildCastle(b, p, rng, colliders);
      break;
    case "grandstand":
      height = buildGrandstand(b, p, colliders);
      break;
    case "stadium":
      height = buildStadium(b, p, colliders);
      break;
    case "pit":
      height = buildPit(b, p, rng, colliders);
      break;
    case "dome":
      height = buildDome(b, p, rng, colliders);
      break;
    case "hut":
      height = buildHut(b, p, colliders);
      break;
    case "temple":
      height = p.roof === "pagoda" ? buildPagoda(b, p, colliders) : buildGeneric(b, p, rng, colliders);
      break;
    default:
      height = buildGeneric(b, p, rng, colliders);
  }
  return { parts: b.buildParts() as Map<BuildingPart, BufferGeometry>, colliders, height };
}

// ---------------------------------------------------------------------------
// Edificio genérico (casas, departamentos, oficinas, rascacielos...)
// ---------------------------------------------------------------------------

function buildGeneric(b: MeshBuilder, p: BuildingProps, rng: Rng, colliders: ColliderBox[]): number {
  const { width: w, depth: d, floorHeight: fh } = p;
  const floors = p.floors;
  const H = floors * fh;
  // Cimiento: evita huecos en terreno irregular.
  b.box("trim", 0, -0.9, 0, w + 0.3, 2.2, d + 0.3, { bottom: false });

  if (p.shape === "cylinder") {
    const r = Math.min(w, d) / 2;
    b.cylinder("wall", 0, H / 2, 0, r, r, H, 28, { bottom: false });
    for (let f = 0; f < floors; f++) {
      const key = rng.chance(litRatio(p)) ? "winLit" : "winDark";
      b.cylinder(key, 0, f * fh + fh * 0.55, 0, r + 0.03, r + 0.03, fh * 0.45, 28, { top: false, bottom: false });
    }
    if (p.neon) {
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        b.box("neon", Math.sin(a) * (r + 0.08), H / 2, Math.cos(a) * (r + 0.08), 0.18, H, 0.18);
      }
      b.cylinder("neon", 0, H + 0.1, 0, r + 0.1, r + 0.1, 0.25, 28);
    }
    colliders.push({ center: [0, H / 2, 0], size: [r * 1.8, H, r * 1.8] });
    return H + roofOnCylinder(b, p, r, H);
  }

  if (p.shape === "tiered" && floors >= 8) {
    // Torre escalonada: base, cuerpo y remate.
    const tiers = [
      { f: Math.ceil(floors * 0.45), s: 1 },
      { f: Math.ceil(floors * 0.35), s: 0.78 },
      { f: floors - Math.ceil(floors * 0.45) - Math.ceil(floors * 0.35), s: 0.56 },
    ].filter((t) => t.f > 0);
    let y = 0;
    for (const t of tiers) {
      const tw = w * t.s, td = d * t.s, th = t.f * fh;
      b.box("wall", 0, y + th / 2, 0, tw, th, td, { bottom: false });
      facadeWindows(b, p, rng, tw, td, y, t.f, fh);
      if (p.neon) neonEdges(b, tw, td, y, th);
      b.box("trim", 0, y + th + 0.15, 0, tw + 0.4, 0.3, td + 0.4);
      colliders.push({ center: [0, y + th / 2, 0], size: [tw, th, td] });
      y += th;
    }
    return y + roofOnBox(b, p, rng, w * tiers[tiers.length - 1]!.s, d * tiers[tiers.length - 1]!.s, y);
  }

  b.box("wall", 0, H / 2, 0, w, H, d, { bottom: false });
  colliders.push({ center: [0, H / 2, 0], size: [w, H, d] });

  // Entramado de madera (medieval): vigas en esquinas y entre pisos.
  if (p.wall === "timber") {
    for (const [x, z] of [[w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]] as const) b.box("trim", x, H / 2, z, 0.35, H, 0.35);
    for (let f = 1; f <= floors; f++) {
      b.box("trim", 0, f * fh - 0.15, d / 2 + 0.05, w + 0.1, 0.3, 0.12);
      b.box("trim", 0, f * fh - 0.15, -d / 2 - 0.05, w + 0.1, 0.3, 0.12);
      b.box("trim", w / 2 + 0.05, f * fh - 0.15, 0, 0.12, 0.3, d + 0.1);
      b.box("trim", -w / 2 - 0.05, f * fh - 0.15, 0, 0.12, 0.3, d + 0.1);
    }
    for (const s of [-1, 1]) {
      b.box("trim", s * w * 0.25, H / 2, d / 2 + 0.06, 0.25, H, 0.1);
      b.box("trim", s * w * 0.25, H / 2, -d / 2 - 0.06, 0.25, H, 0.1);
    }
  }

  // Cornisas entre pisos (edificios clásicos y de departamentos).
  if ((p.kind === "apartment" || p.style === "classic") && floors <= 16 && p.windows !== "curtain") {
    for (let f = 1; f < floors; f++) b.box("trim", 0, f * fh, 0, w + 0.24, 0.18, d + 0.24);
  }

  facadeWindows(b, p, rng, w, d, 0, floors, fh);
  if (p.neon) neonEdges(b, w, d, 0, H);

  // Puerta de entrada con marquesina.
  const doorW = p.kind === "house" || p.kind === "hut" ? 1.1 : Math.min(3, w * 0.25);
  const doorH = Math.min(2.4, fh * 0.8);
  b.box("door", 0, doorH / 2, d / 2 + 0.04, doorW, doorH, 0.1);
  if (p.kind !== "house") b.box("trim", 0, doorH + 0.25, d / 2 + 0.8, doorW + 1.6, 0.15, 1.6);
  else b.box("trim", 0, 0.1, d / 2 + 0.6, doorW + 0.8, 0.2, 1.2);

  // Balcones.
  if (p.balconies && floors > 1) {
    const cols = Math.max(1, Math.floor(w / 5));
    for (let f = 1; f < floors; f++) {
      for (let c = 0; c < cols; c++) {
        const x = -w / 2 + (w / cols) * (c + 0.5);
        b.box("trim", x, f * fh + 0.1, d / 2 + 0.6, 2.6, 0.18, 1.2);
        b.box("detail", x, f * fh + 0.6, d / 2 + 1.18, 2.6, 0.9, 0.05);
      }
    }
  }

  // Cartel de hospital / tienda.
  if (p.kind === "hospital") {
    b.box("neon", 0, H - fh * 0.5, d / 2 + 0.1, 2.4, 0.7, 0.12);
    b.box("neon", 0, H - fh * 0.5, d / 2 + 0.1, 0.7, 2.4, 0.12);
  }
  if ((p.kind === "shop" || p.windows === "storefront") && p.style !== "medieval") {
    b.box("neon", 0, Math.min(fh * 0.92, H - 0.4), d / 2 + 0.12, Math.min(w * 0.7, 6), 0.55, 0.12);
  }
  if (p.style === "japanese" && p.neon) {
    const sx = w / 2 - 0.6;
    b.box("neon", sx, Math.min(H * 0.6, 12), d / 2 + 0.5, 0.25, Math.min(H * 0.6, 9), 0.9);
  }

  // Chimenea.
  if (p.kind === "house" && p.roof !== "flat") b.box("wall", w * 0.25, H + Math.min(w, d) * 0.35, -d * 0.15, 0.7, Math.min(w, d) * 0.6, 0.7);

  return H + roofOnBox(b, p, rng, w, d, H);
}

function litRatio(p: BuildingProps): number {
  if (p.kind === "office" || p.kind === "skyscraper" || p.kind === "futuristic") return 0.5;
  return 0.38;
}

/** Ventanas en las cuatro fachadas de un volumen rectangular. */
function facadeWindows(b: MeshBuilder, p: BuildingProps, rng: Rng, w: number, d: number, y0: number, floors: number, fh: number) {
  if (p.windows === "none") return;
  const faces: [number, number, number][] = [
    [0, w, d / 2],
    [Math.PI / 2, d, w / 2],
    [Math.PI, w, d / 2],
    [-Math.PI / 2, d, w / 2],
  ];
  const e = 0.03;
  const lit = litRatio(p);
  for (const [rot, fw, off] of faces) {
    b.translateRotate(0, 0, 0, rot, () => {
      const isFront = rot === 0;
      for (let f = 0; f < floors; f++) {
        const fy = y0 + f * fh;
        // Planta baja comercial.
        if (f === 0 && y0 === 0 && (p.windows === "storefront" || p.kind === "shop" || p.kind === "mall") && fw > 4) {
          const sw = fw - 1.2;
          const key = rng.chance(0.7) ? "winLit" : "winDark";
          const x0 = -sw / 2, x1 = sw / 2;
          if (isFront) {
            const doorHalf = Math.min(1.5, fw * 0.125) + 0.3;
            b.quad(key, [x0, fy + 0.4, off + e], [-doorHalf, fy + 0.4, off + e], [-doorHalf, fy + fh * 0.75, off + e], [x0, fy + fh * 0.75, off + e]);
            b.quad(key, [doorHalf, fy + 0.4, off + e], [x1, fy + 0.4, off + e], [x1, fy + fh * 0.75, off + e], [doorHalf, fy + fh * 0.75, off + e]);
          } else b.quad(key, [x0, fy + 0.5, off + e], [x1, fy + 0.5, off + e], [x1, fy + fh * 0.72, off + e], [x0, fy + fh * 0.72, off + e]);
          continue;
        }
        if (p.windows === "bands" || p.windows === "curtain") {
          const key = rng.chance(lit) ? "winLit" : "winDark";
          const bh = p.windows === "curtain" ? fh * 0.62 : fh * 0.45;
          const by = fy + (fh - bh) / 2 + (p.windows === "curtain" ? 0 : 0.1);
          const x0 = -fw / 2 + 0.4, x1 = fw / 2 - 0.4;
          if (p.windows === "curtain") {
            // Ventanas individuales encendidas sobre el muro cortina + parteluces.
            const cols = Math.max(1, Math.round(fw / 3));
            for (let c = 0; c < cols; c++) {
              const k = rng.chance(lit) ? "winLit" : "winDark";
              const cx0 = -fw / 2 + (fw / cols) * c + 0.15, cx1 = -fw / 2 + (fw / cols) * (c + 1) - 0.15;
              b.quad(k, [cx0, by, off + e], [cx1, by, off + e], [cx1, by + bh, off + e], [cx0, by + bh, off + e]);
            }
            b.box("trim", 0, fy + fh - 0.06, off + 0.06, fw, 0.12, 0.12);
          } else {
            b.quad(key, [x0, by, off + e], [x1, by, off + e], [x1, by + bh, off + e], [x0, by + bh, off + e]);
          }
          continue;
        }
        // Ventanas individuales.
        const spacing = p.windows === "sparse" ? 3.4 : p.windows === "arched" ? 3 : 2.8;
        const cols = Math.max(1, Math.floor((fw - 1) / spacing));
        const ww = p.windows === "arched" ? 0.9 : p.kind === "house" ? 1.1 : 1.3;
        const wh = p.windows === "arched" ? fh * 0.55 : fh * 0.48;
        for (let c = 0; c < cols; c++) {
          const cx = -fw / 2 + (fw / cols) * (c + 0.5);
          if (isFront && f === 0 && Math.abs(cx) < 1.8) continue; // lugar de la puerta
          const key = rng.chance(lit) ? "winLit" : "winDark";
          const wy = fy + fh * 0.32;
          b.quad(key, [cx - ww / 2, wy, off + e], [cx + ww / 2, wy, off + e], [cx + ww / 2, wy + wh, off + e], [cx - ww / 2, wy + wh, off + e]);
          if (p.windows === "arched") b.tri(key, [cx - ww / 2, wy + wh, off + e], [cx + ww / 2, wy + wh, off + e], [cx, wy + wh + ww * 0.45, off + e]);
          if (p.kind !== "skyscraper" && floors <= 12) b.box("trim", cx, wy - 0.06, off + 0.08, ww + 0.25, 0.1, 0.16);
        }
      }
    });
  }
}

function neonEdges(b: MeshBuilder, w: number, d: number, y0: number, h: number) {
  for (const [x, z] of [[w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]] as const) b.box("neon", x, y0 + h / 2, z, 0.16, h, 0.16);
  b.box("neon", 0, y0 + h - 0.1, d / 2 + 0.05, w, 0.14, 0.08);
}

function roofOnBox(b: MeshBuilder, p: BuildingProps, rng: Rng, w: number, d: number, H: number): number {
  const steep = p.style === "medieval" ? 0.55 : p.style === "tropical" ? 0.6 : 0.36;
  switch (p.roof) {
    case "gable": {
      const h = Math.min(w, d) * steep;
      b.gable("roof", "wall", 0, H, 0, w, d, h, 0.45);
      return h;
    }
    case "hip": {
      const h = Math.min(w, d) * steep * 0.85;
      b.pyramid("roof", 0, H, 0, w + 0.8, d + 0.8, h, Math.abs(w - d) / 2);
      return h;
    }
    case "thatch": {
      const h = Math.min(w, d) * 0.65;
      b.pyramid("roof", 0, H - 0.2, 0, w + 1.2, d + 1.2, h, Math.abs(w - d) / 2);
      return h;
    }
    case "spire": {
      const h = Math.max(6, Math.min(w, d) * 1.1);
      b.pyramid("roof", 0, H, 0, w * 0.7, d * 0.7, h);
      b.cylinder("detail", 0, H + h + 3, 0, 0.12, 0.2, 6, 6);
      return h + 6;
    }
    case "dome": {
      const r = Math.min(w, d) * 0.45;
      b.cylinder("trim", 0, H + 0.4, 0, r + 0.3, r + 0.3, 0.8, 24);
      b.dome("roof", 0, H + 0.8, 0, r);
      return r + 0.8;
    }
    case "crenellated": {
      crenellations(b, w, d, H, 1.1, "wall");
      return 1.1;
    }
    case "pagoda": {
      b.pyramid("roof", 0, H, 0, w + 2.4, d + 2.4, Math.min(w, d) * 0.4);
      return Math.min(w, d) * 0.4;
    }
    default: {
      // Techo plano con parapeto y equipos.
      const par = 0.9;
      b.box("trim", 0, H + par / 2, d / 2 - 0.15, w, par, 0.3);
      b.box("trim", 0, H + par / 2, -d / 2 + 0.15, w, par, 0.3);
      b.box("trim", w / 2 - 0.15, H + par / 2, 0, 0.3, par, d - 0.6);
      b.box("trim", -w / 2 + 0.15, H + par / 2, 0, 0.3, par, d - 0.6);
      b.box("roof", 0, H + 0.05, 0, w - 0.6, 0.1, d - 0.6);
      const units = Math.min(4, Math.max(1, Math.floor((w * d) / 120)));
      for (let k = 0; k < units; k++) {
        const ux = rng.range(-w / 2 + 2.5, w / 2 - 2.5);
        const uz = rng.range(-d / 2 + 2.5, d / 2 - 2.5);
        const s = rng.range(1.5, Math.min(4, w / 4));
        b.box("detail", ux, H + s * 0.4, uz, s, s * 0.8, s * 0.7);
      }
      if (p.kind === "skyscraper" || p.kind === "futuristic" || p.kind === "office") {
        b.box("wall", 0, H + 2, 0, w * 0.4, 4, d * 0.4);
        if (p.floors > 25) b.cylinder("detail", w * 0.1, H + 4 + 5, -d * 0.1, 0.12, 0.25, 10, 6);
        return 4;
      }
      if ((p.style === "modern" || p.style === "classic") && p.floors >= 4 && rng.chance(0.5)) {
        b.cylinder("detail", -w / 4, H + 3, d / 5, 1.2, 1.2, 2.4, 10);
        for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [0.8, 0.8], [-0.8, 0.8]] as const) b.box("detail", -w / 4 + x, H + 1, d / 5 + z, 0.12, 2, 0.12);
      }
      return par;
    }
  }
}

function roofOnCylinder(b: MeshBuilder, p: BuildingProps, r: number, H: number): number {
  if (p.roof === "spire") {
    const h = Math.max(6, r * 1.8);
    b.cylinder("roof", 0, H + h / 2, 0, 0, r * 1.05, h, 20);
    return h;
  }
  if (p.roof === "dome") {
    b.dome("roof", 0, H, 0, r);
    return r;
  }
  if (p.roof === "crenellated") {
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      b.box("wall", Math.sin(a) * (r - 0.3), H + 0.6, Math.cos(a) * (r - 0.3), 0.9, 1.2, 0.6);
    }
    return 1.2;
  }
  b.cylinder("trim", 0, H + 0.4, 0, r + 0.2, r + 0.2, 0.8, 28);
  if (p.style === "futuristic" || p.style === "scifi") {
    b.cylinder("detail", 0, H + 6, 0, 0.15, 0.3, 11, 6);
    return 11;
  }
  return 0.8;
}

function crenellations(b: MeshBuilder, w: number, d: number, H: number, h: number, key: string) {
  const step = 1.6;
  for (const [rot, len, off] of [
    [0, w, d / 2],
    [Math.PI / 2, d, w / 2],
    [Math.PI, w, d / 2],
    [-Math.PI / 2, d, w / 2],
  ] as const) {
    b.translateRotate(0, 0, 0, rot, () => {
      b.box(key, 0, H + h * 0.25, off - 0.4, len, h * 0.5, 0.8);
      const n = Math.floor(len / step);
      for (let k = 0; k < n; k += 2) b.box(key, -len / 2 + step * (k + 0.5), H + h * 0.75, off - 0.4, step, h * 0.5, 0.8);
    });
  }
}

// ---------------------------------------------------------------------------
// Construcciones especiales
// ---------------------------------------------------------------------------

function buildCastle(b: MeshBuilder, p: BuildingProps, rng: Rng, colliders: ColliderBox[]): number {
  const s = Math.min(p.width, p.depth);
  const half = s / 2;
  const wallH = 9;
  const t = 2.4;
  b.box("wall", 0, -1, 0, s + 2, 2.4, s + 2, { bottom: false });
  // Murallas con hueco para el portón en el frente.
  const gateW = 6;
  const segW = (s - gateW) / 2;
  b.box("wall", -(gateW / 2 + segW / 2), wallH / 2, half, segW, wallH, t);
  b.box("wall", gateW / 2 + segW / 2, wallH / 2, half, segW, wallH, t);
  b.box("wall", 0, wallH - 1.5, half, gateW, 3, t);
  b.box("door", 0, 3.2, half + t / 2 + 0.02, gateW - 1, 6.4, 0.2);
  b.box("wall", 0, wallH / 2, -half, s, wallH, t);
  b.box("wall", half, wallH / 2, 0, t, wallH, s);
  b.box("wall", -half, wallH / 2, 0, t, wallH, s);
  colliders.push(
    { center: [-(gateW / 2 + segW / 2), wallH / 2, half], size: [segW, wallH, t] },
    { center: [gateW / 2 + segW / 2, wallH / 2, half], size: [segW, wallH, t] },
    { center: [0, wallH / 2, -half], size: [s, wallH, t] },
    { center: [half, wallH / 2, 0], size: [t, wallH, s] },
    { center: [-half, wallH / 2, 0], size: [t, wallH, s] },
  );
  // Almenas.
  for (const [rot, off] of [[0, half], [Math.PI / 2, half], [Math.PI, half], [-Math.PI / 2, half]] as const) {
    b.translateRotate(0, 0, 0, rot, () => {
      const n = Math.floor(s / 1.6);
      for (let k = 0; k < n; k += 2) b.box("wall", -s / 2 + 1.6 * (k + 0.5), wallH + 0.6, off + t / 2 - 0.3, 1.6, 1.2, 0.6);
    });
  }
  // Torres en las esquinas con techos cónicos.
  for (const [x, z] of [[half, half], [-half, half], [half, -half], [-half, -half]] as const) {
    const r = 4;
    const th = 15;
    b.cylinder("wall", x, th / 2, z, r, r * 1.08, th, 18, { bottom: false });
    b.cylinder("trim", x, th + 0.3, z, r + 0.4, r + 0.4, 0.6, 18);
    b.cylinder("roof", x, th + 0.6 + 4, z, 0, r + 0.6, 8, 18, { bottom: true });
    for (let k = 0; k < 3; k++) b.box("winDark", x + Math.sin(k * 2.1) * (r + 0.02), 6 + k * 3, z + Math.cos(k * 2.1) * (r + 0.02), 0.6, 1.4, 0.6);
    colliders.push({ center: [x, th / 2, z], size: [r * 2, th, r * 2] });
  }
  // Torre del homenaje.
  const kw = s * 0.34;
  const kh = 22;
  b.box("wall", 0, kh / 2, -s * 0.12, kw, kh, kw);
  b.box("wall", 0, kh + 4, -s * 0.12, kw * 0.55, 8, kw * 0.55);
  crenellations(b, kw, kw, kh, 1.2, "wall");
  b.translateRotate(0, 0, -s * 0.12, 0, () => crenellations(b, kw * 0.55, kw * 0.55, kh + 8, 1.2, "wall"));
  for (let f = 0; f < 5; f++)
    for (let c = -1; c <= 1; c++) {
      const key = rng.chance(0.4) ? "winLit" : "winDark";
      b.quad(key, [c * 3 - 0.4, 4 + f * 3.8, -s * 0.12 + kw / 2 + 0.03], [c * 3 + 0.4, 4 + f * 3.8, -s * 0.12 + kw / 2 + 0.03], [c * 3 + 0.4, 5.8 + f * 3.8, -s * 0.12 + kw / 2 + 0.03], [c * 3 - 0.4, 5.8 + f * 3.8, -s * 0.12 + kw / 2 + 0.03]);
    }
  colliders.push({ center: [0, kh / 2, -s * 0.12], size: [kw, kh, kw] });
  // Estandarte.
  b.cylinder("detail", 0, kh + 8 + 4, -s * 0.12, 0.08, 0.08, 8, 6);
  b.box("neon", 1, kh + 8 + 6.5, -s * 0.12, 2, 1.2, 0.05);
  return kh + 16;
}

function buildGrandstand(b: MeshBuilder, p: BuildingProps, colliders: ColliderBox[]): number {
  const w = p.width, d = p.depth;
  const rows = 9;
  const stepH = 0.75;
  const stepD = (d - 2) / rows;
  // Las gradas suben hacia atrás (-Z); el frente mira a la pista (+Z).
  for (let r = 0; r < rows; r++) {
    const z = d / 2 - 1 - stepD * (r + 0.5);
    const y = stepH * (r + 1);
    b.box("wall", 0, y / 2, z, w, y, stepD, { bottom: false });
    b.box(r % 2 ? "trim" : "detail", 0, y + 0.22, z + stepD * 0.2, w - 0.6, 0.44, stepD * 0.35);
  }
  const H = stepH * rows;
  b.box("wall", 0, (H + 4) / 2, -d / 2 + 0.3, w, H + 4, 0.6);
  // Techo voladizo sobre columnas.
  const roofY = H + 6;
  b.box("roof", 0, roofY, 0, w + 1, 0.4, d + 1);
  for (let k = 0; k <= Math.floor(w / 10); k++) {
    const x = -w / 2 + (w / Math.floor(w / 10 || 1)) * k;
    b.box("detail", x, roofY / 2, -d / 2 + 0.6, 0.4, roofY, 0.4);
  }
  b.box("neon", 0, roofY - 0.5, d / 2 + 0.5, w * 0.6, 0.8, 0.1);
  colliders.push({ center: [0, H / 2, 0], size: [w, H, d] });
  return roofY + 0.4;
}

function buildStadium(b: MeshBuilder, p: BuildingProps, colliders: ColliderBox[]): number {
  const w = p.width, d = p.depth;
  b.box("roof", 0, 0.05, 0, w - 16, 0.1, d - 16);
  const sides: [number, number, number, number][] = [
    [0, w, d / 2 - 4, 8],
    [Math.PI, w, d / 2 - 4, 8],
    [Math.PI / 2, d - 16, w / 2 - 4, 8],
    [-Math.PI / 2, d - 16, w / 2 - 4, 8],
  ];
  for (const [rot, len, off, depth] of sides) {
    b.translateRotate(0, 0, 0, rot, () => {
      for (let r = 0; r < 8; r++) {
        const y = (r + 1) * 1.6;
        b.box("wall", 0, y / 2, off - depth / 2 + (r + 0.5) * (depth / 8), len, y, depth / 8);
        b.box(r % 2 ? "trim" : "detail", 0, y + 0.2, off - depth / 2 + (r + 0.5) * (depth / 8), len - 1, 0.4, 0.4);
      }
    });
  }
  for (const [x, z] of [[w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]] as const) {
    b.cylinder("detail", x, 15, z, 0.4, 0.5, 30, 8);
    b.box("neon", x, 30, z, 3, 1.5, 0.4);
  }
  colliders.push({ center: [0, 6, d / 2 - 4], size: [w, 12, 8] }, { center: [0, 6, -d / 2 + 4], size: [w, 12, 8] });
  colliders.push({ center: [w / 2 - 4, 6, 0], size: [8, 12, d] }, { center: [-w / 2 + 4, 6, 0], size: [8, 12, d] });
  return 30;
}

function buildPit(b: MeshBuilder, p: BuildingProps, rng: Rng, colliders: ColliderBox[]): number {
  const w = p.width, d = p.depth;
  const H = p.floors * p.floorHeight;
  b.box("wall", 0, H / 2, 0, w, H, d, { bottom: false });
  const bays = Math.floor(w / 7);
  for (let k = 0; k < bays; k++) {
    const x = -w / 2 + 7 * (k + 0.5) + (w - bays * 7) / 2;
    b.box(rng.chance(0.5) ? "winLit" : "door", x, 2.2, d / 2 + 0.03, 5.6, 4.2, 0.06);
    b.box("neon", x, 4.7, d / 2 + 0.06, 5.6, 0.25, 0.05);
  }
  b.quad(rng.chance(0.6) ? "winLit" : "winDark", [-w / 2 + 1, H * 0.6, d / 2 + 0.03], [w / 2 - 1, H * 0.6, d / 2 + 0.03], [w / 2 - 1, H * 0.85, d / 2 + 0.03], [-w / 2 + 1, H * 0.85, d / 2 + 0.03]);
  b.box("roof", 0, H + 0.2, 0, w + 0.6, 0.4, d + 0.6);
  // Torre de control en un extremo.
  b.box("wall", w / 2 - 6, H + 5, 0, 8, 10, 8);
  b.box("winLit", w / 2 - 6, H + 8, 0, 8.1, 2.4, 8.1);
  b.box("roof", w / 2 - 6, H + 10.2, 0, 9, 0.4, 9);
  colliders.push({ center: [0, H / 2, 0], size: [w, H, d] });
  return H + 10.4;
}

function buildDome(b: MeshBuilder, p: BuildingProps, rng: Rng, colliders: ColliderBox[]): number {
  const r = Math.min(p.width, p.depth) / 2;
  b.cylinder("wall", 0, 0.6, 0, r + 0.4, r + 0.6, 2.4, 28, { bottom: false });
  b.cylinder(rng.chance(0.7) ? "winLit" : "winDark", 0, 1.4, 0, r + 0.65, r + 0.65, 0.4, 28, { top: false, bottom: false });
  b.dome("roof", 0, 1.8, 0, r);
  // Túnel de acceso.
  b.box("wall", 0, 1.4, r + 1.6, 3, 2.8, 4);
  b.box("door", 0, 1.2, r + 3.62, 1.6, 2.2, 0.06);
  b.box("neon", 0, 2.6, r + 3.64, 2.2, 0.15, 0.04);
  colliders.push({ center: [0, r / 2 + 1, 0], size: [r * 1.8, r + 2, r * 1.8] });
  return r + 1.8;
}

function buildHut(b: MeshBuilder, p: BuildingProps, colliders: ColliderBox[]): number {
  const w = p.width, d = p.depth;
  const stilts = p.style === "tropical";
  const base = stilts ? 1.2 : 0;
  if (stilts) {
    for (const [x, z] of [[w / 2 - 0.3, d / 2 - 0.3], [-w / 2 + 0.3, d / 2 - 0.3], [w / 2 - 0.3, -d / 2 + 0.3], [-w / 2 + 0.3, -d / 2 + 0.3]] as const) b.cylinder("trim", x, 0, z, 0.15, 0.15, 2.4, 6);
    b.box("trim", 0, base - 0.1, 0, w + 1.2, 0.2, d + 1.2);
    b.box("trim", 0, base / 2, d / 2 + 1.1, 1.2, 0.15, 1.6);
  } else b.box("trim", 0, -0.5, 0, w + 0.3, 1.2, d + 0.3, { bottom: false });
  const H = p.floorHeight;
  b.box("wall", 0, base + H / 2, 0, w, H, d);
  b.box("door", 0, base + 1, d / 2 + 0.03, 1, 2, 0.05);
  b.box("winDark", w / 2 + 0.02, base + H * 0.55, 0, 0.04, 0.8, 1);
  b.box("winDark", -w / 2 - 0.02, base + H * 0.55, 0, 0.04, 0.8, 1);
  b.pyramid("roof", 0, base + H - 0.2, 0, w + 1.6, d + 1.6, Math.min(w, d) * 0.75);
  colliders.push({ center: [0, (base + H) / 2, 0], size: [w, base + H, d] });
  return base + H + Math.min(w, d) * 0.75;
}

function buildPagoda(b: MeshBuilder, p: BuildingProps, colliders: ColliderBox[]): number {
  const fh = p.floorHeight;
  b.box("trim", 0, 0.3, 0, p.width + 4, 1.2, p.depth + 4);
  let y = 0.9;
  for (let f = 0; f < p.floors; f++) {
    const s = 1 - f * 0.18;
    const w = p.width * s, d = p.depth * s * 0.75;
    b.box("wall", 0, y + fh / 2, 0, w, fh, d);
    for (const x of [-w / 2 + 0.3, w / 2 - 0.3]) for (const z of [-d / 2 + 0.3, d / 2 - 0.3]) b.box("trim", x, y + fh / 2, z, 0.4, fh, 0.4);
    b.box("door", 0, y + fh * 0.4, d / 2 + 0.03, w * 0.4, fh * 0.7, 0.06);
    const eave = Math.min(w, d) * 0.28;
    b.pyramid("roof", 0, y + fh, 0, w + 3.2, d + 3.2, eave, Math.abs(w - d) / 2);
    y += fh + eave * 0.6;
  }
  b.cylinder("detail", 0, y + 2, 0, 0.1, 0.25, 4, 8);
  colliders.push({ center: [0, y / 2, 0], size: [p.width, y, p.depth * 0.75] });
  return y + 4;
}
