/**
 * Motor de EARTH NEXT: crea el visor de Cesium y coordina los subsistemas
 * (terreno, imágenes, edificios, navegación, herramientas, tiempo, clima, recorridos).
 */
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  CesiumTerrainProvider,
  Color,
  EllipsoidTerrainProvider,
  Ion,
  Math as CMath,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Viewer,
  defined,
  type TerrainProvider,
} from "cesium";
import { batch, effect } from "@preact/signals";
import type { LonLat } from "../geo/coords.ts";
import { lodForHeight } from "../geo/lod.ts";
import { subsolarPoint } from "../geo/astronomy.ts";
import { formatHeight } from "../geo/format.ts";
import { flightBetween, type CameraPose } from "../geo/tour.ts";
import { framingHeight, reverse, type Place } from "../services/geocoder.ts";
import { wikiFromTag, WIKI_SOURCE } from "../services/wiki.ts";
import { OSM_SOURCE } from "../services/overpass.ts";
import { ELEVATION_SOURCE, elevationAt } from "../services/elevation.ts";
import {
  cameraState,
  cursorPosition,
  lod,
  notify,
  selection,
  settings,
  infoOpen,
  loadingTiles,
  type Selection,
} from "../state/store.ts";
import { t } from "../i18n/index.ts";
import { createTerrariumTerrain } from "./terrain-provider.ts";
import { ImageryManager } from "./imagery.ts";
import { BuildingsManager } from "./buildings.ts";
import { NavigationController } from "./navigation.ts";
import { LightingController, TimeController } from "./lighting.ts";
import { QualityManager, detectInitialLevel } from "./quality.ts";
import { ToolController, activeTool } from "./tools.ts";
import { UserDataManager } from "./userdata.ts";
import { TourPlayer, CanvasRecorder } from "./tours.ts";
import { WeatherViz } from "./weather-viz.ts";
import { UrbanDetails } from "./urban.ts";

export class Engine {
  readonly viewer: Viewer;
  readonly imagery: ImageryManager;
  readonly buildings: BuildingsManager;
  readonly nav: NavigationController;
  readonly time: TimeController;
  readonly lighting: LightingController;
  readonly quality: QualityManager;
  readonly userData: UserDataManager;
  readonly tools: ToolController;
  readonly tours: TourPlayer;
  readonly recorder: CanvasRecorder;
  readonly weather: WeatherViz;
  readonly urban: UrbanDetails;
  private lastCameraPush = 0;
  private hashTimer: number | null = null;
  private terrainKey = "";
  private collisionTimer = 0;

