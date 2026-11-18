/**
 * Gestor de capas de imágenes: base única, superposiciones ordenadas, capas temporales,
 * capas nocturnas, comparación en pantalla dividida y control de errores por capa.
 */
import {
  Credit,
  ImageryLayer,
  IonImageryProvider,
  SplitDirection,
  UrlTemplateImageryProvider,
  WebMercatorTilingScheme,
  type ImageryProvider,
  type Viewer,
} from "cesium";
import { signal } from "@preact/signals";
import { LAYERS, clampLayerDate, formatLayerTime, layerById, type LayerDef } from "./catalog.ts";
import { notify, settings } from "../state/store.ts";

export interface ActiveLayer {
  id: string;
  opacity: number;
  date?: string;
  split?: "left" | "right" | "none";
  errors: number;
}

export interface WaybackRelease {
  id: number;
  date: string;
  title: string;
}

export const activeBase = signal<string>("esri-imagery");
export const activeOverlays = signal<ActiveLayer[]>([]);
export const splitEnabled = signal(false);
export const splitPosition = signal(0.5);
/** Capa usada a la izquierda del divisor en modo comparación */
export const compareLayer = signal<{ id: string; date?: string } | null>(null);

interface Entry {
  def: LayerDef;
  layer: ImageryLayer;
  date?: string;
}

export class ImageryManager {
  private base: Entry | null = null;
  private overlays = new Map<string, Entry>();
  private compare: Entry | null = null;
  private dynamicDefs = new Map<string, LayerDef>();

  constructor(private viewer: Viewer) {}

  private provider(def: LayerDef, date?: string): ImageryProvider {
    if (def.requires === "ion") throw new Error("Capa que requiere Cesium ion: usar addIonBase");
    const url = date ? def.url.replace("{time}", date) : def.url.replace("{time}/", "");
    const p = new UrlTemplateImageryProvider({
      url,
      maximumLevel: def.maxLevel,
      minimumLevel: def.minLevel ?? 0,
      tilingScheme: new WebMercatorTilingScheme(),
      credit: new Credit(`${def.attribution}${date ? ` (${date})` : ""}`, true),
      subdomains: def.subdomains,
      enablePickFeatures: false,
    });
    return p;
  }

  definition(id: string): LayerDef | undefined {
    return this.dynamicDefs.get(id) ?? layerById(id);
  }

  allDefinitions(): LayerDef[] {
    return [...LAYERS, ...this.dynamicDefs.values()];
  }

  /** Registra una capa dinámica (p. ej. una versión de Esri Wayback). */
  register(def: LayerDef): void {
    this.dynamicDefs.set(def.id, def);
  }

  private defaultDate(def: LayerDef): string | undefined {
    if (!def.time) return undefined;
    if (def.time.default) return def.time.default;
    const d = clampLayerDate(def, new Date(Date.now() - (def.time.latencyDays ?? 1) * 86400000));
    return formatLayerTime(def, d);
  }

  private watchErrors(entry: Entry) {
    let errors = 0;
    let warned = false;
    entry.layer.imageryProvider?.errorEvent?.addEventListener(() => {
      errors++;
      if (errors >= 12 && !warned) {
        warned = true;
        notify(`La capa "${settings.value.lang === "es" ? entry.def.name : entry.def.nameEn}" no responde o no tiene datos para esta zona/fecha.`, "warning");
      }
      const ov = activeOverlays.value.find((o) => o.id === entry.def.id);
      if (ov) ov.errors = errors;
    });
  }

  private makeLayer(def: LayerDef, date?: string, opacity?: number): Entry {
    const layer = new ImageryLayer(this.provider(def, date), { alpha: opacity ?? def.opacity ?? 1 });
    if (def.nightOnly) {
      layer.dayAlpha = 0;
      layer.nightAlpha = opacity ?? 1;
    }
    const entry = { def, layer, date };
    this.watchErrors(entry);
    return entry;
  }

