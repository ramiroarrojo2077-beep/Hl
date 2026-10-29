import { createNoise2D, type NoiseFunction2D } from "simplex-noise";
import { Rng } from "./rng";

export interface Noise {
  simplex: NoiseFunction2D;
  /** Ruido fractal (fBm) normalizado aproximadamente a [-1, 1]. */
  fbm(x: number, y: number, octaves?: number, lacunarity?: number, gain?: number): number;
  /** Ruido "ridged": crestas afiladas para cordilleras, en [0, 1]. */
  ridged(x: number, y: number, octaves?: number): number;
}

export function createNoise(seed: number): Noise {
  const rng = new Rng(seed);
  const simplex = createNoise2D(() => rng.next());
  return {
    simplex,
    fbm(x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
      let amp = 1;
      let freq = 1;
      let sum = 0;
      let norm = 0;
      for (let i = 0; i < octaves; i++) {
        sum += amp * simplex(x * freq, y * freq);
        norm += amp;
        amp *= gain;
        freq *= lacunarity;
      }
      return sum / norm;
    },
    ridged(x, y, octaves = 5) {
      let amp = 0.5;
      let freq = 1;
      let sum = 0;
      let norm = 0;
      let weight = 1;
      for (let i = 0; i < octaves; i++) {
        let n = 1 - Math.abs(simplex(x * freq, y * freq));
        n *= n * weight;
        weight = Math.min(1, n * 2);
        sum += n * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.03;
      }
      return sum / norm;
    },
  };
}
