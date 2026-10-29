"use client";

import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { memo, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Color, Group, Object3D, PointLight, Vector3, type Mesh } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { DEFAULT_MATERIAL, isEffectivelyVisible, worldMatrix } from "@/engine/scene/doc";
import { materialFromSpec } from "@/engine/models/materials";
import { getPropModel } from "@/engine/models/props";
import { getAsset } from "@/engine/persistence/db";
import type { Entity, EntityOf, WorldDoc } from "@/engine/types";
import { useEditor, useEditorWith } from "@/store/editor";
import { useRuntime } from "@/store/runtime";
import { useQuality } from "@/store/settings";
import { liveMatrix, objectRegistry, runtime } from "./registry";

type Misc = EntityOf<"primitive"> | EntityOf<"light"> | EntityOf<"camera"> | EntityOf<"model"> | EntityOf<"spawn"> | EntityOf<"group">;

function select(doc: WorldDoc | null): Misc[] {
  if (!doc) return EMPTY;
  const out: Misc[] = [];
  for (const e of Object.values(doc.entities))
    if ((e.type === "primitive" || e.type === "light" || e.type === "camera" || e.type === "model" || e.type === "spawn") && e.parentId) out.push(e);
  return out;
}
const EMPTY: Misc[] = [];
const sameList = <T,>(a: T[], b: T[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Primitivas, luces, cámaras, modelos GLB importados y el punto de aparición. */
export function MiscView({ onPick, showHelpers }: { onPick: (id: string, e: ThreeEvent<MouseEvent>) => void; showHelpers: boolean }) {
  const items = useEditorWith((s) => select(s.doc), sameList);
  return (
    <group name="Misc">
      {items.map((e) => (
        <MiscItem key={e.id} entity={e} onPick={onPick} showHelpers={showHelpers} />
      ))}
    </group>
  );
}

const MiscItem = memo(function MiscItem({ entity, onPick, showHelpers }: { entity: Misc; onPick: (id: string, e: ThreeEvent<MouseEvent>) => void; showHelpers: boolean }) {
  const group = useRef<Group>(null);
  const doc = useEditor.getState().doc!;
  const m = worldMatrix(doc, entity.id);
  const visible = isEffectivelyVisible(doc, entity.id);
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    m.decompose(g.position, g.quaternion, g.scale);
    objectRegistry.set(entity.id, g);
    return () => {
      objectRegistry.delete(entity.id);
    };
  });
  const ovVersion = useRef(-1);
  useFrame(() => {
    const g = group.current;
    if (!g || ovVersion.current === runtime.overrideVersion) return;
    ovVersion.current = runtime.overrideVersion;
    const d = useEditor.getState().doc;
    if (!d || !d.entities[entity.id]) return;
    liveMatrix(d, entity.id).decompose(g.position, g.quaternion, g.scale);
  });
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onPick(entity.id, e);
  };
  return (
    <group ref={group} name={entity.name} visible={visible} onClick={click}>
      {entity.type === "primitive" && <Primitive entity={entity} />}
      {entity.type === "light" && <LightItem entity={entity} showHelpers={showHelpers} />}
      {entity.type === "camera" && showHelpers && (
        <group>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.6, 1.2, 4]} />
            <meshBasicMaterial color="#6D7CFF" wireframe />
          </mesh>
          <mesh position={[0, 0, 0.7]}>
            <boxGeometry args={[0.9, 0.7, 0.5]} />
            <meshBasicMaterial color="#6D7CFF" wireframe />
          </mesh>
        </group>
      )}
      {entity.type === "spawn" && showHelpers && (
        <group>
          <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.6, 0.9, 24]} />
            <meshBasicMaterial color="#00D6C9" />
          </mesh>
          <mesh position={[0, 1, 0.9]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.25, 0.6, 8]} />
            <meshBasicMaterial color="#00D6C9" />
          </mesh>
        </group>
      )}
      {entity.type === "model" && (
        <Suspense fallback={null}>
          <ImportedModel entity={entity} />
        </Suspense>
      )}
    </group>
  );
});

function Primitive({ entity }: { entity: EntityOf<"primitive"> }) {
  const mat = useMemo(() => materialFromSpec(entity.material ?? DEFAULT_MATERIAL), [entity.material]);
  const shape = entity.props.shape;
  return (
    <mesh castShadow receiveShadow material={mat} position={[0, shape === "plane" ? 0.01 : 0.5, 0]} rotation={shape === "plane" ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}>
      {shape === "box" && <boxGeometry args={[1, 1, 1]} />}
      {shape === "sphere" && <sphereGeometry args={[0.5, 32, 16]} />}
      {shape === "cylinder" && <cylinderGeometry args={[0.5, 0.5, 1, 32]} />}
      {shape === "cone" && <coneGeometry args={[0.5, 1, 32]} />}
      {shape === "torus" && <torusGeometry args={[0.35, 0.15, 16, 32]} />}
      {shape === "capsule" && <capsuleGeometry args={[0.3, 0.4, 8, 16]} />}
      {shape === "plane" && <planeGeometry args={[1, 1]} />}
    </mesh>
  );
}

