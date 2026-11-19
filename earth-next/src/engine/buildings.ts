/**
 * Edificios 3D:
 *  - "osm": streaming por teselas z15 de huellas OSM (Overpass) extruidas con su altura real
 *    cuando existe; se colorean/rotulan según la calidad del dato y se descargan por LRU.
 *  - "ion-osm": Cesium OSM Buildings (3D Tiles, requiere token de Cesium ion).
 *  - "google": Google Photorealistic 3D Tiles (requiere clave de Google Map Tiles API).
 */
import {
  Cartesian3,
  Cesium3DTileset,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
  ShadowMode,
  createGooglePhotorealistic3DTileset,
  createOsmBuildingsAsync,
  Cesium3DTileStyle,
  type Viewer,
} from "cesium";
import { signal } from "@preact/signals";
import type { LonLat } from "../geo/coords.ts";
import type { BuildingFeature, HeightQuality } from "../geo/osm-buildings.ts";
import { tileKey, tilesAround, type TileXYZ } from "../geo/tiles.ts";
import { BUILDINGS_MAX_HEIGHT, buildingLoadRadius } from "../geo/lod.ts";
import { LruCache } from "../services/cache.ts";
import { buildingsForTile } from "../services/overpass.ts";
import { elevationsAt } from "../services/elevation.ts";
import { notify, settings, type BuildingSource } from "../state/store.ts";

const ZOOM = 15;
const MAX_TILES = 40;

export interface BuildingStatus {
  source: BuildingSource;
  tilesLoaded: number;
  tilesLoading: number;
  buildings: number;
  measured: number;
  levels: number;
  defaults: number;
  error: string | null;
  active: boolean;
}

export const buildingStatus = signal<BuildingStatus>({
  source: "osm",
  tilesLoaded: 0,
  tilesLoading: 0,
  buildings: 0,
  measured: 0,
  levels: 0,
  defaults: 0,
  error: null,
  active: false,
});

interface TileEntry {
  key: string;
  primitives: Primitive[];
  features: Map<string, BuildingFeature & { base: number }>;
}

export const QUALITY_COLORS: Record<HeightQuality, string> = {
  measured: "#f1ece2",
  levels: "#c9d3df",
  default: "#8a96a8",
};

/** Interpreta colores OSM ("white", "#c0a080", "brick"…) o devuelve null. */
export function parseOsmColor(raw: string | undefined): Color | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase().split(";")[0]!.replace(/_/g, "");
  const aliases: Record<string, string> = { brick: "#a0522d", cream: "#f3e9d2", beige: "#e8dcc0", sand: "#d8c39a", terracotta: "#c4643f", concrete: "#b8b6b0", lightgrey: "#d3d3d3", darkgrey: "#7a7a7a" };
  try {
    const c = Color.fromCssColorString(aliases[v] ?? v);
    return c ?? null;
  } catch {
    return null;
  }
}

const TYPE_COLORS: [RegExp, string][] = [
  [/^(house|detached|semidetached_house|terrace|residential|apartments|bungalow|villa|dormitory)$/, "#e9dfcf"],
  [/^(commercial|office|retail|supermarket|kiosk|hotel)$/, "#d6dce4"],
  [/^(industrial|warehouse|factory|manufacture|storage_tank|hangar|garage|garages|shed)$/, "#cbc8c1"],
  [/^(church|cathedral|chapel|mosque|temple|synagogue|shrine)$/, "#eadbc2"],
  [/^(school|university|college|hospital|civic|public|government|train_station|transportation)$/, "#e3d5c5"],
  [/^(stadium|sports_hall|grandstand)$/, "#d9dde0"],
];

/** Color "realista": el registrado en OSM (building:colour) o una paleta suave por tipo. */
function realisticColor(f: BuildingFeature): Color {
  const tagged = parseOsmColor(f.tags["building:colour"]);
  if (tagged) return tagged;
  const hex = TYPE_COLORS.find(([re]) => re.test(f.kind))?.[1] ?? "#ece7df";
  const c = Color.fromCssColorString(hex);
  // Variación sutil y estable por edificio para evitar un aspecto plástico uniforme.
  let hsh = 0;
  for (let i = 0; i < f.id.length; i++) hsh = (hsh * 31 + f.id.charCodeAt(i)) | 0;
  const k = 1 + ((hsh % 9) - 4) * 0.012;
  return new Color(Math.min(1, c.red * k), Math.min(1, c.green * k), Math.min(1, c.blue * k), 1);
}

