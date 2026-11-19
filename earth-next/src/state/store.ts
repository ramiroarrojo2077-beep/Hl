/**
 * Estado global de la aplicación (señales reactivas de Preact).
 * La configuración del usuario persiste en localStorage.
 */
import { signal, effect, computed, type Signal } from "@preact/signals";
import type { LodInfo } from "../geo/lod.ts";

export type Theme = "dark" | "light" | "auto";
export type Lang = "es" | "en";
export type Quality = "auto" | "low" | "medium" | "high" | "ultra";
export type TerrainSource = "terrarium" | "ion" | "ellipsoid";
export type BuildingSource = "osm" | "ion-osm" | "google" | "off";
export type NavMode = "orbital" | "aerial" | "pedestrian" | "drone" | "satellite" | "cinematic";

export interface Settings {
  theme: Theme;
  lang: Lang;
  units: "metric" | "imperial";
  quality: Quality;
  targetFps: number;
  fov: number;
  navSpeed: number;
  sensitivity: number;
  pedestrianEyeHeight: number;
  showFps: boolean;
  terrain: TerrainSource;
  terrainExaggeration: number;
  bathymetry: boolean;
  buildings: BuildingSource;
  buildingColorMode: "realistic" | "quality" | "height" | "neutral";
  urbanDetails: boolean;
  ionToken: string;
  googleKey: string;
  mapillaryToken: string;
  overpassUrl: string;
  reducedMotion: boolean;
  highContrast: boolean;
  largeText: boolean;
  minimap: boolean;
  narrator: boolean;
  atmosphere: boolean;
  clouds: boolean;
  shadows: boolean;
  nightLights: boolean;
  stars: boolean;
  /** "auto": iluminación solar realista desde el espacio y luz diurna de cerca; "realistic": día/noche también a nivel del suelo */
  lightingMode: "auto" | "realistic";
  aiEnabled: boolean;
  /** URL del servidor de EARTH NEXT (IA, METAR, PostGIS). Vacío = mismo origen (web) */
  serverUrl: string;
}

const defaults: Settings = {
  theme: "dark",
  lang: "es",
  units: "metric",
  quality: "auto",
  targetFps: 60,
  fov: 60,
  navSpeed: 1,
  sensitivity: 1,
  pedestrianEyeHeight: 1.7,
  showFps: false,
  terrain: "terrarium",
  terrainExaggeration: 1,
  bathymetry: false,
  buildings: "osm",
  buildingColorMode: "realistic",
  urbanDetails: true,
  ionToken: "",
  googleKey: "",
  mapillaryToken: "",
  overpassUrl: "https://overpass-api.de/api/interpreter",
  reducedMotion: false,
  highContrast: false,
  largeText: false,
  minimap: true,
  narrator: true,
  atmosphere: true,
  clouds: true,
  shadows: true,
  nightLights: true,
  stars: true,
  lightingMode: "auto",
  aiEnabled: true,
  serverUrl: "",
};

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (fallback && typeof fallback === "object" && !Array.isArray(fallback) && parsed && typeof parsed === "object") {
      return { ...fallback, ...(parsed as object) } as T;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

/** Señal persistida en localStorage (con fusión de valores por defecto). */
export function persisted<T>(key: string, fallback: T): Signal<T> {
  const s = signal<T>(readStorage(`earth-next:${key}`, fallback));
  effect(() => {
    try {
      localStorage.setItem(`earth-next:${key}`, JSON.stringify(s.value));
    } catch {
      /* almacenamiento lleno o bloqueado */
    }
  });
  return s;
}

function initialSettings(): Settings {
  const s = readStorage<Settings>("earth-next:settings", defaults);
  const env = import.meta.env;
  // Las claves configuradas en el entorno de compilación se usan si el usuario no cargó otras.
  if (!s.ionToken && env.VITE_CESIUM_ION_TOKEN) s.ionToken = env.VITE_CESIUM_ION_TOKEN;
  if (!s.googleKey && env.VITE_GOOGLE_MAPS_KEY) s.googleKey = env.VITE_GOOGLE_MAPS_KEY;
  if (!s.mapillaryToken && env.VITE_MAPILLARY_TOKEN) s.mapillaryToken = env.VITE_MAPILLARY_TOKEN;
  if (typeof navigator !== "undefined" && !localStorage.getItem("earth-next:settings")) {
    if (!navigator.language.toLowerCase().startsWith("es")) s.lang = "en";
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) s.reducedMotion = true;
  }
  return s;
}

export const settings = signal<Settings>(initialSettings());
effect(() => {
  try {
    localStorage.setItem("earth-next:settings", JSON.stringify(settings.value));
  } catch {
    /* noop */
  }
});

export function updateSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch };
}

export function resetSettings(): void {
  settings.value = { ...defaults, lang: settings.value.lang };
}

// ---------------------------------------------------------------------------
// Estado de interfaz
// ---------------------------------------------------------------------------

export type PanelId = "layers" | "tools" | "places" | "weather" | "history" | "lighting" | "tours" | "street" | "settings" | "explore";

export const activePanel = signal<PanelId | null>(null);
export const assistantOpen = signal(false);
export const infoOpen = signal(false);

export interface CameraState {
  lon: number;
  lat: number;
  height: number;
  heightAboveGround: number;
  heading: number;
  pitch: number;
  roll: number;
}

export const cameraState = signal<CameraState>({ lon: 0, lat: 0, height: 2e7, heightAboveGround: 2e7, heading: 0, pitch: -90, roll: 0 });
export const lod = signal<LodInfo>({ level: 0, key: "space" });
export const cursorPosition = signal<{ lon: number; lat: number; height: number | null } | null>(null);
export const navMode = signal<NavMode>("orbital");
export const fps = signal(0);
export const effectiveQuality = signal<Exclude<Quality, "auto">>("high");
export const loadingTiles = signal(0);
export const sceneTime = signal<Date>(new Date());
export const timeMultiplier = signal(1);
export const timePlaying = signal(false);

export interface InfoItem {
  label: string;
  value: string;
  href?: string;
}

export interface Selection {
  kind: "place" | "building" | "feature" | "point" | "weather" | "panorama" | "marker";
  title: string;
  subtitle?: string;
  lon: number;
  lat: number;
  height?: number;
  items: InfoItem[];
  /** Fuentes de datos (atribución obligatoria) */
  sources: { name: string; url?: string; license?: string }[];
  /** Advertencias de calidad (p. ej. altura estimada, geometría aproximada) */
  notices?: string[];
  description?: string;
  image?: string;
  wikipedia?: string;
  osm?: { type: string; id: number };
}

export const selection = signal<Selection | null>(null);

export interface Toast {
  id: number;
  kind: "info" | "success" | "warning" | "error";
  message: string;
}

export const toasts = signal<Toast[]>([]);
let toastId = 0;

export function notify(message: string, kind: Toast["kind"] = "info", ms = 4500): void {
  const id = ++toastId;
  toasts.value = [...toasts.value.slice(-3), { id, kind, message }];
  setTimeout(() => (toasts.value = toasts.value.filter((t) => t.id !== id)), ms);
}

export const isMobile = signal(typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches);
if (typeof window !== "undefined") {
  window.matchMedia("(max-width: 760px)").addEventListener("change", (e) => (isMobile.value = e.matches));
}

export const resolvedTheme = computed<"dark" | "light">(() => {
  const t = settings.value.theme;
  if (t !== "auto") return t;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
});
