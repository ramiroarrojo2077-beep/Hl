/// <reference lib="webworker" />
/**
 * Worker de decodificación de terreno: PNG Terrarium → grilla de alturas Float32.
 * Mantiene el hilo principal libre durante el streaming de terreno.
 */
import { rgbaToHeights, resampleHeights, heightRange } from "../geo/terrarium.ts";

interface Req {
  id: number;
  buffer: ArrayBuffer;
  outSize: number;
  minHeight: number | null;
  /** Devolver también la grilla completa 256×256 (para muestreo de elevaciones) */
  full: boolean;
}

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

self.onmessage = async (ev: MessageEvent<Req>) => {
  const { id, buffer, outSize, minHeight, full } = ev.data;
  try {
    const bmp = await createImageBitmap(new Blob([buffer], { type: "image/png" }), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    const size = bmp.width;
    if (!canvas || canvas.width !== size) {
      canvas = new OffscreenCanvas(size, size);
      ctx = canvas.getContext("2d", { willReadFrequently: true });
    }
    ctx!.clearRect(0, 0, size, size);
    ctx!.drawImage(bmp, 0, 0);
    bmp.close();
    const rgba = ctx!.getImageData(0, 0, size, size).data;
    const heights = rgbaToHeights(rgba, size);
    const grid = resampleHeights(heights, size, { outSize, minHeight: minHeight ?? undefined });
    const range = heightRange(grid);
    const transfer: Transferable[] = [grid.buffer];
    if (full) transfer.push(heights.buffer);
    (self as unknown as Worker).postMessage({ id, grid, size, range, heights: full ? heights : null }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
