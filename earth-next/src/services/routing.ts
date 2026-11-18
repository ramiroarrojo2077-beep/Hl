/**
 * Ruteo sobre la red vial de OpenStreetMap usando OSRM.
 * Por defecto apunta al servidor de demostración público (uso moderado, sin garantías);
 * para producción se recomienda una instancia propia (VITE_OSRM_URL).
 */
import type { LonLat } from "../geo/coords.ts";
import { getJson } from "./http.ts";

export type RouteProfile = "driving" | "walking" | "cycling";

export interface Route {
  geometry: LonLat[];
  distance: number; // m
  duration: number; // s
  profile: RouteProfile;
  steps: { instruction: string; distance: number; name: string }[];
}

export const OSRM_SOURCE = { name: "OSRM (Project OSRM) — datos © OpenStreetMap", url: "https://project-osrm.org", license: "ODbL (datos), BSD-2 (software)" };

const OSRM_URL = (import.meta.env.VITE_OSRM_URL as string | undefined) ?? "https://router.project-osrm.org";

interface OsrmResponse {
  code: string;
  message?: string;
  routes: {
    distance: number;
    duration: number;
    geometry: { coordinates: [number, number][] };
    legs: { steps: { distance: number; name: string; maneuver: { type: string; modifier?: string } }[] }[];
  }[];
}

export async function route(points: LonLat[], profile: RouteProfile = "driving", signal?: AbortSignal): Promise<Route> {
  if (points.length < 2) throw new Error("Se necesitan al menos dos puntos");
  const coords = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  // El servidor de demostración sólo sirve el perfil "driving"; otros perfiles requieren instancia propia.
  const osrmProfile = OSRM_URL.includes("router.project-osrm.org") ? "driving" : profile;
  const url = `${OSRM_URL}/route/v1/${osrmProfile}/${coords}?overview=full&geometries=geojson&steps=true`;
  const r = await getJson<OsrmResponse>(url, { signal, timeoutMs: 20000, cacheKey: `osrm:${osrmProfile}:${coords}`, cacheTtlMs: 86400_000 });
  if (r.code !== "Ok" || !r.routes.length) throw new Error(r.message ?? "No se encontró una ruta");
  const best = r.routes[0]!;
  return {
    geometry: best.geometry.coordinates.map(([lon, lat]) => ({ lon, lat })),
    distance: best.distance,
    duration: best.duration,
    profile: osrmProfile as RouteProfile,
    steps: best.legs.flatMap((l) =>
      l.steps.map((s) => ({ instruction: `${s.maneuver.type}${s.maneuver.modifier ? " " + s.maneuver.modifier : ""}`, distance: s.distance, name: s.name })),
    ),
  };
}
