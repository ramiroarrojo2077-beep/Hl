/**
 * LOD 4 — elementos urbanos reales de OpenStreetMap (árboles, faroles, bancos, paradas,
 * semáforos, fuentes, hidrantes). Cada símbolo corresponde a un nodo OSM con su ubicación
 * registrada. Los árboles se dibujan en 3D con forma SIMBÓLICA (tronco + copa) y, si OSM
 * registra su altura o diámetro de copa, con esas medidas.
 */
import {
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  CylinderGeometry,
  EllipsoidGeometry,
  GeometryInstance,
  Matrix4,
  NearFarScalar,
  PerInstanceColorAppearance,
  PointPrimitiveCollection,
  Primitive,
  Quaternion,
  ShadowMode,
  Transforms,
  type Viewer,
} from "cesium";
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
  tree: "Árbol (posición real OSM, forma simbólica)",
  street_lamp: "Farol",
  bench: "Banco",
  bus_stop: "Parada de colectivo/autobús",
  traffic_signals: "Semáforo",
  fountain: "Fuente de agua",
  waste_basket: "Cesto de residuos",
  bicycle_parking: "Estacionamiento de bicicletas",
  hydrant: "Hidrante",
};

export class UrbanDetails {
  private points: PointPrimitiveCollection;
  private center: LonLat | null = null;
  private ctrl: AbortController | null = null;
  private elements = new Map<string, UrbanElement>();
  private trees: Primitive | null = null;

  constructor(private viewer: Viewer) {
    this.points = viewer.scene.primitives.add(new PointPrimitiveCollection()) as PointPrimitiveCollection;
  }

  /** Árboles 3D instanciados: tronco y copa por árbol, con medidas OSM cuando existen. */
  private buildTrees(trees: { el: UrbanElement; ground: number }[]): void {
    if (this.trees) {
      this.viewer.scene.primitives.remove(this.trees);
      this.trees = null;
    }
    if (!trees.length) return;
    const trunkGeom = new CylinderGeometry({ length: 1, topRadius: 0.5, bottomRadius: 0.5, slices: 7, vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT });
    const crownGeom = new EllipsoidGeometry({ radii: new Cartesian3(1, 1, 1), slicePartitions: 9, stackPartitions: 7, vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT });
    const instances: GeometryInstance[] = [];
    const trunkColor = ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString("#6b4f35"));
    for (const { el, ground } of trees.slice(0, 2500)) {
      const tags = el.tags;
      const height = Math.min(40, Math.max(3, Number.parseFloat(tags["height"] ?? "") || 8));
      const crownD = Math.min(25, Math.max(2, Number.parseFloat(tags["diameter_crown"] ?? "") || height * 0.55));
      const trunkH = height * 0.4;
      const crownH = height - trunkH * 0.75;
      const enu = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(el.lon, el.lat, ground));
      const trunkM = Matrix4.multiply(enu, Matrix4.fromTranslationQuaternionRotationScale(new Cartesian3(0, 0, trunkH / 2), Quaternion.IDENTITY, new Cartesian3(Math.max(0.4, height * 0.06), Math.max(0.4, height * 0.06), trunkH)), new Matrix4());
      const crownM = Matrix4.multiply(enu, Matrix4.fromTranslationQuaternionRotationScale(new Cartesian3(0, 0, trunkH * 0.75 + crownH / 2), Quaternion.IDENTITY, new Cartesian3(crownD / 2, crownD / 2, crownH / 2)), new Matrix4());
      // Variación de verde estable por árbol
      const g = 0.38 + ((el.id % 7) - 3) * 0.025;
      const leaf = tags["leaf_type"] === "needleleaved" ? new Color(0.16, g - 0.06, 0.18, 1) : new Color(0.24, g, 0.17, 1);
      instances.push(new GeometryInstance({ id: `urban:${el.id}`, geometry: trunkGeom, modelMatrix: trunkM, attributes: { color: trunkColor } }));
      instances.push(new GeometryInstance({ id: `urban:${el.id}`, geometry: crownGeom, modelMatrix: crownM, attributes: { color: ColorGeometryInstanceAttribute.fromColor(leaf) } }));
    }
    this.trees = this.viewer.scene.primitives.add(
      new Primitive({
        geometryInstances: instances,
        appearance: new PerInstanceColorAppearance({ flat: false, translucent: false }),
        asynchronous: true,
        releaseGeometryInstances: true,
        shadows: ShadowMode.CAST_ONLY,
      }),
    ) as Primitive;
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
    if (this.trees) this.trees.show = visible;
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
      const trees3d = settings.value.quality !== "low";
      const treeList: { el: UrbanElement; ground: number }[] = [];
      els.forEach((e, i) => {
        const id = `urban:${e.id}`;
        this.elements.set(id, e);
        byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
        if (trees3d && e.kind === "tree") {
          treeList.push({ el: e, ground: Math.max(0, ground[i] ?? 0) * ex });
          return;
        }
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
      this.buildTrees(treeList);
      urbanStatus.value = { count: els.length, loading: false, byKind };
    } catch {
      if (!ctrl.signal.aborted) urbanStatus.value = { ...urbanStatus.value, loading: false };
    }
  }
}
