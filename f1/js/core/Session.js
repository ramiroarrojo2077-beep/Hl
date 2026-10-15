// Sesión de pista: carrera, clasificación, entrenamientos o contrarreloj.
// Maneja jugador + IA, cronometraje, posiciones, boxes, banderas, Safety Car,
// clima, penalizaciones, abandonos y emite eventos para relato, radio y audio.

import { Entrant } from './Entrant.js';
import { AIDriver, basePerf } from './AIDriver.js';
import { CarPhysics, buildSpec, wearGrip } from './CarPhysics.js';
import { COMPOUNDS, DRIVERS, TEAMS, TEAM_BY_ID, POINTS } from '../data/teams.js';
import { PIT_SPEED } from './Track.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += Math.random(); return (u - 3) / 1.0; };

export const SESSION_LABEL = { race: 'Carrera', quali: 'Clasificación', practice: 'Entrenamientos', timetrial: 'Contrarreloj' };

export class Session {
  // opts: { type, laps, minutes, difficulty, weather, playerDriverId, playerTeamId, playerName,
  //         formationLap, assists, wearMode, damage, failures, grid (ids ordenados), setup, startCompound, aiCount }
  constructor(track, opts) {
    this.track = track;
    this.opts = opts;
    this.type = opts.type || 'race';
    this.listeners = [];
    this.t = 0; // tiempo total de sesión
    this.raceTime = 0;
    this.phase = 'grid';
    this.rho = 1.225 * Math.exp(-track.meta.altitude / 8500);
    this.airTemp = track.meta.env.temp;
    this.trackTemp = this.airTemp + 12;
    this.laps = opts.laps || 5;
    this.lengthFactor = this.type === 'race' ? track.meta.laps / this.laps : 1;
    const wm = opts.wearMode || 'proporcional';
    const lf = Math.min(this.lengthFactor, 12);
    this.wearScale = wm === 'real' ? 1 : wm === 'reducido' ? Math.max(1, lf * 0.35) : lf;
    // carreras cortas: estrategia suavizada para que no haga falta parar 2 veces en 5 vueltas
    if (this.type === 'race' && wm !== 'real') this.wearScale *= Math.max(0.25, Math.min(1, (this.laps - 3) / 12));
    this.fuelScale = wm === 'real' ? 1 : Math.min(this.lengthFactor, 12) * 0.9;
    this.scState = 'none'; // none | sc | vsc | red
    this.scLapsLeft = 0; this.scTimer = 0;
    this.yellow = [0, 0, 0];
    this.fastestLap = { time: Infinity, car: null };
    this.bestSectors = [Infinity, Infinity, Infinity];
    this.finishOrder = 0;
    this.checkered = false;
    this.leaderFinishedAt = 0;
    this.loops = Math.ceil(track.length / 100);
    this.incidentLog = [];
    this.lightsOn = 0; this.lightsTimer = 0; this.lightsHold = rnd(0.6, 2.6);
    this.sessionLength = (opts.minutes || 12) * 60;
    this.pendingPasses = new Map();
    this.lastOrder = [];
    this.retiredCount = 0;
    this.redFlagTimer = 0;
    this.setupWeather(opts.weather || 'seco');
    this.buildEntrants();
  }

  on(fn) { this.listeners.push(fn); }
  emit(type, data = {}) {
    data.t = this.t;
    for (const fn of this.listeners) fn(type, data, this);
  }

  // ---------- clima ----------
  setupWeather(kind) {
    const L = this.type === 'race' ? this.estimateRaceDuration() : this.sessionLength;
    this.weatherKind = kind;
    this.rain = 0; this.wetness = 0; this.rainTarget = 0;
    this.weatherEvents = [];
    if (kind === 'aleatorio') kind = Math.random() < this.track.meta.env.rainChance ? (Math.random() < 0.5 ? 'lluvia' : 'variable') : 'seco';
    if (kind === 'lluvia') { this.rain = this.rainTarget = rnd(0.55, 0.85); this.wetness = rnd(0.55, 0.8); }
    if (kind === 'variable') {
      const start = L * rnd(0.22, 0.45), dur = L * rnd(0.25, 0.4);
      this.weatherEvents.push({ at: start, rain: rnd(0.45, 0.9) }, { at: start + dur, rain: 0 });
    }
    this.weatherResolved = kind;
  }

  estimateRaceDuration() {
    const perf = basePerf(TEAMS[3], this.rho);
    const lt = this.track.speedProfile(perf).lapTime;
    return lt * 1.05 * (this.opts.laps || 5);
  }

  updateWeather(dt) {
    for (const ev of this.weatherEvents) {
      if (!ev.done && this.t >= ev.at) {
        ev.done = true;
        this.rainTarget = ev.rain;
        this.emit(ev.rain > 0 ? 'rain_start' : 'rain_stop', { intensity: ev.rain });
      }
    }
    this.rain += clamp(this.rainTarget - this.rain, -dt * 0.03, dt * 0.03);
    const dry = (1 - this.rain) * 0.0022 * (this.trackTemp / 30);
    this.wetness = clamp(this.wetness + (this.rain * 0.011 - dry) * dt, 0, 1);
    if (!this._heavy && this.rain > 0.75) { this._heavy = true; this.emit('rain_heavy'); }
  }

  nextRainIn() {
    for (const ev of this.weatherEvents) if (!ev.done && ev.rain > 0) return ev.at - this.t;
    return Infinity;
  }

  // ---------- participantes ----------
  buildEntrants() {
    const o = this.opts;
    let drivers = DRIVERS.slice();
    if (this.type === 'timetrial') drivers = drivers.filter(d => d.id === o.playerDriverId);
    // orden de grilla
    if (o.grid && o.grid.length) {
      const order = new Map(o.grid.map((id, i) => [id, i]));
      drivers.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
    } else {
      // grilla por rendimiento con algo de azar
      const score = d => TEAM_BY_ID[d.team].car * 0.6 + d.skill.pace * 0.4 + Math.random() * 0.04;
      drivers.sort((a, b) => score(b) - score(a));
    }
    if (o.aiCount && this.type !== 'timetrial') {
      const keep = new Set(drivers.filter(d => d.id === o.playerDriverId).map(d => d.id));
      drivers = drivers.filter((d, i) => keep.has(d.id) || i < o.aiCount + (keep.size ? 0 : 1)).slice(0, o.aiCount + 1);
    }
    this.entrants = drivers.map((drv, i) => {
      const isPlayer = drv.id === o.playerDriverId;
      const driver = isPlayer && o.playerName ? { ...drv, first: o.playerName.first, last: o.playerName.last, num: o.playerName.num || drv.num } : drv;
      const team = TEAM_BY_ID[o.teamOverrides?.[drv.id] || drv.team];
      const teamPerf = o.teamPerf?.[team.id] ? { ...team, ...o.teamPerf[team.id] } : team;
      const e = new Entrant({ driver, team: teamPerf, isPlayer, index: i });
      e.loopTimes = new Float64Array(this.loops * (this.laps + 3)).fill(-1);
      e.gridPosition = i + 1;
      return e;
    });
    this.player = this.entrants.find(e => e.isPlayer) || null;
    for (const e of this.entrants) {
      if (!e.isPlayer) {
        e.ai = new AIDriver(e, this);
        e.ai.skillRating = e.driver.skill.pace * 0.5 + e.team.car * 0.5;
      }
    }
    // auto del jugador con física completa
    if (this.player) {
      const spec = buildSpec(this.player.team, o.setup);
      this.phys = new CarPhysics(spec);
      this.phys.assists = { ...this.phys.assists, ...(o.assists || {}) };
      this.phys.autoGear = o.assists?.autoGear !== false;
      this.phys.wearScale = this.wearScale;
      this.phys.fuelScale = this.fuelScale;
    }
    this.placeOnGrid();
  }

  fuelForRace() {
    const lapLen = this.track.length;
    return this.type === 'race' ? (this.laps + 1.2) * lapLen * 0.00034 * (this.fuelScale) : 12;
  }

