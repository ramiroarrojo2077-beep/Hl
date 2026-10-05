// Sonidos sintetizados (sin archivos): silbato, hinchada y atajada.
export class Sounds {
  constructor() {
    this.ctx = null;
  }

  // Hay que llamarlo desde un toque del usuario.
  unlock() {
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === "suspended") this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  #ruido(duracion) {
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duracion, ctx.sampleRate);
    const datos = buffer.getChannelData(0);
    for (let i = 0; i < datos.length; i++) datos[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    return src;
  }

  #hinchada(duracion, frecuencia, volumen) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this.#ruido(duracion);
    const filtro = ctx.createBiquadFilter();
    filtro.type = "bandpass";
    filtro.frequency.value = frecuencia;
    filtro.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(volumen, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duracion);
    src.connect(filtro).connect(g).connect(ctx.destination);
    src.start(t);
  }

  whistle() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const g = ctx.createGain();
    osc.frequency.value = 2900;
    lfo.frequency.value = 38;
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(osc.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.03);
    g.gain.setValueAtTime(0.18, t + 0.32);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.42);
    lfo.stop(t + 0.42);
  }

  goal() {
    if (!this.ctx) return;
    this.#hinchada(2.4, 900, 0.5);
    this.#hinchada(2.4, 450, 0.35);
  }

  save() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    // Golpe seco en los guantes.
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.15);
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
    // "¡Uhhh!" de la tribuna.
    this.#hinchada(1.4, 320, 0.35);
  }

  miss() {
    if (!this.ctx) return;
    this.#hinchada(1.0, 280, 0.2);
  }
}
