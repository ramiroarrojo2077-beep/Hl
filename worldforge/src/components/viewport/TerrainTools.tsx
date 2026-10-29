"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, Line, LineBasicMaterial, Vector3 } from "three";
import { newId } from "@/engine/ids";
import { Rng } from "@/engine/rng";
import { applyBrush, heightAt, isInsideTerrain, slopeAt } from "@/engine/generation/terrain";
import { FOLDERS, allocateName, insertEntity, removeEntity } from "@/engine/scene/doc";
import type { Entity, TreeSpecies, WorldDoc } from "@/engine/types";
import { useEditor } from "@/store/editor";
import type { TerrainPointerHandlers } from "./TerrainView";

interface Stroke {
  heights: number[] | null;
  paint: number[] | null;
  target: number;
  added: Entity[];
  removed: Set<string>;
  last: number;
  bounds: { x0: number; x1: number; z0: number; z1: number };
}

const SPECIES_BY_BIOME: Record<string, TreeSpecies[]> = {
  temperate: ["oak", "pine", "birch"],
  desert: ["cactus", "palm", "dead"],
  tropical: ["palm", "oak"],
  snow: ["pine", "birch"],
  fantasy: ["giant", "oak"],
  alien: ["giant", "dead"],
  urban: ["oak", "cypress", "sakura"],
};