  placeOnGrid() {
    const tr = this.track;
    const wet = this.wetness > 0.45 ? 'wet' : this.wetness > 0.15 ? 'inter' : null;
    for (const e of this.entrants) {
      if (this.type === 'race') {
        const slot = tr.gridSlots[e.gridPosition - 1];
        e.s = slot.s; e.d = slot.d; e.v = 0; e.lap = -1;
        e.slot = slot;
      } else {
        // salida desde boxes escalonada
        e.lap = -1;
        e.inGarage = true;
        e.s = tr.pit.boxes[TEAMS.findIndex(t => t.id === e.team.id) % 10].s;
        e.d = tr.pit.garageD - Math.sign(tr.pit.side) * 3;
        e.v = 0;
        e.releaseAt = e.isPlayer ? 0 : rnd(5, Math.min(this.sessionLength * 0.35, 200));
      }
      e.fuel = this.fuelForRace();
      let comp = 'medium';
      if (wet) comp = wet;
      else if (e.ai) {
        if (this.type === 'race') {
          e.ai.planStrategy(this.laps, this.wearScale);
          comp = e.ai.plan.start || 'medium';
        } else comp = 'soft';
      } else comp = this.opts.startCompound || (this.type === 'race' ? 'medium' : 'soft');
      e.compound = comp;
      e.usedCompounds.add(comp);
      e.tyreTemp = 75;
      if (e.ai) {
        e.ai.launch = 1;
        e.ai.ensureProfile(true);
      }
      this.updateWorld(e);
    }
    if (this.player && this.phys) {
      const p = this.player, ph = this.phys;
      ph.fitTyres(p.compound);
      ph.fuel = p.fuel;
      if (this.type === 'race') {
        const pos = tr.pointAt(p.s, p.d);
        ph.reset(pos.x, pos.z, pos.heading, pos.y);
        this.playerAuto = false;
      } else {
        this.playerAuto = true; // sale del garaje con piloto automático
        p.pitPhase = 'garage';
      }
    }
    if (this.type === 'race') {
      this.phase = this.opts.formationLap ? 'formation-ready' : 'lights';
      if (this.phase === 'lights') this.lightsTimer = -1.5;
    } else this.phase = 'session';
  }

  // ---------- consultas ----------
  carAheadOnTrack(e, range) {
    let best = null, bg = range;
    for (const o of this.entrants) {
      if (o === e || (o.retired && !o.retiredOnTrack) || o.inGarage) continue;
      if (o.inPit !== e.inPit) continue;
      const gap = this.track.wrapS(o.s - e.s);
      if (gap > 0.1 && gap < bg) { bg = gap; best = o; }
    }
    return best ? { car: best, gap: bg } : null;
  }

  carBehindOnTrack(e, range) {
    let best = null, bg = range;
    for (const o of this.entrants) {
      if (o === e || o.retired || o.inGarage || o.inPit !== e.inPit) continue;
      const gap = this.track.wrapS(e.s - o.s);
      if (gap > 0.1 && gap < bg) { bg = gap; best = o; }
    }
    return best ? { car: best, gap: bg } : null;
  }

  sectorOf(s) { return s < this.track.sectors[1] ? 0 : s < this.track.sectors[2] ? 1 : 2; }

  overtakingAllowed(e) {
    if (this.phase === 'formation') return false;
    if (this.scState !== 'none') return false;
    if (this.yellow[this.sectorOf(e.s)] > 0) return false;
    if (this.type !== 'race') return true;
    return true;
  }

  flagSpeedCap(e, vt) {
    if (this.phase === 'formation') return Math.min(vt * 0.5, 38);
    if (this.phase === 'cooldown' || e.finished) return Math.min(vt * 0.62, 55);
    if (this.scState === 'vsc') return vt * 0.6;
    if (this.scState === 'sc' || this.scState === 'red') {
      // fila detrás del Safety Car
      const ah = this.carAheadOnTrack(e, 400);
      const sc = this.safetyCar;
      let gapSC = Infinity;
      if (sc && sc.onTrack) gapSC = this.track.wrapS(sc.s - e.s);
      const g = Math.min(ah ? ah.gap : Infinity, gapSC);
      const base = vt * 0.55;
      if (g > 60) return Math.min(vt * 0.8, base * 1.4);
      if (g < 12) return Math.min(base, (ah ? ah.car.v : base) - 0.5);
      return base;
    }
    const sec = this.sectorOf(e.s);
    if (this.yellow[sec] > 0) vt *= this.yellow[sec] > 1 ? 0.9 : 0.96;
    if (this.type !== 'race' && e.ai && e.ai.outLap) vt *= 0.88;
    return vt;
  }

  // ---------- incidentes y banderas ----------
  incident(e, kind) {
    const sec = this.sectorOf(e.s);
    this.yellow[sec] = Math.max(this.yellow[sec], kind === 'crash' ? 2 : 1);
    this.yellowTimer = Math.max(this.yellowTimer || 0, kind === 'crash' ? 20 : 9);
    this.emit('yellow', { sector: sec + 1, car: e, double: kind === 'crash' });
    this.incidentLog.push({ t: this.t, kind, car: e });
    if (this.type !== 'race' || this.phase !== 'race') return;
    if (kind === 'crash') {
      const lapsLeft = this.laps - (this.leader()?.lap || 0);
      const heavy = this.incidentLog.filter(x => x.kind === 'crash' && this.t - x.t < 8).length >= 3;
      if (heavy && lapsLeft > 2) this._redFlagPending = 3;
      else if (this.scState === 'none' && lapsLeft > 1) {
        if (this.track.meta.street || Math.random() < 0.6) this._scPending = 2.5;
        else this._vscPending = 2;
      }
    }
  }

  deploySC() {
    if (this.scState !== 'none') return;
    this.scState = 'sc';
    this.scLapsLeft = Math.floor(rnd(1.6, 3.4));
    const leader = this.leader();
    // el Safety Car sale delante del líder
    this.safetyCar = { s: this.track.wrapS(leader.s + 300), d: 0, v: 35, onTrack: true, inLap: false, lapsDone: 0, startLap: leader.lap };
    this.emit('sc_deployed', {});
    for (const e of this.entrants) if (e.ai) e.ai.attackTimer = 0;
  }

  deployVSC() {
    if (this.scState !== 'none') return;
    this.scState = 'vsc';
    this.scTimer = rnd(25, 45);
    this.emit('vsc', {});
  }

  redFlag() {
    this.scState = 'red';
    this.redFlagTimer = 6;
    this.emit('red_flag', {});
  }

  updateFlags(dt) {
    if (this.yellowTimer > 0) {
      this.yellowTimer -= dt;
      if (this.yellowTimer <= 0) {
        // quedan autos detenidos en pista?
        const stopped = this.entrants.some(e => e.retiredOnTrack && !e.removed);
        if (!stopped) { this.yellow = [0, 0, 0]; this.emit('green', {}); }
        else this.yellowTimer = 5;
      }
    }
    // grúas: retirar autos detenidos
    for (const e of this.entrants) {
      if (e.retiredOnTrack && !e.removed && e.stoppedTimer > (this.scState === 'sc' ? 22 : 35)) e.removed = true;
    }
    if (this._scPending !== undefined) { this._scPending -= dt; if (this._scPending <= 0) { delete this._scPending; this.deploySC(); } }
    if (this._vscPending !== undefined) { this._vscPending -= dt; if (this._vscPending <= 0) { delete this._vscPending; this.deployVSC(); } }
    if (this._redFlagPending !== undefined) { this._redFlagPending -= dt; if (this._redFlagPending <= 0) { delete this._redFlagPending; this.redFlag(); } }
    if (this.wetness > 0.93 && this.rain > 0.85 && this.scState === 'none' && this.phase === 'race' && !this._rainSC) {
      this._rainSC = true; this.deploySC();
    }
    if (this.scState === 'vsc') {
      this.scTimer -= dt;
      if (this.scTimer <= 0) { this.scState = 'none'; this.emit('vsc_end', {}); }
    }
    if (this.scState === 'red') {
      this.redFlagTimer -= dt;
      if (this.redFlagTimer <= 0) this.restartAfterRed();
    }
    if (this.scState === 'sc') this.updateSafetyCar(dt);
  }

