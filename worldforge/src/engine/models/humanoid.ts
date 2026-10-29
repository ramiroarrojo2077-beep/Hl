import {
  AnimationClip,
  Bone,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  MeshStandardMaterial,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Vector3,
  VectorKeyframeTrack,
  Euler,
  Matrix4,
} from "three";
import type { NpcAppearance } from "../types";
import { MeshBuilder } from "./builder";

/**
 * Personaje humanoide procedural con esqueleto real (SkinnedMesh + Skeleton)
 * y clips de animación (idle, caminar, correr, saludar, sentarse, interactuar,
 * festejar). Es un modelo low-poly provisional: la arquitectura acepta
 * reemplazarlo por un GLB riggeado con clips de los mismos nombres.
 */

export const BASE_HEIGHT = 1.75;

const BONES = [
  "Hips",
  "Spine",
  "Chest",
  "Neck",
  "Head",
  "UpperArmL",
  "ForeArmL",
  "HandL",
  "UpperArmR",
  "ForeArmR",
  "HandR",
  "ThighL",
  "ShinL",
  "FootL",
  "ThighR",
  "ShinR",
  "FootR",
] as const;
type BoneName = (typeof BONES)[number];
const PARENT: Record<BoneName, BoneName | null> = {
  Hips: null,
  Spine: "Hips",
  Chest: "Spine",
  Neck: "Chest",
  Head: "Neck",
  UpperArmL: "Chest",
  ForeArmL: "UpperArmL",
  HandL: "ForeArmL",
  UpperArmR: "Chest",
  ForeArmR: "UpperArmR",
  HandR: "ForeArmR",
  ThighL: "Hips",
  ShinL: "ThighL",
  FootL: "ShinL",
  ThighR: "Hips",
  ShinR: "ThighR",
  FootR: "ShinR",
};

// Posiciones de reposo en espacio de modelo (altura 1.75 m, mirando a +Z, brazos abajo).
const H = BASE_HEIGHT;
const REST: Record<BoneName, [number, number, number]> = {
  Hips: [0, 0.53 * H, 0],
  Spine: [0, 0.6 * H, 0],
  Chest: [0, 0.7 * H, 0],
  Neck: [0, 0.82 * H, 0],
  Head: [0, 0.86 * H, 0],
  UpperArmL: [0.13 * H, 0.8 * H, 0],
  ForeArmL: [0.14 * H, 0.63 * H, 0],
  HandL: [0.145 * H, 0.48 * H, 0],
  UpperArmR: [-0.13 * H, 0.8 * H, 0],
  ForeArmR: [-0.14 * H, 0.63 * H, 0],
  HandR: [-0.145 * H, 0.48 * H, 0],
  ThighL: [0.055 * H, 0.52 * H, 0],
  ShinL: [0.055 * H, 0.28 * H, 0],
  FootL: [0.055 * H, 0.04 * H, 0],
  ThighR: [-0.055 * H, 0.52 * H, 0],
  ShinR: [-0.055 * H, 0.28 * H, 0],
  FootR: [-0.055 * H, 0.04 * H, 0],
};

const geometryCache = new Map<string, BufferGeometry>();
let sharedMaterial: MeshStandardMaterial | null = null;

function appearanceKey(a: NpcAppearance): string {
  return [a.outfit, a.skin, a.top, a.bottom, a.hair].join("|");
}

function shade(hex: string, f: number): string {
  const c = new Color(hex);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
}

