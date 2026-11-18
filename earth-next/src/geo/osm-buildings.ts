/**
 * Conversión de respuestas de Overpass (OSM, `out geom`) a huellas de edificios con altura.
 * Sigue el esquema "Simple 3D Buildings" de OSM y clasifica la calidad del dato de altura:
 *  - "measured": etiqueta height / building:height (dato explícito en OSM)
 *  - "levels":   estimada a partir de building:levels (× 3 m por nivel)
 *  - "default":  sin datos — altura genérica por tipo de edificio (se muestra distinto y se rotula)
 */
import type { LonLat } from "./coords.ts";
import { pointInRing } from "./geodesy.ts";

export type HeightQuality = "measured" | "levels" | "default";

export interface BuildingFeature {
  id: string;
  osmType: "way" | "relation";
  osmId: number;
  /** Anillo exterior (abierto: sin repetir el primer punto) */
  outer: LonLat[];
  /** Anillos interiores (patios) */
  holes: LonLat[][];
  height: number;
  minHeight: number;
  quality: HeightQuality;
  /** Explicación del origen de la altura (para la interfaz) */
  heightSource: string;
  kind: string;
  isPart: boolean;
  name?: string;
  tags: Record<string, string>;
}

export const LEVEL_HEIGHT = 3;

interface OverpassGeomPoint {
  lat: number;
  lon: number;
}

interface OverpassWay {
  type: "way";
  id: number;
  tags?: Record<string, string>;
  geometry?: (OverpassGeomPoint | null)[];
}

interface OverpassRelation {
  type: "relation";
  id: number;
  tags?: Record<string, string>;
  members?: { type: string; ref: number; role: string; geometry?: (OverpassGeomPoint | null)[] }[];
}

export interface OverpassResponse {
  elements: (OverpassWay | OverpassRelation | { type: "node"; id: number; lat: number; lon: number; tags?: Record<string, string> })[];
}

