/**
 * Iluminación astronómica y control del tiempo de la escena:
 * sol y sombras según fecha/hora, ciclo día–noche, luces nocturnas, Luna, cielo estrellado,
 * atmósfera y animación acelerada del tiempo.
 */
import { ClockRange, ClockStep, DynamicAtmosphereLightingType, JulianDate, Moon, type Viewer } from "cesium";
import { sunPosition } from "../geo/astronomy.ts";
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
  private force = true;

  constructor(private viewer: Viewer) {
    const scene = viewer.scene;
    const globe = scene.globe;
    globe.enableLighting = true;
    globe.dynamicAtmosphereLighting = true;
    globe.dynamicAtmosphereLightingFromSun = true;
    globe.atmosphereLightIntensity = 10;
    globe.depthTestAgainstTerrain = true;
    // Relieve iluminado por el sol con una luz ambiente suave en las laderas en sombra.
    globe.lambertDiffuseMultiplier = 0.85;
    globe.vertexShadowDarkness = 0.62;
    // Atmósfera iluminada por la posición real del Sol, con un leve realce de color.
    scene.atmosphere.dynamicLighting = DynamicAtmosphereLightingType.SUNLIGHT;
    scene.atmosphere.saturationShift = -0.05;
    scene.atmosphere.brightnessShift = 0.03;
    scene.fog.density = 1.6e-4;
    scene.fog.minimumBrightness = 0.08;
    if (!scene.moon) scene.moon = new Moon();
    this.apply();
  }

  apply(): void {
    const s = settings.value;
    const scene = this.viewer.scene;
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = s.atmosphere;
    if (scene.skyBox) scene.skyBox.show = s.stars;
    if (scene.sun) scene.sun.show = true;
    if (scene.moon) scene.moon.show = s.stars;
    const globe = scene.globe;
    // Sin desvanecimiento por distancia: el sombreado depende del Sol real (o se apaga, ver abajo).
    globe.lightingFadeOutDistance = 0;
    globe.lightingFadeInDistance = 1;
    globe.nightFadeOutDistance = 0;
    globe.nightFadeInDistance = 1;
    this.force = true;
    const c = this.viewer.camera.positionCartographic;
    this.updateForCamera(c.height, (c.latitude * 180) / Math.PI, (c.longitude * 180) / Math.PI, JulianDate.toDate(this.viewer.clock.currentTime));
    scene.requestRender();
  }

  /**
   * Modo "auto": desde el espacio se ve el día y la noche reales; de cerca, si es de día en el
   * lugar, el relieve y los edificios se iluminan con el Sol real (luces y sombras); si es de
   * noche, se muestra con luz plena para poder leer la imagen. Modo "realista": siempre el Sol real.
   */
  updateForCamera(height: number, lat: number, lon: number, date: Date): void {
    const globe = this.viewer.scene.globe;
    let want = true;
    if (settings.value.lightingMode !== "realistic" && height < 2_000_000) {
      want = sunPosition(date, lat, lon).altitude > 1;
    }
    // La "atmósfera de suelo" da el halo azul visto desde el espacio; de cerca tiñe de azul las
    // laderas en sombra, así que sólo se muestra por encima de 60 km (la niebla sigue de cerca).
    const groundAtm = settings.value.atmosphere && height > 60_000;
    if (want !== globe.enableLighting || groundAtm !== globe.showGroundAtmosphere || this.force) {
      this.force = false;
      globe.enableLighting = want;
      globe.dynamicAtmosphereLighting = want;
      globe.showGroundAtmosphere = groundAtm;
    }
  }
}
