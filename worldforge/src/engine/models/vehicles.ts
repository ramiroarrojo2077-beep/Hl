import { Matrix4 } from "three";
import type { VehicleModel } from "../types";
import { MeshBuilder } from "./builder";
import { getMaterial, registerNightMaterial } from "./materials";
import type { ModelPart } from "./vegetation";

/**
 * Vehículos low-poly. La carrocería (parte "paint") se tiñe con el color de la
 * entidad; las ruedas son geometría aparte para poder girarlas. El frente
 * mira a +Z.
 */

export interface VehicleModelDef {
  body: ModelPart[];
  wheels: { parts: ModelPart[]; positions: [number, number, number][]; radius: number; steer: boolean[] } | null;
  length: number;
  width: number;
  height: number;
  hover: number; // altura de flotación (vehículos sin ruedas)
}

const cache = new Map<VehicleModel, VehicleModelDef>();

const mats = {
  paint: () => getMaterial({ preset: "metal", color: "#ffffff", roughness: 0.32, metalness: 0.55, noTexture: true }),
  glass: () => getMaterial({ preset: "glass", color: "#1c2733", roughness: 0.05, metalness: 0.9, noTexture: true }),
  trim: () => getMaterial({ preset: "plastic", color: "#1d1f23", roughness: 0.6, noTexture: true }),
  chrome: () => getMaterial({ preset: "metal", color: "#c9ced6", roughness: 0.2, metalness: 1, noTexture: true }),
  head: () => registerNightMaterial(getMaterial({ preset: "plastic", color: "#fffbe8", emissive: "#fff2c0", emissiveIntensity: 0.4, noTexture: true }), 0.3, 3),
  tail: () => registerNightMaterial(getMaterial({ preset: "plastic", color: "#c41f1f", emissive: "#ff1a1a", emissiveIntensity: 0.4, noTexture: true }), 0.4, 2.2),
  glow: () => getMaterial({ preset: "plastic", color: "#ffffff", emissive: "#3df5ff", emissiveIntensity: 2.8, noTexture: true }),
  cargo: () => getMaterial({ preset: "metal", color: "#e6e8ec", roughness: 0.5, metalness: 0.3 }),
  wood: () => getMaterial({ preset: "wood", color: "#8a6440" }),
  tire: () => getMaterial({ preset: "plastic", color: "#18191b", roughness: 0.9, noTexture: true, flatShading: true }),
  hub: () => getMaterial({ preset: "metal", color: "#b9bec6", roughness: 0.3, metalness: 0.9, noTexture: true }),
};

/** Cabina trapezoidal: base y techo rectangulares de distinto tamaño. */
function cabin(b: MeshBuilder, glassKey: string, roofKey: string, z0: number, z1: number, y0: number, y1: number, w0: number, w1: number, slantF: number, slantB: number) {
  const bx = w0 / 2, tx = w1 / 2;
  const tz0 = z0 + slantB, tz1 = z1 - slantF;
  const B = { fl: [-bx, y0, z1], fr: [bx, y0, z1], bl: [-bx, y0, z0], br: [bx, y0, z0] };
  const T = { fl: [-tx, y1, tz1], fr: [tx, y1, tz1], bl: [-tx, y1, tz0], br: [tx, y1, tz0] };
  b.quad(glassKey, B.fl, B.fr, T.fr, T.fl); // parabrisas
  b.quad(glassKey, B.br, B.bl, T.bl, T.br); // luneta
  b.quad(glassKey, B.fr, B.br, T.br, T.fr); // lateral derecho
  b.quad(glassKey, B.bl, B.fl, T.fl, T.bl); // lateral izquierdo
  b.quad(roofKey, T.fl, T.fr, T.br, T.bl);
}

function wheelParts(radius: number, width: number): ModelPart[] {
  const b = new MeshBuilder();
  b.with(new Matrix4().makeRotationZ(Math.PI / 2), () => {
    b.cylinder("tire", 0, 0, 0, radius, radius, width, 14, { flat: true });
    b.cylinder("hub", 0, 0, 0, radius * 0.55, radius * 0.55, width + 0.02, 10);
  });
  const g = b.buildParts();
  return [
    { geometry: g.get("tire")!, material: mats.tire(), tinted: false, castShadow: true },
    { geometry: g.get("hub")!, material: mats.hub(), tinted: false, castShadow: false },
  ];
}

export function getVehicleModel(model: VehicleModel): VehicleModelDef {
  const hit = cache.get(model);
  if (hit) return hit;
  const def = buildVehicle(model);
  cache.set(model, def);
  return def;
}

