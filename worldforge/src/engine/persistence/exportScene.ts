import {
  AnimationClip,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  Object3D,
  PlaneGeometry,
  QuaternionKeyframeTrack,
  Quaternion,
  Euler,
  VectorKeyframeTrack,
  BoxGeometry,
  SphereGeometry,
  CylinderGeometry,
  ConeGeometry,
  TorusGeometry,
  CapsuleGeometry,
  type BufferGeometry,
  type Material,
} from "three";
import { getBuildingModel, roofPreset, trimPreset, type BuildingPart } from "../models/building";
import { createHumanoid } from "../models/humanoid";
import { getMaterial, materialFromSpec } from "../models/materials";
import { getPropModel } from "../models/props";
import { buildStreets } from "../models/streets";
import { buildChunkGeometry, CHUNKS_PER_SIDE } from "../models/terrainMesh";
import { getPlantModel, getRockModel, getTreeModel, type ModelPart } from "../models/vegetation";
import { getVehicleModel } from "../models/vehicles";
import { DEFAULT_MATERIAL, isEffectivelyVisible, worldMatrix } from "../scene/doc";
import type { Entity, EntityOf, WorldDoc } from "../types";

/**
 * Construye una escena limpia a partir del documento para exportar a
 * glTF/GLB: geometría real de cada entidad, materiales PBR, vegetación con
 * instancias y animaciones de la línea de tiempo cuando se pueden conservar.
 */

export interface ExportBuild {
  root: Group;
  animations: AnimationClip[];
  warnings: string[];
}

const BUILDING_PART_ORDER: BuildingPart[] = ["wall", "roof", "trim", "winLit", "winDark", "neon", "detail", "door"];

function buildingMaterials(p: EntityOf<"building">["props"], keys: string[]): Material[] {
  return keys.map((k) => {
    switch (k as BuildingPart) {
      case "wall":
        return getMaterial({ preset: p.wall, color: p.wallColor });
      case "roof":
        return getMaterial({ preset: roofPreset(p), color: p.roofColor, doubleSide: true });
      case "trim":
        return getMaterial({ preset: trimPreset(p), color: p.accentColor });
      case "winLit":
        return getMaterial({ preset: "glass", color: p.windowColor, emissive: "#ffd08a", emissiveIntensity: 0.6, noTexture: true });
      case "winDark":
        return getMaterial({ preset: "glass", color: p.windowColor, noTexture: true });
      case "neon":
        return getMaterial({ preset: "neon", color: p.accentColor });
      case "detail":
        return getMaterial({ preset: "metal", color: "#8d9299" });
      default:
        return getMaterial({ preset: "wood", color: "#4a3426" });
    }
  });
}

/** Une las partes de un edificio en una malla con grupos de material. */
function buildingMesh(e: EntityOf<"building">): Mesh {
  const model = getBuildingModel(e.props);
  const parts: { key: string; geo: BufferGeometry }[] = [];
  for (const key of BUILDING_PART_ORDER) {
    const g = model.parts.get(key);
    if (g) parts.push({ key, geo: g });
  }
  const merged = mergeWithGroups(parts.map((p) => p.geo));
  return new Mesh(merged, buildingMaterials(e.props, parts.map((p) => p.key)));
}

function mergeWithGroups(geos: BufferGeometry[]): BufferGeometry {
  const first = geos[0]!;
  const out = first.clone();
  if (geos.length === 1) {
    out.addGroup(0, first.getAttribute("position").count, 0);
    return out;
  }
  const names = ["position", "normal", "uv"] as const;
  const total = geos.reduce((s, g) => s + g.getAttribute("position").count, 0);
  for (const name of names) {
    const size = first.getAttribute(name).itemSize;
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of geos) {
      const a = g.getAttribute(name).array as Float32Array;
      arr.set(a, o);
      o += a.length;
    }
    out.setAttribute(name, new (first.getAttribute(name).constructor as typeof import("three").BufferAttribute)(arr, size));
  }
  out.clearGroups();
  let start = 0;
  geos.forEach((g, i) => {
    const c = g.getAttribute("position").count;
    out.addGroup(start, c, i);
    start += c;
  });
  return out;
}

