/**
 * LOD 4 — elementos urbanos reales de OpenStreetMap (árboles, faroles, bancos, paradas,
 * semáforos, fuentes, hidrantes) como puntos georreferenciados. No se inventa geometría:
 * cada símbolo corresponde a un nodo OSM con su ubicación registrada.
 */
import { Cartesian3, Color, NearFarScalar, PointPrimitiveCollection, type Viewer } from "cesium";
import { signal } from "@preact/signals";
import type { LonLat } from "../geo/coords.ts";
import { URBAN_FEATURES_MAX_HEIGHT } from "../geo/lod.ts";
import { haversine } from "../geo/geodesy.ts";
import { urbanElements, type UrbanElement } from "../services/overpass.ts";
import { elevationsAt } from "../services/elevation.ts";
import { settings } from "../state/store.ts";

export const urbanStatus = signal<{ count: number; loading: boolean; byKind: Record<string, number> }>({ count: 0, loading: false, byKind: {} });

const COLORS: Record<UrbanElement["kind"], string> = {
  tree: "#22c55e",
  street_lamp: "#facc15",
  bench: "#a16207",
  bus_stop: "#3b82f6",
  traffic_signals: "#ef4444",
  fountain: "#06b6d4",
  waste_basket: "#64748b",
  bicycle_parking: "#8b5cf6",
  hydrant: "#dc2626",
};

const LABELS: Record<UrbanElement["kind"], string> = {
  tree: "Árbol",
  street_lamp: "Farol",
  bench: "Banco",
  bus_stop: "Parada de colectivo/autobús",
  traffic_signals: "Semáforo",
  fountain: "Fuente",
  waste_basket: "Cesto de residuos",
  bicycle_parking: "Estacionamiento de bicicletas",
  hydrant: "Hidrante",
};

export class UrbanDetails {
  private points: PointPrimitiveCollection;
  private center: LonLat | null = null;
  private ctrl: AbortController | null = null;
  private elements = new Map<string, UrbanElement>();

  constructor(viewer: Viewer) {
    this.points = viewer.scene.primitives.add(new PointPrimitiveCollection()) as PointPrimitiveCollection;
  }

  kindLabel(kind: UrbanElement["kind"]): string {
    return LABELS[kind];
  }

  byId(id: string): UrbanElement | undefined {
    return this.elements.get(id);
  }

  update(center: LonLat, hag: number): void {
    const visible = hag < URBAN_FEATURES_MAX_HEIGHT && settings.value.urbanDetails;
    this.points.show = visible;
    if (!visible) return;
    if (this.center && haversine(center, this.center) < 250) return;
    this.center = center;
    void this.load(center);
  }

  private async load(center: LonLat) {
    this.ctrl?.abort();
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    const r = 450;
    const dLat = r / 111320;
    const dLon = r / (111320 * Math.cos((center.lat * Math.PI) / 180));
    // Grilla de ~0.004° para reutilizar caché entre movimientos cortos.
    const snap = (v: number) => Math.round(v / 0.004) * 0.004;
    const bbox = { west: snap(center.lon) - dLon, east: snap(center.lon) + dLon, south: snap(center.lat) - dLat, north: snap(center.lat) + dLat };
    urbanStatus.value = { ...urbanStatus.value, loading: true };
    try {
      const els = await urbanElements(bbox, ctrl.signal);
      const ground = settings.value.terrain === "ellipsoid" ? els.map(() => 0) : await elevationsAt(els, 15, ctrl.signal);
      if (ctrl.signal.aborted) return;
      this.points.removeAll();
      this.elements.clear();
      const byKind: Record<string, number> = {};
      const ex = settings.value.terrainExaggeration;
      els.forEach((e, i) => {
        const id = `urban:${e.id}`;
        this.elements.set(id, e);
        byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
        const h = Math.max(0, ground[i] ?? 0) * ex + (e.kind === "tree" ? 4 : e.kind === "street_lamp" ? 6 : 1.2);
        this.points.add({
          id,
          position: Cartesian3.fromDegrees(e.lon, e.lat, h),
          pixelSize: e.kind === "tree" ? 9 : 6,
          color: Color.fromCssColorString(COLORS[e.kind] ?? "#94a3b8").withAlpha(0.95),
          outlineColor: Color.BLACK.withAlpha(0.5),
          outlineWidth: 1,
          scaleByDistance: new NearFarScalar(50, 1.4, 900, 0.5),
        });
      });
      urbanStatus.value = { count: els.length, loading: false, byKind };
    } catch {
      if (!ctrl.signal.aborted) urbanStatus.value = { ...urbanStatus.value, loading: false };
    }
  }
}
