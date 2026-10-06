import * as THREE from "three";

// Graba cada tiro con el arquero: compone la imagen de la cámara con la escena
// 3D en una textura, la lee de la GPU sin frenar el cuadro y la dibuja en un
// canvas 2D que se graba con MediaRecorder.
//
// Mientras se espera el remate hay siempre una grabación en curso; cada tanto se
// arranca otra y se descarta la vieja, así cada video tiene entre 4 y 14
// segundos previos al tiro. Cuando hay remate se conserva la más vieja y se corta
// unos segundos después del resultado.

const PREVIA_MINIMA = 4; // s
const RELEVO = 10; // s
// Cada cuadro del video se compone en la GPU y se lee a la CPU: es lo que más
// pesa al grabar. 540 px de lado largo es la mitad de píxeles que 720 (se ve
// bien en el celular) y 24 cuadros por segundo alcanzan para un video fluido.
const LADO_LARGO = 540; // px del video
const FPS = 24;

const TIPOS = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];

export function recordingSupported() {
  return typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function";
}

export class ShotRecorder {
  constructor(renderer) {
    this.renderer = renderer;
    this.canvas = document.createElement("canvas");
    this.ctx2d = this.canvas.getContext("2d");
    this.rt = null;
    // Hasta dos lecturas de la GPU a la vez (cada una con su memoria): si una
    // tarda, el cuadro siguiente no se pierde.
    this.lecturas = [];
    this.enCurso = 0;
    this.numero = 0;
    this.dibujado = 0;
    this.grabando = false;
    this.activas = [];
    this.tiro = null;
    this.clips = [];
    this.leyenda = null;
    this.marcador = "";
    this.onClip = null;
    this.tipo = TIPOS.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";

    // Pasada final: la escena 3D sale en espacio lineal y la cámara ya viene en
    // sRGB, así que se convierte la escena y se la pega encima de la cámara.
    this.camaraQuad = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // Se compone dado vuelta (y hacia abajo): así lo que se lee de la GPU ya
    // está en el orden de filas del canvas y no hay que copiarlo fila por fila.
    const vertex = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.x, -position.y, 0.0, 1.0); }";
    this.materialFondo = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, volteo: { value: new THREE.Vector2(0, 0) } },
      vertexShader:
        "uniform vec2 volteo; varying vec2 vUv; void main() { vUv = mix(uv, 1.0 - uv, volteo); gl_Position = vec4(position.x, -position.y, 0.0, 1.0); }",
      fragmentShader: "uniform sampler2D map; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(map, vUv).rgb, 1.0); }",
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide, // dado vuelta queda "de espaldas"
    });
    this.materialMezcla = new THREE.ShaderMaterial({
      uniforms: { map: { value: null } },
      vertexShader: vertex,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv;
        vec3 aSrgb(vec3 c) {
          c = clamp(c, 0.0, 1.0);
          return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
        }
        void main() {
          vec4 s = texture2D(map, vUv);
          if (s.a <= 0.002) discard;
          gl_FragColor = vec4(aSrgb(s.rgb / s.a), s.a);
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.materialFondo);
    this.quad.frustumCulled = false;
  }

  // Orientación de la imagen de la cámara (ver orientacion.js).
  setFlip(x, y) {
    this.materialFondo.uniforms.volteo.value.set(x ? 1 : 0, y ? 1 : 0);
  }

  get extension() {
    return this.tipo.startsWith("video/mp4") ? "mp4" : "webm";
  }

  #tamano(ancho, alto) {
    const k = LADO_LARGO / Math.max(ancho, alto);
    // Los códecs piden dimensiones pares.
    const w = Math.round((ancho * k) / 2) * 2;
    const h = Math.round((alto * k) / 2) * 2;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.rt?.dispose();
      this.rtSalida?.dispose();
      // Sin antialiasing por muestreo múltiple: a este tamaño casi no se nota y
      // cuesta bastante en la GPU del celular.
      this.rt = new THREE.WebGLRenderTarget(w, h);
      this.rtSalida = new THREE.WebGLRenderTarget(w, h);
      this.lecturas = [0, 1].map(() => {
        const buffer = new Uint8Array(w * h * 4);
        return { buffer, imagen: new ImageData(new Uint8ClampedArray(buffer.buffer), w, h), libre: true };
      });
    }
  }

  start() {
    if (this.grabando) return;
    this.grabando = true;
    // Cada cuadro se entrega al video cuando se termina de dibujar (requestFrame):
    // sin cuadros repetidos ni saltos por el reloj del stream. Si no se puede, a FPS fijos.
    this.stream = this.canvas.captureStream(0);
    this.pista = this.stream.getVideoTracks()[0];
    if (typeof this.pista?.requestFrame !== "function") {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = this.canvas.captureStream(FPS);
      this.pista = null;
    }
    this.activas = [this.#nueva()];
  }

  stop() {
    this.grabando = false;
    for (const g of this.activas) this.#descartar(g);
    this.activas = [];
    this.tiro = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.pista = null;
  }

  #nueva() {
    const rec = new MediaRecorder(this.stream, this.tipo ? { mimeType: this.tipo, videoBitsPerSecond: 2.5e6 } : undefined);
    const g = { rec, partes: [], desde: performance.now() / 1000, descartada: false };
    rec.ondataavailable = (e) => e.data.size && g.partes.push(e.data);
    rec.onstop = () => {
      if (g.descartada) return;
      const blob = new Blob(g.partes, { type: rec.mimeType || this.tipo || "video/webm" });
      const clip = { blob, url: URL.createObjectURL(blob), fecha: new Date(), resultado: g.resultado };
      this.clips.unshift(clip);
      this.onClip?.(clip);
    };
    rec.start(500);
    return g;
  }

  #descartar(g) {
    g.descartada = true;
    if (g.rec.state !== "inactive") g.rec.stop();
  }

  // Hubo remate: se queda con la grabación que más previa tiene.
  shotStarted() {
    if (!this.grabando || this.tiro) return;
    const [vieja, ...resto] = this.activas;
    resto.forEach((g) => this.#descartar(g));
    this.activas = vieja ? [vieja] : [];
    this.tiro = vieja ?? null;
  }

  // Falsa alarma: la grabación sigue como una más de la espera.
  shotCancelled() {
    this.tiro = null;
  }

  // Cierra el video del tiro `segundos` después y arranca a esperar el próximo.
  shotFinished(resultado, segundos = 2.5) {
    const g = this.tiro;
    if (!g) return;
    g.resultado = resultado;
    setTimeout(() => {
      if (g.rec.state !== "inactive") g.rec.stop();
      this.activas = this.activas.filter((x) => x !== g);
      this.tiro = null;
      // El cartel del resultado no tiene que aparecer al principio del próximo video.
      this.leyenda = null;
      if (this.grabando) this.activas.push(this.#nueva());
    }, segundos * 1000);
  }

  // Relevo de grabaciones mientras se espera el remate.
  #relevar() {
    if (this.tiro || !this.activas.length) return;
    const ahora = performance.now() / 1000;
    const ultima = this.activas[this.activas.length - 1];
    if (ahora - ultima.desde > RELEVO) this.activas.push(this.#nueva());
    if (this.activas.length > 1 && ahora - this.activas[1].desde > PREVIA_MINIMA) this.#descartar(this.activas.shift());
  }

  // Compone un cuadro. fondo: textura de la cámara (AR) o escena del mundo (demo).
  // camara: PerspectiveCamera con la pose y proyección de la vista.
  capture({ texturaFondo = null, escenaFondo = null, escena, camara, ancho, alto }) {
    if (!this.grabando) return;
    // No más de FPS cuadros por segundo (la pantalla puede ir a 60) y, si el
    // celular viene lento, algo menos: el seguimiento de la pelota tiene prioridad.
    const ahora = performance.now();
    const intervalo = ahora - (this.ultimaLlamada ?? ahora);
    this.ultimaLlamada = ahora;
    this.intervaloMedio = 0.9 * (this.intervaloMedio ?? 33) + 0.1 * Math.min(intervalo, 200);
    const minimo = this.intervaloMedio > 55 ? 1000 / 15 : this.intervaloMedio > 42 ? 1000 / 20 : 1000 / FPS - 4;
    if (ahora - (this.ultimoCuadro ?? 0) < minimo) return;
    this.#tamano(ancho, alto);
    const lectura = this.lecturas.find((l) => l.libre);
    if (!lectura) return; // las dos lecturas siguen en curso: se saltea este cuadro
    this.ultimoCuadro = ahora;
    this.#relevar();
    const r = this.renderer;
    const rtAnterior = r.getRenderTarget();
    const xrAnterior = r.xr.enabled;
    const autoClear = r.autoClear;
    r.xr.enabled = false;
    r.autoClear = false;

    // 1) Escena 3D (y en la demo, el mundo simulado) en lineal.
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.clear();
    if (escenaFondo) {
      r.render(escenaFondo, camara);
      r.clearDepth();
    }
    r.render(escena, camara);

    // 2) Cámara de fondo y la escena convertida encima.
    r.setRenderTarget(this.rtSalida);
    r.setClearColor(0x000000, 1);
    r.clear();
    if (texturaFondo) {
      this.quad.material = this.materialFondo;
      this.materialFondo.uniforms.map.value = texturaFondo;
      r.render(this.quad, this.camaraQuad);
    }
    this.quad.material = this.materialMezcla;
    this.materialMezcla.uniforms.map.value = this.rt.texture;
    r.render(this.quad, this.camaraQuad);

    r.setRenderTarget(rtAnterior);
    r.setClearColor(0x000000, 0);
    r.autoClear = autoClear;
    r.xr.enabled = xrAnterior;

    // La copia a la memoria se encarga ya (después se puede volver a dibujar en
    // rtSalida); se espera sin frenar el cuadro.
    lectura.libre = false;
    const numero = ++this.numero;
    const { width: w, height: h } = this.canvas;
    r.readRenderTargetPixelsAsync(this.rtSalida, 0, 0, w, h, lectura.buffer)
      .then(() => this.#dibujar(lectura, numero, w, h))
      .catch(() => {})
      .finally(() => {
        lectura.libre = true;
      });
  }

  #dibujar(lectura, numero, w, h) {
    if (w !== this.canvas.width || h !== this.canvas.height) return;
    // Uno más viejo que el último dibujado no va (quedaría para atrás).
    if (numero <= this.dibujado) return;
    this.dibujado = numero;
    // Ya viene en el orden del canvas (se compuso dado vuelta).
    const c = this.ctx2d;
    c.putImageData(lectura.imagen, 0, 0);

    const u = w / 400;
    c.font = `700 ${14 * u}px system-ui, sans-serif`;
    c.fillStyle = "rgba(0,0,0,0.45)";
    c.fillRect(10 * u, 10 * u, c.measureText(this.marcador).width + 20 * u, 26 * u);
    c.fillStyle = "#fff";
    c.textBaseline = "middle";
    c.fillText(this.marcador, 20 * u, 23 * u);
    c.textAlign = "right";
    c.fillStyle = "rgba(255,255,255,0.75)";
    c.fillText("ARQUERO AR", w - 12 * u, h - 18 * u);
    c.textAlign = "left";

    if (this.leyenda) {
      c.font = `900 ${52 * u}px system-ui, sans-serif`;
      c.textAlign = "center";
      c.lineWidth = 8 * u;
      c.strokeStyle = "rgba(0,0,0,0.6)";
      c.strokeText(this.leyenda.texto, w / 2, h * 0.3);
      c.fillStyle = this.leyenda.color;
      c.fillText(this.leyenda.texto, w / 2, h * 0.3);
      if (this.leyenda.detalle) {
        c.font = `800 ${24 * u}px system-ui, sans-serif`;
        c.lineWidth = 5 * u;
        c.strokeText(this.leyenda.detalle, w / 2, h * 0.3 + 46 * u);
        c.fillStyle = "#fff";
        c.fillText(this.leyenda.detalle, w / 2, h * 0.3 + 46 * u);
      }
      c.textAlign = "left";
    }
    this.pista?.requestFrame();
  }
}
