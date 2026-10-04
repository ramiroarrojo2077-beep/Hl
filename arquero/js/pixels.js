import * as THREE from "three";

// Lee una versión chica de la imagen de la cámara para el detector.
// La fila 0 del resultado es la de abajo (convención de WebGL).
export class PixelReader {
  constructor(renderer) {
    this.renderer = renderer;
    this.rt = null;
    this.data = null;
    this.escena = new THREE.Scene();
    this.camara = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: null } },
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: "uniform sampler2D map; varying vec2 vUv; void main() { gl_FragColor = texture2D(map, vUv); }",
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.escena.add(quad);
  }

  // Tamaño del buffer para una imagen de ancho × alto: el lado largo queda en `lado`.
  static size(ancho, alto, lado = 400) {
    const k = lado / Math.max(ancho, alto);
    return { width: Math.max(16, Math.round(ancho * k)), height: Math.max(16, Math.round(alto * k)) };
  }

  // fuente: {texture} (imagen de la cámara en AR) o {scene, camera} (demo).
  read(fuente, width, height) {
    if (!this.rt || this.rt.width !== width || this.rt.height !== height) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(width, height);
      this.data = new Uint8Array(width * height * 4);
    }
    const r = this.renderer;
    const rtAnterior = r.getRenderTarget();
    const xrAnterior = r.xr.enabled;
    r.xr.enabled = false;
    r.setRenderTarget(this.rt);
    if (fuente.texture) {
      this.material.uniforms.map.value = fuente.texture;
      r.render(this.escena, this.camara);
    } else {
      r.render(fuente.scene, fuente.camera);
    }
    r.readRenderTargetPixels(this.rt, 0, 0, width, height, this.data);
    r.setRenderTarget(rtAnterior);
    r.xr.enabled = xrAnterior;
    return this.data;
  }
}
