import { z } from "zod";
import { obbOverlap, pointInObb, rad, round, type Obb2 } from "../math";
import { Rng } from "../rng";
import { newId } from "../ids";
import { flyoverKeys, tallestBuilding } from "../generation/director";
import { applyBrush, heightAt, isInsideTerrain, slopeAt } from "../generation/terrain";
import {
  BIOMES,
  BUILDING_KINDS,
  BUILDING_STYLES,
  HexColorSchema,
  IdSchema,
  LIMITS,
  MATERIAL_PRESETS,
  NPC_BEHAVIORS,
  NPC_OUTFITS,
  PLANT_SPECIES,
  PRIMITIVE_SHAPES,
  PROP_KINDS,
  PROTECTED_TYPES,
  NON_TRANSFORMABLE,
  ROAD_KINDS,
  ROOF_TYPES,
  TREE_SPECIES,
  VEHICLE_MODELS,
  WEATHER_TYPES,
  WINDOW_STYLES,
  Vec2Schema,
  Vec3Schema,
  sanitizeText,
  type Entity,
  type EntityType,
  type Vec2,
  type Vec3,
  type WorldDoc,
} from "../types";
import {
  DEFAULT_MATERIAL,
  FOLDERS,
  allocateName,
  folderForType,
  insertEntity,
  isEffectivelyLocked,
  namePrefix,
  removeEntity,
  worldMatrix,
  worldPosition,
  ROOT_ID,
  matrixToTransform,
  parentWorldMatrix,
  transformToMatrix,
} from "./doc";
import { defaultProps, spawn } from "./factory";
import { presetDefaults } from "../models/materials";

/**
 * Operaciones estructuradas: el único camino por el que la IA (local o un
 * modelo conectado) modifica el mundo. Cada operación se valida con zod, se
 * ejecuta sobre un borrador del documento y queda como un paso deshacible.
 * No se ejecuta código arbitrario.
 */

const EDITABLE_TYPES = ["building", "tree", "plant", "rock", "prop", "npc", "vehicle", "road", "block", "light", "camera", "primitive", "model", "group"] as const;

export const TargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("selection") }),
  z.object({ kind: z.literal("ids"), ids: z.array(IdSchema).min(1).max(5000) }),
  z.object({ kind: z.literal("name"), name: z.string().min(1).max(80) }),
  z.object({
    kind: z.literal("type"),
    type: z.enum(EDITABLE_TYPES),
    variant: z.string().max(32).optional(),
    superlative: z.enum(["tallest", "shortest", "largest", "nearest_center"]).optional(),
    limit: z.number().int().min(1).max(5000).optional(),
  }),
  z.object({ kind: z.literal("all") }),
]);
export type Target = z.infer<typeof TargetSchema>;

const AnchorSchema = z.union([z.enum(["water", "center", "spawn", "mountain", "selection"]), TargetSchema]);