  updateSafetyCar(dt) {
    const sc = this.safetyCar, tr = this.track;
    if (!sc) return;
    const prev = sc.s;
    const leader = this.leader();
    if (sc.onTrack) {
      const prof = this._scProfile || (this._scProfile = tr.speedProfile({ ...basePerf(TEAMS[1], this.rho), mu: 1.25, power: 450000 }));
      let vt = prof.v[tr.idx(sc.s)] * 0.82;
      // esperar al líder si está lejos
      const gapL = tr.wrapS(sc.s - leader.s);
      if (gapL > 220 && gapL < 2000) vt *= 0.7;
      sc.v += clamp((vt - sc.v) * 2, -12, 6) * dt;
      if (sc.inLap && tr.inPitRange(sc.s) && tr.pitU(sc.s) < tr.pit.length * 0.9) {
        sc.d = tr.pitLaneD(tr.pitU(sc.s));
        sc.v = Math.min(sc.v, PIT_SPEED);
        if (tr.pitU(sc.s) > tr.pit.limitEnd - 40) {
          sc.onTrack = false;
          this.scState = 'none';
          this.emit('restart', {});
          this.yellow = [0, 0, 0];
        }
      } else {
        sc.d += (tr.line[tr.idx(sc.s)] - sc.d) * Math.min(1, dt);
      }
      sc.s = tr.wrapS(sc.s + sc.v * dt);
      if (prev > tr.length - 60 && sc.s < 60) {
        sc.lapsDone++;
        if (sc.lapsDone >= this.scLapsLeft && !sc.inLap) {
          sc.inLap = true;
          this.emit('sc_in', {});
        }
      }
      const p = tr.pointAt(sc.s, sc.d);
      sc.x = p.x; sc.y = p.y; sc.z = p.z; sc.heading = p.heading;
    }
  }

  restartAfterRed() {
    // reanudación con largada detenida en el orden actual
    const order = this.standings().filter(e => !e.retired);
    order.forEach((e, i) => {
      const slot = this.track.gridSlots[i];
      e.s = slot.s; e.d = slot.d; e.v = 0; e.slot = slot;
      e.lap = Math.max(e.lap, 0);
      e.inPit = false; e.pitPhase = null;
      if (e.ai) { e.ai.mode = 'race'; e.ai.error = null; }
      if (this.wetness > 0.45) e.compound = 'wet';
      else if (this.wetness > 0.15) e.compound = 'inter';
      e.wear = 0; e.tyreAge = 0;
      e.lap = e.lap; // mantiene vueltas completas
      e.progress = e.lap * this.track.length + e.s - this.track.length;
      this.updateWorld(e);
    });
    if (this.player && this.phys) {
      const p = this.player, pos = this.track.pointAt(p.s, p.d);
      this.phys.reset(pos.x, pos.z, pos.heading, pos.y);
      this.phys.fitTyres(p.compound);
      this.playerAuto = false;
    }
    this.scState = 'none';
    this.rainTarget = Math.min(this.rainTarget, 0.6);
    this.rain = Math.min(this.rain, 0.6);
    this.wetness = Math.min(this.wetness, 0.6);
    this.phase = 'lights';
    this.lightsTimer = -2;
    this.lightsOn = 0;
    this.lightsHold = rnd(0.6, 2.4);
    this.restartFromRed = true;
    this.emit('red_restart', {});
  }

  retire(e, reason, onTrack = false) {
    if (e.retired) return;
    e.retired = true;
    e.retireReason = reason;
    e.retiredOnTrack = onTrack;
    e.retireTime = this.t;
    this.retiredCount++;
    if (e.ai) e.ai.mode = 'retired';
    this.emit('retire', { car: e, reason });
    if (onTrack && this.type === 'race' && this.phase === 'race' && reason !== 'accidente') {
      if (Math.random() < 0.5) this._vscPending = 3; else this.incident(e, 'spin');
    }
  }

  leader() { return this.order ? this.order[0] : this.entrants[0]; }

  // ---------- jugador ----------
  updatePlayer(dt, input) {
    const p = this.player, ph = this.phys, tr = this.track;
    if (!p) return;
    if (p.retired) { p.v = Math.max(0, p.v - 15 * dt); ph.vx = p.v; return; }
    if (this.playerAuto) {
      // piloto automático: el auto se mueve como la IA (boxes, grilla); la física se sincroniza
      this.syncPhysFromEntrant();
      return;
    }
    if (this.phase === 'lights' || this.phase === 'grid' || this.phase === 'formation-ready') {
      // en la grilla: el auto queda retenido; acelerar solo sube las vueltas (largada con revoluciones)
      ph.rpm += ((4000 + input.throttle * 6500) - ph.rpm) * Math.min(1, dt * 8);
      ph.throttleOut = input.throttle;
      ph.gear = 1;
      ph.vx = ph.vy = ph.r = 0;
      p.v = 0;
      return;
    }
    const env = {
      track: tr, rho: this.rho, wetness: this.wetness, airTemp: this.airTemp,
      slipstream: p.slipstream, dirtyAir: p.dirtyAir,
    };
    // DRS
    const zone = tr.inDrsZone(ph.s);
    const drsOk = this.type !== 'race' ? !!zone && this.wetness < 0.2 : !!zone && p.drsEligible && this.drsEnabled() && this.wetness < 0.2;
    if (input.drs && drsOk) ph.drsOpen = true;
    if (!drsOk || input.brake > 0.1) ph.drsOpen = false;
    p.drsOpen = ph.drsOpen;
    p.drsAvailable = drsOk;
    const n = Math.max(1, Math.ceil(dt / (1 / 300)));
    const h = dt / n;
    for (let k = 0; k < n; k++) {
      ph.step(h, input, env);
      input.gearUp = input.gearDown = false;
    }
    this.syncEntrantFromPhys();
    // daños y abandono
    if (ph.retired && !p.retired) this.retire(p, 'daños', true);
    if (ph.lastImpact && ph.lastImpact !== this._lastImpactSeen) {
      this._lastImpactSeen = ph.lastImpact;
      if (ph.lastImpact.vn > 6) this.emit('crash', { car: p, wall: true, severity: ph.lastImpact.vn });
      else if (ph.lastImpact.vn > 3) this.emit('wall_touch', { car: p });
    }
    p.damage.frontWing = ph.damage.frontWing; p.damage.rearWing = ph.damage.rearWing; p.damage.floor = ph.damage.floor;
    // bloqueo de ruedas
    const lockNow = ph.lock.some(Boolean);
    if (lockNow && !this._lockPrev && ph.speed > 25) this.emit('lockup', { car: p, corner: tr.cornerNear(p.s) });
    this._lockPrev = lockNow;
    if (ph.offTrack && !this._offPrev && ph.speed > 25) this.emit('off_track', { car: p, corner: tr.cornerNear(p.s) });
    this._offPrev = ph.offTrack;
    // trompo
    const slip = Math.abs(Math.atan2(ph.vy, Math.abs(ph.vx) + 0.1));
    if (slip > 1.0 && ph.speed > 8 && !this._spinPrev) { this._spinPrev = true; this.emit('spin', { car: p, corner: tr.cornerNear(p.s) }); this.incident(p, 'spin'); }
    if (slip < 0.3) this._spinPrev = false;
    // límites de pista
    this.checkTrackLimits(dt);
    // entrada a boxes
    this.checkPlayerPitEntry();
    // pinchazo
    if (ph.punctured.some(Boolean) && !this._punct) { this._punct = true; this.emit('puncture', { car: p }); }
  }

