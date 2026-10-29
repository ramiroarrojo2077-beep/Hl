"use client";

import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef } from "react";
import { Color, DynamicDrawUsage, Frustum, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Sphere, Vector3 } from "three";
import { Rng } from "@/engine/rng";
import { getPropModel } from "@/engine/models/props";
import { getPlantModel, getRockModel, getTreeModel, plantTint, type ModelPart } from "@/engine/models/vegetation";
import { isEffectivelyVisible, worldMatrix } from "@/engine/scene/doc";
import { lightState } from "@/engine/sim/world";
import type { Biome, Entity, WorldDoc } from "@/engine/types";
import { useEditor, useEditorWith } from "@/store/editor";
import { useQuality } from "@/store/settings";
import { runtime } from "./registry";

type InstEntity = Extract<Entity, { type: "tree" | "plant" | "rock" | "prop" }>;

function groupKey(e: InstEntity): string {
  switch (e.type) {
    case "tree":
      return `tree|${e.props.species}`;
    case "plant":
      return `plant|${e.props.species}`;
    case "rock":
      return `rock|${e.props.variant}`;
    case "prop":
      return `prop|${e.props.kind}`;
  }
}

function selectInstanced(doc: WorldDoc | null): InstEntity[] {
  if (!doc) return EMPTY;
  const out: InstEntity[] = [];
  for (const e of Object.values(doc.entities)) if ((e.type === "tree" || e.type === "plant" || e.type === "rock" || e.type === "prop") && e.parentId) out.push(e);
  return out;
}
const EMPTY: InstEntity[] = [];
const sameList = <T,>(a: T[], b: T[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Vegetación, rocas y mobiliario dibujados con InstancedMesh y descarte por distancia. */
export function InstancedView({ onPick }: { onPick: (id: string, e: ThreeEvent<MouseEvent>) => void }) {
  const entities = useEditorWith((s) => selectInstanced(s.doc), sameList);
  const biome = useEditor((s) => s.doc?.terrain.biome ?? "temperate");
  // Clave que cambia cuando se ocultan carpetas o grupos.
  const visKey = useEditor((s) => (s.doc ? `${s.doc.entities.f_vegetation?.visible}${s.doc.entities.f_props?.visible}` : ""));
  const groups = useMemo(() => {
    const map = new Map<string, InstEntity[]>();
    for (const e of entities) {
      const k = groupKey(e);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    return map;
  }, [entities]);
  // Mantiene la identidad de los arreglos por grupo cuando no cambian.
  const stable = useRef(new Map<string, InstEntity[]>());
  const stableGroups = useMemo(() => {
    const out = new Map<string, InstEntity[]>();
    for (const [k, list] of groups) {
      const old = stable.current.get(k);
      out.set(k, old && sameList(old, list) ? old : list);
    }
    stable.current = out;
    return out;
  }, [groups]);

  return (
    <group name="Instanced">
      {[...stableGroups].map(([key, list]) => (
        <InstancedGroup key={`${key}|${biome}`} groupId={key} entities={list} biome={biome} onPick={onPick} visKey={visKey} />
      ))}
    </group>
  );
}

function partsFor(key: string, biome: Biome): { parts: (ModelPart & { role?: string })[]; maxDistFactor: number; shadow: boolean } {
  const [type, variant] = key.split("|") as [string, string];
  if (type === "tree") return { parts: getTreeModel(variant as never, biome), maxDistFactor: 1.7, shadow: true };
  if (type === "plant") return { parts: getPlantModel(variant as never, biome), maxDistFactor: 0.45, shadow: false };
  if (type === "rock") return { parts: getRockModel(Number(variant), biome), maxDistFactor: 1.1, shadow: true };
  return { parts: getPropModel(variant as never).parts, maxDistFactor: 0.9, shadow: true };
}

interface Item {
  id: string;
  matrix: Matrix4;
  pos: Vector3;
  radius: number;
  color: Color;
  visible: boolean;
  entity: InstEntity;
}

const SIGNAL_ON: Record<string, Color> = { red: new Color("#ff2a1a"), yellow: new Color("#ffc21a"), green: new Color("#2aff5a") };
const SIGNAL_OFF = new Color("#1a1a1a");

const InstancedGroup = memo(function InstancedGroup({
  groupId,
  entities,
  biome,
  onPick,
  visKey,
}: {
  groupId: string;
  entities: InstEntity[];
  biome: Biome;
  onPick: (id: string, e: ThreeEvent<MouseEvent>) => void;
  visKey: string;
}) {
  const quality = useQuality();
  const { camera } = useThree();
  const { parts, maxDistFactor, shadow } = useMemo(() => partsFor(groupId, biome), [groupId, biome]);
  const group = useRef<Group>(null);
  const meshes = useRef<InstancedMesh[]>([]);
  const items = useRef<Item[]>([]);
  const slots = useRef<number[]>([]);
  const dirty = useRef(true);
  const lastCam = useRef(new Vector3(1e9, 0, 0));
  const lastDir = useRef(new Vector3());
  const frame = useRef(0);
  const isTraffic = groupId === "prop|traffic_light";
  const capacity = useRef(0);

  // Crea las mallas instanciadas (cuando cambia la capacidad necesaria).
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    const need = Math.max(16, Math.ceil(entities.length * 1.25));
    if (need <= capacity.current && meshes.current.length) return;
    for (const m of meshes.current) {
      g.remove(m);
      m.dispose();
    }
    capacity.current = need;
    meshes.current = parts.map((p) => {
      const m = new InstancedMesh(p.geometry, p.material, need);
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      if (p.tinted || p.role === "signal") {
        m.instanceColor = new InstancedBufferAttribute(new Float32Array(need * 3).fill(1), 3);
        m.instanceColor.setUsage(DynamicDrawUsage);
      }
      m.castShadow = shadow && quality.shadows && (p.castShadow ?? true);
      m.receiveShadow = true;
      m.frustumCulled = false; // el descarte se hace por instancia
      m.count = 0;
      m.name = `${groupId}#${parts.indexOf(p)}`;
      g.add(m);
      return m;
    });
    dirty.current = true;
  }, [entities.length, parts, shadow, quality.shadows, groupId]);

  useEffect(
    () => () => {
      const g = group.current;
      for (const m of meshes.current) {
        g?.remove(m);
        m.dispose();
      }
      meshes.current = [];
      capacity.current = 0;
    },
    [],
  );

  // Datos por instancia (matriz, color, radio) a partir del documento.
  useEffect(() => {
    const doc = useEditor.getState().doc;
    if (!doc) return;
    const radius = (parts[0]?.geometry.boundingSphere?.radius ?? 2) * 1.2;
    items.current = entities.map((e) => {
      const matrix = worldMatrix(doc, e.id);
      const pos = new Vector3().setFromMatrixPosition(matrix);
      const s = Math.max(e.transform.scale[0], e.transform.scale[1], e.transform.scale[2]);
      return { id: e.id, matrix, pos, radius: radius * s, color: tintFor(e), visible: isEffectivelyVisible(doc, e.id), entity: e };
    });
    dirty.current = true;
  }, [entities, parts, visKey]);

  const frustum = useMemo(() => new Frustum(), []);
  const projScreen = useMemo(() => new Matrix4(), []);
  const sphere = useMemo(() => new Sphere(), []);
  const dir = useMemo(() => new Vector3(), []);

  const ovVersion = useRef(-1);
  const ovIds = useRef(new Set<string>());
  useFrame(() => {
    frame.current++;
    const list = meshes.current;
    if (!list.length) return;
    if (ovVersion.current !== runtime.overrideVersion && (runtime.overrides.size || ovIds.current.size)) {
      ovVersion.current = runtime.overrideVersion;
      const doc = useEditor.getState().doc;
      const now = new Set<string>();
      for (const it of items.current) {
        const ov = runtime.overrides.get(it.id);
        if (ov) {
          it.matrix.copy(ov);
          it.pos.setFromMatrixPosition(ov);
          now.add(it.id);
          dirty.current = true;
        } else if (ovIds.current.has(it.id) && doc) {
          worldMatrix(doc, it.id, it.matrix);
          it.pos.setFromMatrixPosition(it.matrix);
          dirty.current = true;
        }
      }
      ovIds.current = now;
    }
    camera.getWorldDirection(dir);
    const moved = camera.position.distanceTo(lastCam.current) > 4 || dir.angleTo(lastDir.current) > 0.08;
    if (dirty.current || moved || frame.current % 45 === 0) {
      dirty.current = false;
      lastCam.current.copy(camera.position);
      lastDir.current.copy(dir);
      projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projScreen);
      const maxDist = quality.detailDistance * maxDistFactor;
      let k = 0;
      const cap = capacity.current;
      const slotMap: number[] = [];
      for (let i = 0; i < items.current.length && k < cap; i++) {
        const it = items.current[i]!;
        if (!it.visible) continue;
        if (it.pos.distanceTo(camera.position) - it.radius > maxDist) continue;
        sphere.set(it.pos, it.radius);
        if (!frustum.intersectsSphere(sphere)) continue;
        for (let p = 0; p < list.length; p++) {
          const m = list[p]!;
          m.setMatrixAt(k, it.matrix);
          if (m.instanceColor && parts[p]!.tinted) m.setColorAt(k, it.color);
        }
        slotMap[k] = i;
        k++;
      }
      slots.current = slotMap;
      for (const m of list) {
        m.count = k;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
    // Semáforos: color según la simulación.
    if (isTraffic && runtime.sim) {
      const doc = useEditor.getState().doc;
      if (!doc) return;
      const time = runtime.sim.time;
      const inters = runtime.sim.intersections;
      for (let k = 0; k < slots.current.length; k++) {
        const it = items.current[slots.current[k]!]!;
        const e = it.entity;
        if (e.type !== "prop") continue;
        const inter = e.props.intersectionId ? inters.get(e.props.intersectionId) : undefined;
        const state = inter ? lightState(inter, e.props.axis, time) : "green";
        ["red", "yellow", "green"].forEach((c, idx) => {
          const m = list[idx + 1];
          if (m?.instanceColor) m.setColorAt(k, state === c ? SIGNAL_ON[c]! : SIGNAL_OFF);
        });
      }
      for (let p = 1; p < list.length; p++) if (list[p]!.instanceColor) list[p]!.instanceColor!.needsUpdate = true;
    }
  });

  return (
    <group
      ref={group}
      name={groupId}
      onClick={(e) => {
        if (e.instanceId === undefined) return;
        const idx = slots.current[e.instanceId];
        const it = idx !== undefined ? items.current[idx] : undefined;
        if (it) {
          e.stopPropagation();
          onPick(it.id, e);
        }
      }}
    />
  );
});

function tintFor(e: InstEntity): Color {
  switch (e.type) {
    case "tree": {
      const r = new Rng(e.props.seed);
      const v = r.range(0.82, 1.12);
      return new Color(v, v * r.range(0.96, 1.04), v * r.range(0.9, 1));
    }
    case "plant":
      return new Color(plantTint(e.props.species, e.props.seed));
    case "rock": {
      const v = 0.85 + ((e.id.charCodeAt(e.id.length - 1) % 10) / 10) * 0.25;
      return new Color(v, v, v);
    }
    case "prop":
      return new Color(e.props.color);
  }
}
