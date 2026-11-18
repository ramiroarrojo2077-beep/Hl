/**
 * Visualización meteorológica en el globo:
 *  - Radar de precipitación (RainViewer, observado) con animación de fotogramas.
 *  - Estaciones METAR (observado) con temperatura y viento.
 *  - Flechas de viento del modelo (Open-Meteo, pronóstico/análisis).
 *  - Ciclones tropicales activos (GDACS).
 *  - Lluvia/nieve como efecto visual SIMULADO (partículas), rotulado como tal.
 */
import {
  Cartesian2,
  Cartesian3,
  Color,
  CustomDataSource,
  ImageryLayer,
  LabelStyle,
  Matrix4,
  ParticleSystem,
  BoxEmitter,
  Transforms,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  WebMercatorTilingScheme,
  Credit,
  NearFarScalar,
  type Viewer,
} from "cesium";
import { signal } from "@preact/signals";
import { activeStorms, forecastGrid, metarsIn, radarFrames, radarTileUrl, type GridSample, type Metar, type RadarFrame, type Storm } from "../services/weather.ts";
import { notify } from "../state/store.ts";

export const weatherLayers = signal({ radar: false, metar: false, wind: false, storms: false, effects: false });
export const radarState = signal<{ frames: RadarFrame[]; index: number; playing: boolean; time: number | null }>({ frames: [], index: 0, playing: false, time: null });
export const weatherEffect = signal<"none" | "rain" | "snow" | "storm">("none");

function arrowCanvas(speed: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 48;
  const g = c.getContext("2d")!;
  const color = speed < 10 ? "#7dd3fc" : speed < 25 ? "#34d399" : speed < 45 ? "#fbbf24" : speed < 70 ? "#f97316" : "#ef4444";
  g.translate(24, 24);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 16);
  g.lineTo(0, -12);
  g.stroke();
  g.beginPath();
  g.moveTo(0, -20);
  g.lineTo(-8, -8);
  g.lineTo(8, -8);
  g.closePath();
  g.fill();
  return c;
}

export class WeatherViz {
  private radarLayer: ImageryLayer | null = null;
  private radarHost = "";
  private radarTimer: number | null = null;
  readonly metarSource = new CustomDataSource("metar");
  readonly windSource = new CustomDataSource("wind");
  readonly stormSource = new CustomDataSource("storms");
  private particles: ParticleSystem | null = null;
  metars: Metar[] = [];
  grid: GridSample[] = [];
  storms: Storm[] = [];

  constructor(private viewer: Viewer) {
    for (const ds of [this.metarSource, this.windSource, this.stormSource]) void viewer.dataSources.add(ds);
  }

  async setRadar(on: boolean): Promise<void> {
    weatherLayers.value = { ...weatherLayers.value, radar: on };
    if (!on) {
      this.stopRadarAnimation();
      if (this.radarLayer) this.viewer.imageryLayers.remove(this.radarLayer, true);
      this.radarLayer = null;
      return;
    }
    try {
      const { host, frames } = await radarFrames();
      this.radarHost = host;
      const lastPast = frames.filter((f) => f.kind === "past").length - 1;
      radarState.value = { frames, index: Math.max(0, lastPast), playing: false, time: frames[lastPast]?.time ?? null };
      this.showRadarFrame(Math.max(0, lastPast));
    } catch (err) {
      notify(`Radar no disponible: ${err instanceof Error ? err.message : String(err)}`, "warning");
      weatherLayers.value = { ...weatherLayers.value, radar: false };
    }
  }

