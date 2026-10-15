// Grabación y reproducción de repeticiones: muestras de todos los autos a 15 Hz
// (posición, rumbo, cabeceo, rolido, dirección, velocidad, compuesto, DRS) + eventos.

const HZ = 15;
const FIELDS = 9; // x y z heading pitch roll steer v flags
const COMP = ['soft', 'medium', 'hard', 'inter', 'wet'];

export class ReplayRecorder {
  constructor(session) {
    this.s = session;
    this.n = session.entrants.length;
    this.frames = [];
    this.acc = 0;
    this.events = [];
    this.meta = {
      trackId: session.track.id,
      entrants: session.entrants.map(e => ({ id: e.driver.id, name: e.fullName, code: e.code, teamId: e.team.id, isPlayer: e.isPlayer, num: e.driver.num })),
    };
    session.on((type, d) => {
      const keep = ['overtake', 'crash', 'spin', 'sc_deployed', 'lights_out', 'checkered', 'pit_stop', 'fastest_lap', 'contact', 'lockup'];
      if (keep.includes(type)) this.events.push({ t: this.time(), type, a: d.car ? d.car.index : d.a ? d.a.index : -1, b: d.victim ? d.victim.index : d.b ? d.b.index : -1 });
    });
    this.t0 = null;
  }

  time() { return this.frames.length / HZ; }

  update(dt) {
    const s = this.s;
    if (s.phase === 'grid' || s.phase === 'formation-ready') return;
    this.acc += dt;
    if (this.acc < 1 / HZ) return;
    this.acc -= 1 / HZ;
    if (this.frames.length > HZ * 60 * 45) return; // máximo 45 minutos
    const f = new Float32Array(this.n * FIELDS + 6);
    const ph = s.phys;
    s.entrants.forEach((e, i) => {
      let x = e.x, y = e.y, z = e.z, h = e.heading, steer = e.steerVis || 0, v = e.v;
      let pitch = e.pitch || 0, roll = 0;
      if (e.isPlayer && ph && !s.playerAuto) { x = ph.x; y = ph.y; z = ph.z; h = ph.psi; steer = ph.steerAngle; v = ph.speed; pitch += ph.ax * 0.0012; roll = -ph.ay * 0.0016; }
      else { pitch += (e.ax || 0) * 0.0012; roll = -(e.ay || 0) * 0.0015; }
      const hidden = (e.retired && (!e.retiredOnTrack || e.removed)) || e.inGarage;
      const flags = COMP.indexOf(e.compound) + (e.drsOpen ? 8 : 0) + (hidden ? 16 : 0) + ((e.brake || 0) > 0.3 ? 32 : 0);
      const o = i * FIELDS;
      f[o] = x; f[o + 1] = y; f[o + 2] = z; f[o + 3] = h; f[o + 4] = pitch; f[o + 5] = roll; f[o + 6] = steer; f[o + 7] = v; f[o + 8] = flags;
    });
    const b = this.n * FIELDS;
    const sc = s.safetyCar;
    f[b] = sc && sc.onTrack ? 1 : 0; f[b + 1] = sc ? sc.x : 0; f[b + 2] = sc ? sc.y : 0; f[b + 3] = sc ? sc.z : 0; f[b + 4] = sc ? sc.heading : 0;
    f[b + 5] = (s.lightsOn || 0) + (ph ? Math.floor(Math.min(15000, ph.rpm)) * 1000 : 0);
    this.frames.push(f);
  }

  finish(title) {
    const total = this.frames.length;
    const stride = this.n * FIELDS + 6;
    const data = new Float32Array(total * stride);
    this.frames.forEach((f, i) => data.set(f, i * stride));
    return {
      id: 'r' + Date.now(), title, date: new Date().toISOString(), duration: total / HZ,
      trackId: this.meta.trackId, entrants: this.meta.entrants, events: this.events, stride, hz: HZ, data,
    };
  }
}

// Reproduce una repetición: devuelve estados interpolados por auto
export class ReplayPlayer {
  constructor(rep) {
    this.rep = rep;
    this.t = 0;
    this.speed = 1;
    this.playing = true;
    this.n = rep.entrants.length;
    this.frames = rep.data.length / rep.stride;
  }

  get duration() { return this.rep.duration; }

  update(dt) {
    if (this.playing) this.t = Math.max(0, Math.min(this.duration - 1 / this.rep.hz, this.t + dt * this.speed));
  }

  sample() {
    const r = this.rep, hz = r.hz, st = r.stride, d = r.data;
    const fi = Math.min(this.frames - 2, Math.floor(this.t * hz));
    const k = Math.max(0, Math.min(1, this.t * hz - fi));
    const a = fi * st, b = (fi + 1) * st;
    const lerp = (i) => d[a + i] + (d[b + i] - d[a + i]) * k;
    const lerpAng = (i) => { let x = d[a + i], y = d[b + i]; let dd = y - x; while (dd > Math.PI) dd -= Math.PI * 2; while (dd < -Math.PI) dd += Math.PI * 2; return x + dd * k; };
    const cars = [];
    for (let i = 0; i < this.n; i++) {
      const o = i * 9;
      const flags = d[a + o + 8];
      cars.push({
        x: lerp(o), y: lerp(o + 1), z: lerp(o + 2), heading: lerpAng(o + 3), pitch: lerp(o + 4), roll: lerp(o + 5), steer: lerp(o + 6), v: lerp(o + 7),
        compound: COMP[flags & 7] || 'medium', drs: !!(flags & 8), hidden: !!(flags & 16), braking: !!(flags & 32),
      });
    }
    const base = this.n * 9;
    const sc = d[a + base] > 0.5 ? { x: lerp(base + 1), y: lerp(base + 2), z: lerp(base + 3), heading: lerpAng(base + 4) } : null;
    const misc = d[a + base + 5];
    return { cars, sc, lights: misc % 1000, rpm: Math.floor(misc / 1000) };
  }
}