/** Construye la geometría con atributos de piel (un hueso por vértice, peso 1). */
function buildGeometry(a: NpcAppearance): BufferGeometry {
  const b = new MeshBuilder();
  const idx = (n: BoneName) => BONES.indexOf(n);
  const k = (bone: BoneName, color: string) => `${idx(bone)}:${color}`;
  const P = REST;
  const skin = a.skin, top = a.top, bottom = a.bottom, hair = a.hair;
  const shoes = "#2a2522";
  const longSleeves = ["formal", "medieval", "knight", "futuristic", "explorer", "racer", "elf"].includes(a.outfit);
  const sleeve = longSleeves ? top : skin;

  // Piernas
  for (const s of ["L", "R"] as const) {
    const thigh = P[`Thigh${s}`], shin = P[`Shin${s}`], foot = P[`Foot${s}`];
    b.cylinder(k(`Thigh${s}`, bottom), thigh[0], (thigh[1] + shin[1]) / 2, 0, 0.068, 0.058, thigh[1] - shin[1], 8);
    b.cylinder(k(`Shin${s}`, a.outfit === "knight" ? shade(top, 0.9) : bottom), shin[0], (shin[1] + foot[1]) / 2 + 0.02, 0, 0.056, 0.045, shin[1] - foot[1], 8);
    b.box(k(`Foot${s}`, shoes), foot[0], 0.04, 0.04, 0.1, 0.08, 0.24);
  }
  // Pelvis y torso
  b.box(k("Hips", bottom), 0, P.Hips[1] - 0.02, 0, 0.27, 0.16, 0.18);
  b.box(k("Spine", top), 0, (P.Spine[1] + P.Chest[1]) / 2, 0, 0.29, P.Chest[1] - P.Spine[1] + 0.06, 0.18);
  b.box(k("Chest", top), 0, (P.Chest[1] + P.Neck[1]) / 2 - 0.01, 0, 0.36, P.Neck[1] - P.Chest[1] + 0.02, 0.2);
  if (a.outfit === "medieval" || a.outfit === "knight" || a.outfit === "elf") {
    // Túnica o faldón.
    b.cylinder(k("Hips", a.outfit === "knight" ? shade(bottom, 1.2) : top), 0, P.Hips[1] - 0.14, 0, 0.17, 0.22, 0.3, 10);
    b.box(k("Spine", shade(top, 0.6)), 0, P.Spine[1] - 0.02, 0, 0.3, 0.05, 0.19);
  }
  if (a.outfit === "formal") b.box(k("Chest", "#8a1c1c"), 0, P.Chest[1] + 0.03, 0.105, 0.04, 0.16, 0.01);
  if (a.outfit === "worker") {
    b.box(k("Chest", "#f2d230"), 0, P.Chest[1] + 0.01, 0, 0.37, 0.12, 0.205);
    b.box(k("Spine", "#f2d230"), 0, P.Spine[1] + 0.05, 0, 0.3, 0.06, 0.185);
  }
  if (a.outfit === "explorer") b.box(k("Chest", shade(top, 0.7)), 0, P.Chest[1], -0.15, 0.26, 0.3, 0.12);
  if (a.outfit === "futuristic") {
    b.box(k("Chest", "#3df5ff"), 0, P.Chest[1] + 0.02, 0.102, 0.3, 0.02, 0.005);
    b.box(k("Spine", "#3df5ff"), 0.1, P.Spine[1] + 0.05, 0.092, 0.02, 0.14, 0.005);
  }
  // Brazos
  for (const s of ["L", "R"] as const) {
    const up = P[`UpperArm${s}`], fore = P[`ForeArm${s}`], hand = P[`Hand${s}`];
    b.cylinder(k(`UpperArm${s}`, top), up[0], (up[1] + fore[1]) / 2, 0, 0.052, 0.045, up[1] - fore[1] + 0.02, 7);
    b.cylinder(k(`ForeArm${s}`, a.outfit === "knight" ? shade(top, 0.85) : sleeve), fore[0], (fore[1] + hand[1]) / 2, 0, 0.042, 0.036, fore[1] - hand[1], 7);
    b.box(k(`Hand${s}`, a.outfit === "knight" ? shade(top, 0.7) : skin), hand[0], hand[1] - 0.05, 0, 0.06, 0.1, 0.08);
  }
  // Cuello y cabeza
  b.cylinder(k("Neck", skin), 0, (P.Neck[1] + P.Head[1]) / 2, 0, 0.045, 0.05, 0.08, 7);
  const hy = P.Head[1] + 0.11;
  b.blob(k("Head", skin), 0, hy, 0.01, 0.1, 0.12, 0.11, () => 0, 1);
  b.box(k("Head", "#1b1b1b"), 0.035, hy + 0.02, 0.105, 0.022, 0.018, 0.01);
  b.box(k("Head", "#1b1b1b"), -0.035, hy + 0.02, 0.105, 0.022, 0.018, 0.01);
  b.box(k("Head", shade(skin, 0.92)), 0, hy - 0.01, 0.115, 0.022, 0.035, 0.02);
  switch (a.outfit) {
    case "knight":
      b.cylinder(k("Head", "#c9a227"), 0, hy + 0.02, 0, 0.125, 0.125, 0.25, 10);
      b.box(k("Head", "#1b1b1b"), 0, hy + 0.03, 0.124, 0.16, 0.025, 0.01);
      b.cylinder(k("Head", "#c9a227"), 0, hy + 0.16, 0, 0.05, 0.125, 0.04, 10);
      break;
    case "racer":
      b.blob(k("Head", top), 0, hy + 0.01, 0, 0.135, 0.14, 0.14, () => 0, 1);
      b.box(k("Head", "#111111"), 0, hy + 0.02, 0.12, 0.16, 0.06, 0.03);
      break;
    case "worker":
      b.dome(k("Head", "#f2c12e"), 0, hy + 0.05, 0, 0.13, 10, 4);
      break;
    case "explorer":
      b.dome(k("Head", "#e9e3d2"), 0, hy + 0.05, 0, 0.125, 10, 4);
      b.cylinder(k("Head", "#e9e3d2"), 0, hy + 0.05, 0, 0.17, 0.17, 0.015, 12);
      break;
    case "elf":
      b.dome(k("Head", hair), 0, hy + 0.03, -0.01, 0.112, 10, 4);
      b.cylinder(k("Head", skin), 0.1, hy + 0.06, 0, 0, 0.02, 0.09, 4);
      b.cylinder(k("Head", skin), -0.1, hy + 0.06, 0, 0, 0.02, 0.09, 4);
      break;
    default:
      b.dome(k("Head", hair), 0, hy + 0.03, -0.012, 0.11, 10, 4);
      b.box(k("Head", hair), 0, hy - 0.02, -0.07, 0.19, 0.11, 0.06);
  }

  // Fusionar con colores y pesos de piel.
  const parts = b.buildParts();
  let total = 0;
  for (const g of parts.values()) total += g.getAttribute("position").count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const si = new Uint16Array(total * 4);
  const sw = new Float32Array(total * 4);
  let o = 0;
  const c = new Color();
  for (const [key, g] of parts) {
    const [boneStr, hex] = key.split(":");
    const bone = Number(boneStr);
    c.set(hex!);
    const p = g.getAttribute("position").array as Float32Array;
    const n = g.getAttribute("normal").array as Float32Array;
    const count = p.length / 3;
    pos.set(p, o * 3);
    nor.set(n, o * 3);
    for (let i = 0; i < count; i++) {
      col[(o + i) * 3] = c.r;
      col[(o + i) * 3 + 1] = c.g;
      col[(o + i) * 3 + 2] = c.b;
      si[(o + i) * 4] = bone;
      sw[(o + i) * 4] = 1;
    }
    o += count;
    g.dispose();
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  geo.setAttribute("normal", new BufferAttribute(nor, 3));
  geo.setAttribute("color", new BufferAttribute(col, 3));
  geo.setAttribute("skinIndex", new BufferAttribute(si, 4));
  geo.setAttribute("skinWeight", new BufferAttribute(sw, 4));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function createSkeleton(): { bones: Bone[]; root: Bone } {
  const bones: Bone[] = [];
  const byName = new Map<BoneName, Bone>();
  for (const name of BONES) {
    const bone = new Bone();
    bone.name = name;
    const parent = PARENT[name];
    const p = REST[name];
    if (parent) {
      const pp = REST[parent];
      bone.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
      byName.get(parent)!.add(bone);
    } else bone.position.set(p[0], p[1], p[2]);
    byName.set(name, bone);
    bones.push(bone);
  }
  return { bones, root: byName.get("Hips")! };
}

export interface HumanoidInstance {
  group: Group;
  mesh: SkinnedMesh;
}

export function createHumanoid(a: NpcAppearance): HumanoidInstance {
  const key = appearanceKey(a);
  let geo = geometryCache.get(key);
  if (!geo) {
    geo = buildGeometry(a);
    geometryCache.set(key, geo);
  }
  if (!sharedMaterial) sharedMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05, flatShading: true });
  const { bones, root } = createSkeleton();
  const mesh = new SkinnedMesh(geo, sharedMaterial);
  mesh.add(root);
  mesh.bind(new Skeleton(bones));
  mesh.castShadow = true;
  mesh.frustumCulled = false; // los huesos mueven vértices fuera del bounding box de reposo
  const group = new Group();
  group.add(mesh);
  mesh.scale.set(a.build, a.height / BASE_HEIGHT, a.build);
  return { group, mesh };
}

