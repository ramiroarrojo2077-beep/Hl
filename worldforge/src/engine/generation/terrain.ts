import { clamp, lerp, smoothstep } from "../math";
import { createNoise } from "../noise";
import { Rng } from "../rng";
import type { Terrain, Vec2 } from "../types";
import type { WorldPlan } from "./plan";

/**
 * Terrain Generator: mapa de alturas procedural y utilidades de muestreo y
 * esculpido. El terreno es una grilla regular de (resolution + 1)² vértices
 * centrada en el origen.
 */

export interface GridSpec {
  blocks: number; // manzanas por lado
  blockSize: number; // tamaño total de la manzana (incluye vereda)
  street: number; // ancho de calzada
  sidewalk: number;
}

export interface Site {
  center: Vec2;
  radius: number; // radio de la zona aplanada para el asentamiento
  plateau: number; // altura del asentamiento
  waterLevel: number;
  worldSize: number;
  resolution: number;
  grid: GridSpec | null;
  castle: { position: Vec2; size: number } | null;
  lake: { position: Vec2; radius: number } | null;
  river: { x: number; amplitude: number; width: number } | null;
  peak: Vec2 | null;
  waterfall: { position: Vec2; facing: number } | null;
}

export function gridExtent(g: GridSpec): number {
  return (g.blocks * (g.blockSize + g.street) + g.street) / 2;
}

export function computeSite(plan: WorldPlan, rng: Rng): Site {
  const sizeIdx = plan.size === "small" ? 0 : plan.size === "medium" ? 1 : 2;
  let grid: GridSpec | null = null;
  let radius: number;
  switch (plan.archetype) {
    case "city":
      grid = { blocks: [3, 5, 7][sizeIdx]!, blockSize: [36, 40, 42][sizeIdx]!, street: 10, sidewalk: 3 };
      break;
    case "town":
      grid = { blocks: [3, 4, 5][sizeIdx]!, blockSize: 34, street: 10, sidewalk: 2.5 };
      break;
    case "futuristic":
      grid = { blocks: [3, 4, 6][sizeIdx]!, blockSize: 48, street: 12, sidewalk: 3.5 };
      break;
    default:
      break;
  }
  if (grid) radius = gridExtent(grid) + 12;
  else if (plan.archetype === "racetrack") radius = [115, 135, 160][sizeIdx]!;
  else if (plan.archetype === "desert_base") radius = [55, 75, 100][sizeIdx]!;
  else if (plan.archetype === "forest" || plan.archetype === "wilderness") radius = [22, 30, 40][sizeIdx]!;
  else radius = [62, 82, 110][sizeIdx]!;

  const mountainBand = plan.terrain.shape === "flat" || plan.terrain.shape === "dunes" ? 70 : 115;
  let worldSize = clamp(Math.ceil((radius * 2 + mountainBand * 2) / 40) * 40, 360, 640);
  if (plan.terrain.shape === "island") worldSize = clamp(Math.ceil((radius * 3.4 + 120) / 40) * 40, 400, 640);
  const resolution = worldSize > 440 ? 192 : 160;

  let center: Vec2 = [0, 0];
  let peak: Vec2 | null = null;
  if (plan.terrain.shape === "island") {
    const islandR = worldSize * 0.34;
    center = [-islandR * 0.28, islandR * 0.08];
    peak = [islandR * 0.35, -islandR * 0.12];
  } else if (plan.terrain.shape === "mountains") {
    const a = rng.range(0, Math.PI * 2);
    peak = [Math.cos(a) * radius * 2, Math.sin(a) * radius * 2];
  }

  let castle: Site["castle"] = null;
  if (plan.buildings.landmark === "castle") {
    const a = rng.range(-Math.PI * 0.8, -Math.PI * 0.2); // al norte
    const d = radius + 28;
    castle = { position: [center[0] + Math.cos(a) * d, center[1] + Math.sin(a) * d], size: 44 };
  }

  let lake: Site["lake"] = null;
  if (plan.terrain.lake) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(24, 36);
    const d = radius + r + 14;
    lake = { position: [center[0] + Math.cos(a) * d, center[1] + Math.sin(a) * d], radius: r };
  }

  let river: Site["river"] = null;
  if (plan.terrain.river && plan.terrain.shape !== "island") {
    const side = rng.chance(0.5) ? 1 : -1;
    river = { x: side * (radius + 16), amplitude: rng.range(8, 16), width: rng.range(9, 14) };
  }

  let waterfall: Site["waterfall"] = null;
  if (plan.terrain.waterfall) {
    // La cascada cae hacia el lago (o hacia el río) desde un acantilado.
    if (lake) {
      const dirX = lake.position[0] - center[0];
      const dirZ = lake.position[1] - center[1];
      const len = Math.hypot(dirX, dirZ) || 1;
      const pos: Vec2 = [lake.position[0] + (dirX / len) * (lake.radius + 4), lake.position[1] + (dirZ / len) * (lake.radius + 4)];
      waterfall = { position: pos, facing: Math.atan2(-dirX, -dirZ) };
    }
  }

  return {
    center,
    radius,
    plateau: plan.terrain.shape === "island" ? 3 : 4,
    waterLevel: 0,
    worldSize,
    resolution,
    grid,
    castle,
    lake,
    river,
    peak,
    waterfall,
  };
}

