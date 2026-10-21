import { EventEmitter } from "node:events";

// Bus de eventos que el servidor reenvía al navegador por SSE.
export const bus = new EventEmitter();
bus.setMaxListeners(0);

export function emitir(tipo: string, datos: Record<string, unknown> = {}): void {
  bus.emit("evento", tipo, datos);
}

// Con 30 bots a la vez, mandar cada cambio por separado inunda al navegador: el estado de cada bot
// sale como mucho cada 250 ms (gana el último) y el texto en vivo se junta cada 100 ms.
const ESTADO_MS = 250;
const DELTA_MS = 100;
const estados = new Map<string, { ultimo: number; pendiente: Record<string, unknown> | null; timer: NodeJS.Timeout | null }>();

export function emitirEstado(botId: string, datos: Record<string, unknown>): void {
  const e = estados.get(botId) ?? { ultimo: 0, pendiente: null, timer: null };
  estados.set(botId, e);
  const falta = e.ultimo + ESTADO_MS - Date.now();
  if (falta <= 0 && !e.timer) {
    e.ultimo = Date.now();
    emitir("estado", { botId, ...datos });
    return;
  }
  e.pendiente = datos;
  e.timer ??= setTimeout(() => {
    e.timer = null;
    e.ultimo = Date.now();
    if (e.pendiente) emitir("estado", { botId, ...e.pendiente });
    e.pendiente = null;
  }, Math.max(0, falta));
}

const deltas = new Map<string, string>();
let timerDeltas: NodeJS.Timeout | null = null;

export function emitirDelta(botId: string, texto: string): void {
  deltas.set(botId, (deltas.get(botId) ?? "") + texto);
  timerDeltas ??= setTimeout(vaciarDeltas, DELTA_MS);
}

// Manda ya lo acumulado (antes de avisar que cambió la conversación, para no perder texto).
export function vaciarDeltas(): void {
  if (timerDeltas) clearTimeout(timerDeltas);
  timerDeltas = null;
  for (const [botId, texto] of deltas) emitir("delta", { botId, texto });
  deltas.clear();
}
