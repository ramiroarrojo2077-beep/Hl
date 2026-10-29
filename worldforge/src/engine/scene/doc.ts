import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { newId } from "../ids";
import {
  FORMAT_ID,
  FORMAT_VERSION,
  type Entity,
  type EntityOf,
  type EntityType,
  type MaterialSpec,
  type Transform,
  type WorldDoc,
} from "../types";

export const ROOT_ID = "world";

/** Carpetas fijas del mundo, en el orden en que aparecen en la jerarquía. */
export const FOLDERS = {
  buildings: { id: "f_buildings", name: "Buildings" },
  streets: { id: "f_streets", name: "Streets" },
  vegetation: { id: "f_vegetation", name: "Vegetation" },
  props: { id: "f_props", name: "Props" },
  characters: { id: "f_characters", name: "Characters" },
  vehicles: { id: "f_vehicles", name: "Vehicles" },
  lighting: { id: "f_lighting", name: "Lighting" },
  cameras: { id: "f_cameras", name: "Cameras" },
  models: { id: "f_models", name: "Models" },
} as const;
export type FolderKey = keyof typeof FOLDERS;

export const SINGLETONS = {
  terrain: "terrain",
  environment: "environment",
  weather: "weather",
} as const;

/** Carpeta por defecto donde va cada tipo de entidad. */
export function folderForType(type: EntityType): string {
  switch (type) {
    case "building":
      return FOLDERS.buildings.id;
    case "road":
    case "block":
      return FOLDERS.streets.id;
    case "tree":
    case "plant":
    case "rock":
      return FOLDERS.vegetation.id;
    case "npc":
      return FOLDERS.characters.id;
    case "vehicle":
      return FOLDERS.vehicles.id;
    case "light":
      return FOLDERS.lighting.id;
    case "camera":
    case "spawn":
      return FOLDERS.cameras.id;
    case "model":
      return FOLDERS.models.id;
    default:
      return FOLDERS.props.id;
  }
}