  setBase(id: string, date?: string): void {
    const def = this.definition(id);
    if (!def) return;
    const layers = this.viewer.imageryLayers;
    if (this.base) layers.remove(this.base.layer, true);
    const d = date ?? this.defaultDate(def);
    this.base = this.makeLayer(def, d, 1);
    layers.add(this.base.layer, 0);
    activeBase.value = id;
    this.applySplit();
  }

  /** Base desde Cesium ion (p. ej. Bing Maps, asset 2) — requiere token del usuario. */
  async setIonBase(assetId: number, id = `ion-${assetId}`): Promise<void> {
    const provider = await IonImageryProvider.fromAssetId(assetId);
    const layers = this.viewer.imageryLayers;
    if (this.base) layers.remove(this.base.layer, true);
    const def: LayerDef = {
      id,
      name: "Imágenes Cesium ion",
      nameEn: "Cesium ion imagery",
      category: "base",
      nature: "composite",
      url: "",
      maxLevel: 21,
      attribution: "Cesium ion",
      license: "Términos de Cesium ion",
      description: "Imágenes servidas por Cesium ion con el token del usuario.",
    };
    const layer = new ImageryLayer(provider, {});
    this.base = { def, layer };
    layers.add(layer, 0);
    activeBase.value = id;
  }

  isOverlayActive(id: string): boolean {
    return this.overlays.has(id);
  }

  addOverlay(id: string, opts: { opacity?: number; date?: string } = {}): void {
    const def = this.definition(id);
    if (!def || this.overlays.has(id)) return;
    const date = opts.date ?? this.defaultDate(def);
    const entry = this.makeLayer(def, date, opts.opacity);
    this.viewer.imageryLayers.add(entry.layer);
    this.overlays.set(id, entry);
    // Las capas nocturnas siempre quedan por encima del resto.
    for (const e of this.overlays.values()) if (e.def.nightOnly) this.viewer.imageryLayers.raiseToTop(e.layer);
    activeOverlays.value = [...activeOverlays.value, { id, opacity: entry.layer.alpha, date, errors: 0 }];
  }

  removeOverlay(id: string): void {
    const e = this.overlays.get(id);
    if (!e) return;
    this.viewer.imageryLayers.remove(e.layer, true);
    this.overlays.delete(id);
    activeOverlays.value = activeOverlays.value.filter((o) => o.id !== id);
  }

  toggleOverlay(id: string, on?: boolean): void {
    const active = this.overlays.has(id);
    if (on ?? !active) this.addOverlay(id);
    else this.removeOverlay(id);
  }

  setOpacity(id: string, alpha: number): void {
    const e = this.overlays.get(id) ?? (this.base?.def.id === id ? this.base : undefined);
    if (!e) return;
    if (e.def.nightOnly) e.layer.nightAlpha = alpha;
    else e.layer.alpha = alpha;
    activeOverlays.value = activeOverlays.value.map((o) => (o.id === id ? { ...o, opacity: alpha } : o));
  }

  /** Cambia la fecha de una capa temporal (recrea el proveedor para no mezclar teselas de distintas fechas). */
  setDate(id: string, date: Date): string | undefined {
    const def = this.definition(id);
    if (!def?.time) return undefined;
    const str = formatLayerTime(def, clampLayerDate(def, date));
    if (this.base?.def.id === id) {
      if (this.base.date !== str) this.setBase(id, str);
      return str;
    }
    const e = this.overlays.get(id);
    if (e && e.date !== str) {
      const idx = this.viewer.imageryLayers.indexOf(e.layer);
      const alpha = e.def.nightOnly ? e.layer.nightAlpha : e.layer.alpha;
      this.viewer.imageryLayers.remove(e.layer, true);
      const next = this.makeLayer(def, str, alpha);
      this.viewer.imageryLayers.add(next.layer, idx);
      this.overlays.set(id, next);
      activeOverlays.value = activeOverlays.value.map((o) => (o.id === id ? { ...o, date: str } : o));
      this.applySplit();
    }
    if (this.compare?.def.id === id && this.compare.date !== str) this.setCompare(id, date);
    return str;
  }