  showRadarFrame(i: number): void {
    const f = radarState.value.frames[i];
    if (!f) return;
    const layer = new ImageryLayer(
      new UrlTemplateImageryProvider({
        url: radarTileUrl(this.radarHost, f),
        maximumLevel: 7,
        tilingScheme: new WebMercatorTilingScheme(),
        credit: new Credit(`Radar: RainViewer (${f.kind === "nowcast" ? "pronóstico inmediato" : "observado"} ${new Date(f.time * 1000).toLocaleTimeString()})`),
      }),
      { alpha: 0.75 },
    );
    this.viewer.imageryLayers.add(layer);
    const old = this.radarLayer;
    this.radarLayer = layer;
    // Retira el fotograma anterior cuando el nuevo ya tuvo tiempo de cargar (transición sin parpadeo)
    if (old) setTimeout(() => this.viewer.imageryLayers.remove(old, true), 600);
    radarState.value = { ...radarState.value, index: i, time: f.time };
  }

  toggleRadarAnimation(): void {
    if (radarState.value.playing) return this.stopRadarAnimation();
    radarState.value = { ...radarState.value, playing: true };
    this.radarTimer = window.setInterval(() => {
      const n = radarState.value.frames.length;
      if (!n) return;
      this.showRadarFrame((radarState.value.index + 1) % n);
    }, 900);
  }

  private stopRadarAnimation() {
    if (this.radarTimer) clearInterval(this.radarTimer);
    this.radarTimer = null;
    radarState.value = { ...radarState.value, playing: false };
  }

