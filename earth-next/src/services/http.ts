/**
 * Cliente HTTP con tiempo de espera, reintentos con retroceso exponencial (errores de red,
 * 429 y 5xx), cancelación, deduplicación de pedidos en vuelo y caché opcional.
 * Expone además el estado de conectividad para el modo sin conexión parcial.
 */
import { signal } from "@preact/signals";
import { cacheGet, cacheSet } from "./cache.ts";

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public url: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST";
  body?: BodyInit;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  /** Clave y duración de caché (solo para respuestas exitosas) */
  cacheKey?: string;
  cacheTtlMs?: number;
  /** Si hay datos vencidos en caché y la red falla, devolverlos igual */
  staleOnError?: boolean;
}

/** Estado de red observado (false tras fallos de red consecutivos). */
export const networkOnline = signal(typeof navigator === "undefined" ? true : navigator.onLine);
/** Hosts con fallas de red recientes: se considera "sin conexión" sólo si fallan varios servicios distintos. */
const failingHosts = new Map<string, number>();

if (typeof window !== "undefined") {
  window.addEventListener("online", () => (networkOnline.value = true));
  window.addEventListener("offline", () => (networkOnline.value = false));
}

function hostOf(url: string): string {
  try {
    return new URL(url, typeof location !== "undefined" ? location.href : "http://localhost").host;
  } catch {
    return url;
  }
}

function noteSuccess(url: string) {
  failingHosts.delete(hostOf(url));
  if (!networkOnline.value && (typeof navigator === "undefined" || navigator.onLine)) networkOnline.value = true;
}

function noteFailure(url: string) {
  const now = Date.now();
  failingHosts.set(hostOf(url), now);
  for (const [h, t] of failingHosts) if (now - t > 60_000) failingHosts.delete(h);
  if (failingHosts.size >= 3) networkOnline.value = false;
}

const inflight = new Map<string, Promise<unknown>>();

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new DOMException("Abortado", "AbortError"));
      },
      { once: true },
    );
  });

async function doFetch(url: string, opts: RequestOptions): Promise<Response> {
  const retries = opts.retries ?? 2;
  let attempt = 0;
  for (;;) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(new DOMException("Tiempo de espera agotado", "TimeoutError")), opts.timeoutMs ?? 20000);
    const onAbort = () => ctrl.abort(opts.signal?.reason);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await fetch(url, { method: opts.method ?? "GET", body: opts.body, headers: opts.headers, signal: ctrl.signal });
      if (res.ok) {
        noteSuccess(url);
        return res;
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= retries) throw new HttpError(`HTTP ${res.status} en ${new URL(url, location.href).host}`, res.status, url);
      const ra = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 15000) : 600 * 2 ** attempt + Math.random() * 300, opts.signal);
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      if (err instanceof HttpError) throw err;
      noteFailure(url);
      if (attempt >= retries) throw err;
      await sleep(500 * 2 ** attempt + Math.random() * 300, opts.signal);
    } finally {
      clearTimeout(timeout);
      opts.signal?.removeEventListener("abort", onAbort);
    }
    attempt++;
  }
}

async function cached<T>(url: string, opts: RequestOptions, parse: (r: Response) => Promise<T>): Promise<T> {
  const key = opts.cacheKey;
  if (key) {
    const hit = await cacheGet<T>(key);
    if (hit !== undefined) return hit;
  }
  const dedupeKey = `${opts.method ?? "GET"} ${url} ${typeof opts.body === "string" ? opts.body : ""}`;
  const existing = !opts.signal ? (inflight.get(dedupeKey) as Promise<T> | undefined) : undefined;
  if (existing) return existing;
  const p = (async () => {
    try {
      const res = await doFetch(url, opts);
      const data = await parse(res);
      if (key) void cacheSet(key, data, opts.cacheTtlMs ?? 3600_000);
      return data;
    } catch (err) {
      if (key && opts.staleOnError) {
        const stale = await cacheGet<T>(`stale:${key}`);
        if (stale !== undefined) return stale;
      }
      throw err;
    }
  })();
  if (!opts.signal) {
    inflight.set(dedupeKey, p);
    p.finally(() => inflight.delete(dedupeKey)).catch(() => {});
  }
  const data = await p;
  if (key && opts.staleOnError) void cacheSet(`stale:${key}`, data, 30 * 86400_000);
  return data;
}

export function getJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  return cached(url, { ...opts, headers: { Accept: "application/json", ...opts.headers } }, (r) => r.json() as Promise<T>);
}

export function getText(url: string, opts: RequestOptions = {}): Promise<string> {
  return cached(url, opts, (r) => r.text());
}

export function getArrayBuffer(url: string, opts: RequestOptions = {}): Promise<ArrayBuffer> {
  return cached(url, opts, (r) => r.arrayBuffer());
}

/** Limita la concurrencia y el ritmo de llamadas a un servicio (p. ej. 1 req/s para Nominatim). */
export class RateLimiter {
  private queue: (() => void)[] = [];
  private active = 0;
  private last = 0;
  constructor(
    private concurrency: number,
    private minIntervalMs: number,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.pump();
    });
    try {
      return await fn();
    } finally {
      this.active--;
      this.pump();
    }
  }

  private pump() {
    if (this.active >= this.concurrency || this.queue.length === 0) return;
    const wait = Math.max(0, this.last + this.minIntervalMs - Date.now());
    if (wait > 0) {
      setTimeout(() => this.pump(), wait);
      return;
    }
    const next = this.queue.shift()!;
    this.active++;
    this.last = Date.now();
    next();
    this.pump();
  }

  get pending(): number {
    return this.queue.length + this.active;
  }
}
