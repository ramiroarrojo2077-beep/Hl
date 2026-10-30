import type { ExtractCtx } from './types';

// OCR local con Tesseract (sin conexión: worker, núcleo y datos de español e
// inglés se empaquetan en public/vendor). Opcionalmente, OCR por visión con IA.

type TessWorker = import('tesseract.js').Worker;
let workerPromise: Promise<TessWorker> | null = null;

function vendor(path: string) {
  return new URL(`vendor/tesseract/${path}`, document.baseURI).href;
}

async function getWorker(onProgress?: (p: number) => void): Promise<TessWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM } = await import('tesseract.js');
      return createWorker(['spa', 'eng'], OEM.LSTM_ONLY, {
        workerPath: vendor('worker.min.js'),
        corePath: vendor('core'),
        langPath: vendor('lang'),
        gzip: false,
        logger: (m) => {
          if (m.status === 'recognizing text') onProgress?.(m.progress);
        },
      });
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

export async function ocrImage(image: Blob | HTMLCanvasElement, ctx: ExtractCtx): Promise<{ text: string; confidence: number }> {
  if (ctx.ocrMode === 'ai') {
    const { visionOcr } = await import('@/ai/agents/document');
    const blob = image instanceof Blob ? image : await new Promise<Blob>((res, rej) => image.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo convertir la imagen'))), 'image/jpeg', 0.9));
    const b64 = await blobToB64(blob);
    const text = await visionOcr(b64, blob.type || 'image/jpeg', ctx.signal);
    return { text, confidence: text ? 90 : 0 };
  }
  const w = await getWorker();
  if (ctx.signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
  const res = await w.recognize(image as unknown as HTMLCanvasElement);
  return { text: res.data.text ?? '', confidence: res.data.confidence ?? 0 };
}

export async function terminateOcr() {
  if (workerPromise) {
    const w = await workerPromise.catch(() => null);
    workerPromise = null;
    await w?.terminate();
  }
}

async function blobToB64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Reduce imágenes muy grandes antes del OCR (mejor velocidad en celulares). */
export async function prepareImage(file: Blob, maxSide = 2400): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const g = c.getContext('2d')!;
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}
