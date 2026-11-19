/** Base de la API propia (servidor Node): ajuste del usuario, variable de build o mismo origen. */
import { settings } from "../state/store.ts";
import { isNative } from "../native.ts";

export function apiBase(): string {
  const configured = settings.value.serverUrl.trim() || ((import.meta.env.VITE_API_BASE as string | undefined) ?? "");
  return configured.replace(/\/$/, "");
}

/** En la app nativa sin servidor configurado no hay API (se usan modos locales). */
export function hasApi(): boolean {
  return !isNative || apiBase() !== "";
}

export function apiUrl(path: string): string {
  return `${apiBase()}${path}`;
}

export interface ServerStatus {
  ok: boolean;
  ai: boolean;
  model?: string;
  postgis: boolean;
  version: string;
}

let statusPromise: Promise<ServerStatus> | null = null;
let statusFor = "";

/** Estado del servidor (si hay IA configurada, base de datos, etc.). */
export function serverStatus(): Promise<ServerStatus> {
  if (statusFor !== apiBase()) {
    statusPromise = null;
    statusFor = apiBase();
  }
  if (!hasApi()) return Promise.resolve({ ok: false, ai: false, postgis: false, version: "?" });
  if (!statusPromise) {
    statusPromise = fetch(apiUrl("/api/status"))
      .then((r) => (r.ok ? (r.json() as Promise<ServerStatus>) : { ok: false, ai: false, postgis: false, version: "?" }))
      .catch(() => ({ ok: false, ai: false, postgis: false, version: "?" }));
  }
  return statusPromise;
}
