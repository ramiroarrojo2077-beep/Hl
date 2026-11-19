/**
 * Calidad gráfica adaptable: perfiles por dispositivo y regulador automático que baja o sube
 * la calidad según los FPS medidos (objetivo configurable, 60 por defecto).
 *
 * Cada perfil controla: densidad de píxeles (nitidez en pantallas de alta densidad), error de
 * pantalla del terreno, caché de teselas, antialiasing (MSAA/FXAA), sombras (de edificios y del
 * relieve), HDR con tonemapping, atmósfera por fragmento, oclusión ambiental y precarga de teselas.
 */
import { ShadowMode, Tonemapper, type Viewer } from "cesium";
import { effectiveQuality, fps, settings, type Quality } from "../state/store.ts";

export type Level = Exclude<Quality, "auto">;

interface Profile {
  /** Densidad de píxeles objetivo (se limita al devicePixelRatio real) */
  pixelRatio: number;
  maximumScreenSpaceError: number;
  tileCacheSize: number;
  msaa: number;
  fxaa: boolean;
  shadows: boolean;
  softShadows: boolean;
  /** El relieve proyecta sombras (no sólo las recibe). Desactivado: con mapas de sombras produce
   *  manchas por autosombreado; el relieve se sombrea con sus normales y recibe sombras de edificios. */
  terrainCastsShadows: boolean;
  shadowMapSize: number;
  /** HDR + tonemapping. Desactivado en todos los perfiles: medido, duplica el tinte azul de
   *  la atmósfera sobre el relieve (comparación A/B en los Alpes). */
  hdr: boolean;
  perFragmentAtmosphere: boolean;
  ambientOcclusion: boolean;
  preload: boolean;
  tilesetSse: number;
  loadingDescendantLimit: number;
  /** Vértices por lado de la malla de terreno en niveles de detalle altos */
  terrainGrid: number;
}

export const PROFILES: Record<Level, Profile> = {
  low: { pixelRatio: 0.75, maximumScreenSpaceError: 4, tileCacheSize: 80, msaa: 1, fxaa: true, shadows: false, softShadows: false, terrainCastsShadows: false, shadowMapSize: 1024, hdr: false, perFragmentAtmosphere: false, ambientOcclusion: false, preload: false, tilesetSse: 32, loadingDescendantLimit: 10, terrainGrid: 49 },
  medium: { pixelRatio: 1, maximumScreenSpaceError: 2.5, tileCacheSize: 150, msaa: 1, fxaa: true, shadows: false, softShadows: false, terrainCastsShadows: false, shadowMapSize: 2048, hdr: false, perFragmentAtmosphere: false, ambientOcclusion: false, preload: false, tilesetSse: 20, loadingDescendantLimit: 20, terrainGrid: 65 },
  high: { pixelRatio: 1.5, maximumScreenSpaceError: 1.75, tileCacheSize: 300, msaa: 4, fxaa: true, shadows: true, softShadows: true, terrainCastsShadows: false, shadowMapSize: 2048, hdr: false, perFragmentAtmosphere: true, ambientOcclusion: false, preload: true, tilesetSse: 12, loadingDescendantLimit: 24, terrainGrid: 97 },
  ultra: { pixelRatio: 2, maximumScreenSpaceError: 1.25, tileCacheSize: 600, msaa: 8, fxaa: false, shadows: true, softShadows: true, terrainCastsShadows: false, shadowMapSize: 4096, hdr: false, perFragmentAtmosphere: true, ambientOcclusion: true, preload: true, tilesetSse: 6, loadingDescendantLimit: 40, terrainGrid: 129 },
};

const ORDER: Level[] = ["low", "medium", "high", "ultra"];

