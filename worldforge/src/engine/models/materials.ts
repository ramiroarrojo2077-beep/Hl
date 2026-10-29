import {
  CanvasTexture,
  Color,
  DoubleSide,
  FrontSide,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Material,
  type Texture,
} from "three";
import { Rng } from "../rng";
import type { MaterialPreset, MaterialSpec } from "../types";

/**
 * Materiales PBR con texturas procedurales generadas en un canvas (sin
 * descargas). Los materiales se cachean por especificación para compartirlos
 * entre objetos y reducir cambios de estado en la GPU.
 */

interface PresetInfo {
  roughness: number;
  metalness: number;
  texture?: (ctx: CanvasRenderingContext2D, size: number, rng: Rng) => void;
}

const PRESETS: Record<MaterialPreset, PresetInfo> = {
  concrete: { roughness: 0.92, metalness: 0, texture: noiseTexture(0.86, 0.1) },
  brick: { roughness: 0.88, metalness: 0, texture: brickTexture },
  plaster: { roughness: 0.95, metalness: 0, texture: noiseTexture(0.92, 0.05) },
  glass: { roughness: 0.08, metalness: 0.85 },
  stone: { roughness: 0.9, metalness: 0, texture: stoneTexture },
  wood: { roughness: 0.8, metalness: 0, texture: woodTexture },
  timber: { roughness: 0.95, metalness: 0, texture: noiseTexture(0.93, 0.05) },
  metal: { roughness: 0.38, metalness: 0.8, texture: brushedTexture },
  marble: { roughness: 0.25, metalness: 0, texture: marbleTexture },
  asphalt: { roughness: 0.94, metalness: 0, texture: noiseTexture(0.8, 0.18) },
  tiles: { roughness: 0.75, metalness: 0, texture: roofTileTexture },
  thatch: { roughness: 1, metalness: 0, texture: thatchTexture },
  sand: { roughness: 1, metalness: 0, texture: noiseTexture(0.9, 0.1) },
  grass: { roughness: 1, metalness: 0, texture: noiseTexture(0.85, 0.2) },
  neon: { roughness: 0.4, metalness: 0 },
  plastic: { roughness: 0.5, metalness: 0 },
  fabric: { roughness: 1, metalness: 0, texture: weaveTexture },
  crystal: { roughness: 0.1, metalness: 0.2 },
};

export function presetDefaults(preset: MaterialPreset): { roughness: number; metalness: number } {
  const p = PRESETS[preset];
  return { roughness: p.roughness, metalness: p.metalness };
}

const textureCache = new Map<MaterialPreset, Texture | null>();

function presetTexture(preset: MaterialPreset): Texture | null {
  if (textureCache.has(preset)) return textureCache.get(preset)!;
  const info = PRESETS[preset];
  if (!info.texture || typeof document === "undefined") {
    textureCache.set(preset, null);
    return null;
  }
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  info.texture(ctx, size, new Rng(preset.length * 977));
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  textureCache.set(preset, tex);
  return tex;
}

export interface MatOptions {
  preset: MaterialPreset;
  color?: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  doubleSide?: boolean;
  flatShading?: boolean;
  vertexColors?: boolean;
  /** Multiplica la emisión por el color de instancia (neón, ventanas encendidas). */
  tintEmissive?: boolean;
  noTexture?: boolean;
}

const materialCache = new Map<string, MeshStandardMaterial>();

export function getMaterial(o: MatOptions): MeshStandardMaterial {
  const key = JSON.stringify(o);
  const hit = materialCache.get(key);
  if (hit) return hit;
  const info = PRESETS[o.preset];
  const m = new MeshStandardMaterial({
    color: new Color(o.color ?? "#ffffff"),
    roughness: o.roughness ?? info.roughness,
    metalness: o.metalness ?? info.metalness,
    emissive: new Color(o.emissive ?? (o.preset === "neon" ? o.color ?? "#ffffff" : "#000000")),
    emissiveIntensity: o.emissiveIntensity ?? (o.preset === "neon" ? 2.5 : o.preset === "crystal" ? 0.8 : 1),
    transparent: (o.opacity ?? 1) < 1 || o.preset === "crystal",
    opacity: o.opacity ?? (o.preset === "crystal" ? 0.85 : 1),
    side: o.doubleSide ? DoubleSide : FrontSide,
    flatShading: o.flatShading ?? false,
    vertexColors: o.vertexColors ?? false,
  });
  if (!o.noTexture) {
    const tex = presetTexture(o.preset);
    if (tex) m.map = tex;
  }
  if (o.tintEmissive) {
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
  totalEmissiveRadiance *= vColor.rgb;
#endif`,
      );
    };
    m.customProgramCacheKey = () => "tintEmissive";
  }
  materialCache.set(key, m);
  return m;
}

