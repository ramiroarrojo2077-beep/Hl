/**
 * Consultas a OpenStreetMap vía Overpass API (edificios, lugares cercanos, elementos urbanos).
 * Concurrencia limitada (política de uso de Overpass) y conmutación entre servidores espejo.
 */
import type { LonLat } from "../geo/coords.ts";
import { buildingsQuery, parseOverpassBuildings, type BuildingFeature, type OverpassResponse } from "../geo/osm-buildings.ts";
import { tileBBox, tileKey, type TileXYZ, type BBox } from "../geo/tiles.ts";
import { settings } from "../state/store.ts";
import { getJson, RateLimiter } from "./http.ts";

export const OSM_SOURCE = { name: "© colaboradores de OpenStreetMap", url: "https://www.openstreetmap.org/copyright", license: "ODbL 1.0" };

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const limiter = new RateLimiter(2, 250);
let preferred = 0;

export async function overpass<T = OverpassResponse>(query: string, opts: { signal?: AbortSignal; cacheKey?: string; cacheTtlMs?: number; timeoutMs?: number } = {}): Promise<T> {
  const endpoints = [settings.value.overpassUrl, ...MIRRORS].filter((u, i, a) => u && a.indexOf(u) === i);
  let lastErr: unknown;
  for (let i = 0; i < endpoints.length; i++) {
    const idx = (preferred + i) % endpoints.length;
    const url = endpoints[idx]!;
    try {
      const r = await limiter.run(() =>
        getJson<T>(url, {
          method: "POST",
          body: new URLSearchParams({ data: query }).toString(),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal: opts.signal,
          timeoutMs: opts.timeoutMs ?? 40000,
          retries: 1,
          cacheKey: opts.cacheKey,
          cacheTtlMs: opts.cacheTtlMs,
        }),
      );
      preferred = idx;
      return r;
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("Overpass no disponible");
}

/** Edificios de una tesela (z15–16), con caché persistente de 7 días. */
export async function buildingsForTile(t: TileXYZ, signal?: AbortSignal): Promise<BuildingFeature[]> {
  const b = tileBBox(t);
  const q = buildingsQuery(b.south, b.west, b.north, b.east);
  const data = await overpass(q, { signal, cacheKey: `osm-bld:${tileKey(t)}`, cacheTtlMs: 7 * 86400_000 });
  return parseOverpassBuildings(data);
}

export interface OsmPoi extends LonLat {
  id: string;
  osmType: "node" | "way" | "relation";
  osmId: number;
  name: string;
  category: string;
  kind: string;
  tags: Record<string, string>;
  distance?: number;
}

const POI_FILTERS = [
  'nwr["tourism"~"attraction|museum|viewpoint|gallery|zoo|theme_park|artwork"]["name"]',
  'nwr["historic"]["name"]',
  'nwr["amenity"~"theatre|library|university|townhall|place_of_worship|hospital|marketplace|arts_centre"]["name"]',
  'nwr["leisure"~"park|stadium|garden|nature_reserve"]["name"]',
  'nwr["railway"="station"]["name"]',
  'nwr["aeroway"="aerodrome"]["name"]',
  'nwr["man_made"~"tower|lighthouse|bridge"]["name"]',
  'nwr["building"~"stadium|cathedral|church|train_station"]["name"]',
  'nwr["natural"~"peak|volcano|waterfall|glacier|bay|beach"]["name"]',
  'nwr["harbour"]["name"]',
];

const CATEGORY_KEYS = ["tourism", "historic", "amenity", "leisure", "railway", "aeroway", "man_made", "natural", "building", "harbour"];

function categorize(tags: Record<string, string>): { category: string; kind: string } {
  for (const k of CATEGORY_KEYS) if (tags[k]) return { category: k, kind: tags[k]! };
  return { category: "place", kind: "place" };
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** Lugares de interés con nombre alrededor de un punto. */
export async function nearbyPois(center: LonLat, radius = 1500, signal?: AbortSignal): Promise<OsmPoi[]> {
  const r = Math.round(Math.min(5000, Math.max(100, radius)));
  const around = `(around:${r},${center.lat.toFixed(6)},${center.lon.toFixed(6)})`;
  const q = `[out:json][timeout:25];(${POI_FILTERS.map((f) => f + around + ";").join("")});out center tags 200;`;
  const key = `osm-poi:${center.lat.toFixed(3)},${center.lon.toFixed(3)},${r}`;
  const data = await overpass<{ elements: OverpassElement[] }>(q, { signal, cacheKey: key, cacheTtlMs: 3 * 86400_000 });
  return data.elements
    .map((e) => {
      const lat = e.lat ?? e.center?.lat;
      const lon = e.lon ?? e.center?.lon;
      if (lat === undefined || lon === undefined || !e.tags?.["name"]) return null;
      const { category, kind } = categorize(e.tags);
      return { id: `${e.type[0]}${e.id}`, osmType: e.type, osmId: e.id, lat, lon, name: e.tags["name"]!, category, kind, tags: e.tags } satisfies OsmPoi;
    })
    .filter((x): x is OsmPoi => x !== null);
}

export interface UrbanElement extends LonLat {
  id: number;
  kind: "tree" | "street_lamp" | "bench" | "bus_stop" | "traffic_signals" | "fountain" | "waste_basket" | "bicycle_parking" | "hydrant";
  tags: Record<string, string>;
}

/** Elementos urbanos puntuales (árboles, faroles, bancos, paradas...) dentro de un bbox chico. */
export async function urbanElements(b: BBox, signal?: AbortSignal): Promise<UrbanElement[]> {
  const bb = `${b.south.toFixed(5)},${b.west.toFixed(5)},${b.north.toFixed(5)},${b.east.toFixed(5)}`;
  const q = `[out:json][timeout:20];(node["natural"="tree"](${bb});node["highway"~"street_lamp|bus_stop|traffic_signals"](${bb});node["amenity"~"bench|fountain|waste_basket|bicycle_parking"](${bb});node["emergency"="fire_hydrant"](${bb}););out 3000;`;
  const data = await overpass<{ elements: { id: number; lat: number; lon: number; tags?: Record<string, string> }[] }>(q, {
    signal,
    cacheKey: `osm-urban:${bb}`,
    cacheTtlMs: 7 * 86400_000,
  });
  return data.elements.map((e) => {
    const t = e.tags ?? {};
    const kind: UrbanElement["kind"] =
      t["natural"] === "tree"
        ? "tree"
        : t["emergency"] === "fire_hydrant"
          ? "hydrant"
          : ((t["highway"] ?? t["amenity"] ?? "bench") as UrbanElement["kind"]);
    return { id: e.id, lat: e.lat, lon: e.lon, kind, tags: t };
  });
}

/** Detalle completo de un elemento OSM (para el panel de información). */
export async function osmElement(type: "node" | "way" | "relation", id: number, signal?: AbortSignal): Promise<Record<string, string> | null> {
  const q = `[out:json][timeout:15];${type}(${id});out tags center;`;
  const data = await overpass<{ elements: OverpassElement[] }>(q, { signal, cacheKey: `osm-el:${type}${id}`, cacheTtlMs: 3 * 86400_000 });
  return data.elements[0]?.tags ?? null;
}
