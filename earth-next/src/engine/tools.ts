/**
 * Herramientas interactivas sobre el globo: medición de distancias, superficies y alturas,
 * coordenadas, perfil de elevación, pendiente, dibujo (puntos, líneas, polígonos) y rutas.
 * Clic: agrega punto · doble clic / clic derecho / Enter: termina · Esc: cancela · Retroceso: deshace.
 */
import {
  ArcType,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  CustomDataSource,
  HeightReference,
  LabelStyle,
  Math as CMath,
  PolygonHierarchy,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type Viewer,
} from "cesium";
import { signal } from "@preact/signals";
import type { LonLat } from "../geo/coords.ts";
import { inverse, pathLength, polygonArea, ringPerimeter } from "../geo/geodesy.ts";
import { formatArea, formatDistance, formatHeight, formatBearing } from "../geo/format.ts";
import { profileStats, slopeClass, type ProfileStats } from "../geo/slope.ts";
import { elevationProfile, slopeAt, elevationAt, type ProfileSample } from "../services/elevation.ts";
import { route, type Route } from "../services/routing.ts";
import { settings, notify } from "../state/store.ts";
import type { UserDataManager } from "./userdata.ts";

export type ToolId = "none" | "distance" | "area" | "height" | "profile" | "slope" | "coordinates" | "draw-point" | "draw-line" | "draw-polygon" | "route";

export interface ToolResult {
  tool: ToolId;
  points: (LonLat & { height: number })[];
  distance?: number;
  area?: number;
  perimeter?: number;
  deltaHeight?: number;
  horizontal?: number;
  slant?: number;
  bearing?: number;
  profile?: ProfileSample[];
  profileStats?: ProfileStats;
  slope?: { degrees: number; percent: number; aspect: number | null; elevation: number; cls: string };
  route?: Route;
  pending?: boolean;
  error?: string;
}

export const activeTool = signal<ToolId>("none");
export const toolResult = signal<ToolResult | null>(null);
export const profileHover = signal<number | null>(null);

const ACCENT = Color.fromCssColorString("#38bdf8");
const WARN = Color.fromCssColorString("#f59e0b");

export class ToolController {
  private handler: ScreenSpaceEventHandler;
  readonly source = new CustomDataSource("tools");
  private points: Cartesian3[] = [];
  private cursor: Cartesian3 | null = null;
  private abort: AbortController | null = null;
  private onKey = (e: KeyboardEvent) => this.key(e);

  constructor(
    private viewer: Viewer,
    private userData: UserDataManager,
  ) {
    void viewer.dataSources.add(this.source);
    this.handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    this.handler.setInputAction((e: { position: Cartesian2 }) => this.click(e.position), ScreenSpaceEventType.LEFT_CLICK);
    this.handler.setInputAction((e: { endPosition: Cartesian2 }) => this.move(e.endPosition), ScreenSpaceEventType.MOUSE_MOVE);
    this.handler.setInputAction(() => this.finish(), ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    this.handler.setInputAction(() => this.finish(), ScreenSpaceEventType.RIGHT_CLICK);
    window.addEventListener("keydown", this.onKey);
  }

  get active(): boolean {
    return activeTool.value !== "none";
  }

  start(tool: ToolId): void {
    this.cancel();
    activeTool.value = tool;
    toolResult.value = tool === "none" ? null : { tool, points: [], pending: true };
    this.viewer.scene.canvas.style.cursor = tool === "none" ? "" : "crosshair";
    if (tool !== "none") this.drawLive();
  }

  cancel(): void {
    this.abort?.abort();
    this.points = [];
    this.cursor = null;
    this.source.entities.removeAll();
    activeTool.value = "none";
    this.viewer.scene.canvas.style.cursor = "";
  }

  clear(): void {
    this.cancel();
    toolResult.value = null;
  }

  private key(e: KeyboardEvent) {
    if (!this.active) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.key === "Escape") this.clear();
    if (e.key === "Enter") this.finish();
    if (e.key === "Backspace" && this.points.length) {
      this.points.pop();
      this.updateLive();
    }
  }

