import { Matrix4 } from "three";
import type { PropKind } from "../types";
import { MeshBuilder } from "./builder";
import { getMaterial, registerNightMaterial } from "./materials";
import type { ModelPart } from "./vegetation";

/**
 * Mobiliario urbano y decoración. Cada objeto tiene partes con material fijo o
 * teñido por instancia (color editable de la entidad).
 *
 * Las partes "signal" de los semáforos se recolorean en cada cuadro según la
 * simulación (verde, amarillo, rojo).
 */

export interface PropModel {
  parts: (ModelPart & { role?: "lamp" | "signal" | "water" })[];
  /** Altura aproximada de la fuente de luz (para el pool de luces dinámicas). */
  lightAt?: [number, number, number];
  collider?: { center: [number, number, number]; size: [number, number, number] };
}

const cache = new Map<PropKind, PropModel>();

const METAL_DARK = () => getMaterial({ preset: "metal", color: "#2f343b", roughness: 0.5 });
const WOOD = () => getMaterial({ preset: "wood", color: "#8a6440" });
const STONE = () => getMaterial({ preset: "stone", color: "#b8b2a6" });
const TINT = () => getMaterial({ preset: "plastic", color: "#ffffff", noTexture: true });
const TINT_FABRIC = () => getMaterial({ preset: "fabric", color: "#ffffff", doubleSide: true });
export const LAMP_MATERIAL = () =>
  registerNightMaterial(getMaterial({ preset: "plastic", color: "#fff2d0", emissive: "#ffd28a", emissiveIntensity: 0.2, noTexture: true, roughness: 0.3 }), 0.15, 3.2);
const WATER = () => getMaterial({ preset: "glass", color: "#6fb8d8", roughness: 0.05, metalness: 0.1, opacity: 0.75, noTexture: true });
const NEON = () => getMaterial({ preset: "plastic", color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 2.2, noTexture: true, tintEmissive: true });

export function getPropModel(kind: PropKind): PropModel {
  const hit = cache.get(kind);
  if (hit) return hit;
  const model = buildProp(kind);
  cache.set(kind, model);
  return model;
}

function parts(b: MeshBuilder, spec: Record<string, { material: ModelPart["material"]; tinted?: boolean; role?: "lamp" | "signal" | "water"; castShadow?: boolean }>): PropModel["parts"] {
  const geo = b.buildParts();
  const out: PropModel["parts"] = [];
  for (const [key, s] of Object.entries(spec)) {
    const g = geo.get(key);
    if (g) out.push({ geometry: g, material: s.material, tinted: s.tinted ?? false, role: s.role, castShadow: s.castShadow ?? true });
  }
  return out;
}

