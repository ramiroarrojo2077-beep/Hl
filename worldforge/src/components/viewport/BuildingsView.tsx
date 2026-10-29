"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BatchedMesh, Color, Group, Matrix4, type BufferGeometry, type Material } from "three";
import { buildingKey, getBuildingModel, roofPreset, trimPreset, type BuildingPart } from "@/engine/models/building";
import { getMaterial, registerNightMaterial } from "@/engine/models/materials";
import { isEffectivelyVisible, worldMatrix } from "@/engine/scene/doc";
import type { EntityOf, WorldDoc } from "@/engine/types";
import { useEditor, useEditorWith } from "@/store/editor";
import { useQuality } from "@/store/settings";
import { objectRegistry, runtime } from "./registry";

type Building = EntityOf<"building">;

interface Batch {
  mesh: BatchedMesh;
  ids: string[]; // instanceId -> entityId
  byEntity: Map<string, number>;
}

function partMaterial(part: BuildingPart, preset: string): Material {
  switch (part) {
    case "wall":
      return getMaterial({ preset: preset as never, color: "#ffffff", doubleSide: false });
    case "roof":
      return getMaterial({ preset: preset as never, color: "#ffffff", doubleSide: true });
    case "trim":
      return getMaterial({ preset: preset as never, color: "#ffffff" });
    case "winLit":
      return registerNightMaterial(getMaterial({ preset: "glass", color: "#ffffff", roughness: 0.25, metalness: 0.35, emissive: "#ffd08a", emissiveIntensity: 0.05, noTexture: true }), 0.04, 1.5);
    case "winDark":
      return getMaterial({ preset: "glass", color: "#ffffff", roughness: 0.06, metalness: 0.9, noTexture: true });
    case "neon":
      return registerNightMaterial(getMaterial({ preset: "plastic", color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 1.5, noTexture: true, tintEmissive: true }), 1.3, 4.5);
    case "detail":
      return getMaterial({ preset: "metal", color: "#8d9299", roughness: 0.55 });
    case "door":
      return getMaterial({ preset: "wood", color: "#4a3426" });
  }
}

function partPreset(b: Building["props"], part: BuildingPart): string {
  if (part === "wall") return b.wall;
  if (part === "roof") return roofPreset(b);
  if (part === "trim") return trimPreset(b);
  return "";
}

function partColor(b: Building["props"], part: BuildingPart): string {
  switch (part) {
    case "wall":
      return b.wallColor;
    case "roof":
      return b.roofColor;
    case "trim":
    case "neon":
      return b.accentColor;
    case "winLit":
    case "winDark":
      return b.windowColor;
    default:
      return "#ffffff";
  }
}