export const OperationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("modify_object"),
    target: TargetSchema,
    changes: z
      .object({
        position: Vec3Schema.optional(),
        rotationDeg: Vec3Schema.optional(),
        scale: Vec3Schema.optional(),
        translate: Vec3Schema.optional(),
        rotateByDeg: Vec3Schema.optional(),
        scaleBy: Vec3Schema.optional(),
        visible: z.boolean().optional(),
        locked: z.boolean().optional(),
      })
      .strict(),
  }),
  z.object({
    operation: z.literal("modify_building"),
    target: TargetSchema,
    changes: z
      .object({
        floors: z.number().int().min(1).max(150).optional(),
        floorsBy: z.number().min(0.1).max(10).optional(),
        width: z.number().min(2).max(200).optional(),
        depth: z.number().min(2).max(200).optional(),
        sizeBy: z.number().min(0.1).max(10).optional(),
        roof: z.enum(ROOF_TYPES).optional(),
        wall: z.enum(MATERIAL_PRESETS).optional(),
        wallColor: HexColorSchema.optional(),
        roofColor: HexColorSchema.optional(),
        accentColor: HexColorSchema.optional(),
        windowColor: HexColorSchema.optional(),
        windows: z.enum(WINDOW_STYLES).optional(),
        neon: z.boolean().optional(),
        balconies: z.boolean().optional(),
        kind: z.enum(BUILDING_KINDS).optional(),
        style: z.enum(BUILDING_STYLES).optional(),
      })
      .strict(),
  }),
  z.object({
    operation: z.literal("set_material"),
    target: TargetSchema,
    part: z.enum(["walls", "roof", "accent", "all"]).optional(),
    preset: z.enum(MATERIAL_PRESETS).optional(),
    color: HexColorSchema.optional(),
    roughness: z.number().min(0).max(1).optional(),
    metalness: z.number().min(0).max(1).optional(),
    emissive: HexColorSchema.optional(),
    emissiveIntensity: z.number().min(0).max(20).optional(),
    opacity: z.number().min(0.05).max(1).optional(),
  }),
  z.object({
    operation: z.literal("add_objects"),
    objectType: z.enum(["tree", "plant", "rock", "building", "npc", "vehicle", "prop", "primitive", "light"]),
    variant: z.string().max(32).optional(),
    count: z.number().int().min(1).max(LIMITS.maxAddCount),
    placement: z.object({
      mode: z.enum(["around", "near", "random", "at", "line"]),
      anchor: AnchorSchema.optional(),
      radius: z.number().min(1).max(1000).optional(),
      position: Vec3Schema.optional(),
    }),
  }),
  z.object({ operation: z.literal("delete_objects"), target: TargetSchema }),
  z.object({ operation: z.literal("duplicate_objects"), target: TargetSchema, offset: Vec3Schema.optional() }),
  z.object({
    operation: z.literal("set_environment"),
    preset: z.enum(["day", "night", "sunset", "dawn", "noon"]).optional(),
    timeOfDay: z.number().min(0).max(24).optional(),
    dayNightCycle: z.boolean().optional(),
    fogDensity: z.number().min(0).max(0.1).optional(),
    sunIntensity: z.number().min(0).max(10).optional(),
  }),
  z.object({
    operation: z.literal("set_weather"),
    type: z.enum(WEATHER_TYPES).optional(),
    intensity: z.number().min(0).max(1).optional(),
    wetness: z.number().min(0).max(1).optional(),
    wind: z.number().min(0).max(1).optional(),
    clouds: z.number().min(0).max(1).optional(),
  }),
  z.object({ operation: z.literal("set_npc_behavior"), target: TargetSchema, behavior: z.enum(NPC_BEHAVIORS), speed: z.number().min(0).max(8).optional() }),
  z.object({
    operation: z.literal("modify_vehicle"),
    target: TargetSchema,
    changes: z
      .object({
        speed: z.number().min(0).max(120).optional(),
        speedBy: z.number().min(0).max(10).optional(),
        model: z.enum(VEHICLE_MODELS).optional(),
        color: HexColorSchema.optional(),
        parked: z.boolean().optional(),
      })
      .strict(),
  }),
  z.object({
    operation: z.literal("add_road"),
    kind: z.enum(ROAD_KINDS),
    mode: z.enum(["ring_around", "points"]),
    anchor: AnchorSchema.optional(),
    radius: z.number().min(10).max(2000).optional(),
    points: z.array(Vec2Schema).min(2).max(LIMITS.maxRoadPoints).optional(),
    width: z.number().min(2).max(40).optional(),
  }),
  z.object({
    operation: z.literal("modify_terrain"),
    action: z.enum(["raise", "lower", "flatten", "smooth", "water", "set_biome"]),
    position: Vec2Schema.optional(),
    radius: z.number().min(2).max(500).optional(),
    strength: z.number().min(0.1).max(50).optional(),
    biome: z.enum(BIOMES).optional(),
  }),
  z.object({
    operation: z.literal("create_camera_animation"),
    style: z.enum(["flyover", "orbit"]),
    target: TargetSchema.optional(),
    duration: z.number().min(3).max(600).optional(),
  }),
  z.object({ operation: z.literal("rename_object"), target: TargetSchema, name: z.string().min(1).max(80) }),
  z.object({ operation: z.literal("group_objects"), target: TargetSchema, name: z.string().max(80).optional() }),
  z.object({ operation: z.literal("set_simulation"), npcs: z.boolean().optional(), traffic: z.boolean().optional() }),
]);
export type Operation = z.infer<typeof OperationSchema>;

export const OperationListSchema = z.array(OperationSchema).min(1).max(20);

export interface OpContext {
  selection: string[];
  seed: number;
}

export interface OpResult {
  summary: string[];
  warnings: string[];
  created: string[];
  /** Selección sugerida después de aplicar (p. ej. objetos creados o duplicados). */
  select?: string[];
}

// ---------------------------------------------------------------------------
// Resolución de destinos
// ---------------------------------------------------------------------------

function variantOf(e: Entity): string | undefined {
  switch (e.type) {
    case "building":
      return e.props.kind;
    case "tree":
    case "plant":
      return e.props.species;
    case "prop":
      return e.props.kind;
    case "vehicle":
      return e.props.model;
    case "npc":
      return e.props.appearance.outfit;
    case "primitive":
      return e.props.shape;
    default:
      return undefined;
  }
}

function entityHeight(e: Entity): number {
  if (e.type === "building") return e.props.floors * e.props.floorHeight * e.transform.scale[1];
  return e.transform.scale[1];
}

export function resolveTarget(doc: WorldDoc, target: Target, selection: string[]): string[] {
  const all = Object.values(doc.entities);
  switch (target.kind) {
    case "selection":
      return selection.filter((id) => doc.entities[id]);
    case "ids":
      return target.ids.filter((id) => doc.entities[id]);
    case "name": {
      const q = target.name.toLowerCase().replace(/\s+/g, "_");
      const exact = all.filter((e) => e.name.toLowerCase() === q || e.id === target.name);
      if (exact.length) return exact.map((e) => e.id);
      // "building 3" → Building_003
      const m = q.match(/^([a-z]+)_?(\d+)$/);
      if (m) {
        const want = `${m[1]}_${m[2]!.padStart(3, "0")}`;
        const hit = all.filter((e) => e.name.toLowerCase() === want);
        if (hit.length) return hit.map((e) => e.id);
      }
      return all.filter((e) => e.name.toLowerCase().includes(q)).map((e) => e.id);
    }
    case "type": {
      let list = all.filter((e) => e.type === target.type && (!target.variant || variantOf(e) === target.variant));
      if (target.superlative) {
        const center = siteCenter(doc);
        const key = (e: Entity): number => {
          switch (target.superlative) {
            case "tallest":
              return -entityHeight(e);
            case "shortest":
              return entityHeight(e);
            case "largest":
              return e.type === "building" ? -(e.props.width * e.props.depth * entityHeight(e)) : -e.transform.scale[0];
            default: {
              const p = worldPosition(doc, e.id);
              return Math.hypot(p[0] - center[0], p[2] - center[1]);
            }
          }
        };
        list = [...list].sort((a, b) => key(a) - key(b)).slice(0, target.limit ?? 1);
      } else if (target.limit) list = list.slice(0, target.limit);
      return list.map((e) => e.id);
    }
    case "all":
      return all.filter((e) => !PROTECTED_TYPES.has(e.type)).map((e) => e.id);
  }
}