  syncEntrantFromPhys() {
    const p = this.player, ph = this.phys;
    p.x = ph.x; p.z = ph.z; p.y = ph.y; p.heading = ph.psi;
    p.s = ph.s; p.d = ph.d; p.v = Math.max(0, ph.vx);
    p.ax = ph.ax; p.ay = ph.ay;
    p.compound = ph.compound;
    p.wear = ph.wear.reduce((a, b) => a + b) / 4;
    p.tyreTemp = ph.tyreT.reduce((a, b) => a + b) / 4;
    p.fuel = ph.fuel;
    p.throttle = ph.throttleOut; p.brake = ph.brakeOut;
    p.steerVis = ph.steerAngle;
    p.failure = ph.failure;
  }

  syncPhysFromEntrant() {
    const p = this.player, ph = this.phys;
    this.updateWorld(p);
    ph.x = p.x; ph.z = p.z; ph.y = p.y; ph.psi = p.heading;
    ph.vx = p.v; ph.vy = 0; ph.r = 0;
    ph.s = p.s; ph.d = p.d; ph.ti = this.track.idx(p.s);
    ph.steerAngle = p.steerVis || 0;
    const ratio = ph.spec.ratios[ph.gear - 1];
    let rpm = (p.v / 0.36) * ratio * 60 / (2 * Math.PI);
    if (rpm > 11800 && ph.gear < 8) ph.gear++;
    if (rpm < 7500 && ph.gear > 1) ph.gear--;
    ph.rpm = Math.max(4000, rpm);
    ph.throttleOut = p.throttle || 0;
    for (let i = 0; i < 4; i++) ph.wheelRot[i] = (ph.wheelRot[i] + p.v / 0.36 / 60) % (Math.PI * 2);
  }

  releasePlayerFromAuto() {
    const p = this.player, ph = this.phys;
    this.updateWorld(p);
    ph.x = p.x; ph.z = p.z; ph.psi = p.heading;
    ph.vx = p.v; ph.vy = 0; ph.r = 0;
    ph.ti = this.track.idx(p.s);
    this.playerAuto = false;
    ph.limiter = false;
  }

  checkTrackLimits(dt) {
    const p = this.player, ph = this.phys, tr = this.track;
    if (this.phase !== 'race' && this.phase !== 'session') return;
    if (p.inPit) return;
    const allOut = Math.abs(ph.d) > tr.halfW + 1.4 + 1.0 && ph.surf.every(s => s >= 2);
    if (allOut && ph.speed > 20) {
      this._outTimer = (this._outTimer || 0) + dt;
      if (this._outTimer > 0.25 && !this._limitFlag) {
        this._limitFlag = true;
        if (this.type !== 'race') {
          if (p.lapValid) { p.lapValid = false; this.emit('lap_invalid', { car: p }); }
        } else {
          p.warnings.trackLimits++;
          if (p.warnings.trackLimits >= 4) {
            this.penalize(p, 5, 'límites de pista');
            p.warnings.trackLimits = 0;
          } else this.emit('track_limits', { car: p, count: p.warnings.trackLimits });
        }
      }
    } else {
      this._outTimer = 0;
      if (Math.abs(ph.d) < tr.halfW) this._limitFlag = false;
    }
  }

  penalize(e, sec, reason) {
    e.penaltySec += sec;
    e.penalties.push({ sec, reason, t: this.t });
    this.emit('penalty', { car: e, sec, reason });
  }

  checkPlayerPitEntry() {
    const p = this.player, ph = this.phys, tr = this.track, pit = tr.pit;
    const u = tr.pitU(ph.s);
    const inLane = u < pit.length && ph.d * pit.side > Math.abs(pit.wallD) + 0.3;
    p.inPitLaneZone = inLane;
    if (!inLane || this.playerAuto) return;
    if (u >= pit.ramp - 4 && u < pit.ramp + 30) {
      // línea del limitador
      const kmh = ph.speed * 3.6;
      if (kmh > 82 && this.type === 'race') this.penalize(p, 5, 'exceso de velocidad en boxes');
      p.v = Math.min(ph.speed, PIT_SPEED);
      p.s = ph.s; p.d = ph.d;
      p.inPit = true;
      p.pitPhase = 'lane';
      p.pitU = u;
      this.playerAuto = true;
      p.pitCompound = p.pitCompound || this.suggestCompound(p);
      this.emit('pit_in', { car: p });
    }
  }

  suggestCompound(e) {
    if (this.wetness > 0.45) return 'wet';
    if (this.wetness > 0.13) return 'inter';
    const used = e.usedCompounds;
    if (e.compound === 'hard') return 'medium';
    if (e.compound === 'soft') return used.has('medium') ? 'hard' : 'medium';
    return 'hard';
  }

  drsEnabled() {
    if (this.type !== 'race') return true;
    if (this.scState !== 'none') return false;
    const leader = this.leader();
    if (!leader || leader.lap < 2) return false;
    if (this.restartTime && this.raceTime - this.restartTime < 60) return false;
    return true;
  }

  // ---------- boxes (IA y jugador en automático) ----------
  updatePit(e, dt) {
    const tr = this.track, pit = tr.pit;
    const boxIdx = TEAMS.findIndex(t => t.id === e.team.id) % 10;
    const box = pit.boxes[boxIdx];
    let u = tr.pitU(e.s);
    const phase = e.pitPhase;
    let vt = PIT_SPEED, dTarget = tr.pitLaneD(Math.min(u, pit.length));
    if (phase === 'entry') {
      // desacelerar hasta la línea del limitador
      const distToLine = pit.ramp - u;
      vt = Math.min(e.v, Math.sqrt(PIT_SPEED ** 2 + 2 * 30 * Math.max(0, distToLine)));
      if (u >= pit.ramp) e.pitPhase = 'lane';
    } else if (phase === 'lane') {
      const dist = box.u - u;
      if (dist < 45) {
        vt = Math.min(PIT_SPEED, Math.sqrt(2 * 9 * Math.max(0, dist - 0.3)));
        dTarget = tr.pitLaneD(u) + (pit.workD - pit.fastD) * clamp(1 - dist / 40, 0, 1);
        if (dist < 0.6) {
          e.v = 0;
          e.pitPhase = 'service';
          this.startService(e);
        }
      }
    } else if (phase === 'service') {
      vt = 0; e.v = 0;
      dTarget = pit.workD;
      e.service.t += dt;
      if (e.service.t >= e.service.total) {
        this.finishService(e);
        e.pitPhase = 'release';
      }
    } else if (phase === 'release') {
      vt = PIT_SPEED;
      const k = clamp((u - box.u) / 30, 0, 1);
      dTarget = pit.workD + (pit.fastD - pit.workD) * k;
      if (u > pit.limitEnd) e.pitPhase = 'exit';
    } else if (phase === 'exit') {
      vt = 60;
      if (u >= pit.length - 2 || u < 1) {
        e.inPit = false; e.pitPhase = null;
        if (e.ai) e.ai.mode = 'race';
        if (e.isPlayer) this.releasePlayerFromAuto();
        this.emit('pit_out', { car: e });
        return;
      }
    } else if (phase === 'garage') {
      // salir del garaje (clasificación / práctica)
      e.v = 0;
      e.d = pit.workD;
      e.s = box.s;
      if (this.t >= e.releaseAt) {
        e.inGarage = false; e.inPit = true; e.pitPhase = 'release';
        if (e.ai) e.ai.outLap = true;
        this.emit('garage_out', { car: e });
      }
      this.updateWorld(e);
      return;
    }
    const acc = clamp((vt - e.v) * 3, -14, 6);
    e.v = Math.max(0, e.v + acc * dt);
    e.ax = acc;
    e.throttle = acc > 0 ? 0.5 : 0;
    const dd = clamp(dTarget - e.d, -3 * dt, 3 * dt);
    e.d += dd;
    e.dDot = dd / Math.max(dt, 1e-4);
    e.s = tr.wrapS(e.s + e.v * dt);
  }

