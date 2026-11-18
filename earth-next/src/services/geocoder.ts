/**
 * Búsqueda de lugares:
 * - Coordenadas (decimal, DMS, UTM) se resuelven localmente.
 * - Sugerencias mientras se escribe: Photon (komoot, datos OSM).
 * - Búsqueda completa y geocodificación inversa: Nominatim (OSM), máx. 1 pedido/s según su política.
 */
import type { LonLat } from "../geo/coords.ts";
import { parseCoordinates, formatDecimal } from "../geo/coords.ts";
import { getJson, RateLimiter } from "./http.ts";

export interface Place {
  id: string;
  name: string;
  label: string;
  lon: number;
  lat: number;
  /** [oeste, sur, este, norte] */
  bbox?: [number, number, number, number];
  kind: string;
  category: string;
  country?: string;
  osm?: { type: "node" | "way" | "relation"; id: number };
  source: "photon" | "nominatim" | "coordinates";
  extratags?: Record<string, string>;
  importance?: number;
}

export const GEOCODER_SOURCES = {
  photon: { name: "Photon (komoot) — datos © OpenStreetMap", url: "https://photon.komoot.io", license: "ODbL" },
  nominatim: { name: "Nominatim — © colaboradores de OpenStreetMap", url: "https://nominatim.org", license: "ODbL" },
};

const NOMINATIM = "https://nominatim.openstreetmap.org";
const PHOTON = "https://photon.komoot.io/api/";
const nominatimLimiter = new RateLimiter(1, 1100);

const OSM_TYPE: Record<string, "node" | "way" | "relation"> = { N: "node", W: "way", R: "relation", node: "node", way: "way", relation: "relation" };

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    country?: string;
    state?: string;
    city?: string;
    county?: string;
    district?: string;
    street?: string;
    housenumber?: string;
    osm_type?: string;
    osm_id?: number;
    osm_key?: string;
    osm_value?: string;
    type?: string;
    extent?: [number, number, number, number];
  };
}

function photonLabel(p: PhotonFeature["properties"]): string {
  const parts = [p.street ? `${p.street}${p.housenumber ? " " + p.housenumber : ""}` : undefined, p.district, p.city, p.state, p.country];
  return [...new Set(parts.filter((x): x is string => !!x && x !== p.name))].join(", ");
}

export async function suggest(query: string, opts: { lang?: string; near?: LonLat; signal?: AbortSignal } = {}): Promise<Place[]> {
  const q = query.trim();
  if (!q) return [];
  const coord = parseCoordinates(q);
  if (coord) return [coordinatePlace(coord)];
  if (q.length < 2) return [];
  const params = new URLSearchParams({ q, limit: "8" });
  if (opts.lang && ["en", "de", "fr", "it"].includes(opts.lang)) params.set("lang", opts.lang);
  if (opts.near) {
    params.set("lat", opts.near.lat.toFixed(4));
    params.set("lon", opts.near.lon.toFixed(4));
    params.set("location_bias_scale", "0.2");
  }
  const data = await getJson<{ features: PhotonFeature[] }>(`${PHOTON}?${params}`, {
    signal: opts.signal,
    timeoutMs: 8000,
    retries: 1,
    cacheKey: `photon:${params}`,
    cacheTtlMs: 7 * 86400_000,
  });
  return data.features.map((f) => {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    const e = p.extent;
    return {
      id: `photon:${p.osm_type}${p.osm_id}`,
      name: p.name ?? p.street ?? p.city ?? q,
      label: photonLabel(p),
      lon,
      lat,
      bbox: e ? [Math.min(e[0], e[2]), Math.min(e[1], e[3]), Math.max(e[0], e[2]), Math.max(e[1], e[3])] : undefined,
      kind: p.osm_value ?? p.type ?? "place",
      category: p.osm_key ?? "place",
      country: p.country,
      osm: p.osm_type && p.osm_id ? { type: OSM_TYPE[p.osm_type] ?? "node", id: p.osm_id } : undefined,
      source: "photon",
    } satisfies Place;
  });
}

interface NominatimResult {
  place_id: number;
  osm_type?: string;
  osm_id?: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  category?: string;
  class?: string;
  type: string;
  boundingbox?: [string, string, string, string];
  importance?: number;
  extratags?: Record<string, string>;
  address?: Record<string, string>;
}

