import Anthropic from "@anthropic-ai/sdk";
import { ajustes } from "./almacen.ts";
import { emitir } from "./eventos.ts";

// Compuerta única para las llamadas al modelo. Los límites de la API son por organización:
// con 30 bots, cada uno reintentando por su cuenta, se pisan. Acá se reparten los cupos con
// prioridad, turno justo entre bots y espera global cuando la API pide frenar.

export type Clase = "usuario" | "reunion" | "manager" | "tarea" | "rutina";
const PESO: Record<Clase, number> = { usuario: 0, reunion: 1, manager: 2, tarea: 3, rutina: 4 };
const MAX_INTENTOS = 8;
const EXITOS_PARA_SUBIR = 20;

interface Espera {
  botId: string;
  clase: Clase;
  desde: number;
  entrar: () => void;
  signal: AbortSignal;
}

let limite = ajustes().maxLlamadas;
let enUso = 0;
let pausaHasta = 0;
let exitosSeguidos = 0;
const cola: Espera[] = [];
const servido = new Map<string, number>();
let bloqueo: (() => string | null) | null = null;

// Quien decide si se puede llamar (tope de gasto, pausa general). Devuelve el motivo o null.
export function definirBloqueo(fn: () => string | null): void {
  bloqueo = fn;
}

export function estadoCupo() {
  return { limite, enUso, esperando: cola.length, pausaHasta: pausaHasta > Date.now() ? new Date(pausaHasta).toISOString() : null, motivo: bloqueo?.() ?? null };
}

export function posicionEnCola(botId: string): number {
  return ordenar().findIndex((e) => e.botId === botId);
}

function ordenar(): Espera[] {
  const t = Date.now();
  // Esperar sube la prioridad un escalón por minuto, así nadie queda afuera para siempre.
  const prioridad = (e: Espera) => PESO[e.clase] - Math.floor((t - e.desde) / 60_000);
  return [...cola].sort(
    (a, b) => prioridad(a) - prioridad(b) || (servido.get(a.botId) ?? 0) - (servido.get(b.botId) ?? 0) || a.desde - b.desde,
  );
}

let temporizador: NodeJS.Timeout | null = null;

function despachar(): void {
  if (temporizador) {
    clearTimeout(temporizador);
    temporizador = null;
  }
  for (let i = cola.length - 1; i >= 0; i--) if (cola[i]!.signal.aborted) cola.splice(i, 1);
  const espera = pausaHasta - Date.now();
  if (espera > 0) {
    temporizador = setTimeout(despachar, espera);
    return;
  }
  if (bloqueo?.()) return; // se vuelve a despachar cuando cambie (reanudar)
  while (enUso < limite && cola.length) {
    const siguiente = ordenar()[0]!;
    cola.splice(cola.indexOf(siguiente), 1);
    enUso++;
    servido.set(siguiente.botId, Date.now());
    siguiente.entrar();
  }
  emitir("cupo", estadoCupo());
}

export const reanudarCupo = despachar;

function conseguirLugar(botId: string, clase: Clase, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const espera: Espera = { botId, clase, desde: Date.now(), entrar: () => resolve(), signal };
    signal.addEventListener("abort", () => {
      const i = cola.indexOf(espera);
      if (i >= 0) {
        cola.splice(i, 1);
        reject(new Anthropic.APIUserAbortError());
      }
    }, { once: true });
    cola.push(espera);
    despachar();
  });
}

function liberar(): void {
  enUso = Math.max(0, enUso - 1);
  despachar();
}

const dormir = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Anthropic.APIUserAbortError());
    }, { once: true });
  });

function segundosRetryAfter(err: InstanceType<typeof Anthropic.APIError>): number | null {
  const valor = err.headers?.get?.("retry-after");
  const n = valor ? Number(valor) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Hace una llamada pasando por la compuerta. El lugar se ocupa solo mientras `hacer` corre;
// los reintentos por límite o sobrecarga se resuelven acá, con espera exponencial.
export async function llamar<T>(
  botId: string,
  clase: Clase,
  signal: AbortSignal,
  hacer: () => Promise<T>,
  alEsperar?: (motivo: string) => void,
): Promise<T> {
  for (let intento = 0; ; intento++) {
    if (cola.length || enUso >= limite || pausaHasta > Date.now() || bloqueo?.()) alEsperar?.(bloqueo?.() ?? "En espera de cupo de la API");
    await conseguirLugar(botId, clase, signal);
    let resultado: T;
    try {
      resultado = await hacer();
    } catch (err) {
      liberar();
      if (signal.aborted || !(err instanceof Anthropic.APIError) || intento + 1 >= MAX_INTENTOS) throw err;
      exitosSeguidos = 0;
      let esperaMs: number;
      if (err instanceof Anthropic.RateLimitError) {
        // 429: la organización llegó a su límite. Frena todo y baja el paralelismo a la mitad.
        esperaMs = (segundosRetryAfter(err) ?? Math.min(60, 2 ** intento * 2)) * 1000;
        pausaHasta = Math.max(pausaHasta, Date.now() + esperaMs);
        limite = Math.max(1, Math.floor(limite / 2));
      } else if (err.status === 529) {
        limite = Math.max(1, limite - 1);
        esperaMs = Math.min(60_000, 2 ** intento * 1000) + Math.random() * 1000;
      } else if (err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
        if (intento >= 3) throw err;
        esperaMs = Math.min(30_000, 2 ** intento * 1000) + Math.random() * 500;
      } else {
        throw err;
      }
      alEsperar?.(`La API pidió esperar: reintento en ${Math.ceil(esperaMs / 1000)} s`);
      await dormir(esperaMs, signal);
      continue;
    }
    liberar();
    if (++exitosSeguidos >= EXITOS_PARA_SUBIR && limite < ajustes().maxLlamadas) {
      limite++;
      exitosSeguidos = 0;
    }
    return resultado;
  }
}

// Cuando el usuario cambia el máximo en Ajustes.
export function ajustarLimite(maximo: number): void {
  limite = Math.max(1, maximo);
  despachar();
}
