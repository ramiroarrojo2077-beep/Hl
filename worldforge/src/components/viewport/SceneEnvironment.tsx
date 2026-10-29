"use client";

import { Sky, Stars } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BackSide,
  BufferAttribute,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  Vector3,
  type Texture,
} from "three";
import { clamp, smoothstep } from "@/engine/math";
import { applyNightFactor } from "@/engine/models/materials";
import { windUniforms } from "@/engine/models/vegetation";
import { useEditor } from "@/store/editor";
import { useRuntime } from "@/store/runtime";
import { useQuality } from "@/store/settings";
import { Clouds } from "./Clouds";
import { runtime } from "./registry";

export interface SkyState {
  sunDir: Vector3;
  day: number; // 0 noche, 1 día pleno
  night: number;
  horizon: Color;
  zenith: Color;
}

/** Dirección del sol según la hora (sale por el este a las 6, se pone por el oeste a las 18). */
export function sunState(time: number): SkyState {
  const angle = ((time - 6) / 12) * Math.PI;
  const elev = Math.sin(angle) * 1.15;
  const azim = Math.cos(angle);
  const sunDir = new Vector3(azim, elev, -0.35).normalize();
  const day = smoothstep(-0.12, 0.3, sunDir.y);
  const night = 1 - smoothstep(-0.2, 0.08, sunDir.y);
  const sunset = clamp(1 - Math.abs(sunDir.y - 0.05) / 0.25, 0, 1);
  const horizon = new Color("#0a0f1e").lerp(new Color("#b8d2ea"), day).lerp(new Color("#f0a066"), sunset * 0.7);
  const zenith = new Color("#03060f").lerp(new Color("#4a86c8"), day);
  return { sunDir, day, night, horizon, zenith };
}