export function riverCenterX(site: Site, z: number): number {
  if (!site.river) return Infinity;
  return site.river.x + Math.sin(z / 55) * site.river.amplitude + Math.sin(z / 23 + 1.3) * site.river.amplitude * 0.3;
}

export function generateTerrain(plan: WorldPlan, site: Site, seed: number): Terrain {
  const noise = createNoise(seed);
  const res = site.resolution;
  const size = site.worldSize;
  const half = size / 2;
  const n = res + 1;
  const heights = new Array<number>(n * n);
  const relief = plan.terrain.relief;
  const { center, radius, plateau } = site;

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -half + (i / res) * size;
      const z = -half + (j / res) * size;
      const dx = x - center[0];
      const dz = z - center[1];
      const d = Math.hypot(dx, dz);
      const edge = Math.min(half - Math.abs(x), half - Math.abs(z)); // distancia al borde del mapa
      const fbm = noise.fbm(x / 170, z / 170, 5);
      const detail = noise.fbm(x / 35, z / 35, 3);
      let h: number;

      switch (plan.terrain.shape) {
        case "flat":
          h = plateau + fbm * 1.6 + detail * 0.4;
          break;
        case "hills":
          h = plateau + (fbm * 0.5 + 0.5) * 18 * relief + detail * 1.5;
          break;
        case "mountain_ring":
        case "mountains": {
          const start = radius * 1.18;
          const end = Math.max(start + 40, Math.min(half * 0.96, radius * 2.8));
          let m = smoothstep(start, end, d);
          if (plan.terrain.shape === "mountains") {
            const ang = Math.atan2(dz, dx);
            m *= 0.35 + 0.65 * (0.5 + 0.5 * noise.simplex(Math.cos(ang) * 1.3 + 7, Math.sin(ang) * 1.3 + 3));
            if (site.peak) m = Math.max(m, 1 - smoothstep(0, radius * 1.6, Math.hypot(x - site.peak[0], z - site.peak[1])));
          }
          const ridged = noise.ridged(x / 140, z / 140, 6);
          h = plateau + (fbm * 0.5 + 0.5) * 8 * relief + Math.pow(m, 1.35) * (22 + 85 * relief * ridged) + detail * (1 + 3 * m);
          break;
        }
        case "valley": {
          const ax = Math.abs(dx);
          const m = smoothstep(radius * 1.1, radius * 2.5, ax);
          const ridged = noise.ridged(x / 130, z / 130, 6);
          h = plateau + (fbm * 0.5 + 0.5) * 6 + m * (25 + 70 * relief * ridged) + detail * (1 + 2 * m);
          break;
        }
        case "island": {
          const islandR = size * 0.34;
          const dc = Math.hypot(x, z) / islandR + fbm * 0.18;
          const land = 1 - smoothstep(0.62, 1.02, dc);
          let mount = 0;
          if (site.peak) {
            const dp = Math.hypot(x - site.peak[0], z - site.peak[1]) / islandR;
            mount = Math.pow(1 - smoothstep(0, 0.75, dp), 1.6) * (30 + 45 * relief) * (0.7 + 0.6 * noise.ridged(x / 90, z / 90, 4));
          }
          h = land * (plateau + 1.5 + (fbm * 0.5 + 0.5) * 6 + mount + detail * 1.2) + (1 - land) * -9;
          break;
        }
        case "dunes": {
          const a = 0.6;
          const u = (x * Math.cos(a) + z * Math.sin(a)) / 22 + fbm * 2.4;
          const dune = Math.pow(Math.abs(Math.sin(u)), 1.6);
          h = plateau + dune * 7 * relief + (fbm * 0.5 + 0.5) * 10 * relief + detail * 0.6;
          break;
        }
      }

      // Lago: cuenca por debajo del nivel del agua.
      if (site.lake) {
        const dl = Math.hypot(x - site.lake.position[0], z - site.lake.position[1]);
        const bowl = 1 - smoothstep(site.lake.radius * 0.55, site.lake.radius * 1.35, dl);
        h = lerp(h, site.waterLevel - 3.5 + (dl / site.lake.radius) * 2, bowl);
      }
      // Río: cauce sinuoso de norte a sur.
      if (site.river) {
        const rx = riverCenterX(site, z);
        const dr = Math.abs(x - rx);
        const w = site.river.width;
        const bank = 1 - smoothstep(w * 0.45, w * 1.6, dr);
        h = lerp(h, site.waterLevel - 2.2 + (dr / w) * 1.5, bank);
      }
      // Asentamiento: meseta plana con transición suave.
      if (radius > 0) {
        const flat = 1 - smoothstep(radius * 0.98, radius * 1.22, d);
        h = lerp(h, plateau + detail * 0.15 * (1 - flat), flat);
      }
      // Bordes del mapa: levantar (montañas) o hundir (islas) para cerrar el mundo.
      if (plan.terrain.shape !== "island" && edge < 30) h += Math.pow(1 - edge / 30, 2) * 18 * (0.5 + relief);
      heights[j * n + i] = Math.round(h * 100) / 100;
    }
  }

  // Castillo: colina con cima plana.
  if (site.castle) {
    const [cx, cz] = site.castle.position;
    const top = plateau + 9;
    applyRadial(heights, res, size, cx, cz, site.castle.size * 1.25, (h, t) => {
      const plateauT = 1 - smoothstep(0.55, 1, t);
      return Math.max(h, lerp(h, top, plateauT));
    });
  }
  // Cascada: acantilado detrás del salto de agua.
  if (site.waterfall) {
    const [wx, wz] = site.waterfall.position;
    const dirX = Math.sin(site.waterfall.facing);
    const dirZ = Math.cos(site.waterfall.facing);
    const top = site.waterLevel + 14;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -half + (i / res) * size;
        const z = -half + (j / res) * size;
        const rx = x - wx, rz = z - wz;
        const along = -(rx * dirX + rz * dirZ); // positivo detrás del salto
        const side = Math.abs(rx * dirZ - rz * dirX);
        if (side > 26 || along < -2) continue;
        const cliff = smoothstep(-1, 3, along) * (1 - smoothstep(14, 26, side));
        const idx = j * n + i;
        heights[idx] = Math.max(heights[idx]!, lerp(heights[idx]!, top + noise.fbm(x / 20, z / 20, 2) * 1.5, cliff));
      }
    }
  }

  const snowLine = plan.biome === "snow" ? plateau - 10 : plan.biome === "temperate" || plan.biome === "fantasy" ? 62 : 999;
  return {
    size,
    resolution: res,
    heights,
    paint: new Array(heights.length).fill(0),
    waterLevel: site.waterLevel,
    waterEnabled:
      plan.terrain.shape === "island" || plan.terrain.river || plan.terrain.lake || plan.terrain.waterfall,
    biome: plan.biome,
    snowLine,
  };
}

