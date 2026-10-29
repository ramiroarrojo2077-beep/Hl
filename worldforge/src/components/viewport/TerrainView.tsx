"use client";

import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BufferGeometry, Group, LOD, Mesh, MeshStandardMaterial } from "three";
import { buildChunkGeometry, chunksInRange, CHUNKS_PER_SIDE, LOD_LEVELS, terrainDetailTexture } from "@/engine/models/terrainMesh";
import type { Terrain } from "@/engine/types";
import { useEditor } from "@/store/editor";
import { useQuality } from "@/store/settings";

export interface TerrainPointerHandlers {
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerMove?: (e: ThreeEvent<PointerEvent>) => void;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
}

/** Terreno por sectores con niveles de detalle; reconstruye solo lo que cambió. */
export function TerrainView({ handlers, interactive }: { handlers: TerrainPointerHandlers; interactive: boolean }) {
  const terrain = useEditor((s) => s.doc?.terrain);
  const visible = useEditor((s) => s.doc?.entities.terrain?.visible ?? true);
  const quality = useQuality();
  const group = useRef<Group>(null);
  const lods = useRef<LOD[][]>([]);
  const prev = useRef<Terrain | null>(null);

  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    const tex = terrainDetailTexture();
    if (tex) m.map = tex;
    return m;
  }, []);

  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    const g = group.current;
    if (!g || !terrain) return;
    const old = prev.current;
    const sameShape = old && old.size === terrain.size && old.resolution === terrain.resolution && lods.current.length === CHUNKS_PER_SIDE;
    let targets: [number, number][];
    if (!sameShape) {
      // Reconstrucción completa.
      for (const row of lods.current) for (const l of row) disposeLod(l, g);
      lods.current = [];
      targets = [];
      for (let cj = 0; cj < CHUNKS_PER_SIDE; cj++) for (let ci = 0; ci < CHUNKS_PER_SIDE; ci++) targets.push([ci, cj]);
    } else if (old.biome !== terrain.biome || old.snowLine !== terrain.snowLine || old.waterLevel !== terrain.waterLevel || old.waterEnabled !== terrain.waterEnabled) {
      targets = [];
      for (let cj = 0; cj < CHUNKS_PER_SIDE; cj++) for (let ci = 0; ci < CHUNKS_PER_SIDE; ci++) targets.push([ci, cj]);
    } else {
      targets = changedChunks(old, terrain);
    }
    prev.current = terrain;
    if (!targets.length) return;
    const chunkSize = terrain.size / CHUNKS_PER_SIDE;
    for (const [ci, cj] of targets) {
      if (!lods.current[cj]) lods.current[cj] = [];
      let lod = lods.current[cj]![ci];
      const cx = -terrain.size / 2 + (ci + 0.5) * chunkSize;
      const cz = -terrain.size / 2 + (cj + 0.5) * chunkSize;
      if (lod) {
        for (const level of [...lod.levels]) {
          const mesh = level.object as Mesh;
          mesh.geometry.dispose();
          lod.remove(mesh);
        }
        lod.levels.length = 0;
      } else {
        lod = new LOD();
        lod.position.set(cx, 0, cz);
        lod.userData.terrain = true;
        g.add(lod);
        lods.current[cj]![ci] = lod;
      }
      LOD_LEVELS.forEach((step, k) => {
        const geo: BufferGeometry = buildChunkGeometry(terrain, ci, cj, step);
        geo.translate(-cx, 0, -cz);
        geo.computeBoundingSphere();
        const mesh = new Mesh(geo, material);
        mesh.receiveShadow = true;
        mesh.userData.terrain = true;
        lod!.addLevel(mesh, k === 0 ? 0 : chunkSize * (k === 1 ? 1.6 : 3.6) * quality.lodScale);
      });
    }
  }, [terrain, material, quality.lodScale]);

  useEffect(
    () => () => {
      const g = group.current;
      if (!g) return;
      for (const row of lods.current) for (const l of row) disposeLod(l, g);
      lods.current = [];
      prev.current = null;
    },
    [],
  );

  return (
    <group
      ref={group}
      visible={visible}
      name="Terrain"
      onPointerDown={interactive ? handlers.onPointerDown : undefined}
      onPointerMove={interactive ? handlers.onPointerMove : undefined}
      onClick={handlers.onClick}
    />
  );
}

function disposeLod(lod: LOD | undefined, parent: Group) {
  if (!lod) return;
  for (const level of lod.levels) (level.object as Mesh).geometry.dispose();
  parent.remove(lod);
}

/** Sectores cuyas alturas o pintura cambiaron entre dos versiones del terreno. */
function changedChunks(a: Terrain, b: Terrain): [number, number][] {
  if (a.heights === b.heights && a.paint === b.paint) return [];
  const n = b.resolution + 1;
  let i0 = Infinity, i1 = -1, j0 = Infinity, j1 = -1;
  for (let k = 0; k < b.heights.length; k++) {
    if (a.heights[k] !== b.heights[k] || a.paint[k] !== b.paint[k]) {
      const i = k % n, j = (k - i) / n;
      if (i < i0) i0 = i;
      if (i > i1) i1 = i;
      if (j < j0) j0 = j;
      if (j > j1) j1 = j;
    }
  }
  if (i1 < 0) return [];
  return chunksInRange(b, i0, i1, j0, j1);
}
