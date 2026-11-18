/**
 * Caché persistente (IndexedDB) con expiración + caché en memoria LRU.
 * Si IndexedDB no está disponible (modo privado, tests), funciona solo en memoria.
 */

const DB_NAME = "earth-next-cache";
const STORE = "kv";
const DB_VERSION = 1;

interface Entry<T> {
  key: string;
  value: T;
  expires: number;
  size: number;
}

export class LruCache<T> {
  private map = new Map<string, { value: T; size: number }>();
  private total = 0;
  constructor(
    private maxEntries: number,
    private maxSize = Infinity,
    private onEvict?: (key: string, value: T) => void,
  ) {}

  get(key: string): T | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: T, size = 1): void {
    const prev = this.map.get(key);
    if (prev) {
      this.total -= prev.size;
      this.map.delete(key);
    }
    this.map.set(key, { value, size });
    this.total += size;
    while (this.map.size > this.maxEntries || this.total > this.maxSize) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const ev = this.map.get(oldest)!;
      this.map.delete(oldest);
      this.total -= ev.size;
      this.onEvict?.(oldest, ev.value);
    }
  }

  delete(key: string): void {
    const e = this.map.get(key);
    if (e) {
      this.total -= e.size;
      this.map.delete(key);
      this.onEvict?.(key, e.value);
    }
  }

  keys(): string[] {
    return [...this.map.keys()];
  }

  get size(): number {
    return this.map.size;
  }

  get weight(): number {
    return this.total;
  }

  clear(): void {
    for (const [k, e] of this.map) this.onEvict?.(k, e.value);
    this.map.clear();
    this.total = 0;
  }
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: "key" });
          s.createIndex("expires", "expires");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

const memory = new LruCache<{ value: unknown; expires: number }>(400, 64 * 1024 * 1024);

function approxSize(v: unknown): number {
  if (typeof v === "string") return v.length * 2;
  if (v instanceof ArrayBuffer) return v.byteLength;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  try {
    return JSON.stringify(v).length * 2;
  } catch {
    return 1024;
  }
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const m = memory.get(key);
  const now = Date.now();
  if (m && m.expires > now) return m.value as T;
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const e = req.result as Entry<T> | undefined;
        if (e && e.expires > now) {
          memory.set(key, { value: e.value, expires: e.expires }, e.size);
          resolve(e.value);
        } else resolve(undefined);
      };
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function cacheSet<T>(key: string, value: T, ttlMs: number, persist = true): Promise<void> {
  const expires = Date.now() + ttlMs;
  const size = approxSize(value);
  memory.set(key, { value, expires }, size);
  if (!persist) return;
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ key, value, expires, size } satisfies Entry<T>);
  } catch {
    /* cuota excedida u otro error: se ignora, la caché es opcional */
  }
}

/** Elimina entradas vencidas (se llama al iniciar). */
export async function cachePrune(): Promise<number> {
  const db = await openDb();
  if (!db) return 0;
  return new Promise((resolve) => {
    let removed = 0;
    try {
      const tx = db.transaction(STORE, "readwrite");
      const idx = tx.objectStore(STORE).index("expires");
      const req = idx.openCursor(IDBKeyRange.upperBound(Date.now()));
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) {
          cur.delete();
          removed++;
          cur.continue();
        } else resolve(removed);
      };
      req.onerror = () => resolve(removed);
    } catch {
      resolve(0);
    }
  });
}

export async function cacheClear(): Promise<void> {
  memory.clear();
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).clear();
  } catch {
    /* noop */
  }
}

export async function cacheStats(): Promise<{ entries: number; memoryEntries: number; memoryBytes: number }> {
  const db = await openDb();
  const entries = await new Promise<number>((resolve) => {
    if (!db) return resolve(0);
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
  return { entries, memoryEntries: memory.size, memoryBytes: memory.weight };
}
