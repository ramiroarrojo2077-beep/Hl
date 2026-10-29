import { type BufferGeometry, type MeshStandardMaterial, Matrix4 } from "three";
import { createNoise } from "../noise";
import { Rng } from "../rng";
import type { Biome, PlantSpecies, TreeSpecies } from "../types";
import { MeshBuilder } from "./builder";
import { getMaterial } from "./materials";

/** Modelos de vegetación low-poly, pensados para dibujarse con InstancedMesh. */

export interface ModelPart {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
  /** Si el color por instancia (tinte) se aplica a esta parte. */
  tinted: boolean;
  castShadow?: boolean;
}

export const windUniforms = { uTime: { value: 0 }, uWind: { value: 0.3 } };

function swayMaterial(base: MeshStandardMaterial, key: string): MeshStandardMaterial {
  const m = base.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = windUniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uWind;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
#else
  vec3 ip = vec3(0.0);
#endif
  float sway = sin(uTime * 1.6 + ip.x * 0.17 + ip.z * 0.13) * (0.4 + uWind) * 0.035 * max(position.y - 1.0, 0.0);
  transformed.x += sway;
  transformed.z += sway * 0.7;`,
      );
  };
  m.customProgramCacheKey = () => `sway-${key}`;
  return m;
}

const swayCache = new Map<string, MeshStandardMaterial>();
function foliageMaterial(color: string, opts: { emissive?: string; doubleSide?: boolean } = {}): MeshStandardMaterial {
  const key = `${color}|${opts.emissive ?? ""}|${opts.doubleSide ? 1 : 0}`;
  let m = swayCache.get(key);
  if (!m) {
    m = swayMaterial(
      getMaterial({ preset: "plastic", color, roughness: 0.85, flatShading: true, noTexture: true, emissive: opts.emissive, emissiveIntensity: opts.emissive ? 0.6 : 1, doubleSide: opts.doubleSide }),
      key,
    );
    swayCache.set(key, m);
  }
  return m;
}

const trunkMat = (color = "#6b4a32") => getMaterial({ preset: "wood", color, roughness: 0.9, flatShading: true });

export function foliageColor(species: TreeSpecies, biome: Biome): string {
  if (species === "sakura") return "#f2a7c3";
  if (species === "birch") return "#8dbb4e";
  if (species === "palm") return "#5aa83c";
  if (species === "cypress") return "#2f5a2a";
  if (species === "pine") return biome === "snow" ? "#3a5f4a" : "#2e5e35";
  if (species === "giant") return biome === "fantasy" ? "#2fa58a" : biome === "alien" ? "#8a3fb0" : "#3c7a3a";
  if (biome === "fantasy") return "#4fae5c";
  if (biome === "desert") return "#7a9a46";
  if (biome === "tropical") return "#3f9a3a";
  return "#4c8a3a";
}

const treeCache = new Map<string, ModelPart[]>();

export function getTreeModel(species: TreeSpecies, biome: Biome): ModelPart[] {
  const key = `${species}|${biome}`;
  const hit = treeCache.get(key);
  if (hit) return hit;
  const b = new MeshBuilder();
  const rng = new Rng(species.length * 131 + 7);
  const noise = createNoise(species.length * 17);
  const jitter = (amt: number) => (x: number, y: number, z: number) => noise.simplex(x * 2.1 + y, z * 2.1 - y) * amt;
  switch (species) {
    case "oak":
    case "sakura": {
      b.cylinder("trunk", 0, 1.6, 0, 0.22, 0.38, 3.2, 7, { flat: true });
      b.with(new Matrix4().makeRotationZ(0.7).setPosition(0.45, 2.6, 0), () => b.cylinder("trunk", 0, 0.6, 0, 0.08, 0.14, 1.2, 5, { flat: true }));
      b.with(new Matrix4().makeRotationZ(-0.6).setPosition(-0.4, 2.8, 0.1), () => b.cylinder("trunk", 0, 0.5, 0, 0.07, 0.12, 1, 5, { flat: true }));
      const blobs = 5;
      for (let k = 0; k < blobs; k++) {
        const a = (k / blobs) * Math.PI * 2;
        const r = k === 0 ? 0 : 1.3;
        b.blob("foliage", Math.cos(a) * r, 4.4 + rng.range(-0.3, 0.6) + (k === 0 ? 0.6 : 0), Math.sin(a) * r, 1.8, 1.5, 1.8, jitter(0.18), 1);
      }
      break;
    }
    case "birch": {
      b.cylinder("trunk", 0, 2.5, 0, 0.12, 0.2, 5, 6, { flat: true });
      for (let k = 0; k < 4; k++) b.blob("foliage", rng.range(-0.8, 0.8), 4.4 + k * 0.7, rng.range(-0.8, 0.8), 1.1, 1.3, 1.1, jitter(0.2), 1);
      break;
    }
    case "pine": {
      b.cylinder("trunk", 0, 1.5, 0, 0.18, 0.3, 3, 6, { flat: true });
      const tiers = 4;
      for (let k = 0; k < tiers; k++) {
        const r = 2.4 - k * 0.5;
        b.cylinder("foliage", 0, 2.4 + k * 1.6 + 1.1, 0, 0, r, 2.6, 8, { flat: true, top: false });
      }
      break;
    }
    case "cypress": {
      b.cylinder("trunk", 0, 0.8, 0, 0.18, 0.25, 1.6, 6, { flat: true });
      b.blob("foliage", 0, 5.2, 0, 1.2, 4.6, 1.2, jitter(0.12), 1);
      break;
    }
    case "palm": {
      // Tronco curvo por segmentos.
      let x = 0, y = 0;
      const segs = 6;
      for (let k = 0; k < segs; k++) {
        const ang = 0.05 + k * 0.045;
        const len = 1.25;
        const m = new Matrix4().makeRotationZ(-ang).setPosition(x, y, 0);
        b.with(m, () => b.cylinder("trunk", 0, len / 2, 0, 0.17 - k * 0.012, 0.2 - k * 0.012, len, 6, { flat: true }));
        x += Math.sin(ang) * len;
        y += Math.cos(ang) * len;
      }
      const fronds = 8;
      for (let k = 0; k < fronds; k++) {
        const a = (k / fronds) * Math.PI * 2 + rng.range(-0.15, 0.15);
        const m = new Matrix4().makeRotationY(a).setPosition(x, y, 0);
        b.with(m, () => {
          // Hoja: tira curvada hacia abajo.
          let px = 0, py = 0;
          const pieces = 4;
          for (let p = 0; p < pieces; p++) {
            const l = 0.9;
            const droop = -0.15 - p * 0.35;
            const nx = px + Math.cos(droop) * l, ny = py + Math.sin(droop) * l;
            const w0 = 0.45 - p * 0.08, w1 = 0.45 - (p + 1) * 0.08;
            b.quad("foliage", [px, py, -w0], [nx, ny, -w1], [nx, ny, w1], [px, py, w0]);
            b.quad("foliage", [px, py, w0], [nx, ny, w1], [nx, ny, -w1], [px, py, -w0]);
            px = nx;
            py = ny;
          }
        });
      }
      b.blob("trunk", x, y, 0, 0.35, 0.3, 0.35, () => 0, 0);
      break;
    }
    case "giant": {
      b.cylinder("trunk", 0, 7, 0, 1.3, 2.2, 14, 10, { flat: true });
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        b.with(new Matrix4().makeRotationY(a).multiply(new Matrix4().makeRotationZ(0.9)).setPosition(Math.cos(a) * 1.6, 0.6, Math.sin(a) * 1.6), () =>
          b.cylinder("trunk", 0, 1, 0, 0.25, 0.7, 2.6, 6, { flat: true }),
        );
      }
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const r = k === 0 ? 0 : 4;
        b.blob("foliage", Math.cos(a) * r, 16 + rng.range(-1, 2) + (k === 0 ? 2.5 : 0), Math.sin(a) * r, 5, 3.8, 5, jitter(0.2), 1);
      }
      break;
    }
    case "dead": {
      b.cylinder("trunk", 0, 1.8, 0, 0.12, 0.28, 3.6, 6, { flat: true });
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        b.with(new Matrix4().makeRotationY(a).multiply(new Matrix4().makeRotationZ(0.8 + rng.range(-0.2, 0.3))).setPosition(0, 2 + k * 0.3, 0), () =>
          b.cylinder("trunk", 0, 0.7, 0, 0.03, 0.08, 1.4, 4, { flat: true }),
        );
      }
      break;
    }
    case "cactus": {
      b.cylinder("foliage", 0, 2, 0, 0.42, 0.45, 4, 8, { flat: true });
      b.dome("foliage", 0, 4, 0, 0.42, 8, 3);
      for (const [s, h] of [[1, 1.8], [-1, 2.4]] as const) {
        b.cylinder("foliage", s * 0.7, h, 0, 0.26, 0.26, 0.2, 6, { flat: true });
        b.with(new Matrix4().makeRotationZ(s * -Math.PI / 2).setPosition(s * 0.4, h, 0), () => b.cylinder("foliage", 0, 0.3, 0, 0.26, 0.26, 0.6, 6, { flat: true }));
        b.cylinder("foliage", s * 0.75, h + 0.8, 0, 0.26, 0.28, 1.6, 6, { flat: true });
        b.dome("foliage", s * 0.75, h + 1.6, 0, 0.26, 6, 2);
      }
      break;
    }
  }
  const parts = b.buildParts();
  const out: ModelPart[] = [];
  if (parts.has("trunk")) out.push({ geometry: parts.get("trunk")!, material: trunkMat(species === "birch" ? "#e8e4da" : species === "giant" && biome === "fantasy" ? "#5a4636" : "#6b4a32"), tinted: false, castShadow: true });
  if (parts.has("foliage"))
    out.push({
      geometry: parts.get("foliage")!,
      material: species === "cactus" ? getMaterial({ preset: "plastic", color: "#4f8a3a", roughness: 0.8, flatShading: true, noTexture: true }) : foliageMaterial(foliageColor(species, biome), { emissive: species === "giant" && biome === "fantasy" ? "#0b3a2c" : undefined, doubleSide: species === "palm" }),
      tinted: true,
      castShadow: true,
    });
  treeCache.set(key, out);
  return out;
}

const plantCache = new Map<string, ModelPart[]>();

export function getPlantModel(species: PlantSpecies, biome: Biome): ModelPart[] {
  const key = `${species}|${biome}`;
  const hit = plantCache.get(key);
  if (hit) return hit;
  const b = new MeshBuilder();
  const noise = createNoise(species.length * 29);
  const rng = new Rng(species.length * 41);
  const out: ModelPart[] = [];
  switch (species) {
    case "bush": {
      for (let k = 0; k < 3; k++) b.blob("a", rng.range(-0.4, 0.4), 0.5, rng.range(-0.4, 0.4), 0.7, 0.55, 0.7, (x, y, z) => noise.simplex(x * 2, z * 2 + y) * 0.2, 1);
      out.push({ geometry: b.buildParts().get("a")!, material: foliageMaterial(biome === "desert" ? "#7a8a46" : "#3f7a35"), tinted: true });
      break;
    }
    case "grass": {
      for (let k = 0; k < 7; k++) {
        const a = rng.range(0, Math.PI);
        const h = rng.range(0.35, 0.7);
        const c = Math.cos(a) * 0.08, s = Math.sin(a) * 0.08;
        const ox = rng.range(-0.25, 0.25), oz = rng.range(-0.25, 0.25);
        b.tri("a", [ox - c, 0, oz - s], [ox + c, 0, oz + s], [ox + rng.range(-0.1, 0.1), h, oz + rng.range(-0.1, 0.1)]);
      }
      out.push({ geometry: b.buildParts().get("a")!, material: foliageMaterial(biome === "desert" ? "#b5a663" : biome === "snow" ? "#8a9a7a" : "#5f9a3f", { doubleSide: true }), tinted: true, castShadow: false });
      break;
    }
    case "flowers": {
      for (let k = 0; k < 5; k++) {
        const x = rng.range(-0.3, 0.3), z = rng.range(-0.3, 0.3), h = rng.range(0.25, 0.45);
        b.cylinder("stem", x, h / 2, z, 0.015, 0.015, h, 3);
        b.blob("bloom", x, h, z, 0.07, 0.05, 0.07, () => 0, 0);
      }
      const parts = b.buildParts();
      out.push({ geometry: parts.get("stem")!, material: getMaterial({ preset: "plastic", color: "#4f8a35", noTexture: true }), tinted: false, castShadow: false });
      out.push({ geometry: parts.get("bloom")!, material: getMaterial({ preset: "plastic", color: "#ffffff", noTexture: true, roughness: 0.6 }), tinted: true, castShadow: false });
      break;
    }
    case "fern": {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        b.with(new Matrix4().makeRotationY(a), () => {
          b.quad("a", [0, 0.05, -0.05], [0.6, 0.35, -0.12], [0.6, 0.35, 0.12], [0, 0.05, 0.05]);
          b.quad("a", [0, 0.05, 0.05], [0.6, 0.35, 0.12], [0.6, 0.35, -0.12], [0, 0.05, -0.05]);
        });
      }
      out.push({ geometry: b.buildParts().get("a")!, material: foliageMaterial("#3d8a3a", { doubleSide: true }), tinted: true, castShadow: false });
      break;
    }
    case "mushroom": {
      b.cylinder("stem", 0, 0.25, 0, 0.07, 0.1, 0.5, 6);
      b.dome("cap", 0, 0.48, 0, 0.3, 10, 4);
      const parts = b.buildParts();
      out.push({ geometry: parts.get("stem")!, material: getMaterial({ preset: "plastic", color: "#efe6d2", noTexture: true }), tinted: false });
      out.push({ geometry: parts.get("cap")!, material: getMaterial({ preset: "plastic", color: "#ffffff", noTexture: true, emissive: biome === "fantasy" ? "#ffffff" : "#000000", emissiveIntensity: biome === "fantasy" ? 0.5 : 1, tintEmissive: biome === "fantasy" }), tinted: true });
      break;
    }
    case "crystal": {
      for (let k = 0; k < 4; k++) {
        const h = rng.range(0.5, 1.4);
        b.with(new Matrix4().makeRotationZ(rng.range(-0.4, 0.4)).setPosition(rng.range(-0.25, 0.25), 0, rng.range(-0.25, 0.25)), () => {
          b.cylinder("a", 0, h * 0.4, 0, 0.12, 0.08, h * 0.8, 5, { flat: true, top: false });
          b.cylinder("a", 0, h * 0.8 + h * 0.1, 0, 0, 0.12, h * 0.2, 5, { flat: true, bottom: false });
        });
      }
      out.push({ geometry: b.buildParts().get("a")!, material: getMaterial({ preset: "crystal", color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 1.2, noTexture: true, flatShading: true, tintEmissive: true }), tinted: true });
      break;
    }
  }
  plantCache.set(key, out);
  return out;
}

export function plantTint(species: PlantSpecies, seed: number): string {
  const rng = new Rng(seed);
  if (species === "flowers") return rng.pick(["#e8434a", "#f2c12e", "#f5f5f5", "#b06ad9", "#ff8fb1", "#4fa3e8"]);
  if (species === "mushroom") return rng.pick(["#d23c3c", "#e8823a", "#a24bd8", "#36c2b4"]);
  if (species === "crystal") return rng.pick(["#59e0ff", "#b26bff", "#ff6bd1", "#6bffb8"]);
  const v = rng.range(0.82, 1.12);
  return `#${[v, v, v].map((c) => Math.round(Math.min(1, c) * 255).toString(16).padStart(2, "0")).join("")}`;
}

const rockCache = new Map<string, ModelPart[]>();

export function getRockModel(variant: number, biome: Biome): ModelPart[] {
  const key = `${variant}|${biome}`;
  const hit = rockCache.get(key);
  if (hit) return hit;
  const b = new MeshBuilder();
  const noise = createNoise(variant * 7919 + 13);
  b.blob("a", 0, 0.45, 0, 1, 0.75, 1, (x, y, z) => noise.simplex(x * 1.4 + z, y * 1.4) * 0.28 + noise.simplex(x * 3, z * 3) * 0.08, 1);
  const color = biome === "desert" ? "#b0835a" : biome === "alien" ? "#7a3a2c" : biome === "snow" ? "#9aa0a8" : "#878580";
  const out: ModelPart[] = [{ geometry: b.buildParts().get("a")!, material: getMaterial({ preset: "stone", color, flatShading: true, roughness: 0.95 }), tinted: true, castShadow: true }];
  rockCache.set(key, out);
  return out;
}