  async setMetar(on: boolean, bbox?: { west: number; south: number; east: number; north: number }): Promise<void> {
    weatherLayers.value = { ...weatherLayers.value, metar: on };
    this.metarSource.entities.removeAll();
    if (!on || !bbox) return;
    try {
      this.metars = await metarsIn(bbox);
      for (const m of this.metars.slice(0, 400)) {
        const text = `${m.icao} ${m.temperature !== null ? m.temperature + "°C" : ""}${m.windSpeedKt !== null ? ` ${m.windSpeedKt} kt` : ""}`;
        this.metarSource.entities.add({
          id: `metar:${m.icao}`,
          position: Cartesian3.fromDegrees(m.lon, m.lat),
          point: { pixelSize: 8, color: Color.fromCssColorString("#34d399"), outlineColor: Color.WHITE, outlineWidth: 1.5, disableDepthTestDistance: Number.POSITIVE_INFINITY },
          label: {
            text,
            font: "600 12px Inter, system-ui, sans-serif",
            fillColor: Color.WHITE,
            showBackground: true,
            backgroundColor: Color.fromCssColorString("#052e1c").withAlpha(0.8),
            style: LabelStyle.FILL,
            pixelOffset: new Cartesian2(0, -14),
            verticalOrigin: VerticalOrigin.BOTTOM,
            scaleByDistance: new NearFarScalar(1e4, 1, 3e6, 0.5),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }
      if (!this.metars.length) notify("No hay estaciones METAR en esta vista. Alejá la cámara o movete a otra zona.", "info");
    } catch (err) {
      notify(`Observaciones METAR no disponibles: ${err instanceof Error ? err.message : String(err)}`, "warning");
    }
  }

  async setWind(on: boolean, bbox?: { west: number; south: number; east: number; north: number }): Promise<void> {
    weatherLayers.value = { ...weatherLayers.value, wind: on };
    this.windSource.entities.removeAll();
    if (!on || !bbox) return;
    try {
      this.grid = await forecastGrid(bbox, 9, 7);
      for (const s of this.grid) {
        if (!Number.isFinite(s.windSpeed)) continue;
        this.windSource.entities.add({
          id: `wind:${s.lat.toFixed(3)},${s.lon.toFixed(3)}`,
          position: Cartesian3.fromDegrees(s.lon, s.lat),
          billboard: {
            image: arrowCanvas(s.windSpeed),
            // El viento "viene de" windDirection: la flecha apunta hacia donde sopla.
            rotation: -((s.windDirection + 180) * Math.PI) / 180,
            alignedAxis: Cartesian3.UNIT_Z,
            scale: 0.8,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: `${Math.round(s.windSpeed)} km/h · ${Math.round(s.temperature)}°`,
            font: "600 11px Inter, system-ui, sans-serif",
            fillColor: Color.WHITE,
            outlineColor: Color.BLACK,
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cartesian2(0, 26),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }
    } catch (err) {
      notify(`Modelo de viento no disponible: ${err instanceof Error ? err.message : String(err)}`, "warning");
    }
  }

  async setStorms(on: boolean): Promise<void> {
    weatherLayers.value = { ...weatherLayers.value, storms: on };
    this.stormSource.entities.removeAll();
    if (!on) return;
    try {
      this.storms = await activeStorms();
      const colors: Record<string, string> = { Red: "#ef4444", Orange: "#f97316", Green: "#22c55e" };
      for (const s of this.storms) {
        this.stormSource.entities.add({
          id: `storm:${s.id}`,
          position: Cartesian3.fromDegrees(s.lon, s.lat),
          point: { pixelSize: 16, color: Color.fromCssColorString(colors[s.alertLevel] ?? "#eab308"), outlineColor: Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
          label: {
            text: `🌀 ${s.name}`,
            font: "700 13px Inter, system-ui, sans-serif",
            fillColor: Color.WHITE,
            outlineColor: Color.BLACK,
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cartesian2(0, -18),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }
      notify(this.storms.length ? `${this.storms.length} ciclones tropicales en GDACS.` : "No hay ciclones tropicales activos en GDACS.", "info");
    } catch (err) {
      notify(`Ciclones no disponibles: ${err instanceof Error ? err.message : String(err)}`, "warning");
    }
  }

  /** Efecto visual SIMULADO de precipitación alrededor de la cámara (sólo cerca del suelo). */
  setEffect(kind: "none" | "rain" | "snow" | "storm"): void {
    weatherEffect.value = kind;
    weatherLayers.value = { ...weatherLayers.value, effects: kind !== "none" };
    if (this.particles) {
      this.viewer.scene.primitives.remove(this.particles);
      this.particles = null;
    }
    if (kind === "none") return;
    const snow = kind === "snow";
    const img = document.createElement("canvas");
    img.width = snow ? 16 : 4;
    img.height = snow ? 16 : 24;
    const g = img.getContext("2d")!;
    if (snow) {
      g.fillStyle = "rgba(255,255,255,0.95)";
      g.beginPath();
      g.arc(8, 8, 6, 0, Math.PI * 2);
      g.fill();
    } else {
      const grad = g.createLinearGradient(0, 0, 0, 24);
      grad.addColorStop(0, "rgba(200,220,255,0)");
      grad.addColorStop(1, "rgba(200,220,255,0.75)");
      g.fillStyle = grad;
      g.fillRect(1, 0, 2, 24);
    }
    const viewer = this.viewer;
    const system = new ParticleSystem({
      image: img,
      startScale: 1,
      endScale: 1,
      imageSize: snow ? new Cartesian2(10, 10) : new Cartesian2(2, 22),
      emissionRate: kind === "storm" ? 9000 : snow ? 2500 : 5000,
      lifetime: 16,
      minimumParticleLife: snow ? 6 : 1.6,
      maximumParticleLife: snow ? 9 : 2.2,
      speed: snow ? 3 : 32,
      emitter: new BoxEmitter(new Cartesian3(260, 260, 40)),
      sizeInMeters: false,
      updateCallback: (p) => {
        // Gravedad y deriva lateral
        const down = Cartesian3.normalize(p.position, new Cartesian3());
        Cartesian3.multiplyByScalar(down, snow ? -0.04 : -0.9, down);
        Cartesian3.add(p.velocity, down, p.velocity);
      },
    });
    viewer.scene.primitives.add(system);
    this.particles = system;
    const follow = () => {
      if (!this.particles) return removeFollow();
      const cam = viewer.camera.positionWC;
      const m = Transforms.eastNorthUpToFixedFrame(cam);
      Matrix4.multiplyByTranslation(m, new Cartesian3(0, 0, 60), m);
      this.particles.modelMatrix = m;
      this.particles.show = viewer.camera.positionCartographic.height < 3000;
    };
    const removeFollow = viewer.scene.preRender.addEventListener(follow);
  }
}