// ---------- Clips de animación ----------

const q = (x: number, y: number, z: number) => new Quaternion().setFromEuler(new Euler(x, y, z, "XYZ"));

function track(bone: BoneName, times: number[], rots: [number, number, number][]): QuaternionKeyframeTrack {
  const values: number[] = [];
  for (const r of rots) values.push(...q(r[0], r[1], r[2]).toArray());
  return new QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
}

function hipsTrack(times: number[], ys: number[], zs?: number[]): VectorKeyframeTrack {
  const base = REST.Hips;
  const values: number[] = [];
  ys.forEach((y, i) => values.push(base[0], base[1] + y, base[2] + (zs?.[i] ?? 0)));
  return new VectorKeyframeTrack("Hips.position", times, values);
}

/** Ciclo de marcha paramétrico (caminar o correr). */
function gaitClip(name: string, period: number, legAmp: number, kneeAmp: number, armAmp: number, lean: number, bob: number): AnimationClip {
  const n = 8;
  const times: number[] = [];
  const thighL: [number, number, number][] = [], thighR: [number, number, number][] = [];
  const shinL: [number, number, number][] = [], shinR: [number, number, number][] = [];
  const armL: [number, number, number][] = [], armR: [number, number, number][] = [];
  const foreL: [number, number, number][] = [], foreR: [number, number, number][] = [];
  const spine: [number, number, number][] = [];
  const footL: [number, number, number][] = [], footR: [number, number, number][] = [];
  const ys: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * period;
    const ph = (i / n) * Math.PI * 2;
    times.push(t);
    const sL = Math.sin(ph), sR = Math.sin(ph + Math.PI);
    thighL.push([-sL * legAmp, 0, 0]);
    thighR.push([-sR * legAmp, 0, 0]);
    // La rodilla se flexiona cuando la pierna pasa hacia adelante.
    shinL.push([Math.max(0, Math.cos(ph)) * kneeAmp + 0.05, 0, 0]);
    shinR.push([Math.max(0, Math.cos(ph + Math.PI)) * kneeAmp + 0.05, 0, 0]);
    footL.push([Math.sin(ph) * 0.2, 0, 0]);
    footR.push([Math.sin(ph + Math.PI) * 0.2, 0, 0]);
    armL.push([sL * armAmp, 0, 0.06]);
    armR.push([sR * armAmp, 0, -0.06]);
    foreL.push([-0.25 - armAmp * 0.6 - Math.max(0, sL) * armAmp * 0.4, 0, 0]);
    foreR.push([-0.25 - armAmp * 0.6 - Math.max(0, sR) * armAmp * 0.4, 0, 0]);
    spine.push([lean, Math.sin(ph) * 0.08, 0]);
    ys.push(-Math.abs(Math.cos(ph)) * bob);
  }
  return new AnimationClip(name, period, [
    track("ThighL", times, thighL),
    track("ThighR", times, thighR),
    track("ShinL", times, shinL),
    track("ShinR", times, shinR),
    track("FootL", times, footL),
    track("FootR", times, footR),
    track("UpperArmL", times, armL),
    track("UpperArmR", times, armR),
    track("ForeArmL", times, foreL),
    track("ForeArmR", times, foreR),
    track("Spine", times, spine),
    hipsTrack(times, ys),
  ]);
}

