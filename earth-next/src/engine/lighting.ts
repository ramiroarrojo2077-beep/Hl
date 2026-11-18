/**
 * Iluminación astronómica y control del tiempo de la escena:
 * sol y sombras según fecha/hora, ciclo día–noche, luces nocturnas, Luna, cielo estrellado,
 * atmósfera y animación acelerada del tiempo.
 */
import { ClockRange, ClockStep, JulianDate, Moon, type Viewer } from "cesium";
import { sceneTime, settings, timeMultiplier, timePlaying } from "../state/store.ts";

export class TimeController {
  private lastPush = 0;

  constructor(private viewer: Viewer) {
    const clock = viewer.clock;
    clock.currentTime = JulianDate.now();
    clock.clockRange = ClockRange.UNBOUNDED;
    clock.clockStep = ClockStep.SYSTEM_CLOCK_MULTIPLIER;
    clock.multiplier = 1;
    clock.shouldAnimate = true; // la escena sigue la hora real por defecto
    timePlaying.value = true;
    viewer.clock.onTick.addEventListener(() => {
      const now = performance.now();
      if (now - this.lastPush > 250) {
        this.lastPush = now;
        sceneTime.value = JulianDate.toDate(viewer.clock.currentTime);
      }
    });
  }

  setTime(date: Date): void {
    this.viewer.clock.currentTime = JulianDate.fromDate(date);
    sceneTime.value = date;
    this.viewer.scene.requestRender();
  }

  now(): void {
    this.setTime(new Date());
    this.setMultiplier(1);
    this.play();
  }

  play(): void {
    this.viewer.clock.shouldAnimate = true;
    timePlaying.value = true;
  }

  pause(): void {
    this.viewer.clock.shouldAnimate = false;
    timePlaying.value = false;
  }

  setMultiplier(m: number): void {
    this.viewer.clock.multiplier = m;
    timeMultiplier.value = m;
  }

  /** Anima un día completo (24 h) en `seconds` segundos desde la hora actual de la escena. */
  animateDay(seconds = 30): void {
    this.setMultiplier((24 * 3600) / seconds);
    this.play();
  }

  get current(): Date {
    return JulianDate.toDate(this.viewer.clock.currentTime);
  }
}

export class LightingController {
  private litFromSpace = true;

  constructor(private viewer: Viewer) {
    const scene = viewer.scene;
    const globe = scene.globe;
    globe.enableLighting = true;
    globe.dynamicAtmosphereLighting = true;
    globe.dynamicAtmosphereLightingFromSun = true;
    globe.atmosphereLightIntensity = 10;
    globe.depthTestAgainstTerrain = true;
    if (!scene.moon) scene.moon = new Moon();
    this.apply();
  }

  apply(): void {
    const s = settings.value;
    const scene = this.viewer.scene;
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = s.atmosphere;
    scene.globe.showGroundAtmosphere = s.atmosphere;
    if (scene.skyBox) scene.skyBox.show = s.stars;
    if (scene.sun) scene.sun.show = true;
    if (scene.moon) scene.moon.show = s.stars;
    const globe = scene.globe;
    if (s.lightingMode === "realistic") {
      // Día y noche también de cerca: la ciudad queda a oscuras de noche.
      globe.lightingFadeOutDistance = 0;
      globe.lightingFadeInDistance = 1;
      globe.nightFadeOutDistance = 0;
      globe.nightFadeInDistance = 1;
    } else {
      // Sombreado solar desde el espacio; de cerca la imagen se ve con luz plena para poder leerla.
      globe.lightingFadeOutDistance = 1.5e6;
      globe.lightingFadeInDistance = 6e6;
      globe.nightFadeOutDistance = 1.5e6;
      globe.nightFadeInDistance = 6e6;
    }
    this.litFromSpace = true;
    this.updateForHeight(this.viewer.camera.positionCartographic.height);
    scene.requestRender();
  }

  /**
   * Modo "auto": sombreado solar (día/noche) visible desde el espacio y luz plena al acercarse
   * (bajo ~2000 km), para que la imagen se pueda leer a cualquier hora.
   */
  updateForHeight(height: number): void {
    const globe = this.viewer.scene.globe;
    const want = settings.value.lightingMode === "realistic" || height > 2_000_000;
    if (want !== globe.enableLighting || this.litFromSpace) {
      this.litFromSpace = false;
      globe.enableLighting = want;
      globe.dynamicAtmosphereLighting = want;
    }
  }
}
