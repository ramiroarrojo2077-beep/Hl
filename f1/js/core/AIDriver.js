// Piloto controlado por la IA. Se mueve en coordenadas de pista (s, d) con la velocidad
// limitada por el perfil físico (agarre, carga, potencia, frenada) de su auto, y toma
// decisiones: adelantar por dentro o por fuera, defender, seguir, respetar banderas,
// gestionar neumáticos y combustible, entrar a boxes y cometer errores.

import { wetGrip, wearGrip, G } from './CarPhysics.js';
import { COMPOUNDS } from '../data/teams.js';

const rnd = (a, b) => a + Math.random() * (b - a);

export const DIFFICULTY = {
  facil: { label: 'Fácil', mu: 0.86, power: 0.96, err: 1.6, aggr: 0.7 },
  normal: { label: 'Normal', mu: 0.915, power: 0.98, err: 1.0, aggr: 0.9 },
  dificil: { label: 'Difícil', mu: 0.955, power: 0.995, err: 0.75, aggr: 1.0 },
  leyenda: { label: 'Leyenda', mu: 0.985, power: 1.0, err: 0.5, aggr: 1.1 },
};

// Rendimiento base de un auto para el perfil de velocidad
export function basePerf(team, rho, extra = {}) {
  return {
    mu: 1.62 * (0.965 + 0.035 * team.car) * (extra.mu || 1),
    mass: 830,
    clA: 4.15 * (0.93 + 0.07 * team.aero),
    cdA: 1.15,
    power: 700000 * (0.94 + 0.06 * team.power) * (extra.power || 1),
    brakeG: 5.0,
    vmax: 97,
    rho,
  };
}

export class AIDriver {
  constructor(entrant, race) {
    this.e = entrant;
    this.race = race;
    this.track = race.track;
    const sk = entrant.driver.skill;
    this.sk = sk;
    this.diff = DIFFICULTY[race.opts.difficulty] || DIFFICULTY.normal;
    this.profile = null;
    this.profileKey = '';
    this.laneTarget = 0; // desplazamiento absoluto deseado (null = línea)
    this.mode = 'race';
    this.attackSide = 0; this.attackTimer = 0;
    this.defendDone = -1;
    this.error = null;
    this.paceNoise = 1;
    this.nextCornerChecked = -1;
    this.launch = 1;
    this.plan = null;
    this.lapPaceVar = 1;
  }

  perfKey() {
    const w = Math.round(this.race.wetness * 20);
    return `${this.e.compound}|${w}`;
  }

  ensureProfile(force = false) {
    const key = this.perfKey();
    if (!force && key === this.profileKey && this.profile) return;
    const r = this.race;
    const team = this.e.team;
    const wetF = wetGrip(this.e.compound, r.wetness);
    const wetSkill = 1 - r.wetness * (1 - this.sk.wet) * 0.25;
    const skillMu = (0.94 + 0.06 * this.sk.pace) * this.diff.mu * wetSkill;
    const comp = COMPOUNDS[this.e.compound];
    const perf = basePerf(team, r.rho, { mu: skillMu * wetF * comp.grip, power: this.diff.power });
    perf.brakeG = 4.4 + this.sk.braking * 0.8;
    this.perf = perf;
    this.profile = this.track.speedProfile(perf, r.wetness);
    this.profileKey = key;
  }