  startService(e) {
    const team = e.team;
    const q = team.pit;
    let total = 1.9 + (1 - q) * 3.2 + Math.abs(gauss()) * 0.22;
    let problem = null;
    if (Math.random() < 0.035 + (1 - q) * 0.15) {
      const wheels = ['delantera izquierda', 'delantera derecha', 'trasera izquierda', 'trasera derecha'];
      const w = Math.floor(Math.random() * 4);
      const extra = rnd(1.5, 6);
      total += extra;
      problem = { wheel: w, name: wheels[w], extra };
    }
    const nose = e.damage.frontWing > 0.25;
    if (nose) total += rnd(5.5, 8);
    const serve = e.serveAtStop || 0;
    e.serveAtStop = 0;
    let comp = e.pitCompound || (e.ai ? e.ai.nextCompound : null) || this.suggestCompound(e);
    e.service = { t: 0, total: total + serve, work: total, serve, problem, nose, compound: comp, start: this.t };
    this.emit('pit_stop', { car: e, service: e.service });
  }

  finishService(e) {
    const s = e.service;
    e.compound = s.compound;
    e.usedCompounds.add(s.compound);
    e.wear = 0; e.tyreAge = 0;
    e.tyreTemp = COMPOUNDS[s.compound].wetTyre ? 60 : 72;
    if (s.nose) { e.damage.frontWing = 0; }
    e.pitStops++;
    e.punctured = false;
    e.pitRequest = false;
    e.pitCompound = null;
    e.lastStopTime = s.work + s.serve;
    if (e.ai) { e.ai.ensureProfile(true); e.ai.nextCompound = null; }
    if (e.isPlayer) {
      this.phys.fitTyres(s.compound);
      if (s.nose) this.phys.damage.frontWing = 0;
      this.phys.damage.floor *= 0.5;
      this._punct = false;
    }
    this.emit('pit_done', { car: e, time: s.work, problem: s.problem, compound: s.compound });
  }

  // decisión de entrar a boxes (IA)
  aiPitDecision(e) {
    if (!e.ai || e.inPit || e.retired || e.finished) return;
    const lapsLeft = this.laps - e.lap;
    if (this.type !== 'race') {
      if (e.ai.flyingLaps >= 3 && !e.pitRequest) { e.pitRequest = true; e.ai.nextCompound = 'soft'; e.ai.returnGarage = true; }
      return;
    }
    if (lapsLeft <= 1) return;
    const w = this.wetness;
    const comp = e.compound, c = COMPOUNDS[comp];
    let want = null;
    if (w > 0.5 && comp !== 'wet') want = 'wet';
    else if (w > 0.14 && w <= 0.5 && !c.wetTyre) want = 'inter';
    else if (w < 0.08 && c.wetTyre) want = lapsLeft < 8 ? 'soft' : 'medium';
    else if (w > 0.3 && w < 0.42 && comp === 'wet' && this.rain < 0.4) want = 'inter';
    const plan = e.ai.plan;
    const nextStop = plan && plan.stops ? plan.stops.find(st => !st.done) : null;
    if (!want && nextStop && e.lap >= nextStop.lap) { want = nextStop.compound; nextStop.done = true; }
    if (!want && e.wear > 0.8) want = lapsLeft < 12 ? 'soft' : 'hard';
    if (!want && e.damage.frontWing > 0.35) want = comp === 'soft' ? 'medium' : 'hard';
    if (!want && this.scState !== 'none' && nextStop && nextStop.lap - e.lap <= 7 && Math.random() < 0.7) { want = nextStop.compound; nextStop.done = true; }
    // regla de dos compuestos en seco
    if (!want && lapsLeft <= 3 && w < 0.1 && this.opts.mandatoryStop !== false && this.laps >= 10) {
      const dryUsed = [...e.usedCompounds].filter(x => !COMPOUNDS[x].wetTyre);
      if (dryUsed.length < 2 && !c.wetTyre) want = comp === 'soft' ? 'medium' : 'soft';
    }
    if (want && !e.pitRequest) {
      e.pitRequest = true;
      e.ai.nextCompound = want;
    }
  }

  // ---------- mundo ----------
  updateWorld(e) {
    const tr = this.track;
    const p = tr.pointAt(e.s, e.d, this._pt || (this._pt = {}));
    e.x = p.x; e.y = p.y; e.z = p.z;
    // orientación: tangente + movimiento lateral
    const lat = Math.atan2(e.dDot || 0, Math.max(e.v, 3));
    e.heading = p.heading - lat + (e.yawOffset || 0);
    e.pitch = -Math.atan(tr.sample(tr.grade, e.s));
    e.steerVis = clamp(-(tr.sample(tr.lineK, e.s) * 3.6 + lat * 0.3), -0.35, 0.35);
  }

