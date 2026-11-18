/**
 * Modos de navegación y control por teclado/ratón/táctil:
 *  - orbital: exploración desde el espacio (controlador estándar).
 *  - aerial: sobrevuelo; WASD/flechas desplazan, Q/E suben/bajan, con altura mínima sobre el terreno.
 *  - drone: cámara libre en 6 grados de libertad (mirar con el ratón, mover con WASD).
 *  - pedestrian: a la altura de los ojos, pegado al terreno, a velocidad de caminata.
 *  - satellite: vista cenital fija a alturas orbitales (LEO/MEO/GEO).
 *  - cinematic: la cámara la controla el reproductor de recorridos.
 */
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Math as CMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer,
} from "cesium";
import { navMode, settings, cameraState, type NavMode } from "../state/store.ts";

const KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "PageUp", "PageDown"]);

export const ORBITS = {
  leo: { name: "Órbita baja (EEI, 408 km)", height: 408_000 },
  sso: { name: "Heliosíncrona (Landsat, 705 km)", height: 705_000 },
  meo: { name: "Órbita media (GPS, 20 200 km)", height: 20_200_000 },
  geo: { name: "Geoestacionaria (35 786 km)", height: 35_786_000 },
} as const;

export class NavigationController {
  private pressed = new Set<string>();
  private handler: ScreenSpaceEventHandler;
  private looking = false;
  private lastMouse: Cartesian2 | null = null;
  private removeTick: () => void;
  private lastTime = performance.now();
  private velocity = new Cartesian3();
  private onKeyDown = (e: KeyboardEvent) => this.keyDown(e);
  private onKeyUp = (e: KeyboardEvent) => this.pressed.delete(e.code);
  private onBlur = () => this.pressed.clear();