  // Plan de estrategia al inicio de la carrera
  planStrategy(raceLaps, wearScale) {
    const dry = this.race.wetness < 0.15;
    if (!dry) { this.plan = { stops: [] }; return; }
    const per = c => 0.026 * COMPOUNDS[c].wear * wearScale * (1.1 - this.sk.tyres * 0.2);
    const life = c => 0.72 / per(c);
    const options = [];
    const starts = ['soft', 'medium', 'hard'];
    for (const a of starts) for (const b of starts) {
      if (a === b) continue;
      if (life(a) + life(b) >= raceLaps * 1.02) {
        const stopLap = Math.round(Math.min(life(a), raceLaps - 1) * rnd(0.85, 1.0));
        if (stopLap >= 1 && raceLaps - stopLap <= life(b)) options.push({ start: a, stops: [{ lap: Math.max(1, stopLap), compound: b }] });
      }
    }
    if (!options.length) {
      // dos paradas
      const a = 'medium', b = 'hard', c = 'medium';
      const l1 = Math.max(1, Math.round(raceLaps * rnd(0.28, 0.36))), l2 = Math.max(l1 + 1, Math.round(raceLaps * rnd(0.62, 0.7)));
      options.push({ start: a, stops: [{ lap: l1, compound: b }, { lap: l2, compound: c }] });
    }
    // preferencia: los de adelante largan con medios, los de atrás con duros o blandos
    const pick = options[Math.floor(Math.random() * options.length)];
    this.plan = pick;
    if (raceLaps < 3) this.plan = { start: 'soft', stops: [] };
  }