/** Material a partir de la especificación editable de una entidad. */
export function materialFromSpec(spec: MaterialSpec, extra: Partial<MatOptions> = {}): MeshStandardMaterial {
  return getMaterial({
    preset: spec.preset,
    color: spec.color,
    roughness: spec.roughness,
    metalness: spec.metalness,
    emissive: spec.emissive,
    emissiveIntensity: spec.emissiveIntensity,
    opacity: spec.opacity,
    ...extra,
  });
}

// ---------- Materiales que reaccionan a la noche ----------

interface NightEntry {
  material: MeshStandardMaterial;
  day: number;
  night: number;
}
const nightMaterials = new Set<NightEntry>();

/** Registra un material cuya emisión depende de la hora (ventanas, faroles). */
export function registerNightMaterial(material: MeshStandardMaterial, day: number, night: number): MeshStandardMaterial {
  for (const e of nightMaterials) if (e.material === material) return material;
  nightMaterials.add({ material, day, night });
  return material;
}

export function applyNightFactor(factor: number) {
  for (const e of nightMaterials) e.material.emissiveIntensity = e.day + (e.night - e.day) * factor;
}

export function disposeMaterialCache() {
  for (const m of materialCache.values()) m.dispose();
  materialCache.clear();
  nightMaterials.clear();
}

export type { Material };

// ---------- Texturas procedurales ----------

function noiseTexture(base: number, amount: number) {
  return (ctx: CanvasRenderingContext2D, size: number, rng: Rng) => {
    const img = ctx.createImageData(size, size);
    // Ruido de valor suavizado en dos escalas para una textura menos "digital".
    const coarse = 16;
    const grid: number[] = [];
    for (let i = 0; i < (coarse + 1) * (coarse + 1); i++) grid.push(rng.next());
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * coarse, gy = (y / size) * coarse;
        const ix = Math.floor(gx), iy = Math.floor(gy);
        const fx = gx - ix, fy = gy - iy;
        const g = (i: number, j: number) => grid[(j % coarse) * (coarse + 1) + (i % coarse)]!;
        const v = (g(ix, iy) * (1 - fx) + g(ix + 1, iy) * fx) * (1 - fy) + (g(ix, iy + 1) * (1 - fx) + g(ix + 1, iy + 1) * fx) * fy;
        const n = base + (v - 0.5) * amount + (rng.next() - 0.5) * amount * 0.6;
        const c = Math.max(0, Math.min(255, n * 255));
        const k = (y * size + x) * 4;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = c;
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  };
}

function brickTexture(ctx: CanvasRenderingContext2D, size: number, rng: Rng) {
  ctx.fillStyle = "#d8d4cc";
  ctx.fillRect(0, 0, size, size);
  const rows = 16;
  const bh = size / rows;
  const bw = bh * 2.1;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? bw / 2 : 0;
    for (let x = -bw; x < size + bw; x += bw) {
      const v = 0.78 + rng.range(-0.1, 0.1);
      const c = Math.round(v * 255);
      ctx.fillStyle = `rgb(${c},${Math.round(c * 0.97)},${Math.round(c * 0.95)})`;
      ctx.fillRect(x + off + 1.5, r * bh + 1.5, bw - 3, bh - 3);
    }
  }
}

function stoneTexture(ctx: CanvasRenderingContext2D, size: number, rng: Rng) {
  ctx.fillStyle = "#9a9a9a";
  ctx.fillRect(0, 0, size, size);
  const rows = 8;
  const bh = size / rows;
  for (let r = 0; r < rows; r++) {
    let x = r % 2 ? -bh * 0.7 : 0;
    while (x < size) {
      const w = bh * rng.range(1.1, 2);
      const c = Math.round((0.75 + rng.range(-0.12, 0.12)) * 255);
      ctx.fillStyle = `rgb(${c},${c},${c})`;
      ctx.fillRect(x + 2, r * bh + 2, w - 4, bh - 4);
      x += w;
    }
  }
}

