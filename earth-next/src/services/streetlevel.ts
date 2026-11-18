/**
 * Imágenes a nivel de calle con licencia abierta:
 *  - Panoramax (OSM France/IGN y federación): sin clave, licencias CC-BY-SA / Etalab.
 *  - Mapillary (Meta): requiere token de cliente gratuito; imágenes CC-BY-SA.
 * Se distingue entre panorámicas 360° (equirectangulares) y fotos planas.
 */
import type { LonLat } from "../geo/coords.ts";
import { haversine } from "../geo/geodesy.ts";
import { getJson } from "./http.ts";
import { settings } from "../state/store.ts";

export interface StreetImage {
  id: string;
  provider: "panoramax" | "mapillary";
  lon: number;
  lat: number;
  /** Rumbo de la cámara al capturar (°) */
  heading: number | null;
  capturedAt: string;
  is360: boolean;
  /** Campo de visión horizontal para fotos planas */
  fov: number | null;
  url: string;
  thumb: string;
  author?: string;
  license: string;
  licenseUrl?: string;
  sequence?: string;
  prev?: { id: string; lon: number; lat: number };
  next?: { id: string; lon: number; lat: number };
  pageUrl: string;
  distance?: number;
}

const PANORAMAX = "https://api.panoramax.xyz/api";

interface PanoramaxFeature {
  id: string;
  collection: string;
  geometry: { coordinates: [number, number] };
  links: { rel: string; href: string; id?: string; geometry?: { coordinates: [number, number] }; title?: string }[];
  properties: {
    datetime: string;
    license?: string;
    "view:azimuth"?: number;
    "pers:interior_orientation"?: { field_of_view?: number };
    "geovisio:producer"?: string;
    "geovisio:status"?: string;
  };
  providers?: { name: string }[];
  assets: { hd?: { href: string }; sd?: { href: string }; thumb?: { href: string } };
}

function fromPanoramax(f: PanoramaxFeature): StreetImage {
  const p = f.properties;
  const fov = p["pers:interior_orientation"]?.field_of_view ?? null;
  const link = (rel: string) => {
    const l = f.links.find((x) => x.rel === rel && x.geometry && x.id);
    return l ? { id: l.id!, lon: l.geometry!.coordinates[0], lat: l.geometry!.coordinates[1] } : undefined;
  };
  const licenseLink = f.links.find((l) => l.rel === "license");
  const is360 = fov === 360;
  return {
    id: f.id,
    provider: "panoramax",
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    heading: p["view:azimuth"] ?? null,
    capturedAt: p.datetime,
    is360,
    fov: is360 ? 360 : fov,
    // Para panorámicas se usa SD (2048 px) primero por rendimiento; HD a demanda.
    url: (is360 ? (f.assets.sd ?? f.assets.hd) : (f.assets.sd ?? f.assets.hd))?.href ?? "",
    thumb: f.assets.thumb?.href ?? f.assets.sd?.href ?? "",
    author: p["geovisio:producer"] ?? f.providers?.[0]?.name,
    license: p.license ?? "CC-BY-SA-4.0",
    licenseUrl: licenseLink?.href,
    sequence: f.collection,
    prev: link("prev"),
    next: link("next"),
    pageUrl: `https://api.panoramax.xyz/?pic=${f.id}&focus=pic`,
  };
}

function bboxAround(p: LonLat, radius: number): [number, number, number, number] {
  const dLat = radius / 111320;
  const dLon = radius / (111320 * Math.max(0.05, Math.cos((p.lat * Math.PI) / 180)));
  return [p.lon - dLon, p.lat - dLat, p.lon + dLon, p.lat + dLat];
}