  /** Posición 3D bajo el cursor: primero edificios/3D Tiles (profundidad), luego el terreno. */
  pickPosition(win: Cartesian2): Cartesian3 | null {
    const scene = this.viewer.scene;
    if (scene.pickPositionSupported) {
      const picked = scene.pick(win);
      if (picked) {
        const p = scene.pickPosition(win);
        if (p) return p;
      }
    }
    const ray = this.viewer.camera.getPickRay(win);
    if (!ray) return null;
    return scene.globe.pick(ray, scene) ?? this.viewer.camera.pickEllipsoid(win) ?? null;
  }

  private click(pos: Cartesian2) {
    const tool = activeTool.value;
    if (tool === "none") return;
    const p = this.pickPosition(pos);
    if (!p) return;
    this.points.push(p);
    const n = this.points.length;
    if (tool === "draw-point") return this.finish();
    if (tool === "coordinates") return this.finish();
    if (tool === "slope" && n === 1) return this.finish();
    if ((tool === "height" || tool === "route") && n === 2) return this.finish();
    this.updateLive();
  }

  private move(pos: Cartesian2) {
    if (!this.active || !this.points.length) return;
    this.cursor = this.pickPosition(pos);
    this.updateLive();
  }

  private lonLats(withCursor = false): (LonLat & { height: number })[] {
    const pts = withCursor && this.cursor ? [...this.points, this.cursor] : this.points;
    return pts.map((c) => {
      const g = Cartographic.fromCartesian(c);
      return { lon: CMath.toDegrees(g.longitude), lat: CMath.toDegrees(g.latitude), height: g.height };
    });
  }

  private units() {
    return settings.value.units;
  }

  private updateLive() {
    const tool = activeTool.value;
    const pts = this.lonLats(true);
    const res: ToolResult = { tool, points: this.lonLats(), pending: true };
    if ((tool === "distance" || tool === "profile" || tool === "draw-line") && pts.length >= 2) res.distance = pathLength(pts);
    if ((tool === "area" || tool === "draw-polygon") && pts.length >= 3) {
      res.area = polygonArea(pts);
      res.perimeter = ringPerimeter(pts);
    }
    if (tool === "height" && pts.length === 2) Object.assign(res, this.heightMetrics(pts[0]!, pts[1]!));
    toolResult.value = res;
    this.viewer.scene.requestRender();
  }

  private heightMetrics(a: LonLat & { height: number }, b: LonLat & { height: number }) {
    const inv = inverse(a, b);
    const dz = b.height - a.height;
    return { deltaHeight: dz, horizontal: inv.distance, slant: Math.hypot(inv.distance, dz), bearing: inv.initialBearing };
  }

