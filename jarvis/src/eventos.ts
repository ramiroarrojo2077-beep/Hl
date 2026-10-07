import { EventEmitter } from "node:events";

// Todo lo que la interfaz tiene que enterarse en vivo pasa por acá y sale por GET /api/eventos.
export interface EventoJarvis {
  tipo: string;
  datos: unknown;
}

const bus = new EventEmitter();
bus.setMaxListeners(50);

export function emitir(tipo: string, datos: unknown): void {
  bus.emit("evento", { tipo, datos } satisfies EventoJarvis);
}

export function escuchar(fn: (evento: EventoJarvis) => void): () => void {
  bus.on("evento", fn);
  return () => bus.off("evento", fn);
}