function applyRadial(
  heights: number[],
  res: number,
  size: number,
  cx: number,
  cz: number,
  radius: number,
  fn: (h: number, t: number) => number,
) {
  const n = res + 1;
  const half = size / 2;
  const cell = size / res;
  const i0 = Math.max(0, Math.floor((cx - radius + half) / cell));
  const i1 = Math.min(res, Math.ceil((cx + radius + half) / cell));
  const j0 = Math.max(0, Math.floor((cz - radius + half) / cell));
  const j1 = Math.min(res, Math.ceil((cz + radius + half) / cell));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const x = -half + i * cell;
      const z = -half + j * cell;
      const t = Math.hypot(x - cx, z - cz) / radius;
      if (t > 1) continue;
      const idx = j * n + i;
      heights[idx] = fn(heights[idx]!, t);
    }
  }
}

// ---------- Muestreo ----------

export type TerrainLike = Pick<Terrain, "size" | "resolution" | "heights">;

export function heightAt(t: TerrainLike, x: number, z: number): number {
  const res = t.resolution;
  const n = res + 1;
  const fx = clamp(((x + t.size / 2) / t.size) * res, 0, res);
  const fz = clamp(((z + t.size / 2) / t.size) * res, 0, res);
  const i = Math.min(res - 1, Math.floor(fx));
  const j = Math.min(res - 1, Math.floor(fz));
  const u = fx - i;
  const v = fz - j;
  const h00 = t.heights[j * n + i]!;
  const h10 = t.heights[j * n + i + 1]!;
  const h01 = t.heights[(j + 1) * n + i]!;
  const h11 = t.heights[(j + 1) * n + i + 1]!;
  // Interpolación por triángulos, igual que la malla renderizada.
  if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
  return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}