export function SceneEnvironment() {
  const env = useEditor((s) => s.doc?.environment);
  const weather = useEditor((s) => s.doc?.weather);
  const quality = useQuality();
  const { scene, gl, camera } = useThree();
  const sun = useRef<DirectionalLight>(null);
  const moon = useRef<DirectionalLight>(null);
  const hemi = useRef<HemisphereLight>(null);
  const sunTarget = useMemo(() => new Object3D(), []);
  const timeRef = useRef(env?.timeOfDay ?? 12);
  const envBucket = useRef("");
  const pmrem = useMemo(() => new PMREMGenerator(gl), [gl]);
  const flash = useRef(0);
  const skyRef = useRef<Mesh>(null);

  useEffect(() => {
    scene.add(sunTarget);
    return () => {
      scene.remove(sunTarget);
    };
  }, [scene, sunTarget]);

  useEffect(() => {
    if (env) timeRef.current = env.timeOfDay;
  }, [env?.timeOfDay]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => pmrem.dispose(), [pmrem]);

  const alien = env?.sky === "alien";

  useFrame((state, dt) => {
    if (!env || !weather) return;
    if (env.dayNightCycle) timeRef.current = (timeRef.current + (dt * 24) / (env.cycleMinutes * 60)) % 24;
    const t = runtime.timeOfDay ?? timeRef.current;
    const s = sunState(t);
    useRuntime.getState().setTime(t, s.night);
    applyNightFactor(s.night);
    windUniforms.uTime.value = state.clock.elapsedTime;
    windUniforms.uWind.value = weather.wind;

    const overcast = weather.type === "clear" ? weather.clouds * 0.3 : weather.type === "cloudy" ? 0.45 : weather.type === "fog" ? 0.5 : 0.65;
    // Sol: sigue al objetivo de la cámara para mantener sombras nítidas cerca.
    const focus = new Vector3();
    camera.getWorldDirection(focus);
    focus.multiplyScalar(60).add(camera.position);
    focus.y = 0;
    if (sun.current) {
      const l = sun.current;
      l.position.copy(focus).addScaledVector(s.sunDir, 300);
      sunTarget.position.copy(focus);
      l.target = sunTarget;
      l.intensity = env.sunIntensity * s.day * (1 - overcast);
      l.color.set("#fff4e0").lerp(new Color("#ff9a55"), clamp(1 - s.sunDir.y * 3, 0, 1) * s.day);
      l.visible = s.day > 0.01;
    }
    if (moon.current) {
      moon.current.position.copy(focus).addScaledVector(new Vector3(-s.sunDir.x, Math.abs(s.sunDir.y) + 0.3, 0.4).normalize(), 300);
      moon.current.target = sunTarget;
      moon.current.intensity = 0.35 * s.night;
    }
    // Relámpagos durante tormentas.
    if (weather.type === "storm" && Math.random() < dt * 0.25) flash.current = 1;
    flash.current = Math.max(0, flash.current - dt * 3.5);
    if (hemi.current) {
      hemi.current.intensity = env.ambientIntensity * (0.25 + 0.75 * s.day) * (alien ? 1.1 : 1) + flash.current * 3;
      hemi.current.color.copy(s.zenith).lerp(new Color("#ffffff"), 0.4);
      hemi.current.groundColor.set(alien ? "#5a2a18" : "#4a4033").multiplyScalar(0.4 + 0.6 * s.day);
    }

    // Niebla.
    const fog = scene.fog as FogExp2 | null;
    const fogColor = env.fogColor ? new Color(env.fogColor).multiplyScalar(0.3 + 0.7 * s.day) : s.horizon.clone();
    if (alien) fogColor.lerp(new Color("#c27a4a").multiplyScalar(0.25 + 0.75 * s.day), 0.7);
    if (weather.type === "fog" || weather.type === "storm" || weather.type === "rain") fogColor.lerp(new Color("#8b9097").multiplyScalar(0.25 + 0.75 * s.day), 0.6);
    if (fog) {
      fog.color.copy(fogColor);
      fog.density = env.fogDensity * (1 + weather.intensity * (weather.type === "clear" ? 0 : 1.2));
    }
    gl.toneMappingExposure = env.exposure * (1 - overcast * 0.15);
    if (skyRef.current) (skyRef.current.material as MeshBasicMaterial).color.copy(fogColor);

    // Mapa de entorno para reflejos (se regenera cuando cambia la hora o el clima).
    const bucket = `${Math.round(t * 2)}|${weather.type}|${env.sky}`;
    if (bucket !== envBucket.current) {
      envBucket.current = bucket;
      const tex = buildEnvMap(pmrem, s, fogColor, alien);
      const old = scene.environment as Texture | null;
      scene.environment = tex;
      scene.environmentIntensity = 0.35 + 0.65 * s.day;
      old?.dispose();
    }
  });

  useEffect(() => {
    scene.fog = new FogExp2("#b8d2ea", 0.002);
    return () => {
      scene.fog = null;
    };
  }, [scene]);

  if (!env || !weather) return null;
  const s = sunState(env.timeOfDay);
  const sunPos = s.sunDir.clone().multiplyScalar(1000);
  const overcast = weather.type !== "clear" && weather.type !== "cloudy";
  const shadowSize = quality.shadowMapSize;
  const span = quality.shadowMapSize >= 2048 ? 140 : 100;

  return (
    <>
      {!alien && !overcast && (
        <Sky sunPosition={[sunPos.x, sunPos.y, sunPos.z]} turbidity={weather.type === "cloudy" ? 9 : 5} rayleigh={env.sky === "dusk" ? 3 : 1.6} mieCoefficient={0.006} mieDirectionalG={0.85} distance={4000} />
      )}
      {(alien || overcast) && (
        <mesh ref={skyRef} scale={3500} renderOrder={-10}>
          <sphereGeometry args={[1, 24, 12]} />
          <meshBasicMaterial side={BackSide} color="#888888" fog={false} depthWrite={false} />
        </mesh>
      )}
      {s.night > 0.25 && !overcast && <Stars radius={900} depth={200} count={2500} factor={6} fade speed={0.3} />}
      <Clouds amount={weather.clouds} dark={overcast} />
      <hemisphereLight ref={hemi} args={["#bcd4ff", "#4a4033", 0.6]} />
      <directionalLight
        ref={sun}
        castShadow={quality.shadows}
        shadow-mapSize-width={shadowSize}
        shadow-mapSize-height={shadowSize}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
        shadow-camera-near={10}
        shadow-camera-far={700}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
      />
      <directionalLight ref={moon} color="#9db4ff" intensity={0} />
    </>
  );
}

function buildEnvMap(pmrem: PMREMGenerator, s: SkyState, horizon: Color, alien: boolean): Texture {
  const scene = new Scene();
  const geo = new SphereGeometry(10, 32, 16);
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const zen = alien ? new Color("#7a3a20").multiplyScalar(0.3 + 0.7 * s.day) : s.zenith;
  const ground = new Color(alien ? "#4a2a18" : "#3a3a33").multiplyScalar(0.3 + 0.7 * s.day);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10;
    if (y > 0) c.copy(horizon).lerp(zen, Math.pow(y, 0.6));
    else c.copy(horizon).lerp(ground, Math.min(1, -y * 3));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3));
  const mesh = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, side: BackSide }));
  scene.add(mesh);
  const rt = pmrem.fromScene(scene, 0.04);
  geo.dispose();
  (mesh.material as MeshBasicMaterial).dispose();
  return rt.texture;
}
