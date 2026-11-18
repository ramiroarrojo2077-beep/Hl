/**
 * Visor de panorámicas equirectangulares 360° en WebGL (sin dependencias).
 * Arrastrar para mirar, rueda/pellizco para zoom, flechas para girar.
 */

const VERT = `attribute vec2 p; varying vec2 v; void main(){ v=p; gl_Position=vec4(p,0.0,1.0); }`;
const FRAG = `precision highp float;
varying vec2 v;
uniform sampler2D tex;
uniform float yaw; uniform float pitch; uniform float fov; uniform float aspect;
const float PI = 3.141592653589793;
void main(){
  float t = tan(fov*0.5);
  vec3 d = normalize(vec3(v.x*t*aspect, v.y*t, -1.0));
  float cp = cos(pitch), sp = sin(pitch);
  d = vec3(d.x, d.y*cp + d.z*sp, -d.y*sp + d.z*cp);
  float cy = cos(yaw), sy = sin(yaw);
  d = vec3(d.x*cy - d.z*sy, d.y, d.x*sy + d.z*cy);
  float u = atan(d.x, -d.z) / (2.0*PI) + 0.5;
  float w = acos(clamp(d.y, -1.0, 1.0)) / PI;
  gl_FragColor = texture2D(tex, vec2(u, w));
}`;

export interface PanoramaView {
  yaw: number; // grados, 0 = centro de la imagen
  pitch: number;
  fov: number;
}

export class PanoramaViewer {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private tex: WebGLTexture;
  private raf = 0;
  private dragging: { x: number; y: number } | null = null;
  private pinch: number | null = null;
  view: PanoramaView = { yaw: 0, pitch: 0, fov: 75 };
  onChange?: (v: PanoramaView) => void;
  private ro: ResizeObserver;
  private disposed = false;
  private keyHandler = (e: KeyboardEvent) => {
    const step = 4;
    if (e.key === "ArrowLeft") this.set({ yaw: this.view.yaw - step });
    else if (e.key === "ArrowRight") this.set({ yaw: this.view.yaw + step });
    else if (e.key === "ArrowUp") this.set({ pitch: this.view.pitch + step });
    else if (e.key === "ArrowDown") this.set({ pitch: this.view.pitch - step });
    else if (e.key === "+" || e.key === "=") this.set({ fov: this.view.fov - 5 });
    else if (e.key === "-") this.set({ fov: this.view.fov + 5 });
    else return;
    e.preventDefault();
  };

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL no disponible para el visor de panorámicas");
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    this.prog = prog;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([20, 24, 32, 255]));
    canvas.addEventListener("pointerdown", this.down);
    window.addEventListener("pointermove", this.move);
    window.addEventListener("pointerup", this.up);
    canvas.addEventListener("wheel", this.wheel, { passive: false });
    canvas.addEventListener("touchmove", this.touch, { passive: false });
    canvas.addEventListener("touchend", () => (this.pinch = null));
    canvas.tabIndex = 0;
    canvas.addEventListener("keydown", this.keyHandler);
    this.ro = new ResizeObserver(() => this.render());
    this.ro.observe(canvas);
  }

  async load(url: string): Promise<void> {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.src = url;
    await img.decode();
    if (this.disposed) return;
    const gl = this.gl;
    // Texturas grandes: se escala al máximo soportado.
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    let source: TexImageSource = img;
    if (img.naturalWidth > max) {
      const c = document.createElement("canvas");
      c.width = max;
      c.height = Math.round((img.naturalHeight * max) / img.naturalWidth);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      source = c;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.render();
  }

  set(v: Partial<PanoramaView>): void {
    this.view = {
      yaw: (((v.yaw ?? this.view.yaw) % 360) + 360) % 360,
      pitch: Math.max(-85, Math.min(85, v.pitch ?? this.view.pitch)),
      fov: Math.max(25, Math.min(110, v.fov ?? this.view.fov)),
    };
    this.onChange?.(this.view);
    this.render();
  }

  private render = () => {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      const gl = this.gl;
      const c = this.canvas;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(c.clientWidth * dpr);
      const h = Math.round(c.clientHeight * dpr);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.useProgram(this.prog);
      const u = (n: string) => gl.getUniformLocation(this.prog, n);
      gl.uniform1f(u("yaw"), (this.view.yaw * Math.PI) / 180);
      gl.uniform1f(u("pitch"), (this.view.pitch * Math.PI) / 180);
      gl.uniform1f(u("fov"), (this.view.fov * Math.PI) / 180);
      gl.uniform1f(u("aspect"), w / Math.max(1, h));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });
  };

  private down = (e: PointerEvent) => {
    this.dragging = { x: e.clientX, y: e.clientY };
    this.canvas.setPointerCapture?.(e.pointerId);
  };
  private move = (e: PointerEvent) => {
    if (!this.dragging) return;
    const k = this.view.fov / Math.max(1, this.canvas.clientHeight);
    this.set({ yaw: this.view.yaw - (e.clientX - this.dragging.x) * k, pitch: this.view.pitch + (e.clientY - this.dragging.y) * k });
    this.dragging = { x: e.clientX, y: e.clientY };
  };
  private up = () => (this.dragging = null);
  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.set({ fov: this.view.fov + e.deltaY * 0.05 });
  };
  private touch = (e: TouchEvent) => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const [a, b] = [e.touches[0]!, e.touches[1]!];
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (this.pinch !== null) this.set({ fov: this.view.fov * (this.pinch / d) });
    this.pinch = d;
  };

  snapshot(): string {
    return this.canvas.toDataURL("image/jpeg", 0.92);
  }

  destroy(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener("pointermove", this.move);
    window.removeEventListener("pointerup", this.up);
    this.canvas.removeEventListener("keydown", this.keyHandler);
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