  update(dt, t) {
    const e = this.e, r = this.race, tr = this.track;
    if (e.retired && !e.retiredOnTrack) return;
    if (e.retired) { this._stopped(dt); return; }
    this.ensureProfile();
    if (this.mode === 'pit') return; // controlado por PitLane
    if (this.mode === 'grid') return;

    // --- error en curso: trompo ---
    if (e.spinTimer > 0) { this._spin(dt); return; }

    const i = tr.idx(e.s);
    const lineD = tr.line[i];
    let vt = this.profile.v[i];
    // condición del neumático y combustible
    const comp = COMPOUNDS[e.compound];
    const tyreF = wearGrip(e.wear) * (e.tyreTemp < comp.optTemp - 30 ? 0.94 : 1);
    vt *= Math.sqrt(tyreF) * (1 - e.fuel * 0.00022) * this.lapPaceVar;
    vt *= 1 - e.damage.frontWing * 0.06 - e.damage.floor * 0.04;
    if (e.failure === 'gearbox') vt = Math.min(vt, 76);
    if (e.failure === 'ers') vt *= 0.975;
    // fuera de la línea en curva: menos velocidad
    const offLine = Math.abs(e.d - lineD);
    const kAbs = Math.abs(tr.k[i]);
    if (kAbs > 1 / 400) vt *= 1 - Math.min(0.12, offLine * 0.018 * Math.min(1, kAbs * 120));
    // aire sucio en curvas / rebufo en rectas
    if (kAbs > 1 / 300) vt *= 1 - e.dirtyAir * 0.05;
    else vt *= 1 + e.slipstream * 0.035 + (e.drsOpen ? 0.03 : 0);
    // banderas
    vt = r.flagSpeedCap(e, vt);
    // largada

    // --- tráfico ---
    const ah = r.carAheadOnTrack(e, 90);
    let followCap = Infinity;
    let laneWanted = lineD;
    const hw = tr.halfW - 1.1;
    const overtakeOk = r.overtakingAllowed(e);
    if (ah) {
      const o = ah.car, gap = ah.gap;
      const sameLane = Math.abs(o.d - e.d) < 2.15;
      const closing = e.v - o.v;
      const lapped = o.lap < e.lap - 0 && o.progress < e.progress - 50; // auto doblado adelante
      const faster = (this.profile.v[i] > o.v * 1.01 || closing > 1.0) && (r.raceTime > 5 || r.phase !== 'race');
      const recentlyPassed = r.t - (e.lastPassedT || -99) < 4;
      if (gap < 32 && (faster || this.attackTimer > 0) && overtakeOk && !o.inPit && !(recentlyPassed && closing < 2)) {
        // decidir lado de ataque
        if (this.attackTimer <= 0) {
          const corner = tr.cornerAhead(e.s);
          let side;
          const distC = corner ? tr.wrapS(corner.sStart - e.s) : 999;
          if (distC < 320 && corner) side = corner.dir; // por dentro
          else side = o.d > lineD ? -1 : 1; // del lado libre
          const room = side > 0 ? hw - o.d : o.d + hw;
          if (room < 2.4) side = -side;
          this.attackSide = side;
          this.attackTimer = rnd(2.5, 5) * this.diff.aggr * (0.8 + this.sk.attack * 0.4);
        }
        laneWanted = Math.max(-hw, Math.min(hw, o.d + this.attackSide * 2.45));
        if (lapped) laneWanted = Math.max(-hw, Math.min(hw, o.d + this.attackSide * 2.5));
        // si todavía no hay lugar, mantener distancia
        if (sameLane) followCap = this.safeFollow(o.v, gap, 6.2);
        // frenada tardía por dentro
        if (gap < 8 && Math.abs(o.d - e.d) > 2.0) vt *= 1 + 0.012 * this.sk.braking * this.diff.aggr;
      } else if (sameLane) {
        followCap = this.safeFollow(o.v, gap, overtakeOk ? 7 : 10);
      }
      if (sameLane && gap < 6) followCap = Math.min(followCap, o.v - 1);
    }
    if (this.attackTimer > 0) this.attackTimer -= dt;

    // defensa: auto atrás cerca antes de una curva
    const bh = r.carBehindOnTrack(e, 30);
    if (bh && !this.attackTimer && overtakeOk) {
      const corner = tr.cornerAhead(e.s);
      const distC = corner ? tr.wrapS(corner.sStart - e.s) : 999;
      if (corner && distC < 260 && distC > 60 && this.defendDone !== corner.number && Math.random() < this.sk.defense * dt * 3) {
        this.defendDone = corner.number;
        this.defendSide = corner.dir;
        this.defendTimer = 2.5;
        if (bh.car.isPlayer || e.position <= 6) r.emit('defend', { car: e, attacker: bh.car, corner });
      }
    }
    if (this.defendTimer > 0) {
      this.defendTimer -= dt;
      laneWanted = this.defendSide * hw * 0.55;
    }
    // preparar la entrada a boxes
    if (e.pitRequest && tr.wrapS(tr.pit.sIn - e.s) < 380) laneWanted = tr.pit.side * (tr.halfW - 1.3);
    // bandera azul: dejar pasar
    if (e.blue) {
      laneWanted = lineD > 0 ? -hw * 0.75 : hw * 0.75;
      vt *= 0.97;
    }
    // error activo: se pasa de largo
    if (this.error) {
      this.error.t -= dt;
      laneWanted = this.error.side * (tr.halfW + this.error.wide);
      vt = Math.min(vt, this.error.v);
      if (this.error.t <= 0) this.error = null;
    }

    // autos al costado: no cerrarles la puerta; autos adelante en la trayectoria: no chocarlos
    let blocker = null;
    for (const o of r.entrants) {
      if (o === e || (o.retired && (!o.retiredOnTrack || o.removed)) || o.inPit !== e.inPit || o.inGarage) continue;
      let ds = o.s - e.s;
      if (ds > tr.length / 2) ds -= tr.length; else if (ds < -tr.length / 2) ds += tr.length;
      if (Math.abs(ds) <= 6.5) {
        if (o.d >= e.d) laneWanted = Math.min(laneWanted, o.d - 2.3);
        else laneWanted = Math.max(laneWanted, o.d + 2.3);
      }
      if (ds > 0 && ds < 120) {
        const inPath = Math.abs(o.d - e.d) < 2.25 || (Math.abs(o.d - laneWanted) < 2.25 && ds > 4);
        if (inPath) followCap = Math.min(followCap, this.safeFollow(o.v, ds, overtakeOk ? 6.5 : 10));
        // obstáculo (auto detenido o muy lento): esquivarlo
        if (inPath && ds < 90 && (o.retired || o.v < Math.max(8, e.v * 0.55)) && (!blocker || ds < blocker.ds)) blocker = { o, ds };
      }
    }
    if (blocker) {
      const o = blocker.o;
      const lo2 = -tr.wallR[i] + 1.3, hi2 = tr.wallL[i] - 1.3;
      const roomL = hi2 - o.d, roomR = o.d - lo2;
      const side = roomL > roomR ? 1 : -1;
      laneWanted = Math.max(lo2, Math.min(hi2, o.d + side * 2.6));
      if (Math.abs(laneWanted - o.d) >= 2.3) followCap = Infinity;
      for (const q of r.entrants) {
        if (q === e || q === o || q.inPit !== e.inPit) continue;
        let dq = q.s - e.s; if (dq > tr.length / 2) dq -= tr.length; else if (dq < -tr.length / 2) dq += tr.length;
        if (dq > 0 && dq < 80 && Math.abs(q.d - laneWanted) < 2.25) followCap = Math.min(followCap, this.safeFollow(q.v, dq, 6.5));
      }
    }
    vt = Math.min(vt, followCap);
    // rueda a rueda: el que va por fuera de la próxima curva cede si no está adelante
    {
      const corner = tr.cornerAhead(e.s);
      const distC = corner ? tr.wrapS(corner.sStart - e.s) : 999;
      if (corner && distC < 90) {
        for (const o of r.entrants) {
          if (o === e || o.retired || o.inPit !== e.inPit) continue;
          let ds = o.s - e.s; if (ds > tr.length / 2) ds -= tr.length; else if (ds < -tr.length / 2) ds += tr.length;
          if (Math.abs(ds) < 5.5 && ds > -2.5 && (e.d - o.d) * corner.dir < 0 && Math.abs(e.d - o.d) < 3.2) {
            vt *= 0.94 + 0.03 * this.sk.attack;
            this.attackTimer = 0;
          }
        }
      }
    }
    // --- longitudinal ---
    const v = e.v, p = this.perf;
    const ka = 0.5 * p.rho * p.clA, kd = 0.5 * p.rho * p.cdA;
    const accMax = Math.min(p.power / (p.mass * Math.max(v, 8)), p.mu * 0.62 * (G + (ka * v * v) / p.mass)) - (kd * v * v) / p.mass - G * tr.grade[i];
    const decMax = p.mu * (G + (ka * v * v) / p.mass) * 0.98 + (kd * v * v) / p.mass;
    // largada: la calidad de la partida cambia la aceleración inicial
    const launchK = r.phase === 'race' && r.raceTime < 5 ? this.launch : 1;
    // seguimiento exacto del perfil: el perfil ya contempla frenada y aceleración posibles
    let nv;
    if (vt >= v) nv = Math.min(vt, v + Math.max(0, accMax * launchK) * dt);
    else nv = Math.max(vt, v - decMax * dt);
    const acc = (nv - v) / Math.max(dt, 1e-4);
    e.v = Math.max(0, nv);
    e.ax = acc;
    e.throttle = acc > 0 ? Math.min(1, acc / Math.max(1, accMax)) : 0;
    e.brake = acc < -2 ? Math.min(1, -acc / decMax) : 0;
    e.lockFx = 0;

    // --- lateral ---
    const lineSlope = Math.abs(tr.line[(i + 1) % tr.n] - tr.line[i]) / tr.ds;
    const latRate = Math.min(4.2, 1.2 + e.v * 0.06) + lineSlope * e.v * 1.5;
    const lo = -tr.wallR[i] + 1.2, hi = tr.wallL[i] - 1.2;
    const target = Math.max(lo, Math.min(hi, laneWanted));
    const dd = Math.max(-latRate * dt, Math.min(latRate * dt, (target - e.d) * Math.min(1, dt * 20)));
    e.d += dd;
    e.dDot = dd / Math.max(dt, 1e-4);

    // avance en s (la distancia al eje cambia con el desplazamiento lateral)
    const k = tr.k[i];
    e.s = tr.wrapS(e.s + (e.v * dt) / Math.max(0.6, 1 - k * e.d));
    e.ay = e.v * e.v * tr.lineK[i];

    // superficie
    const surf = tr.surface(e.s, e.d);
    if (surf === 3) e.v *= 1 - dt * 1.2;
    else if (surf === 2) e.v *= 1 - dt * 0.35;

    this._maybeError(dt);
    e.tyreTemp += ((comp.optTemp + 5 - e.tyreTemp) * 0.08) * dt;
  }

