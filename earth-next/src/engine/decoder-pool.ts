/** Pool de workers para decodificar teselas de elevación sin bloquear la interfaz. */

export interface DecodeResult {
  grid: Float32Array;
  size: number;
  range: { min: number; max: number };
  heights: Float32Array | null;
}

interface Pending {
  resolve: (r: DecodeResult) => void;
  reject: (e: Error) => void;
}

export class DecoderPool {
  private workers: Worker[] = [];
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private rr = 0;

  constructor(size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL("./terrarium.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (ev) => {
        const { id, error, ...rest } = ev.data as { id: number; error?: string } & DecodeResult;
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        if (error) p.reject(new Error(error));
        else p.resolve(rest as DecodeResult);
      };
      this.workers.push(w);
    }
  }

  decode(buffer: ArrayBuffer, outSize: number, minHeight: number | null, full = false): Promise<DecodeResult> {
    const id = this.nextId++;
    const w = this.workers[this.rr++ % this.workers.length]!;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ id, buffer, outSize, minHeight, full }, [buffer]);
    });
  }

  destroy(): void {
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
  }
}

let shared: DecoderPool | null = null;
export function decoderPool(): DecoderPool {
  if (!shared) shared = new DecoderPool();
  return shared;
}
