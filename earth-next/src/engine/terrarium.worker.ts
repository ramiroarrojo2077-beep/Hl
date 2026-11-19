/// <reference lib="webworker" />
/**
 * Worker de terreno: decodifica PNG Terrarium y genera, según el pedido,
 *  - "mesh": malla cuantizada con normales (para el globo iluminado por el sol), o
 *  - "heights": la grilla de alturas completa (para mediciones y perfiles).
 * Mantiene el hilo principal libre durante el streaming.
 */
import { rgbaToHeights } from "../geo/terrarium.ts";
import { buildTerrainMesh, type TileSpec } from "../geo/terrain-mesh.ts";

type Req =
  | { id: number; kind: "heights"; buffer: ArrayBuffer }
  | { id: number; kind: "mesh"; buffer: ArrayBuffer; tile: TileSpec };

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

async function decode(buffer: ArrayBuffer): Promise<{ heights: Float32Array; size: number }> {
  const bmp = await createImageBitmap(new Blob([buffer], { type: "image/png" }), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const size = bmp.width;
  if (!canvas || canvas.width !== size) {
    canvas = new OffscreenCanvas(size, size);
    ctx = canvas.getContext("2d", { willReadFrequently: true });
  }
  ctx!.clearRect(0, 0, size, size);
  ctx!.drawImage(bmp, 0, 0);
  bmp.close();
  return { heights: rgbaToHeights(ctx!.getImageData(0, 0, size, size).data, size), size };
}

self.onmessage = async (ev: MessageEvent<Req>) => {
  const req = ev.data;
  try {
    const { heights, size } = await decode(req.buffer);
    if (req.kind === "heights") {
      (self as unknown as Worker).postMessage({ id: req.id, heights, size }, [heights.buffer]);
      return;
    }
    const m = buildTerrainMesh(heights, size, req.tile);
    (self as unknown as Worker).postMessage({ id: req.id, mesh: m }, [
      m.quantizedVertices.buffer,
      m.indices.buffer,
      m.encodedNormals.buffer,
      m.westIndices.buffer,
      m.southIndices.buffer,
      m.eastIndices.buffer,
      m.northIndices.buffer,
      m.relativePositions.buffer,
    ]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: req.id, error: String(err) });
  }
};
