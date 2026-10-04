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
      // region: (x, y, ancho, alto) de la imagen a leer, en coordenadas 0..1.
      // volteo: (1, 0) espeja, (0, 1) da vuelta; corrige cómo llega la imagen de la cámara.
      uniforms: {
        map: { value: null },
        region: { value: new THREE.Vector4(0, 0, 1, 1) },
        volteo: { value: new THREE.Vector2(0, 0) },
      },
      vertexShader:
        "uniform vec4 region; uniform vec2 volteo; varying vec2 vUv; void main() { vec2 p = region.xy + uv * region.zw; vUv = mix(p, 1.0 - p, volteo); gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: "uniform sampler2D map; varying vec2 vUv; void main() { gl_FragColor = texture2D(map, vUv); }",
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.escena.add(quad);
  }

  // Orientación de la imagen de la cámara (ver orientacion.js).
  setFlip(x, y) {
    this.material.uniforms.volteo.value.set(x ? 1 : 0, y ? 1 : 0);
  }

  // Tamaño del buffer para una imagen de ancho × alto: el lado largo queda en `lado`.
  static size(ancho, alto, lado = 400) {
    const k = lado / Math.max(ancho, alto);
    return { width: Math.max(16, Math.round(ancho * k)), height: Math.max(16, Math.round(alto * k)) };
  }

  // fuente: {texture} (imagen de la cámara en AR) o {scene, camera} (demo).
  read(fuente, width, height) {
    this.principal = this.#leer(this.principal, fuente, null, width, height);
    return this.principal.data;
  }

  // Lee sólo una parte de la imagen, con otra resolución (para medir la pelota
  // más fino). region: {x, y, w, h} en coordenadas 0..1, con y hacia arriba.
  readRegion(fuente, region, width, height) {
    this.recorte = this.#leer(this.recorte, fuente, region, width, height);
    return this.recorte.data;
  }

  #leer(destino, fuente, region, width, height) {
    if (!destino || destino.rt.width !== width || destino.rt.height !== height) {
      destino?.rt.dispose();
      destino = { rt: new THREE.WebGLRenderTarget(width, height), data: new Uint8Array(width * height * 4) };
    }
    const r = this.renderer;
    const rtAnterior = r.getRenderTarget();
    const xrAnterior = r.xr.enabled;
    r.xr.enabled = false;
    r.setRenderTarget(destino.rt);
    if (fuente.texture) {
      this.material.uniforms.map.value = fuente.texture;
      if (region) this.material.uniforms.region.value.set(region.x, region.y, region.w, region.h);
      r.render(this.escena, this.camara);
      this.material.uniforms.region.value.set(0, 0, 1, 1);
    } else {
      const cam = fuente.camera;
      if (region) {
        // Una "imagen completa" de 1000 px de alto con la proporción de la cámara.
        const alto = 1000;
        const ancho = alto * cam.aspect;
        cam.setViewOffset(ancho, alto, region.x * ancho, (1 - region.y - region.h) * alto, region.w * ancho, region.h * alto);
      }
      r.render(fuente.scene, cam);
      if (region) cam.clearViewOffset();
    }
    r.readRenderTargetPixels(destino.rt, 0, 0, width, height, destino.data);
    r.setRenderTarget(rtAnterior);
    r.xr.enabled = xrAnterior;
    return destino;
  }
}
