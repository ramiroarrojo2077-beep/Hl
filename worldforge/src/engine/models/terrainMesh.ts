import { BufferAttribute, BufferGeometry, CanvasTexture, Color, RepeatWrapping } from "three";
import type { Biome, Terrain } from "../types";
import { Rng } from "../rng";

/**
 * Malla de terreno dividida en sectores (chunks) con varios niveles de detalle
 * y "faldones" en los bordes para ocultar grietas entre niveles distintos.
 */

export const CHUNKS_PER_SIDE = 8;
export const LOD_LEVELS = [1, 2, 4] as const; // salto de vértices por nivel

interface Palette {
  low: Color; // costa / arena
  grass: Color;
  grass2: Color;
  dirt: Color;
  rock: Color;
  snow: Color;
}

const PALETTES: Record<Biome, Palette> = {
  temperate: { low: c("#c9b98c"), grass: c("#5e8c3a"), grass2: c("#4a7a30"), dirt: c("#7a6248"), rock: c("#7f7b74"), snow: c("#f1f4f8") },
  desert: { low: c("#d7b47c"), grass: c("#d9b27a"), grass2: c("#c99d63"), dirt: c("#b9875a"), rock: c("#9c6a45"), snow: c("#f1e6d0") },
  tropical: { low: c("#ead9a3"), grass: c("#4f9a3a"), grass2: c("#3f8a34"), dirt: c("#7a6a48"), rock: c("#6e6a62"), snow: c("#f1f4f8") },
  snow: { low: c("#d9dee4"), grass: c("#e9eef3"), grass2: c("#dce3ea"), dirt: c("#b9c0c8"), rock: c("#7f858d"), snow: c("#f6f8fb") },
  fantasy: { low: c("#cbbf8e"), grass: c("#4fae5c"), grass2: c("#3b9a5a"), dirt: c("#6e5a48"), rock: c("#6b6a7a"), snow: c("#eef0ff") },
  alien: { low: c("#c0703c"), grass: c("#b5552f"), grass2: c("#a44a2a"), dirt: c("#8a3a22"), rock: c("#6e2f22"), snow: c("#e8c8b0") },
  urban: { low: c("#b9ad8a"), grass: c("#6b8a4a"), grass2: c("#5a7a40"), dirt: c("#7a6a58"), rock: c("#7a7a7a"), snow: c("#f1f4f8") },
};

function c(hex: string) {
  return new Color(hex);
}

const PAINT_COLORS: (Color | null)[] = [null, c("#5e8c3a"), c("#d9c48e"), c("#7f7b74"), c("#f1f4f8"), c("#7a6248"), c("#8f9196")];

function vertexColor(t: Terrain, idx: number, x: number, z: number, slope: number, out: Color, rng: number) {
  const pal = PALETTES[t.biome];
  const h = t.heights[idx]!;
  const paint = t.paint[idx] ?? 0;
  if (paint > 0 && PAINT_COLORS[paint]) {
    out.copy(PAINT_COLORS[paint]!);
    out.multiplyScalar(0.94 + rng * 0.1);
    return;
  }
  const wl = t.waterEnabled ? t.waterLevel : -1e9;
  const n = Math.sin(x * 0.07) * Math.cos(z * 0.05) * 0.5 + 0.5;
  out.copy(pal.grass).lerp(pal.grass2, n);
  if (h < wl + 1.6) out.lerp(pal.low, Math.min(1, (wl + 1.6 - h) / 1.6));
  if (h < wl - 0.3) out.copy(pal.low).multiplyScalar(0.8);
  if (slope > 22) out.lerp(pal.dirt, Math.min(1, (slope - 22) / 10));
  if (slope > 34) out.lerp(pal.rock, Math.min(1, (slope - 34) / 8));
  if (h > t.snowLine) out.lerp(pal.snow, Math.min(1, (h - t.snowLine) / 6) * (slope < 40 ? 1 : 0.4));
  out.multiplyScalar(0.95 + rng * 0.08);
}

