"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef } from "react";
import { Color, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4 } from "three";
import { getVehicleModel } from "@/engine/models/vehicles";
import { isEffectivelyVisible, worldMatrix } from "@/engine/scene/doc";
import type { EntityOf, VehicleModel, WorldDoc } from "@/engine/types";
import { useEditor, useEditorWith } from "@/store/editor";
import { useQuality } from "@/store/settings";
import { runtime } from "./registry";

type Vehicle = EntityOf<"vehicle">;

function select(doc: WorldDoc | null): Vehicle[] {
  if (!doc) return EMPTY;
  const out: Vehicle[] = [];
  for (const e of Object.values(doc.entities)) if (e.type === "vehicle" && e.parentId) out.push(e);
  return out;
}
const EMPTY: Vehicle[] = [];
const sameList = <T,>(a: T[], b: T[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Vehículos instanciados por modelo; la pose sale de la simulación de tránsito. */
export function VehiclesView({ onPick }: { onPick: (id: string, e: ThreeEvent<MouseEvent>) => void }) {
  const vehicles = useEditorWith((s) => select(s.doc), sameList);
  const groups = useMemo(() => {
    const map = new Map<VehicleModel, Vehicle[]>();
    for (const v of vehicles) {
      if (!map.has(v.props.model)) map.set(v.props.model, []);
      map.get(v.props.model)!.push(v);
    }
    return map;
  }, [vehicles]);
  return (
    <group name="Vehicles">
      {[...groups].map(([model, list]) => (
        <VehicleBatch key={model} model={model} vehicles={list} onPick={onPick} />
      ))}
    </group>
  );
}

const VehicleBatch = memo(function VehicleBatch({ model, vehicles, onPick }: { model: VehicleModel; vehicles: Vehicle[]; onPick: (id: string, e: ThreeEvent<MouseEvent>) => void }) {
  const def = useMemo(() => getVehicleModel(model), [model]);
  const quality = useQuality();
  const group = useRef<Group>(null);
  const body = useRef<InstancedMesh[]>([]);
  const wheels = useRef<InstancedMesh[]>([]);
  const wheelCount = def.wheels?.positions.length ?? 0;
  const capacity = Math.max(4, vehicles.length);
  const base = useRef<{ matrix: Matrix4; visible: boolean }[]>([]);

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    const make = (parts: typeof def.body, count: number) =>
      parts.map((p) => {
        const m = new InstancedMesh(p.geometry, p.material, count);
        m.instanceMatrix.setUsage(DynamicDrawUsage);
        if (p.tinted) m.instanceColor = new InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
        m.castShadow = quality.shadows && (p.castShadow ?? true);
        m.receiveShadow = true;
        m.frustumCulled = false;
        m.count = 0;
        g.add(m);
        return m;
      });
    body.current = make(def.body, capacity);
    wheels.current = def.wheels ? make(def.wheels.parts, capacity * wheelCount) : [];
    return () => {
      for (const m of [...body.current, ...wheels.current]) {
        g.remove(m);
        m.dispose();
      }
      body.current = [];
      wheels.current = [];
    };
  }, [def, capacity, wheelCount, quality.shadows]);

  // Colores y matrices base desde el documento.
  useEffect(() => {
    const doc = useEditor.getState().doc;
    if (!doc) return;
    base.current = vehicles.map((v) => ({ matrix: worldMatrix(doc, v.id), visible: isEffectivelyVisible(doc, v.id) }));
    const c = new Color();
    for (const m of body.current) {
      if (!m.instanceColor) continue;
      vehicles.forEach((v, i) => m.setColorAt(i, c.set(v.props.color)));
      m.instanceColor.needsUpdate = true;
    }
  }, [vehicles, def]);

  const tmp = useMemo(() => ({ m: new Matrix4(), w: new Matrix4(), r: new Matrix4(), s: new Matrix4(), hidden: new Matrix4().makeScale(0, 0, 0) }), []);
  useFrame(() => {
    const sim = runtime.simActive ? runtime.sim : null;
    const n = vehicles.length;
    for (let i = 0; i < n; i++) {
      const v = vehicles[i]!;
      const b = base.current[i];
      if (!b) continue;
      const agent = sim?.vehicles.get(v.id);
      let matrix: Matrix4;
      if (agent && !agent.parked) matrix = tmp.m.makeRotationY(agent.yaw).setPosition(agent.x, agent.y, agent.z);
      else matrix = tmp.m.copy(runtime.overrides.get(v.id) ?? b.matrix);
      if (!b.visible) matrix = tmp.hidden;
      for (const m of body.current) m.setMatrixAt(i, matrix);
      if (def.wheels) {
        const spin = agent?.wheelSpin ?? 0;
        const steer = agent?.steer ?? 0;
        def.wheels.positions.forEach((p, k) => {
          tmp.w.makeTranslation(p[0], p[1], p[2]);
          if (def.wheels!.steer[k]) tmp.w.multiply(tmp.r.makeRotationY(steer));
          tmp.w.multiply(tmp.s.makeRotationX(spin));
          const world = tmp.r.multiplyMatrices(matrix, tmp.w);
          for (const m of wheels.current) m.setMatrixAt(i * wheelCount + k, world);
        });
      }
    }
    for (const m of body.current) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
    for (const m of wheels.current) {
      m.count = n * wheelCount;
      m.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group
      ref={group}
      name={`Vehicles:${model}`}
      onClick={(e) => {
        if (e.instanceId === undefined) return;
        const isWheel = wheels.current.includes(e.object as InstancedMesh);
        const idx = isWheel ? Math.floor(e.instanceId / wheelCount) : e.instanceId;
        const v = vehicles[idx];
        if (v) {
          e.stopPropagation();
          onPick(v.id, e);
        }
      }}
    />
  );
});