function LightItem({ entity, showHelpers }: { entity: EntityOf<"light">; showHelpers: boolean }) {
  const p = entity.props;
  const light = useRef<PointLight | null>(null);
  useFrame(() => {
    const ov = runtime.lightIntensity.get(entity.id);
    if (light.current) light.current.intensity = ov ?? p.intensity;
  });
  if (p.kind === "sun") return null; // el sol lo maneja el ambiente
  return (
    <group>
      {p.kind === "spot" ? (
        <spotLight ref={light as never} color={p.color} intensity={p.intensity} distance={p.distance} angle={p.angle} penumbra={0.4} castShadow={p.castShadow} position={[0, 0, 0]} target-position={[0, -1, 0]} />
      ) : (
        <pointLight ref={light} color={p.color} intensity={p.intensity} distance={p.distance} decay={2} castShadow={p.castShadow} />
      )}
      {showHelpers && (
        <mesh>
          <sphereGeometry args={[0.25, 12, 8]} />
          <meshBasicMaterial color={p.color} />
        </mesh>
      )}
    </group>
  );
}

const modelCache = new Map<string, Promise<Object3D>>();
function loadModel(assetId: string): Promise<Object3D> {
  let p = modelCache.get(assetId);
  if (!p) {
    p = (async () => {
      const asset = await getAsset(assetId);
      if (!asset) throw new Error("Recurso no encontrado");
      const url = URL.createObjectURL(asset.data);
      try {
        const gltf = await new GLTFLoader().loadAsync(url);
        gltf.scene.traverse((o) => {
          if ((o as Mesh).isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        gltf.scene.userData.animations = gltf.animations;
        return gltf.scene;
      } finally {
        URL.revokeObjectURL(url);
      }
    })();
    modelCache.set(assetId, p);
  }
  return p;
}

function ImportedModel({ entity }: { entity: EntityOf<"model"> }) {
  const [obj, setObj] = useState<Object3D | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    loadModel(entity.props.assetId)
      .then((scene) => alive && setObj(cloneSkinned(scene)))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [entity.props.assetId]);
  if (error)
    return (
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#ff4d6d" wireframe />
      </mesh>
    );
  return obj ? <primitive object={obj} /> : null;
}

/**
 * Luces puntuales reales en los faroles más cercanos a la cámara cuando es de
 * noche. El resto de los faroles solo brilla por emisión.
 */
export function LightPool() {
  const quality = useQuality();
  const props = useEditorWith(
    (s) => (s.doc ? Object.values(s.doc.entities).filter((e): e is EntityOf<"prop"> => e.type === "prop" && ["streetlight", "lantern", "torch", "light_tower"].includes(e.props.kind)) : []),
    (a, b) => a.length === b.length && a.every((x, i) => x === b[i]),
  );
  const { camera, scene } = useThree();
  const count = quality.lightPool;
  const lights = useMemo(() => Array.from({ length: count }, () => new PointLight("#ffcf8a", 0, 22, 2)), [count]);
  useEffect(() => {
    lights.forEach((l) => scene.add(l));
    return () => {
      lights.forEach((l) => {
        scene.remove(l);
        l.dispose();
      });
    };
  }, [lights, scene]);
  const positions = useMemo(() => {
    const doc = useEditor.getState().doc;
    if (!doc) return [];
    return props.map((p) => {
      const at = getPropModel(p.props.kind).lightAt ?? [0, 3, 0];
      const m = worldMatrix(doc, p.id);
      return { pos: new Vector3(at[0], at[1], at[2]).applyMatrix4(m), kind: p.props.kind };
    });
  }, [props]);
  const frame = useRef(0);
  useFrame(() => {
    const night = useRuntime.getState().nightFactor;
    if (frame.current++ % 10 !== 0) return;
    if (night < 0.25 || !count) {
      lights.forEach((l) => (l.intensity = 0));
      return;
    }
    const sorted = positions
      .map((p) => ({ p, d: p.pos.distanceToSquared(camera.position) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, count);
    lights.forEach((l, i) => {
      const s = sorted[i];
      if (!s || s.d > 120 * 120) {
        l.intensity = 0;
        return;
      }
      l.position.copy(s.p.pos).add(new Vector3(0, -0.3, 0));
      l.color = new Color(s.p.kind === "torch" ? "#ff8a3a" : s.p.kind === "light_tower" ? "#fff6e0" : "#ffcf8a");
      l.distance = s.p.kind === "light_tower" ? 60 : 22;
      l.intensity = (s.p.kind === "light_tower" ? 900 : 60) * night;
    });
  });
  return null;
}

export type { Entity };
