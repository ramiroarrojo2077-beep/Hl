/**
 * Análisis de pendientes a partir de modelos de elevación.
 * Método de Horn (1981) sobre ventana 3×3 — el mismo que usan GDAL y ArcGIS.
 */

export interface SlopeResult {
  /** Pendiente en grados */
  degrees: number;
  /** Pendiente en porcentaje (rise/run·100) */
  percent: number;
  /** Orientación (aspect) en grados desde el norte, o null en terreno plano */
  aspect: number | null;
}

/**
 * @param z ventana 3×3 de alturas por filas (norte→sur, oeste→este): [a b c / d e f / g h i]
 * @param cellX tamaño de celda este–oeste (m)
 * @param cellY tamaño de celda norte–sur (m)
 */
export function hornSlope(z: ArrayLike<number>, cellX: number, cellY: number): SlopeResult {
  const [a, b, c, d, , f, g, h, i] = Array.from(z) as number[];
  const dzdx = ((c! + 2 * f! + i!) - (a! + 2 * d! + g!)) / (8 * cellX);
  const dzdy = ((g! + 2 * h! + i!) - (a! + 2 * b! + c!)) / (8 * cellY);
  const rise = Math.hypot(dzdx, dzdy);
  const degrees = (Math.atan(rise) * 180) / Math.PI;
  let aspect: number | null = null;
  if (rise > 1e-9) {
    // dzdy positivo = aumenta hacia el sur; aspect = dirección de máxima bajada.
    let az = (Math.atan2(dzdx, -dzdy) * 180) / Math.PI; // dirección de subida
    az = (az + 180 + 360) % 360; // bajada
    aspect = az;
  }
  return { degrees, percent: rise * 100, aspect };
}

/** Pendiente media entre dos puntos de un perfil (grados con signo). */
export function segmentGrade(dz: number, horizontal: number): { degrees: number; percent: number } {
  if (horizontal <= 0) return { degrees: dz === 0 ? 0 : Math.sign(dz) * 90, percent: dz === 0 ? 0 : Math.sign(dz) * Infinity };
  return { degrees: (Math.atan2(dz, horizontal) * 180) / Math.PI, percent: (dz / horizontal) * 100 };
}

export interface ProfileStats {
  minElevation: number;
  maxElevation: number;
  totalAscent: number;
  totalDescent: number;
  maxGradePercent: number;
  meanGradePercent: number;
}

export function profileStats(samples: { distance: number; elevation: number }[]): ProfileStats {
  let min = Infinity;
  let max = -Infinity;
  let up = 0;
  let down = 0;
  let maxGrade = 0;
  let gradeSum = 0;
  let gradeCount = 0;
  for (let k = 0; k < samples.length; k++) {
    const s = samples[k]!;
    min = Math.min(min, s.elevation);
    max = Math.max(max, s.elevation);
    if (k > 0) {
      const p = samples[k - 1]!;
      const dz = s.elevation - p.elevation;
      if (dz > 0) up += dz;
      else down -= dz;
      const run = s.distance - p.distance;
      if (run > 0) {
        const g = Math.abs(dz / run) * 100;
        maxGrade = Math.max(maxGrade, g);
        gradeSum += g;
        gradeCount++;
      }
    }
  }
  return {
    minElevation: samples.length ? min : 0,
    maxElevation: samples.length ? max : 0,
    totalAscent: up,
    totalDescent: down,
    maxGradePercent: maxGrade,
    meanGradePercent: gradeCount ? gradeSum / gradeCount : 0,
  };
}

/** Clasificación de pendiente (útil en educación y planificación). */
export function slopeClass(deg: number): "flat" | "gentle" | "moderate" | "steep" | "very-steep" | "cliff" {
  if (deg < 2) return "flat";
  if (deg < 8) return "gentle";
  if (deg < 16) return "moderate";
  if (deg < 30) return "steep";
  if (deg < 45) return "very-steep";
  return "cliff";
}