  constructor(container: HTMLElement, creditContainer: HTMLElement) {
    if (settings.value.ionToken) Ion.defaultAccessToken = settings.value.ionToken;
    this.viewer = new Viewer(container, {
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      vrButton: false,
      creditContainer,
      terrainProvider: new EllipsoidTerrainProvider(),
      useBrowserRecommendedResolution: true,
      orderIndependentTranslucency: true,
      contextOptions: { webgl: { powerPreference: "high-performance", alpha: false } },
      requestRenderMode: false,
    });
    const v = this.viewer;
    v.scene.globe.baseColor = Color.fromCssColorString("#0a1a2e");
    v.cesiumWidget.creditContainer.classList.add("credits");
    // Doble clic: Cesium por defecto "sigue" entidades; se desactiva para usarlo en herramientas.
    v.cesiumWidget.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    this.quality = new QualityManager(v, settings.value.quality === "auto" ? detectInitialLevel((v.scene as unknown as { context?: { _gl?: WebGLRenderingContext } }).context?._gl) : settings.value.quality);
    this.imagery = new ImageryManager(v);
    this.imagery.setBase("esri-imagery");
    this.imagery.addOverlay("labels", { opacity: 0.9 });
    if (settings.value.nightLights) this.imagery.addOverlay("night-lights");
    this.time = new TimeController(v);
    this.lighting = new LightingController(v);
    this.buildings = new BuildingsManager(v);
    this.nav = new NavigationController(v);
    this.userData = new UserDataManager(v);
    this.tools = new ToolController(v, this.userData);
    this.tours = new TourPlayer(v, this.nav);
    this.recorder = new CanvasRecorder(v);
    this.weather = new WeatherViz(v);
    this.urban = new UrbanDetails(v);

    void this.applyTerrain();
    void this.buildings.setSource(settings.value.buildings);

    // Reacciona a cambios de configuración
    effect(() => {
      const s = settings.value;
      v.scene.verticalExaggeration = s.terrainExaggeration;
      this.lighting.apply();
      if (s.quality !== "auto") this.quality.setManual(s.quality);
      void this.applyTerrain();
      void this.buildings.setSource(s.buildings);
      if (s.ionToken) Ion.defaultAccessToken = s.ionToken;
    });
    let prevShadows = settings.value.shadows;
    let prevColor = settings.value.buildingColorMode;
    let prevNight = settings.value.nightLights;
    effect(() => {
      const s = settings.value;
      if (s.shadows !== prevShadows) {
        prevShadows = s.shadows;
        this.quality.refresh();
      }
      if (s.buildingColorMode !== prevColor) {
        prevColor = s.buildingColorMode;
        this.buildings.restyle();
      }
      if (s.nightLights !== prevNight) {
        prevNight = s.nightLights;
        this.imagery.toggleOverlay("night-lights", s.nightLights);
      }
    });

    v.scene.postRender.addEventListener(() => this.onFrame());
    v.camera.moveEnd.addEventListener(() => this.onMoveEnd());
    v.camera.percentageChanged = 0.05;
    v.camera.changed.addEventListener(() => this.onCameraChanged());
    this.setupPicking();
    v.scene.globe.tileLoadProgressEvent.addEventListener((n: number) => (loadingTiles.value = n));

    // Vista inicial: desde la URL compartida o desde el espacio.
    if (!this.restoreFromHash()) {
      // Vista inicial desde el espacio, centrada en el lado iluminado del planeta.
      const sub = subsolarPoint(new Date());
      v.camera.setView({ destination: Cartesian3.fromDegrees(sub.lon - 25, Math.max(-35, Math.min(35, sub.lat * 0.6 + 10)), 21_000_000) });
    }
    window.addEventListener("hashchange", () => this.restoreFromHash());
  }

  // ------------------------------------------------------------------ Terreno

  private async applyTerrain(): Promise<void> {
    const s = settings.value;
    const key = `${s.terrain}|${s.bathymetry}|${s.ionToken ? 1 : 0}|${s.quality}`;
    if (key === this.terrainKey) return;
    this.terrainKey = key;
    let provider: TerrainProvider;
    try {
      if (s.terrain === "ion") {
        if (!s.ionToken) throw new Error(t("Cesium World Terrain requiere un token de Cesium ion. Se usa el terreno abierto."));
        provider = await CesiumTerrainProvider.fromIonAssetId(1, { requestVertexNormals: true, requestWaterMask: true });
      } else if (s.terrain === "ellipsoid") {
        provider = new EllipsoidTerrainProvider();
      } else {
        provider = createTerrariumTerrain({ bathymetry: s.bathymetry, detailGrid: this.quality.profile.terrainGrid });
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "warning", 7000);
      provider = createTerrariumTerrain({ bathymetry: s.bathymetry, detailGrid: this.quality.profile.terrainGrid });
    }
    this.viewer.terrainProvider = provider;
  }

  // ------------------------------------------------------------------ Cámara

