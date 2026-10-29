import {
  Box3,
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { Rng } from "../rng";
import { defaultBuilding, defaultNpcAppearance, vehicleColor } from "../scene/factory";
import type { BuildingKind, EntityType, NpcOutfit, PlantSpecies, PropKind, TreeSpecies, VehicleModel } from "../types";
import { getBuildingModel, roofPreset, trimPreset, type BuildingPart } from "./building";
import { createHumanoid } from "./humanoid";
import { getMaterial } from "./materials";
import { getPropModel } from "./props";
import { getPlantModel, getRockModel, getTreeModel, type ModelPart } from "./vegetation";
import { getVehicleModel } from "./vehicles";

/** Objeto 3D de vista previa para la biblioteca (misma geometría que en el mundo). */
export function previewObject(type: EntityType, variant?: string): Object3D {
  const g = new Group();
  const addParts = (parts: ModelPart[], tint?: string) => {
    for (const p of parts) {
      const mat = p.tinted && tint ? getMaterial({ preset: "plastic", color: tint, noTexture: true }) : p.material;
      g.add(new Mesh(p.geometry, mat));
    }
  };
  const rng = new Rng(42);
  switch (type) {
    case "building": {
      const props = defaultBuilding((variant as BuildingKind) ?? "house", variant === "futuristic" || variant === "skyscraper" ? "futuristic" : variant === "castle" || variant === "tower" ? "medieval" : "modern", rng);
      if (props.floors > 12) props.floors = 12;
      const model = getBuildingModel(props);
      const colors: Record<BuildingPart, [string, string]> = {
        wall: [props.wall, props.wallColor],
        roof: [roofPreset(props), props.roofColor],
        trim: [trimPreset(props), props.accentColor],
        winLit: ["glass", "#ffd08a"],
        winDark: ["glass", props.windowColor],
        neon: ["neon", props.accentColor],
        detail: ["metal", "#8d9299"],
        door: ["wood", "#4a3426"],
      };
      for (const [part, geo] of model.parts) {
        const [preset, color] = colors[part];
        g.add(new Mesh(geo, getMaterial({ preset: preset as never, color, doubleSide: part === "roof" })));
      }
      break;
    }
    case "tree":
      addParts(getTreeModel((variant as TreeSpecies) ?? "oak", "temperate"));
      break;
    case "plant":
      addParts(getPlantModel((variant as PlantSpecies) ?? "bush", "fantasy"), variant === "flowers" ? "#e8434a" : variant === "mushroom" ? "#d23c3c" : variant === "crystal" ? "#59e0ff" : undefined);
      break;
    case "rock":
      addParts(getRockModel(2, "temperate"));
      break;
    case "prop":
      addParts(getPropModel((variant as PropKind) ?? "bench").parts, variant === "billboard" ? "#ff2bd6" : variant === "stall" ? "#c0392b" : variant === "parasol" ? "#e74c3c" : variant === "lantern" ? "#d64541" : "#9a7a5a");
      break;
    case "vehicle": {
      const model = (variant as VehicleModel) ?? "sedan";
      const def = getVehicleModel(model);
      addParts(def.body, vehicleColor(model, rng));
      if (def.wheels) for (const pos of def.wheels.positions) for (const p of def.wheels.parts) {
        const m = new Mesh(p.geometry, p.material);
        m.position.set(...pos);
        g.add(m);
      }
      break;
    }
    case "npc": {
      const h = createHumanoid(defaultNpcAppearance((variant as NpcOutfit) ?? "casual", rng));
      g.add(h.group);
      break;
    }
    case "light": {
      g.add(new Mesh(new SphereGeometry(0.4, 16, 12), new MeshStandardMaterial({ color: "#fff2d0", emissive: "#ffd28a", emissiveIntensity: 2 })));
      if (variant === "spot") {
        const cone = new Mesh(new ConeGeometry(0.6, 1.2, 16, 1, true), new MeshStandardMaterial({ color: "#ffd28a", transparent: true, opacity: 0.35 }));
        cone.position.y = -0.8;
        g.add(cone);
      }
      break;
    }
    case "primitive": {
      const mat = new MeshStandardMaterial({ color: "#9aa4b8", roughness: 0.5 });
      const geo =
        variant === "sphere" ? new SphereGeometry(0.5, 24, 16) : variant === "cylinder" ? new CylinderGeometry(0.5, 0.5, 1, 24) : variant === "cone" ? new ConeGeometry(0.5, 1, 24) : variant === "torus" ? new TorusGeometry(0.35, 0.15, 12, 24) : variant === "capsule" ? new CapsuleGeometry(0.3, 0.4, 6, 12) : variant === "plane" ? new PlaneGeometry(1, 1).rotateX(-Math.PI / 2) : new BoxGeometry(1, 1, 1);
      g.add(new Mesh(geo, mat));
      break;
    }
    default:
      g.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: "#666" })));
  }
  return g;
}

let renderer: WebGLRenderer | null = null;
const cache = new Map<string, string>();
const SIZE = 112;

/** Renderiza una miniatura (dataURL) con un renderer fuera de pantalla compartido. */
export function renderThumbnail(type: EntityType, variant?: string): string | null {
  const key = `${type}|${variant ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === "undefined") return null;
  try {
    if (!renderer) {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(SIZE, SIZE);
    }
    const scene = new Scene();
    scene.add(new HemisphereLight("#dfe8ff", "#3a3a33", 1.6));
    const sun = new DirectionalLight("#ffffff", 2.2);
    sun.position.set(3, 5, 4);
    scene.add(sun);
    const obj = previewObject(type, variant);
    obj.rotation.y = -0.6;
    scene.add(obj);
    const box = new Box3().setFromObject(obj);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const camera = new PerspectiveCamera(32, 1, 0.01, 5000);
    const dist = Math.max(size.x, size.y, size.z) * 1.9 + 0.5;
    camera.position.set(center.x + dist * 0.65, center.y + dist * 0.5, center.z + dist * 0.85);
    camera.lookAt(center);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL("image/png");
    cache.set(key, url);
    return url;
  } catch {
    return null;
  }
}
