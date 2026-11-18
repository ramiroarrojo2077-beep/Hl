/**
 * Calidad gráfica adaptable: perfiles por dispositivo y regulador automático que baja o sube
 * la calidad según los FPS medidos (objetivo configurable, 60 por defecto).
 */
import { ShadowMode, type Viewer } from "cesium";
import { effectiveQuality, fps, settings, type Quality } from "../state/store.ts";

type Level = Exclude<Quality, "auto">;

interface Profile {
  resolutionScale: number;
  maximumScreenSpaceError: number;
  tileCacheSize: number;
  msaa: number;
  fxaa: boolean;
  shadows: boolean;
  softShadows: boolean;
  fog: boolean;
  hdr: boolean;
  tilesetSse: number;
  loadingDescendantLimit: number;
}

export const PROFILES: Record<Level, Profile> = {
  low: { resolutionScale: 0.65, maximumScreenSpaceError: 4, tileCacheSize: 80, msaa: 1, fxaa: true, shadows: false, softShadows: false, fog: true, hdr: false, tilesetSse: 32, loadingDescendantLimit: 10 },
  medium: { resolutionScale: 0.85, maximumScreenSpaceError: 2.5, tileCacheSize: 150, msaa: 1, fxaa: true, shadows: false, softShadows: false, fog: true, hdr: false, tilesetSse: 20, loadingDescendantLimit: 20 },
  high: { resolutionScale: 1, maximumScreenSpaceError: 2, tileCacheSize: 300, msaa: 4, fxaa: true, shadows: true, softShadows: false, fog: true, hdr: false, tilesetSse: 16, loadingDescendantLimit: 20 },
  ultra: { resolutionScale: 1, maximumScreenSpaceError: 1.33, tileCacheSize: 600, msaa: 8, fxaa: false, shadows: true, softShadows: true, fog: true, hdr: true, tilesetSse: 8, loadingDescendantLimit: 40 },
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
  if (mobile) return mem >= 6 ? "medium" : "low";
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

  constructor(
    private viewer: Viewer,
    initial: Level,
  ) {
    this.level = initial;
    this.apply(initial);
    this.remove = viewer.scene.postRender.addEventListener(() => this.onFrame());
  }

  get current(): Level {
    return this.level;
  }

  apply(level: Level): void {
    this.level = level;
    effectiveQuality.value = level;
    const p = PROFILES[level];
    const v = this.viewer;
    const s = v.scene;
    v.resolutionScale = p.resolutionScale;
    s.globe.maximumScreenSpaceError = p.maximumScreenSpaceError;
    s.globe.tileCacheSize = p.tileCacheSize;
    s.globe.loadingDescendantLimit = p.loadingDescendantLimit;
    s.postProcessStages.fxaa.enabled = p.fxaa;
    try {
      s.msaaSamples = p.msaa;
    } catch {
      /* WebGL1 sin MSAA */
    }
    s.fog.enabled = p.fog;
    s.highDynamicRange = p.hdr && s.highDynamicRangeSupported;
    const wantShadows = p.shadows && settings.value.shadows;
    v.shadows = wantShadows;
    v.terrainShadows = wantShadows ? ShadowMode.RECEIVE_ONLY : ShadowMode.DISABLED;
    if (s.shadowMap) {
      s.shadowMap.softShadows = p.softShadows;
      s.shadowMap.size = level === "ultra" ? 4096 : 2048;
      s.shadowMap.maximumDistance = 6000;
    }
    for (let i = 0; i < s.primitives.length; i++) {
      const prim = s.primitives.get(i) as { maximumScreenSpaceError?: number; isCesium3DTileset?: boolean };
      if (prim && "maximumScreenSpaceError" in prim && prim.maximumScreenSpaceError !== undefined) prim.maximumScreenSpaceError = p.tilesetSse;
    }
  }

  /** Reaplica el perfil actual (p. ej. tras cambiar la opción de sombras). */
  refresh(): void {
    this.apply(this.level);
  }

  setManual(level: Quality): void {
    if (level === "auto") return;
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
      // Subir es más conservador: 20 s estables.
      if (++this.highWindows >= 10 && idx < ORDER.indexOf(detectCeiling())) {
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

let ceiling: Level | null = null;
function detectCeiling(): Level {
  if (!ceiling) ceiling = detectInitialLevel() === "ultra" ? "ultra" : "high";
  return ceiling;
}