  /** Comparación: muestra `id` (en la fecha dada) a la izquierda del divisor y la vista actual a la derecha. */
  setCompare(id: string | null, date?: Date): void {
    const layers = this.viewer.imageryLayers;
    if (this.compare) {
      layers.remove(this.compare.layer, true);
      this.compare = null;
    }
    if (!id) {
      compareLayer.value = null;
      splitEnabled.value = false;
      this.applySplit();
      return;
    }
    const def = this.definition(id);
    if (!def) return;
    const d = def.time ? formatLayerTime(def, clampLayerDate(def, date ?? new Date())) : undefined;
    this.compare = this.makeLayer(def, d, 1);
    // Justo encima de la base: las superposiciones siguen visibles en ambos lados.
    layers.add(this.compare.layer, this.base ? layers.indexOf(this.base.layer) + 1 : 0);
    compareLayer.value = { id, date: d };
    splitEnabled.value = true;
    this.applySplit();
  }

  setSplitPosition(x: number): void {
    splitPosition.value = Math.min(0.98, Math.max(0.02, x));
    this.viewer.scene.splitPosition = splitPosition.value;
  }

  private applySplit(): void {
    const on = splitEnabled.value && !!this.compare;
    if (this.compare) this.compare.layer.splitDirection = on ? SplitDirection.LEFT : SplitDirection.NONE;
    if (this.base) this.base.layer.splitDirection = on ? SplitDirection.RIGHT : SplitDirection.NONE;
    this.viewer.scene.splitPosition = splitPosition.value;
  }

  /**
   * Las capas nocturnas (Black Marble, ~500 m/píxel) se desvanecen al acercarse:
   * en modo "auto" desaparecen bajo ~1500 km (donde la iluminación se atenúa);
   * en modo "realista" quedan como resplandor tenue sobre la ciudad oscura.
   */
  updateNightFade(cameraHeight: number, realistic: boolean): void {
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const f = realistic ? 0.35 + 0.65 * smooth(3e4, 3e5, cameraHeight) : smooth(1.5e6, 6e6, cameraHeight);
    const lit = this.viewer.scene.globe.enableLighting;
    for (const e of this.overlays.values()) {
      if (!e.def.nightOnly) continue;
      // Sin iluminación Cesium ignora nightAlpha y dibujaría la capa opaca: se oculta.
      const visible = lit && f > 0.01;
      if (e.layer.show !== visible) e.layer.show = visible;
      const target = (activeOverlays.value.find((o) => o.id === e.def.id)?.opacity ?? 1) * f;
      if (Math.abs(e.layer.nightAlpha - target) > 0.01) e.layer.nightAlpha = target;
    }
  }

  baseDefinition(): LayerDef | null {
    return this.base?.def ?? null;
  }

  baseDate(): string | undefined {
    return this.base?.date;
  }

  /** Atribuciones de todas las capas visibles (para capturas y la barra de estado). */
  attributions(): string[] {
    const out = new Set<string>();
    if (this.base) out.add(this.base.def.attribution);
    if (this.compare) out.add(this.compare.def.attribution);
    for (const e of this.overlays.values()) out.add(e.def.attribution);
    return [...out];
  }

  snapshot(): { base: string; baseDate?: string; overlays: ActiveLayer[] } {
    return { base: activeBase.value, baseDate: this.base?.date, overlays: activeOverlays.value };
  }

  restore(s: { base: string; baseDate?: string; overlays: ActiveLayer[] }): void {
    for (const id of [...this.overlays.keys()]) this.removeOverlay(id);
    this.setBase(s.base, s.baseDate);
    for (const o of s.overlays) this.addOverlay(o.id, { opacity: o.opacity, date: o.date });
  }
}
