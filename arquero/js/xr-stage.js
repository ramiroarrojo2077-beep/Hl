import * as THREE from "three";
import { PixelReader } from "./pixels.js";

// Realidad aumentada con WebXR (Chrome en Android con ARCore):
// - hit-test: encuentra el piso real para apoyar el arco;
// - anchors: mantiene el arco fijo en el lugar aunque ARCore corrija el mapa;
// - camera-access: da la imagen de la cámara para reconocer la pelota y grabar.

export async function xrSupported() {
  try {
    return Boolean(navigator.xr) && (await navigator.xr.isSessionSupported("immersive-ar"));
  } catch {
    return false;
  }
}

export class XRStage {
  constructor(renderer, overlay) {
    this.renderer = renderer;
    this.overlay = overlay;
    this.reader = new PixelReader(renderer);
    this.session = null;
    this.hitSource = null;
    this.anchor = null;
    this.camMatrix = new THREE.Matrix4();
    this.projMatrix = new THREE.Matrix4();
    this.hitMatrix = new THREE.Matrix4();
    this.anchorMatrix = new THREE.Matrix4();
    this.camaraGrabacion = new THREE.PerspectiveCamera();
    this.camaraGrabacion.matrixAutoUpdate = false;
    this.texturaPropia = null;
    this.onEnd = null;
  }

  async start() {
    const session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["dom-overlay", "camera-access", "anchors", "local-floor"],
      domOverlay: { root: this.overlay },
    });
    this.session = session;
    this.renderer.xr.setReferenceSpaceType("local");
    await this.renderer.xr.setSession(session);
    const viewer = await session.requestReferenceSpace("viewer");
    this.hitSource = await session.requestHitTestSource({ space: viewer });
    session.addEventListener("end", () => {
      this.session = null;
      this.hitSource = null;
      this.anchor = null;
      this.onEnd?.();
    });
    // Los toques sobre botones del overlay no cuentan como "select" de la sesión.
    this.overlay.addEventListener("beforexrselect", (e) => {
      if (e.target.closest("button, .panel, video, a, input, select")) e.preventDefault();
    });
  }

  end() {
    this.session?.end();
  }

  get hasCameraAccess() {
    const f = this.session?.enabledFeatures;
    return f ? f.includes("camera-access") : null;
  }

  // Fija el arco en el último punto del piso encontrado.
  async anchorAtHit() {
    this.anchor?.delete?.();
    this.anchor = null;
    const hit = this.ultimoHit;
    if (!hit?.createAnchor) return;
    try {
      this.anchor = await hit.createAnchor();
    } catch {
      this.anchor = null;
    }
  }

  #texturaCamara(view) {
    const r = this.renderer;
    let tex = r.xr.getCameraTexture?.(view.camera);
    if (!tex) {
      // Versiones de Chrome que no informan enabledFeatures: la pedimos a mano.
      const binding = r.xr.getBinding?.();
      const gl = binding?.getCameraImage?.(view.camera);
      if (!gl) return null;
      this.texturaPropia ??= new THREE.ExternalTexture();
      this.texturaPropia.sourceTexture = gl;
      tex = this.texturaPropia;
    }
    return tex;
  }

  // Datos del cuadro para la app (ver app.js).
  frame(time, xrFrame, { pixels, record }) {
    const ref = this.renderer.xr.getReferenceSpace();
    const pose = xrFrame.getViewerPose(ref);
    if (!pose) return null;
    const view = pose.views[0];
    this.camMatrix.fromArray(view.transform.matrix);
    this.projMatrix.fromArray(view.projectionMatrix);

    let hit = null;
    this.ultimoHit = null;
    if (this.hitSource) {
      const resultados = xrFrame.getHitTestResults(this.hitSource);
      if (resultados.length) {
        const p = resultados[0].getPose(ref);
        if (p) {
          this.hitMatrix.fromArray(p.transform.matrix);
          hit = new THREE.Vector3().setFromMatrixPosition(this.hitMatrix);
          this.ultimoHit = resultados[0];
        }
      }
    }

    let anchor = null;
    if (this.anchor && xrFrame.trackedAnchors?.has(this.anchor)) {
      const p = xrFrame.getPose(this.anchor.anchorSpace, ref);
      if (p) anchor = new THREE.Vector3().setFromMatrixPosition(this.anchorMatrix.fromArray(p.transform.matrix));
    }

    let image = null;
    let texture = null;
    if (view.camera && (pixels || record)) texture = this.#texturaCamara(view);
    const ancho = view.camera?.width ?? window.innerWidth;
    const alto = view.camera?.height ?? window.innerHeight;
    if (texture && pixels) {
      const { width, height } = PixelReader.size(ancho, alto);
      image = { data: this.reader.read({ texture }, width, height), width, height };
    }

    return {
      t: time / 1000,
      camMatrix: this.camMatrix,
      projMatrix: this.projMatrix,
      image,
      hit,
      anchor,
      cameraAvailable: Boolean(view.camera),
      grabar: (recorder, escena) => {
        if (!texture) return;
        const c = this.camaraGrabacion;
        c.matrix.copy(this.camMatrix);
        c.updateMatrixWorld(true);
        c.projectionMatrix.copy(this.projMatrix);
        c.projectionMatrixInverse.copy(this.projMatrix).invert();
        recorder.capture({ texturaFondo: texture, escena, camara: c, ancho, alto });
      },
    };
  }

  render(scene, camera) {
    this.renderer.render(scene, camera);
  }
}