  /** Geometría "en vivo" que sigue al cursor. */
  private drawLive() {
    const ents = this.source.entities;
    const tool = activeTool.value;
    const positions = new CallbackProperty(() => (this.cursor ? [...this.points, this.cursor] : this.points), false);
    if (tool === "area" || tool === "draw-polygon") {
      ents.add({
        polygon: {
          hierarchy: new CallbackProperty(() => new PolygonHierarchy(this.cursor ? [...this.points, this.cursor] : this.points), false),
          material: ACCENT.withAlpha(0.25),
          arcType: ArcType.GEODESIC,
        },
      });
      ents.add({
        polyline: {
          positions: new CallbackProperty(() => {
            const p = this.cursor ? [...this.points, this.cursor] : this.points;
            return p.length > 1 ? [...p, p[0]!] : p;
          }, false),
          width: 3,
          material: ACCENT,
          clampToGround: true,
        },
      });
    } else if (tool === "height") {
      ents.add({ polyline: { positions, width: 3, material: WARN, arcType: ArcType.NONE } });
    } else if (tool !== "slope" && tool !== "coordinates" && tool !== "draw-point") {
      ents.add({ polyline: { positions, width: 3, material: tool === "route" ? WARN : ACCENT, clampToGround: true, arcType: ArcType.GEODESIC } });
    }
    // Vértices
    ents.add({
      position: new CallbackProperty(() => this.cursor ?? this.points[this.points.length - 1], false) as never,
      point: { pixelSize: 8, color: Color.WHITE, outlineColor: ACCENT, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    });
  }

  private addVertexMarkers(points: Cartesian3[], color = ACCENT) {
    for (const p of points) {
      this.source.entities.add({ position: p, point: { pixelSize: 7, color: Color.WHITE, outlineColor: color, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
    }
  }

  private addLabel(position: Cartesian3, text: string) {
    this.source.entities.add({
      position,
      label: {
        text,
        font: "600 14px Inter, system-ui, sans-serif",
        fillColor: Color.WHITE,
        showBackground: true,
        backgroundColor: Color.fromCssColorString("#0b1220").withAlpha(0.85),
        backgroundPadding: new Cartesian2(8, 5),
        style: LabelStyle.FILL,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -12),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  /** Termina la operación en curso y calcula el resultado definitivo. */
  async finish(): Promise<void> {
    const tool = activeTool.value;
    if (tool === "none") return;
    // El doble clic genera además dos clics: se eliminan duplicados consecutivos.
    this.points = this.points.filter((p, i, a) => i === 0 || Cartesian3.distance(p, a[i - 1]!) > 0.01);
    const pts = this.lonLats();
    const min = { distance: 2, area: 3, height: 2, profile: 2, slope: 1, coordinates: 1, "draw-point": 1, "draw-line": 2, "draw-polygon": 3, route: 2, none: 0 }[tool];
    if (pts.length < min) return;
    const placed = [...this.points];
    this.cursor = null;
    this.source.entities.removeAll();
    activeTool.value = "none";
    this.viewer.scene.canvas.style.cursor = "";
    const u = this.units();
    const res: ToolResult = { tool, points: pts };
    this.abort?.abort();
    this.abort = new AbortController();
    const signal = this.abort.signal;
    try {
      switch (tool) {
        case "distance": {
          res.distance = pathLength(pts);
          this.source.entities.add({ polyline: { positions: placed, width: 3, material: ACCENT, clampToGround: true, arcType: ArcType.GEODESIC } });
          this.addVertexMarkers(placed);
          this.addLabel(placed[placed.length - 1]!, formatDistance(res.distance, u));
          break;
        }
        case "area": {
          res.area = polygonArea(pts);
          res.perimeter = ringPerimeter(pts);
          this.source.entities.add({ polygon: { hierarchy: new PolygonHierarchy(placed), material: ACCENT.withAlpha(0.25), arcType: ArcType.GEODESIC } });
          this.source.entities.add({ polyline: { positions: [...placed, placed[0]!], width: 3, material: ACCENT, clampToGround: true } });
          this.addLabel(placed[0]!, `${formatArea(res.area, u)} · ${formatDistance(res.perimeter, u)}`);
          break;
        }
        case "height": {
          Object.assign(res, this.heightMetrics(pts[0]!, pts[1]!));
          const [a, b] = placed as [Cartesian3, Cartesian3];
          const ca = Cartographic.fromCartesian(a);
          const cb = Cartographic.fromCartesian(b);
          const corner = Cartesian3.fromRadians(cb.longitude, cb.latitude, ca.height);
          this.source.entities.add({ polyline: { positions: [a, b], width: 3, material: WARN, arcType: ArcType.NONE } });
          this.source.entities.add({ polyline: { positions: [a, corner, b], width: 2, material: Color.WHITE.withAlpha(0.7), arcType: ArcType.NONE } });
          this.addVertexMarkers(placed, WARN);
          this.addLabel(b, `Δh ${formatHeight(res.deltaHeight!, u)}`);
          break;
        }
        case "profile": {
          this.source.entities.add({ polyline: { positions: placed, width: 3, material: ACCENT, clampToGround: true, arcType: ArcType.GEODESIC } });
          this.addVertexMarkers(placed);
          res.distance = pathLength(pts);
          res.pending = true;
          toolResult.value = { ...res };
          res.profile = await elevationProfile(pts, 240, signal);
          res.profileStats = profileStats(res.profile);
          res.pending = false;
          this.addProfileHoverMarker();
          break;
        }
        case "slope": {
          const s = await slopeAt(pts[0]!, 14, signal);
          res.slope = { degrees: s.degrees, percent: s.percent, aspect: s.aspect, elevation: s.elevation, cls: slopeClass(s.degrees) };
          this.addVertexMarkers(placed, WARN);
          this.addLabel(placed[0]!, `${s.degrees.toFixed(1)}° (${s.percent.toFixed(0)}%)${s.aspect !== null ? " · " + formatBearing(s.aspect) : ""}`);
          break;
        }
        case "coordinates": {
          const elev = await elevationAt(pts[0]!, 14, signal).catch(() => NaN);
          res.points = [{ ...pts[0]!, height: elev }];
          this.addVertexMarkers(placed);
          break;
        }
        case "route": {
          res.pending = true;
          toolResult.value = { ...res };
          res.route = await route(pts, "driving", signal);
          res.distance = res.route.distance;
          res.pending = false;
          this.source.entities.add({
            polyline: { positions: Cartesian3.fromDegreesArray(res.route.geometry.flatMap((p) => [p.lon, p.lat])), width: 5, material: WARN, clampToGround: true },
          });
          this.addVertexMarkers(placed, WARN);
          break;
        }
        case "draw-point": {
          this.userData.addMarker(pts[0]!, `Marcador ${new Date().toLocaleTimeString()}`);
          break;
        }
        case "draw-line": {
          this.userData.add({
            geometry: { type: "LineString", coordinates: pts.map((p) => [p.lon, p.lat]) },
            properties: { name: `Línea (${formatDistance(pathLength(pts), u)})`, color: "#38bdf8", kind: "line", createdAt: new Date().toISOString() },
          });
          break;
        }
        case "draw-polygon": {
          this.userData.add({
            geometry: { type: "Polygon", coordinates: [[...pts.map((p) => [p.lon, p.lat] as [number, number]), [pts[0]!.lon, pts[0]!.lat]]] },
            properties: { name: `Polígono (${formatArea(polygonArea(pts), u)})`, color: "#a78bfa", kind: "polygon", createdAt: new Date().toISOString() },
          });
          break;
        }
      }
      toolResult.value = res;
    } catch (err) {
      if (signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      toolResult.value = { ...res, pending: false, error: msg };
      notify(msg, "error");
    }
  }

  private addProfileHoverMarker() {
    this.source.entities.add({
      position: new CallbackProperty(() => {
        const i = profileHover.value;
        const prof = toolResult.value?.profile;
        if (i === null || !prof?.[i]) return undefined;
        const s = prof[i]!;
        return Cartesian3.fromDegrees(s.lon, s.lat, s.elevation);
      }, false) as never,
      point: { pixelSize: 11, color: WARN, outlineColor: Color.WHITE, outlineWidth: 2, heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    });
  }

  /** Guarda el resultado actual como elemento del proyecto. */
  saveResult(): void {
    const r = toolResult.value;
    if (!r || r.points.length === 0) return;
    const u = this.units();
    const now = new Date().toISOString();
    if (r.tool === "area") {
      this.userData.add({
        geometry: { type: "Polygon", coordinates: [[...r.points.map((p) => [p.lon, p.lat] as [number, number]), [r.points[0]!.lon, r.points[0]!.lat]]] },
        properties: { name: `Área ${formatArea(r.area ?? 0, u)}`, color: "#38bdf8", kind: "measurement", createdAt: now },
      });
    } else if (r.tool === "route" && r.route) {
      this.userData.add({
        geometry: { type: "LineString", coordinates: r.route.geometry.map((p) => [p.lon, p.lat]) },
        properties: { name: `Ruta ${formatDistance(r.route.distance, u)}`, color: "#f59e0b", kind: "route", createdAt: now },
      });
    } else if (r.points.length >= 2) {
      this.userData.add({
        geometry: { type: "LineString", coordinates: r.points.map((p) => [p.lon, p.lat]) },
        properties: { name: `${r.tool === "profile" ? "Perfil" : "Distancia"} ${formatDistance(r.distance ?? pathLength(r.points), u)}`, color: "#38bdf8", kind: "measurement", createdAt: now },
      });
    } else {
      this.userData.addMarker(r.points[0]!, `Punto ${r.points[0]!.lat.toFixed(5)}, ${r.points[0]!.lon.toFixed(5)}`);
    }
    notify("Guardado en el proyecto.", "success");
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKey);
    this.handler.destroy();
  }
}