/** Pendiente en grados. */
export function slopeAt(t: TerrainLike, x: number, z: number): number {
  const e = t.size / t.resolution;
  const dx = heightAt(t, x + e, z) - heightAt(t, x - e, z);
  const dz = heightAt(t, x, z + e) - heightAt(t, x, z - e);
  return (Math.atan(Math.hypot(dx, dz) / (2 * e)) * 180) / Math.PI;
}

export function isInsideTerrain(t: Pick<Terrain, "size">, x: number, z: number, margin = 0): boolean {
  const h = t.size / 2 - margin;
  return Math.abs(x) <= h && Math.abs(z) <= h;
}

// ---------- Esculpido ----------

export type BrushMode = "raise" | "lower" | "smooth" | "flatten" | "water";

export interface BrushParams {
  mode: BrushMode;
  x: number;
  z: number;
  radius: number;
  strength: number; // metros por aplicación (raise/lower) o factor 0..1
  targetHeight?: number; // flatten
  waterLevel?: number;
}

/** Aplica un pincel sobre una copia de las alturas. Devuelve el rango de celdas afectado. */
export function applyBrush(
  t: TerrainLike,
  heights: number[],
  p: BrushParams,
): { i0: number; i1: number; j0: number; j1: number } {
  const res = t.resolution;
  const n = res + 1;
  const half = t.size / 2;
  const cell = t.size / res;
  const i0 = Math.max(0, Math.floor((p.x - p.radius + half) / cell));
  const i1 = Math.min(res, Math.ceil((p.x + p.radius + half) / cell));
  const j0 = Math.max(0, Math.floor((p.z - p.radius + half) / cell));
  const j1 = Math.min(res, Math.ceil((p.z + p.radius + half) / cell));
  const source = p.mode === "smooth" ? heights.slice() : heights;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const x = -half + i * cell;
      const z = -half + j * cell;
      const d = Math.hypot(x - p.x, z - p.z) / p.radius;
      if (d > 1) continue;
      const w = 1 - smoothstep(0.35, 1, d); // caída suave en el borde
      const idx = j * n + i;
      const h = heights[idx]!;
      let next = h;
      switch (p.mode) {
        case "raise":
          next = h + p.strength * w;
          break;
        case "lower":
          next = h - p.strength * w;
          break;
        case "flatten":
          next = lerp(h, p.targetHeight ?? h, clamp(p.strength * 0.25, 0, 1) * w);
          break;
        case "water": {
          const target = (p.waterLevel ?? 0) - 2.5;
          next = h > target ? lerp(h, target, clamp(p.strength * 0.25, 0, 1) * w) : h;
          break;
        }
        case "smooth": {
          let sum = 0;
          let cnt = 0;
          for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) {
              const ii = i + di, jj = j + dj;
              if (ii < 0 || jj < 0 || ii > res || jj > res) continue;
              sum += source[jj * n + ii]!;
              cnt++;
            }
          next = lerp(h, sum / cnt, clamp(p.strength * 0.5, 0, 1) * w);
          break;
        }
      }
      heights[idx] = Math.round(clamp(next, -200, 800) * 100) / 100;
    }
  }
  return { i0, i1, j0, j1 };
}

/** Aplana una región rectangular orientada (para colocar edificios o caminos). */
export function flattenObb(
  t: TerrainLike,
  heights: number[],
  cx: number,
  cz: number,
  hx: number,
  hz: number,
  rot: number,
  target: number,
  falloff = 6,
) {
  const res = t.resolution;
  const n = res + 1;
  const half = t.size / 2;
  const cell = t.size / res;
  const r = Math.hypot(hx, hz) + falloff;
  const i0 = Math.max(0, Math.floor((cx - r + half) / cell));
  const i1 = Math.min(res, Math.ceil((cx + r + half) / cell));
  const j0 = Math.max(0, Math.floor((cz - r + half) / cell));
  const j1 = Math.min(res, Math.ceil((cz + r + half) / cell));
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const x = -half + i * cell - cx;
      const z = -half + j * cell - cz;
      const lx = Math.abs(x * c - z * s) - hx;
      const lz = Math.abs(x * s + z * c) - hz;
      const outside = Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
      if (outside > falloff) continue;
      const w = 1 - smoothstep(0, falloff, outside);
      const idx = j * n + i;
      heights[idx] = Math.round(lerp(heights[idx]!, target, w) * 100) / 100;
    }
  }
}
