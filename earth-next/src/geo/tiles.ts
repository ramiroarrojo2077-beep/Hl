/** Matemática de teselas Web Mercator (esquema XYZ / "slippy map"). */
import type { LonLat } from "./coords.ts";

export interface TileXYZ {
  x: number;
  y: number;
  z: number;
}

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export const MAX_MERCATOR_LAT = 85.0511287798066;

export function lonLatToTile(p: LonLat, z: number): TileXYZ {
  const n = 2 ** z;
  const lat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, p.lat));
  const x = Math.floor(((p.lon + 180) / 360) * n);
  const latR = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)), z };
}

/** Coordenadas fraccionarias de píxel dentro de la tesela (0..size). */
export function lonLatToTilePixel(p: LonLat, z: number, size = 256): { tile: TileXYZ; px: number; py: number } {
  const n = 2 ** z;
  const lat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, p.lat));
  const fx = ((p.lon + 180) / 360) * n;
  const latR = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  const x = Math.min(n - 1, Math.max(0, Math.floor(fx)));
  const y = Math.min(n - 1, Math.max(0, Math.floor(fy)));
  return { tile: { x, y, z }, px: (fx - x) * size, py: (fy - y) * size };
}

export function tileToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

export function tileToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function tileBBox(t: TileXYZ): BBox {
  return { west: tileToLon(t.x, t.z), east: tileToLon(t.x + 1, t.z), north: tileToLat(t.y, t.z), south: tileToLat(t.y + 1, t.z) };
}

export function tileKey(t: TileXYZ): string {
  return `${t.z}/${t.x}/${t.y}`;
}

export function tilesInBBox(b: BBox, z: number, max = 256): TileXYZ[] {
  const tl = lonLatToTile({ lon: b.west, lat: b.north }, z);
  const br = lonLatToTile({ lon: b.east, lat: b.south }, z);
  const out: TileXYZ[] = [];
  for (let x = tl.x; x <= br.x; x++) {
    for (let y = tl.y; y <= br.y; y++) {
      out.push({ x, y, z });
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** Teselas ordenadas por distancia al centro (para cargar primero lo más cercano). */
export function tilesAround(center: LonLat, radiusMeters: number, z: number, max = 64): TileXYZ[] {
  const dLat = radiusMeters / 111320;
  const dLon = radiusMeters / (111320 * Math.max(0.05, Math.cos((center.lat * Math.PI) / 180)));
  const tiles = tilesInBBox(
    { west: center.lon - dLon, east: center.lon + dLon, south: center.lat - dLat, north: center.lat + dLat },
    z,
    max * 4,
  );
  const c = lonLatToTilePixel(center, z, 1);
  const cx = c.tile.x + c.px;
  const cy = c.tile.y + c.py;
  return tiles
    .map((t) => ({ t, d: (t.x + 0.5 - cx) ** 2 + (t.y + 0.5 - cy) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((e) => e.t);
}

/** Resolución en metros por píxel en el ecuador para un zoom dado. */
export function metersPerPixel(z: number, lat = 0, size = 256): number {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (size * 2 ** z);
}