/** Selector: edificios del documento con una clave que cambia si cambia algún ancestro. */
function selectBuildings(doc: WorldDoc | null): Building[] {
  if (!doc) return EMPTY;
  const out: Building[] = [];
  for (const id of doc.entities.f_buildings?.children ?? []) collect(doc, id, out);
  // Edificios en otros grupos.
  for (const e of Object.values(doc.entities)) if (e.type === "building" && !out.includes(e)) out.push(e);
  return out;
}
function collect(doc: WorldDoc, id: string, out: Building[]) {
  const e = doc.entities[id];
  if (!e) return;
  if (e.type === "building") out.push(e);
  for (const c of e.children) collect(doc, c, out);
}
const EMPTY: Building[] = [];
const sameList = (a: Building[], b: Building[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function BuildingsView({ onPick }: { onPick: (id: string, e: ThreeEvent<MouseEvent>) => void }) {
  const buildings = useEditorWith((s) => selectBuildings(s.doc), sameList);
  const quality = useQuality();
  const group = useRef<Group>(null);
  const batches = useRef(new Map<string, Batch>());
  const prev = useRef<Building[]>([]);
  const structureKey = useMemo(() => buildings.map((b) => `${b.id}:${buildingKey(b.props)}:${b.props.wallColor}${b.props.roofColor}${b.props.accentColor}${b.props.windowColor}`).join("|"), [buildings]);

  // Reconstrucción completa cuando cambian los edificios o sus parámetros.
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    const doc = useEditor.getState().doc;
    if (!doc) return;
    for (const b of batches.current.values()) {
      g.remove(b.mesh);
      b.mesh.dispose();
    }
    batches.current.clear();
    objectRegistry.delete("__buildings");

    // Agrupa partes por material.
    const groups = new Map<string, { material: Material; items: { id: string; geo: BufferGeometry; geoKey: string; color: string }[] }>();
    for (const b of buildings) {
      const model = getBuildingModel(b.props);
      const mk = buildingKey(b.props);
      for (const [part, geo] of model.parts) {
        const preset = partPreset(b.props, part);
        const key = `${part}|${preset}`;
        if (!groups.has(key)) groups.set(key, { material: partMaterial(part, preset), items: [] });
        groups.get(key)!.items.push({ id: b.id, geo, geoKey: `${mk}|${part}`, color: partColor(b.props, part) });
      }
    }
    const m = new Matrix4();
    const c = new Color();
    for (const [key, grp] of groups) {
      const unique = new Map<string, BufferGeometry>();
      for (const it of grp.items) unique.set(it.geoKey, it.geo);
      let verts = 0;
      for (const geo of unique.values()) verts += geo.getAttribute("position").count;
      const mesh = new BatchedMesh(grp.items.length, verts, undefined, grp.material);
      mesh.castShadow = quality.shadows && !key.startsWith("win") && !key.startsWith("neon");
      mesh.receiveShadow = true;
      mesh.name = `Buildings:${key}`;
      const geoIds = new Map<string, number>();
      for (const [gk, geo] of unique) geoIds.set(gk, mesh.addGeometry(geo));
      const batch: Batch = { mesh, ids: [], byEntity: new Map() };
      for (const it of grp.items) {
        const inst = mesh.addInstance(geoIds.get(it.geoKey)!);
        batch.ids[inst] = it.id;
        batch.byEntity.set(it.id, inst);
        mesh.setMatrixAt(inst, worldMatrix(doc, it.id, m));
        mesh.setColorAt(inst, c.set(it.color));
        mesh.setVisibleAt(inst, isEffectivelyVisible(doc, it.id));
      }
      mesh.userData.pick = (instanceId: number) => batch.ids[instanceId];
      g.add(mesh);
      batches.current.set(key, batch);
    }
    prev.current = buildings;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, quality.shadows]);

  // Actualización liviana: solo matrices y visibilidad.
  useEffect(() => {
    const doc = useEditor.getState().doc;
    if (!doc) return;
    const before = new Map(prev.current.map((b) => [b.id, b]));
    const m = new Matrix4();
    for (const b of buildings) {
      const old = before.get(b.id);
      if (old === b) continue;
      const wm = worldMatrix(doc, b.id, m);
      const vis = isEffectivelyVisible(doc, b.id);
      for (const batch of batches.current.values()) {
        const inst = batch.byEntity.get(b.id);
        if (inst === undefined) continue;
        batch.mesh.setMatrixAt(inst, wm);
        batch.mesh.setVisibleAt(inst, vis);
      }
    }
    prev.current = buildings;
  }, [buildings]);

  // Visibilidad de carpetas o grupos padres.
  const parentVis = useEditor((s) => (s.doc ? `${s.doc.entities.f_buildings?.visible}` : ""));
  useEffect(() => {
    const doc = useEditor.getState().doc;
    if (!doc) return;
    for (const batch of batches.current.values()) for (const [id, inst] of batch.byEntity) batch.mesh.setVisibleAt(inst, isEffectivelyVisible(doc, id));
  }, [parentVis]);

  // Transformaciones animadas por la línea de tiempo.
  const ovVersion = useRef(-1);
  const ovIds = useRef(new Set<string>());
  useFrame(() => {
    if (ovVersion.current === runtime.overrideVersion) return;
    ovVersion.current = runtime.overrideVersion;
    const doc = useEditor.getState().doc;
    if (!doc) return;
    const now = new Set<string>();
    const m = new Matrix4();
    for (const [id, ov] of runtime.overrides) {
      if (doc.entities[id]?.type !== "building") continue;
      now.add(id);
      for (const batch of batches.current.values()) {
        const inst = batch.byEntity.get(id);
        if (inst !== undefined) batch.mesh.setMatrixAt(inst, ov);
      }
    }
    for (const id of ovIds.current) {
      if (now.has(id) || !doc.entities[id]) continue;
      const wm = worldMatrix(doc, id, m);
      for (const batch of batches.current.values()) {
        const inst = batch.byEntity.get(id);
        if (inst !== undefined) batch.mesh.setMatrixAt(inst, wm);
      }
    }
    ovIds.current = now;
  });

  useEffect(
    () => () => {
      const g = group.current;
      for (const b of batches.current.values()) {
        g?.remove(b.mesh);
        b.mesh.dispose();
      }
      batches.current.clear();
    },
    [],
  );

  return (
    <group
      ref={group}
      name="Buildings"
      onClick={(e) => {
        const obj = e.object as BatchedMesh | undefined;
        const hit = e.intersections.find((i) => i.object === obj);
        const batchId = (e as unknown as { batchId?: number }).batchId ?? (hit as { batchId?: number } | undefined)?.batchId;
        const pick = obj?.userData.pick as ((i: number) => string | undefined) | undefined;
        if (pick && batchId !== undefined) {
          const id = pick(batchId);
          if (id) {
            e.stopPropagation();
            onPick(id, e);
          }
        }
      }}
    />
  );
}