function fromNominatim(r: NominatimResult): Place {
  const bb = r.boundingbox?.map(Number);
  return {
    id: `nominatim:${r.osm_type}${r.osm_id ?? r.place_id}`,
    name: r.name || r.display_name.split(",")[0]!,
    label: r.display_name,
    lon: Number(r.lon),
    lat: Number(r.lat),
    bbox: bb ? [bb[2]!, bb[0]!, bb[3]!, bb[1]!] : undefined,
    kind: r.type,
    category: r.category ?? r.class ?? "place",
    country: r.address?.["country"],
    osm: r.osm_type && r.osm_id ? { type: OSM_TYPE[r.osm_type] ?? "node", id: r.osm_id } : undefined,
    source: "nominatim",
    extratags: r.extratags,
    importance: r.importance,
  };
}

export async function search(query: string, opts: { lang?: string; limit?: number; signal?: AbortSignal; countryCodes?: string } = {}): Promise<Place[]> {
  const q = query.trim();
  if (!q) return [];
  const coord = parseCoordinates(q);
  if (coord) return [coordinatePlace(coord)];
  const params = new URLSearchParams({
    q,
    format: "jsonv2",
    limit: String(opts.limit ?? 8),
    addressdetails: "1",
    extratags: "1",
    "accept-language": opts.lang ?? "es",
  });
  if (opts.countryCodes) params.set("countrycodes", opts.countryCodes);
  const data = await nominatimLimiter.run(() =>
    getJson<NominatimResult[]>(`${NOMINATIM}/search?${params}`, {
      signal: opts.signal,
      timeoutMs: 12000,
      retries: 2,
      cacheKey: `nominatim:${params}`,
      cacheTtlMs: 7 * 86400_000,
      staleOnError: true,
    }),
  );
  return data.map(fromNominatim);
}

/** Búsqueda con respaldo: Nominatim y, si falla o no hay resultados, Photon. */
export async function searchBest(query: string, opts: { lang?: string; signal?: AbortSignal } = {}): Promise<Place[]> {
  try {
    const r = await search(query, { ...opts, limit: 5 });
    if (r.length) return r;
  } catch {
    /* sigue con Photon */
  }
  return suggest(query, opts);
}

export async function reverse(p: LonLat, opts: { lang?: string; zoom?: number; signal?: AbortSignal } = {}): Promise<Place | null> {
  const params = new URLSearchParams({
    lat: p.lat.toFixed(6),
    lon: p.lon.toFixed(6),
    format: "jsonv2",
    zoom: String(opts.zoom ?? 18),
    addressdetails: "1",
    extratags: "1",
    "accept-language": opts.lang ?? "es",
  });
  const data = await nominatimLimiter.run(() =>
    getJson<NominatimResult & { error?: string }>(`${NOMINATIM}/reverse?${params}`, {
      signal: opts.signal,
      timeoutMs: 10000,
      cacheKey: `nominatim-rev:${params}`,
      cacheTtlMs: 30 * 86400_000,
    }),
  );
  if (data.error) return null;
  return fromNominatim(data);
}

export function coordinatePlace(p: LonLat): Place {
  return {
    id: `coord:${p.lat.toFixed(6)},${p.lon.toFixed(6)}`,
    name: formatDecimal(p, 5),
    label: "Coordenadas",
    lon: p.lon,
    lat: p.lat,
    kind: "coordinates",
    category: "coordinates",
    source: "coordinates",
  };
}

/** Altura de cámara recomendada para encuadrar un lugar sin bbox, según su tipo. */
export function framingHeight(place: Pick<Place, "kind" | "category">): number {
  const k = place.kind;
  if (["continent"].includes(k)) return 9_000_000;
  if (["country"].includes(k)) return 3_000_000;
  if (["state", "region", "province"].includes(k)) return 900_000;
  if (["county", "district", "municipality"].includes(k)) return 120_000;
  if (["city"].includes(k)) return 40_000;
  if (["town"].includes(k)) return 15_000;
  if (["village", "suburb", "neighbourhood", "quarter", "hamlet"].includes(k)) return 5_000;
  if (["peak", "volcano", "mountain_range", "ridge"].includes(k)) return 12_000;
  if (["coordinates"].includes(k)) return 1_500;
  if (place.category === "highway") return 2_000;
  return 900;
}