function woodTexture(ctx: CanvasRenderingContext2D, size: number, rng: Rng) {
  const planks = 8;
  const ph = size / planks;
  for (let p = 0; p < planks; p++) {
    const base = 0.78 + rng.range(-0.08, 0.08);
    for (let y = 0; y < ph; y++) {
      const v = base + Math.sin(y * 0.9 + p) * 0.03;
      const c = Math.round(v * 255);
      ctx.fillStyle = `rgb(${c},${Math.round(c * 0.92)},${Math.round(c * 0.84)})`;
      ctx.fillRect(0, p * ph + y, size, 1);
    }
    ctx.fillStyle = "rgba(60,40,20,0.5)";
    ctx.fillRect(0, p * ph, size, 1.5);
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = `rgba(80,55,30,${rng.range(0.05, 0.15)})`;
      ctx.fillRect(rng.range(0, size), p * ph + rng.range(2, ph - 2), rng.range(20, 90), 1);
    }
  }
}

function brushedTexture(ctx: CanvasRenderingContext2D, size: number, rng: Rng) {
  ctx.fillStyle = "#d8d8d8";
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    const c = Math.round((0.82 + rng.range(-0.05, 0.05)) * 255);
    ctx.fillStyle = `rgba(${c},${c},${c},0.6)`;
    ctx.fillRect(0, y, size, 1);
  }
  ctx.strokeStyle = "rgba(90,90,90,0.35)";
  for (let k = 0; k <= 4; k++) {
    ctx.beginPath();
    ctx.moveTo(0, (k * size) / 4);
    ctx.lineTo(size, (k * size) / 4);
    ctx.stroke();
  }
}

function marbleTexture(ctx: CanvasRenderingContext2D, size: number, rng: Rng) {
  ctx.fillStyle = "#f0efeb";
  ctx.fillRect(0, 0, size, size);
  for (let k = 0; k < 14; k++) {
    ctx.strokeStyle = `rgba(120,120,125,${rng.range(0.08, 0.25)})`;
    ctx.lineWidth = rng.range(0.5, 2);
    ctx.beginPath();
    let x = rng.range(0, size), y = 0;
    ctx.moveTo(x, y);
    while (y < size) {
      x += rng.range(-12, 12);
      y += rng.range(6, 16);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function roofTileTexture(ctx: CanvasRenderingContext2D, size: number, rng: Rng) {
  const rows = 12;
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? rh * 0.6 : 0;
    for (let x = -rh; x < size + rh; x += rh * 1.2) {
      const c = Math.round((0.8 + rng.range(-0.08, 0.08)) * 255);
      const grad = ctx.createLinearGradient(0, r * rh, 0, r * rh + rh);
      grad.addColorStop(0, `rgb(${c},${c},${c})`);
      grad.addColorStop(1, `rgb(${Math.round(c * 0.7)},${Math.round(c * 0.7)},${Math.round(c * 0.7)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(x + off, r * rh, rh * 1.2 - 1.5, rh);
    }
  }
}

function thatchTexture(ctx: CanvasRenderingContext2D, size: number, rng: Rng) {
  ctx.fillStyle = "#c9c0a8";
  ctx.fillRect(0, 0, size, size);
  for (let k = 0; k < 1400; k++) {
    const c = Math.round((0.7 + rng.range(-0.15, 0.2)) * 255);
    ctx.strokeStyle = `rgba(${c},${Math.round(c * 0.95)},${Math.round(c * 0.8)},0.7)`;
    ctx.beginPath();
    const x = rng.range(0, size), y = rng.range(0, size);
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-3, 3), y + rng.range(10, 24));
    ctx.stroke();
  }
}

function weaveTexture(ctx: CanvasRenderingContext2D, size: number, rng: Rng) {
  ctx.fillStyle = "#e0e0e0";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size; i += 4) {
    ctx.fillStyle = `rgba(150,150,150,${0.15 + rng.range(0, 0.1)})`;
    ctx.fillRect(i, 0, 2, size);
    ctx.fillRect(0, i, size, 2);
  }
}