/** Interpreta valores de altura OSM: "12", "12 m", "12.5m", "40'", "40 ft", "12'6\"". */
export function parseOsmLength(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().split(";")[0]!.replace(",", ".").trim();
  const feetInches = s.match(/^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*")?$/);
  if (feetInches) return Number(feetInches[1]) * 0.3048 + Number(feetInches[2] ?? 0) * 0.0254;
  const ft = s.match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet)$/);
  if (ft) return Number(ft[1]) * 0.3048;
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:m|meters|metres|metros)?$/);
  if (m) {
    const v = Number(m[1]);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

export function parseLevels(raw: string | undefined): number | null {
  if (!raw) return null;
  const v = Number(raw.split(";")[0]!.replace(",", ".").trim());
  return Number.isFinite(v) && v >= 0 && v < 300 ? v : null;
}

const SMALL = new Set(["garage", "garages", "shed", "hut", "carport", "kiosk", "toilets", "container", "cabin", "garden_house", "bunker", "storage_tank"]);
const HOUSE = new Set(["house", "detached", "semidetached_house", "terrace", "bungalow", "farm", "static_caravan", "residential", "villa"]);

export function defaultHeightFor(kind: string): number {
  if (SMALL.has(kind)) return 3;
  if (HOUSE.has(kind)) return 6;
  return 8;
}

export interface HeightEstimate {
  height: number;
  minHeight: number;
  quality: HeightQuality;
  source: string;
}

export function estimateHeight(tags: Record<string, string>): HeightEstimate {
  const kind = tags["building"] ?? tags["building:part"] ?? "yes";
  const explicit = parseOsmLength(tags["height"]) ?? parseOsmLength(tags["building:height"]);
  const levels = parseLevels(tags["building:levels"]);
  const roofLevels = parseLevels(tags["roof:levels"]) ?? 0;
  const roofHeight = parseOsmLength(tags["roof:height"]);
  const minExplicit = parseOsmLength(tags["min_height"]) ?? parseOsmLength(tags["building:min_height"]);
  const minLevel = parseLevels(tags["building:min_level"]);
  let minHeight = minExplicit ?? (minLevel !== null ? minLevel * LEVEL_HEIGHT : 0);

  let height: number;
  let quality: HeightQuality;
  let source: string;
  if (explicit !== null && explicit > 0) {
    height = explicit;
    quality = "measured";
    source = tags["height"] ? `OSM height=${tags["height"]}` : `OSM building:height=${tags["building:height"]}`;
  } else if (levels !== null && levels > 0) {
    height = (levels + roofLevels) * LEVEL_HEIGHT + (roofLevels === 0 && roofHeight ? roofHeight : 0);
    quality = "levels";
    source = `≈ ${levels} niveles × ${LEVEL_HEIGHT} m (OSM building:levels)`;
  } else {
    height = defaultHeightFor(kind);
    quality = "default";
    source = `Sin dato de altura en OSM — valor genérico para "${kind}"`;
  }
  if (kind === "roof" && minExplicit === null && minLevel === null) {
    // Techos sin paredes (estaciones de servicio, andenes): losa en la parte superior.
    minHeight = Math.max(0, height - 1);
  }
  if (minHeight >= height) minHeight = Math.max(0, height - 1);
  return { height, minHeight, quality, source };
}

const EPS = 1e-9;

function samePoint(a: LonLat, b: LonLat): boolean {
  return Math.abs(a.lat - b.lat) < EPS && Math.abs(a.lon - b.lon) < EPS;
}

function cleanGeometry(geom: (OverpassGeomPoint | null)[] | undefined): LonLat[] {
  if (!geom) return [];
  return geom.filter((p): p is OverpassGeomPoint => !!p).map((p) => ({ lon: p.lon, lat: p.lat }));
}

function openRing(pts: LonLat[]): LonLat[] {
  if (pts.length > 1 && samePoint(pts[0]!, pts[pts.length - 1]!)) return pts.slice(0, -1);
  return pts;
}

/** Une segmentos de vías en anillos cerrados (para multipolígonos). */
export function assembleRings(segments: LonLat[][]): LonLat[][] {
  const pending = segments.filter((s) => s.length >= 2).map((s) => s.slice());
  const rings: LonLat[][] = [];
  while (pending.length) {
    let ring = pending.shift()!;
    let guard = 0;
    while (!samePoint(ring[0]!, ring[ring.length - 1]!) && guard++ < 10000) {
      const end = ring[ring.length - 1]!;
      const idx = pending.findIndex((s) => samePoint(s[0]!, end) || samePoint(s[s.length - 1]!, end));
      if (idx < 0) break;
      const seg = pending.splice(idx, 1)[0]!;
      const oriented = samePoint(seg[0]!, end) ? seg : seg.slice().reverse();
      ring = ring.concat(oriented.slice(1));
    }
    if (ring.length >= 4 && samePoint(ring[0]!, ring[ring.length - 1]!)) rings.push(openRing(ring));
  }
  return rings;
}

/** Área con signo en grados² (positiva = antihoraria). */
export function signedRingArea(ring: LonLat[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j]!.lon - ring[i]!.lon) * (ring[j]!.lat + ring[i]!.lat);
  return s / 2;
}

function ensureOrientation(ring: LonLat[], ccw: boolean): LonLat[] {
  const isCcw = signedRingArea(ring) > 0;
  return isCcw === ccw ? ring : ring.slice().reverse();
}

function bboxOf(ring: LonLat[]): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of ring) {
    w = Math.min(w, p.lon);
    e = Math.max(e, p.lon);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  return [w, s, e, n];
}

function ringCenter(ring: LonLat[]): LonLat {
  let lon = 0;
  let lat = 0;
  for (const p of ring) {
    lon += p.lon;
    lat += p.lat;
  }
  return { lon: lon / ring.length, lat: lat / ring.length };
}

const KEEP_TAGS = [
  "name",
  "building",
  "building:part",
  "height",
  "building:height",
  "building:levels",
  "roof:shape",
  "roof:levels",
  "min_height",
  "building:min_level",
  "start_date",
  "architect",
  "amenity",
  "tourism",
  "historic",
  "wikidata",
  "wikipedia",
  "addr:street",
  "addr:housenumber",
  "building:colour",
  "building:material",
  "roof:colour",
  "operator",
  "heritage",
];

