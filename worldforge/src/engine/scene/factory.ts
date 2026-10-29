import { Rng } from "../rng";
import type {
  BuildingKind,
  BuildingProps,
  BuildingStyle,
  Entity,
  EntityOf,
  EntityType,
  NpcAppearance,
  NpcOutfit,
  PlantSpecies,
  PrimitiveShape,
  PropKind,
  Transform,
  TreeSpecies,
  VehicleModel,
  WorldDoc,
} from "../types";
import { allocateName, identityTransform, insertEntity, namePrefix } from "./doc";

/**
 * Fábrica de entidades con valores por defecto coherentes. La usan los
 * generadores, la biblioteca de objetos y las operaciones de IA.
 */

export interface StylePalette {
  walls: [BuildingProps["wall"], string][];
  roofs: string[];
  accents: string[];
  windows: string[];
}

export const PALETTES: Record<BuildingStyle, StylePalette> = {
  modern: {
    walls: [
      ["concrete", "#bdb7ac"],
      ["concrete", "#a7aaae"],
      ["brick", "#9c4f3a"],
      ["brick", "#b5654a"],
      ["plaster", "#e3d7c1"],
      ["plaster", "#cfd8db"],
      ["plaster", "#e8dcc8"],
      ["glass", "#46627a"],
    ],
    roofs: ["#474c55", "#5d4037", "#3a3d44", "#6e6e6e"],
    accents: ["#2d3138", "#e4e4e0", "#8a6a4a", "#30475e"],
    windows: ["#8fb3cc", "#a7c4d6", "#7d9db5"],
  },
  futuristic: {
    walls: [
      ["glass", "#1f2e44"],
      ["glass", "#26344f"],
      ["metal", "#5c6470"],
      ["metal", "#3a4150"],
      ["concrete", "#2c303a"],
      ["glass", "#2b2f55"],
    ],
    roofs: ["#1b1e26", "#2a2e38"],
    accents: ["#00e5ff", "#ff2bd6", "#7c4dff", "#00ffa3", "#ffb000"],
    windows: ["#66d9ff", "#9ab8ff", "#ff9de6"],
  },
  japanese: {
    walls: [
      ["plaster", "#e8e0d0"],
      ["wood", "#6b4a32"],
      ["concrete", "#a9a49c"],
      ["concrete", "#8e8a86"],
      ["plaster", "#d7cfc0"],
    ],
    roofs: ["#2f3540", "#3b3f47", "#5a2f2a"],
    accents: ["#c0392b", "#ff3d7f", "#00d1ff", "#2d2d2d"],
    windows: ["#a6c8d8", "#ffd8a8"],
  },
  medieval: {
    walls: [
      ["timber", "#e6dcc4"],
      ["timber", "#ddd0b0"],
      ["stone", "#8d8678"],
      ["stone", "#a39b8b"],
      ["plaster", "#e0d4b8"],
    ],
    roofs: ["#8b3e2f", "#7a4a2c", "#4b4f58", "#a0522d"],
    accents: ["#4a3424", "#3b2a1d"],
    windows: ["#59636b", "#ffd28a"],
  },
  tropical: {
    walls: [
      ["wood", "#9a6b43"],
      ["wood", "#b58456"],
      ["plaster", "#f1e7d0"],
    ],
    roofs: ["#c2a35f", "#b39050"],
    accents: ["#e8d5a9", "#5a3d26"],
    windows: ["#7fa7b8"],
  },
  scifi: {
    walls: [
      ["metal", "#e6e8ec"],
      ["metal", "#c9ced6"],
      ["plastic", "#f2f2f2"],
      ["metal", "#9aa3ad"],
    ],
    roofs: ["#d0d4da", "#8f969e"],
    accents: ["#ff7a1a", "#2bb5ff", "#f5c400"],
    windows: ["#8fe3ff"],
  },
  classic: {
    walls: [
      ["plaster", "#e8d9b5"],
      ["plaster", "#d9b8a0"],
      ["plaster", "#c7d0c4"],
      ["brick", "#a65f45"],
      ["stone", "#b8ad98"],
    ],
    roofs: ["#a9553b", "#8b4a36", "#5b5f66"],
    accents: ["#f2ece0", "#5a4636"],
    windows: ["#8aa9bd"],
  },
};