  // ---------- colisiones entre autos ----------
  collisions(dt) {
    const tr = this.track, L = tr.length;
    const list = this.entrants.filter(e => (!e.retired || (e.retiredOnTrack && !e.removed)) && !e.inGarage);
    list.sort((a, b) => a.s - b.s);
    const n = list.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < Math.min(n, i + 6) + (i + 6 > n ? 0 : 0); j++) {
        this._pair(list[i], list[j], L, dt);
      }
      // envolver alrededor de la meta
      if (i < 3) for (let j = n - 3; j < n; j++) if (j > i) this._pair(list[i], list[j], L, dt);
    }
  }

  _pair(a, b, L, dt) {
    if (a.inPit !== b.inPit) return;
    let ds = b.s - a.s;
    if (ds > L / 2) ds -= L; else if (ds < -L / 2) ds += L;
    const dd = b.d - a.d;
    const LEN = 5.4, WID = 1.95;
    if (Math.abs(ds) >= LEN || Math.abs(dd) >= WID) return;
    const penS = LEN - Math.abs(ds), penD = WID - Math.abs(dd);
    // el de atrás y el de adelante
    const front = ds > 0 ? b : a, rear = ds > 0 ? a : b;
    const relV = rear.v - front.v;
    const now = this.t;
    const key = a.index < b.index ? a.index * 100 + b.index : b.index * 100 + a.index;
    this._contacts = this._contacts || new Map();
    const lastC = this._contacts.get(key) || -10;
    if (penD / WID < penS / LEN) {
      // contacto lateral: separar
      const sgn = dd >= 0 ? 1 : -1;
      this.pushLateral(a, -sgn * penD * 0.5);
      this.pushLateral(b, sgn * penD * 0.5);
      const latV = Math.abs((b.dDot || 0) - (a.dDot || 0));
      if (latV > 2.5 && now - lastC > 2) {
        this._contacts.set(key, now);
        this.emit('contact', { a: rear, b: front, kind: 'lateral' });
        if (Math.random() < 0.07 && this.phase === 'race') {
          const victim = Math.random() < 0.5 ? a : b;
          if (victim.ai) victim.ai.startSpin(this.track.cornerNear(victim.s), Math.random() < 0.15);
        }
      }
    } else {
      // golpe por detrás
      this.pushLong(rear, -penS);
      if (relV > 0) {
        const avg = (rear.v + front.v) / 2;
        this.setSpeed(rear, avg - relV * 0.15);
        this.setSpeed(front, avg + relV * 0.15);
      }
      if (relV > 4 && now - lastC > 2) {
        this._contacts.set(key, now);
        rear.damage.frontWing = Math.min(1, rear.damage.frontWing + relV * 0.06);
        if (rear.isPlayer) { this.phys.damage.frontWing = rear.damage.frontWing; }
        this.emit('contact', { a: rear, b: front, kind: 'rear', dv: relV });
        if (relV > 9 && this.phase === 'race') {
          if (front.ai && Math.random() < 0.3) front.ai.startSpin(this.track.cornerNear(front.s), false);
          if (rear.isPlayer || front.isPlayer) {
            const culprit = rear;
            if (culprit.isPlayer && relV > 11) this.penalize(culprit, 5, 'causar una colisión');
          }
        }
      }
    }
  }

  pushLateral(e, delta) {
    if (e.isPlayer && !this.playerAuto) {
      const ph = this.phys, tr = this.track;
      const p = tr.pointAt(ph.s, ph.d);
      const nx = p.tz, nz = -p.tx;
      ph.x += nx * delta; ph.z += nz * delta;
      // impulso lateral
      const c = Math.cos(ph.psi), s = Math.sin(ph.psi);
      const imp = delta * 4;
      const wx = nx * imp, wz = nz * imp;
      ph.vx += wx * c + wz * s; ph.vy += wx * s - wz * c;
    } else {
      e.d += delta;
    }
  }

  pushLong(e, delta) {
    if (e.isPlayer && !this.playerAuto) {
      const ph = this.phys, p = this.track.pointAt(ph.s, ph.d);
      ph.x += p.tx * delta; ph.z += p.tz * delta;
    } else e.s = this.track.wrapS(e.s + delta);
  }

  setSpeed(e, v) {
    v = Math.max(0, v);
    if (e.isPlayer && !this.playerAuto) {
      const ph = this.phys, sp = Math.max(0.1, ph.speed);
      ph.vx *= v / sp; ph.vy *= v / sp;
    } else e.v = v;
  }

  // ---------- rebufo / aire sucio / DRS ----------
  updateAero() {
    for (const e of this.entrants) {
      e.slipstream = 0; e.dirtyAir = 0;
      if (e.retired || e.inPit) continue;
      const ah = this.carAheadOnTrack(e, 60);
      if (ah && Math.abs(ah.car.d - e.d) < 2.6) {
        const g = ah.gap;
        e.slipstream = g < 6 ? 0.1 : clamp(0.24 * (1 - (g - 6) / 54), 0, 0.24);
        e.dirtyAir = clamp(0.2 * (1 - g / 30), 0, 0.2);
      }
      if (e.ai) {
        const zone = this.track.inDrsZone(e.s);
        e.drsOpen = !!zone && (this.type !== 'race' || (e.drsEligible && this.drsEnabled())) && this.wetness < 0.2;
      }
    }
  }

  // ---------- cronometraje ----------
  timing(e, prevS) {
    const tr = this.track, L = tr.length;
    if (e.retired || e.inGarage) return;
    const crossed = prevS > L - 80 && e.s < 80;
    const backwards = prevS < 80 && e.s > L - 80;
    if (backwards) { e.lap--; }
    // bucles de cronometraje
    const loopPrev = Math.floor(prevS / 100), loopNow = Math.floor(e.s / 100);
    if (loopNow !== loopPrev && !backwards && e.lap >= 0) {
      const lapIdx = crossed ? e.lap + 1 : e.lap;
      const gi = lapIdx * this.loops + loopNow;
      if (gi < e.loopTimes.length) e.loopTimes[gi] = this.t;
      e.lastLoop = gi;
      // detección de DRS (paso por el punto de detección)
      for (const z of tr.drsZones) {
        if (this.crossedPoint(prevS, e.s, z.detection)) {
          const ah = this.positionAhead(e);
          e.drsEligible = !!ah && this.gapBetween(e, ah) < 1.0 && this.gapBetween(e, ah) > 0;
          if (e.drsEligible && (e.isPlayer || (ah.isPlayer)) && this.drsEnabled()) this.emit('drs_range', { car: e, target: ah });
        }
      }
    }
    // sectores
    const sec = this.sectorOf(e.s);
    if (sec !== e.sector && !backwards && e.lap >= 0) {
      const prevSec = e.sector;
      if ((prevSec + 1) % 3 === sec) {
        const st = this.t - e.sectorStart;
        if (e.lap >= 0 && e.sectorStart > 0) {
          e.sectorTimes[prevSec] = st;
          const pb = st < e.bestSectors[prevSec];
          const ob = st < this.bestSectors[prevSec];
          if (pb) e.bestSectors[prevSec] = st;
          if (ob && e.lapValid) this.bestSectors[prevSec] = st;
          if (e.isPlayer) this.emit('sector', { car: e, sector: prevSec + 1, time: st, pb, ob });
        }
        e.sectorStart = this.t;
      }
      e.sector = sec;
    }
    if (crossed) {
      e.lap++;
      const lapTime = this.t - e.lapStart;
      if (e.lap >= 1 && e.lapStart > 0 || (e.lap >= 1 && this.type === 'race')) {
        e.lastLap = lapTime;
        e.lapTimes.push(lapTime);
        const valid = e.lapValid && !e.pitStoppedThisLap;
        if (valid && lapTime < e.bestLap) e.bestLap = lapTime;
        if (valid && lapTime < this.fastestLap.time && (this.type !== 'race' || e.lap >= 2 || this.laps <= 2)) {
          const prev = this.fastestLap.car;
          this.fastestLap = { time: lapTime, car: e, lap: e.lap };
          this.emit('fastest_lap', { car: e, time: lapTime, prev });
        }
        this.emit('lap_complete', { car: e, time: lapTime, valid, lap: e.lap });
        if (e.ai && e.ai.outLap) { e.ai.outLap = false; e.ai.flyingLaps = 0; }
        else if (e.ai && this.type !== 'race') e.ai.flyingLaps = (e.ai.flyingLaps || 0) + 1;
      }
      if (!(this.type === 'race' && e.lap === 0)) { e.lapStart = this.t; }
      e.lapValid = true;
      e.pitStoppedThisLap = false;
      e.tyreAge++;
      if (e.ai) e.ai.lapPaceVar = 1 + gauss() * 0.0035 * (1.1 - e.driver.skill.consistency);
      if (this.type === 'race') { if (this.phase !== 'formation') this.onLapRace(e); }
      else {
        if (this.phase === 'session-end' && !e.finished) { e.finished = true; e.finishOrder = ++this.finishOrder; }
        if (e.ai) this.aiPitDecision(e);
      }
    }
    if (e.inPit && this.type !== 'race') e.lapValid = false;
    e.progress = e.lap * L + e.s;
  }

  crossedPoint(a, b, p) {
    if (a <= b) return a < p && b >= p;
    return a < p || b >= p;
  }

  positionAhead(e) {
    if (!this.order) return null;
    const i = this.order.indexOf(e);
    return i > 0 ? this.order[i - 1] : null;
  }

  // diferencia de tiempo entre dos autos (a detrás de b), por bucles de cronometraje
  gapBetween(a, b) {
    if (a.lastLoop === undefined || a.lastLoop < 0) return 0;
    const gi = a.lastLoop;
    const tb = b.loopTimes[gi];
    if (tb < 0 || tb === undefined) return 0;
    return a.loopTimes[gi] - tb;
  }

  onLapRace(e) {
    const leader = this.order ? this.order[0] : e;
    if (e === leader || (this.order && this.order[0] === e)) {
      if (e.lap === this.laps - 1 && !this.checkered) this.emit('final_lap', { car: e });
      else if (e.lap >= 1 && e.lap < this.laps) this.emit('lap', { lap: e.lap + 1, total: this.laps, leader: e });
      if (this.scState === 'sc' && this.safetyCar && !this.safetyCar.inLap) { /* contado por el SC */ }
    }
    if (!this.checkered && e.lap >= this.laps && e === this.order[0]) {
      this.checkered = true;
      this.leaderFinishedAt = this.t;
      this.phase = 'finish';
      this.emit('checkered', { winner: e });
    }
    if (this.checkered && !e.finished && !e.retired) {
      e.finished = true;
      e.finishOrder = ++this.finishOrder;
      e.finishTime = this.raceTime;
      e.finishLaps = e.lap;
      this.emit('finish', { car: e, position: e.finishOrder });
    }
    // fallas mecánicas
    if (this.opts.failures !== false && !e.finished && !e.retired && this.phase === 'race') {
      const rel = e.team.reliability;
      const p = (1 - rel) * 0.012 * Math.sqrt(this.lengthFactor);
      if (Math.random() < p && (!e.isPlayer || this.opts.failures === 'all')) this.mechanical(e);
    }
    if (e.ai) this.aiPitDecision(e);
  }

  mechanical(e) {
    const kinds = [
      { k: 'engine', label: 'el motor', retire: true },
      { k: 'hydraulics', label: 'la hidráulica', retire: true },
      { k: 'gearbox', label: 'la caja de cambios', retire: false },
      { k: 'ers', label: 'el sistema híbrido', retire: false },
      { k: 'brakes', label: 'los frenos', retire: true },
    ];
    const f = kinds[Math.floor(Math.random() * kinds.length)];
    e.failure = f.k;
    if (e.isPlayer) this.phys.failure = f.retire ? 'engine' : f.k;
    this.emit('mechanical', { car: e, kind: f.k, label: f.label, retire: f.retire });
    if (f.retire) {
      e.smokeFx = 1;
      setTimeout(() => {}, 0);
      this._retireLater = this._retireLater || [];
      this._retireLater.push({ e, at: this.t + rnd(4, 12), reason: f.label });
    }
  }

  // ---------- orden ----------
  standings() {
    const arr = this.entrants.slice();
    const tt = this.type;
    if (tt === 'race') {
      arr.sort((a, b) => {
        if (a.retired !== b.retired) return a.retired ? 1 : -1;
        if (a.retired && b.retired) return b.progress - a.progress;
        const la = a.finished ? a.finishLaps : a.lap, lb = b.finished ? b.finishLaps : b.lap;
        if (la !== lb) return lb - la;
        if (a.finished && b.finished) return (a.finishTime + a.penaltySec) - (b.finishTime + b.penaltySec);
        if (a.finished !== b.finished) return a.finished ? -1 : 1;
        return b.progress - a.progress;
      });
    } else {
      arr.sort((a, b) => a.bestLap - b.bestLap || a.index - b.index);
    }
    return arr;
  }

  // ---------- bucle principal ----------
  update(dt, input) {
    dt = Math.min(dt, 0.05);
    this.t += dt;
    this.updateWeather(dt);
    if (this.type === 'race') this.updateRacePhase(dt, input);
    else this.updateSessionPhase(dt);

    const running = this.phase === 'race' || this.phase === 'finish' || this.phase === 'session' || this.phase === 'session-end' || this.phase === 'formation' || this.phase === 'cooldown';
    if (running) {
      this.raceTime += this.phase !== 'formation' ? dt : 0;
      this.updateAero();
      for (const e of this.entrants) {
        const prevS = e.s;
        if (e.isPlayer) {
          if (this.playerAuto && (e.inPit || e.pitPhase)) this.updatePit(e, dt);
          else if (this.playerAuto && this.phase === 'formation') this.gridApproach(e, dt);
          this.updatePlayer(dt, input);
        } else if (e.ai) {
          if (e.inGarage) { if (e.pitPhase !== 'garage') e.pitPhase = 'garage'; this.updatePit(e, dt); continue; }
          if (this.phase === 'formation' && e.ai.mode === 'grid') { this.gridApproach(e, dt); }
          else if (e.inPit) this.updatePit(e, dt);
          else {
            // ¿entra a boxes?
            if (e.pitRequest && !e.retired && this.crossedPoint(prevS, this.track.wrapS(e.s + e.v * dt * 1.2), this.track.pit.sIn)) {
              e.inPit = true; e.pitPhase = 'entry'; e.ai.mode = 'pit';
              e.pitStoppedThisLap = true;
              if (this.type === 'race' || !e.ai.returnGarage) this.emit('pit_in', { car: e });
            }
            if (!e.inPit) e.ai.update(dt, this.t);
            else this.updatePit(e, dt);
          }
          // garaje al terminar la tanda (clasificación)
          if (e.ai.returnGarage && e.pitPhase === 'service' && this.type !== 'race') {
            e.inGarage = true; e.inPit = false; e.pitPhase = 'garage'; e.ai.returnGarage = false;
            e.releaseAt = this.t + rnd(40, 120);
            e.service = null;
            e.ai.mode = 'race';
          }
          if (this.phase === 'formation' && !e.inPit) this.formationCheck(e);
        }
        if (!e.isPlayer || this.playerAuto) this.updateWorld(e);
        if (e.isPlayer && this.phase === 'formation' && !this.playerAuto) this.formationCheck(e);
        this.timing(e, prevS);
        if (e.ai && !e.inPit && !e.retired) {
          // desgaste de la IA
          const comp = COMPOUNDS[e.compound];
          let wr = 0.026 * comp.wear * this.wearScale * (1.1 - e.driver.skill.tyres * 0.2) * (e.v * dt) / this.track.length;
          if (comp.wetTyre && this.wetness < 0.12) wr *= 2.5;
          e.wear = Math.min(1, e.wear + wr);
          e.fuel = Math.max(0, e.fuel - 0.00034 * e.v * dt * this.fuelScale * 0.9);
          if (e.wear >= 0.995 && !e.punctured) { e.punctured = true; this.emit('puncture', { car: e }); e.pitRequest = true; e.ai.nextCompound = 'hard'; }
        }
      }
      if (this._retireLater) {
        for (const r of this._retireLater) if (!r.done && this.t >= r.at) { r.done = true; this.retire(r.e, r.reason, Math.random() < 0.5); }
      }
      this.collisions(dt);
      this.updateFlags(dt);
      this.updateOrder(dt);
    }
  }

  formationCheck(e) {
    const tr = this.track;
    if (e.ai && e.ai.mode === 'grid') return;
    if (e.formationStarted && tr.wrapS(e.s - tr.wrapS(e.slot.s - 380)) < 300 && e.lap >= 0) {
      // comienza la aproximación a la grilla
      if (e.ai) e.ai.mode = 'grid';
      if (e.isPlayer) { this.playerAuto = true; e.pitPhase = null; }
      e.gridMode = true;
    }
  }

  gridApproach(e, dt) {
    const tr = this.track;
    const dist = tr.wrapS(e.slot.s - e.s);
    const near = dist < 400;
    let vt = near ? Math.min(25, Math.sqrt(2 * 5 * Math.max(0, dist - 0.2))) : 25;
    if (dist > tr.length - 20) vt = 0; // se pasó: frenar
    const acc = clamp((vt - e.v) * 3, -10, 5);
    e.v = Math.max(0, e.v + acc * dt);
    const dTarget = dist < 150 ? e.slot.d : tr.line[tr.idx(e.s)] * 0.5;
    const dd = clamp(dTarget - e.d, -2 * dt, 2 * dt);
    e.d += dd; e.dDot = dd / dt;
    e.s = tr.wrapS(e.s + e.v * dt);
    if (dist < 0.5 || dist > tr.length - 20) { e.v = 0; e.onGrid = true; }
  }

  updateRacePhase(dt, input) {
    if (this.phase === 'formation-ready') {
      this.phase = 'formation';
      this.emit('formation', {});
      for (const e of this.entrants) { e.formationStarted = true; e.lap = -1; }
      return;
    }
    if (this.phase === 'formation') {
      // todos en la grilla?
      const ready = this.entrants.every(e => e.retired || e.onGrid);
      this._formT = (this._formT || 0) + dt;
      if (ready || this._formT > 240) {
        for (const e of this.entrants) {
          e.s = e.slot.s; e.d = e.slot.d; e.v = 0; e.lap = -1; e.dDot = 0; e.gridMode = false;
          if (e.ai) e.ai.mode = 'race';
          this.updateWorld(e);
        }
        if (this.player) {
          const p = this.player, pos = this.track.pointAt(p.s, p.d);
          this.phys.reset(pos.x, pos.z, pos.heading, pos.y);
          this.playerAuto = false;
        }
        this.phase = 'lights';
        this.lightsTimer = -2;
        this.emit('grid_formed', {});
      }
      return;
    }
    if (this.phase === 'lights') {
      this.lightsTimer += dt;
      for (const e of this.entrants) { e.v = 0; this.updateWorld(e); }
      this.updatePlayer(dt, input);
      const prev = this.lightsOn;
      if (this.lightsTimer > 0) this.lightsOn = Math.min(5, Math.floor(this.lightsTimer) + 1);
      if (this.lightsOn !== prev && this.lightsOn > 0) this.emit('light', { n: this.lightsOn });
      if (this.lightsTimer > 5 + this.lightsHold) {
        this.lightsOn = 0;
        this.phase = 'race';
        this.raceStart = this.t;
        this.restartTime = this.raceTime;
        for (const e of this.entrants) {
          e.lapStart = this.t; e.sectorStart = this.t;
          if (e.ai) {
            const sk = e.driver.skill.start;
            e.ai.launch = clamp(0.93 + sk * 0.08 + gauss() * 0.02, 0.85, 1.04);
            e.ai.reaction = 0.15 + (1 - sk) * 0.3 + Math.random() * 0.12;
          }
        }
        this.emit(this.restartFromRed ? 'restart_go' : 'lights_out', {});
      }
      return;
    }
    if (this.phase === 'race' && this.raceTime < 1.2) {
      // tiempo de reacción de la IA
      for (const e of this.entrants) if (e.ai && this.raceTime < (e.ai.reaction || 0.2)) e.v = 0;
    }
    if (this.phase === 'finish') {
      const allDone = this.entrants.every(e => e.finished || e.retired);
      const playerDone = !this.player || this.player.finished || this.player.retired;
      if (allDone || (playerDone && this.t - this.leaderFinishedAt > 70) || this.t - this.leaderFinishedAt > 240) {
        // clasificar a los que quedan en pista por progreso
        const rest = this.entrants.filter(e => !e.finished && !e.retired).sort((a, b) => b.progress - a.progress);
        for (const e of rest) {
          e.finished = true; e.finishOrder = ++this.finishOrder; e.finishLaps = e.lap;
          e.finishTime = this.raceTime + (this.laps - e.lap) * 90;
        }
        this.phase = 'cooldown';
        this.results = this.buildResults();
        this.emit('session_end', { results: this.results });
      }
    }
  }

  updateSessionPhase(dt) {
    if (this.phase === 'session' && this.t >= this.sessionLength && this.type !== 'timetrial' && this.type !== 'practice-free') {
      this.phase = 'session-end';
      this.emit('session_flag', {});
    }
    if (this.phase === 'session-end') {
      const p = this.player;
      const playerDone = !p || p.finished || p.inGarage || p.retired || (p.inPit && p.pitPhase !== 'exit');
      this._endT = (this._endT || 0) + dt;
      if ((playerDone && this._endT > 3) || this._endT > 180) this.endSession();
    }
  }

  endSession() {
    if (this.results) return;
    // la IA que no completó vueltas: tiempo estimado de acuerdo a su ritmo
    for (const e of this.entrants) {
      if (e.ai && !isFinite(e.bestLap)) {
        e.ai.ensureProfile(true);
        e.bestLap = e.ai.profile.lapTime * (1.012 + Math.abs(gauss()) * 0.004 * (1.1 - e.driver.skill.consistency));
        e.simulated = true;
      }
    }
    this.phase = 'cooldown';
    this.results = this.buildResults();
    this.emit('session_end', { results: this.results });
  }

  simulateRemaining() {
    // "Saltar al final": completa las vueltas de la IA con su ritmo esperado
    for (const e of this.entrants) {
      if (!e.ai) continue;
      e.ai.ensureProfile(true);
      const remainingRuns = Math.max(0, Math.floor((this.sessionLength - this.t) / 150));
      for (let k = 0; k < Math.max(1, remainingRuns); k++) {
        const lt = e.ai.profile.lapTime * (1.006 + Math.abs(gauss()) * 0.005 * (1.15 - e.driver.skill.consistency));
        if (lt < e.bestLap) e.bestLap = lt;
      }
    }
    this.t = Math.max(this.t, this.sessionLength);
    this.endSession();
  }

  updateOrder(dt) {
    this.order = this.standings();
    this.order.forEach((e, i) => { e.position = i + 1; });
    // intervalos
    const lead = this.order[0];
    for (let i = 0; i < this.order.length; i++) {
      const e = this.order[i];
      e.interval = i === 0 ? 0 : this.gapBetween(e, this.order[i - 1]);
      e.gapLeader = i === 0 ? 0 : this.gapBetween(e, lead);
      e.lapsDown = lead.lap - e.lap - (e.s > lead.s ? 1 : 0);
    }
    if (this.type !== 'race' || this.phase !== 'race') { this.lastOrder = this.order.slice(); return; }
    // detectar adelantamientos en pista (confirmados después de 1.2 s)
    const prevIdx = new Map(this.lastOrder.map((e, i) => [e, i]));
    for (let i = 0; i < this.order.length - 1; i++) {
      const a = this.order[i], b = this.order[i + 1];
      const pa = prevIdx.get(a), pb = prevIdx.get(b);
      if (pa === undefined || pb === undefined) continue;
      if (pa > pb && !a.inPit && !b.inPit && !b.retired && !a.retired && Math.abs(a.progress - b.progress) < 40) {
        const key = a.index + ':' + b.index;
        if (!this.pendingPasses.has(key)) this.pendingPasses.set(key, { a, b, t: this.t, pos: i + 1 });
      }
    }
    for (const [key, pp] of this.pendingPasses) {
      if (pp.a.progress < pp.b.progress) { this.pendingPasses.delete(key); continue; }
      if (this.t - pp.t > 1.8 && pp.a.progress - pp.b.progress > 3) {
        this.pendingPasses.delete(key);
        if (this.raceTime < 2) continue;
        const corner = this.track.cornerNear(pp.a.s);
        const inside = corner ? Math.sign(pp.a.d - pp.b.d) === corner.dir : null;
        this.emit('overtake', { car: pp.a, victim: pp.b, position: pp.a.position, corner, inside });
        pp.a.lastOvertakeT = this.t;
        pp.b.lastPassedT = this.t;
        // adelantamiento bajo bandera amarilla / Safety Car
        if (pp.a.isPlayer && (this.scState !== 'none' || this.yellow[this.sectorOf(pp.a.s)] > 0) && !pp.b.inPit) {
          this.penalize(pp.a, 5, this.scState !== 'none' ? 'adelantar bajo Safety Car' : 'adelantar con bandera amarilla');
        }
      }
    }
    // banderas azules
    for (const e of this.entrants) {
      e.blue = false;
      if (e.retired || e.inPit) continue;
      const bh = this.carBehindOnTrack(e, 70);
      if (bh && bh.car.progress > e.progress + this.track.length * 0.5) e.blue = true;
    }
    this.lastOrder = this.order.slice();
  }

  buildResults() {
    const order = this.standings();
    const lead = order[0];
    return order.map((e, i) => {
      let gap = '';
      if (this.type === 'race') {
        if (e.retired) gap = 'Abandono';
        else if (i === 0) gap = fmtTime(e.finishTime + e.penaltySec);
        else {
          const lapsDown = (lead.finishLaps ?? lead.lap) - (e.finishLaps ?? e.lap);
          if (lapsDown > 0) gap = `+${lapsDown} vuelta${lapsDown > 1 ? 's' : ''}`;
          else gap = '+' + (e.finishTime + e.penaltySec - (lead.finishTime + lead.penaltySec)).toFixed(3);
        }
      } else {
        gap = isFinite(e.bestLap) ? (i === 0 ? fmtTime(e.bestLap) : '+' + (e.bestLap - lead.bestLap).toFixed(3)) : 'Sin tiempo';
      }
      const pts = this.type === 'race' && !e.retired && i < 10 ? POINTS[i] : 0;
      return {
        pos: i + 1, id: e.driver.id, name: e.fullName, code: e.code, team: e.team.name, teamId: e.team.id,
        color: e.team.colors.primary, gap, best: e.bestLap, laps: e.lap, stops: e.pitStops, penalty: e.penaltySec,
        points: pts, retired: e.retired, reason: e.retireReason, isPlayer: e.isPlayer, grid: e.gridPosition,
        fastest: this.fastestLap.car === e,
      };
    });
  }
}

export function fmtTime(t) {
  if (!isFinite(t) || t <= 0) return '--:--.---';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
