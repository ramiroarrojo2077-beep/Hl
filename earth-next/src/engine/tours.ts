/**
 * Reproductor de recorridos cinematográficos, narrador (síntesis de voz del navegador)
 * y grabación de video del lienzo (WebM/MP4 según soporte del navegador).
 */
import { Cartesian3, Math as CMath, type Viewer } from "cesium";
import { signal } from "@preact/signals";
import { sampleTour, tourDuration, type CameraPose, type Keyframe, type Tour } from "../geo/tour.ts";
import { navMode, persisted, settings, notify } from "../state/store.ts";
import type { NavigationController } from "./navigation.ts";

export const tourState = signal<{ playing: boolean; time: number; duration: number; index: number; tourId: string | null }>({
  playing: false,
  time: 0,
  duration: 0,
  index: 0,
  tourId: null,
});
export const savedTours = persisted<Tour[]>("tours", []);
export const recording = signal<{ active: boolean; seconds: number; mime: string } | null>(null);

export class TourPlayer {
  private keyframes: Keyframe[] = [];
  private start = 0;
  private offset = 0;
  private removeTick: (() => void) | null = null;
  private prevMode = navMode.value;
  private lastNarrated = -1;
  private resolveDone: (() => void) | null = null;

  constructor(
    private viewer: Viewer,
    private nav: NavigationController,
  ) {}

  getPose(): CameraPose {
    const cam = this.viewer.camera;
    const c = cam.positionCartographic;
    return {
      lon: CMath.toDegrees(c.longitude),
      lat: CMath.toDegrees(c.latitude),
      height: c.height,
      heading: CMath.toDegrees(cam.heading),
      pitch: CMath.toDegrees(cam.pitch),
      roll: CMath.toDegrees(cam.roll),
    };
  }

  applyPose(p: CameraPose): void {
    this.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(p.lon, p.lat, p.height),
      orientation: { heading: CMath.toRadians(p.heading), pitch: CMath.toRadians(p.pitch), roll: CMath.toRadians(p.roll) },
    });
  }

  /** Reproduce los puntos clave; la promesa se resuelve al terminar o detener. */
  play(keyframes: Keyframe[], tourId: string | null = null, from = 0): Promise<void> {
    this.stop();
    if (keyframes.length < 2) return Promise.resolve();
    this.keyframes = keyframes;
    this.offset = from;
    this.start = performance.now();
    this.lastNarrated = -1;
    this.prevMode = navMode.value === "cinematic" ? this.prevMode : navMode.value;
    this.nav.setMode("cinematic");
    const duration = tourDuration(keyframes);
    tourState.value = { playing: true, time: from, duration, index: 0, tourId };
    if (settings.value.reducedMotion) {
      // Accesibilidad: sin animación, salta al final.
      this.applyPose(keyframes[keyframes.length - 1]!);
      this.finish();
      return Promise.resolve();
    }
    this.removeTick = this.viewer.scene.preRender.addEventListener(() => this.tick());
    return new Promise((resolve) => (this.resolveDone = resolve));
  }

  private tick() {
    const t = this.offset + (performance.now() - this.start) / 1000;
    const s = sampleTour(this.keyframes, t);
    if (!s) return this.finish();
    this.applyPose(s.pose);
    const kf = this.keyframes[s.index];
    if (s.holding && kf?.narration && this.lastNarrated !== s.index) {
      this.lastNarrated = s.index;
      speak(kf.narration);
    }
    tourState.value = { ...tourState.value, time: t, index: s.index };
    if (t >= tourState.value.duration) this.finish();
  }

  pause(): void {
    if (!tourState.value.playing) return;
    this.offset = tourState.value.time;
    this.removeTick?.();
    this.removeTick = null;
    tourState.value = { ...tourState.value, playing: false };
  }

  resume(): void {
    if (tourState.value.playing || !this.keyframes.length) return;
    this.start = performance.now();
    this.removeTick = this.viewer.scene.preRender.addEventListener(() => this.tick());
    tourState.value = { ...tourState.value, playing: true };
  }

  seek(t: number): void {
    const s = sampleTour(this.keyframes, t);
    if (s) this.applyPose(s.pose);
    this.offset = t;
    this.start = performance.now();
    tourState.value = { ...tourState.value, time: t };
  }

  private finish() {
    this.removeTick?.();
    this.removeTick = null;
    tourState.value = { ...tourState.value, playing: false };
    this.nav.setMode(this.prevMode === "cinematic" ? "orbital" : this.prevMode);
    this.resolveDone?.();
    this.resolveDone = null;
  }

  stop(): void {
    if (this.removeTick || tourState.value.playing) this.finish();
    window.speechSynthesis?.cancel();
  }
}

/** Narración con la voz del sistema (Web Speech API); no requiere servicios externos. */
export function speak(text: string): void {
  if (!settings.value.narrator || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = settings.value.lang === "es" ? "es-ES" : "en-US";
  const voices = window.speechSynthesis.getVoices();
  const v = voices.find((x) => x.lang.toLowerCase().startsWith(settings.value.lang));
  if (v) u.voice = v;
  u.rate = 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

// ---------------------------------------------------------------------------
// Grabación de video
// ---------------------------------------------------------------------------

export class CanvasRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private timer: number | null = null;
  private started = 0;

  constructor(private viewer: Viewer) {}

  static supportedMime(): string | null {
    if (typeof MediaRecorder === "undefined") return null;
    const candidates = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? null;
  }

  start(fps = 30, bitsPerSecond = 12_000_000): void {
    const mime = CanvasRecorder.supportedMime();
    if (!mime) {
      notify("Este navegador no permite grabar video del lienzo (MediaRecorder).", "error");
      return;
    }
    const canvas = this.viewer.scene.canvas;
    const stream = canvas.captureStream(fps);
    this.chunks = [];
    this.rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitsPerSecond });
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(1000);
    this.started = performance.now();
    recording.value = { active: true, seconds: 0, mime };
    this.timer = window.setInterval(() => {
      recording.value = { active: true, seconds: (performance.now() - this.started) / 1000, mime };
    }, 500);
  }

  stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.rec) return resolve(null);
      const rec = this.rec;
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: rec.mimeType });
        this.chunks = [];
        resolve(blob);
      };
      rec.stop();
      rec.stream.getTracks().forEach((t) => t.stop());
      this.rec = null;
      if (this.timer) clearInterval(this.timer);
      recording.value = null;
    });
  }

  get active(): boolean {
    return !!this.rec;
  }
}