export function defaultBuilding(kind: BuildingKind, style: BuildingStyle, rng: Rng): BuildingProps {
  const pal = PALETTES[style];
  const [wall, wallColor] = rng.pick(pal.walls);
  const base: BuildingProps = {
    kind,
    style,
    shape: "box",
    width: 12,
    depth: 12,
    floors: 3,
    floorHeight: 3.2,
    roof: "flat",
    wall,
    wallColor,
    roofColor: rng.pick(pal.roofs),
    accentColor: rng.pick(pal.accents),
    windowColor: rng.pick(pal.windows),
    windows: "grid",
    balconies: false,
    neon: style === "futuristic",
    seed: rng.seedInt(),
  };
  switch (kind) {
    case "house":
      return {
        ...base,
        width: 9,
        depth: 8,
        floors: rng.int(1, 2),
        floorHeight: 3,
        roof: style === "modern" ? rng.pick(["gable", "hip", "flat"] as const) : style === "tropical" ? "thatch" : "gable",
        windows: style === "medieval" ? "arched" : "sparse",
        neon: false,
      };
    case "apartment":
      return { ...base, width: 16, depth: 14, floors: rng.int(4, 9), balconies: rng.chance(0.6), windows: "grid" };
    case "office":
      return { ...base, width: 18, depth: 18, floors: rng.int(6, 16), windows: rng.pick(["grid", "bands"] as const) };
    case "skyscraper":
      return {
        ...base,
        width: 22,
        depth: 22,
        floors: rng.int(20, 40),
        floorHeight: 3.6,
        shape: rng.pick(["box", "tiered", "tiered"] as const),
        wall: rng.chance(0.6) ? "glass" : wall,
        wallColor: rng.chance(0.6) ? rng.pick(["#3f5870", "#2f4357", "#4c6680", "#5b6d7c"]) : wallColor,
        windows: rng.pick(["curtain", "bands", "grid"] as const),
        roof: rng.chance(0.3) ? "spire" : "flat",
      };
    case "shop":
      return { ...base, width: 10, depth: 10, floors: rng.int(1, 3), windows: "storefront" };
    case "futuristic":
      return {
        ...base,
        width: 22,
        depth: 22,
        floors: rng.int(25, 60),
        floorHeight: 3.8,
        shape: rng.pick(["cylinder", "tiered", "box"] as const),
        wall: "glass",
        windows: "curtain",
        roof: rng.chance(0.5) ? "spire" : "flat",
        neon: true,
      };
    case "castle":
      return { ...base, width: 44, depth: 44, floors: 3, floorHeight: 4, wall: "stone", wallColor: "#9a9384", roof: "crenellated", windows: "arched", neon: false };
    case "tower":
      return { ...base, width: 8, depth: 8, floors: style === "scifi" ? 6 : 5, floorHeight: 4, shape: "cylinder", roof: style === "medieval" ? "spire" : "flat", windows: "sparse" };
    case "factory":
      return { ...base, width: 30, depth: 22, floors: 2, floorHeight: 5, roof: style === "scifi" ? "dome" : "gable", wall: style === "scifi" ? wall : "metal", windows: "bands" };
    case "hospital":
      return { ...base, width: 30, depth: 20, floors: rng.int(4, 7), wall: "plaster", wallColor: "#eef0f0", accentColor: "#d63a3a", windows: "grid" };
    case "school":
      return { ...base, width: 32, depth: 16, floors: rng.int(2, 3), wall: "brick", wallColor: "#b9654b", windows: "grid", roof: "flat" };
    case "station":
      return { ...base, width: 36, depth: 18, floors: 2, floorHeight: 5, roof: "gable", windows: "arched" };
    case "mall":
      return { ...base, width: 40, depth: 30, floors: 3, floorHeight: 4.5, windows: "storefront" };
    case "stadium":
      return { ...base, width: 70, depth: 50, floors: 4, floorHeight: 4, wall: "concrete", wallColor: "#c9c9c9", roof: "flat", windows: "none" };
    case "grandstand":
      return { ...base, width: 40, depth: 14, floors: 3, floorHeight: 3, wall: "concrete", wallColor: "#c4c7cc", roof: "flat", windows: "none", accentColor: "#d23c3c" };
    case "pit":
      return { ...base, width: 90, depth: 16, floors: 2, floorHeight: 4.5, wall: "metal", wallColor: "#e3e6ea", accentColor: "#d23c3c", windows: "bands", roof: "flat" };
    case "lab":
      return { ...base, width: 14, depth: 10, floors: rng.int(1, 2), floorHeight: 3.5, windows: "bands", roof: "flat" };
    case "dome":
      return { ...base, width: 14, depth: 14, floors: 1, floorHeight: 4, shape: "cylinder", roof: "dome", windows: "bands" };
    case "hut":
      return { ...base, width: 6, depth: 6, floors: 1, floorHeight: 2.8, wall: "wood", wallColor: rng.pick(["#9a6b43", "#8a5d38"]), roof: "thatch", roofColor: "#c2a35f", windows: "sparse", neon: false };
    case "temple":
      return {
        ...base,
        width: 14,
        depth: 20,
        floors: style === "japanese" ? 3 : 2,
        floorHeight: 4.5,
        roof: style === "japanese" ? "pagoda" : "gable",
        windows: "arched",
        wall: style === "japanese" ? "wood" : "stone",
        wallColor: style === "japanese" ? "#7a2a22" : "#c9bfa9",
        neon: false,
      };
  }
}

