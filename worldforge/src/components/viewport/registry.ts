import { Box3, Matrix4, Vector3, type Object3D } from "three";
import { getBuildingModel } from "@/engine/models/building";
import { getPropModel } from "@/engine/models/props";
import { getRockModel, getPlantModel, getTreeModel } from "@/engine/models/vegetation";
import { getVehicleModel } from "@/engine/models/vehicles";
import { worldMatrix } from "@/engine/scene/doc";
import type { SimWorld } from "@/engine/sim/world";
import type { Entity, WorldDoc } from "@/engine/types";

/**
 * Registro de objetos 3D por entidad y del estado de simulación compartido
 * entre componentes del visor (sin pasar por React en cada cuadro).
 */

export const objectRegistry = new Map<string, Object3D>();

export const runtime: {
  sim: SimWorld | null;
  simActive: boolean;
  /** Matrices de mundo animadas por la línea de tiempo (reemplazan a las del documento). */
  overrides: Map<string, Matrix4>;
  overrideVersion: number;
  lightIntensity: Map<string, number>;
  timeOfDay: number | null;
} = { sim: null, simActive: false, overrides: new Map(), overrideVersion: 0, lightIntensity: new Map(), timeOfDay: null };

const _box = new Box3();

/** Caja local aproximada de una entidad (para el contorno de selección y el encuadre). */
export function localBounds(doc: WorldDoc, e: Entity): Box3 | null {
  switch (e.type) {
    case "building": {
      const m = getBuildingModel(e.props);
      return new Box3(new Vector3(-e.props.width / 2, 0, -e.props.depth / 2), new Vector3(e.props.width / 2, m.height, e.props.depth / 2));
    }
    case "tree":
      return unionParts(getTreeModel(e.props.species, doc.terrain.biome).map((p) => p.geometry));
    case "plant":
      return unionParts(getPlantModel(e.props.species, doc.terrain.biome).map((p) => p.geometry));
    case "rock":
      return unionParts(getRockModel(e.props.variant, doc.terrain.biome).map((p) => p.geometry));
    case "prop":
      return unionParts(getPropModel(e.props.kind).parts.map((p) => p.geometry));
    case "vehicle": {
      const v = getVehicleModel(e.props.model);
      return new Box3(new Vector3(-v.width / 2, 0, -v.length / 2), new Vector3(v.width / 2, v.height + v.hover, v.length / 2));
    }
    case "npc":
      return new Box3(new Vector3(-0.3, 0, -0.2), new Vector3(0.3, e.props.appearance.height + 0.05, 0.2));
    case "primitive":
      return new Box3(new Vector3(-0.5, 0, -0.5), new Vector3(0.5, 1, 0.5));
    case "light":
    case "camera":
    case "spawn":
      return new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5));
    case "block":
      return new Box3(new Vector3(-e.props.size[0] / 2, 0, -e.props.size[1] / 2), new Vector3(e.props.size[0] / 2, 0.3, e.props.size[1] / 2));
    case "model": {
      const o = objectRegistry.get(e.id);
      if (!o) return new Box3(new Vector3(-1, 0, -1), new Vector3(1, 2, 1));
      o.updateWorldMatrix(true, true);
      _box.setFromObject(o);
      const inv = o.matrixWorld.clone().invert();
      return _box.clone().applyMatrix4(inv);
    }
    default:
      return null;
  }
}

function unionParts(geoms: { boundingBox: Box3 | null; computeBoundingBox(): void }[]): Box3 {
  const b = new Box3();
  for (const g of geoms) {
    if (!g.boundingBox) g.computeBoundingBox();
    b.union(g.boundingBox!);
  }
  return b;
}

/** Caja en coordenadas de mundo (incluye la posición simulada si corresponde). */
export function worldBounds(doc: WorldDoc, id: string): Box3 | null {
  const e = doc.entities[id];
  if (!e) return null;
  if (e.type === "road") {
    const b = new Box3();
    for (const [x, z] of e.props.points) b.expandByPoint(new Vector3(x, 0, z));
    b.min.y = -2;
    b.max.y = 10;
    return b;
  }
  if (e.type === "folder" || e.type === "group" || e.type === "world") {
    const b = new Box3();
    for (const c of e.children) {
      const cb = worldBounds(doc, c);
      if (cb) b.union(cb);
    }
    return b.isEmpty() ? null : b;
  }
  const local = localBounds(doc, e);
  if (!local) return null;
  return local.clone().applyMatrix4(liveMatrix(doc, id));
}

const _m = new Matrix4();
/** Matriz de mundo de una entidad, tomando la pose simulada si está en movimiento. */
export function liveMatrix(doc: WorldDoc, id: string, out = new Matrix4()): Matrix4 {
  const ov = runtime.overrides.get(id);
  if (ov) return out.copy(ov);
  const sim = runtime.simActive ? runtime.sim : null;
  const v = sim?.vehicles.get(id);
  if (v && !v.parked) return out.makeRotationY(v.yaw).setPosition(v.x, v.y, v.z);
  const n = sim?.npcs.get(id);
  if (n) return out.makeRotationY(n.yaw).setPosition(n.x, n.y, n.z);
  return worldMatrix(doc, id, out);
}

export { _m };