function buildProp(kind: PropKind): PropModel {
  const b = new MeshBuilder();
  switch (kind) {
    case "streetlight": {
      b.cylinder("pole", 0, 3.5, 0, 0.07, 0.11, 7, 8);
      b.cylinder("pole", 0, 0.25, 0, 0.18, 0.2, 0.5, 8);
      b.box("pole", 0, 6.95, 0.7, 0.1, 0.1, 1.5);
      b.box("pole", 0, 6.85, 1.45, 0.45, 0.16, 0.7);
      b.box("lamp", 0, 6.74, 1.45, 0.36, 0.06, 0.56);
      return { parts: parts(b, { pole: { material: METAL_DARK() }, lamp: { material: LAMP_MATERIAL(), role: "lamp", castShadow: false } }), lightAt: [0, 6.5, 1.45], collider: { center: [0, 3.5, 0], size: [0.3, 7, 0.3] } };
    }
    case "lantern": {
      b.cylinder("pole", 0, 1.6, 0, 0.06, 0.08, 3.2, 6);
      b.box("pole", 0, 3.25, 0.35, 0.06, 0.06, 0.7);
      b.cylinder("lamp", 0, 2.85, 0.65, 0.22, 0.22, 0.55, 10);
      return { parts: parts(b, { pole: { material: WOOD() }, lamp: { material: registerNightMaterial(getMaterial({ preset: "fabric", color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.4, tintEmissive: true }), 0.3, 2.6), tinted: true, role: "lamp" } }), lightAt: [0, 2.85, 0.65] };
    }
    case "torch": {
      b.cylinder("pole", 0, 1.1, 0, 0.05, 0.06, 2.2, 6);
      b.cylinder("pole", 0, 2.25, 0, 0.12, 0.06, 0.25, 6);
      b.cylinder("lamp", 0, 2.5, 0, 0, 0.12, 0.35, 6);
      return { parts: parts(b, { pole: { material: WOOD() }, lamp: { material: getMaterial({ preset: "plastic", color: "#ff9a3a", emissive: "#ff7a1a", emissiveIntensity: 3, noTexture: true }), role: "lamp", castShadow: false } }), lightAt: [0, 2.5, 0] };
    }
    case "bench": {
      b.box("seat", 0, 0.45, 0, 1.8, 0.06, 0.45);
      b.box("seat", 0, 0.75, -0.2, 1.8, 0.4, 0.05);
      for (const x of [-0.75, 0.75]) {
        b.box("frame", x, 0.22, 0, 0.06, 0.44, 0.4);
        b.box("frame", x, 0.6, -0.2, 0.06, 0.4, 0.06);
      }
      return { parts: parts(b, { seat: { material: WOOD(), tinted: true }, frame: { material: METAL_DARK() } }), collider: { center: [0, 0.4, 0], size: [1.8, 0.8, 0.5] } };
    }
    case "traffic_light": {
      b.cylinder("pole", 0, 1.8, 0, 0.07, 0.09, 3.6, 8);
      b.box("pole", 0, 3.2, 0.12, 0.34, 0.95, 0.22);
      b.box("pole", 0, 3.2, 0.24, 0.44, 1.05, 0.02);
      const lampAt = (key: string, y: number) =>
        b.with(new Matrix4().makeRotationX(Math.PI / 2).setPosition(0, y, 0.25), () => b.cylinder(key, 0, 0, 0, 0.1, 0.1, 0.04, 10));
      lampAt("red", 3.5);
      lampAt("yellow", 3.2);
      lampAt("green", 2.9);
      const g = b.buildParts();
      const signal = () => getMaterial({ preset: "plastic", color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 1.6, noTexture: true, tintEmissive: true, roughness: 0.3 });
      return {
        parts: [
          { geometry: g.get("pole")!, material: METAL_DARK(), tinted: false, castShadow: true },
          { geometry: g.get("red")!, material: signal(), tinted: true, role: "signal", castShadow: false },
          { geometry: g.get("yellow")!, material: signal(), tinted: true, role: "signal", castShadow: false },
          { geometry: g.get("green")!, material: signal(), tinted: true, role: "signal", castShadow: false },
        ],
        collider: { center: [0, 1.8, 0], size: [0.3, 3.6, 0.3] },
      };
    }
    case "stall": {
      b.box("wood", 0, 0.5, 0.2, 2.6, 1, 1.1);
      for (const [x, z] of [[-1.25, 0.8], [1.25, 0.8], [-1.25, -0.8], [1.25, -0.8]] as const) b.box("wood", x, 1.2, z, 0.08, 2.4, 0.08);
      b.with(new Matrix4().makeRotationX(-0.25).setPosition(0, 2.45, 0), () => b.box("cloth", 0, 0, 0, 3, 0.05, 2));
      b.box("goods", -0.6, 1.12, 0.3, 0.6, 0.25, 0.5);
      b.box("goods", 0.4, 1.1, 0.25, 0.8, 0.2, 0.6);
      return {
        parts: parts(b, { wood: { material: WOOD() }, cloth: { material: TINT_FABRIC(), tinted: true }, goods: { material: getMaterial({ preset: "plastic", color: "#d9a441", noTexture: true }) } }),
        collider: { center: [0, 1, 0], size: [2.8, 2, 2] },
      };
    }
    case "fountain": {
      b.cylinder("stone", 0, 0.35, 0, 3, 3.1, 0.7, 24, { top: false });
      b.cylinder("stone", 0, 0.35, 0, 2.7, 2.7, 0.66, 24, { top: false, bottom: false });
      b.cylinder("stone", 0, 1.2, 0, 0.3, 0.4, 1.8, 10);
      b.cylinder("stone", 0, 2.15, 0, 1, 0.8, 0.2, 14);
      b.cylinder("water", 0, 0.55, 0, 2.7, 2.7, 0.05, 24);
      b.cylinder("water", 0, 2.4, 0, 0.12, 0.6, 0.6, 10);
      return { parts: parts(b, { stone: { material: STONE() }, water: { material: WATER(), role: "water", castShadow: false } }), collider: { center: [0, 0.6, 0], size: [6, 1.2, 6] } };
    }
    case "well": {
      b.cylinder("stone", 0, 0.45, 0, 1, 1.05, 0.9, 12, { top: false });
      b.cylinder("water", 0, 0.7, 0, 0.85, 0.85, 0.04, 12);
      b.box("wood", 0.9, 1.4, 0, 0.12, 1.9, 0.12);
      b.box("wood", -0.9, 1.4, 0, 0.12, 1.9, 0.12);
      b.pyramid("roof", 0, 2.3, 0, 2.4, 1.6, 0.7, 0.8);
      return { parts: parts(b, { stone: { material: STONE() }, water: { material: WATER(), role: "water" }, wood: { material: WOOD() }, roof: { material: getMaterial({ preset: "tiles", color: "#8b3e2f", doubleSide: true }) } }), collider: { center: [0, 0.6, 0], size: [2.1, 1.2, 2.1] } };
    }
    case "barrel": {
      b.cylinder("wood", 0, 0.5, 0, 0.36, 0.36, 1, 10);
      b.cylinder("metal", 0, 0.2, 0, 0.38, 0.38, 0.06, 10);
      b.cylinder("metal", 0, 0.8, 0, 0.38, 0.38, 0.06, 10);
      return { parts: parts(b, { wood: { material: WOOD(), tinted: true }, metal: { material: METAL_DARK() } }), collider: { center: [0, 0.5, 0], size: [0.75, 1, 0.75] } };
    }
    case "crate": {
      b.box("wood", 0, 0.45, 0, 0.9, 0.9, 0.9);
      return { parts: parts(b, { wood: { material: WOOD(), tinted: true } }), collider: { center: [0, 0.45, 0], size: [0.9, 0.9, 0.9] } };
    }
    case "fence": {
      for (const x of [-1.5, 0, 1.5]) b.box("wood", x, 0.55, 0, 0.1, 1.1, 0.1);
      b.box("wood", 0, 0.8, 0, 3.1, 0.08, 0.05);
      b.box("wood", 0, 0.4, 0, 3.1, 0.08, 0.05);
      return { parts: parts(b, { wood: { material: WOOD(), tinted: true } }), collider: { center: [0, 0.55, 0], size: [3.1, 1.1, 0.2] } };
    }
    case "billboard": {
      b.cylinder("pole", 0, 2.5, 0, 0.12, 0.15, 5, 8);
      b.box("pole", 0, 5.8, 0, 4.4, 2.6, 0.25);
      b.box("panel", 0, 5.8, 0.14, 4.1, 2.3, 0.04);
      return { parts: parts(b, { pole: { material: METAL_DARK() }, panel: { material: NEON(), tinted: true, castShadow: false } }), collider: { center: [0, 2.5, 0], size: [0.4, 5, 0.4] } };
    }
    case "light_tower": {
      b.cylinder("pole", 0, 9, 0, 0.25, 0.4, 18, 8);
      b.box("pole", 0, 18.2, 0.2, 3, 1.6, 0.4);
      b.box("lamp", 0, 18.2, 0.42, 2.7, 1.3, 0.05);
      return { parts: parts(b, { pole: { material: METAL_DARK() }, lamp: { material: LAMP_MATERIAL(), role: "lamp", castShadow: false } }), lightAt: [0, 18, 1], collider: { center: [0, 9, 0], size: [0.8, 18, 0.8] } };
    }
    case "antenna": {
      b.cylinder("metal", 0, 0.4, 0, 1, 1.2, 0.8, 10);
      b.cylinder("metal", 0, 7, 0, 0.12, 0.25, 13, 6);
      b.with(new Matrix4().makeRotationX(-0.8).setPosition(0, 12, 0.6), () => b.dome("metal", 0, 0, 0, 1.6, 12, 4));
      b.box("lamp", 0, 13.6, 0, 0.25, 0.25, 0.25);
      return { parts: parts(b, { metal: { material: getMaterial({ preset: "metal", color: "#d6dae0" }) }, lamp: { material: getMaterial({ preset: "plastic", color: "#ff3030", emissive: "#ff2020", emissiveIntensity: 3, noTexture: true }), castShadow: false } }), collider: { center: [0, 6, 0], size: [1, 12, 1] } };
    }
    case "landing_pad": {
      b.cylinder("pad", 0, 0.15, 0, 10, 10.4, 0.3, 32);
      b.cylinder("mark", 0, 0.32, 0, 7, 7, 0.02, 32);
      b.cylinder("pad", 0, 0.335, 0, 6.4, 6.4, 0.02, 32);
      b.box("mark", 0, 0.36, 0, 0.8, 0.02, 6);
      b.box("mark", -1.6, 0.36, 0, 0.8, 0.02, 6);
      b.box("mark", 1.6, 0.36, 0, 0.8, 0.02, 6);
      b.box("mark", 0, 0.36, 0, 4, 0.02, 0.8);
      return { parts: parts(b, { pad: { material: getMaterial({ preset: "concrete", color: "#4a4e56" }), castShadow: false }, mark: { material: getMaterial({ preset: "plastic", color: "#f5c400", emissive: "#f5a000", emissiveIntensity: 0.6, noTexture: true }), castShadow: false } }) };
    }
    case "pier": {
      b.box("wood", 0, 0.1, 9, 3, 0.2, 18);
      for (let z = 1; z < 18; z += 3) for (const x of [-1.3, 1.3]) b.cylinder("wood", x, -1.5, z, 0.12, 0.12, 3.4, 6);
      return { parts: parts(b, { wood: { material: WOOD(), tinted: true } }), collider: { center: [0, 0, 9], size: [3, 0.4, 18] } };
    }
    case "parasol": {
      b.cylinder("pole", 0, 1.2, 0, 0.03, 0.03, 2.4, 6);
      b.cylinder("cloth", 0, 2.35, 0, 0, 1.4, 0.45, 12, { bottom: false });
      b.cylinder("cloth", 0, 2.35, 0, 1.4, 0, -0.45, 12, { top: false });
      return { parts: parts(b, { pole: { material: getMaterial({ preset: "metal", color: "#dddddd" }) }, cloth: { material: TINT_FABRIC(), tinted: true } }) };
    }
    case "trash_bin": {
      b.cylinder("bin", 0, 0.45, 0, 0.3, 0.26, 0.9, 10);
      b.cylinder("lid", 0, 0.93, 0, 0.32, 0.32, 0.06, 10);
      return { parts: parts(b, { bin: { material: getMaterial({ preset: "metal", color: "#3d5a45" }) }, lid: { material: METAL_DARK() } }), collider: { center: [0, 0.45, 0], size: [0.6, 0.9, 0.6] } };
    }
    case "hydrant": {
      b.cylinder("a", 0, 0.35, 0, 0.14, 0.16, 0.7, 8);
      b.dome("a", 0, 0.7, 0, 0.15, 8, 3);
      b.with(new Matrix4().makeRotationZ(Math.PI / 2).setPosition(0, 0.45, 0), () => b.cylinder("a", 0, 0, 0, 0.06, 0.06, 0.45, 6));
      return { parts: parts(b, { a: { material: getMaterial({ preset: "metal", color: "#c0392b", roughness: 0.5 }) } }) };
    }
    case "tire_stack": {
      for (let k = 0; k < 4; k++) {
        b.cylinder("tire", 0, 0.15 + k * 0.3, 0, 0.45, 0.45, 0.28, 12);
        b.cylinder("tire", 0.95, 0.15 + k * 0.3, 0, 0.45, 0.45, 0.28, 12);
      }
      return { parts: parts(b, { tire: { material: getMaterial({ preset: "plastic", color: "#1e1e1e", roughness: 0.9, noTexture: true }) } }), collider: { center: [0.47, 0.6, 0], size: [1.9, 1.2, 0.9] } };
    }
    case "statue": {
      b.box("base", 0, 0.75, 0, 1.6, 1.5, 1.6);
      b.box("base", 0, 1.6, 0, 1.2, 0.2, 1.2);
      b.cylinder("figure", 0, 2.6, 0, 0.25, 0.32, 1.8, 8);
      b.blob("figure", 0, 3.75, 0, 0.28, 0.32, 0.28, () => 0, 1);
      b.with(new Matrix4().makeRotationZ(-2.4).setPosition(0.3, 3.2, 0), () => b.cylinder("figure", 0, 0.45, 0, 0.07, 0.09, 0.9, 6));
      return { parts: parts(b, { base: { material: STONE() }, figure: { material: getMaterial({ preset: "metal", color: "#6f8a7a", roughness: 0.5 }), tinted: true } }), collider: { center: [0, 1, 0], size: [1.6, 2, 1.6] } };
    }
    case "waterfall": {
      // Cortina de agua desde el borde del acantilado hasta el lago.
      const h = 14;
      b.quad("water", [-3.5, 0, 0.6], [3.5, 0, 0.6], [3, h, -0.6], [-3, h, -0.6]);
      b.quad("water", [-3, h, -0.6], [3, h, -0.6], [3, h + 0.2, -4], [-3, h + 0.2, -4]);
      for (let k = 0; k < 6; k++) b.blob("foam", -3 + k * 1.2, 0.2, 1.2, 1, 0.45, 0.8, (x, y, z) => Math.sin(x * 5 + z * 3) * 0.15, 1);
      for (const s of [-1, 1]) for (let k = 0; k < 3; k++) b.blob("rock", s * (4.4 + k * 0.4), 2 + k * 4, -0.5 - k * 0.3, 1.8, 2.4, 1.6, (x, y, z) => Math.sin(x * 3 + y * 2 + z) * 0.2, 1);
      return {
        parts: parts(b, {
          water: { material: getMaterial({ preset: "glass", color: "#d8f0ff", roughness: 0.15, metalness: 0, opacity: 0.8, emissive: "#3a6a80", emissiveIntensity: 0.4, noTexture: true, doubleSide: true }), role: "water", castShadow: false },
          foam: { material: getMaterial({ preset: "plastic", color: "#ffffff", roughness: 0.9, noTexture: true, flatShading: true }), castShadow: false },
          rock: { material: getMaterial({ preset: "stone", color: "#7a7670", flatShading: true }) },
        }),
      };
    }
  }
}