/** Estimación inicial según el hardware (memoria, núcleos, GPU, pantalla). */
export function detectInitialLevel(gl?: WebGLRenderingContext | WebGL2RenderingContext | null): Level {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = nav.deviceMemory ?? 8;
  const cores = nav.hardwareConcurrency ?? 4;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  let renderer = "";
  try {
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    if (gl && ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  } catch {
    /* noop */
  }
  const software = /SwiftShader|llvmpipe|Software|Basic Render/i.test(renderer);
  if (software) return "low";
  if (mobile) {
    // GPUs móviles de gama alta (Adreno 7xx, Mali-G7xx/G9xx, Immortalis, Apple) soportan "alta".
    if (mem >= 8 && /Adreno \(TM\) [7-9]\d\d|Mali-G(7[1-9]|[89]\d|\d{3})|Immortalis|Apple/i.test(renderer)) return "high";
    return mem >= 6 ? "medium" : "low";
  }
  if (mem <= 4 || cores <= 4) return "medium";
  if (/RTX|Radeon RX [6-9]|Apple M[2-9]|Apple M1 (Pro|Max|Ultra)/i.test(renderer) && mem >= 16) return "ultra";
  return "high";
}

export class QualityManager {
  private level: Level;
  private frames: number[] = [];
  private lowWindows = 0;
  private highWindows = 0;
  private lastWindow = performance.now();
  private remove: () => void;
  private ceiling: Level;

  constructor(
    private viewer: Viewer,
    initial: Level,
  ) {
    this.level = initial;
    this.ceiling = initial === "ultra" ? "ultra" : initial === "low" ? "medium" : "high";
    viewer.useBrowserRecommendedResolution = false;
    this.apply(initial);
    this.remove = viewer.scene.postRender.addEventListener(() => this.onFrame());
  }

  get current(): Level {
    return this.level;
  }

  get profile(): Profile {
    return PROFILES[this.level];
  }

  apply(level: Level): void {
    this.level = level;
    effectiveQuality.value = level;
    const p = PROFILES[level];
    const v = this.viewer;
    const s = v.scene;
    const dpr = window.devicePixelRatio || 1;
    // resolutionScale se multiplica por devicePixelRatio: se limita la densidad efectiva.
    v.resolutionScale = Math.min(dpr, p.pixelRatio) / dpr;
    s.globe.maximumScreenSpaceError = p.maximumScreenSpaceError;
    s.globe.tileCacheSize = p.tileCacheSize;
    s.globe.loadingDescendantLimit = p.loadingDescendantLimit;
    s.globe.preloadAncestors = true;
    s.globe.preloadSiblings = p.preload;
    s.postProcessStages.fxaa.enabled = p.fxaa;
    try {
      s.msaaSamples = p.msaa;
    } catch {
      /* WebGL1 sin MSAA */
    }
    s.fog.enabled = true;
    s.highDynamicRange = p.hdr && s.highDynamicRangeSupported;
    if (s.highDynamicRange) {
      s.postProcessStages.tonemapper = Tonemapper.PBR_NEUTRAL;
      s.postProcessStages.exposure = 1.0;
    }
    if (s.skyAtmosphere) s.skyAtmosphere.perFragmentAtmosphere = p.perFragmentAtmosphere;
    const ao = s.postProcessStages.ambientOcclusion;
    ao.enabled = p.ambientOcclusion && settings.value.shadows;
    if (ao.enabled) {
      // Oclusión sutil: oscurece esquinas entre edificios y calles sin "halos".
      ao.uniforms["intensity"] = 1.6;
      ao.uniforms["bias"] = 0.12;
      ao.uniforms["lengthCap"] = 0.04;
      ao.uniforms["stepSize"] = 1.5;
      ao.uniforms["frustumLength"] = 2500;
      ao.uniforms["blurStepSize"] = 1.0;
    }
    const wantShadows = p.shadows && settings.value.shadows;
    v.shadows = wantShadows;
    v.terrainShadows = !wantShadows ? ShadowMode.DISABLED : p.terrainCastsShadows ? ShadowMode.ENABLED : ShadowMode.RECEIVE_ONLY;
    if (s.shadowMap) {
      s.shadowMap.softShadows = p.softShadows;
      s.shadowMap.size = p.shadowMapSize;
      s.shadowMap.darkness = 0.35;
      s.shadowMap.fadingEnabled = true;
      // Sesgo de sombras más alto para primitivas (edificios, árboles): evita el "acné" (franjas
      // onduladas) en fachadas grandes vistas en ángulo. Campo interno de Cesium: se usa si existe.
      const bias = (s.shadowMap as unknown as { _primitiveBias?: { normalOffsetScale: number; depthBias: number } })._primitiveBias;
      if (bias) {
        bias.normalOffsetScale = 0.6;
        bias.depthBias = 0.0004;
      }
    }
    for (let i = 0; i < s.primitives.length; i++) {
      const prim = s.primitives.get(i) as { maximumScreenSpaceError?: number };
      if (prim && "maximumScreenSpaceError" in prim && prim.maximumScreenSpaceError !== undefined) prim.maximumScreenSpaceError = p.tilesetSse;
    }
  }

  /** Distancia de sombras según la altura de la cámara (más cerca = sombras más definidas). */
  updateShadowDistance(heightAboveGround: number): void {
    const sm = this.viewer.scene.shadowMap;
    if (!sm || !this.viewer.shadows) return;
    const d = Math.min(30_000, Math.max(1_500, heightAboveGround * 8));
    if (Math.abs(sm.maximumDistance - d) / d > 0.15) sm.maximumDistance = d;
  }

  /** Reaplica el perfil actual (p. ej. tras cambiar la opción de sombras). */
  refresh(): void {
    this.apply(this.level);
  }

  setManual(level: Quality): void {
    if (level === "auto") return;
    this.ceiling = level;
    this.apply(level);
  }

  private onFrame(): void {
    const now = performance.now();
    this.frames.push(now);
    while (this.frames.length && this.frames[0]! < now - 1000) this.frames.shift();
    if (now - this.lastWindow < 2000) return;
    this.lastWindow = now;
    const measured = this.frames.length;
    fps.value = measured;
    if (settings.value.quality !== "auto" || document.hidden) return;
    const target = settings.value.targetFps;
    const idx = ORDER.indexOf(this.level);
    if (measured < target * 0.75) {
      this.highWindows = 0;
      if (++this.lowWindows >= 2 && idx > 0) {
        this.apply(ORDER[idx - 1]!);
        this.lowWindows = 0;
      }
    } else if (measured >= target * 0.97) {
      this.lowWindows = 0;
      // Subir es más conservador: 20 s estables y nunca por encima del techo del dispositivo.
      if (++this.highWindows >= 10 && idx < ORDER.indexOf(this.ceiling)) {
        this.apply(ORDER[idx + 1]!);
        this.highWindows = 0;
      }
    } else {
      this.lowWindows = 0;
      this.highWindows = 0;
    }
  }

  destroy(): void {
    this.remove();
  }
}