  constructor(private viewer: Viewer) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    this.handler.setInputAction((e: { position: Cartesian2 }) => this.lookStart(e.position), ScreenSpaceEventType.LEFT_DOWN);
    this.handler.setInputAction(() => this.lookEnd(), ScreenSpaceEventType.LEFT_UP);
    this.handler.setInputAction((e: { endPosition: Cartesian2 }) => this.lookMove(e.endPosition), ScreenSpaceEventType.MOUSE_MOVE);
    this.removeTick = viewer.scene.preRender.addEventListener(() => this.tick());
  }

  private keyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (KEYS.has(e.code)) {
      this.pressed.add(e.code);
      if (e.code.startsWith("Arrow") || e.code.startsWith("Page")) e.preventDefault();
    }
  }

  get mode(): NavMode {
    return navMode.value;
  }

  setMode(mode: NavMode): void {
    const ctrl = this.viewer.scene.screenSpaceCameraController;
    navMode.value = mode;
    const free = mode === "drone" || mode === "pedestrian";
    ctrl.enableInputs = mode !== "cinematic";
    ctrl.enableRotate = !free;
    ctrl.enableTranslate = !free;
    ctrl.enableZoom = mode !== "pedestrian";
    ctrl.enableTilt = mode !== "satellite" && !free;
    ctrl.enableLook = !free;
    ctrl.minimumZoomDistance = mode === "pedestrian" ? 0.5 : mode === "aerial" ? 50 : 2;
    ctrl.maximumZoomDistance = mode === "satellite" ? 60_000_000 : 80_000_000;
    this.viewer.scene.camera.frustum && ((this.viewer.scene.camera.frustum as { fov?: number }).fov = CMath.toRadians(settings.value.fov));
    const cam = this.viewer.camera;
    if (mode === "satellite") {
      const c = cam.positionCartographic;
      const h = Math.max(c.height, ORBITS.leo.height);
      cam.flyTo({ destination: Cartesian3.fromRadians(c.longitude, c.latitude, h), orientation: { heading: 0, pitch: -CMath.PI_OVER_TWO, roll: 0 }, duration: 1.5 });
    } else if (mode === "pedestrian") {
      this.dropToGround();
    } else if (mode === "drone" || mode === "aerial") {
      // Nivela el horizonte para un vuelo cómodo
      const pitch = Math.min(-0.15, Math.max(cam.pitch, -0.6));
      cam.setView({ orientation: { heading: cam.heading, pitch, roll: 0 } });
    }
  }

  /** Coloca la cámara a la altura de los ojos sobre el terreno, mirando al horizonte. */
  dropToGround(target?: { lon: number; lat: number }): void {
    const cam = this.viewer.camera;
    const c = target ? Cartographic.fromDegrees(target.lon, target.lat) : cam.positionCartographic.clone();
    const ground = this.viewer.scene.globe.getHeight(c) ?? 0;
    const eye = ground + settings.value.pedestrianEyeHeight;
    const dest = Cartesian3.fromRadians(c.longitude, c.latitude, eye);
    if (settings.value.reducedMotion) cam.setView({ destination: dest, orientation: { heading: cam.heading, pitch: 0, roll: 0 } });
    else cam.flyTo({ destination: dest, orientation: { heading: cam.heading, pitch: CMath.toRadians(-2), roll: 0 }, duration: 2 });
  }

  goToOrbit(kind: keyof typeof ORBITS): void {
    const cam = this.viewer.camera;
    const c = cam.positionCartographic;
    cam.flyTo({ destination: Cartesian3.fromRadians(c.longitude, c.latitude, ORBITS[kind].height), orientation: { heading: 0, pitch: -CMath.PI_OVER_TWO, roll: 0 }, duration: 2.5 });
  }

  private lookStart(p: Cartesian2) {
    if (this.mode !== "drone" && this.mode !== "pedestrian") return;
    this.looking = true;
    this.lastMouse = p.clone();
  }

  private lookEnd() {
    this.looking = false;
    this.lastMouse = null;
  }

  private lookMove(p: Cartesian2) {
    if (!this.looking || !this.lastMouse) return;
    const dx = p.x - this.lastMouse.x;
    const dy = p.y - this.lastMouse.y;
    this.lastMouse = p.clone();
    const cam = this.viewer.camera;
    const k = 0.0025 * settings.value.sensitivity;
    const heading = cam.heading - dx * k;
    const pitch = CMath.clamp(cam.pitch - dy * k, -CMath.PI_OVER_TWO + 0.01, CMath.PI_OVER_TWO - 0.01);
    cam.setView({ orientation: { heading, pitch, roll: 0 } });
  }

  /** Movimiento continuo por teclado, escalado por la altura y el tiempo de fotograma. */
  private tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const mode = this.mode;
    if (mode === "cinematic") return;
    const p = this.pressed;
    const cam = this.viewer.camera;
    const hag = Math.max(1, cameraState.value.heightAboveGround);
    const fast = p.has("ShiftLeft") || p.has("ShiftRight") ? 4 : 1;
    const speedSetting = settings.value.navSpeed;

    let speed: number;
    if (mode === "pedestrian") speed = 1.4 * fast * speedSetting * 2;
    else if (mode === "drone") speed = Math.max(5, hag * 0.6) * fast * speedSetting;
    else speed = Math.max(20, hag * 0.9) * fast * speedSetting;

    const forward = (p.has("KeyW") ? 1 : 0) - (p.has("KeyS") ? 1 : 0) + (mode !== "orbital" ? (p.has("ArrowUp") ? 1 : 0) - (p.has("ArrowDown") ? 1 : 0) : 0);
    const strafe = (p.has("KeyD") ? 1 : 0) - (p.has("KeyA") ? 1 : 0);
    const vertical = (p.has("KeyE") || p.has("PageUp") ? 1 : 0) - (p.has("KeyQ") || p.has("PageDown") ? 1 : 0);
    const turn = (p.has("ArrowRight") ? 1 : 0) - (p.has("ArrowLeft") ? 1 : 0);

    if (mode === "orbital" || mode === "satellite") {
      // Flechas giran el globo; W/S acercan/alejan
      const rate = (Math.min(hag, 2e7) / 6.4e6) * dt * 1.2 * speedSetting;
      if (p.has("ArrowLeft")) cam.rotateRight(-rate);
      if (p.has("ArrowRight")) cam.rotateRight(rate);
      if (p.has("ArrowUp")) cam.rotateUp(rate);
      if (p.has("ArrowDown")) cam.rotateUp(-rate);
      if (forward) cam.zoomIn(forward * hag * dt * 1.5 * fast);
      if (strafe) cam.rotateRight(strafe * rate);
      if (vertical) cam.moveUp(vertical * hag * dt);
      return;
    }

    if (turn) cam.setView({ orientation: { heading: cam.heading + turn * dt * 1.2 * settings.value.sensitivity, pitch: cam.pitch, roll: 0 } });

    if (!forward && !strafe && !vertical) {
      Cartesian3.multiplyByScalar(this.velocity, 0.85, this.velocity);
      if (Cartesian3.magnitude(this.velocity) < 0.01) return;
    } else {
      const dir = new Cartesian3();
      const up = this.viewer.scene.globe.ellipsoid.geodeticSurfaceNormal(cam.positionWC, new Cartesian3());
      let fwd = cam.directionWC.clone();
      if (mode === "pedestrian" || mode === "aerial") {
        // Movimiento horizontal: proyecta la dirección sobre el plano tangente
        const dot = Cartesian3.dot(fwd, up);
        fwd = Cartesian3.normalize(Cartesian3.subtract(fwd, Cartesian3.multiplyByScalar(up, dot, new Cartesian3()), new Cartesian3()), new Cartesian3());
      }
      const right = Cartesian3.normalize(Cartesian3.cross(fwd, up, new Cartesian3()), new Cartesian3());
      Cartesian3.add(dir, Cartesian3.multiplyByScalar(fwd, forward, new Cartesian3()), dir);
      Cartesian3.add(dir, Cartesian3.multiplyByScalar(right, strafe, new Cartesian3()), dir);
      if (mode !== "pedestrian") Cartesian3.add(dir, Cartesian3.multiplyByScalar(up, vertical, new Cartesian3()), dir);
      if (Cartesian3.magnitude(dir) > 0) Cartesian3.normalize(dir, dir);
      const target = Cartesian3.multiplyByScalar(dir, speed, new Cartesian3());
      Cartesian3.lerp(this.velocity, target, Math.min(1, dt * 8), this.velocity);
    }
    const step = Cartesian3.multiplyByScalar(this.velocity, dt, new Cartesian3());
    const next = Cartesian3.add(cam.positionWC, step, new Cartesian3());
    const carto = Cartographic.fromCartesian(next);
    if (!carto) return;
    const ground = this.viewer.scene.globe.getHeight(carto) ?? 0;
    if (mode === "pedestrian") carto.height = ground + settings.value.pedestrianEyeHeight;
    else if (mode === "aerial") carto.height = Math.max(carto.height, ground + 50);
    else carto.height = Math.max(carto.height, ground + 2);
    cam.setView({ destination: Cartographic.toCartesian(carto), orientation: { heading: cam.heading, pitch: cam.pitch, roll: 0 } });
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.handler.destroy();
    this.removeTick();
  }
}
