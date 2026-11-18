/**
 * Datos del usuario: marcadores, dibujos, capas importadas (GeoJSON, KML, KMZ) y exportación.
 * Los dibujos se guardan como GeoJSON (fuente de verdad) y se renderizan con entidades de Cesium.
 */
import {
  ArcType,
  Cartesian2,
  Cartesian3,
  Color,
  CustomDataSource,
  GeoJsonDataSource,
  HeightReference,
  HorizontalOrigin,
  KmlDataSource,
  LabelStyle,
  VerticalOrigin,
  exportKml,
  type DataSource,
  type Entity,
  type Viewer,
} from "cesium";
import { signal } from "@preact/signals";
import JSZip from "jszip";
import type { LonLat } from "../geo/coords.ts";
import { polygonArea, pathLength } from "../geo/geodesy.ts";
import { newId } from "../geo/tour.ts";
import { notify } from "../state/store.ts";

export type UserGeometry = { type: "Point"; coordinates: [number, number] } | { type: "LineString"; coordinates: [number, number][] } | { type: "Polygon"; coordinates: [number, number][][] };

export interface UserFeature {
  type: "Feature";
  id: string;
  geometry: UserGeometry;
  properties: {
    name: string;
    description?: string;
    color: string;
    kind: "marker" | "line" | "polygon" | "measurement" | "route";
    createdAt: string;
    collection?: string;
    [k: string]: unknown;
  };
}

export interface ImportedLayer {
  id: string;
  name: string;
  format: "geojson" | "kml" | "kmz";
  visible: boolean;
  featureCount: number;
}

export const userFeatures = signal<UserFeature[]>([]);
export const importedLayers = signal<ImportedLayer[]>([]);

const MAX_IMPORT_BYTES = 80 * 1024 * 1024;

export class UserDataManager {
  readonly source = new CustomDataSource("user");
  private imported = new Map<string, DataSource>();

  constructor(private viewer: Viewer) {
    void viewer.dataSources.add(this.source);
    try {
      const saved = localStorage.getItem("earth-next:user-features");
      if (saved) userFeatures.value = JSON.parse(saved) as UserFeature[];
    } catch {
      /* noop */
    }
    this.render();
  }

  private persist() {
    try {
      localStorage.setItem("earth-next:user-features", JSON.stringify(userFeatures.value));
    } catch {
      notify("No se pudo guardar localmente: almacenamiento lleno. Exportá el proyecto a un archivo.", "warning");
    }
  }

  add(feature: Omit<UserFeature, "id" | "type"> & { id?: string }): UserFeature {
    const f: UserFeature = { type: "Feature", id: feature.id ?? newId("f"), geometry: feature.geometry, properties: feature.properties };
    userFeatures.value = [...userFeatures.value, f];
    this.persist();
    this.render();
    return f;
  }

  update(id: string, patch: Partial<UserFeature["properties"]>): void {
    userFeatures.value = userFeatures.value.map((f) => (f.id === id ? { ...f, properties: { ...f.properties, ...patch } } : f));
    this.persist();
    this.render();
  }

  remove(id: string): void {
    userFeatures.value = userFeatures.value.filter((f) => f.id !== id);
    this.persist();
    this.render();
  }

  replaceAll(features: UserFeature[]): void {
    userFeatures.value = features;
    this.persist();
    this.render();
  }

  addMarker(p: LonLat, name: string, color = "#f59e0b", description?: string, collection?: string): UserFeature {
    return this.add({
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: { name, color, kind: "marker", description, collection, createdAt: new Date().toISOString() },
    });
  }

  render(): void {
    const ents = this.source.entities;
    ents.suspendEvents();
    ents.removeAll();
    for (const f of userFeatures.value) this.renderFeature(f);
    ents.resumeEvents();
    this.viewer.scene.requestRender();
  }

