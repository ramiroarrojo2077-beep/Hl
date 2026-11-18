/**
 * Proveedor de terreno de Cesium sobre las "Terrain Tiles" abiertas de AWS (formato Terrarium,
 * fuentes: SRTM, GMTED, ETOPO1, NED, entre otras — https://registry.opendata.aws/terrain-tiles/).
 * Usa el planificador de pedidos de Cesium (throttling/cancelación) y decodifica en workers.
 */
import {
  Credit,
  Event as CesiumEvent,
  HeightmapTerrainData,
  Resource,
  TerrainProvider,
  WebMercatorTilingScheme,
  Ellipsoid,
  type Request,
  type TerrainData,
} from "cesium";
import { decoderPool } from "./decoder-pool.ts";

export const TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const TERRARIUM_MAX_LEVEL = 15;
const GRID = 65;

export interface TerrariumOptions {
  url?: string;
  maxLevel?: number;
  /** Mostrar batimetría (fondo oceánico). Por defecto se recorta a 0 m. */
  bathymetry?: boolean;
}

export class TerrariumTerrainProvider {
  readonly tilingScheme = new WebMercatorTilingScheme({ ellipsoid: Ellipsoid.WGS84 });
  readonly errorEvent = new CesiumEvent();
  readonly credit = new Credit(
    'Terreno: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a> (SRTM, ETOPO1, GMTED y otras fuentes abiertas)',
    true,
  );
  readonly hasWaterMask = false;
  readonly hasVertexNormals = false;
  readonly availability = undefined;
  readonly ready = true;
  private url: string;
  private maxLevel: number;
  private minHeight: number | null;
  private levelZeroError: number;

  constructor(opts: TerrariumOptions = {}) {
    this.url = opts.url ?? TERRARIUM_URL;
    this.maxLevel = opts.maxLevel ?? TERRARIUM_MAX_LEVEL;
    this.minHeight = opts.bathymetry ? null : 0;
    this.levelZeroError = TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(this.tilingScheme.ellipsoid, GRID, this.tilingScheme.getNumberOfXTilesAtLevel(0));
  }

  requestTileGeometry(x: number, y: number, level: number, request?: Request): Promise<TerrainData> | undefined {
    const resource = new Resource({
      url: this.url.replace("{z}", String(level)).replace("{x}", String(x)).replace("{y}", String(y)),
      request,
    });
    const fetched = resource.fetchArrayBuffer();
    if (!fetched) return undefined; // throttled: Cesium reintenta luego
    const childMask = level < this.maxLevel ? 15 : 0;
    return fetched.then(async (buffer) => {
      if (!buffer) throw new Error("Tesela vacía");
      const { grid } = await decoderPool().decode(buffer, GRID, this.minHeight);
      return new HeightmapTerrainData({
        buffer: grid,
        width: GRID,
        height: GRID,
        childTileMask: childMask,
        structure: { heightScale: 1, heightOffset: 0, elementsPerHeight: 1, stride: 1, elementMultiplier: 256, isBigEndian: false },
      });
    });
  }

  getLevelMaximumGeometricError(level: number): number {
    return this.levelZeroError / (1 << level);
  }

  getTileDataAvailable(_x: number, _y: number, level: number): boolean {
    return level <= this.maxLevel;
  }

  loadTileDataAvailability(): undefined {
    return undefined;
  }
}

/** Crea el proveedor como TerrainProvider de Cesium (tipado estructural). */
export function createTerrariumTerrain(opts: TerrariumOptions = {}): TerrainProvider {
  return new TerrariumTerrainProvider(opts) as unknown as TerrainProvider;
}
