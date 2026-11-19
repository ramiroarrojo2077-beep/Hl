/**
 * Proveedor de terreno de Cesium sobre las "Terrain Tiles" abiertas de AWS (formato Terrarium,
 * fuentes: SRTM, GMTED, ETOPO1, NED, entre otras — https://registry.opendata.aws/terrain-tiles/).
 * Genera mallas cuantizadas CON NORMALES en workers, de modo que el relieve recibe la luz del
 * sol (laderas iluminadas y en sombra) y proyecta sombras. Usa el planificador de pedidos de
 * Cesium (prioridad, cancelación) y adapta la densidad de la malla a la calidad gráfica.
 */
import {
  BoundingSphere,
  Cartesian3,
  Credit,
  Ellipsoid,
  EllipsoidalOccluder,
  Event as CesiumEvent,
  OrientedBoundingBox,
  QuantizedMeshTerrainData,
  Resource,
  TerrainProvider,
  WebMercatorTilingScheme,
  type Request,
  type TerrainData,
} from "cesium";
import { decoderPool } from "./decoder-pool.ts";

export const TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const TERRARIUM_MAX_LEVEL = 15;

export interface TerrariumOptions {
  url?: string;
  maxLevel?: number;
  /** Mostrar batimetría (fondo oceánico). Por defecto se recorta a 0 m. */
  bathymetry?: boolean;
  /** Vértices por lado en niveles de detalle altos (65, 97, 129…) */
  detailGrid?: number;
}

export class TerrariumTerrainProvider {
  readonly tilingScheme = new WebMercatorTilingScheme({ ellipsoid: Ellipsoid.WGS84 });
  readonly errorEvent = new CesiumEvent();
  readonly credit = new Credit(
    'Terreno: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a> (SRTM, ETOPO1, GMTED y otras fuentes abiertas)',
    true,
  );
  readonly hasWaterMask = false;
  /** Las mallas incluyen normales: el globo puede iluminar el relieve con el sol. */
  readonly hasVertexNormals = true;
  readonly availability = undefined;
  readonly ready = true;
  private url: string;
  private maxLevel: number;
  private minHeight: number | null;
  private detailGrid: number;
  private levelZeroError: number;
  private occluder = new EllipsoidalOccluder(Ellipsoid.WGS84);

  constructor(opts: TerrariumOptions = {}) {
    this.url = opts.url ?? TERRARIUM_URL;
    this.maxLevel = opts.maxLevel ?? TERRARIUM_MAX_LEVEL;
    this.minHeight = opts.bathymetry ? null : 0;
    this.detailGrid = opts.detailGrid ?? 65;
    // Error geométrico estimado para una grilla de 65 muestras (referencia de Cesium)
    this.levelZeroError = TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(this.tilingScheme.ellipsoid, 65, this.tilingScheme.getNumberOfXTilesAtLevel(0));
  }

  private gridFor(level: number): number {
    if (level < 5) return 33;
    if (level < 10) return 65;
    return this.detailGrid;
  }

  requestTileGeometry(x: number, y: number, level: number, request?: Request): Promise<TerrainData> | undefined {
    const resource = new Resource({
      url: this.url.replace("{z}", String(level)).replace("{x}", String(x)).replace("{y}", String(y)),
      request,
    });
    const fetched = resource.fetchArrayBuffer();
    if (!fetched) return undefined; // limitado por el planificador: Cesium reintenta luego
    return fetched.then(async (buffer) => {
      if (!buffer) throw new Error("Tesela vacía");
      const { mesh } = await decoderPool().mesh(buffer, { x, y, z: level, grid: this.gridFor(level), minHeight: this.minHeight });
      const center = new Cartesian3(mesh.sphere[0], mesh.sphere[1], mesh.sphere[2]);
      const boundingSphere = new BoundingSphere(center, mesh.sphere[3]);
      const horizonOcclusionPoint = this.occluder.computeHorizonCullingPointFromVerticesPossiblyUnderEllipsoid(center, mesh.relativePositions, 3, center, mesh.minimumHeight);
      const rectangle = this.tilingScheme.tileXYToRectangle(x, y, level);
      const orientedBoundingBox = rectangle.width < Math.PI / 2 ? OrientedBoundingBox.fromRectangle(rectangle, mesh.minimumHeight, mesh.maximumHeight, this.tilingScheme.ellipsoid) : undefined;
      const skirt = this.getLevelMaximumGeometricError(level) * 5;
      return new QuantizedMeshTerrainData({
        quantizedVertices: mesh.quantizedVertices,
        indices: mesh.indices,
        encodedNormals: mesh.encodedNormals,
        minimumHeight: mesh.minimumHeight,
        maximumHeight: mesh.maximumHeight,
        boundingSphere,
        orientedBoundingBox,
        horizonOcclusionPoint: horizonOcclusionPoint ?? center,
        westIndices: mesh.westIndices as unknown as number[],
        southIndices: mesh.southIndices as unknown as number[],
        eastIndices: mesh.eastIndices as unknown as number[],
        northIndices: mesh.northIndices as unknown as number[],
        westSkirtHeight: skirt,
        southSkirtHeight: skirt,
        eastSkirtHeight: skirt,
        northSkirtHeight: skirt,
        childTileMask: level < this.maxLevel ? 15 : 0,
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