export async function panoramaxNear(p: LonLat, radius = 60, signal?: AbortSignal): Promise<StreetImage[]> {
  const bb = bboxAround(p, radius).map((v) => v.toFixed(6)).join(",");
  const r = await getJson<{ features: PanoramaxFeature[] }>(`${PANORAMAX}/search?bbox=${bb}&limit=100`, {
    signal,
    timeoutMs: 15000,
    cacheKey: `pmx:${bb}`,
    cacheTtlMs: 86400_000,
  });
  return r.features
    .filter((f) => !f.properties["geovisio:status"] || f.properties["geovisio:status"] === "ready")
    .map(fromPanoramax)
    .map((img) => ({ ...img, distance: haversine(p, img) }))
    .sort((a, b) => a.distance! - b.distance!);
}

export async function panoramaxById(id: string, collection?: string, signal?: AbortSignal): Promise<StreetImage | null> {
  const url = collection ? `${PANORAMAX}/collections/${collection}/items/${id}` : `${PANORAMAX}/search?ids=${id}`;
  const r = await getJson<PanoramaxFeature | { features: PanoramaxFeature[] }>(url, { signal, timeoutMs: 15000, cacheKey: `pmx-id:${id}`, cacheTtlMs: 86400_000 });
  const f = "features" in r ? r.features[0] : r;
  return f ? fromPanoramax(f) : null;
}

interface MapillaryImage {
  id: string;
  computed_geometry?: { coordinates: [number, number] };
  geometry?: { coordinates: [number, number] };
  thumb_2048_url?: string;
  thumb_256_url?: string;
  is_pano?: boolean;
  captured_at?: number;
  compass_angle?: number;
  sequence?: string;
  creator?: { username: string };
}

export async function mapillaryNear(p: LonLat, radius = 60, signal?: AbortSignal): Promise<StreetImage[]> {
  const token = settings.value.mapillaryToken;
  if (!token) return [];
  const bb = bboxAround(p, radius).map((v) => v.toFixed(6)).join(",");
  const fields = "id,computed_geometry,geometry,thumb_2048_url,thumb_256_url,is_pano,captured_at,compass_angle,sequence,creator";
  const r = await getJson<{ data: MapillaryImage[] }>(`https://graph.mapillary.com/images?access_token=${encodeURIComponent(token)}&fields=${fields}&bbox=${bb}&limit=100`, {
    signal,
    timeoutMs: 15000,
  });
  return r.data
    .map((m) => {
      const c = (m.computed_geometry ?? m.geometry)!.coordinates;
      return {
        id: m.id,
        provider: "mapillary" as const,
        lon: c[0],
        lat: c[1],
        heading: m.compass_angle ?? null,
        capturedAt: m.captured_at ? new Date(m.captured_at).toISOString() : "",
        is360: !!m.is_pano,
        fov: m.is_pano ? 360 : null,
        url: m.thumb_2048_url ?? "",
        thumb: m.thumb_256_url ?? m.thumb_2048_url ?? "",
        author: m.creator?.username,
        license: "CC-BY-SA-4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
        sequence: m.sequence,
        pageUrl: `https://www.mapillary.com/app/?pKey=${m.id}`,
        distance: haversine(p, { lon: c[0], lat: c[1] }),
      } satisfies StreetImage;
    })
    .sort((a, b) => a.distance! - b.distance!);
}

/** Busca imágenes cercanas en todos los proveedores disponibles, priorizando panorámicas 360°. */
export async function streetImagesNear(p: LonLat, radius = 80, signal?: AbortSignal): Promise<StreetImage[]> {
  const results = await Promise.allSettled([panoramaxNear(p, radius, signal), mapillaryNear(p, radius, signal)]);
  const all = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return all.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0) - (a.is360 ? 15 : 0) + (b.is360 ? 15 : 0));
}

/** Agrupa capturas cercanas por año (comparación histórica a nivel de calle). */
export function capturesByYear(images: StreetImage[]): Map<number, StreetImage[]> {
  const m = new Map<number, StreetImage[]>();
  for (const img of images) {
    const y = new Date(img.capturedAt).getUTCFullYear();
    if (!Number.isFinite(y)) continue;
    m.set(y, [...(m.get(y) ?? []), img]);
  }
  return new Map([...m.entries()].sort((a, b) => b[0] - a[0]));
}