  private onFrame() {
    const now = performance.now();
    if (now - this.lastCameraPush < 100) return;
    this.lastCameraPush = now;
    const cam = this.viewer.camera;
    const c = cam.positionCartographic;
    const ground = this.viewer.scene.globe.getHeight(c) ?? 0;
    const hag = Math.max(0, c.height - ground);
    batch(() => {
      cameraState.value = {
        lon: CMath.toDegrees(c.longitude),
        lat: CMath.toDegrees(c.latitude),
        height: c.height,
        heightAboveGround: hag,
        heading: CMath.toDegrees(cam.heading),
        pitch: CMath.toDegrees(cam.pitch),
        roll: CMath.toDegrees(cam.roll),
      };
      const l = lodForHeight(hag);
      if (l.level !== lod.value.level) lod.value = l;
    });
    this.imagery.updateNightFade(c.height, settings.value.lightingMode === "realistic");
    this.lighting.updateForCamera(c.height, CMath.toDegrees(c.latitude), CMath.toDegrees(c.longitude), this.time.current);
    this.quality.updateShadowDistance(hag);
  }

  private onCameraChanged() {
    this.updateStreaming();
  }

  private onMoveEnd() {
    this.updateStreaming();
    if (this.hashTimer) clearTimeout(this.hashTimer);
    this.hashTimer = window.setTimeout(() => this.writeHash(), 600);
  }

  /** Centro de interés: punto del terreno en el centro de la pantalla (o bajo la cámara). */
  viewCenter(): LonLat {
    const canvas = this.viewer.scene.canvas;
    const ray = this.viewer.camera.getPickRay(new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
    const hit = ray ? (this.viewer.scene.globe.pick(ray, this.viewer.scene) ?? this.viewer.camera.pickEllipsoid(new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2))) : undefined;
    const camC = this.viewer.camera.positionCartographic;
    if (hit) {
      const c = Cartographic.fromCartesian(hit);
      const cam = { lon: CMath.toDegrees(camC.longitude), lat: CMath.toDegrees(camC.latitude) };
      const p = { lon: CMath.toDegrees(c.longitude), lat: CMath.toDegrees(c.latitude) };
      // Si el punto de mira está muy lejos (cámara rasante) se usa la posición de la cámara.
      const dist = Cartesian3.distance(hit, this.viewer.camera.positionWC);
      if (dist < Math.max(8000, cameraState.value.heightAboveGround * 6)) return p;
      return cam;
    }
    return { lon: CMath.toDegrees(camC.longitude), lat: CMath.toDegrees(camC.latitude) };
  }

  private updateStreaming() {
    const hag = cameraState.value.heightAboveGround;
    const center = this.viewCenter();
    this.buildings.update(center, hag);
    if (settings.value.urbanDetails) this.urban.update(center, hag);
  }

  /** Rectángulo visible aproximado (para consultas por zona). */
  viewBBox(): { west: number; south: number; east: number; north: number } {
    const r = this.viewer.camera.computeViewRectangle(this.viewer.scene.globe.ellipsoid);
    if (r) return { west: CMath.toDegrees(r.west), south: CMath.toDegrees(r.south), east: CMath.toDegrees(r.east), north: CMath.toDegrees(r.north) };
    const c = this.viewCenter();
    return { west: c.lon - 20, east: c.lon + 20, south: Math.max(-85, c.lat - 15), north: Math.min(85, c.lat + 15) };
  }

  getPose(): CameraPose {
    return this.tours.getPose();
  }

