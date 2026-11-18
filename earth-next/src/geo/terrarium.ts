/**
 * Decodificación de teselas de elevación "Terrarium" (Mapzen / AWS Open Data Terrain Tiles).
 * altura = (R·256 + G + B/256) − 32768 metros.
 */

export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export function encodeTerrarium(h: number): [number, number, number] {
  const v = h + 32768;
  const r = Math.floor(v / 256);
  const g = Math.floor(v - r * 256);
  const b = Math.round((v - r * 256 - g) * 256);
  return [r, g, Math.min(255, b)];
}

/** Convierte una imagen RGBA (size×size) a una grilla de alturas Float32. */
export function rgbaToHeights(rgba: Uint8ClampedArray | Uint8Array, size: number): Float32Array {
  const out = new Float32Array(size * size);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = decodeTerrarium(rgba[j]!, rgba[j + 1]!, rgba[j + 2]!);
  return out;
}

/** Muestreo bilineal en coordenadas de píxel (centros en k+0.5), con recorte a bordes. */
export function sampleBilinear(heights: Float32Array, size: number, px: number, py: number): number {
  const x = Math.min(size - 1, Math.max(0, px - 0.5));
  const y = Math.min(size - 1, Math.max(0, py - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const h00 = heights[y0 * size + x0]!;
  const h10 = heights[y0 * size + x1]!;
  const h01 = heights[y1 * size + x0]!;
  const h11 = heights[y1 * size + x1]!;
  return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
}

export interface ResampleOptions {
  /** Tamaño de salida (Cesium usa grillas de 2^n+1, p. ej. 65). */
  outSize: number;
  /** Altura mínima: recorta batimetría para que el océano quede a nivel del mar. */
  minHeight?: number;
}

/**
 * Re-muestrea una tesela a una grilla (outSize × outSize) cuyos bordes coinciden con los
 * bordes de la tesela, como espera HeightmapTerrainData.
 */
export function resampleHeights(heights: Float32Array, size: number, opts: ResampleOptions): Float32Array {
  const n = opts.outSize;
  const out = new Float32Array(n * n);
  const min = opts.minHeight ?? -Infinity;
  for (let j = 0; j < n; j++) {
    const py = (j / (n - 1)) * size;
    for (let i = 0; i < n; i++) {
      const px = (i / (n - 1)) * size;
      const h = sampleBilinear(heights, size, px, py);
      out[j * n + i] = h < min ? min : h;
    }
  }
  return out;
}

export function heightRange(h: Float32Array): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < h.length; i++) {
    const v = h[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}
