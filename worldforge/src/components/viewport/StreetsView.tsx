"use client";

import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { Mesh, type Material } from "three";
import { getMaterial } from "@/engine/models/materials";
import { buildStreets, ownerOf, type StreetPart } from "@/engine/models/streets";
import type { EntityOf, WorldDoc } from "@/engine/types";
import { useEditorWith } from "@/store/editor";

type RoadOrBlock = EntityOf<"road"> | EntityOf<"block">;

function select(doc: WorldDoc | null): { items: RoadOrBlock[]; terrain: WorldDoc["terrain"] | null; inter: WorldDoc["intersections"]; wet: number; vis: boolean } {
  if (!doc) return { items: [], terrain: null, inter: [], wet: 0, vis: true };
  const items: RoadOrBlock[] = [];
  for (const e of Object.values(doc.entities)) if ((e.type === "road" || e.type === "block") && e.parentId) items.push(e);
  return { items, terrain: doc.terrain, inter: doc.intersections, wet: doc.weather.wetness, vis: doc.entities.f_streets?.visible ?? true };
}
const eq = (a: ReturnType<typeof select>, b: ReturnType<typeof select>) =>
  a.terrain === b.terrain && a.inter === b.inter && a.wet === b.wet && a.vis === b.vis && a.items.length === b.items.length && a.items.every((x, i) => x === b.items[i]);

function materialFor(part: StreetPart, wet: number): Material {
  const m = baseMaterial(part, wet);
  // Las marcas y la calzada se dibujan apenas por encima de lo que tienen debajo.
  const offset = part === "marking" || part === "curbRed" || part === "curbWhite" ? -3 : part === "asphalt" || part === "dirt" ? -1 : 0;
  if (offset) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = offset;
    m.polygonOffsetUnits = offset;
  }
  return m;
}

function baseMaterial(part: StreetPart, wet: number): Material {
  const w = Math.min(1, wet);
  switch (part) {
    case "asphalt":
      return getMaterial({ preset: "asphalt", color: w > 0.4 ? "#3a3d42" : "#55585d", roughness: 0.92 - w * 0.75, metalness: w * 0.35 });
    case "dirt":
      return getMaterial({ preset: "sand", color: w > 0.4 ? "#6a5640" : "#8f7556", roughness: 1 - w * 0.4 });
    case "marking":
      return getMaterial({ preset: "plastic", color: "#f0efe8", roughness: 0.7 - w * 0.4, noTexture: true });
    case "curbRed":
      return getMaterial({ preset: "plastic", color: "#d23c3c", roughness: 0.6, noTexture: true });
    case "curbWhite":
      return getMaterial({ preset: "plastic", color: "#f2f2f2", roughness: 0.6, noTexture: true });
    case "sidewalk":
      return getMaterial({ preset: "concrete", color: w > 0.4 ? "#8f8c86" : "#b9b5ad", roughness: 0.9 - w * 0.5 });
    case "curb":
      return getMaterial({ preset: "concrete", color: "#9a968f" });
    case "grass":
      return getMaterial({ preset: "grass", color: "#5f8f3e" });
    case "plaza":
      return getMaterial({ preset: "stone", color: "#c7bba5", roughness: 0.85 - w * 0.4 });
    case "parking":
      return getMaterial({ preset: "asphalt", color: "#4d5055", roughness: 0.9 - w * 0.6, metalness: w * 0.3 });
  }
}

/** Calles y manzanas fusionadas por material; la selección se resuelve por triángulo. */
export function StreetsView({ onPick }: { onPick: (id: string, e: ThreeEvent<MouseEvent>) => void }) {
  const data = useEditorWith((s) => select(s.doc), eq);
  const meshes = useMemo(() => {
    if (!data.terrain) return [];
    const roads = data.items.filter((e): e is EntityOf<"road"> => e.type === "road");
    const blocks = data.items.filter((e): e is EntityOf<"block"> => e.type === "block");
    const geo = buildStreets(data.terrain, roads, blocks, data.inter);
    const out: Mesh[] = [];
    for (const [part, { geometry, owners }] of geo.parts) {
      const m = new Mesh(geometry, materialFor(part, data.wet));
      m.receiveShadow = true;
      m.name = `Streets:${part}`;
      m.userData.owners = owners;
      if (part === "marking" || part === "curbRed" || part === "curbWhite") m.renderOrder = 1;
      out.push(m);
    }
    return out;
  }, [data]);

  useEffect(() => () => meshes.forEach((m) => m.geometry.dispose()), [meshes]);

  return (
    <group
      name="Streets"
      visible={data.vis}
      onClick={(e) => {
        const owners = e.object.userData.owners as { start: number; count: number; id: string }[] | undefined;
        if (!owners || e.faceIndex === undefined || e.faceIndex === null) return;
        const id = ownerOf(owners, e.faceIndex * 3);
        if (id && !id.startsWith("intersection:")) {
          e.stopPropagation();
          onPick(id, e);
        }
      }}
    >
      {meshes.map((m) => (
        <primitive key={m.uuid} object={m} />
      ))}
    </group>
  );
}
