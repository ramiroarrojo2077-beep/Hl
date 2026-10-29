"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, Color, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from "three";
import { Rng } from "@/engine/rng";

const MAX = 60;

function cloudTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rng = new Rng(77);
  for (let k = 0; k < 14; k++) {
    const x = rng.range(30, 98), y = rng.range(45, 85), r = rng.range(18, 34);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return new CanvasTexture(canvas);
}

/** Nubes como billboards instanciados que derivan con el viento. */
export function Clouds({ amount, dark }: { amount: number; dark: boolean }) {
  const ref = useRef<InstancedMesh>(null);
  const material = useMemo(
    () => (typeof document === "undefined" ? null : new MeshBasicMaterial({ map: cloudTexture(), transparent: true, depthWrite: false, fog: false, opacity: 0.9 })),
    [],
  );
  const geometry = useMemo(() => new PlaneGeometry(1, 1), []);
  const seeds = useMemo(() => {
    const rng = new Rng(9);
    return Array.from({ length: MAX }, () => ({ x: rng.range(-900, 900), z: rng.range(-900, 900), y: rng.range(180, 320), s: rng.range(140, 320), v: rng.range(0.6, 1.4) }));
  }, []);
  const count = Math.round(amount * MAX);

  useEffect(() => () => {
    material?.map?.dispose();
    material?.dispose();
    geometry.dispose();
  }, [material, geometry]);

  const m = useMemo(() => new Matrix4(), []);
  const q = useMemo(() => new Quaternion(), []);
  const p = useMemo(() => new Vector3(), []);
  const sc = useMemo(() => new Vector3(), []);
  useFrame(({ camera, clock }) => {
    const mesh = ref.current;
    if (!mesh || !material) return;
    material.color.copy(dark ? new Color("#8a8f98") : new Color("#ffffff"));
    q.copy(camera.quaternion);
    const t = clock.elapsedTime;
    for (let i = 0; i < count; i++) {
      const c = seeds[i]!;
      const x = ((c.x + t * 2 * c.v + 900) % 1800) - 900;
      p.set(x + camera.position.x * 0.2, c.y, c.z + camera.position.z * 0.2);
      sc.set(c.s, c.s * 0.45, 1);
      m.compose(p, q, sc);
      mesh.setMatrixAt(i, m);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (!material || count === 0) return null;
  return (
    <instancedMesh ref={ref} args={[geometry, material, MAX]} frustumCulled={false} renderOrder={-5} />
  );
}

