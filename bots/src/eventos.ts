import { EventEmitter } from "node:events";

// Bus de eventos que el servidor reenvía al navegador por SSE.
export const bus = new EventEmitter();
bus.setMaxListeners(0);

export function emitir(tipo: string, datos: Record<string, unknown> = {}): void {
  bus.emit("evento", tipo, datos);
}