/** Pinceles de terreno, pintura, vegetación y trazado de caminos. */
export function useTerrainTools(): { handlers: TerrainPointerHandlers; active: boolean } {
  const tool = useEditor((s) => s.tool);
  const mode = useEditor((s) => s.brush.mode);
  const pointer = useRef<Vector3 | null>(null);
  const stroke = useRef<Stroke | null>(null);
  const active = tool === "terrain";

  useEffect(() => {
    if (!active) return;
    const up = () => finishStroke(stroke);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [active]);

  const handlers = useMemo<TerrainPointerHandlers>(
    () => ({
      onPointerDown: (e: ThreeEvent<PointerEvent>) => {
        if (!active || e.button !== 0) return;
        e.stopPropagation();
        const s = useEditor.getState();
        if (!s.doc) return;
        pointer.current = e.point.clone();
        if (s.brush.mode === "road") {
          useEditor.setState({ roadDraft: [...s.roadDraft, [Math.round(e.point.x * 10) / 10, Math.round(e.point.z * 10) / 10]] });
          return;
        }
        s.beginTransient();
        stroke.current = {
          heights: null,
          paint: null,
          target: heightAt(s.doc.terrain, e.point.x, e.point.z),
          added: [],
          removed: new Set(),
          last: 0,
          bounds: { x0: e.point.x, x1: e.point.x, z0: e.point.z, z1: e.point.z },
        };
        // Desactiva la órbita mientras se pinta.
        (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
      },
      onPointerMove: (e: ThreeEvent<PointerEvent>) => {
        if (!active) return;
        pointer.current = e.point.clone();
        useBrushCursor.position = e.point.clone();
      },
    }),
    [active],
  );

  useFrame((state, dt) => {
    const st = stroke.current;
    const p = pointer.current;
    if (!st || !p) return;
    const s = useEditor.getState();
    const doc = s.doc;
    if (!doc) return;
    const { radius, strength, mode: m, paint } = s.brush;
    st.bounds.x0 = Math.min(st.bounds.x0, p.x - radius);
    st.bounds.x1 = Math.max(st.bounds.x1, p.x + radius);
    st.bounds.z0 = Math.min(st.bounds.z0, p.z - radius);
    st.bounds.z1 = Math.max(st.bounds.z1, p.z + radius);
    if (m === "raise" || m === "lower" || m === "smooth" || m === "flatten" || m === "water") {
      if (!st.heights) st.heights = doc.terrain.heights.slice();
      applyBrush(doc.terrain, st.heights, { mode: m, x: p.x, z: p.z, radius, strength: m === "raise" || m === "lower" ? strength * dt * 8 : Math.min(1, strength * dt * 6), targetHeight: st.target, waterLevel: doc.terrain.waterLevel });
      const heights = st.heights.slice();
      s.updateTransient((d) => {
        d.terrain.heights = heights;
        if (m === "water") d.terrain.waterEnabled = true;
      });
    } else if (m === "paint") {
      if (!st.paint) st.paint = doc.terrain.paint.slice();
      paintAt(doc, st.paint, p.x, p.z, radius, paint);
      const arr = st.paint.slice();
      s.updateTransient((d) => {
        d.terrain.paint = arr;
      });
    } else if (m === "addTrees" || m === "removeVegetation") {
      if (state.clock.elapsedTime - st.last < 0.12) return;
      st.last = state.clock.elapsedTime;
      if (m === "addTrees") {
        const rng = new Rng(Math.floor(state.clock.elapsedTime * 1000));
        const n = Math.max(1, Math.round(strength * 2));
        const species = SPECIES_BY_BIOME[doc.terrain.biome] ?? ["oak"];
        const fresh: Entity[] = [];
        for (let k = 0; k < n; k++) {
          const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * radius;
          const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
          if (!isInsideTerrain(doc.terrain, x, z, 2) || slopeAt(doc.terrain, x, z) > 35) continue;
          if (doc.terrain.waterEnabled && heightAt(doc.terrain, x, z) < doc.terrain.waterLevel + 0.4) continue;
          const sc = rng.range(0.8, 1.25);
          fresh.push({
            id: newId("t"),
            type: "tree",
            name: "",
            parentId: FOLDERS.vegetation.id,
            children: [],
            transform: { position: [x, heightAt(doc.terrain, x, z), z], rotation: [0, rng.range(0, 6.28), 0], scale: [sc, sc, sc] },
            visible: true,
            locked: false,
            props: { species: rng.pick(species), seed: rng.seedInt() },
          });
        }
        st.added.push(...fresh);
        s.updateTransient((d) => {
          for (const e of fresh) {
            const copy = structuredClone(e);
            copy.name = allocateName(d as WorldDoc, "Tree");
            insertEntity(d as WorldDoc, copy, FOLDERS.vegetation.id);
          }
        });
      } else {
        const ids = Object.values(doc.entities)
          .filter((e) => (e.type === "tree" || e.type === "plant" || e.type === "rock") && !e.locked && Math.hypot(e.transform.position[0] - p.x, e.transform.position[2] - p.z) < radius)
          .map((e) => e.id);
        if (!ids.length) return;
        ids.forEach((id) => st.removed.add(id));
        s.updateTransient((d) => {
          for (const id of ids) if (d.entities[id]) removeEntity(d as WorldDoc, id);
        });
      }
    }
  });

  return { handlers, active };
}

function paintAt(doc: WorldDoc, paint: number[], x: number, z: number, radius: number, value: number) {
  const t = doc.terrain;
  const n = t.resolution + 1;
  const cell = t.size / t.resolution;
  const half = t.size / 2;
  const i0 = Math.max(0, Math.floor((x - radius + half) / cell)), i1 = Math.min(t.resolution, Math.ceil((x + radius + half) / cell));
  const j0 = Math.max(0, Math.floor((z - radius + half) / cell)), j1 = Math.min(t.resolution, Math.ceil((z + radius + half) / cell));
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const px = -half + i * cell, pz = -half + j * cell;
      if (Math.hypot(px - x, pz - z) <= radius) paint[j * n + i] = value;
    }
}

function finishStroke(stroke: { current: Stroke | null }) {
  const st = stroke.current;
  stroke.current = null;
  if (!st) return;
  const s = useEditor.getState();
  if (!s.transientBase) return;
  const { heights, paint, added, removed, bounds } = st;
  if (!heights && !paint && !added.length && !removed.size) {
    s.cancelTransient();
    return;
  }
  const label = heights ? "Esculpir terreno" : paint ? "Pintar terreno" : added.length ? `Plantar ${added.length} árboles` : `Quitar ${removed.size} plantas`;
  s.commitTransient(label, (d) => {
    if (heights) {
      d.terrain.heights = heights;
      if (s.brush.mode === "water") d.terrain.waterEnabled = true;
      // Los objetos apoyados en la zona esculpida siguen al terreno.
      for (const e of Object.values(d.entities)) {
        if (!["tree", "plant", "rock", "prop", "npc", "vehicle", "building", "spawn"].includes(e.type)) continue;
        const [x, , z] = e.transform.position;
        if (x < bounds.x0 || x > bounds.x1 || z < bounds.z0 || z > bounds.z1) continue;
        e.transform.position[1] = Math.round(heightAt({ ...d.terrain, heights }, x, z) * 100) / 100;
      }
    }
    if (paint) d.terrain.paint = paint;
    for (const e of added) {
      const copy = structuredClone(e);
      copy.name = allocateName(d as WorldDoc, "Tree");
      insertEntity(d as WorldDoc, copy, FOLDERS.vegetation.id);
    }
    for (const id of removed) if (d.entities[id]) removeEntity(d as WorldDoc, id);
  });
}

export const useBrushCursor: { position: Vector3 | null } = { position: null };

/** Anillo que muestra el área del pincel sobre el terreno. */
export function BrushCursor() {
  const tool = useEditor((s) => s.tool);
  const mode = useEditor((s) => s.brush.mode);
  const line = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(65 * 3), 3));
    const l = new Line(g, new LineBasicMaterial({ color: "#00D6C9", depthTest: false, transparent: true }));
    l.renderOrder = 998;
    l.frustumCulled = false;
    l.raycast = () => {};
    return l;
  }, []);
  useEffect(() => () => line.geometry.dispose(), [line]);
  useFrame(() => {
    const s = useEditor.getState();
    const p = useBrushCursor.position;
    line.visible = s.tool === "terrain" && !!p && s.brush.mode !== "road";
    if (!line.visible || !p || !s.doc) return;
    const arr = (line.geometry.getAttribute("position") as BufferAttribute).array as Float32Array;
    const r = s.brush.radius;
    for (let k = 0; k <= 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      arr.set([x, heightAt(s.doc.terrain, x, z) + 0.3, z], k * 3);
    }
    line.geometry.getAttribute("position").needsUpdate = true;
  });
  if (tool !== "terrain" || mode === "road") return null;
  return <primitive object={line} />;
}

/** Vista previa del camino en trazado. */
export function RoadDraftPreview() {
  const draft = useEditor((s) => s.roadDraft);
  const terrain = useEditor((s) => s.doc?.terrain);
  const line = useMemo(() => {
    const g = new BufferGeometry();
    const l = new Line(g, new LineBasicMaterial({ color: "#ffb000", depthTest: false }));
    l.renderOrder = 997;
    l.raycast = () => {};
    return l;
  }, []);
  useEffect(() => {
    if (!terrain) return;
    const pts = draft.flatMap(([x, z]) => [x, heightAt(terrain, x, z) + 0.4, z]);
    line.geometry.setAttribute("position", new BufferAttribute(new Float32Array(pts), 3));
    line.geometry.computeBoundingSphere();
  }, [draft, terrain, line]);
  if (draft.length < 1) return null;
  return <primitive object={line} />;
}
