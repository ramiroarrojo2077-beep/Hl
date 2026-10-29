"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, LineBasicMaterial, LineSegments, Points, PointsMaterial } from "three";
import { Rng } from "@/engine/rng";
import { useEditor } from "@/store/editor";
import { useQuality } from "@/store/settings";

const AREA = 70; // cubo de partículas alrededor de la cámara
const HEIGHT = 45;

/** Lluvia (trazos), nieve y arena (puntos) que siguen a la cámara. */
export function WeatherView() {
  const weather = useEditor((s) => s.doc?.weather);
  const quality = useQuality();
  const { camera } = useThree();
  const kind = weather?.type;
  const active = kind === "rain" || kind === "storm" || kind === "snow" || kind === "sandstorm";
  const count = active ? Math.round(quality.weatherParticles * (0.35 + 0.65 * (weather?.intensity ?? 0))) : 0;
  const isRain = kind === "rain" || kind === "storm";

  const seeds = useMemo(() => {
    const rng = new Rng(5);
    const arr = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      arr[i * 4] = rng.range(-AREA, AREA);
      arr[i * 4 + 1] = rng.range(0, HEIGHT);
      arr[i * 4 + 2] = rng.range(-AREA, AREA);
      arr[i * 4 + 3] = rng.range(0.7, 1.3);
    }
    return arr;
  }, [count]);

  const object = useMemo(() => {
    if (!count) return null;
    const geo = new BufferGeometry();
    if (isRain) {
      geo.setAttribute("position", new BufferAttribute(new Float32Array(count * 6), 3));
      return new LineSegments(geo, new LineBasicMaterial({ color: new Color("#aac4dd"), transparent: true, opacity: 0.55, depthWrite: false }));
    }
    geo.setAttribute("position", new BufferAttribute(new Float32Array(count * 3), 3));
    const sand = kind === "sandstorm";
    return new Points(
      geo,
      new PointsMaterial({ color: sand ? "#d2a26a" : "#ffffff", size: sand ? 0.18 : 0.22, transparent: true, opacity: sand ? 0.7 : 0.9, depthWrite: false, blending: sand ? undefined : AdditiveBlending }),
    );
  }, [count, isRain, kind]);

  useEffect(
    () => () => {
      if (!object) return;
      object.geometry.dispose();
      (object.material as LineBasicMaterial).dispose();
    },
    [object],
  );

  const t = useRef(0);
  useFrame((_, dt) => {
    if (!object || !weather) return;
    t.current += dt;
    const pos = object.geometry.getAttribute("position") as BufferAttribute;
    const arr = pos.array as Float32Array;
    const cx = camera.position.x, cy = camera.position.y - 10, cz = camera.position.z;
    const wind = weather.wind;
    const fall = isRain ? 24 : kind === "snow" ? 1.6 : 3;
    const drift = kind === "sandstorm" ? 14 * (0.4 + wind) : wind * (isRain ? 4 : 2);
    for (let i = 0; i < count; i++) {
      const sp = seeds[i * 4 + 3]!;
      let y = seeds[i * 4 + 1]! - t.current * fall * sp;
      y = ((y % HEIGHT) + HEIGHT) % HEIGHT;
      let x = seeds[i * 4]! + t.current * drift * sp + (kind === "snow" ? Math.sin(t.current + i) * 0.8 : 0);
      let z = seeds[i * 4 + 2]! + (kind === "sandstorm" ? Math.sin(t.current * 0.7 + i) * 3 : 0);
      x = ((((x - cx) % (2 * AREA)) + 3 * AREA) % (2 * AREA)) - AREA + cx;
      z = ((((z - cz) % (2 * AREA)) + 3 * AREA) % (2 * AREA)) - AREA + cz;
      const wy = cy + y - HEIGHT * 0.3;
      if (isRain) {
        arr.set([x, wy, z, x - drift * 0.03, wy + 0.7 * sp, z], i * 6);
      } else arr.set([x, wy, z], i * 3);
    }
    pos.needsUpdate = true;
  });

  if (!object) return null;
  return <primitive object={object} frustumCulled={false} />;
}