const SKIN = ["#f1c9a5", "#e0ac83", "#c68a62", "#a86b45", "#7b4a2d", "#5a3622", "#f6d7bf"];
const HAIR = ["#1d1611", "#3b2a1e", "#6a4a2c", "#b98b52", "#d9c08a", "#8a8a8a", "#a33a1f"];

const OUTFIT_COLORS: Record<NpcOutfit, { top: string[]; bottom: string[] }> = {
  casual: { top: ["#c0392b", "#2e86c1", "#27ae60", "#f1c40f", "#8e44ad", "#ecf0f1", "#34495e", "#e67e22"], bottom: ["#2c3e50", "#34495e", "#5d6d7e", "#1f3a5f", "#6e4b2a"] },
  formal: { top: ["#2c3e50", "#1c2833", "#566573", "#f2f3f4"], bottom: ["#1c2833", "#2c3e50", "#17202a"] },
  worker: { top: ["#f39c12", "#e67e22", "#2e86c1"], bottom: ["#1f3a5f", "#34495e"] },
  medieval: { top: ["#7b4a2d", "#5d6d2a", "#8a2d2d", "#4a5a7a", "#a08050"], bottom: ["#3b2a1d", "#4a3a2a", "#2f3a24"] },
  knight: { top: ["#9aa3ad", "#b8bfc7"], bottom: ["#6e7680", "#55606b"] },
  futuristic: { top: ["#1c1f2e", "#2b2f45", "#e6e6f0", "#3d1f4f"], bottom: ["#11131c", "#23263a"] },
  tropical: { top: ["#f7dc6f", "#48c9b0", "#f1948a", "#ffffff", "#5dade2"], bottom: ["#d4b483", "#2e86c1", "#f5f5dc"] },
  explorer: { top: ["#d9d2c3", "#e67e22", "#f2f2f2"], bottom: ["#6b5b45", "#8a7a60"] },
  racer: { top: ["#d23c3c", "#1f5fd1", "#f2f2f2", "#111111"], bottom: ["#d23c3c", "#1f5fd1", "#111111"] },
  elf: { top: ["#2e7d32", "#558b2f", "#6a1b9a", "#00897b"], bottom: ["#4e342e", "#33691e"] },
};

export function defaultNpcAppearance(outfit: NpcOutfit, rng: Rng): NpcAppearance {
  const c = OUTFIT_COLORS[outfit];
  return {
    outfit,
    skin: outfit === "elf" ? rng.pick(["#f6d7bf", "#d8f0d0", "#e0ac83"]) : rng.pick(SKIN),
    top: rng.pick(c.top),
    bottom: rng.pick(c.bottom),
    hair: rng.pick(HAIR),
    height: Math.round(rng.range(1.62, 1.9) * 100) / 100,
    build: Math.round(rng.range(0.85, 1.15) * 100) / 100,
  };
}

const CAR_COLORS = ["#c0392b", "#2e86c1", "#ecf0f1", "#1c1c1c", "#7f8c8d", "#bdc3c7", "#27ae60", "#f39c12", "#8e44ad", "#2c3e50", "#d35400"];