/** Prefijo de nombre legible para cada tipo (Building_001, Tree_014...). */
export function namePrefix(entity: Pick<Entity, "type" | "props">): string {
  switch (entity.type) {
    case "building":
      return "Building";
    case "tree":
      return "Tree";
    case "plant":
      return "Plant";
    case "rock":
      return "Rock";
    case "npc":
      return "NPC";
    case "vehicle":
      return "Vehicle";
    case "road":
      return "Road";
    case "block":
      return "Block";
    case "light":
      return "Light";
    case "camera":
      return "Camera";
    case "primitive":
      return capitalize((entity.props as { shape: string }).shape);
    case "prop":
      return capitalize((entity.props as { kind: string }).kind.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()));
    case "model":
      return "Model";
    case "group":
      return "Group";
    case "spawn":
      return "PlayerSpawn";
    default:
      return capitalize(entity.type);
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function identityTransform(position: [number, number, number] = [0, 0, 0]): Transform {
  return { position, rotation: [0, 0, 0], scale: [1, 1, 1] };
}

export const DEFAULT_MATERIAL: MaterialSpec = {
  preset: "plastic",
  color: "#9aa4b8",
  roughness: 0.6,
  metalness: 0,
  emissive: "#000000",
  emissiveIntensity: 0,
  opacity: 1,
};

function baseEntity<T extends EntityType>(
  id: string,
  type: T,
  name: string,
  parentId: string | null,
  props: EntityOf<T>["props"],
): EntityOf<T> {
  return {
    id,
    type,
    name,
    parentId,
    children: [],
    transform: identityTransform(),
    visible: true,
    locked: false,
    props,
  } as unknown as EntityOf<T>;
}

/** Documento vacío con el esqueleto del mundo (carpetas, terreno plano, ambiente y clima). */
export function createEmptyDoc(name = "Mundo sin título", resolution = 64, size = 200): WorldDoc {
  const now = Date.now();
  const entities: Record<string, Entity> = {};
  const root = baseEntity(ROOT_ID, "world", "World", null, {});
  entities[ROOT_ID] = root;
  const add = (e: Entity) => {
    entities[e.id] = e;
    root.children.push(e.id);
  };
  add(baseEntity(SINGLETONS.terrain, "terrain", "Terrain", ROOT_ID, {}));
  add(baseEntity(SINGLETONS.environment, "environment", "Environment", ROOT_ID, {}));
  for (const f of Object.values(FOLDERS)) add(baseEntity(f.id, "folder", f.name, ROOT_ID, { category: f.id.slice(2) }));
  add(baseEntity(SINGLETONS.weather, "weather", "Weather", ROOT_ID, {}));

  const verts = (resolution + 1) ** 2;
  return {
    format: FORMAT_ID,
    formatVersion: FORMAT_VERSION,
    id: newId("w"),
    name,
    prompt: "",
    seed: 1,
    createdAt: now,
    updatedAt: now,
    rootId: ROOT_ID,
    entities,
    counters: {},
    terrain: {
      size,
      resolution,
      heights: new Array(verts).fill(0),
      paint: new Array(verts).fill(0),
      waterLevel: -2,
      waterEnabled: false,
      biome: "temperate",
      snowLine: 999,
    },
    environment: {
      timeOfDay: 13,
      dayNightCycle: false,
      cycleMinutes: 10,
      sunIntensity: 2.2,
      ambientIntensity: 0.6,
      sky: "earth",
      fogDensity: 0.0025,
      fogColor: null,
      exposure: 1,
    },
    weather: { type: "clear", intensity: 0, wind: 0.2, clouds: 0.2, wetness: 0 },
    routes: [],
    intersections: [],
    navigation: { nodes: [], edges: [], pois: [] },
    animation: { duration: 20, fps: 30, tracks: [], camera: [] },
    simulation: { npcs: true, traffic: true },
    assets: {},
  };
}

/** Reserva el siguiente nombre numerado (Building_001...). Muta `doc.counters`: usar dentro de un draft. */
export function allocateName(doc: WorldDoc, prefix: string): string {
  const n = (doc.counters[prefix] ?? 0) + 1;
  doc.counters[prefix] = n;
  return `${prefix}_${String(n).padStart(3, "0")}`;
}

/** Inserta una entidad en el documento (muta el draft). */
export function insertEntity(doc: WorldDoc, entity: Entity, parentId?: string | null, index?: number): Entity {
  const parent = parentId === undefined ? folderForType(entity.type) : parentId;
  const target = parent && doc.entities[parent] ? parent : ROOT_ID;
  entity.parentId = target;
  doc.entities[entity.id] = entity;
  const siblings = doc.entities[target]!.children;
  if (index === undefined || index < 0 || index > siblings.length) siblings.push(entity.id);
  else siblings.splice(index, 0, entity.id);
  return entity;
}

/** Quita una entidad y toda su descendencia (muta el draft). Devuelve los ids eliminados. */
export function removeEntity(doc: WorldDoc, id: string): string[] {
  const e = doc.entities[id];
  if (!e) return [];
  const removed: string[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    const ce = doc.entities[cur];
    if (!ce) continue;
    stack.push(...ce.children);
    removed.push(cur);
  }
  if (e.parentId && doc.entities[e.parentId]) {
    const siblings = doc.entities[e.parentId]!.children;
    const i = siblings.indexOf(id);
    if (i >= 0) siblings.splice(i, 1);
  }
  for (const r of removed) delete doc.entities[r];
  const removedSet = new Set(removed);
  doc.animation.tracks = doc.animation.tracks.filter((t) => !removedSet.has(t.entityId));
  return removed;
}

export function isAncestor(doc: WorldDoc, ancestorId: string, id: string): boolean {
  let cur = doc.entities[id]?.parentId ?? null;
  while (cur) {
    if (cur === ancestorId) return true;
    cur = doc.entities[cur]?.parentId ?? null;
  }
  return false;
}

/** Mueve una entidad a otro padre (muta el draft). No permite ciclos. */
export function reparent(doc: WorldDoc, id: string, newParentId: string, index?: number): boolean {
  const e = doc.entities[id];
  const np = doc.entities[newParentId];
  if (!e || !np || id === newParentId || isAncestor(doc, id, newParentId)) return false;
  if (e.parentId && doc.entities[e.parentId]) {
    const siblings = doc.entities[e.parentId]!.children;
    const i = siblings.indexOf(id);
    if (i >= 0) siblings.splice(i, 1);
  }
  e.parentId = newParentId;
  if (index === undefined || index < 0 || index > np.children.length) np.children.push(id);
  else np.children.splice(index, 0, id);
  return true;
}

// ---------- Matrices ----------

const _e = new Euler();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();

export function transformToMatrix(t: Transform, out = new Matrix4()): Matrix4 {
  _e.set(t.rotation[0], t.rotation[1], t.rotation[2], "XYZ");
  _q.setFromEuler(_e);
  _p.set(t.position[0], t.position[1], t.position[2]);
  _s.set(t.scale[0], t.scale[1], t.scale[2]);
  return out.compose(_p, _q, _s);
}

export function matrixToTransform(m: Matrix4): Transform {
  m.decompose(_p, _q, _s);
  _e.setFromQuaternion(_q, "XYZ");
  const r = (v: number) => Math.round(v * 10000) / 10000;
  return {
    position: [r(_p.x), r(_p.y), r(_p.z)],
    rotation: [r(_e.x), r(_e.y), r(_e.z)],
    scale: [r(_s.x), r(_s.y), r(_s.z)],
  };
}

/** Matriz de mundo de una entidad componiendo las transformaciones de sus ancestros. */
export function worldMatrix(doc: Pick<WorldDoc, "entities">, id: string, out = new Matrix4()): Matrix4 {
  out.identity();
  const chain: Transform[] = [];
  let cur: string | null = id;
  let guard = 0;
  while (cur && guard++ < 256) {
    const e: Entity | undefined = doc.entities[cur];
    if (!e) break;
    chain.push(e.transform);
    cur = e.parentId;
  }
  const tmp = new Matrix4();
  for (let i = chain.length - 1; i >= 0; i--) out.multiply(transformToMatrix(chain[i]!, tmp));
  return out;
}

export function parentWorldMatrix(doc: Pick<WorldDoc, "entities">, id: string, out = new Matrix4()): Matrix4 {
  const parent = doc.entities[id]?.parentId;
  return parent ? worldMatrix(doc, parent, out) : out.identity();
}

export function worldPosition(doc: Pick<WorldDoc, "entities">, id: string): [number, number, number] {
  const m = worldMatrix(doc, id);
  return [m.elements[12]!, m.elements[13]!, m.elements[14]!];
}

/** Lista de ids en orden de jerarquía (profundidad primero). */
export function flattenTree(doc: Pick<WorldDoc, "entities" | "rootId">, rootId = doc.rootId): string[] {
  const out: string[] = [];
  const visit = (id: string) => {
    const e = doc.entities[id];
    if (!e) return;
    out.push(id);
    for (const c of e.children) visit(c);
  };
  visit(rootId);
  return out;
}

export function entitiesOfType<T extends EntityType>(doc: Pick<WorldDoc, "entities">, type: T): EntityOf<T>[] {
  const out: EntityOf<T>[] = [];
  for (const e of Object.values(doc.entities)) if (e.type === type) out.push(e as EntityOf<T>);
  return out;
}

export function countEntities(doc: Pick<WorldDoc, "entities">): number {
  return Object.keys(doc.entities).length;
}

/** Visible si ella y todos sus ancestros son visibles. */
export function isEffectivelyVisible(doc: Pick<WorldDoc, "entities">, id: string): boolean {
  let cur: string | null = id;
  let guard = 0;
  while (cur && guard++ < 256) {
    const e: Entity | undefined = doc.entities[cur];
    if (!e) return false;
    if (!e.visible) return false;
    cur = e.parentId;
  }
  return true;
}

export function isEffectivelyLocked(doc: Pick<WorldDoc, "entities">, id: string): boolean {
  let cur: string | null = id;
  let guard = 0;
  while (cur && guard++ < 256) {
    const e: Entity | undefined = doc.entities[cur];
    if (!e) return false;
    if (e.locked) return true;
    cur = e.parentId;
  }
  return false;
}