  // velocidad máxima para poder igualar la del auto de adelante dentro del hueco disponible
  safeFollow(vo, gap, minGap) {
    const dec = this.perf ? this.perf.mu * G * 1.6 : 20;
    return Math.sqrt(Math.max(0, vo * vo + 2 * dec * (gap - minGap))) + (gap > minGap ? 0 : (gap - minGap) * 0.8);
  }

  _maybeError(dt) {
    const e = this.e, r = this.race, tr = this.track;
    if (r.phase !== 'race' && r.phase !== 'session') return;
    const c = tr.cornerAhead(e.s);
    if (!c || c.number === this.nextCornerChecked) return;
    const dist = tr.wrapS(c.sStart - e.s);
    if (dist > 60) return;
    this.nextCornerChecked = c.number;
    if (r.scState !== 'none') return;
    const wet = r.wetness, sk = this.sk;
    let p = 0.02 * (1.06 - sk.consistency) * this.diff.err;
    p *= 1 + wet * 4 * (1.2 - sk.wet) + Math.max(0, e.wear - 0.6) * 5;
    if (this.attackTimer > 0) p *= 1.4;
    if (c.radius > 250) p *= 0.3;
    if (Math.random() > p) return;
    const roll = Math.random();
    const outside = -c.dir;
    if (roll < 0.62) {
      this.error = { kind: 'lockup', side: outside, wide: rnd(-1.5, 1.2), v: e.v * rnd(0.7, 0.85), t: rnd(1.2, 2.2) };
      e.lockFx = 1;
      r.emit('lockup', { car: e, corner: c });
    } else if (roll < 0.9) {
      this.error = { kind: 'off', side: outside, wide: rnd(3, 9), v: e.v * rnd(0.45, 0.65), t: rnd(2.5, 4) };
      e.lockFx = 1;
      r.emit('off_track', { car: e, corner: c });
    } else {
      this.startSpin(c);
    }
  }