  flyTo(opts: { lon: number; lat: number; height?: number; heading?: number; pitch?: number; duration?: number }): Promise<void> {
    const height = opts.height ?? 1500;
    const pitch = opts.pitch ?? (height > 200_000 ? -90 : -40);
    const heading = opts.heading ?? 0;
    // Con cabeceo oblicuo, se retrocede la cámara para que el objetivo quede centrado.
    let dest = Cartesian3.fromDegrees(opts.lon, opts.lat, height);
    if (pitch > -85 && height < 200_000) {
      const back = height / Math.tan(CMath.toRadians(-pitch));
      const brg = CMath.toRadians(heading + 180);
      const dLat = (back * Math.cos(brg)) / 111320;
      const dLon = (back * Math.sin(brg)) / (111320 * Math.cos(CMath.toRadians(opts.lat)));
      dest = Cartesian3.fromDegrees(opts.lon + dLon, opts.lat + dLat, height);
    }
    const duration = settings.value.reducedMotion ? 0 : opts.duration;
    if (duration === 0) {
      this.jumpTo(dest, heading, pitch);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.viewer.camera.flyTo({
        destination: dest,
        orientation: { heading: CMath.toRadians(heading), pitch: CMath.toRadians(pitch), roll: 0 },
        duration,
        complete: () => resolve(),
        cancel: () => resolve(),
      });
    });
  }

  /** Vuelo cinematográfico desde la vista actual (con arco orbital si la distancia es grande). */
  cinematicFlyTo(target: LonLat, arrivalHeight?: number, arrivalPitch = -35): Promise<void> {
    const kfs = flightBetween(this.getPose(), target, { arrivalHeight, arrivalPitch });
    return this.tours.play(kfs);
  }

  flyToBBox(b: [number, number, number, number], duration?: number): Promise<void> {
    return new Promise((resolve) => {
      this.viewer.camera.flyTo({
        destination: Rectangle.fromDegrees(b[0], b[1], b[2], b[3]),
        duration: settings.value.reducedMotion ? 0 : duration,
        complete: () => resolve(),
        cancel: () => resolve(),
      });
    });
  }

  async flyToPlace(place: Place, opts: { cinematic?: boolean; select?: boolean } = {}): Promise<void> {
    const big = place.bbox && (place.bbox[2] - place.bbox[0] > 0.05 || place.bbox[3] - place.bbox[1] > 0.05);
    if (opts.select !== false) void this.selectPlace(place);
    if (big && place.bbox) {
      // Bbox de ciudades/países: encuadre por rectángulo con margen.
      const [w, s, e, n] = place.bbox;
      const mx = (e - w) * 0.1;
      const my = (n - s) * 0.1;
      return this.flyToBBox([w - mx, s - my, e + mx, n + my]);
    }
    const height = framingHeight(place);
    if (opts.cinematic) return this.cinematicFlyTo(place, height);
    return this.flyTo({ lon: place.lon, lat: place.lat, height, pitch: height > 100_000 ? -90 : -45 });
  }

  /** Vista desde el espacio centrada en un punto. */
  viewFromSpace(target?: LonLat): Promise<void> {
    const c = target ?? this.viewCenter();
    return this.flyTo({ lon: c.lon, lat: c.lat, height: 12_000_000, pitch: -90, duration: 3 });
  }

  // ------------------------------------------------------------------ Selección e información

  private setupPicking() {
    const handler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);
    handler.setInputAction((e: { position: Cartesian2 }) => {
      if (activeTool.value !== "none") return;
      void this.pickAt(e.position);
    }, ScreenSpaceEventType.LEFT_CLICK);
    let last = 0;
    handler.setInputAction((e: { endPosition: Cartesian2 }) => {
      const now = performance.now();
      if (now - last < 60) return;
      last = now;
      const ray = this.viewer.camera.getPickRay(e.endPosition);
      const p = ray ? this.viewer.scene.globe.pick(ray, this.viewer.scene) : undefined;
      if (!p) {
        cursorPosition.value = null;
        return;
      }
      const c = Cartographic.fromCartesian(p);
      cursorPosition.value = { lon: CMath.toDegrees(c.longitude), lat: CMath.toDegrees(c.latitude), height: c.height / (settings.value.terrainExaggeration || 1) };
    }, ScreenSpaceEventType.MOUSE_MOVE);
  }

  async pickAt(win: Cartesian2): Promise<void> {
    const scene = this.viewer.scene;
    const picked = scene.pick(win);
    if (defined(picked)) {
      const id = (picked as { id?: unknown }).id;
      const bld = this.buildings.featureForPick(id);
      if (bld) return this.selectBuilding(bld);
      const uf = this.userData.featureForEntity(id);
      if (uf) {
        selection.value = {
          kind: "marker",
          title: uf.properties.name,
          subtitle: t("Elemento del proyecto"),
          lon: uf.geometry.type === "Point" ? uf.geometry.coordinates[0] : this.viewCenter().lon,
          lat: uf.geometry.type === "Point" ? uf.geometry.coordinates[1] : this.viewCenter().lat,
          items: [{ label: t("Tipo"), value: uf.properties.kind }, ...(uf.properties.description ? [{ label: t("Descripción"), value: uf.properties.description }] : [])],
          sources: [{ name: t("Creado por el usuario") }],
        };
        infoOpen.value = true;
        return;
      }
      const entId = typeof id === "object" && id && "id" in id ? String((id as { id: string }).id) : typeof id === "string" ? id : "";
      if (entId.startsWith("metar:") || entId.startsWith("storm:") || entId.startsWith("wind:") || entId.startsWith("urban:")) {
        return this.selectWeatherOrUrban(entId);
      }
      // Entidades de capas importadas (KML/GeoJSON): muestra sus propiedades.
      const ent = id as { name?: string; description?: { getValue?: (t: unknown) => string }; properties?: { propertyNames: string[]; getValue: (t: unknown) => Record<string, unknown> } } | undefined;
      if (ent && typeof ent === "object" && (ent.name || ent.properties)) {
        const props = ent.properties?.getValue?.(this.viewer.clock.currentTime) ?? {};
        const pos = scene.pickPosition(win);
        const c = pos ? Cartographic.fromCartesian(pos) : null;
        selection.value = {
          kind: "feature",
          title: ent.name ?? t("Elemento importado"),
          lon: c ? CMath.toDegrees(c.longitude) : 0,
          lat: c ? CMath.toDegrees(c.latitude) : 0,
          items: Object.entries(props)
            .slice(0, 30)
            .map(([k, val]) => ({ label: k, value: String(val) })),
          sources: [{ name: t("Capa importada por el usuario") }],
        };
        infoOpen.value = true;
        return;
      }
    }
    const ray = this.viewer.camera.getPickRay(win);
    const pos = ray ? scene.globe.pick(ray, scene) : undefined;
    if (!pos) return;
    const c = Cartographic.fromCartesian(pos);
    await this.selectPoint({ lon: CMath.toDegrees(c.longitude), lat: CMath.toDegrees(c.latitude) });
  }

  private selectWeatherOrUrban(id: string) {
    if (id.startsWith("metar:")) {
      const m = this.weather.metars.find((x) => x.icao === id.slice(6));
      if (!m) return;
      selection.value = {
        kind: "weather",
        title: `${m.icao} — ${m.name}`,
        subtitle: t("Observación meteorológica (METAR)"),
        lon: m.lon,
        lat: m.lat,
        items: [
          { label: t("Observado"), value: new Date(m.observed).toLocaleString() },
          { label: t("Temperatura"), value: m.temperature !== null ? `${m.temperature} °C` : "—" },
          { label: t("Punto de rocío"), value: m.dewpoint !== null ? `${m.dewpoint} °C` : "—" },
          { label: t("Viento"), value: m.windSpeedKt !== null ? `${m.windDirection ?? "VRB"}° · ${m.windSpeedKt} kt (${Math.round(m.windSpeedKt * 1.852)} km/h)` : "—" },
          { label: t("Presión"), value: m.pressureHpa !== null ? `${m.pressureHpa} hPa` : "—" },
          { label: t("Visibilidad"), value: m.visibility ?? "—" },
          { label: "METAR", value: m.raw },
        ],
        notices: [t("Dato OBSERVADO en la estación.")],
        sources: [{ name: "NOAA Aviation Weather Center", url: "https://aviationweather.gov", license: t("Dominio público") }],
      };
    } else if (id.startsWith("storm:")) {
      const s = this.weather.storms.find((x) => String(x.id) === id.slice(6));
      if (!s) return;
      selection.value = {
        kind: "weather",
        title: s.name,
        subtitle: t("Ciclón tropical (GDACS)"),
        lon: s.lon,
        lat: s.lat,
        items: [
          { label: t("Alerta"), value: s.alertLevel },
          { label: t("Desde"), value: new Date(s.from).toLocaleString() },
          { label: t("Hasta"), value: new Date(s.to).toLocaleString() },
          ...(s.severity ? [{ label: t("Intensidad"), value: s.severity }] : []),
          { label: t("Informe"), value: "GDACS", href: s.url },
        ],
        sources: [{ name: "GDACS", url: "https://www.gdacs.org" }],
      };
    } else if (id.startsWith("wind:")) {
      const [lat, lon] = id.slice(5).split(",").map(Number);
      const g = this.weather.grid.find((x) => Math.abs(x.lat - lat!) < 1e-3 && Math.abs(x.lon - lon!) < 1e-3);
      if (!g) return;
      selection.value = {
        kind: "weather",
        title: t("Modelo meteorológico"),
        subtitle: "Open-Meteo",
        lon: g.lon,
        lat: g.lat,
        items: [
          { label: t("Viento"), value: `${Math.round(g.windSpeed)} km/h desde ${Math.round(g.windDirection)}°` },
          { label: t("Temperatura"), value: `${g.temperature.toFixed(1)} °C` },
          { label: t("Nubosidad"), value: `${g.cloudCover} %` },
          { label: t("Presión"), value: `${g.pressure.toFixed(0)} hPa` },
        ],
        notices: [t("Valor de MODELO (análisis/pronóstico), no una medición directa.")],
        sources: [{ name: "Open-Meteo", url: "https://open-meteo.com", license: "CC BY 4.0" }],
      };
    } else if (id.startsWith("urban:")) {
      const el = this.urban.byId(id);
      if (!el) return;
      selection.value = {
        kind: "feature",
        title: t(this.urban.kindLabel(el.kind)),
        subtitle: "OpenStreetMap",
        lon: el.lon,
        lat: el.lat,
        items: Object.entries(el.tags)
          .slice(0, 20)
          .map(([k, v]) => ({ label: k, value: v })),
        osm: { type: "node", id: el.id },
        sources: [OSM_SOURCE],
      };
    }
    infoOpen.value = true;
  }

  private async selectBuilding(f: NonNullable<ReturnType<BuildingsManager["featureForPick"]>>) {
    const qualityText = {
      measured: t("Altura registrada en OpenStreetMap"),
      levels: t("Altura estimada a partir de la cantidad de pisos"),
      default: t("Sin dato de altura: volumen genérico aproximado"),
    }[f.quality];
    const lat = f.outer.reduce((s, p) => s + p.lat, 0) / f.outer.length;
    const lon = f.outer.reduce((s, p) => s + p.lon, 0) / f.outer.length;
    const sel: Selection = {
      kind: "building",
      title: f.name ?? (f.tags["addr:street"] ? `${f.tags["addr:street"]} ${f.tags["addr:housenumber"] ?? ""}` : t("Edificio")),
      subtitle: `${t("Tipo")}: ${f.kind}`,
      lon,
      lat,
      height: f.base + f.height,
      items: [
        { label: t("Altura"), value: `${formatHeight(f.height, settings.value.units)}${f.quality !== "measured" ? " (≈)" : ""}` },
        { label: t("Origen de la altura"), value: f.heightSource },
        ...(f.minHeight > 0 ? [{ label: t("Altura mínima"), value: formatHeight(f.minHeight, settings.value.units) }] : []),
        ...(f.tags["building:levels"] ? [{ label: t("Pisos"), value: f.tags["building:levels"]! }] : []),
        ...(f.tags["start_date"] ? [{ label: t("Construcción"), value: f.tags["start_date"]! }] : []),
        ...(f.tags["architect"] ? [{ label: t("Arquitecto/a"), value: f.tags["architect"]! }] : []),
        ...(f.tags["building:material"] ? [{ label: t("Material"), value: f.tags["building:material"]! }] : []),
        ...(f.tags["heritage"] ? [{ label: t("Patrimonio"), value: f.tags["heritage"]! }] : []),
        { label: t("Elevación del terreno"), value: formatHeight(f.base / (settings.value.terrainExaggeration || 1), settings.value.units) },
        { label: "OSM", value: `${f.osmType}/${f.osmId}`, href: `https://www.openstreetmap.org/${f.osmType}/${f.osmId}` },
      ],
      notices: [qualityText, ...(f.quality === "default" ? [t("La forma de la planta es real (OSM); la altura NO es un dato verificado.")] : [])],
      sources: [OSM_SOURCE, ELEVATION_SOURCE],
      osm: { type: f.osmType, id: f.osmId },
    };
    selection.value = sel;
    infoOpen.value = true;
    const wp = f.tags["wikipedia"];
    if (wp) {
      const w = await wikiFromTag(wp, settings.value.lang);
      if (w && selection.value === sel) {
        selection.value = { ...sel, description: w.extract, image: w.thumbnail, wikipedia: w.url, sources: [...sel.sources, { ...WIKI_SOURCE, url: w.url }] };
      }
    }
  }

  async selectPlace(place: Place): Promise<void> {
    const sel: Selection = {
      kind: "place",
      title: place.name,
      subtitle: place.label,
      lon: place.lon,
      lat: place.lat,
      items: [
        { label: t("Tipo"), value: `${place.category}/${place.kind}` },
        ...(place.extratags?.["population"] ? [{ label: t("Población (OSM)"), value: Number(place.extratags["population"]).toLocaleString() }] : []),
        ...(place.extratags?.["ele"] ? [{ label: t("Altitud (OSM)"), value: `${place.extratags["ele"]} m` }] : []),
        ...(place.osm ? [{ label: "OSM", value: `${place.osm.type}/${place.osm.id}`, href: `https://www.openstreetmap.org/${place.osm.type}/${place.osm.id}` }] : []),
      ],
      sources: [place.source === "nominatim" ? { name: "Nominatim / OpenStreetMap", url: "https://nominatim.org", license: "ODbL" } : place.source === "photon" ? { name: "Photon / OpenStreetMap", url: "https://photon.komoot.io", license: "ODbL" } : { name: t("Coordenadas ingresadas") }],
      osm: place.osm,
    };
    selection.value = sel;
    infoOpen.value = true;
    const [elev, wiki] = await Promise.all([
      elevationAt(place).catch(() => null),
      place.extratags?.["wikipedia"] ? wikiFromTag(place.extratags["wikipedia"], settings.value.lang) : Promise.resolve(null),
    ]);
    if (selection.value !== sel) return;
    const items = [...sel.items];
    if (elev !== null) items.push({ label: t("Elevación del terreno"), value: formatHeight(elev, settings.value.units) });
    selection.value = {
      ...sel,
      items,
      description: wiki?.extract,
      image: wiki?.thumbnail,
      wikipedia: wiki?.url,
      sources: [...sel.sources, ...(elev !== null ? [ELEVATION_SOURCE] : []), ...(wiki ? [{ ...WIKI_SOURCE, url: wiki.url }] : [])],
    };
  }

  async selectPoint(p: LonLat): Promise<void> {
    const sel: Selection = {
      kind: "point",
      title: `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`,
      subtitle: t("Buscando dirección…"),
      lon: p.lon,
      lat: p.lat,
      items: [],
      sources: [],
    };
    selection.value = sel;
    infoOpen.value = true;
    const [place, elev] = await Promise.all([reverse(p, { lang: settings.value.lang, zoom: 18 }).catch(() => null), elevationAt(p).catch(() => null)]);
    if (selection.value !== sel) return;
    selection.value = {
      ...sel,
      subtitle: place?.label ?? t("Sin dirección conocida"),
      items: elev !== null ? [{ label: t("Elevación del terreno"), value: formatHeight(elev, settings.value.units) }] : [],
      sources: [...(place ? [{ name: "Nominatim / OpenStreetMap", url: "https://nominatim.org", license: "ODbL" }] : []), ...(elev !== null ? [ELEVATION_SOURCE] : [])],
      osm: place?.osm,
    };
  }

  // ------------------------------------------------------------------ URL compartible

  private writeHash() {
    const c = cameraState.value;
    const h = `#@${c.lat.toFixed(5)},${c.lon.toFixed(5)},${Math.round(c.height)}a,${c.heading.toFixed(0)}h,${c.pitch.toFixed(0)}t`;
    if (location.hash !== h) history.replaceState(null, "", h);
  }

  /** "#@lat,lon,alturaa,rumboh,cabeceot" */
  /**
   * Salto instantáneo de cámara. Cesium evita colisiones con la altura del suelo calculada en el
   * cuadro anterior; tras un salto largo (p. ej. de los Alpes a Buenos Aires) esa altura es la del
   * lugar anterior y "empujaría" la cámara hacia arriba. Se suspende la detección un instante.
   */
  jumpTo(destination: Cartesian3, headingDeg: number, pitchDeg: number): void {
    const ctrl = this.viewer.scene.screenSpaceCameraController;
    ctrl.enableCollisionDetection = false;
    this.viewer.camera.setView({ destination, orientation: { heading: CMath.toRadians(headingDeg), pitch: CMath.toRadians(pitchDeg), roll: 0 } });
    window.clearTimeout(this.collisionTimer);
    this.collisionTimer = window.setTimeout(() => (ctrl.enableCollisionDetection = true), 1500);
    this.onMoveEnd();
  }

  private restoreFromHash(): boolean {
    const m = location.hash.match(/^#@(-?[\d.]+),(-?[\d.]+),(\d+)a(?:,(-?[\d.]+)h)?(?:,(-?[\d.]+)t)?/);
    if (!m) return false;
    const [lat, lon, height] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
    this.jumpTo(Cartesian3.fromDegrees(lon, lat, height), Number(m[4] ?? 0), Number(m[5] ?? -90));
    return true;
  }

  shareUrl(): string {
    this.writeHash();
    return location.href;
  }

  // ------------------------------------------------------------------ Capturas

  /** Captura PNG del lienzo con las atribuciones de datos incrustadas (requisito de licencia). */
  screenshot(): Promise<Blob> {
    const scene = this.viewer.scene;
    return new Promise((resolve, reject) => {
      const remove = scene.postRender.addEventListener(() => {
        remove();
        try {
          const src = scene.canvas;
          const out = document.createElement("canvas");
          out.width = src.width;
          out.height = src.height;
          const g = out.getContext("2d")!;
          g.drawImage(src, 0, 0);
          const credits = ["EARTH NEXT", ...this.imagery.attributions(), settings.value.terrain === "terrarium" ? "Terreno: AWS Terrain Tiles" : "", buildingsCredit()].filter(Boolean).join(" · ");
          const fs = Math.max(11, Math.round(out.width / 140));
          g.font = `500 ${fs}px Inter, system-ui, sans-serif`;
          const pad = fs * 0.6;
          g.fillStyle = "rgba(5,10,20,0.6)";
          g.fillRect(0, out.height - fs - pad * 2, out.width, fs + pad * 2);
          g.fillStyle = "#fff";
          g.fillText(credits.slice(0, 400), pad, out.height - pad - fs * 0.15);
          out.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo generar la imagen"))), "image/png");
        } catch (err) {
          reject(err);
        }
      });
      scene.requestRender();
    });
  }
}

function buildingsCredit(): string {
  const s = settings.value.buildings;
  if (s === "osm") return "Edificios © OpenStreetMap";
  if (s === "google") return "Google Photorealistic 3D Tiles";
  if (s === "ion-osm") return "Cesium OSM Buildings";
  return "";
}

let engine: Engine | null = null;
export function initEngine(container: HTMLElement, credits: HTMLElement): Engine {
  if (!engine) engine = new Engine(container, credits);
  return engine;
}
export function getEngine(): Engine {
  if (!engine) throw new Error("Motor no inicializado");
  return engine;
}
export function engineReady(): boolean {
  return engine !== null;
}
