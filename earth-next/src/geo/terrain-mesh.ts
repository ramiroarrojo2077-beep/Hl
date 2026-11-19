/**
 * Malla de terreno cuantizada (formato "quantized-mesh" de Cesium) con normales por vértice,
 * generada a partir de una grilla de alturas Terrarium en proyección Web Mercator.
 * Las normales permiten que el sol ilumine el relieve (laderas en sombra, valles, crestas).
 * Módulo puro: se usa dentro del worker y se prueba en Node.
 */
import { sampleBilinear } from "./terrarium.ts";

const A = 6378137;
const E2 = 0.0066943799901413165; // excentricidad² WGS84
const DEG = Math.PI / 180;

export interface TileSpec {
  x: number;
  y: number;
  z: number;
  /** Vértices por lado */
  grid: number;
  /** Altura mínima (recorte de batimetría) o null */
  minHeight: number | null;
}

export interface MeshArrays {
  quantizedVertices: Uint16Array; // u[n], v[n], h[n]
  indices: Uint16Array | Uint32Array;
  encodedNormals: Uint8Array; // 2 bytes por vértice
  westIndices: Uint16Array;
  southIndices: Uint16Array;
  eastIndices: Uint16Array;
  northIndices: Uint16Array;
  minimumHeight: number;
  maximumHeight: number;
  /** Centro y radio de la esfera envolvente (ECEF) */
  sphere: [number, number, number, number];
  /** Posiciones ECEF relativas al centro de la esfera (para el punto de oclusión de horizonte) */
  relativePositions: Float64Array;
}

export function tileLatLon(t: { x: number; y: number; z: number }) {
  const n = 2 ** t.z;
  const lon = (x: number) => (x / n) * 360 - 180;
  const lat = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / DEG;
  return { west: lon(t.x), east: lon(t.x + 1), north: lat(t.y), south: lat(t.y + 1) };
}

export function geodeticToEcef(lonDeg: number, latDeg: number, h: number, out: Float64Array, o: number): void {
  const lon = lonDeg * DEG;
  const lat = latDeg * DEG;
  const sl = Math.sin(lat);
  const cl = Math.cos(lat);
  const N = A / Math.sqrt(1 - E2 * sl * sl);
  out[o] = (N + h) * cl * Math.cos(lon);
  out[o + 1] = (N + h) * cl * Math.sin(lon);
  out[o + 2] = (N * (1 - E2) + h) * sl;
}

const toSNorm = (v: number) => Math.round((Math.max(-1, Math.min(1, v)) * 0.5 + 0.5) * 255);
const signNotZero = (v: number) => (v < 0 ? -1 : 1);

/** Codificación octaédrica de un vector unitario a 2 bytes (compatible con AttributeCompression.octEncode). */
export function octEncode(x: number, y: number, z: number): [number, number] {
  const s = Math.abs(x) + Math.abs(y) + Math.abs(z);
  let ox = x / s;
  let oy = y / s;
  if (z < 0) {
    const tx = ox;
    const ty = oy;
    ox = (1 - Math.abs(ty)) * signNotZero(tx);
    oy = (1 - Math.abs(tx)) * signNotZero(ty);
  }
  return [toSNorm(ox), toSNorm(oy)];
}

