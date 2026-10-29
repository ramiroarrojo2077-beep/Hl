import { FOLDERS, worldPosition } from "../scene/doc";
import { spawn } from "../scene/factory";
import type { CameraKey, Vec3, WorldDoc } from "../types";
import type { GenContext } from "./context";
import { heightAt } from "./terrain";

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Lighting Director: hora del día, cielo, niebla, clima y la luz del sol. */
export function directLighting(ctx: GenContext) {
  const { doc, plan } = ctx;
  const env = doc.environment;
  env.timeOfDay = plan.timeOfDay;
  env.sky = plan.biome === "alien" ? "alien" : "earth";
  env.sunIntensity = plan.biome === "desert" || plan.biome === "alien" ? 2.6 : 2.2;
  env.ambientIntensity = 0.6;
  const fogByWeather: Record<string, number> = { clear: 0.0016, cloudy: 0.0024, rain: 0.006, storm: 0.009, snow: 0.007, fog: 0.022, sandstorm: 0.016 };
  env.fogDensity = fogByWeather[plan.weather] ?? 0.002;
  if (plan.archetype === "futuristic" && plan.timeOfDay > 19) env.fogDensity = Math.max(env.fogDensity, 0.0035);
  env.fogColor = plan.weather === "sandstorm" ? "#c8a070" : null;
  env.exposure = plan.timeOfDay > 19.5 || plan.timeOfDay < 5.5 ? 1.15 : 1;

  doc.weather = {
    type: plan.weather,
    intensity: plan.weatherIntensity,
    wind: plan.weather === "storm" || plan.weather === "sandstorm" ? 0.9 : plan.weather === "rain" ? 0.4 : 0.2,
    clouds: plan.weather === "clear" ? 0.25 : plan.weather === "cloudy" ? 0.7 : plan.weather === "fog" ? 0.6 : 0.9,
    wetness: plan.wet ? 1 : 0,
  };

  spawn(doc, {
    id: ctx.id("l"),
    type: "light",
    name: "Sun",
    props: { kind: "sun", color: "#fff4e0", intensity: 1, distance: 0, angle: 0.5, castShadow: true },
    parentId: FOLDERS.lighting.id,
  });
  ctx.log(`Hora ${plan.timeOfDay.toFixed(1)} h, clima ${plan.weather}`);
}

/** Animation Director: trayectoria cinematográfica de cámara sobre el mundo. */
export function directAnimation(ctx: GenContext) {
  const { doc, site } = ctx;
  const target = tallestBuilding(doc);
  const keys = flyoverKeys(doc, site.center[0], site.center[1], site.radius, target?.position ?? null, 24);
  doc.animation = { duration: 24, fps: 30, tracks: [], camera: keys };
  spawn(doc, {
    id: ctx.id("c"),
    type: "camera",
    name: "CinematicCamera",
    props: { fov: 50, target: keys[0]!.target },
    transform: { position: keys[0]!.position },
    parentId: FOLDERS.cameras.id,
  });
  ctx.log(`Recorrido de cámara de ${keys.length} claves`);
}

export function tallestBuilding(doc: WorldDoc): { id: string; position: Vec3 } | null {
  let best: { id: string; h: number } | null = null;
  for (const e of Object.values(doc.entities)) {
    if (e.type !== "building") continue;
    const h = e.props.floors * e.props.floorHeight * e.transform.scale[1];
    if (!best || h > best.h) best = { id: e.id, h };
  }
  if (!best) return null;
  const p = worldPosition(doc, best.id);
  return { id: best.id, position: [p[0], p[1] + best.h * 0.6, p[2]] };
}

/**
 * Sobrevuelo: órbita descendente alrededor del centro que termina encuadrando
 * el objetivo (por ejemplo, un edificio).
 */
export function flyoverKeys(doc: WorldDoc, cx: number, cz: number, radius: number, focus: Vec3 | null, duration: number): CameraKey[] {
  const keys: CameraKey[] = [];
  const steps = 6;
  const base = heightAt(doc.terrain, cx, cz);
  const orbitR = Math.max(60, radius * 1.35);
  const startAlt = base + Math.max(45, radius * 0.75);
  const center: Vec3 = [cx, base + 4, cz];
  for (let k = 0; k < steps; k++) {
    const t = k / steps;
    const a = -Math.PI / 2 + t * Math.PI * 1.2;
    const r = orbitR * (1 - t * 0.35);
    keys.push({
      t: r2(t * duration * 0.8),
      position: [r2(cx + Math.cos(a) * r), r2(startAlt - t * radius * 0.25), r2(cz + Math.sin(a) * r)],
      target: center,
      fov: 50,
    });
  }
  if (focus) {
    const last = keys[keys.length - 1]!;
    const dx = focus[0] - last.position[0];
    const dz = focus[2] - last.position[2];
    const len = Math.hypot(dx, dz) || 1;
    const dist = 38;
    keys.push({
      t: r2(duration),
      position: [r2(focus[0] - (dx / len) * dist), r2(Math.max(focus[1] + 6, heightAt(doc.terrain, focus[0], focus[2]) + 12)), r2(focus[2] - (dz / len) * dist)],
      target: [r2(focus[0]), r2(focus[1]), r2(focus[2])],
      fov: 42,
    });
  } else {
    const a = -Math.PI / 2 + Math.PI * 1.2;
    keys.push({ t: duration, position: [r2(cx + Math.cos(a) * orbitR * 0.55), r2(base + 25), r2(cz + Math.sin(a) * orbitR * 0.55)], target: center, fov: 45 });
  }
  return keys;
}
