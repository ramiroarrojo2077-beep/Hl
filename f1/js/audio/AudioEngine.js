// Audio con Web Audio API: motor V6 turbo híbrido sintetizado a partir del régimen
// (frecuencia de encendido = rpm/20 Hz), turbo, MGU-K, cambios, petardeos, neumáticos,
// pianos, viento, grava, golpes, público, lluvia, pistolas de boxes, radio y motores
// rivales espacializados (HRTF + Doppler). El sonido cambia con la cámara.

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.ready = false;
  }

  // debe llamarse desde un gesto del usuario
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 4;
    this.master.connect(this.comp); this.comp.connect(ctx.destination);
    this.bus = {};
    for (const k of ['engine', 'sfx', 'amb']) { this.bus[k] = ctx.createGain(); this.bus[k].connect(this.master); }
    this.noiseBuf = this.makeNoise(2);
    this.applyVolumes();
    this.buildPlayer();
    this.buildSfx();
    this.buildAmbience();
    this.aiVoices = [0, 1, 2, 3, 4].map(() => this.makeAIVoice());
    this.ready = true;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    this.master.gain.value = (s.volMaster ?? 0.8);
    this.bus.engine.gain.value = (s.volEngine ?? 0.8);
    this.bus.sfx.gain.value = (s.volSfx ?? 0.8);
    this.bus.amb.gain.value = (s.volAmb ?? 0.6);
  }

  makeNoise(sec) {
    const ctx = this.ctx, n = ctx.sampleRate * sec;
    const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = last * 0.4 + w * 0.6; d[i] = last; }
    return b;
  }

  noiseSrc() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    s.start(0, Math.random() * 1.5);
    return s;
  }

  shaper(amount = 3) {
    const ws = this.ctx.createWaveShaper();
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; curve[i] = Math.tanh(x * amount) / Math.tanh(amount); }
    ws.curve = curve; ws.oversample = '2x';
    return ws;
  }

  panner(ref = 5) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = ref; p.rolloff = 1.1; p.rolloffFactor = 1.1; p.maxDistance = 3000;
    return p;
  }

  // ---------- motor del jugador ----------
  buildPlayer() {
    const ctx = this.ctx;
    const v = this.player = {};
    v.mix = ctx.createGain(); v.mix.gain.value = 0.0;
    v.o1 = ctx.createOscillator(); v.o1.type = 'sawtooth';
    v.o2 = ctx.createOscillator(); v.o2.type = 'square';
    v.o3 = ctx.createOscillator(); v.o3.type = 'sawtooth';
    v.o4 = ctx.createOscillator(); v.o4.type = 'triangle';
    v.g1 = ctx.createGain(); v.g1.gain.value = 0.5;
    v.g2 = ctx.createGain(); v.g2.gain.value = 0.16;
    v.g3 = ctx.createGain(); v.g3.gain.value = 0.32;
    v.g4 = ctx.createGain(); v.g4.gain.value = 0.12;
    v.o1.connect(v.g1); v.o2.connect(v.g2); v.o3.connect(v.g3); v.o4.connect(v.g4);
    // "rasp" de escape: ruido filtrado modulado en amplitud por el encendido
    v.noise = this.noiseSrc();
    v.nbp = ctx.createBiquadFilter(); v.nbp.type = 'bandpass'; v.nbp.Q.value = 1.4;
    v.nam = ctx.createGain(); v.nam.gain.value = 0;
    v.lfoG = ctx.createGain(); v.lfoG.gain.value = 0.25;
    v.o1.connect(v.lfoG); v.lfoG.connect(v.nam.gain);
    v.noise.connect(v.nbp); v.nbp.connect(v.nam);
    v.ws = this.shaper(2.5);
    v.lp = ctx.createBiquadFilter(); v.lp.type = 'lowpass'; v.lp.Q.value = 2.5;
    v.peak = ctx.createBiquadFilter(); v.peak.type = 'peaking'; v.peak.Q.value = 1.2; v.peak.gain.value = 5;
    for (const g of [v.g1, v.g2, v.g3, v.g4, v.nam]) g.connect(v.ws);
    v.ws.connect(v.lp); v.lp.connect(v.peak); v.peak.connect(v.mix);
    // turbo y MGU-K
    v.turbo = ctx.createOscillator(); v.turbo.type = 'sine';
    v.turboG = ctx.createGain(); v.turboG.gain.value = 0;
    v.turbo.connect(v.turboG); v.turboG.connect(v.mix);
    v.mguk = ctx.createOscillator(); v.mguk.type = 'sawtooth';
    v.mgukF = ctx.createBiquadFilter(); v.mgukF.type = 'bandpass'; v.mgukF.Q.value = 6;
    v.mgukG = ctx.createGain(); v.mgukG.gain.value = 0;
    v.mguk.connect(v.mgukF); v.mgukF.connect(v.mgukG); v.mgukG.connect(v.mix);
    v.pan = this.panner(4);
    v.mix.connect(v.pan); v.pan.connect(this.bus.engine);
    for (const o of [v.o1, v.o2, v.o3, v.o4, v.turbo, v.mguk]) o.start();
    v.lastThrottle = 0; v.crackle = 0;
  }

  makeAIVoice() {
    const ctx = this.ctx;
    const v = {};
    v.o1 = ctx.createOscillator(); v.o1.type = 'sawtooth';
    v.o2 = ctx.createOscillator(); v.o2.type = 'square';
    v.g2 = ctx.createGain(); v.g2.gain.value = 0.25;
    v.o2.connect(v.g2);
    v.ws = this.shaper(2);
    v.lp = ctx.createBiquadFilter(); v.lp.type = 'lowpass'; v.lp.frequency.value = 2500;
    v.gain = ctx.createGain(); v.gain.gain.value = 0;
    v.o1.connect(v.ws); v.g2.connect(v.ws); v.ws.connect(v.lp); v.lp.connect(v.gain);
    v.pan = this.panner(6);
    v.gain.connect(v.pan); v.pan.connect(this.bus.engine);
    v.o1.start(); v.o2.start();
    v.car = null; v.prevDist = null;
    return v;
  }

  // ---------- efectos ----------
  buildSfx() {
    const ctx = this.ctx;
    const mk = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    // chirrido de neumáticos
    this.squeal = { src: this.noiseSrc(), f: mk('bandpass', 1100, 5), g: ctx.createGain() };
    this.squeal.g.gain.value = 0;
    this.squeal.src.connect(this.squeal.f); this.squeal.f.connect(this.squeal.g); this.squeal.g.connect(this.bus.sfx);
    // pianos
    this.kerb = { o: ctx.createOscillator(), f: mk('lowpass', 180, 1), g: ctx.createGain() };
    this.kerb.o.type = 'square'; this.kerb.o.frequency.value = 38; this.kerb.g.gain.value = 0;
    this.kerb.o.connect(this.kerb.f); this.kerb.f.connect(this.kerb.g); this.kerb.g.connect(this.bus.sfx); this.kerb.o.start();
    // viento
    this.wind = { src: this.noiseSrc(), f: mk('lowpass', 700, 0.7), g: ctx.createGain() };
    this.wind.g.gain.value = 0;
    this.wind.src.connect(this.wind.f); this.wind.f.connect(this.wind.g); this.wind.g.connect(this.bus.sfx);
    // grava / pasto
    this.gravel = { src: this.noiseSrc(), f: mk('bandpass', 450, 0.8), g: ctx.createGain() };
    this.gravel.g.gain.value = 0;
    this.gravel.src.connect(this.gravel.f); this.gravel.f.connect(this.gravel.g); this.gravel.g.connect(this.bus.sfx);
    // estática de radio
    this.radioStatic = { src: this.noiseSrc(), f: mk('bandpass', 2200, 1.5), g: ctx.createGain() };
    this.radioStatic.g.gain.value = 0;
    this.radioStatic.src.connect(this.radioStatic.f); this.radioStatic.f.connect(this.radioStatic.g); this.radioStatic.g.connect(this.master);
  }

  buildAmbience() {
    const ctx = this.ctx;
    this.crowd = { src: this.noiseSrc(), f: ctx.createBiquadFilter(), g: ctx.createGain() };
    this.crowd.f.type = 'bandpass'; this.crowd.f.frequency.value = 900; this.crowd.f.Q.value = 0.6;
    this.crowd.g.gain.value = 0;
    this.crowd.src.connect(this.crowd.f); this.crowd.f.connect(this.crowd.g); this.crowd.g.connect(this.bus.amb);
    this.rainN = { src: this.noiseSrc(), f: ctx.createBiquadFilter(), g: ctx.createGain() };
    this.rainN.f.type = 'highpass'; this.rainN.f.frequency.value = 1800;
    this.rainN.g.gain.value = 0;
    this.rainN.src.connect(this.rainN.f); this.rainN.f.connect(this.rainN.g); this.rainN.g.connect(this.bus.amb);
  }

  // ---------- one-shots ----------
  burst({ dur = 0.08, freq = 1200, q = 1, gain = 0.4, type = 'bandpass', bus = 'sfx', when = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.bus[bus] || this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  tone({ freq = 1000, dur = 0.1, gain = 0.2, type = 'sine', when = 0, dest = null, slide = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.bus.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  shift() { this.burst({ dur: 0.05, freq: 300, q: 0.8, gain: 0.35 }); this.tone({ freq: 90, dur: 0.06, gain: 0.25, type: 'square' }); }
  impact(v) {
    const g = Math.min(1, v / 15);
    this.burst({ dur: 0.35, freq: 600, q: 0.5, gain: 0.9 * g, type: 'lowpass' });
    this.tone({ freq: 70, dur: 0.3, gain: 0.7 * g, type: 'sine', slide: -40 });
    this.burst({ dur: 0.5, freq: 3500, q: 2, gain: 0.25 * g, when: 0.03 });
  }
  radioBeep(end = false) {
    this.tone({ freq: end ? 900 : 1250, dur: 0.07, gain: 0.12, dest: this.master });
    this.tone({ freq: end ? 700 : 1500, dur: 0.07, gain: 0.1, when: 0.08, dest: this.master });
  }
  radioOn(on) { if (this.ready) this.radioStatic.g.gain.setTargetAtTime(on ? 0.025 : 0, this.ctx.currentTime, 0.05); }
  gun(when = 0) {
    for (let k = 0; k < 3; k++) {
      this.tone({ freq: 160 + Math.random() * 40, dur: 0.12, gain: 0.3, type: 'sawtooth', when: when + k * 0.14 });
      this.burst({ dur: 0.12, freq: 2600, q: 1.5, gain: 0.25, when: when + k * 0.14 });
    }
  }
  lightBeep() { this.tone({ freq: 880, dur: 0.12, gain: 0.08 }); }
  cheer() { if (this.ready) { this.crowdBoost = 1; } }

  // ---------- por cuadro ----------
  // p: { rpm, throttle, speed, gear, slide, lock, kerb, offTrack, surf, ers, interior, pos, shifted, impact, battery, tc }
  update(dt, p, listener, aiCars, env) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, v = this.player;
    // listener = cámara
    const L = ctx.listener;
    if (L.positionX) {
      L.positionX.setTargetAtTime(listener.pos.x, t, 0.02); L.positionY.setTargetAtTime(listener.pos.y, t, 0.02); L.positionZ.setTargetAtTime(listener.pos.z, t, 0.02);
      L.forwardX.setTargetAtTime(listener.fwd.x, t, 0.02); L.forwardY.setTargetAtTime(listener.fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(listener.fwd.z, t, 0.02);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(listener.pos.x, listener.pos.y, listener.pos.z);
      L.setOrientation(listener.fwd.x, listener.fwd.y, listener.fwd.z, 0, 1, 0);
    }
    if (p) {
      const f = Math.max(40, p.rpm / 20);
      const load = p.throttle;
      v.o1.frequency.setTargetAtTime(f, t, 0.015);
      v.o2.frequency.setTargetAtTime(f * 2, t, 0.015);
      v.o3.frequency.setTargetAtTime(f * 0.5, t, 0.015);
      v.o4.frequency.setTargetAtTime(f * 3, t, 0.015);
      v.nbp.frequency.setTargetAtTime(f * 3.2, t, 0.02);
      v.nam.gain.setTargetAtTime(0.06 + load * 0.25, t, 0.03);
      const interior = p.interior;
      const cutoff = (interior ? 900 : 1500) + load * (interior ? 2500 : 5500) + (p.rpm - 4000) * 0.25;
      v.lp.frequency.setTargetAtTime(cutoff, t, 0.03);
      v.peak.frequency.setTargetAtTime(f * 2, t, 0.03);
      const vol = (0.18 + load * 0.5) * (p.retired ? 0 : 1) * (p.shifting ? 0.45 : 1);
      v.mix.gain.setTargetAtTime(vol * (interior ? 1.25 : 1), t, 0.02);
      v.turbo.frequency.setTargetAtTime(2800 + p.rpm * 0.35, t, 0.05);
      v.turboG.gain.setTargetAtTime(0.012 * load * (p.rpm / 12000), t, 0.08);
      v.mguk.frequency.setTargetAtTime(200 + p.speed * 22, t, 0.05);
      v.mgukF.frequency.setTargetAtTime(400 + p.speed * 40, t, 0.05);
      v.mgukG.gain.setTargetAtTime(p.ers ? 0.03 : 0.008, t, 0.1);
      this.setPos(v.pan, p.pos, t);
      if (p.shifted) this.shift();
      // petardeo al soltar el acelerador
      if (v.lastThrottle > 0.6 && load < 0.1 && p.rpm > 9000) v.crackle = 0.6;
      v.lastThrottle = load;
      if (v.crackle > 0) {
        v.crackle -= dt;
        if (Math.random() < dt * 22) this.burst({ dur: 0.03, freq: 1800 + Math.random() * 1500, q: 1, gain: 0.3 + Math.random() * 0.3 });
      }
      // neumáticos
      const sq = Math.min(1, p.slide) * Math.min(1, p.speed / 15) * (p.wet ? 0.3 : 1);
      this.squeal.g.gain.setTargetAtTime(sq * 0.28, t, 0.04);
      this.squeal.f.frequency.setTargetAtTime(p.lock ? 1500 : 950 + p.slide * 200, t, 0.05);
      this.kerb.g.gain.setTargetAtTime(p.kerb ? Math.min(0.5, p.speed / 60) : 0, t, 0.02);
      this.kerb.o.frequency.setTargetAtTime(20 + p.speed * 0.9, t, 0.05);
      const w = Math.min(1, (p.speed / 85) ** 2);
      this.wind.g.gain.setTargetAtTime(w * (interior ? 0.22 : 0.12), t, 0.1);
      this.wind.f.frequency.setTargetAtTime(400 + p.speed * 12, t, 0.1);
      this.gravel.g.gain.setTargetAtTime(p.offTrack ? Math.min(0.5, p.speed / 30) : 0, t, 0.05);
      if (p.impact > 3) this.impact(p.impact);
    } else {
      v.mix.gain.setTargetAtTime(0, t, 0.1);
      this.squeal.g.gain.setTargetAtTime(0, t, 0.1);
      this.kerb.g.gain.setTargetAtTime(0, t, 0.1);
      this.wind.g.gain.setTargetAtTime(0, t, 0.1);
      this.gravel.g.gain.setTargetAtTime(0, t, 0.1);
    }
    // motores rivales: los más cercanos a la cámara
    const sorted = aiCars.map(c => ({ c, d: Math.hypot(c.x - listener.pos.x, c.y - listener.pos.y, c.z - listener.pos.z) }))
      .filter(o => o.d < 400).sort((a, b) => a.d - b.d).slice(0, this.aiVoices.length);
    const used = new Set();
    for (const o of sorted) {
      let voice = this.aiVoices.find(vv => vv.car === o.c);
      if (!voice) voice = this.aiVoices.find(vv => !used.has(vv) && !sorted.some(s2 => s2.c === vv.car));
      if (!voice) continue;
      if (voice.car !== o.c) { voice.car = o.c; voice.prevDist = o.d; }
      used.add(voice);
      const c = o.c;
      const radial = voice.prevDist !== null ? (voice.prevDist - o.d) / Math.max(dt, 1e-3) : 0;
      voice.prevDist = o.d;
      const doppler = 343 / Math.max(150, 343 - Math.max(-120, Math.min(120, radial)));
      const f = Math.max(60, (c.rpm || 9000) / 20) * doppler;
      voice.o1.frequency.setTargetAtTime(f, t, 0.03);
      voice.o2.frequency.setTargetAtTime(f * 2, t, 0.03);
      voice.lp.frequency.setTargetAtTime(1200 + (c.throttle || 0.5) * 3500, t, 0.05);
      voice.gain.gain.setTargetAtTime(0.12 + (c.throttle || 0.5) * 0.3, t, 0.05);
      this.setPos(voice.pan, c, t);
    }
    for (const vv of this.aiVoices) if (!used.has(vv)) { vv.gain.gain.setTargetAtTime(0, t, 0.08); vv.car = null; }
    // ambiente
    this.crowdBoost = Math.max(0, (this.crowdBoost || 0) - dt * 0.25);
    const crowdNear = env ? env.crowdNear : 0.3;
    this.crowd.g.gain.setTargetAtTime((0.03 + this.crowdBoost * 0.18) * crowdNear + 0.01, t, 0.3);
    this.rainN.g.gain.setTargetAtTime(env ? env.rain * 0.12 : 0, t, 0.5);
  }

  setPos(p, pos, t) {
    if (p.positionX) {
      p.positionX.setTargetAtTime(pos.x, t, 0.02); p.positionY.setTargetAtTime(pos.y + 0.5, t, 0.02); p.positionZ.setTargetAtTime(pos.z, t, 0.02);
    } else p.setPosition(pos.x, pos.y + 0.5, pos.z);
  }

  silence() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.player.mix.gain.setTargetAtTime(0, t, 0.05);
    for (const v of this.aiVoices) v.gain.gain.setTargetAtTime(0, t, 0.05);
    for (const x of [this.squeal, this.kerb, this.wind, this.gravel, this.crowd, this.rainN]) x.g.gain.setTargetAtTime(0, t, 0.1);
  }
}