function siteCenter(doc: WorldDoc): Vec2 {
  const bs = Object.values(doc.entities).filter((e) => e.type === "building" || e.type === "block");
  if (!bs.length) return [0, 0];
  let x = 0, z = 0;
  for (const b of bs) {
    x += b.transform.position[0];
    z += b.transform.position[2];
  }
  return [x / bs.length, z / bs.length];
}

function footprints(doc: WorldDoc): Obb2[] {
  const out: Obb2[] = [];
  for (const e of Object.values(doc.entities)) {
    if (e.type === "building") out.push({ cx: e.transform.position[0], cz: e.transform.position[2], hx: (e.props.width * e.transform.scale[0]) / 2 + 1, hz: (e.props.depth * e.transform.scale[2]) / 2 + 1, rot: e.transform.rotation[1] });
    if (e.type === "block") out.push({ cx: e.transform.position[0], cz: e.transform.position[2], hx: e.props.size[0] / 2, hz: e.props.size[1] / 2, rot: 0 });
  }
  return out;
}

function onRoad(doc: WorldDoc, x: number, z: number): boolean {
  for (const e of Object.values(doc.entities)) {
    if (e.type !== "road") continue;
    const pts = e.props.points;
    const hw = e.props.width / 2 + 0.8;
    const segs = e.props.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < segs; i++) {
      const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      if (Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z) < hw) return true;
    }
  }
  return false;
}

function anchorPoint(doc: WorldDoc, anchor: z.infer<typeof AnchorSchema> | undefined, ctx: OpContext): { center: Vec2; radius: number } | null {
  if (!anchor || anchor === "center") {
    const c = siteCenter(doc);
    return { center: c, radius: 40 };
  }
  if (anchor === "spawn") {
    const s = Object.values(doc.entities).find((e) => e.type === "spawn");
    return s ? { center: [s.transform.position[0], s.transform.position[2]], radius: 15 } : null;
  }
  if (anchor === "mountain") {
    const peak = findPeak(doc);
    return { center: peak.position, radius: peak.radius };
  }
  if (anchor === "water") return null; // se maneja aparte
  const ids = anchor === "selection" ? ctx.selection : resolveTarget(doc, anchor, ctx.selection);
  if (!ids.length) return null;
  let x = 0, z = 0, r = 6;
  for (const id of ids) {
    const p = worldPosition(doc, id);
    x += p[0];
    z += p[2];
    const e = doc.entities[id]!;
    if (e.type === "building") r = Math.max(r, Math.hypot(e.props.width, e.props.depth) / 2 + 4);
  }
  return { center: [x / ids.length, z / ids.length], radius: r };
}

/** Pico más alto y un radio aproximado de su base. */
export function findPeak(doc: WorldDoc): { position: Vec2; height: number; radius: number } {
  const t = doc.terrain;
  const n = t.resolution + 1;
  let best = 0;
  for (let k = 1; k < t.heights.length; k++) if (t.heights[k]! > t.heights[best]!) best = k;
  const i = best % n, j = Math.floor(best / n);
  const x = -t.size / 2 + (i / t.resolution) * t.size;
  const z = -t.size / 2 + (j / t.resolution) * t.size;
  const top = t.heights[best]!;
  const base = Math.min(...t.heights.filter((_, k) => k % 7 === 0));
  const threshold = base + (top - base) * 0.35;
  let radius = 0;
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    let r = 5;
    while (r < t.size && isInsideTerrain(t, x + Math.cos(ang) * r, z + Math.sin(ang) * r, 4) && heightAt(t, x + Math.cos(ang) * r, z + Math.sin(ang) * r) > threshold) r += 4;
    radius += r;
  }
  return { position: [x, z], height: top, radius: Math.max(20, radius / 16) };
}