function pickTags(tags: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of KEEP_TAGS) if (tags[k] !== undefined) out[k] = tags[k]!;
  return out;
}

function makeFeature(osmType: "way" | "relation", osmId: number, tags: Record<string, string>, outer: LonLat[], holes: LonLat[][], suffix = ""): BuildingFeature | null {
  if (outer.length < 3) return null;
  const est = estimateHeight(tags);
  const isPart = tags["building:part"] !== undefined && tags["building"] === undefined;
  return {
    id: `${osmType[0]}${osmId}${suffix}`,
    osmType,
    osmId,
    outer: ensureOrientation(outer, true),
    holes: holes.map((h) => ensureOrientation(h, false)),
    height: est.height,
    minHeight: est.minHeight,
    quality: est.quality,
    heightSource: est.source,
    kind: tags["building"] ?? tags["building:part"] ?? "yes",
    isPart,
    name: tags["name"],
    tags: pickTags(tags),
  };
}

export interface ParseOptions {
  /** Ocultar contornos de edificios que tienen building:part dentro (regla de Simple 3D Buildings) */
  hideOutlinesWithParts?: boolean;
}

export function parseOverpassBuildings(resp: OverpassResponse, opts: ParseOptions = {}): BuildingFeature[] {
  const features: BuildingFeature[] = [];
  for (const el of resp.elements) {
    if (el.type === "way") {
      const tags = el.tags ?? {};
      if (tags["building"] === undefined && tags["building:part"] === undefined) continue;
      const pts = cleanGeometry(el.geometry);
      if (pts.length < 4 || !samePoint(pts[0]!, pts[pts.length - 1]!)) continue;
      const f = makeFeature("way", el.id, tags, openRing(pts), []);
      if (f) features.push(f);
    } else if (el.type === "relation") {
      const tags = el.tags ?? {};
      if (tags["building"] === undefined && tags["building:part"] === undefined) continue;
      const members = el.members ?? [];
      const outers = assembleRings(members.filter((m) => m.type === "way" && (m.role === "outer" || m.role === "")).map((m) => cleanGeometry(m.geometry)));
      const inners = assembleRings(members.filter((m) => m.type === "way" && m.role === "inner").map((m) => cleanGeometry(m.geometry)));
      outers.forEach((outer, i) => {
        const holes = inners.filter((inner) => inner.length > 0 && pointInRing(inner[0]!, outer));
        const f = makeFeature("relation", el.id, tags, outer, holes, outers.length > 1 ? `-${i}` : "");
        if (f) features.push(f);
      });
    }
  }

  if (opts.hideOutlinesWithParts !== false) {
    const parts = features.filter((f) => f.isPart).map((f) => ({ c: ringCenter(f.outer), b: bboxOf(f.outer) }));
    if (parts.length) {
      return features.filter((f) => {
        if (f.isPart) return true;
        const [w, s, e, n] = bboxOf(f.outer);
        const hasPart = parts.some((p) => p.b[0] >= w - EPS && p.b[2] <= e + EPS && p.b[1] >= s - EPS && p.b[3] <= n + EPS && pointInRing(p.c, f.outer));
        return !hasPart;
      });
    }
  }
  return features;
}

/** Consulta Overpass QL para edificios dentro de un bbox (sur, oeste, norte, este). */
export function buildingsQuery(south: number, west: number, north: number, east: number, timeoutSec = 25): string {
  const bb = `${south.toFixed(6)},${west.toFixed(6)},${north.toFixed(6)},${east.toFixed(6)}`;
  return `[out:json][timeout:${timeoutSec}];(way["building"](${bb});way["building:part"](${bb});relation["building"]["type"="multipolygon"](${bb});relation["building:part"]["type"="multipolygon"](${bb}););out geom qt;`;
}

export interface HeightStats {
  total: number;
  measured: number;
  levels: number;
  default: number;
}

export function heightStats(features: BuildingFeature[]): HeightStats {
  const s: HeightStats = { total: features.length, measured: 0, levels: 0, default: 0 };
  for (const f of features) s[f.quality]++;
  return s;
}
