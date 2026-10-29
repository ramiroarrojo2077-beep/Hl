"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CatmullRomCurve3, MOUSE, PerspectiveCamera, TOUCH, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { heightAt } from "@/engine/generation/terrain";
import type { CameraKey } from "@/engine/types";
import { useEditor } from "@/store/editor";
import { worldBounds } from "./registry";

const keys = new Set<string>();
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable]")) return;
    keys.add(e.code);
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());
}
export const pressedKeys = keys;

/** Interpola la pista de cámara en el tiempo t (Catmull-Rom para la posición). */
export function sampleCameraTrack(track: CameraKey[], t: number): { position: Vector3; target: Vector3; fov: number } | null {
  if (!track.length) return null;
  const sorted = [...track].sort((a, b) => a.t - b.t);
  if (sorted.length === 1 || t <= sorted[0]!.t) {
    const k = sorted[0]!;
    return { position: new Vector3(...k.position), target: new Vector3(...k.target), fov: k.fov };
  }
  const last = sorted[sorted.length - 1]!;
  if (t >= last.t) return { position: new Vector3(...last.position), target: new Vector3(...last.target), fov: last.fov };
  let i = 0;
  while (i < sorted.length - 1 && sorted[i + 1]!.t < t) i++;
  const a = sorted[i]!, b = sorted[i + 1]!;
  const u = (t - a.t) / Math.max(0.0001, b.t - a.t);
  const curve = new CatmullRomCurve3(sorted.map((k) => new Vector3(...k.position)), false, "centripetal");
  // Parámetro aproximado sobre la curva según el índice del tramo.
  const position = curve.getPoint((i + u) / (sorted.length - 1));
  const s = u * u * (3 - 2 * u);
  const target = new Vector3(...a.target).lerp(new Vector3(...b.target), s);
  return { position, target, fov: a.fov + (b.fov - a.fov) * s };
}

