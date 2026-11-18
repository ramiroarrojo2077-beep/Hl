/** Base de la API propia (servidor Node). Configurable para despliegues separados. */
const BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? "").replace(/\/$/, "");

export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

export interface ServerStatus {
  ok: boolean;
  ai: boolean;
  model?: string;
  postgis: boolean;
  version: string;
}

let statusPromise: Promise<ServerStatus> | null = null;

/** Estado del servidor (si hay IA configurada, base de datos, etc.). */
export function serverStatus(): Promise<ServerStatus> {
  if (!statusPromise) {
    statusPromise = fetch(apiUrl("/api/status"))
      .then((r) => (r.ok ? (r.json() as Promise<ServerStatus>) : { ok: false, ai: false, postgis: false, version: "?" }))
      .catch(() => ({ ok: false, ai: false, postgis: false, version: "?" }));
  }
  return statusPromise;
}