/** Puntos de costa: terreno apenas por encima del agua, junto a celdas sumergidas. */
function shorePoints(doc: WorldDoc): Vec2[] {
  const t = doc.terrain;
  if (!t.waterEnabled) return [];
  const n = t.resolution + 1;
  const out: Vec2[] = [];
  for (let j = 1; j < t.resolution; j++) {
    for (let i = 1; i < t.resolution; i++) {
      const h = t.heights[j * n + i]!;
      if (h < t.waterLevel + 0.6 || h > t.waterLevel + 4) continue;
      const wet = t.heights[j * n + i + 1]! < t.waterLevel || t.heights[j * n + i - 1]! < t.waterLevel || t.heights[(j + 1) * n + i]! < t.waterLevel || t.heights[(j - 1) * n + i]! < t.waterLevel;
      if (wet) out.push([-t.size / 2 + (i / t.resolution) * t.size, -t.size / 2 + (j / t.resolution) * t.size]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

const label = (doc: WorldDoc, ids: string[], max = 3) =>
  ids.length <= max ? ids.map((id) => doc.entities[id]?.name ?? id).join(", ") : `${ids.length} objetos`;

export function executeOperations(doc: WorldDoc, ops: Operation[], ctx: OpContext): OpResult {
  const result: OpResult = { summary: [], warnings: [], created: [] };
  const rng = new Rng(ctx.seed);
  for (const op of ops) {
    try {
      executeOne(doc, op, ctx, rng, result);
    } catch (err) {
      result.warnings.push(`No se pudo aplicar ${op.operation}: ${err instanceof Error ? err.message : "error"}`);
    }
  }
  return result;
}

function editable(doc: WorldDoc, ids: string[], result: OpResult): string[] {
  const out = ids.filter((id) => !PROTECTED_TYPES.has(doc.entities[id]!.type) && !isEffectivelyLocked(doc, id));
  if (out.length < ids.length) result.warnings.push(`${ids.length - out.length} objetos bloqueados o protegidos no se modificaron`);
  return out;
}

function executeOne(doc: WorldDoc, op: Operation, ctx: OpContext, rng: Rng, result: OpResult) {
  switch (op.operation) {
    case "modify_object": {
      const ids = editable(doc, resolveTarget(doc, op.target, ctx.selection), result).filter((id) => !NON_TRANSFORMABLE.has(doc.entities[id]!.type));
      if (!ids.length) return result.warnings.push("No hay objetos para modificar");
      const c = op.changes;
      for (const id of ids) {
        const e = doc.entities[id]!;
        const t = e.transform;
        if (c.position) t.position = [...c.position];
        if (c.translate) t.position = [round(t.position[0] + c.translate[0]), round(t.position[1] + c.translate[1]), round(t.position[2] + c.translate[2])];
        if (c.rotationDeg) t.rotation = [rad(c.rotationDeg[0]), rad(c.rotationDeg[1]), rad(c.rotationDeg[2])];
        if (c.rotateByDeg) t.rotation = [round(t.rotation[0] + rad(c.rotateByDeg[0]), 4), round(t.rotation[1] + rad(c.rotateByDeg[1]), 4), round(t.rotation[2] + rad(c.rotateByDeg[2]), 4)];
        if (c.scale) t.scale = [...c.scale];
        if (c.scaleBy) t.scale = [round(t.scale[0] * c.scaleBy[0]), round(t.scale[1] * c.scaleBy[1]), round(t.scale[2] * c.scaleBy[2])];
        t.scale = t.scale.map((s) => Math.min(500, Math.max(0.01, s))) as Vec3;
        if (c.visible !== undefined) e.visible = c.visible;
        if (c.locked !== undefined) e.locked = c.locked;
      }
      result.summary.push(`Modificado: ${label(doc, ids)}`);
      return;
    }
    case "modify_building": {
      const ids = editable(doc, resolveTarget(doc, op.target, ctx.selection), result).filter((id) => doc.entities[id]!.type === "building");
      if (!ids.length) return result.warnings.push("No hay edificios seleccionados para modificar");
      const c = op.changes;
      const details: string[] = [];
      for (const id of ids) {
        const e = doc.entities[id]!;
        if (e.type !== "building") continue;
        const p = e.props;
        const before = p.floors;
        if (c.floors !== undefined) p.floors = c.floors;
        if (c.floorsBy !== undefined) p.floors = Math.max(1, Math.min(150, Math.round(p.floors * c.floorsBy) || 1));
        if (c.floorsBy !== undefined && c.floorsBy > 1 && p.floors === before) p.floors = Math.min(150, before + 1);
        if (c.floorsBy !== undefined && c.floorsBy < 1 && p.floors === before) p.floors = Math.max(1, before - 1);
        if (c.width !== undefined) p.width = c.width;
        if (c.depth !== undefined) p.depth = c.depth;
        if (c.sizeBy !== undefined) {
          p.width = Math.min(200, Math.max(2, round(p.width * c.sizeBy, 2)));
          p.depth = Math.min(200, Math.max(2, round(p.depth * c.sizeBy, 2)));
        }
        if (c.roof) p.roof = c.roof;
        if (c.wall) p.wall = c.wall;
        if (c.wallColor) p.wallColor = c.wallColor;
        if (c.roofColor) p.roofColor = c.roofColor;
        if (c.accentColor) p.accentColor = c.accentColor;
        if (c.windowColor) p.windowColor = c.windowColor;
        if (c.windows) p.windows = c.windows;
        if (c.neon !== undefined) p.neon = c.neon;
        if (c.balconies !== undefined) p.balconies = c.balconies;
        if (c.kind) p.kind = c.kind;
        if (c.style) p.style = c.style;
        if (before !== p.floors) details.push(`${e.name}: ${before} → ${p.floors} pisos`);
      }
      result.summary.push(details.length ? details.slice(0, 4).join("; ") + (details.length > 4 ? ` (+${details.length - 4})` : "") : `Edificios modificados: ${label(doc, ids)}`);
      return;
    }
    case "set_material": {
      const ids = editable(doc, resolveTarget(doc, op.target, ctx.selection), result).filter((id) => !["folder", "group", "road"].includes(doc.entities[id]!.type));
      if (!ids.length) return result.warnings.push("No hay objetos para cambiar el material");
      for (const id of ids) {
        const e = doc.entities[id]!;
        if (e.type === "building") {
          const part = op.part ?? "walls";
          if (part === "walls" || part === "all") {
            if (op.preset) e.props.wall = op.preset;
            if (op.color) e.props.wallColor = op.color;
          }
          if (part === "roof" || part === "all") {
            if (op.color) e.props.roofColor = op.color;
          }
          if (part === "accent") {
            if (op.color) e.props.accentColor = op.color;
          }
          continue;
        }
        if (e.type === "vehicle" && op.color && !op.preset) {
          e.props.color = op.color;
          continue;
        }
        if (e.type === "prop" && op.color && !op.preset) {
          e.props.color = op.color;
          continue;
        }
        const current = e.material ?? { ...DEFAULT_MATERIAL };
        const preset = op.preset ?? current.preset;
        const defaults = op.preset ? presetDefaults(op.preset) : null;
        e.material = {
          preset,
          color: op.color ?? current.color,
          roughness: op.roughness ?? defaults?.roughness ?? current.roughness,
          metalness: op.metalness ?? defaults?.metalness ?? current.metalness,
          emissive: op.emissive ?? current.emissive,
          emissiveIntensity: op.emissiveIntensity ?? current.emissiveIntensity,
          opacity: op.opacity ?? current.opacity,
        };
      }
      result.summary.push(`Material ${op.preset ?? ""}${op.color ? ` ${op.color}` : ""} en ${label(doc, ids)}`.replace(/\s+/g, " "));
      return;
    }
    case "add_objects": {
      const created = addObjects(doc, op, ctx, rng, result);
      result.created.push(...created);
      result.select = created;
      if (created.length) result.summary.push(`Agregados ${created.length} ${op.objectType === "tree" ? "árboles" : "objetos"}${op.variant ? ` (${op.variant})` : ""}`);
      if (created.length < op.count) result.warnings.push(created.length ? `Solo había lugar para ${created.length} de ${op.count}` : "No se encontró lugar libre para los objetos pedidos");
      return;
    }
    case "delete_objects": {
      const ids = editable(doc, resolveTarget(doc, op.target, ctx.selection), result);
      if (!ids.length) return result.warnings.push("No hay objetos para eliminar");
      const name = label(doc, ids);
      let removed = 0;
      for (const id of ids) if (doc.entities[id]) removed += removeEntity(doc, id).length;
      result.summary.push(`Eliminado: ${name} (${removed} entidades)`);
      result.select = [];
      return;
    }
    case "duplicate_objects": {
      const ids = editable(doc, resolveTarget(doc, op.target, ctx.selection), result).filter((id) => !NON_TRANSFORMABLE.has(doc.entities[id]!.type));
      if (!ids.length) return result.warnings.push("No hay objetos para duplicar");
      const copies = ids.map((id) => duplicateEntity(doc, id, op.offset ?? [4, 0, 4]));
      result.created.push(...copies);
      result.select = copies;
      result.summary.push(`Duplicado: ${label(doc, ids)}`);
      return;
    }
    case "set_environment": {
      const env = doc.environment;
      const presets = { day: 13, noon: 12, night: 22, sunset: 17.3, dawn: 6.9 } as const;
      if (op.preset) env.timeOfDay = presets[op.preset];
      if (op.timeOfDay !== undefined) env.timeOfDay = op.timeOfDay;
      if (op.dayNightCycle !== undefined) env.dayNightCycle = op.dayNightCycle;
      if (op.fogDensity !== undefined) env.fogDensity = op.fogDensity;
      if (op.sunIntensity !== undefined) env.sunIntensity = op.sunIntensity;
      env.exposure = env.timeOfDay > 19.5 || env.timeOfDay < 5.5 ? 1.15 : 1;
      result.summary.push(`Hora del día: ${env.timeOfDay.toFixed(1)} h${op.dayNightCycle ? ", ciclo día/noche activo" : ""}`);
      return;
    }
    case "set_weather": {
      const w = doc.weather;
      if (op.type) {
        w.type = op.type;
        if (op.intensity === undefined) w.intensity = op.type === "clear" ? 0 : op.type === "cloudy" ? 0.4 : 0.75;
        w.clouds = op.type === "clear" ? 0.2 : op.type === "cloudy" ? 0.7 : 0.9;
        if (op.type === "clear") w.wetness = 0;
        if ((op.type === "rain" || op.type === "storm") && op.wetness === undefined) w.wetness = Math.max(w.wetness, 0.8);
        const fog: Record<string, number> = { clear: 0.0016, cloudy: 0.0022, rain: 0.0032, storm: 0.0045, snow: 0.0038, fog: 0.016, sandstorm: 0.011 };
        doc.environment.fogDensity = fog[op.type] ?? doc.environment.fogDensity;
        doc.environment.fogColor = op.type === "sandstorm" ? "#c8a070" : null;
      }
      if (op.intensity !== undefined) w.intensity = op.intensity;
      if (op.wetness !== undefined) w.wetness = op.wetness;
      if (op.wind !== undefined) w.wind = op.wind;
      if (op.clouds !== undefined) w.clouds = op.clouds;
      result.summary.push(`Clima: ${w.type}${w.wetness > 0.4 ? ", superficies mojadas" : ""}`);
      return;
    }
    case "set_npc_behavior": {
      const ids = editable(doc, resolveTarget(doc, op.target, ctx.selection), result).filter((id) => doc.entities[id]!.type === "npc");
      if (!ids.length) return result.warnings.push("No hay personajes para modificar");
      for (const id of ids) {
        const e = doc.entities[id]!;
        if (e.type !== "npc") continue;
        e.props.behavior = op.behavior;
        if (op.speed !== undefined) e.props.speed = op.speed;
      }
      if (op.behavior === "sidewalk" && doc.navigation.nodes.length === 0) result.warnings.push("El mundo no tiene veredas: los personajes deambularán");
      result.summary.push(`${ids.length} personajes ahora: ${op.behavior}`);
      return;
    }
    case "modify_vehicle": {
      const ids = editable(doc, resolveTarget(doc, op.target, ctx.selection), result).filter((id) => doc.entities[id]!.type === "vehicle");
      if (!ids.length) return result.warnings.push("No hay vehículos para modificar");
      for (const id of ids) {
        const e = doc.entities[id]!;
        if (e.type !== "vehicle") continue;
        const c = op.changes;
        if (c.speed !== undefined) e.props.speed = c.speed;
        if (c.speedBy !== undefined) e.props.speed = Math.min(120, round(e.props.speed * c.speedBy, 2));
        if (c.model) e.props.model = c.model;
        if (c.color) e.props.color = c.color;
        if (c.parked !== undefined) e.props.parked = c.parked || !e.props.routeId;
      }
      result.summary.push(`${ids.length} vehículos modificados`);
      return;
    }
    case "add_road": {
      const id = addRoad(doc, op, ctx, result);
      if (id) {
        result.created.push(id);
        result.select = [id];
      }
      return;
    }
    case "modify_terrain": {
      if (op.action === "set_biome") {
        if (!op.biome) return result.warnings.push("Falta el bioma");
        doc.terrain.biome = op.biome;
        doc.terrain.snowLine = op.biome === "snow" ? -1000 : op.biome === "temperate" ? 62 : 999;
        return result.summary.push(`Bioma del terreno: ${op.biome}`);
      }
      const pos = op.position ?? anchorPoint(doc, "center", ctx)!.center;
      const heights = doc.terrain.heights.slice();
      const radius = op.radius ?? 25;
      const strength = op.strength ?? 6;
      const passes = op.action === "smooth" || op.action === "flatten" || op.action === "water" ? 6 : 1;
      for (let k = 0; k < passes; k++)
        applyBrush(doc.terrain, heights, { mode: op.action, x: pos[0], z: pos[1], radius, strength: op.action === "raise" || op.action === "lower" ? strength : 1, targetHeight: heightAt(doc.terrain, pos[0], pos[1]), waterLevel: doc.terrain.waterLevel });
      doc.terrain.heights = heights;
      if (op.action === "water") doc.terrain.waterEnabled = true;
      result.summary.push(`Terreno: ${op.action} en (${Math.round(pos[0])}, ${Math.round(pos[1])}), radio ${radius} m`);
      return;
    }
    case "create_camera_animation": {
      let focus: Vec3 | null = null;
      if (op.target) {
        const ids = resolveTarget(doc, op.target, ctx.selection);
        if (ids.length) {
          const e = doc.entities[ids[0]!]!;
          const p = worldPosition(doc, e.id);
          focus = [p[0], p[1] + entityHeight(e) * 0.6, p[2]];
        }
      }
      if (!focus) focus = tallestBuilding(doc)?.position ?? null;
      const c = siteCenter(doc);
      const duration = op.duration ?? 20;
      const radius = Math.max(50, Math.min(doc.terrain.size * 0.35, siteRadius(doc)));
      doc.animation.camera = op.style === "orbit" ? orbitKeys(doc, c, radius, duration) : flyoverKeys(doc, c[0], c[1], radius, focus, duration);
      doc.animation.duration = Math.max(doc.animation.duration, duration);
      result.summary.push(`Animación de cámara (${op.style === "orbit" ? "órbita" : "sobrevuelo"}) de ${duration} s con ${doc.animation.camera.length} claves`);
      return;
    }
    case "rename_object": {
      const ids = editable(doc, resolveTarget(doc, op.target, ctx.selection), result);
      if (!ids.length) return result.warnings.push("No hay objetos para renombrar");
      const name = sanitizeText(op.name).replace(/\s+/g, "_") || "Objeto";
      ids.forEach((id, i) => (doc.entities[id]!.name = ids.length > 1 ? `${name}_${String(i + 1).padStart(3, "0")}` : name));
      result.summary.push(`Renombrado a ${name}`);
      return;
    }
    case "group_objects": {
      const ids = editable(doc, resolveTarget(doc, op.target, ctx.selection), result).filter((id) => !NON_TRANSFORMABLE.has(doc.entities[id]!.type));
      if (ids.length < 1) return result.warnings.push("Seleccioná objetos para agrupar");
      const gid = groupEntities(doc, ids, op.name);
      result.created.push(gid);
      result.select = [gid];
      result.summary.push(`Grupo ${doc.entities[gid]!.name} con ${ids.length} objetos`);
      return;
    }
    case "set_simulation": {
      if (op.npcs !== undefined) doc.simulation.npcs = op.npcs;
      if (op.traffic !== undefined) doc.simulation.traffic = op.traffic;
      result.summary.push(`Simulación: personajes ${doc.simulation.npcs ? "activos" : "en pausa"}, tránsito ${doc.simulation.traffic ? "activo" : "en pausa"}`);
      return;
    }
  }
}

function siteRadius(doc: WorldDoc): number {
  const c = siteCenter(doc);
  let r = 40;
  for (const e of Object.values(doc.entities)) {
    if (e.type !== "building" && e.type !== "block") continue;
    r = Math.max(r, Math.hypot(e.transform.position[0] - c[0], e.transform.position[2] - c[1]) + 15);
  }
  return r;
}

function orbitKeys(doc: WorldDoc, c: Vec2, radius: number, duration: number) {
  const base = heightAt(doc.terrain, c[0], c[1]);
  const keys = [];
  for (let k = 0; k <= 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    keys.push({
      t: round((k / 8) * duration, 2),
      position: [round(c[0] + Math.cos(a) * radius * 1.3), round(base + radius * 0.55), round(c[1] + Math.sin(a) * radius * 1.3)] as Vec3,
      target: [c[0], base + 5, c[1]] as Vec3,
      fov: 50,
    });
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Creación de objetos
// ---------------------------------------------------------------------------

function addObjects(doc: WorldDoc, op: Extract<Operation, { operation: "add_objects" }>, ctx: OpContext, rng: Rng, result: OpResult): string[] {
  const created: string[] = [];
  const t = doc.terrain;
  const fps = footprints(doc);
  const type = op.objectType as EntityType;
  const variant = validVariant(type, op.variant);
  if (op.variant && !variant) result.warnings.push(`Variante desconocida "${op.variant}", se usa la predeterminada`);
  const total = Object.keys(doc.entities).length;
  const count = Math.min(op.count, LIMITS.maxEntities - total);
  if (count <= 0) {
    result.warnings.push("Se alcanzó el límite de entidades del proyecto");
    return created;
  }
  const style = Object.values(doc.entities).find((e) => e.type === "building")?.type === "building" ? (Object.values(doc.entities).find((e) => e.type === "building") as Extract<Entity, { type: "building" }>).props.style : "modern";

  // Candidatos de posición según el modo.
  let sample: () => Vec2 | null;
  const p = op.placement;
  if (p.mode === "at" && p.position) {
    const pos = p.position;
    let k = 0;
    sample = () => {
      const a = k * 2.399;
      const r = k === 0 ? 0 : 2 * Math.sqrt(k);
      k++;
      return [pos[0] + Math.cos(a) * r, pos[2] + Math.sin(a) * r];
    };
  } else if (p.anchor === "water" && p.mode !== "random") {
    const shore = shorePoints(doc);
    if (!shore.length) {
      result.warnings.push("No hay agua en el mundo: se ubican alrededor del asentamiento");
      const c = siteCenter(doc);
      const r0 = siteRadius(doc);
      sample = () => {
        const a = rng.range(0, Math.PI * 2);
        const r = r0 + rng.range(4, 40);
        return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
      };
    } else {
      // Toma el cuerpo de agua más cercano al primer punto elegido para no mezclar lago y río.
      const pick = shore[rng.int(0, shore.length - 1)]!;
      const near = shore.filter((s) => Math.hypot(s[0] - pick[0], s[1] - pick[1]) < 90);
      sample = () => {
        const s = near[rng.int(0, near.length - 1)]!;
        return [s[0] + rng.range(-3, 3), s[1] + rng.range(-3, 3)];
      };
    }
  } else if (p.mode === "random") {
    const half = t.size / 2 - 8;
    sample = () => [rng.range(-half, half), rng.range(-half, half)];
  } else {
    const anchor = anchorPoint(doc, p.anchor ?? (ctx.selection.length ? "selection" : "center"), ctx);
    if (!anchor) {
      result.warnings.push("No se encontró el objeto de referencia: se ubican alrededor del centro");
    }
    const c = anchor?.center ?? siteCenter(doc);
    const baseR = p.radius ?? (anchor?.radius ?? 20);
    if (p.mode === "line") {
      let k = 0;
      sample = () => [c[0] + (k++ - count / 2) * 4, c[1] + baseR];
    } else if (p.mode === "around") {
      let k = 0;
      sample = () => {
        const a = (k / count) * Math.PI * 2 + rng.range(-0.15, 0.15);
        k++;
        const r = baseR + rng.range(0, Math.max(3, baseR * 0.35));
        return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
      };
    } else {
      sample = () => {
        const a = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * baseR;
        return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
      };
    }
  }

  const needsClearGround = type === "tree" || type === "rock" || type === "plant" || type === "building";
  const placedObbs: Obb2[] = [];
  for (let attempt = 0; attempt < count * 25 && created.length < count; attempt++) {
    const pos = sample();
    if (!pos) break;
    const [x, z] = pos;
    if (!isInsideTerrain(t, x, z, 3)) continue;
    const h = heightAt(t, x, z);
    const exact = p.mode === "at";
    if (!exact) {
      if (t.waterEnabled && h < t.waterLevel + 0.4 && type !== "vehicle") continue;
      if (needsClearGround && slopeAt(t, x, z) > 32) continue;
      if (needsClearGround && fps.some((o) => pointInObb(x, z, o, 0.5))) continue;
      if ((type === "tree" || type === "building" || type === "rock") && onRoad(doc, x, z)) continue;
    }
    const props = defaultProps(type, variant, rng, style);
    if (type === "building") {
      const b = props as Extract<Entity, { type: "building" }>["props"];
      const obb: Obb2 = { cx: x, cz: z, hx: b.width / 2 + 1, hz: b.depth / 2 + 1, rot: 0 };
      if (!exact && (fps.some((o) => obbOverlap(o, obb)) || placedObbs.some((o) => obbOverlap(o, obb)))) continue;
      placedObbs.push(obb);
      fps.push(obb);
    }
    const scale = type === "tree" ? rng.range(0.8, 1.2) : type === "rock" ? rng.range(0.6, 2) : 1;
    const y = type === "light" ? h + 4 : h;
    const e = spawn(doc, {
      id: newId(type.slice(0, 1)),
      type,
      props: props as never,
      transform: { position: [round(x), round(y), round(z)], rotation: [0, round(type === "building" ? 0 : rng.range(0, Math.PI * 2), 3), 0], scale: [round(scale), round(scale), round(scale)] },
      parentId: folderForType(type),
    });
    if (type === "npc" && e.type === "npc") e.props.behavior = doc.navigation.nodes.length ? "sidewalk" : "wander";
    created.push(e.id);
  }
  return created;
}

function validVariant(type: EntityType, v: string | undefined): string | undefined {
  if (!v) return undefined;
  const lists: Partial<Record<EntityType, readonly string[]>> = {
    tree: TREE_SPECIES,
    plant: PLANT_SPECIES,
    building: BUILDING_KINDS,
    prop: PROP_KINDS,
    vehicle: VEHICLE_MODELS,
    npc: NPC_OUTFITS,
    primitive: PRIMITIVE_SHAPES,
    light: ["point", "spot"],
  };
  return lists[type]?.includes(v) ? v : undefined;
}

export function duplicateEntity(doc: WorldDoc, id: string, offset: Vec3): string {
  const src = doc.entities[id]!;
  const mapping = new Map<string, string>();
  const copy = (eid: string, parentId: string | null): string => {
    const e = doc.entities[eid]!;
    const nid = newId(e.type.slice(0, 1));
    mapping.set(eid, nid);
    const clone = structuredClone(e) as Entity;
    clone.id = nid;
    clone.children = [];
    clone.name = allocateName(doc, namePrefix(e));
    if (eid === id) clone.transform.position = [round(e.transform.position[0] + offset[0]), round(e.transform.position[1] + offset[1]), round(e.transform.position[2] + offset[2])];
    insertEntity(doc, clone, parentId);
    for (const c of e.children) copy(c, nid);
    return nid;
  };
  return copy(id, src.parentId);
}

/** Agrupa entidades en un grupo nuevo conservando su posición en el mundo. */
export function groupEntities(doc: WorldDoc, ids: string[], name?: string): string {
  const first = doc.entities[ids[0]!]!;
  const parentId = first.parentId ?? ROOT_ID;
  let cx = 0, cy = Infinity, cz = 0;
  for (const id of ids) {
    const p = worldPosition(doc, id);
    cx += p[0];
    cz += p[2];
    cy = Math.min(cy, p[1]);
  }
  cx /= ids.length;
  cz /= ids.length;
  const gid = newId("g");
  const parentWorld = worldMatrix(doc, parentId);
  const local = parentWorld.clone().invert().multiply(transformToMatrix({ position: [cx, cy, cz], rotation: [0, 0, 0], scale: [1, 1, 1] }));
  insertEntity(
    doc,
    {
      id: gid,
      type: "group",
      name: name ? sanitizeText(name).replace(/\s+/g, "_") : allocateName(doc, "Group"),
      parentId,
      children: [],
      transform: matrixToTransform(local),
      visible: true,
      locked: false,
      props: {},
    } as Entity,
    parentId,
  );
  const groupWorld = worldMatrix(doc, gid);
  const inv = groupWorld.clone().invert();
  for (const id of ids) {
    const w = worldMatrix(doc, id);
    const e = doc.entities[id]!;
    const oldParent = doc.entities[e.parentId ?? ROOT_ID]!;
    oldParent.children = oldParent.children.filter((c) => c !== id);
    e.parentId = gid;
    doc.entities[gid]!.children.push(id);
    e.transform = matrixToTransform(inv.clone().multiply(w));
  }
  return gid;
}

/** Disuelve un grupo: los hijos pasan al padre del grupo conservando su posición. */
export function ungroupEntity(doc: WorldDoc, gid: string): string[] {
  const g = doc.entities[gid];
  if (!g || (g.type !== "group")) return [];
  const parentId = g.parentId ?? ROOT_ID;
  const children = [...g.children];
  const parentInv = worldMatrix(doc, parentId).invert();
  for (const id of children) {
    const w = worldMatrix(doc, id);
    const e = doc.entities[id]!;
    e.parentId = parentId;
    doc.entities[parentId]!.children.push(id);
    e.transform = matrixToTransform(parentInv.clone().multiply(w));
  }
  g.children = [];
  removeEntity(doc, gid);
  return children;
}

function addRoad(doc: WorldDoc, op: Extract<Operation, { operation: "add_road" }>, ctx: OpContext, result: OpResult): string | null {
  let points: Vec2[];
  const width = op.width ?? (op.kind === "highway" ? 14 : op.kind === "dirt" || op.kind === "path" ? 5 : 9);
  if (op.mode === "points") {
    if (!op.points) {
      result.warnings.push("Faltan los puntos de la calle");
      return null;
    }
    points = op.points;
  } else {
    const anchor = anchorPoint(doc, op.anchor ?? "center", ctx);
    if (!anchor) {
      result.warnings.push("No se encontró alrededor de qué trazar la calle");
      return null;
    }
    const r = op.radius ?? (op.anchor === "mountain" ? anchor.radius + 15 : Math.max(siteRadius(doc) + 12, anchor.radius + 20));
    const half = doc.terrain.size / 2 - width;
    points = [];
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      points.push([round(Math.max(-half, Math.min(half, anchor.center[0] + Math.cos(a) * r))), round(Math.max(-half, Math.min(half, anchor.center[1] + Math.sin(a) * r)))]);
    }
  }
  const e = spawn(doc, {
    id: newId("r"),
    type: "road",
    name: allocateName(doc, op.kind === "highway" ? "Highway" : "Road"),
    props: { kind: op.kind, points, closed: op.mode === "ring_around", width, markings: op.kind !== "dirt" && op.kind !== "path" },
    parentId: FOLDERS.streets.id,
  });
  // Una autopista circular también es una ruta para el tránsito.
  if (op.mode === "ring_around" && (op.kind === "highway" || op.kind === "avenue" || op.kind === "street")) {
    doc.routes.push({ id: `route_${e.id}`, points, closed: true, kind: "road", altitude: 0, lane: width / 4, speedLimit: op.kind === "highway" ? 25 : 13 });
  }
  result.summary.push(`${op.kind === "highway" ? "Autopista" : "Calle"} de ${points.length} puntos y ${width} m de ancho`);
  return e.id;
}

export { parentWorldMatrix };
