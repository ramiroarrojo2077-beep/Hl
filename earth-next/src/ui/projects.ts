/**
 * Proyectos: guardan vista de cámara, capas, dibujos, recorridos y hora de la escena.
 * Se pueden guardar en el navegador o exportar/importar como archivo .earthnext.json.
 */
import { persisted, notify } from "../state/store.ts";
import { downloadBlob, type UserFeature } from "../engine/userdata.ts";
import type { Engine } from "../engine/engine.ts";
import type { ActiveLayer } from "../engine/imagery.ts";
import type { CameraPose, Tour } from "../geo/tour.ts";
import { savedTours } from "../engine/tours.ts";
import { newId } from "../geo/tour.ts";

export interface ProjectFile {
  format: "earth-next-project";
  version: 1;
  id: string;
  name: string;
  savedAt: string;
  camera: CameraPose;
  time: string;
  layers: { base: string; baseDate?: string; overlays: ActiveLayer[] };
  features: UserFeature[];
  tours: Tour[];
}

export const projects = persisted<ProjectFile[]>("projects", []);

export function buildProject(engine: Engine, name: string): ProjectFile {
  return {
    format: "earth-next-project",
    version: 1,
    id: newId("prj"),
    name,
    savedAt: new Date().toISOString(),
    camera: engine.getPose(),
    time: engine.time.current.toISOString(),
    layers: engine.imagery.snapshot(),
    features: engine.userData.toGeoJson().features,
    tours: savedTours.value,
  };
}

export function applyProject(engine: Engine, p: ProjectFile): void {
  if (p.format !== "earth-next-project") throw new Error("El archivo no es un proyecto de EARTH NEXT.");
  engine.imagery.restore(p.layers);
  engine.userData.replaceAll(p.features ?? []);
  if (p.tours?.length) {
    const ids = new Set(savedTours.value.map((x) => x.id));
    savedTours.value = [...savedTours.value, ...p.tours.filter((x) => !ids.has(x.id))];
  }
  if (p.time) engine.time.setTime(new Date(p.time));
  engine.tours.applyPose(p.camera);
}

export function saveProjectLocal(engine: Engine, name: string): void {
  const p = buildProject(engine, name);
  projects.value = [p, ...projects.value].slice(0, 30);
}

export function loadProjectLocal(engine: Engine, id: string): void {
  const p = projects.value.find((x) => x.id === id);
  if (!p) return;
  applyProject(engine, p);
  notify(`"${p.name}"`, "success");
}

export function deleteProjectLocal(id: string): void {
  projects.value = projects.value.filter((x) => x.id !== id);
}

export function exportProject(engine: Engine): void {
  const p = buildProject(engine, `EARTH NEXT ${new Date().toLocaleString()}`);
  downloadBlob(new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }), `proyecto-${p.savedAt.slice(0, 10)}.earthnext.json`);
}

export async function importProject(engine: Engine, text: string): Promise<void> {
  let p: ProjectFile;
  try {
    p = JSON.parse(text) as ProjectFile;
  } catch {
    throw new Error("El archivo no es JSON válido.");
  }
  applyProject(engine, p);
}