function heightColor(h: number): Color {
  // Rampa de color por altura (azul → amarillo → rojo)
  const t = Math.min(1, Math.log10(Math.max(3, h)) / Math.log10(300));
  return Color.fromHsl(0.62 - 0.62 * t, 0.6, 0.62, 1);
}

export class BuildingsManager {
  private tiles: LruCache<TileEntry>;
  private loading = new Map<string, AbortController>();
  private tileset: Cesium3DTileset | null = null;
  private source: BuildingSource = "off";
  private lastCenter: LonLat | null = null;
  private lastHeight = Infinity;
  private failures = 0;
  private globeWasShown = true;

  constructor(private viewer: Viewer) {
    this.tiles = new LruCache<TileEntry>(MAX_TILES, Infinity, (_k, e) => this.disposeTile(e));
  }

  private disposeTile(e: TileEntry) {
    for (const p of e.primitives) this.viewer.scene.primitives.remove(p);
  }

  async setSource(source: BuildingSource): Promise<void> {
    if (source === this.source) return;
    this.clear();
    this.source = source;
    buildingStatus.value = { ...buildingStatus.value, source, error: null };
    try {
      if (source === "ion-osm") {
        if (!settings.value.ionToken) throw new Error("Cesium OSM Buildings requiere un token de Cesium ion (Ajustes → Claves).");
        this.tileset = await createOsmBuildingsAsync();
        this.tileset.style = new Cesium3DTileStyle({ color: "color('#f1ece2')" });
        this.viewer.scene.primitives.add(this.tileset);
      } else if (source === "google") {
        if (!settings.value.googleKey) throw new Error("Google Photorealistic 3D Tiles requiere una clave de Google Map Tiles API (Ajustes → Claves).");
        this.tileset = await createGooglePhotorealistic3DTileset({ key: settings.value.googleKey, onlyUsingWithGoogleGeocoder: false } as never);
        this.viewer.scene.primitives.add(this.tileset);
        // Los tiles fotorrealistas incluyen su propio terreno: se oculta el globo para evitar superposición.
        this.globeWasShown = this.viewer.scene.globe.show;
        this.viewer.scene.globe.show = false;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      buildingStatus.value = { ...buildingStatus.value, error: msg };
      notify(msg, "warning", 8000);
      this.source = "off";
    }
  }

  clear(): void {
    for (const c of this.loading.values()) c.abort();
    this.loading.clear();
    this.tiles.clear();
    if (this.tileset) {
      this.viewer.scene.primitives.remove(this.tileset);
      this.tileset = null;
      if (this.source === "google") this.viewer.scene.globe.show = this.globeWasShown;
    }
    this.updateStatus();
  }

  /** Llamado cuando la cámara se mueve: carga/descarga teselas de edificios OSM. */
  update(center: LonLat, cameraHeightAboveGround: number): void {
    if (this.source !== "osm") return;
    const active = cameraHeightAboveGround < BUILDINGS_MAX_HEIGHT;
    if (!active) {
      for (const c of this.loading.values()) c.abort();
      this.loading.clear();
      if (buildingStatus.value.active) buildingStatus.value = { ...buildingStatus.value, active: false };
      // Al alejarse se ocultan pero se conservan en caché (LRU)
      this.setVisible(false);
      return;
    }
    this.setVisible(true);
    this.lastCenter = center;
    this.lastHeight = cameraHeightAboveGround;
    const wanted = tilesAround(center, buildingLoadRadius(cameraHeightAboveGround), ZOOM, 12);
    const wantedKeys = new Set(wanted.map(tileKey));
    // Cancela cargas que ya no hacen falta
    for (const [k, c] of this.loading) {
      if (!wantedKeys.has(k)) {
        c.abort();
        this.loading.delete(k);
      }
    }
    for (const t of wanted) {
      const k = tileKey(t);
      if (this.tiles.has(k)) {
        this.tiles.get(k); // marca como usado
        continue;
      }
      if (!this.loading.has(k) && this.loading.size < 3) void this.loadTile(t);
    }
    this.updateStatus(true);
  }

  private setVisible(v: boolean) {
    for (const k of this.tiles.keys()) {
      const e = this.tiles.get(k);
      e?.primitives.forEach((p) => (p.show = v));
    }
  }

  private async loadTile(t: TileXYZ): Promise<void> {
    const key = tileKey(t);
    const ctrl = new AbortController();
    this.loading.set(key, ctrl);
    this.updateStatus(true);
    try {
      const features = await buildingsForTile(t, ctrl.signal);
      if (ctrl.signal.aborted) return;
      const withBase = await this.groundHeights(features, ctrl.signal);
      if (ctrl.signal.aborted || this.source !== "osm") return;
      const entry = this.buildPrimitives(key, withBase);
      this.tiles.set(key, entry, 1);
      this.failures = 0;
      buildingStatus.value = { ...buildingStatus.value, error: null };
    } catch (err) {
      if (ctrl.signal.aborted) return;
      this.failures++;
      const msg = err instanceof Error ? err.message : String(err);
      buildingStatus.value = { ...buildingStatus.value, error: msg };
      if (this.failures === 3) notify("No se pudieron descargar edificios de OpenStreetMap (Overpass). Se reintentará al mover la cámara.", "warning", 7000);
    } finally {
      this.loading.delete(key);
      this.updateStatus(true);
      // Continúa con las teselas pendientes
      if (this.lastCenter && !ctrl.signal.aborted) queueMicrotask(() => this.lastCenter && this.update(this.lastCenter, this.lastHeight));
    }
  }

  /** Altura del terreno bajo cada edificio: mínimo de los vértices (para no flotar en pendientes). */
  private async groundHeights(features: BuildingFeature[], signal: AbortSignal): Promise<(BuildingFeature & { base: number })[]> {
    if (settings.value.terrain === "ellipsoid") return features.map((f) => ({ ...f, base: 0 }));
    const pts: LonLat[] = [];
    const ranges: [number, number][] = [];
    for (const f of features) {
      const start = pts.length;
      // Muestreo de hasta 8 vértices por edificio
      const step = Math.max(1, Math.floor(f.outer.length / 8));
      for (let i = 0; i < f.outer.length; i += step) pts.push(f.outer[i]!);
      ranges.push([start, pts.length]);
    }
    const h = await elevationsAt(pts, 15, signal);
    const ex = settings.value.terrainExaggeration;
    return features.map((f, i) => {
      const [a, b] = ranges[i]!;
      let min = Infinity;
      for (let j = a; j < b; j++) min = Math.min(min, h[j]!);
      const ground = Number.isFinite(min) ? Math.max(settings.value.bathymetry ? -Infinity : 0, min) : 0;
      return { ...f, base: ground * ex };
    });
  }

  private colorFor(f: BuildingFeature): Color {
    const mode = settings.value.buildingColorMode;
    if (mode === "height") return heightColor(f.height);
    if (mode === "neutral") return Color.fromCssColorString("#e8e4dc");
    if (mode === "realistic") {
      const c = realisticColor(f);
      // Las alturas sin dato siguen marcándose: levemente translúcidas.
      if (f.quality === "default") c.alpha = 0.72;
      return c;
    }
    const c = Color.fromCssColorString(QUALITY_COLORS[f.quality]);
    if (f.quality === "default") c.alpha = 0.62;
    return c;
  }

  private buildPrimitives(key: string, features: (BuildingFeature & { base: number })[]): TileEntry {
    const solid: GeometryInstance[] = [];
    const translucent: GeometryInstance[] = [];
    const map = new Map<string, BuildingFeature & { base: number }>();
    for (const f of features) {
      const ring = Cartesian3.fromDegreesArray(f.outer.flatMap((p) => [p.lon, p.lat]));
      const holes = f.holes.map((h) => new PolygonHierarchy(Cartesian3.fromDegreesArray(h.flatMap((p) => [p.lon, p.lat]))));
      const bottom = f.base + (f.minHeight > 0 ? f.minHeight : -1.5);
      const top = f.base + f.height;
      if (top - bottom < 0.5) continue;
      const color = this.colorFor(f);
      const inst = new GeometryInstance({
        id: `bld:${f.id}`,
        geometry: new PolygonGeometry({
          polygonHierarchy: new PolygonHierarchy(ring, holes),
          height: bottom,
          extrudedHeight: top,
          vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
          closeTop: true,
          closeBottom: false,
        }),
        attributes: { color: ColorGeometryInstanceAttribute.fromColor(color) },
      });
      (color.alpha < 1 ? translucent : solid).push(inst);
      // Techo con su color registrado en OSM (roof:colour), como tapa fina sobre el volumen.
      const roof = f.tags["roof:colour"] && settings.value.buildingColorMode === "realistic" ? parseOsmColor(f.tags["roof:colour"]) : null;
      if (roof && color.alpha === 1) {
        solid.push(
          new GeometryInstance({
            id: `bld:${f.id}`,
            geometry: new PolygonGeometry({
              polygonHierarchy: new PolygonHierarchy(ring, holes),
              height: top + 0.05,
              extrudedHeight: top + 0.25,
              vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
            }),
            attributes: { color: ColorGeometryInstanceAttribute.fromColor(roof) },
          }),
        );
      }
      map.set(`bld:${f.id}`, f);
    }
    const primitives: Primitive[] = [];
    const make = (instances: GeometryInstance[], translucentFlag: boolean) => {
      if (!instances.length) return;
      const p = new Primitive({
        geometryInstances: instances,
        appearance: new PerInstanceColorAppearance({ translucent: translucentFlag, closed: false, flat: false }),
        asynchronous: true,
        releaseGeometryInstances: true,
        allowPicking: true,
        shadows: translucentFlag ? ShadowMode.DISABLED : ShadowMode.ENABLED,
      });
      this.viewer.scene.primitives.add(p);
      primitives.push(p);
    };
    make(solid, false);
    make(translucent, true);
    return { key, primitives, features: map };
  }

  /** Busca el edificio correspondiente a un objeto elegido con scene.pick. */
  featureForPick(id: unknown): (BuildingFeature & { base: number }) | null {
    if (typeof id !== "string" || !id.startsWith("bld:")) return null;
    for (const k of this.tiles.keys()) {
      const f = this.tiles.get(k)?.features.get(id);
      if (f) return f;
    }
    return null;
  }

  /** Recolorea (al cambiar el modo de color) recargando las teselas visibles. */
  restyle(): void {
    if (this.source !== "osm") {
      if (this.tileset && this.source === "ion-osm") this.tileset.style = new Cesium3DTileStyle({ color: "color('#f1ece2')" });
      return;
    }
    this.tiles.clear();
    if (this.lastCenter) this.update(this.lastCenter, this.lastHeight);
  }

  /** Lista de edificios cargados (para búsquedas como "el más alto de esta zona"). */
  loadedFeatures(): (BuildingFeature & { base: number })[] {
    const out: (BuildingFeature & { base: number })[] = [];
    for (const k of this.tiles.keys()) {
      const e = this.tiles.get(k);
      if (e) out.push(...e.features.values());
    }
    return out;
  }

  get tilesetActive(): Cesium3DTileset | null {
    return this.tileset;
  }

  private updateStatus(active = buildingStatus.value.active): void {
    let buildings = 0;
    let measured = 0;
    let levels = 0;
    let defaults = 0;
    for (const k of this.tiles.keys()) {
      const e = this.tiles.get(k);
      if (!e) continue;
      for (const f of e.features.values()) {
        buildings++;
        if (f.quality === "measured") measured++;
        else if (f.quality === "levels") levels++;
        else defaults++;
      }
    }
    buildingStatus.value = {
      ...buildingStatus.value,
      source: this.source,
      tilesLoaded: this.tiles.size,
      tilesLoading: this.loading.size,
      buildings,
      measured,
      levels,
      defaults,
      active,
    };
  }
}
