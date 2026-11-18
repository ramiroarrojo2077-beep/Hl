/**
 * Niveles de detalle semánticos de EARTH NEXT (independientes del LOD interno de Cesium).
 * Determinan qué capas de datos se activan según la altura de la cámara.
 */

export type LodLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface LodInfo {
  level: LodLevel;
  key: "space" | "regions" | "cities" | "districts" | "streets" | "details";
}

/** Umbrales (altura de cámara sobre el terreno, en metros). */
export const LOD_THRESHOLDS: Record<LodLevel, number> = {
  0: 2_500_000, // ≥ 2500 km: vista desde el espacio
  1: 250_000, // ≥ 250 km: países y regiones
  2: 15_000, // ≥ 15 km: ciudades
  3: 1_500, // ≥ 1.5 km: barrios y edificios
  4: 150, // ≥ 150 m: calles y elementos urbanos
  5: 0, // < 150 m: detalles disponibles
};

const KEYS: LodInfo["key"][] = ["space", "regions", "cities", "districts", "streets", "details"];

export function lodForHeight(heightAboveGround: number): LodInfo {
  const h = Math.max(0, heightAboveGround);
  for (const level of [0, 1, 2, 3, 4] as LodLevel[]) {
    if (h >= LOD_THRESHOLDS[level]) return { level, key: KEYS[level]! };
  }
  return { level: 5, key: "details" };
}

/** Altura máxima de cámara a la que se transmiten edificios OSM. */
export const BUILDINGS_MAX_HEIGHT = 6_000;
/** Altura máxima de cámara a la que se transmiten elementos urbanos (árboles, faroles...). */
export const URBAN_FEATURES_MAX_HEIGHT = 900;

/** Radio de carga de edificios según la altura de la cámara (m). */
export function buildingLoadRadius(cameraHeight: number): number {
  return Math.min(4_500, Math.max(900, cameraHeight * 1.6));
}