/** Construye la geometría de un sector con el salto `step` (1 = resolución completa). */
export function buildChunkGeometry(t: Terrain, ci: number, cj: number, step: number): BufferGeometry {
  const res = t.resolution;
  const per = res / CHUNKS_PER_SIDE;
  const n = res + 1;
  const half = t.size / 2;
  const cell = t.size / res;
  const i0 = ci * per, j0 = cj * per;
  const cells = per / step;
  const verts = (cells + 1) * (cells + 1);
  const skirt = cells * 4 * 2; // vértices extra para faldones
  const pos = new Float32Array((verts + skirt) * 3);
  const nor = new Float32Array((verts + skirt) * 3);
  const col = new Float32Array((verts + skirt) * 3);
  const uv = new Float32Array((verts + skirt) * 2);
  const color = new Color();
  const rng = new Rng(ci * 131 + cj * 17 + step);
  const H = (i: number, j: number) => t.heights[Math.min(res, Math.max(0, j)) * n + Math.min(res, Math.max(0, i))]!;
  let v = 0;
  for (let jj = 0; jj <= cells; jj++) {
    for (let ii = 0; ii <= cells; ii++) {
      const i = i0 + ii * step, j = j0 + jj * step;
      const x = -half + i * cell, z = -half + j * cell;
      const h = H(i, j);
      pos.set([x, h, z], v * 3);
      // Normal por diferencias centrales en la grilla completa.
      const dx = (H(i + 1, j) - H(i - 1, j)) / (2 * cell);
      const dz = (H(i, j + 1) - H(i, j - 1)) / (2 * cell);
      const l = Math.hypot(dx, 1, dz);
      nor.set([-dx / l, 1 / l, -dz / l], v * 3);
      const slope = (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI;
      vertexColor(t, j * n + i, x, z, slope, color, rng.next());
      col.set([color.r, color.g, color.b], v * 3);
      uv.set([x / 8, z / 8], v * 2);
      v++;
    }
  }
  const indices: number[] = [];
  const row = cells + 1;
  for (let jj = 0; jj < cells; jj++) {
    for (let ii = 0; ii < cells; ii++) {
      const a = jj * row + ii, b = (jj + 1) * row + ii, cc = (jj + 1) * row + ii + 1, d = jj * row + ii + 1;
      // Misma diagonal que heightAt: triángulos (a, b, d) y (b, c, d).
      indices.push(a, b, d, b, cc, d);
    }
  }
  // Faldones: duplican el borde 4 m hacia abajo.
  const border: number[] = [];
  for (let ii = 0; ii < cells; ii++) border.push(ii); // borde norte (jj = 0)
  for (let jj = 0; jj < cells; jj++) border.push(jj * row + cells); // este
  for (let ii = cells; ii > 0; ii--) border.push(cells * row + ii); // sur
  for (let jj = cells; jj > 0; jj--) border.push(jj * row); // oeste
  const skirtStart = v;
  for (const bIdx of border) {
    pos.set([pos[bIdx * 3]!, pos[bIdx * 3 + 1]! - 4, pos[bIdx * 3 + 2]!], v * 3);
    nor.set([nor[bIdx * 3]!, nor[bIdx * 3 + 1]!, nor[bIdx * 3 + 2]!], v * 3);
    col.set([col[bIdx * 3]! * 0.8, col[bIdx * 3 + 1]! * 0.8, col[bIdx * 3 + 2]! * 0.8], v * 3);
    uv.set([uv[bIdx * 2]!, uv[bIdx * 2 + 1]!], v * 2);
    v++;
  }
  const bl = border.length;
  for (let k = 0; k < bl; k++) {
    const a = border[k]!, b = border[(k + 1) % bl]!;
    const sa = skirtStart + k, sbb = skirtStart + ((k + 1) % bl);
    // Doble cara para que se vea desde cualquier lado.
    indices.push(a, sa, b, b, sa, sbb, a, b, sa, b, sbb, sa);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos.subarray(0, v * 3), 3));
  g.setAttribute("normal", new BufferAttribute(nor.subarray(0, v * 3), 3));
  g.setAttribute("color", new BufferAttribute(col.subarray(0, v * 3), 3));
  g.setAttribute("uv", new BufferAttribute(uv.subarray(0, v * 2), 2));
  g.setIndex(indices);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

let detailTexture: CanvasTexture | null = null;
/** Textura de detalle en escala de grises que rompe la uniformidad del color por vértice. */
export function terrainDetailTexture(): CanvasTexture | null {
  if (detailTexture || typeof document === "undefined") return detailTexture;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const rng = new Rng(4242);
  for (let k = 0; k < size * size; k++) {
    const v = 215 + rng.next() * 40;
    img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = v;
    img.data[k * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.globalAlpha = 0.25;
  for (let k = 0; k < 500; k++) {
    ctx.fillStyle = rng.chance(0.5) ? "#ffffff" : "#9a9a9a";
    ctx.beginPath();
    ctx.arc(rng.next() * size, rng.next() * size, rng.range(1, 6), 0, Math.PI * 2);
    ctx.fill();
  }
  detailTexture = new CanvasTexture(canvas);
  detailTexture.wrapS = detailTexture.wrapT = RepeatWrapping;
  return detailTexture;
}

/** Sectores afectados por un rectángulo de celdas (para reconstruir al esculpir). */
export function chunksInRange(t: Pick<Terrain, "resolution">, i0: number, i1: number, j0: number, j1: number): [number, number][] {
  const per = t.resolution / CHUNKS_PER_SIDE;
  const out: [number, number][] = [];
  const a0 = Math.max(0, Math.floor((i0 - 1) / per)), a1 = Math.min(CHUNKS_PER_SIDE - 1, Math.floor((i1 + 1) / per));
  const b0 = Math.max(0, Math.floor((j0 - 1) / per)), b1 = Math.min(CHUNKS_PER_SIDE - 1, Math.floor((j1 + 1) / per));
  for (let cj = b0; cj <= b1; cj++) for (let ci = a0; ci <= a1; ci++) out.push([ci, cj]);
  return out;
}