/** Decodificación inversa (para pruebas). */
export function octDecode(bx: number, by: number): [number, number, number] {
  let x = (bx / 255) * 2 - 1;
  let y = (by / 255) * 2 - 1;
  const z = 1 - (Math.abs(x) + Math.abs(y));
  if (z < 0) {
    const ox = x;
    x = (1 - Math.abs(y)) * signNotZero(ox);
    y = (1 - Math.abs(ox)) * signNotZero(y);
  }
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/**
 * Construye la malla. Las filas se reparten linealmente en latitud (como espera Cesium para
 * quantized-mesh) y se muestrea la imagen Mercator en la posición correspondiente.
 */
export function buildTerrainMesh(heights: Float32Array, size: number, spec: TileSpec): MeshArrays {
  const n = Math.max(3, Math.min(256, Math.floor(spec.grid)));
  const count = n * n;
  const r = tileLatLon(spec);
  const tiles = 2 ** spec.z;
  const h = new Float32Array(count);
  const lats = new Float64Array(n);
  const lons = new Float64Array(n);
  for (let j = 0; j < n; j++) lats[j] = r.south + ((r.north - r.south) * j) / (n - 1);
  for (let i = 0; i < n; i++) lons[i] = r.west + ((r.east - r.west) * i) / (n - 1);

  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < n; j++) {
    const latR = Math.max(-85.0511, Math.min(85.0511, lats[j]!)) * DEG;
    const fy = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * tiles - spec.y;
    const py = fy * size;
    for (let i = 0; i < n; i++) {
      const px = (i / (n - 1)) * size;
      let v = sampleBilinear(heights, size, px, py);
      if (spec.minHeight !== null && v < spec.minHeight) v = spec.minHeight;
      h[j * n + i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (max - min < 0.01) max = min + 0.01;

  // Posiciones ECEF
  const pos = new Float64Array(count * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) geodeticToEcef(lons[i]!, lats[j]!, h[j * n + i]!, pos, (j * n + i) * 3);

  // Vértices cuantizados
  const qv = new Uint16Array(count * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      qv[k] = Math.round((i / (n - 1)) * 32767);
      qv[count + k] = Math.round((j / (n - 1)) * 32767);
      qv[2 * count + k] = Math.round(((h[k]! - min) / (max - min)) * 32767);
    }
  }

  // Normales por diferencias centrales en ECEF: cross(este, norte) = arriba
  const normals = new Uint8Array(count * 2);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const iw = j * n + Math.max(0, i - 1);
      const ie = j * n + Math.min(n - 1, i + 1);
      const js = Math.max(0, j - 1) * n + i;
      const jn = Math.min(n - 1, j + 1) * n + i;
      const ex = pos[ie * 3]! - pos[iw * 3]!;
      const ey = pos[ie * 3 + 1]! - pos[iw * 3 + 1]!;
      const ez = pos[ie * 3 + 2]! - pos[iw * 3 + 2]!;
      const nx = pos[jn * 3]! - pos[js * 3]!;
      const ny = pos[jn * 3 + 1]! - pos[js * 3 + 1]!;
      const nz = pos[jn * 3 + 2]! - pos[js * 3 + 2]!;
      let cx = ey * nz - ez * ny;
      let cy = ez * nx - ex * nz;
      let cz = ex * ny - ey * nx;
      const l = Math.hypot(cx, cy, cz) || 1;
      cx /= l;
      cy /= l;
      cz /= l;
      const [a, b] = octEncode(cx, cy, cz);
      normals[k * 2] = a;
      normals[k * 2 + 1] = b;
    }
  }

  // Triángulos (antihorarios vistos desde arriba)
  const quads = (n - 1) * (n - 1);
  const indices = count > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
  let t = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices[t++] = a;
      indices[t++] = b;
      indices[t++] = d;
      indices[t++] = a;
      indices[t++] = d;
      indices[t++] = c;
    }
  }

  const west = new Uint16Array(n);
  const east = new Uint16Array(n);
  const south = new Uint16Array(n);
  const north = new Uint16Array(n);
  for (let k = 0; k < n; k++) {
    west[k] = k * n;
    east[k] = k * n + n - 1;
    south[k] = k;
    north[k] = (n - 1) * n + k;
  }

  // Esfera envolvente
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let k = 0; k < count; k++) {
    sx += pos[k * 3]!;
    sy += pos[k * 3 + 1]!;
    sz += pos[k * 3 + 2]!;
  }
  sx /= count;
  sy /= count;
  sz /= count;
  let rad = 0;
  const rel = new Float64Array(count * 3);
  for (let k = 0; k < count; k++) {
    const dx = pos[k * 3]! - sx;
    const dy = pos[k * 3 + 1]! - sy;
    const dz = pos[k * 3 + 2]! - sz;
    rel[k * 3] = dx;
    rel[k * 3 + 1] = dy;
    rel[k * 3 + 2] = dz;
    rad = Math.max(rad, Math.hypot(dx, dy, dz));
  }

  return {
    quantizedVertices: qv,
    indices,
    encodedNormals: normals,
    westIndices: west,
    southIndices: south,
    eastIndices: east,
    northIndices: north,
    minimumHeight: min,
    maximumHeight: max,
    sphere: [sx, sy, sz, rad],
    relativePositions: rel,
  };
}