export function CameraRig() {
  const mode = useEditor((s) => s.cameraMode);
  const tool = useEditor((s) => s.tool);
  const focusToken = useEditor((s) => s.ui.focusToken);
  const terrainSize = useEditor((s) => s.doc?.terrain.size ?? 200);
  const docId = useEditor((s) => s.doc?.id);
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, gl } = useThree();
  const fly = useRef({ yaw: 0, pitch: -0.2, dragging: false, lastX: 0, lastY: 0 });
  const focusAnim = useRef<{ from: Vector3; to: Vector3; fromT: Vector3; toT: Vector3; t: number } | null>(null);

  // Encuadre inicial al abrir un mundo.
  useEffect(() => {
    const doc = useEditor.getState().doc;
    if (!doc) return;
    const spawn = Object.values(doc.entities).find((e) => e.type === "spawn");
    const center = new Vector3(0, 0, 0);
    let r = 80;
    const blocks = Object.values(doc.entities).filter((e) => e.type === "building" || e.type === "block");
    if (blocks.length) {
      for (const b of blocks) center.add(new Vector3(b.transform.position[0], 0, b.transform.position[2]));
      center.divideScalar(blocks.length);
      r = Math.max(60, ...blocks.map((b) => Math.hypot(b.transform.position[0] - center.x, b.transform.position[2] - center.z))) ;
    } else if (spawn) center.set(spawn.transform.position[0], 0, spawn.transform.position[2]);
    center.y = heightAt(doc.terrain, center.x, center.z);
    camera.position.set(center.x + r * 0.9, center.y + r * 0.75, center.z + r * 1.1);
    camera.lookAt(center);
    controls.current?.target.copy(center);
    controls.current?.update();
  }, [docId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Encuadrar la selección (tecla F o doble clic en la jerarquía).
  useEffect(() => {
    if (!focusToken) return;
    const s = useEditor.getState();
    if (!s.doc || !s.selection.length) return;
    const box = worldBounds(s.doc, s.selection[0]!);
    for (const id of s.selection.slice(1, 50)) {
      const b = worldBounds(s.doc, id);
      if (b && box) box.union(b);
    }
    if (!box || box.isEmpty()) return;
    const center = box.getCenter(new Vector3());
    const radius = Math.max(3, box.getSize(new Vector3()).length() * 0.6);
    const dir = camera.position.clone().sub(controls.current?.target ?? center).normalize();
    if (dir.lengthSq() < 0.1) dir.set(1, 0.6, 1).normalize();
    const to = center.clone().addScaledVector(dir, radius * 2.2);
    focusAnim.current = { from: camera.position.clone(), to, fromT: (controls.current?.target ?? center).clone(), toT: center, t: 0 };
  }, [focusToken, camera]);

  // Vista libre: arrastrar con el mouse para mirar.
  useEffect(() => {
    if (mode !== "fly" && mode !== "firstperson") return;
    const el = gl.domElement;
    const dir = new Vector3();
    camera.getWorldDirection(dir);
    fly.current.yaw = Math.atan2(dir.x, dir.z);
    fly.current.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return;
      fly.current.dragging = true;
      fly.current.lastX = e.clientX;
      fly.current.lastY = e.clientY;
    };
    const move = (e: PointerEvent) => {
      if (!fly.current.dragging) return;
      const dx = e.clientX - fly.current.lastX, dy = e.clientY - fly.current.lastY;
      fly.current.lastX = e.clientX;
      fly.current.lastY = e.clientY;
      fly.current.yaw -= dx * 0.004;
      fly.current.pitch = Math.max(-1.45, Math.min(1.45, fly.current.pitch - dy * 0.004));
    };
    const up = () => (fly.current.dragging = false);
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [mode, gl, camera]);

  const tmp = useMemo(() => ({ fwd: new Vector3(), right: new Vector3(), up: new Vector3(0, 1, 0) }), []);

  useFrame((_, dt) => {
    const s = useEditor.getState();
    const doc = s.doc;
    if (!doc) return;
    if (focusAnim.current && mode === "orbit") {
      const f = focusAnim.current;
      f.t = Math.min(1, f.t + dt * 2.5);
      const e = 1 - Math.pow(1 - f.t, 3);
      camera.position.lerpVectors(f.from, f.to, e);
      controls.current?.target.lerpVectors(f.fromT, f.toT, e);
      controls.current?.update();
      if (f.t >= 1) focusAnim.current = null;
    }
    if (mode === "cinematic" || s.playback.cameraOverride) {
      const sample = sampleCameraTrack(doc.animation.camera, s.playback.time);
      if (sample) {
        camera.position.copy(sample.position);
        camera.lookAt(sample.target);
        const cam = camera as PerspectiveCamera;
        if (Math.abs(cam.fov - sample.fov) > 0.01) {
          cam.fov = sample.fov;
          cam.updateProjectionMatrix();
        }
      }
      return;
    }
    if (mode === "fly" || mode === "firstperson") {
      const f = fly.current;
      tmp.fwd.set(Math.sin(f.yaw) * Math.cos(f.pitch), Math.sin(f.pitch), Math.cos(f.yaw) * Math.cos(f.pitch));
      const ground = mode === "firstperson";
      const flat = tmp.fwd.clone().setY(0).normalize();
      tmp.right.crossVectors(flat, tmp.up).normalize();
      const speed = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 3 : 1) * (ground ? 4.5 : 30) * dt;
      const move = new Vector3();
      const fwd = ground ? flat : tmp.fwd;
      if (keys.has("KeyW") || keys.has("ArrowUp")) move.add(fwd);
      if (keys.has("KeyS") || keys.has("ArrowDown")) move.sub(fwd);
      if (keys.has("KeyD") || keys.has("ArrowRight")) move.add(tmp.right);
      if (keys.has("KeyA") || keys.has("ArrowLeft")) move.sub(tmp.right);
      if (!ground && keys.has("KeyE")) move.y += 1;
      if (!ground && keys.has("KeyQ")) move.y -= 1;
      if (move.lengthSq() > 0) camera.position.addScaledVector(move.normalize(), speed);
      const half = terrainSize / 2 - 2;
      camera.position.x = Math.max(-half, Math.min(half, camera.position.x));
      camera.position.z = Math.max(-half, Math.min(half, camera.position.z));
      const gy = heightAt(doc.terrain, camera.position.x, camera.position.z);
      if (ground) camera.position.y = gy + 1.7;
      else camera.position.y = Math.max(gy + 1.5, camera.position.y);
      camera.lookAt(camera.position.clone().add(tmp.fwd));
      if (controls.current) controls.current.target.copy(camera.position).addScaledVector(tmp.fwd, 20);
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enabled={mode === "orbit"}
      enableDamping
      dampingFactor={0.12}
      maxPolarAngle={Math.PI * 0.495}
      minDistance={2}
      maxDistance={terrainSize * 1.6}
      screenSpacePanning={false}
      // Con el pincel de terreno, el botón izquierdo pinta y la cámara gira con el derecho.
      mouseButtons={tool === "terrain" ? { LEFT: undefined as unknown as MOUSE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE } : { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
      touches={tool === "terrain" ? { ONE: undefined as unknown as TOUCH, TWO: TOUCH.DOLLY_ROTATE } : { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
    />
  );
}
