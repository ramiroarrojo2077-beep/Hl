/**
 * Fuentes históricas reales:
 *  - Esri World Imagery Wayback: todas las versiones publicadas del mosaico satelital desde 2014.
 *  - NASA CMR: fechas con pasadas de Landsat/Sentinel-2 (HLS) sobre la zona, con % de nubes.
 *  - NASA GIBS: MODIS diario desde 2000 y Landsat WELD 1984–2000 (ver catálogo de capas).
 * No se generan imágenes: las reconstrucciones hipotéticas deben rotularse aparte.
 */
import type { LayerDef } from "../engine/catalog.ts";
import { getJson } from "./http.ts";

export interface WaybackRelease {
  id: number;
  date: string; // YYYY-MM-DD
  title: string;
  url: string;
}

const WAYBACK_CONFIG = "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json";

export async function waybackReleases(signal?: AbortSignal): Promise<WaybackRelease[]> {
  const r = await getJson<Record<string, { itemTitle: string; itemURL: string }>>(WAYBACK_CONFIG, {
    signal,
    timeoutMs: 15000,
    cacheKey: "wayback-config",
    cacheTtlMs: 86400_000,
    staleOnError: true,
  });
  return Object.entries(r)
    .map(([id, v]) => {
      const m = v.itemTitle.match(/(\d{4}-\d{2}-\d{2})/);
      return {
        id: Number(id),
        date: m?.[1] ?? "",
        title: v.itemTitle,
        url: v.itemURL.replace("{level}", "{z}").replace("{row}", "{y}").replace("{col}", "{x}"),
      };
    })
    .filter((x) => x.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function waybackLayerDef(r: WaybackRelease): LayerDef {
  return {
    id: `wayback-${r.id}`,
    name: `Esri Wayback ${r.date}`,
    nameEn: `Esri Wayback ${r.date}`,
    category: "history",
    nature: "composite",
    url: r.url,
    maxLevel: 19,
    attribution: `Esri World Imagery Wayback (versión ${r.date}) — Esri, Maxar, Earthstar Geographics`,
    license: "Términos de uso de Esri; atribución obligatoria.",
    licenseUrl: "https://livingatlas.arcgis.com/wayback/",
    description: `Mosaico satelital tal como estaba publicado el ${r.date}. Cada zona puede tener imágenes de fechas anteriores a la versión.`,
  };
}

export interface AcquisitionDate {
  date: string;
  cloudCover: number | null;
  sensor: "Sentinel-2" | "Landsat";
}

/**
 * Fechas reales con imágenes HLS (30 m) sobre un bbox, filtradas por nubosidad, vía NASA CMR.
 * Permite elegir días sin nubes para comparar épocas.
 */
export async function hlsAcquisitions(
  bbox: { west: number; south: number; east: number; north: number },
  opts: { from?: string; to?: string; maxCloud?: number; sensor?: "S30" | "L30"; signal?: AbortSignal } = {},
): Promise<AcquisitionDate[]> {
  const sensor = opts.sensor ?? "S30";
  const params = new URLSearchParams({
    short_name: `HLS${sensor}`,
    bounding_box: [bbox.west, bbox.south, bbox.east, bbox.north].map((v) => v.toFixed(4)).join(","),
    page_size: "200",
    sort_key: "-start_date",
  });
  params.set("temporal", `${opts.from ?? "2015-11-28"}T00:00:00Z,${opts.to ?? new Date().toISOString().slice(0, 10)}T23:59:59Z`);
  params.set("cloud_cover", `0,${opts.maxCloud ?? 30}`);
  const r = await getJson<{ feed: { entry: { time_start: string; cloud_cover?: string }[] } }>(`https://cmr.earthdata.nasa.gov/search/granules.json?${params}`, {
    signal: opts.signal,
    timeoutMs: 20000,
    cacheKey: `cmr:${params}`,
    cacheTtlMs: 86400_000,
  });
  const byDate = new Map<string, AcquisitionDate>();
  for (const e of r.feed.entry) {
    const date = e.time_start.slice(0, 10);
    const cc = e.cloud_cover !== undefined ? Number(e.cloud_cover) : null;
    const prev = byDate.get(date);
    if (!prev || (cc !== null && (prev.cloudCover === null || cc < prev.cloudCover))) {
      byDate.set(date, { date, cloudCover: cc, sensor: sensor === "S30" ? "Sentinel-2" : "Landsat" });
    }
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** Épocas sugeridas para la línea de tiempo, con la mejor fuente disponible en cada una. */
export interface Epoch {
  year: number;
  layer: string;
  label: string;
  resolution: string;
}

export function epochsFor(waybackAvailable: boolean): Epoch[] {
  const out: Epoch[] = [];
  for (const y of [1985, 1990, 1995, 2000]) out.push({ year: y, layer: "hist-landsat", label: `Landsat ${y}`, resolution: "30 m" });
  for (const y of [2002, 2005, 2008, 2011, 2014]) out.push({ year: y, layer: "hist-modis", label: `MODIS ${y}`, resolution: "250 m" });
  if (waybackAvailable) for (const y of [2014, 2016, 2018, 2020, 2022, 2024, 2026]) out.push({ year: y, layer: "wayback", label: `Wayback ${y}`, resolution: "≤1 m" });
  for (const y of [2016, 2019, 2022, 2025]) out.push({ year: y, layer: "hist-hls", label: `Sentinel-2 ${y}`, resolution: "30 m" });
  return out.sort((a, b) => a.year - b.year);
}
