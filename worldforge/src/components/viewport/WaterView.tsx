"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { CanvasTexture, Color, MeshStandardMaterial, PlaneGeometry, RepeatWrapping, Vector2 } from "three";
import { Rng } from "@/engine/rng";
import { useEditor } from "@/store/editor";

function waterNormalTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const rng = new Rng(11);
  const waves = Array.from({ length: 10 }, () => ({ kx: Math.round(rng.range(-6, 6)), ky: Math.round(rng.range(-6, 6)), a: rng.range(0.3, 1), p: rng.range(0, 6.28) }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0, dy = 0;
      for (const w of waves) {
        const ph = ((x * w.kx + y * w.ky) / size) * Math.PI * 2 + w.p;
        dx += Math.cos(ph) * w.kx * w.a;
        dy += Math.cos(ph) * w.ky * w.a;
      }
      const k = (y * size + x) * 4;
      img.data[k] = 128 + dx * 4;
      img.data[k + 1] = 128 + dy * 4;
      img.data[k + 2] = 255;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(canvas);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** Superficie de agua global (mar, lagos y ríos por debajo del nivel del agua). */
export function WaterView() {
  const terrain = useEditor((s) => s.doc?.terrain);
  const wet = useEditor((s) => s.doc?.weather.type);
  const material = useMemo(() => {
    const normal = waterNormalTexture();
    const m = new MeshStandardMaterial({ color: new Color("#1f5f7a"), roughness: 0.06, metalness: 0.15, transparent: true, opacity: 0.86 });
    if (normal) {
      m.normalMap = normal;
      m.normalScale = new Vector2(0.35, 0.35);
      normal.repeat.set(40, 40);
    }
    return m;
  }, []);
  useEffect(() => () => {
    material.normalMap?.dispose();
    material.dispose();
  }, [material]);
  const size = (terrain?.size ?? 200) * 3;
  const geometry = useMemo(() => new PlaneGeometry(size, size, 1, 1).rotateX(-Math.PI / 2), [size]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_, dt) => {
    if (material.normalMap) {
      material.normalMap.offset.x += dt * 0.004;
      material.normalMap.offset.y += dt * 0.0025;
    }
    material.color.set(wet === "storm" ? "#2a4a58" : "#1f5f7a");
  });

  if (!terrain || !terrain.waterEnabled) return null;
  return <mesh geometry={geometry} material={material} position={[0, terrain.waterLevel, 0]} receiveShadow name="Water" />;
}
