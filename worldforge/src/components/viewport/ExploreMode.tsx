"use client";

import { CapsuleCollider, CuboidCollider, CylinderCollider, HeightfieldCollider, Physics, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { AnimationMixer, Euler, LoopRepeat, PerspectiveCamera, Quaternion, Vector3, type AnimationAction } from "three";
import type { Collider, KinematicCharacterController } from "@dimforge/rapier3d-compat";
import { heightAt } from "@/engine/generation/terrain";
import { getBuildingModel } from "@/engine/models/building";
import { createHumanoid, GAIT_SPEED, humanoidClips, type HumanoidClip } from "@/engine/models/humanoid";
import { materialFromSpec } from "@/engine/models/materials";
import { getPropModel } from "@/engine/models/props";
import { DEFAULT_MATERIAL, worldMatrix } from "@/engine/scene/doc";
import type { EntityOf, WorldDoc } from "@/engine/types";
import { useEditor } from "@/store/editor";
import { pressedKeys } from "./CameraRig";
import { runtime } from "./registry";

/** Entrada compartida con los controles táctiles (joystick y botones en pantalla). */
export const exploreInput = { moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, jump: false, run: false };

/**
 * Modo exploración: personaje con controlador cinemático de Rapier, colisiones
 * con terreno, edificios, árboles y mobiliario, cámara en primera o tercera
 * persona. No modifica el documento.
 */
export function ExploreMode() {
  const doc = useEditor.getState().doc;
  if (!doc) return null;
  return (
    <Physics gravity={[0, -20, 0]} timeStep="vary">
      <WorldColliders doc={doc} />
      <DynamicBodies doc={doc} />
      <Player doc={doc} />
    </Physics>
  );
}

function WorldColliders({ doc }: { doc: WorldDoc }) {
  const t = doc.terrain;
  // Rapier espera la matriz de alturas en orden por columnas (filas = Z, columnas = X).
  const heights = useMemo(() => {
    const n = t.resolution + 1;
    const out = new Array<number>(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out[j + i * n] = t.heights[j * n + i]!;
    return out;
  }, [t]);
  const boxes = useMemo(() => {
    const out: { key: string; position: [number, number, number]; rotation: [number, number, number]; half: [number, number, number] }[] = [];
    const q = new Quaternion();
    const e = new Euler();
    for (const ent of Object.values(doc.entities)) {
      if (ent.type === "building") {
        const model = getBuildingModel(ent.props);
        const m = worldMatrix(doc, ent.id);
        const pos = new Vector3(), scale = new Vector3();
        m.decompose(pos, q, scale);
        e.setFromQuaternion(q);
        for (const [k, c] of model.colliders.entries()) {
          const center = new Vector3(...c.center).multiply(scale).applyQuaternion(q).add(pos);
          out.push({ key: `${ent.id}:${k}`, position: [center.x, center.y, center.z], rotation: [e.x, e.y, e.z], half: [(c.size[0] * scale.x) / 2, (c.size[1] * scale.y) / 2, (c.size[2] * scale.z) / 2] });
        }
      } else if (ent.type === "prop") {
        const col = getPropModel(ent.props.kind).collider;
        if (!col) continue;
        const m = worldMatrix(doc, ent.id);
        const pos = new Vector3(), scale = new Vector3();
        m.decompose(pos, q, scale);
        e.setFromQuaternion(q);
        const center = new Vector3(...col.center).multiply(scale).applyQuaternion(q).add(pos);
        out.push({ key: ent.id, position: [center.x, center.y, center.z], rotation: [e.x, e.y, e.z], half: [(col.size[0] * scale.x) / 2, (col.size[1] * scale.y) / 2, (col.size[2] * scale.z) / 2] });
      } else if (ent.type === "vehicle" && (ent.props.parked || !ent.props.routeId)) {
        const m = worldMatrix(doc, ent.id);
        const pos = new Vector3(), scale = new Vector3();
        m.decompose(pos, q, scale);
        e.setFromQuaternion(q);
        out.push({ key: ent.id, position: [pos.x, pos.y + 0.8, pos.z], rotation: [e.x, e.y, e.z], half: [1, 0.8, 2.3] });
      }
    }
    return out;
  }, [doc]);
  const trunks = useMemo(
    () =>
      Object.values(doc.entities)
        .filter((e): e is EntityOf<"tree"> => e.type === "tree")
        .map((e) => {
          const p = new Vector3().setFromMatrixPosition(worldMatrix(doc, e.id));
          const s = e.transform.scale[0];
          const r = (e.props.species === "giant" ? 2 : e.props.species === "palm" || e.props.species === "cactus" ? 0.35 : 0.3) * s;
          return { key: e.id, position: [p.x, p.y + 2, p.z] as [number, number, number], r };
        }),
    [doc],
  );
  return (
    <RigidBody type="fixed" colliders={false}>
      <HeightfieldCollider args={[t.resolution, t.resolution, heights, { x: t.size, y: 1, z: t.size }]} />
      {boxes.map((b) => (
        <CuboidCollider key={b.key} args={b.half} position={b.position} rotation={b.rotation} />
      ))}
      {trunks.map((tr) => (
        <CylinderCollider key={tr.key} args={[2, tr.r]} position={tr.position} />
      ))}
      {/* Paredes invisibles en el borde del mundo */}
      <CuboidCollider args={[t.size / 2, 200, 1]} position={[0, 100, t.size / 2 + 1]} />
      <CuboidCollider args={[t.size / 2, 200, 1]} position={[0, 100, -t.size / 2 - 1]} />
      <CuboidCollider args={[1, 200, t.size / 2]} position={[t.size / 2 + 1, 100, 0]} />
      <CuboidCollider args={[1, 200, t.size / 2]} position={[-t.size / 2 - 1, 100, 0]} />
    </RigidBody>
  );
}

/** Primitivas con física dinámica: caen y se empujan durante la exploración. */
function DynamicBodies({ doc }: { doc: WorldDoc }) {
  const bodies = useMemo(() => Object.values(doc.entities).filter((e): e is EntityOf<"primitive"> => e.type === "primitive" && e.physics?.body === "dynamic"), [doc]);
  return (
    <>
      {bodies.map((e) => {
        const m = worldMatrix(doc, e.id);
        const pos = new Vector3(), q = new Quaternion(), s = new Vector3();
        m.decompose(pos, q, s);
        const rot = new Euler().setFromQuaternion(q);
        return (
          <RigidBody key={e.id} type="dynamic" position={[pos.x, pos.y + 0.5 * s.y, pos.z]} rotation={[rot.x, rot.y, rot.z]} mass={e.physics?.mass ?? 1} colliders={e.props.shape === "sphere" ? "ball" : "hull"}>
            <mesh castShadow material={materialFromSpec(e.material ?? DEFAULT_MATERIAL)} scale={[s.x, s.y, s.z]}>
              {e.props.shape === "sphere" ? <sphereGeometry args={[0.5, 24, 12]} /> : e.props.shape === "cylinder" ? <cylinderGeometry args={[0.5, 0.5, 1, 16]} /> : <boxGeometry args={[1, 1, 1]} />}
            </mesh>
          </RigidBody>
        );
      })}
    </>
  );
}

function Player({ doc }: { doc: WorldDoc }) {
  const { world, rapier } = useRapier();
  const { camera, gl } = useThree();
  const body = useRef<RapierRigidBody>(null);
  const colliderRef = useRef<Collider | null>(null);
  const controller = useRef<KinematicCharacterController | null>(null);
  const view = useEditor((s) => s.exploreView);
  const spawn = useMemo(() => {
    const sp = Object.values(doc.entities).find((e) => e.type === "spawn");
    if (sp) {
      const p = new Vector3().setFromMatrixPosition(worldMatrix(doc, sp.id));
      return { pos: p, yaw: sp.transform.rotation[1] };
    }
    return { pos: new Vector3(0, heightAt(doc.terrain, 0, 0), 0), yaw: 0 };
  }, [doc]);
  const state = useRef({ vy: 0, yaw: spawn.yaw, pitch: -0.15, grounded: false, speed: 0 });
  const avatar = useMemo(() => createHumanoid({ outfit: "explorer", skin: "#e0ac83", top: "#e67e22", bottom: "#4a5a6a", hair: "#3b2a1e", height: 1.78, build: 1 }), []);
  const mixer = useMemo(() => new AnimationMixer(avatar.mesh), [avatar]);
  const actions = useMemo(() => {
    const out = new Map<HumanoidClip, AnimationAction>();
    for (const [name, clip] of Object.entries(humanoidClips())) {
      const a = mixer.clipAction(clip);
      a.setLoop(LoopRepeat, Infinity);
      out.set(name as HumanoidClip, a);
    }
    return out;
  }, [mixer]);
  const currentClip = useRef<HumanoidClip | null>(null);
  const camPos = useRef(new Vector3());

  useEffect(() => {
    const c = world.createCharacterController(0.08);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.enableAutostep(0.45, 0.25, true);
    c.enableSnapToGround(0.6);
    c.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    c.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    c.setApplyImpulsesToDynamicBodies(true);
    controller.current = c;
    return () => {
      world.removeCharacterController(c);
      controller.current = null;
    };
  }, [world]);

  // Cámara de exploración con plano cercano corto.
  useEffect(() => {
    const cam = camera as PerspectiveCamera;
    const prevNear = cam.near;
    cam.near = 0.12;
    cam.updateProjectionMatrix();
    camPos.current.copy(spawn.pos).add(new Vector3(0, 3, -6));
    return () => {
      cam.near = prevNear;
      cam.updateProjectionMatrix();
      if (runtime.sim) runtime.sim.player.active = false;
    };
  }, [camera, spawn]);

  // Mouse: bloqueo del puntero al hacer clic; sin bloqueo se arrastra para mirar.
  useEffect(() => {
    const el = gl.domElement;
    let dragging = false;
    let lx = 0, ly = 0;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button === 0 && document.pointerLockElement !== el) el.requestPointerLock?.();
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      if (document.pointerLockElement === el) {
        state.current.yaw -= e.movementX * 0.0025;
        state.current.pitch = Math.max(-1.3, Math.min(1.2, state.current.pitch - e.movementY * 0.0025));
      } else if (dragging && e.pointerType === "mouse") {
        state.current.yaw -= (e.clientX - lx) * 0.005;
        state.current.pitch = Math.max(-1.3, Math.min(1.2, state.current.pitch - (e.clientY - ly) * 0.005));
        lx = e.clientX;
        ly = e.clientY;
      }
    };
    const onUp = () => (dragging = false);
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (document.pointerLockElement === el) document.exitPointerLock?.();
    };
  }, [gl]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const b = body.current;
    const ctrl = controller.current;
    const col = colliderRef.current;
    if (!b || !ctrl || !col) return;
    const st = state.current;
    // Mirar con el panel táctil.
    st.yaw -= exploreInput.lookDX * 0.005;
    st.pitch = Math.max(-1.3, Math.min(1.2, st.pitch - exploreInput.lookDY * 0.005));
    exploreInput.lookDX = 0;
    exploreInput.lookDY = 0;
    // Dirección de movimiento relativa a la cámara.
    let mx = exploreInput.moveX, mz = exploreInput.moveY;
    if (pressedKeys.has("KeyW") || pressedKeys.has("ArrowUp")) mz += 1;
    if (pressedKeys.has("KeyS") || pressedKeys.has("ArrowDown")) mz -= 1;
    if (pressedKeys.has("KeyD") || pressedKeys.has("ArrowRight")) mx += 1;
    if (pressedKeys.has("KeyA") || pressedKeys.has("ArrowLeft")) mx -= 1;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const run = exploreInput.run || pressedKeys.has("ShiftLeft") || pressedKeys.has("ShiftRight");
    const speed = (run ? 6.5 : 3.2) * Math.min(1, len);
    const fx = Math.sin(st.yaw), fz = Math.cos(st.yaw);
    const rx = -fz, rz = fx; // derecha
    const vx = (fx * mz + rx * -mx) * speed;
    const vz = (fz * mz + rz * -mx) * speed;
    if (st.grounded && (exploreInput.jump || pressedKeys.has("Space"))) {
      st.vy = 7.5;
      exploreInput.jump = false;
    }
    st.vy -= 20 * dt;
    if (st.grounded && st.vy < 0) st.vy = -1;
    ctrl.computeColliderMovement(col, { x: vx * dt, y: st.vy * dt, z: vz * dt });
    const mv = ctrl.computedMovement();
    st.grounded = ctrl.computedGrounded();
    const p = b.translation();
    const next = { x: p.x + mv.x, y: p.y + mv.y, z: p.z + mv.z };
    // Red de seguridad: nunca por debajo del terreno.
    const ground = heightAt(doc.terrain, next.x, next.z);
    if (next.y < ground + 0.2) {
      next.y = ground + 0.85;
      st.vy = 0;
    }
    b.setNextKinematicTranslation(next);
    st.speed = Math.hypot(mv.x, mv.z) / dt;

    // Avatar y animación.
    const footY = next.y - 0.85;
    avatar.group.position.set(next.x, footY, next.z);
    if (len > 0.05) {
      const targetYaw = Math.atan2(vx, vz);
      let d = targetYaw - avatar.group.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      avatar.group.rotation.y += d * Math.min(1, dt * 12);
    }
    const clip: HumanoidClip = !st.grounded ? "idle" : st.speed > 4.5 ? "run" : st.speed > 0.3 ? "walk" : "idle";
    if (currentClip.current !== clip) {
      const a = actions.get(clip)!;
      a.reset().fadeIn(0.2).play();
      if (currentClip.current) actions.get(currentClip.current)!.fadeOut(0.2);
      currentClip.current = clip;
    }
    const a = actions.get(clip)!;
    a.timeScale = clip === "walk" ? st.speed / GAIT_SPEED.walk : clip === "run" ? st.speed / GAIT_SPEED.run : 1;
    mixer.update(dt);
    avatar.group.visible = view === "third";

    // Cámara.
    const head = new Vector3(next.x, footY + 1.62, next.z);
    const dir = new Vector3(Math.sin(st.yaw) * Math.cos(st.pitch), Math.sin(st.pitch), Math.cos(st.yaw) * Math.cos(st.pitch));
    if (view === "first") {
      camera.position.copy(head);
      camera.lookAt(head.clone().add(dir));
    } else {
      const desired = head.clone().addScaledVector(dir, -5.2).add(new Vector3(0, 0.6, 0));
      // Evita que la cámara atraviese paredes con un raycast físico.
      const toCam = desired.clone().sub(head);
      const dist = toCam.length();
      toCam.normalize();
      const hit = world.castRay(new rapier.Ray(head, toCam), dist, true, undefined, undefined, col);
      if (hit && hit.timeOfImpact < dist) desired.copy(head).addScaledVector(toCam, Math.max(0.4, hit.timeOfImpact - 0.3));
      const minY = heightAt(doc.terrain, desired.x, desired.z) + 0.4;
      if (desired.y < minY) desired.y = minY;
      camPos.current.lerp(desired, Math.min(1, dt * 10));
      camera.position.copy(camPos.current);
      camera.lookAt(head.clone().addScaledVector(dir, 2));
    }
    if (runtime.sim) runtime.sim.player = { active: true, x: next.x, z: next.z };
  });

  return (
    <>
      <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[spawn.pos.x, spawn.pos.y + 1.2, spawn.pos.z]} enabledRotations={[false, false, false]}>
        <CapsuleCollider
          args={[0.5, 0.35]}
          ref={(c: unknown) => {
            colliderRef.current = (c as Collider | null) ?? null;
          }}
        />
      </RigidBody>
      <primitive object={avatar.group} />
    </>
  );
}