  startSpin(corner, crash = null) {
    const e = this.e, r = this.race, tr = this.track;
    e.spinTimer = rnd(2.5, 4);
    this.spinDir = Math.random() < 0.5 ? -1 : 1;
    this.spinRate = rnd(4, 7);
    const street = tr.meta.street;
    const willCrash = crash !== null ? crash : (street ? Math.random() < 0.55 : Math.random() < 0.18 + r.wetness * 0.3);
    this.spinCrash = willCrash;
    this.spinOutside = corner ? -corner.dir : (Math.random() < 0.5 ? 1 : -1);
    r.emit(willCrash ? 'crash' : 'spin', { car: e, corner });
    r.incident(e, willCrash ? 'crash' : 'spin');
  }

  _spin(dt) {
    const e = this.e, tr = this.track;
    e.spinTimer -= dt;
    e.yawOffset += this.spinDir * this.spinRate * dt * Math.min(1, e.v / 15 + 0.2);
    e.v = Math.max(0, e.v - 14 * dt);
    const i = tr.idx(e.s);
    const wall = this.spinOutside > 0 ? tr.wallL[i] - 1.2 : -(tr.wallR[i] - 1.2);
    e.d += (wall - e.d) * Math.min(1, dt * (this.spinCrash ? 1.5 : 0.6));
    e.s = tr.wrapS(e.s + e.v * dt);
    e.smokeFx = 1;
    if (e.spinTimer <= 0) {
      if (this.spinCrash) {
        this.race.retire(e, 'accidente', true);
        e.damage.frontWing = 1;
      } else {
        e.yawOffset = 0;
        e.smokeFx = 0;
        e.v = 3;
        this.rejoinTimer = 1.5;
        this.race.emit('rejoin', { car: e });
      }
    }
  }

  _stopped(dt) {
    const e = this.e;
    e.v = Math.max(0, e.v - 20 * dt);
    e.stoppedTimer += dt;
  }
}