export function vehicleColor(model: VehicleModel, rng: Rng): string {
  switch (model) {
    case "taxi":
      return "#f2c12e";
    case "bus":
      return rng.pick(["#d64541", "#2e86c1", "#f39c12"]);
    case "race":
      return rng.pick(["#d23c3c", "#1f5fd1", "#f2f2f2", "#f39c12", "#16a085", "#111111", "#8e44ad"]);
    case "hover":
    case "ship":
      return rng.pick(["#e6e8ec", "#22252e", "#7c4dff", "#00bcd4", "#ff2bd6"]);
    case "rover":
      return rng.pick(["#e6e8ec", "#f2a03d"]);
    case "cart":
      return "#7a5235";
    default:
      return rng.pick(CAR_COLORS);
  }
}

export const VEHICLE_SPEED: Record<VehicleModel, number> = {
  sedan: 12,
  suv: 12,
  taxi: 12,
  van: 11,
  bus: 9,
  truck: 9,
  sports: 15,
  race: 40,
  hover: 15,
  rover: 8,
  ship: 22,
  motorcycle: 14,
  cart: 2,
};

export const PROP_COLORS: Partial<Record<PropKind, string>> = {
  streetlight: "#2f343b",
  bench: "#7a5235",
  traffic_light: "#2b2f36",
  stall: "#c0392b",
  fountain: "#b8b2a6",
  billboard: "#ff2bd6",
  lantern: "#d64541",
  parasol: "#e74c3c",
  statue: "#9aa0a6",
};

// ---------- Creación de entidades ----------

export interface SpawnSpec<T extends EntityType> {
  type: T;
  props: EntityOf<T>["props"];
  transform?: Partial<Transform>;
  name?: string;
  parentId?: string | null;
  id: string;
  material?: Entity["material"];
  physics?: Entity["physics"];
}

/** Crea una entidad dentro de un documento mutable (draft) con nombre numerado. */
export function spawn<T extends EntityType>(doc: WorldDoc, spec: SpawnSpec<T>): EntityOf<T> {
  const t = identityTransform();
  if (spec.transform?.position) t.position = [...spec.transform.position];
  if (spec.transform?.rotation) t.rotation = [...spec.transform.rotation];
  if (spec.transform?.scale) t.scale = [...spec.transform.scale];
  const entity = {
    id: spec.id,
    type: spec.type,
    name: spec.name ?? allocateName(doc, namePrefix({ type: spec.type, props: spec.props } as Entity)),
    parentId: null,
    children: [],
    transform: t,
    visible: true,
    locked: false,
    props: spec.props,
    ...(spec.material !== undefined ? { material: spec.material } : {}),
    ...(spec.physics !== undefined ? { physics: spec.physics } : {}),
  } as unknown as EntityOf<T>;
  insertEntity(doc, entity as Entity, spec.parentId);
  return entity;
}

export function defaultProps(type: EntityType, variant: string | undefined, rng: Rng, style: BuildingStyle = "modern"): Entity["props"] {
  switch (type) {
    case "building":
      return defaultBuilding((variant as BuildingKind) ?? "house", style, rng);
    case "tree":
      return { species: (variant as TreeSpecies) ?? "oak", seed: rng.seedInt() };
    case "plant":
      return { species: (variant as PlantSpecies) ?? "bush", seed: rng.seedInt() };
    case "rock":
      return { variant: rng.int(0, 7) };
    case "prop": {
      const kind = (variant as PropKind) ?? "bench";
      return { kind, color: PROP_COLORS[kind] ?? "#8a8f98", intersectionId: null, axis: "x" };
    }
    case "npc": {
      const outfit = (variant as NpcOutfit) ?? "casual";
      return { appearance: defaultNpcAppearance(outfit, rng), behavior: "wander", speed: 1.3, wanderRadius: 20, patrol: [], greets: true, modelAssetId: null };
    }
    case "vehicle": {
      const model = (variant as VehicleModel) ?? "sedan";
      return { model, color: vehicleColor(model, rng), routeId: null, routeT: 0, speed: VEHICLE_SPEED[model], parked: true };
    }
    case "light":
      return { kind: (variant as "point" | "spot") ?? "point", color: "#ffd9a0", intensity: 30, distance: 25, angle: 0.6, castShadow: false };
    case "camera":
      return { fov: 50, target: [0, 0, 0] };
    case "primitive":
      return { shape: (variant as PrimitiveShape) ?? "box" };
    case "group":
      return {};
    case "spawn":
      return {};
    default:
      return {};
  }
}