let clips: Record<string, AnimationClip> | null = null;

export type HumanoidClip = "idle" | "walk" | "run" | "wave" | "sit" | "interact" | "cheer" | "turn";

export function humanoidClips(): Record<HumanoidClip, AnimationClip> {
  if (clips) return clips as Record<HumanoidClip, AnimationClip>;
  const idle = new AnimationClip("idle", 3, [
    track("Chest", [0, 1.5, 3], [[0.02, 0, 0], [-0.02, 0, 0], [0.02, 0, 0]]),
    track("UpperArmL", [0, 1.5, 3], [[0, 0, 0.08], [0.04, 0, 0.11], [0, 0, 0.08]]),
    track("UpperArmR", [0, 1.5, 3], [[0, 0, -0.08], [0.04, 0, -0.11], [0, 0, -0.08]]),
    track("ForeArmL", [0, 3], [[-0.15, 0, 0], [-0.15, 0, 0]]),
    track("ForeArmR", [0, 3], [[-0.15, 0, 0], [-0.15, 0, 0]]),
    track("Head", [0, 1, 2, 3], [[0, 0, 0], [0, 0.25, 0], [0, -0.2, 0], [0, 0, 0]]),
    hipsTrack([0, 1.5, 3], [0, -0.008, 0]),
  ]);
  const walk = gaitClip("walk", 1.05, 0.5, 0.75, 0.42, 0.04, 0.035);
  const run = gaitClip("run", 0.66, 0.85, 1.35, 0.9, 0.22, 0.07);
  const turn = gaitClip("turn", 0.8, 0.18, 0.3, 0.1, 0, 0.01);
  const wave = new AnimationClip("wave", 1.4, [
    track("UpperArmR", [0, 0.35, 0.7, 1.05, 1.4], [[0, 0, -2.5], [0, 0, -2.7], [0, 0, -2.5], [0, 0, -2.7], [0, 0, -2.5]]),
    track("ForeArmR", [0, 0.35, 0.7, 1.05, 1.4], [[0, 0, -0.6], [0, 0, 0.2], [0, 0, -0.6], [0, 0, 0.2], [0, 0, -0.6]]),
    track("UpperArmL", [0, 1.4], [[0, 0, 0.08], [0, 0, 0.08]]),
    track("Head", [0, 1.4], [[-0.05, 0, 0.05], [-0.05, 0, 0.05]]),
  ]);
  const sit = new AnimationClip("sit", 2, [
    track("ThighL", [0, 2], [[-1.5, 0, 0.05], [-1.5, 0, 0.05]]),
    track("ThighR", [0, 2], [[-1.5, 0, -0.05], [-1.5, 0, -0.05]]),
    track("ShinL", [0, 2], [[1.45, 0, 0], [1.45, 0, 0]]),
    track("ShinR", [0, 2], [[1.45, 0, 0], [1.45, 0, 0]]),
    track("UpperArmL", [0, 2], [[-0.35, 0, 0.1], [-0.35, 0, 0.1]]),
    track("UpperArmR", [0, 2], [[-0.35, 0, -0.1], [-0.35, 0, -0.1]]),
    track("ForeArmL", [0, 2], [[-0.6, 0, 0], [-0.6, 0, 0]]),
    track("ForeArmR", [0, 2], [[-0.6, 0, 0], [-0.6, 0, 0]]),
    track("Chest", [0, 1, 2], [[0.02, 0, 0], [-0.01, 0, 0], [0.02, 0, 0]]),
    hipsTrack([0, 2], [-0.45, -0.45], [-0.05, -0.05]),
  ]);
  const interact = new AnimationClip("interact", 1.6, [
    track("UpperArmR", [0, 0.8, 1.6], [[-1.1, 0, -0.1], [-1.25, 0, -0.15], [-1.1, 0, -0.1]]),
    track("ForeArmR", [0, 0.8, 1.6], [[-0.5, 0, 0], [-0.2, 0, 0], [-0.5, 0, 0]]),
    track("UpperArmL", [0, 0.8, 1.6], [[-0.6, 0, 0.1], [-0.7, 0, 0.12], [-0.6, 0, 0.1]]),
    track("ForeArmL", [0, 1.6], [[-0.8, 0, 0], [-0.8, 0, 0]]),
    track("Chest", [0, 0.8, 1.6], [[0.12, 0, 0], [0.18, 0, 0], [0.12, 0, 0]]),
  ]);
  const cheer = new AnimationClip("cheer", 0.8, [
    track("UpperArmL", [0, 0.4, 0.8], [[0, 0, 2.6], [0, 0, 2.9], [0, 0, 2.6]]),
    track("UpperArmR", [0, 0.4, 0.8], [[0, 0, -2.6], [0, 0, -2.9], [0, 0, -2.6]]),
    track("ForeArmL", [0, 0.8], [[0, 0, 0.3], [0, 0, 0.3]]),
    track("ForeArmR", [0, 0.8], [[0, 0, -0.3], [0, 0, -0.3]]),
    hipsTrack([0, 0.4, 0.8], [0, 0.06, 0]),
  ]);
  clips = { idle, walk, run, turn, wave, sit, interact, cheer };
  return clips as Record<HumanoidClip, AnimationClip>;
}

/** Velocidad de avance natural de cada clip de marcha (m/s), para ajustar el ritmo. */
export const GAIT_SPEED = { walk: 1.35, run: 4.2, turn: 0.4 } as const;

export const _internals = { REST, BONES, createSkeleton, Vector3, Matrix4 };