function finish(b: MeshBuilder): ModelPart[] {
  const g = b.buildParts();
  const map: Record<string, () => ModelPart["material"]> = mats;
  const out: ModelPart[] = [];
  for (const [key, geo] of g) out.push({ geometry: geo, material: map[key]!(), tinted: key === "paint", castShadow: key !== "head" && key !== "tail" && key !== "glow" });
  return out;
}

function carLights(b: MeshBuilder, L: number, W: number, y: number) {
  for (const s of [-1, 1]) {
    b.box("head", s * (W / 2 - 0.3), y, L / 2 + 0.01, 0.35, 0.14, 0.04);
    b.box("tail", s * (W / 2 - 0.25), y, -L / 2 - 0.01, 0.35, 0.14, 0.04);
  }
}

function buildVehicle(model: VehicleModel): VehicleModelDef {
  const b = new MeshBuilder();
  const four = (W: number, L: number, r: number, frontZ = 0.32, backZ = 0.32): [number, number, number][] => [
    [W / 2 - 0.12, r, L * frontZ],
    [-W / 2 + 0.12, r, L * frontZ],
    [W / 2 - 0.12, r, -L * backZ],
    [-W / 2 + 0.12, r, -L * backZ],
  ];
  const steer4 = [true, true, false, false];
  switch (model) {
    case "sedan":
    case "taxi": {
      const L = 4.5, W = 1.8;
      b.box("paint", 0, 0.68, 0, W, 0.66, L);
      b.box("trim", 0, 0.42, L / 2 + 0.05, W - 0.1, 0.22, 0.12);
      b.box("trim", 0, 0.42, -L / 2 - 0.05, W - 0.1, 0.22, 0.12);
      cabin(b, "glass", "paint", -1.3, 0.9, 1.01, 1.46, W - 0.12, W - 0.36, 0.55, 0.4);
      carLights(b, L, W, 0.8);
      if (model === "taxi") {
        b.box("trim", 0, 1.55, -0.15, 0.7, 0.18, 0.3);
        b.box("head", 0, 1.56, -0.15, 0.6, 0.12, 0.31);
      }
      return { body: finish(b), wheels: { parts: wheelParts(0.34, 0.24), positions: four(W, L, 0.34), radius: 0.34, steer: steer4 }, length: L, width: W, height: 1.5, hover: 0 };
    }
    case "suv": {
      const L = 4.7, W = 1.92;
      b.box("paint", 0, 0.8, 0, W, 0.8, L);
      b.box("trim", 0, 0.48, L / 2 + 0.05, W, 0.3, 0.14);
      b.box("trim", 0, 0.48, -L / 2 - 0.05, W, 0.3, 0.14);
      cabin(b, "glass", "paint", -2.1, 1.0, 1.2, 1.78, W - 0.1, W - 0.2, 0.5, 0.1);
      b.box("trim", 0, 1.82, -0.5, W - 0.4, 0.05, 2);
      carLights(b, L, W, 0.95);
      return { body: finish(b), wheels: { parts: wheelParts(0.4, 0.28), positions: four(W, L, 0.4), radius: 0.4, steer: steer4 }, length: L, width: W, height: 1.85, hover: 0 };
    }
    case "van": {
      const L = 5, W = 2;
      b.box("paint", 0, 1.3, -0.3, W, 1.9, L - 0.6);
      b.box("paint", 0, 0.75, L / 2 - 0.4, W, 0.8, 0.8);
      cabin(b, "glass", "paint", L / 2 - 1.2, L / 2 - 0.3, 1.15, 2.2, W - 0.05, W - 0.05, 0.6, 0);
      for (const s of [-1, 1]) b.quad("glass", s > 0 ? [W / 2 + 0.01, 1.5, 0.8] : [-W / 2 - 0.01, 1.5, -0.6], s > 0 ? [W / 2 + 0.01, 1.5, -0.6] : [-W / 2 - 0.01, 1.5, 0.8], s > 0 ? [W / 2 + 0.01, 2, -0.6] : [-W / 2 - 0.01, 2, 0.8], s > 0 ? [W / 2 + 0.01, 2, 0.8] : [-W / 2 - 0.01, 2, -0.6]);
      carLights(b, L, W, 0.85);
      return { body: finish(b), wheels: { parts: wheelParts(0.38, 0.26), positions: four(W, L, 0.38), radius: 0.38, steer: steer4 }, length: L, width: W, height: 2.3, hover: 0 };
    }
    case "bus": {
      const L = 11, W = 2.5;
      b.box("paint", 0, 1.75, 0, W, 2.7, L);
      for (const s of [-1, 1]) {
        const x = s * (W / 2 + 0.01);
        const z0 = -L / 2 + 0.8, z1 = L / 2 - 1.2;
        b.quad("glass", s > 0 ? [x, 1.7, z1] : [x, 1.7, z0], s > 0 ? [x, 1.7, z0] : [x, 1.7, z1], s > 0 ? [x, 2.75, z0] : [x, 2.75, z1], s > 0 ? [x, 2.75, z1] : [x, 2.75, z0]);
      }
      b.quad("glass", [-W / 2 + 0.1, 1.2, L / 2 + 0.01], [W / 2 - 0.1, 1.2, L / 2 + 0.01], [W / 2 - 0.1, 2.9, L / 2 + 0.01], [-W / 2 + 0.1, 2.9, L / 2 + 0.01]);
      b.box("trim", 0, 0.55, L / 2 + 0.05, W, 0.3, 0.1);
      b.box("head", 0, 3.0, L / 2 + 0.02, 1.4, 0.2, 0.04);
      carLights(b, L, W, 0.8);
      return { body: finish(b), wheels: { parts: wheelParts(0.52, 0.32), positions: four(W, L, 0.52, 0.34, 0.3), radius: 0.52, steer: steer4 }, length: L, width: W, height: 3.1, hover: 0 };
    }
    case "truck": {
      const L = 7.5, W = 2.4;
      b.box("paint", 0, 1.35, L / 2 - 1.1, W, 1.9, 2.2);
      cabin(b, "glass", "paint", L / 2 - 1.3, L / 2 - 0.05, 2.3, 3, W - 0.05, W - 0.15, 0.25, 0);
      b.box("cargo", 0, 2, -0.95, W, 3, L - 2.6);
      b.box("trim", 0, 0.6, -0.4, W - 0.4, 0.3, L - 0.5);
      carLights(b, L, W, 0.85);
      return { body: finish(b), wheels: { parts: wheelParts(0.5, 0.32), positions: [...four(W, L, 0.5, 0.36, 0.3), [W / 2 - 0.12, 0.5, -L * 0.15], [-W / 2 + 0.12, 0.5, -L * 0.15]], radius: 0.5, steer: [true, true, false, false, false, false] }, length: L, width: W, height: 3.5, hover: 0 };
    }
    case "sports": {
      const L = 4.4, W = 1.92;
      b.box("paint", 0, 0.55, 0, W, 0.5, L);
      b.pyramid("paint", 0, 0.8, 1.2, W - 0.1, 1.6, 0.08);
      cabin(b, "glass", "paint", -1.1, 0.6, 0.8, 1.18, W - 0.2, W - 0.6, 0.65, 0.6);
      b.box("trim", 0, 1.05, -L / 2 + 0.2, W - 0.2, 0.06, 0.4);
      for (const s of [-1, 1]) b.box("trim", s * 0.7, 0.92, -L / 2 + 0.25, 0.06, 0.25, 0.06);
      carLights(b, L, W, 0.62);
      return { body: finish(b), wheels: { parts: wheelParts(0.34, 0.28), positions: four(W, L, 0.34), radius: 0.34, steer: steer4 }, length: L, width: W, height: 1.2, hover: 0 };
    }
    case "race": {
      const L = 4.9, W = 1.95;
      b.box("paint", 0, 0.4, 0.3, 0.5, 0.3, 3.8);
      b.box("paint", 0, 0.5, -0.6, 1.1, 0.45, 2);
      b.box("trim", 0, 0.75, -0.1, 0.45, 0.25, 0.8);
      b.box("paint", 0, 0.9, -1.0, 0.35, 0.5, 0.9);
      b.box("trim", 0, 0.2, L / 2 - 0.15, W - 0.2, 0.05, 0.45);
      b.box("paint", 0, 0.23, L / 2 - 0.15, 0.4, 0.08, 0.5);
      b.box("paint", 0, 1.05, -L / 2 + 0.3, W - 0.4, 0.06, 0.5);
      for (const s of [-1, 1]) b.box("trim", s * 0.65, 0.85, -L / 2 + 0.3, 0.04, 0.4, 0.5);
      b.box("tail", 0, 0.5, -L / 2 + 0.05, 0.2, 0.1, 0.04);
      return { body: finish(b), wheels: { parts: wheelParts(0.36, 0.38), positions: four(W, L, 0.36, 0.33, 0.3), radius: 0.36, steer: steer4 }, length: L, width: W, height: 1.1, hover: 0 };
    }
    case "hover": {
      const L = 4.6, W = 2;
      b.box("paint", 0, 0.45, -0.2, W, 0.5, L - 0.4);
      b.pyramid("paint", 0, 0.2, L / 2 - 0.3, W, 0.8, 0.5);
      cabin(b, "glass", "glass", -1.2, 1.1, 0.7, 1.25, W - 0.3, W - 0.7, 0.8, 0.5);
      for (const s of [-1, 1]) b.box("glow", s * (W / 2 - 0.2), 0.16, 0, 0.12, 0.06, L - 0.8);
      b.box("glow", 0, 0.5, -L / 2 + 0.18, W - 0.2, 0.1, 0.04);
      return { body: finish(b), wheels: null, length: L, width: W, height: 1.3, hover: 0.7 };
    }
    case "rover": {
      const L = 4.6, W = 2.4;
      b.box("paint", 0, 1, 0, W - 0.4, 0.5, L);
      b.box("paint", 0, 1.6, 0.6, W - 0.6, 0.8, 2);
      b.quad("glass", [-W / 2 + 0.31, 1.3, 1.61], [W / 2 - 0.31, 1.3, 1.61], [W / 2 - 0.31, 1.95, 1.61], [-W / 2 + 0.31, 1.95, 1.61]);
      b.cylinder("trim", 0.6, 2.6, -0.5, 0.03, 0.03, 1.4, 4);
      b.dome("chrome", 0.6, 3.3, -0.5, 0.25, 8, 3);
      b.box("head", 0, 1.3, L / 2 + 0.01, 1.2, 0.12, 0.04);
      const r = 0.48;
      const pos: [number, number, number][] = [];
      for (const z of [L * 0.35, 0, -L * 0.35]) for (const s of [-1, 1]) pos.push([s * (W / 2 - 0.15), r, z]);
      return { body: finish(b), wheels: { parts: wheelParts(r, 0.36), positions: pos, radius: r, steer: [true, true, false, false, false, false] }, length: L, width: W, height: 3.4, hover: 0 };
    }
    case "ship": {
      const L = 9;
      b.with(new Matrix4().makeRotationX(Math.PI / 2), () => {
        b.cylinder("paint", 0, 0, 0, 0.9, 1.1, L * 0.7, 12, { flat: true });
        b.cylinder("paint", 0, L * 0.35 + 1, 0, 0.9, 0, 2, 12, { flat: true, top: false });
      });
      b.dome("glass", 0, 0.6, 1.5, 0.75, 10, 4);
      for (const s of [-1, 1]) {
        b.tri("paint", [s * 0.9, 0, 1.5], [s * 4.2, -0.1, -2.6], [s * 0.9, 0, -3]);
        b.tri("paint", [s * 0.9, 0, -3], [s * 4.2, -0.1, -2.6], [s * 0.9, 0, 1.5]);
        b.with(new Matrix4().makeRotationX(Math.PI / 2).setPosition(s * 2.2, 0, -2.8), () => b.cylinder("trim", 0, 0, 0, 0.45, 0.5, 1.6, 10));
        b.box("glow", s * 2.2, 0, -3.62, 0.7, 0.7, 0.04);
      }
      b.tri("paint", [0, 0.8, -1.5], [0, 2.2, -3.6], [0, 0.8, -3.4]);
      b.tri("paint", [0, 0.8, -3.4], [0, 2.2, -3.6], [0, 0.8, -1.5]);
      return { body: finish(b), wheels: null, length: L, width: 8.4, height: 2.4, hover: 0 };
    }
    case "motorcycle": {
      const L = 2.1;
      b.box("paint", 0, 0.75, 0.1, 0.32, 0.35, 1);
      b.box("trim", 0, 0.95, -0.35, 0.3, 0.12, 0.7);
      b.box("chrome", 0, 0.55, 0, 0.25, 0.25, 0.5);
      b.box("trim", 0, 1.1, 0.75, 0.7, 0.05, 0.05);
      b.box("head", 0, 0.95, 0.85, 0.16, 0.16, 0.05);
      return { body: finish(b), wheels: { parts: wheelParts(0.32, 0.12), positions: [[0, 0.32, 0.72], [0, 0.32, -0.72]], radius: 0.32, steer: [true, false] }, length: L, width: 0.75, height: 1.2, hover: 0 };
    }
    case "cart": {
      b.box("wood", 0, 0.9, 0, 1.5, 0.12, 2.2);
      for (const s of [-1, 1]) b.box("wood", s * 0.72, 1.15, 0, 0.06, 0.5, 2.2);
      b.box("wood", 0, 1.15, -1.07, 1.5, 0.5, 0.06);
      for (const s of [-1, 1]) b.box("wood", s * 0.4, 0.75, 1.8, 0.07, 0.07, 1.6);
      return { body: finish(b), wheels: { parts: wheelParts(0.6, 0.1), positions: [[0.85, 0.6, -0.2], [-0.85, 0.6, -0.2]], radius: 0.6, steer: [false, false] }, length: 3, width: 1.8, height: 1.4, hover: 0 };
    }
  }
}
