/**
 * Servicio de elevaciones: consulta alturas reales (m sobre el nivel del mar) a partir de las
 * teselas Terrarium, con caché LRU de teselas decodificadas.
 * Precisión: la de las fuentes (SRTM ~30 m en tierra; ETOPO1 en océano).
 */
import type { LonLat } from "../geo/coords.ts";
import { lonLatToTilePixel, tileKey, metersPerPixel, type TileXYZ } from "../geo/tiles.ts";
import { sampleBilinear } from "../geo/terrarium.ts";
import { interpolateGeodesic, inverse, distance as geoDistance } from "../geo/geodesy.ts";
import { hornSlope, type SlopeResult } from "../geo/slope.ts";
import { LruCache } from "./cache.ts";
import { TERRARIUM_URL } from "../engine/terrain-provider.ts";
import { decoderPool } from "../engine/decoder-pool.ts";
import { getArrayBuffer } from "./http.ts";

interface DecodedTile {
  heights: Float32Array;
  size: number;
}

const tiles = new LruCache<DecodedTile>(96);
const loading = new Map<string, Promise<DecodedTile>>();

export const ELEVATION_SOURCE = {
  name: "AWS Terrain Tiles (Mapzen Terrarium)",
  url: "https://registry.opendata.aws/terrain-tiles/",
  license: "Fuentes abiertas: SRTM, GMTED2010, ETOPO1, NED, entre otras (atribución requerida)",
};

async function loadTile(t: TileXYZ, signal?: AbortSignal): Promise<DecodedTile> {
  const key = tileKey(t);
  const hit = tiles.get(key);
  if (hit) return hit;
  const pending = loading.get(key);
  if (pending) return pending;
  const p = (async () => {
    const url = TERRARIUM_URL.replace("{z}", String(t.z)).replace("{x}", String(t.x)).replace("{y}", String(t.y));
    const buf = await getArrayBuffer(url, { signal, timeoutMs: 20000, retries: 2 });
    const res = await decoderPool().heights(buf.slice(0));
    const tile = { heights: res.heights, size: res.size };
    tiles.set(key, tile);
    return tile;
  })();
  loading.set(key, p);
  try {
    return await p;
  } finally {
    loading.delete(key);
  }
}

/** Altura del terreno en un punto (m). Zoom 14 ≈ 9.5 m/píxel en el ecuador. */
export async function elevationAt(p: LonLat, zoom = 14, signal?: AbortSignal): Promise<number> {
  const { tile, px, py } = lonLatToTilePixel(p, zoom);
  const t = await loadTile(tile, signal);
  return sampleBilinear(t.heights, t.size, px, py);
}

export async function elevationsAt(points: LonLat[], zoom = 14, signal?: AbortSignal): Promise<number[]> {
  // Agrupa por tesela para no pedir dos veces la misma.
  const groups = new Map<string, { tile: TileXYZ; idx: number[] }>();
  const pix = points.map((p) => lonLatToTilePixel(p, zoom));
  pix.forEach((r, i) => {
    const k = tileKey(r.tile);
    const g = groups.get(k) ?? { tile: r.tile, idx: [] };
    g.idx.push(i);
    groups.set(k, g);
  });
  const out = new Array<number>(points.length);
  const queue = [...groups.values()];
  const worker = async () => {
    while (queue.length) {
      const g = queue.shift()!;
      const t = await loadTile(g.tile, signal);
      for (const i of g.idx) out[i] = sampleBilinear(t.heights, t.size, pix[i]!.px, pix[i]!.py);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}

export interface ProfileSample extends LonLat {
  distance: number;
  elevation: number;
}

/** Perfil de elevación a lo largo de una polilínea geodésica. */
export async function elevationProfile(path: LonLat[], samples = 200, signal?: AbortSignal): Promise<ProfileSample[]> {
  if (path.length < 2) return [];
  const segLengths = path.slice(1).map((p, i) => geoDistance(path[i]!, p));
  const total = segLengths.reduce((a, b) => a + b, 0);
  const pts: { p: LonLat; d: number }[] = [];
  let acc = 0;
  path.slice(1).forEach((b, i) => {
    const a = path[i]!;
    const len = segLengths[i]!;
    const n = Math.max(2, Math.round((len / Math.max(1, total)) * samples));
    const seg = interpolateGeodesic(a, b, n);
    seg.forEach((p, j) => {
      if (i > 0 && j === 0) return;
      pts.push({ p, d: acc + (len * j) / (n - 1) });
    });
    acc += len;
  });
  // Zoom adaptado a la longitud: perfiles largos no necesitan z14.
  const zoom = total > 500_000 ? 9 : total > 100_000 ? 11 : total > 20_000 ? 12 : 14;
  const elev = await elevationsAt(
    pts.map((x) => x.p),
    zoom,
    signal,
  );
  return pts.map((x, i) => ({ ...x.p, distance: x.d, elevation: elev[i]! }));
}

/** Pendiente del terreno en un punto (método de Horn sobre la grilla de la tesela). */
export async function slopeAt(p: LonLat, zoom = 14, signal?: AbortSignal): Promise<SlopeResult & { elevation: number; cellSize: number }> {
  const cell = metersPerPixel(zoom, p.lat);
  const dLat = cell / 111320;
  const dLon = cell / (111320 * Math.cos((p.lat * Math.PI) / 180));
  const window: LonLat[] = [];
  for (let r = -1; r <= 1; r++) for (let c = -1; c <= 1; c++) window.push({ lon: p.lon + c * dLon, lat: p.lat - r * dLat });
  const z = await elevationsAt(window, zoom, signal);
  return { ...hornSlope(z, cell, cell), elevation: z[4]!, cellSize: cell };
}

/** Diferencia de altura y distancia entre dos puntos sobre el terreno. */
export async function heightBetween(a: LonLat, b: LonLat, signal?: AbortSignal) {
  const [ha, hb] = await elevationsAt([a, b], 14, signal);
  const inv = inverse(a, b);
  return { elevationA: ha!, elevationB: hb!, deltaHeight: hb! - ha!, horizontal: inv.distance, bearing: inv.initialBearing };
}