  private renderFeature(f: UserFeature): Entity | undefined {
    const color = Color.fromCssColorString(f.properties.color || "#f59e0b");
    const g = f.geometry;
    const ents = this.source.entities;
    const label = {
      text: f.properties.name,
      font: "600 13px Inter, system-ui, sans-serif",
      fillColor: Color.WHITE,
      outlineColor: Color.fromCssColorString("#0b1220"),
      outlineWidth: 3,
      style: LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cartesian2(0, -22),
      verticalOrigin: VerticalOrigin.BOTTOM,
      horizontalOrigin: HorizontalOrigin.CENTER,
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      showBackground: false,
    };
    if (g.type === "Point") {
      return ents.add({
        id: `user:${f.id}`,
        position: Cartesian3.fromDegrees(g.coordinates[0], g.coordinates[1]),
        point: { pixelSize: 12, color, outlineColor: Color.WHITE, outlineWidth: 2, heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label,
      });
    }
    if (g.type === "LineString") {
      return ents.add({
        id: `user:${f.id}`,
        polyline: { positions: Cartesian3.fromDegreesArray(g.coordinates.flat()), width: 4, material: color, clampToGround: true, arcType: ArcType.GEODESIC },
      });
    }
    const ring = g.coordinates[0] ?? [];
    return ents.add({
      id: `user:${f.id}`,
      polygon: { hierarchy: Cartesian3.fromDegreesArray(ring.flat()), material: color.withAlpha(0.35), outline: false, arcType: ArcType.GEODESIC },
      polyline: { positions: Cartesian3.fromDegreesArray([...ring, ring[0]!].flat()), width: 3, material: color, clampToGround: true },
    });
  }

  featureForEntity(id: unknown): UserFeature | null {
    if (typeof id !== "string" && !(id && typeof id === "object" && "id" in id)) return null;
    const raw = typeof id === "string" ? id : String((id as { id: string }).id);
    if (!raw.startsWith("user:")) return null;
    return userFeatures.value.find((f) => f.id === raw.slice(5)) ?? null;
  }

  // ------------------------------------------------------------------ Importación

  async importFile(file: File): Promise<void> {
    if (file.size > MAX_IMPORT_BYTES) throw new Error(`Archivo demasiado grande (${(file.size / 1e6).toFixed(0)} MB, máx. 80 MB).`);
    const name = file.name;
    const ext = name.toLowerCase().split(".").pop();
    let ds: DataSource;
    let format: ImportedLayer["format"];
    if (ext === "geojson" || ext === "json") {
      const text = await file.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("El archivo no es JSON válido.");
      }
      validateGeoJson(json);
      ds = await GeoJsonDataSource.load(json as object, { clampToGround: true, stroke: Color.fromCssColorString("#38bdf8"), fill: Color.fromCssColorString("#38bdf8").withAlpha(0.3), strokeWidth: 3 });
      format = "geojson";
    } else if (ext === "kml" || ext === "kmz") {
      ds = await KmlDataSource.load(file, { camera: this.viewer.scene.camera, canvas: this.viewer.scene.canvas, clampToGround: true });
      format = ext;
    } else {
      throw new Error("Formato no soportado. Usá GeoJSON, KML o KMZ.");
    }
    ds.name = name;
    await this.viewer.dataSources.add(ds);
    const id = newId("lyr");
    this.imported.set(id, ds);
    importedLayers.value = [...importedLayers.value, { id, name, format, visible: true, featureCount: ds.entities.values.length }];
    await this.viewer.flyTo(ds, { duration: 2 });
  }

  setImportedVisible(id: string, visible: boolean): void {
    const ds = this.imported.get(id);
    if (!ds) return;
    ds.show = visible;
    importedLayers.value = importedLayers.value.map((l) => (l.id === id ? { ...l, visible } : l));
  }

  removeImported(id: string): void {
    const ds = this.imported.get(id);
    if (ds) void this.viewer.dataSources.remove(ds, true);
    this.imported.delete(id);
    importedLayers.value = importedLayers.value.filter((l) => l.id !== id);
  }

  zoomToImported(id: string): void {
    const ds = this.imported.get(id);
    if (ds) void this.viewer.flyTo(ds, { duration: 1.5 });
  }

  // ------------------------------------------------------------------ Exportación

  toGeoJson(): { type: "FeatureCollection"; features: UserFeature[] } {
    return {
      type: "FeatureCollection",
      features: userFeatures.value.map((f) => {
        const props = { ...f.properties };
        if (f.geometry.type === "LineString") props["length_m"] = Math.round(pathLength(f.geometry.coordinates.map(([lon, lat]) => ({ lon, lat }))) * 100) / 100;
        if (f.geometry.type === "Polygon") props["area_m2"] = Math.round(polygonArea(f.geometry.coordinates[0]!.map(([lon, lat]) => ({ lon, lat }))));
        return { ...f, properties: props };
      }),
    };
  }

  async toKml(asKmz = false): Promise<Blob> {
    const result = (await exportKml({ entities: this.source.entities, kmz: asKmz } as never)) as { kml?: string; kmz?: Blob };
    if (asKmz && result.kmz) return result.kmz;
    return new Blob([result.kml ?? ""], { type: "application/vnd.google-earth.kml+xml" });
  }

  async toKmzManual(): Promise<Blob> {
    const kml = await (await this.toKml(false)).text();
    const zip = new JSZip();
    zip.file("doc.kml", kml);
    return zip.generateAsync({ type: "blob", mimeType: "application/vnd.google-earth.kmz" });
  }
}

/** Validación estructural mínima de GeoJSON (RFC 7946). */
export function validateGeoJson(json: unknown): void {
  const types = ["FeatureCollection", "Feature", "Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"];
  if (!json || typeof json !== "object" || !types.includes((json as { type?: string }).type ?? "")) {
    throw new Error("GeoJSON inválido: falta un 'type' reconocido (FeatureCollection, Feature o geometría).");
  }
  const j = json as { type: string; features?: unknown[] };
  if (j.type === "FeatureCollection" && !Array.isArray(j.features)) throw new Error("GeoJSON inválido: FeatureCollection sin 'features'.");
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