function instancedGroup(name: string, parts: ModelPart[], matrices: Matrix4[], colors: Color[] | null): Object3D {
  const g = new Group();
  g.name = name;
  parts.forEach((p, i) => {
    const m = new InstancedMesh(p.geometry, (p.material as MeshStandardMaterial).clone(), matrices.length);
    // Los shaders con viento no se exportan: material estándar equivalente.
    (m.material as MeshStandardMaterial).onBeforeCompile = () => {};
    matrices.forEach((mat, k) => m.setMatrixAt(k, mat));
    if (colors && p.tinted) colors.forEach((c, k) => m.setColorAt(k, c));
    m.name = `${name}_${i}`;
    g.add(m);
  });
  return g;
}

export function buildExportScene(doc: WorldDoc, opts: { includeTerrain?: boolean; includeVegetation?: boolean } = {}): ExportBuild {
  const root = new Group();
  root.name = doc.name.replace(/[^\w\- ]/g, "_") || "WorldForge";
  const warnings: string[] = [];
  const used = new Map<string, number>();
  const uniqueName = (n: string) => {
    const c = used.get(n) ?? 0;
    used.set(n, c + 1);
    return c ? `${n}_${c}` : n;
  };
  const nodeById = new Map<string, Object3D>();
  const place = (o: Object3D, e: Entity) => {
    o.name = uniqueName(e.name);
    o.userData = { worldforgeId: e.id, type: e.type };
    worldMatrix(doc, e.id).decompose(o.position, o.quaternion, o.scale);
    root.add(o);
    nodeById.set(e.id, o);
  };

  // Terreno a resolución completa.
  if (opts.includeTerrain !== false) {
    const terrain = new Group();
    terrain.name = "Terrain";
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    for (let cj = 0; cj < CHUNKS_PER_SIDE; cj++)
      for (let ci = 0; ci < CHUNKS_PER_SIDE; ci++) {
        const m = new Mesh(buildChunkGeometry(doc.terrain, ci, cj, 1), mat);
        m.name = `Terrain_${ci}_${cj}`;
        terrain.add(m);
      }
    root.add(terrain);
    if (doc.terrain.waterEnabled) {
      const water = new Mesh(new PlaneGeometry(doc.terrain.size, doc.terrain.size).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: "#1f5f7a", roughness: 0.1, transparent: true, opacity: 0.85 }));
      water.position.y = doc.terrain.waterLevel;
      water.name = "Water";
      root.add(water);
    }
  }

  // Calles y manzanas.
  const roads = Object.values(doc.entities).filter((e): e is EntityOf<"road"> => e.type === "road" && isEffectivelyVisible(doc, e.id));
  const blocks = Object.values(doc.entities).filter((e): e is EntityOf<"block"> => e.type === "block" && isEffectivelyVisible(doc, e.id));
  if (roads.length || blocks.length) {
    const streets = buildStreets(doc.terrain, roads, blocks, doc.intersections);
    const g = new Group();
    g.name = "Streets";
    const colors: Record<string, string> = { asphalt: "#55585d", dirt: "#8f7556", marking: "#f0efe8", curbRed: "#d23c3c", curbWhite: "#f2f2f2", sidewalk: "#b9b5ad", curb: "#9a968f", grass: "#5f8f3e", plaza: "#c7bba5", parking: "#4d5055" };
    for (const [part, { geometry }] of streets.parts) {
      const m = new Mesh(geometry, new MeshStandardMaterial({ color: colors[part] ?? "#888888", roughness: 0.9 }));
      m.name = `Streets_${part}`;
      g.add(m);
    }
    root.add(g);
  }

  // Vegetación y mobiliario con instancias (EXT_mesh_gpu_instancing).
  if (opts.includeVegetation !== false) {
    const groups = new Map<string, { parts: ModelPart[]; matrices: Matrix4[]; colors: Color[] }>();
    for (const e of Object.values(doc.entities)) {
      if (!isEffectivelyVisible(doc, e.id)) continue;
      let key: string | null = null;
      let parts: ModelPart[] | null = null;
      let color = new Color("#ffffff");
      if (e.type === "tree") {
        key = `Trees_${e.props.species}`;
        parts = getTreeModel(e.props.species, doc.terrain.biome);
      } else if (e.type === "plant") {
        key = `Plants_${e.props.species}`;
        parts = getPlantModel(e.props.species, doc.terrain.biome);
      } else if (e.type === "rock") {
        key = `Rocks_${e.props.variant}`;
        parts = getRockModel(e.props.variant, doc.terrain.biome);
      } else if (e.type === "prop") {
        key = `Props_${e.props.kind}`;
        parts = getPropModel(e.props.kind).parts;
        color = new Color(e.props.color);
      }
      if (!key || !parts) continue;
      if (!groups.has(key)) groups.set(key, { parts, matrices: [], colors: [] });
      const g = groups.get(key)!;
      g.matrices.push(worldMatrix(doc, e.id));
      g.colors.push(color);
    }
    for (const [name, g] of groups) root.add(instancedGroup(name, g.parts, g.matrices, g.colors));
  }

  let npcCount = 0;
  let movingVehicles = 0;
  for (const e of Object.values(doc.entities)) {
    if (!isEffectivelyVisible(doc, e.id)) continue;
    switch (e.type) {
      case "building":
        place(buildingMesh(e), e);
        break;
      case "vehicle": {
        const def = getVehicleModel(e.props.model);
        const g = new Group();
        for (const p of def.body) {
          const mat = p.tinted ? getMaterial({ preset: "metal", color: e.props.color, roughness: 0.32, metalness: 0.55, noTexture: true }) : p.material;
          g.add(new Mesh(p.geometry, mat));
        }
        if (def.wheels) for (const pos of def.wheels.positions) for (const p of def.wheels.parts) {
          const w = new Mesh(p.geometry, p.material);
          w.position.set(...pos);
          g.add(w);
        }
        if (e.props.routeId && !e.props.parked) movingVehicles++;
        place(g, e);
        break;
      }
      case "npc": {
        const h = createHumanoid(e.props.appearance);
        npcCount++;
        place(h.group, e);
        break;
      }
      case "primitive": {
        const geo =
          e.props.shape === "sphere" ? new SphereGeometry(0.5, 32, 16) : e.props.shape === "cylinder" ? new CylinderGeometry(0.5, 0.5, 1, 32) : e.props.shape === "cone" ? new ConeGeometry(0.5, 1, 32) : e.props.shape === "torus" ? new TorusGeometry(0.35, 0.15, 16, 32) : e.props.shape === "capsule" ? new CapsuleGeometry(0.3, 0.4, 8, 16) : e.props.shape === "plane" ? new PlaneGeometry(1, 1).rotateX(-Math.PI / 2) : new BoxGeometry(1, 1, 1);
        if (e.props.shape !== "plane") geo.translate(0, 0.5, 0);
        place(new Mesh(geo, materialFromSpec(e.material ?? DEFAULT_MATERIAL)), e);
        break;
      }
      case "light":
      case "camera":
      case "spawn": {
        const o = new Object3D();
        place(o, e);
        break;
      }
      case "model":
        warnings.push(`${e.name}: los modelos GLB importados se exportan desde su archivo original (no se reempaquetan).`);
        break;
      default:
        break;
    }
  }
  if (npcCount) warnings.push(`${npcCount} personajes se exportan en pose de reposo: sus comportamientos y la navegación no existen en glTF.`);
  if (movingVehicles) warnings.push(`${movingVehicles} vehículos se exportan detenidos: la simulación de tránsito no se conserva en glTF.`);
  warnings.push("El cielo, el clima y el ciclo día/noche no forman parte del formato glTF.");

  // Animaciones de la línea de tiempo (pistas de transformación).
  const animations: AnimationClip[] = [];
  const tracks = [];
  for (const t of doc.animation.tracks) {
    const node = nodeById.get(t.entityId);
    if (!node || t.property === "timeOfDay" || t.property === "intensity") continue;
    const times = t.keys.map((k) => k.t);
    if (t.property === "rotation") {
      const values: number[] = [];
      for (const k of t.keys) values.push(...new Quaternion().setFromEuler(new Euler(k.value[0], k.value[1], k.value[2])).toArray());
      tracks.push(new QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values));
    } else tracks.push(new VectorKeyframeTrack(`${node.name}.${t.property}`, times, t.keys.flatMap((k) => k.value)));
  }
  if (tracks.length) animations.push(new AnimationClip("Timeline", doc.animation.duration, tracks));
  if (doc.animation.camera.length) warnings.push("La trayectoria de cámara cinematográfica no se exporta (usá la secuencia de imágenes).");
  void NumberKeyframeTrack;
  return { root, animations, warnings };
}
