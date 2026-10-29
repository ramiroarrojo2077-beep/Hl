"use client";

import { TransformControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box3, BoxGeometry, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { heightAt } from "@/engine/generation/terrain";
import { isEffectivelyLocked, matrixToTransform, parentWorldMatrix, worldMatrix } from "@/engine/scene/doc";
import { NON_TRANSFORMABLE, type Transform } from "@/engine/types";
import { useEditor } from "@/store/editor";
import { liveMatrix, localBounds, runtime, worldBounds } from "./registry";

const edges = new EdgesGeometry(new BoxGeometry(1, 1, 1));
const outlineMat = new LineBasicMaterial({ color: "#00D6C9", depthTest: false, transparent: true, opacity: 0.95 });
const outlineMatSecondary = new LineBasicMaterial({ color: "#6D7CFF", depthTest: false, transparent: true, opacity: 0.8 });

/** Contorno de los objetos seleccionados (sigue a los que se mueven por la simulación). */
export function SelectionOutline() {
  const selection = useEditor((s) => s.selection);
  const ids = selection.slice(0, 60);
  return (
    <group name="SelectionOutline">
      {ids.map((id, i) => (
        <Outline key={id} id={id} primary={i === 0} />
      ))}
    </group>
  );
}

function Outline({ id, primary }: { id: string; primary: boolean }) {
  const ref = useRef<Group>(null);
  const line = useMemo(() => {
    const l = new LineSegments(edges, primary ? outlineMat : outlineMatSecondary);
    l.renderOrder = 999;
    l.raycast = () => {};
    return l;
  }, [primary]);
  const box = useRef<Box3 | null>(null);
  const docRef = useEditor((s) => s.doc?.entities[id]);
  useEffect(() => {
    const doc = useEditor.getState().doc;
    if (!doc || !docRef) return;
    const e = doc.entities[id]!;
    if (e.type === "road" || e.type === "folder" || e.type === "group" || e.type === "world") {
      box.current = worldBounds(doc, id);
      box.current?.expandByScalar(0.3);
    } else box.current = localBounds(doc, e);
  }, [docRef, id]);
  const m = useMemo(() => new Matrix4(), []);
  const center = useMemo(() => new Vector3(), []);
  const size = useMemo(() => new Vector3(), []);
  useFrame(() => {
    const g = ref.current;
    const doc = useEditor.getState().doc;
    const b = box.current;
    if (!g || !doc || !b || b.isEmpty()) {
      if (g) g.visible = false;
      return;
    }
    g.visible = true;
    const e = doc.entities[id];
    if (!e) return;
    const world = e.type === "road" || e.type === "folder" || e.type === "group" ? m.identity() : liveMatrix(doc, id, m);
    b.getCenter(center);
    b.getSize(size).max(new Vector3(0.05, 0.05, 0.05));
    world.decompose(g.position, g.quaternion, g.scale);
    line.position.copy(center);
    line.scale.copy(size);
  });
  return (
    <group ref={ref}>
      <primitive object={line} />
    </group>
  );
}

/** Gizmo de transformación para la selección (mover, rotar, escalar; varios objetos a la vez). */
export function TransformGizmo() {
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const space = useEditor((s) => s.space);
  const snap = useEditor((s) => s.snap);
  const doc = useEditor((s) => s.doc);
  const simPlaying = useEditor((s) => s.simPlaying);
  const proxy = useMemo(() => new Object3D(), []);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ proxy: Matrix4; worlds: Map<string, Matrix4> } | null>(null);
  const last = useRef<Map<string, Transform>>(new Map());

  const ids = useMemo(() => {
    if (!doc) return [];
    return selection.filter((id) => {
      const e = doc.entities[id];
      if (!e || NON_TRANSFORMABLE.has(e.type) || isEffectivelyLocked(doc, id)) return false;
      // Agentes en movimiento: se editan con la simulación en pausa.
      if (simPlaying && runtime.sim && ((e.type === "vehicle" && !e.props.parked && e.props.routeId) || e.type === "npc")) return false;
      return true;
    });
  }, [selection, doc, simPlaying]);

  // Coloca el proxy sobre el objeto principal cuando no se está arrastrando.
  useEffect(() => {
    if (dragging || !doc || !ids.length) return;
    const m = worldMatrix(doc, ids[0]!);
    m.decompose(proxy.position, proxy.quaternion, proxy.scale);
    proxy.updateMatrixWorld(true);
  }, [doc, ids, dragging, proxy]);

  if (!doc || !ids.length || tool === "select" || tool === "terrain") return <primitive object={proxy} />;
  const mode = tool === "move" ? "translate" : tool === "rotate" ? "rotate" : "scale";

  const onDown = () => {
    const d = useEditor.getState().doc;
    if (!d) return;
    proxy.updateMatrixWorld(true);
    start.current = { proxy: proxy.matrixWorld.clone(), worlds: new Map(ids.map((id) => [id, worldMatrix(d, id)])) };
    last.current = new Map();
    useEditor.getState().beginTransient();
    setDragging(true);
  };

  const onChange = () => {
    const st = start.current;
    const d = useEditor.getState().doc;
    if (!st || !d) return;
    proxy.updateMatrixWorld(true);
    const delta = proxy.matrixWorld.clone().multiply(st.proxy.clone().invert());
    const surface = useEditor.getState().snap.surface && mode === "translate";
    const updates = new Map<string, Transform>();
    for (const id of ids) {
      const w0 = st.worlds.get(id)!;
      const w = delta.clone().multiply(w0);
      if (surface) {
        const p = new Vector3().setFromMatrixPosition(w);
        const e = d.entities[id]!;
        if (e.type !== "light" && e.type !== "camera" && !(e.type === "vehicle" && e.props.model === "ship")) {
          p.y = heightAt(d.terrain, p.x, p.z);
          w.setPosition(p);
        }
      }
      const local = parentWorldMatrix(d, id).invert().multiply(w);
      updates.set(id, matrixToTransform(local));
    }
    last.current = updates;
    useEditor.getState().updateTransient((draft) => {
      for (const [id, t] of updates) if (draft.entities[id]) draft.entities[id]!.transform = t;
    });
  };

  const onUp = () => {
    const updates = last.current;
    setDragging(false);
    start.current = null;
    if (!updates.size) {
      useEditor.getState().cancelTransient();
      return;
    }
    const label = mode === "translate" ? "Mover" : mode === "rotate" ? "Rotar" : "Escalar";
    useEditor.getState().commitTransient(`${label} ${updates.size > 1 ? `${updates.size} objetos` : useEditor.getState().doc?.entities[ids[0]!]?.name ?? ""}`, (draft) => {
      for (const [id, t] of updates) if (draft.entities[id]) draft.entities[id]!.transform = t;
    });
  };

  return (
    <>
      <primitive object={proxy} />
      <TransformControls
        object={proxy}
        mode={mode}
        space={space}
        size={0.9}
        translationSnap={snap.grid ? snap.translate : null}
        rotationSnap={snap.grid ? (snap.rotateDeg * Math.PI) / 180 : null}
        scaleSnap={snap.grid ? snap.scale : null}
        onMouseDown={onDown}
        onObjectChange={onChange}
        onMouseUp={onUp}
      />
    </>
  );
}

export { Quaternion };
