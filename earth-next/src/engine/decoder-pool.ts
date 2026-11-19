/** Pool de workers para decodificar teselas de elevación y generar mallas sin bloquear la interfaz. */
import type { MeshArrays, TileSpec } from "../geo/terrain-mesh.ts";

interface Pending {
  resolve: (r: unknown) => void;
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
        const { id, error, ...rest } = ev.data as { id: number; error?: string };
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        if (error) p.reject(new Error(error));
        else p.resolve(rest);
      };
      this.workers.push(w);
    }
  }

  private post<T>(msg: Record<string, unknown>, transfer: Transferable[]): Promise<T> {
    const id = this.nextId++;
    const w = this.workers[this.rr++ % this.workers.length]!;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (r: unknown) => void, reject });
      w.postMessage({ ...msg, id }, transfer);
    });
  }

  /** Alturas completas de una tesela (para mediciones). */
  heights(buffer: ArrayBuffer): Promise<{ heights: Float32Array; size: number }> {
    return this.post({ kind: "heights", buffer }, [buffer]);
  }

  /** Malla cuantizada con normales para el globo. */
  mesh(buffer: ArrayBuffer, tile: TileSpec): Promise<{ mesh: MeshArrays }> {
    return this.post({ kind: "mesh", buffer, tile }, [buffer]);
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
