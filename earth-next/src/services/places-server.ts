/** Lugares compartidos en el servidor (PostgreSQL + PostGIS), si está configurado. */
import { apiUrl } from "./api.ts";

export interface ServerPlace {
  id: string;
  name: string;
  collection: string;
  note: string | null;
  lat: number;
  lon: number;
  distance_m?: number;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function uploadPlace(p: { name: string; collection: string; note?: string; lat: number; lon: number; camera?: unknown }): Promise<ServerPlace> {
  return json(await fetch(apiUrl("/api/places"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }));
}

export async function placesInView(b: { west: number; south: number; east: number; north: number }, collection?: string): Promise<ServerPlace[]> {
  const params = new URLSearchParams({ bbox: [b.west, b.south, b.east, b.north].map((v) => v.toFixed(5)).join(",") });
  if (collection) params.set("collection", collection);
  return json(await fetch(apiUrl(`/api/places?${params}`)));
}

export async function placesNear(lat: number, lon: number, radius: number): Promise<ServerPlace[]> {
  return json(await fetch(apiUrl(`/api/places?near=${lat.toFixed(6)},${lon.toFixed(6)}&radius=${Math.round(radius)}`)));
}

export async function deleteServerPlace(id: string): Promise<void> {
  await json(await fetch(apiUrl(`/api/places/${encodeURIComponent(id)}`), { method: "DELETE" }));
}
