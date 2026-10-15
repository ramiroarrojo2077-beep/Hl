// Dinámica del auto del jugador: modelo plano de 4 ruedas con transferencia de carga,
// neumáticos tipo Pacejka con elipse de fricción, aerodinámica, motor + ERS, frenos,
// temperaturas, desgaste, combustible, superficie (piano, pasto, grava, mojado) y daños.
//
// Ejes del cuerpo: x hacia adelante, y hacia la izquierda. r > 0 = giro a la izquierda.
// Mundo: forward = (cos psi, sin psi) en (x, z); izquierda = (sin psi, -cos psi).

import { COMPOUNDS } from '../data/teams.js';

export const G = 9.81;
export const TYRE_R = 0.36;
export const REV_LIMIT = 12300;
export const IDLE_RPM = 4000;
const GEAR_TOP_KMH = [92, 132, 168, 203, 238, 272, 306, 342];

// Agarre del compuesto según humedad de pista (0 = seco, 1 = inundado)
const WET_TABLE = {
  slick: [[0, 1.0], [0.15, 0.84], [0.35, 0.6], [0.6, 0.44], [1, 0.32]],
  inter: [[0, 0.8], [0.15, 0.82], [0.35, 0.78], [0.6, 0.66], [1, 0.5]],
  wet: [[0, 0.64], [0.15, 0.67], [0.35, 0.7], [0.6, 0.69], [1, 0.62]],
};
function table(tab, x) {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    if (x <= tab[i][0]) {
      const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return tab[tab.length - 1][1];
}
export function wetGrip(compoundId, wetness) {
  const c = COMPOUNDS[compoundId];
  return table(c.wetTyre ? WET_TABLE[compoundId] : WET_TABLE.slick, wetness);
}

export function tempGrip(T, opt) {
  const x = (T - opt) / 55;
  return 1 - 0.16 * Math.min(1, x * x);
}

export function wearGrip(w) {
  return 1 - 0.07 * w - Math.max(0, w - 0.72) * 0.9;
}

// Superficies: 0 asfalto, 1 piano, 2 pasto, 3 grava, 4 escapatoria asfaltada
export const SURF = [
  { mu: 1.0, roll: 0.012, name: 'asfalto' },
  { mu: 0.9, roll: 0.02, name: 'piano' },
  { mu: 0.5, roll: 0.09, name: 'pasto' },
  { mu: 0.42, roll: 0.42, name: 'grava' },
  { mu: 0.94, roll: 0.014, name: 'escapatoria' },
];

export const DEFAULT_SETUP = {
  frontWing: 6, rearWing: 6, brakeBias: 56, diff: 60, frontARB: 6, rearARB: 6, brakeDucts: 3, pressure: 0,
};

// Parámetros del auto según equipo y reglaje
export function buildSpec(team, setup = DEFAULT_SETUP, opts = {}) {
  const s = { ...DEFAULT_SETUP, ...setup };
  const aero = team ? team.aero : 0.95, power = team ? team.power : 0.95;
  const clA = (3.45 + 0.055 * s.frontWing + 0.07 * s.rearWing) * (0.93 + 0.07 * aero);
  const cdA = 0.9 + 0.012 * s.frontWing + 0.026 * s.rearWing;
  const aeroBal = 0.38 + 0.011 * (s.frontWing - s.rearWing);
  const gearMax = GEAR_TOP_KMH.map(k => (k / 3.6) * (opts.gearScale || 1));
  const ratios = gearMax.map(v => ((REV_LIMIT * 2 * Math.PI) / 60) * TYRE_R / v);
  return {
    massDry: 800,
    wheelbase: 3.6, a: 1.98, b: 1.62, h: 0.29, trackF: 1.6, trackR: 1.55,
    izz: 1250,
    clA, cdA, aeroBal,
    pIce: 600000 * (0.94 + 0.06 * power), pErs: 120000,
    ratios,
    brakeMaxG: 5.6,
    brakeBias: s.brakeBias / 100,
    diffLock: s.diff / 100,
    rollBal: 0.6 + 0.03 * (s.frontARB - s.rearARB),
    brakeCool: 0.7 + 0.15 * s.brakeDucts,
    pressure: s.pressure,
    muBase: 1.78,
    reliability: team ? team.reliability : 0.92,
  };
}

const WHEELS = ['FL', 'FR', 'RL', 'RR'];

export class CarPhysics {
  constructor(spec) {
    this.spec = spec;
    this.x = 0; this.z = 0; this.y = 0; this.psi = 0;
    this.vx = 0; this.vy = 0; this.r = 0;
    this.ax = 0; this.ay = 0;
    this.gear = 1; this.rpm = IDLE_RPM; this.shiftTimer = 0; this.autoGear = true;
    this.steerAngle = 0;
    this.fuel = 20; this.fuelMix = 1; // 0 pobre, 1 estándar, 2 rico
    this.battery = 4e6; this.ersMode = 1; // 0 apagado, 1 balanceado, 2 adelantamiento
    this.compound = 'medium';
    this.tyreT = [70, 70, 70, 70];
    this.wear = [0, 0, 0, 0];
    this.brakeT = [300, 300, 300, 300];
    this.surf = [0, 0, 0, 0];
    this.lock = [false, false, false, false];
    this.spin = [false, false, false, false];
    this.fz = [0, 0, 0, 0];
    this.slip = [0, 0, 0, 0];
    this.wheelRot = [0, 0, 0, 0];
    this.wheelSpeed = [0, 0, 0, 0];
    this.dirt = 0;
    this.damage = { frontWing: 0, rearWing: 0, floor: 0, susp: [0, 0, 0, 0], engine: 0, gearbox: 0 };
    this.failure = null;
    this.punctured = [false, false, false, false];
    this.drsOpen = false;
    this.limiter = false;
    this.s = 0; this.d = 0; this.ti = -1;
    this.impact = 0; // última velocidad de impacto (para audio/daños)
    this.onKerb = 0; this.offTrack = false;
    this.wearScale = 1; this.fuelScale = 1;
    this.assists = { abs: true, tc: true, stability: false };
    this.throttleOut = 0; this.brakeOut = 0;
    this.slideAmount = 0;
    this.distance = 0;
  }

  get speed() { return Math.hypot(this.vx, this.vy); }
  get mass() { return this.spec.massDry + this.fuel; }

  reset(x, z, psi, y = 0) {
    this.x = x; this.z = z; this.psi = psi; this.y = y;
    this.vx = this.vy = this.r = 0; this.ax = this.ay = 0;
    this.gear = 1; this.rpm = IDLE_RPM; this.ti = -1;
  }

  setVelocityWorld(vx, vz) {
    const c = Math.cos(this.psi), s = Math.sin(this.psi);
    this.vx = vx * c + vz * s;
    this.vy = vx * s - vz * c;
  }

  fitTyres(compound) {
    this.compound = compound;
    const c = COMPOUNDS[compound];
    this.tyreT = [1, 1, 1, 1].map(() => c.wetTyre ? 60 : 75);
    this.wear = [0, 0, 0, 0];
    this.punctured = [false, false, false, false];
  }

  gearSpeed(g) { return ((REV_LIMIT * 2 * Math.PI) / 60) * TYRE_R / this.spec.ratios[g - 1]; }

  enginePower(rpm) {
    let f;
    if (rpm < 4000) f = 0.3;
    else if (rpm < 10500) f = 0.3 + (0.7 * (rpm - 4000)) / 6500;
    else if (rpm <= 12000) f = 1;
    else f = Math.max(0, 1 - (rpm - 12000) / 300);
    return f;
  }

  // env: { track, wetness, airTemp, rho, slipstream, dirtyAir, drsAllowed }
  step(dt, input, env) {
    const sp = this.spec, track = env.track;
    const m = this.mass, L = sp.wheelbase;
    const vx = this.vx, vy = this.vy, r = this.r;
    const v = Math.hypot(vx, vy);
    const dmg = this.damage;

    // --- entradas ---
    let throttle = input.throttle, brake = input.brake;
    if (this.limiter) {
      const lim = 80 / 3.6;
      if (vx > lim - 0.3) throttle = Math.min(throttle, Math.max(0, (lim - vx) * 0.4));
      if (vx > lim + 1.5) brake = Math.max(brake, Math.min(1, (vx - lim) * 0.15));
    }
    if (this.failure === 'engine' || dmg.engine >= 1) throttle = 0;
    const maxLock = input.steerMode === 'wheel' ? 0.3 : (0.36 / (1 + v / 28));
    let target = -input.steer * maxLock; // steer > 0 = derecha
    const suspPull = (dmg.susp[0] - dmg.susp[1]) * 0.03;
    target += suspPull;
    const rate = input.steerMode === 'wheel' ? 8 : input.steerMode === 'pad' ? 4.5 : 2.8;
    this.steerAngle += Math.max(-rate * dt, Math.min(rate * dt, target - this.steerAngle));
    const delta = this.steerAngle;

    // --- motor y caja ---
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    const wheelOmega = vx / TYRE_R;
    const ratio = sp.ratios[this.gear - 1];
    let rpm = (Math.abs(wheelOmega) * ratio * 60) / (2 * Math.PI);
    if (this.gear === 1 && rpm < 7000) {
      // embrague patinando en la largada
      rpm = Math.max(rpm, IDLE_RPM + throttle * 5500);
    }
    rpm = Math.max(IDLE_RPM * (throttle > 0.05 ? 1 : 0.95), rpm);
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * 30);
    if (this.autoGear || input.autoGear) {
      if (this.rpm > 11850 && this.gear < 8 && this.shiftTimer <= 0) this.shift(1);
      else if (this.gear > 1 && this.shiftTimer <= 0) {
        const lower = ((Math.abs(wheelOmega) * sp.ratios[this.gear - 2] * 60) / (2 * Math.PI));
        if (lower < (brake > 0.1 ? 11200 : 9600)) this.shift(-1);
      }
    }
    if (input.gearUp) this.shift(1);
    if (input.gearDown) this.shift(-1);

    // ERS
    let ersPower = 0;
    if (this.ersMode > 0 && this.battery > 0 && throttle > (this.ersMode === 2 ? 0.2 : 0.6)) {
      ersPower = sp.pErs * (this.ersMode === 2 ? 1 : 0.65) * throttle;
      this.battery = Math.max(0, this.battery - ersPower * dt);
    }
    const mixP = [0.93, 1, 1.03][this.fuelMix];
    const failP = this.failure === 'ers' ? 0.85 : this.failure === 'power' ? 0.9 : 1;
    let power = (sp.pIce * mixP * (1 - dmg.engine * 0.3) * failP + ersPower) * this.enginePower(this.rpm) * throttle;
    if (this.shiftTimer > 0.02) power *= 0.3;
    if (this.fuel <= 0) power = 0;
    const engineOmega = Math.max((this.rpm * 2 * Math.PI) / 60, 300);
    let driveForce = ((power / engineOmega) * ratio) / TYRE_R;
    if (this.rpm >= REV_LIMIT - 10) driveForce = 0;
    if (vx < -0.5) driveForce = Math.max(0, driveForce);
    const engineBrake = throttle < 0.05 && vx > 2 ? 0.12 * m * G * Math.min(1, vx / 30) : 0;

    // combustible
    const fuelRate = 0.0285 * Math.max(0.08, throttle) * [0.86, 1, 1.08][this.fuelMix];
    this.fuel = Math.max(0, this.fuel - fuelRate * dt * this.fuelScale);

    // --- aerodinámica ---
    const rho = env.rho;
    const dirty = env.dirtyAir || 0;
    const drs = this.drsOpen;
    const downBase = 0.5 * rho * sp.clA * v * v * (1 - dirty) * (1 - dmg.floor * 0.25);
    const fwEff = 1 - dmg.frontWing * 0.55, rwEff = (1 - dmg.rearWing * 0.5) * (drs ? 0.86 : 1);
    const downF = downBase * sp.aeroBal * fwEff;
    const downR = downBase * (1 - sp.aeroBal) * rwEff;
    const drag = 0.5 * rho * sp.cdA * v * v * (1 - (env.slipstream || 0)) * (drs ? 0.83 : 1) *
      (1 + dmg.frontWing * 0.06 + dmg.rearWing * 0.08 + dmg.floor * 0.05);

    // --- cargas verticales ---
    const a = sp.a, b = sp.b, h = sp.h;
    const axF = Math.max(-60, Math.min(60, this.ax)), ayF = Math.max(-60, Math.min(60, this.ay));
    const FzF = (m * G * b) / L + downF - (m * axF * h) / L;
    const FzR = (m * G * a) / L + downR + (m * axF * h) / L;
    const latT = (m * ayF * h);
    const dF = (latT / sp.trackF) * sp.rollBal, dR = (latT / sp.trackR) * (1 - sp.rollBal);
    const fz = this.fz;
    fz[0] = Math.max(50, FzF / 2 - dF); fz[1] = Math.max(50, FzF / 2 + dF);
    fz[2] = Math.max(50, FzR / 2 - dR); fz[3] = Math.max(50, FzR / 2 + dR);

    // --- superficie bajo cada rueda ---
    const c = Math.cos(this.psi), s = Math.sin(this.psi);
    const pos = [[a, sp.trackF / 2], [a, -sp.trackF / 2], [-b, sp.trackR / 2], [-b, -sp.trackR / 2]];
    const proj = this._proj || (this._proj = {});
    let kerb = 0, off = 0;
    for (let i = 0; i < 4; i++) {
      const wx = this.x + pos[i][0] * c + pos[i][1] * s;
      const wz = this.z + pos[i][0] * s - pos[i][1] * c;
      track.project(wx, wz, this.ti, proj);
      this.surf[i] = track.surface(proj.s, proj.d);
      if (this.surf[i] === 1) kerb++;
      if (this.surf[i] === 2 || this.surf[i] === 3) off++;
    }
    this.onKerb = kerb; this.offTrack = off >= 3;
    if (off > 0) this.dirt = Math.min(1, this.dirt + dt * 0.6 * off);
    else this.dirt = Math.max(0, this.dirt - dt * 0.08 * (v / 40));

    // --- fuerzas de neumáticos ---
    const comp = COMPOUNDS[this.compound];
    const wet = env.wetness || 0;
    const wetF = wetGrip(this.compound, wet);
    const brakeTotal = brake * sp.brakeMaxG * m * G;
    let Fx = 0, Fy = 0, Mz = 0;
    let slideSum = 0;
    this.absActive = false; this.tcActive = false;
    const absOn = this.assists.abs, tcOn = this.assists.tc;
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const px = pos[i][0], py = pos[i][1];
      const wvx = vx - r * py, wvy = vy + r * px;
      const sd = front ? delta : 0;
      const cd = Math.cos(sd), sdn = Math.sin(sd);
      const vl = wvx * cd + wvy * sdn;
      const vt = -wvx * sdn + wvy * cd;
      const alpha = Math.atan2(vt, Math.max(Math.abs(vl), 5));
      const surf = SURF[this.surf[i]];
      const wetSurf = this.surf[i] === 2 ? wet * 0.6 : 0;
      const loadSens = 1 - 0.09 * (fz[i] / 3200 - 1);
      let mu = sp.muBase * comp.grip * tempGrip(this.tyreT[i], comp.optTemp + this.spec.pressure * 3) * wearGrip(this.wear[i]) *
        wetF * surf.mu * (1 - wetSurf) * (1 - this.dirt * 0.12) * loadSens * (1 - dmg.susp[i] * 0.25);
      if (this.punctured[i]) mu *= 0.3;
      const brakeEff = this.brakeT[i] < 200 ? 0.82 + 0.18 * (this.brakeT[i] / 200) : this.brakeT[i] > 1000 ? Math.max(0.6, 1 - (this.brakeT[i] - 1000) / 600) : 1;
      const Fmax = mu * fz[i];
      // fuerza lateral pura (Pacejka simplificado)
      const B = 16, C = 1.3, E = 0.1;
      const ba = B * Math.abs(alpha);
      const fy0 = -Math.sign(alpha) * Fmax * Math.sin(C * Math.atan(ba - E * (ba - Math.atan(ba))));
      // demanda longitudinal
      let fxd = 0;
      const dir = vl >= 0 ? 1 : -1;
      if (!front) {
        const share = 0.5 * (1 - sp.diffLock) + sp.diffLock * (fz[i] / (fz[2] + fz[3]));
        fxd += driveForce * share - engineBrake * 0.5;
      }
      const bshare = front ? sp.brakeBias / 2 : (1 - sp.brakeBias) / 2;
      let fb = brakeTotal * bshare * brakeEff;
      if (Math.abs(vl) > 0.3) fxd -= dir * fb;
      else fxd -= Math.max(-fb, Math.min(fb, vl * m * 2));
      // rodadura
      fxd -= dir * surf.roll * fz[i] * Math.min(1, Math.abs(vl));
      // ABS y control de tracción: limitan la demanda a lo que el neumático puede dar
      const avail = Math.sqrt(Math.max(Fmax * Fmax * 0.04, Fmax * Fmax * 0.96 - fy0 * fy0));
      if (absOn && fxd * dir < 0 && Math.abs(fxd) > avail) { fxd = -dir * avail; this.absActive = true; }
      if (!front && tcOn && fxd * dir > 0 && Math.abs(fxd) > avail * 0.9) { fxd = dir * avail * 0.9; this.tcActive = true; }

      let fl, ft;
      this.lock[i] = false; this.spin[i] = false;
      if (Math.abs(fxd) <= Fmax) {
        fl = fxd;
        const rem = Math.sqrt(Math.max(0, Fmax * Fmax - fl * fl));
        ft = Math.max(-rem, Math.min(rem, fy0));
        this.slip[i] = Math.abs(alpha) / 0.14;
      } else if (fxd < 0 === dir > 0 && Math.abs(vl) > 1) {
        // rueda bloqueada: la fuerza se opone al deslizamiento
        const vv = Math.hypot(vl, vt) || 1;
        const muS = Fmax * 0.86;
        fl = (-vl / vv) * muS; ft = (-vt / vv) * muS;
        this.lock[i] = true;
        this.slip[i] = 2;
      } else {
        // patina en aceleración
        fl = Math.sign(fxd) * Fmax * 0.9;
        ft = Math.max(-Fmax * 0.38, Math.min(Fmax * 0.38, fy0));
        this.spin[i] = Math.abs(vl) < 70;
        this.slip[i] = 1.5;
      }
      // fuerzas al cuerpo
      const fxb = fl * cd - ft * sdn, fyb = fl * sdn + ft * cd;
      Fx += fxb; Fy += fyb;
      Mz += px * fyb - py * fxb;

      // potencia de deslizamiento: calor y desgaste
      const slipVel = this.lock[i] || this.spin[i] ? Math.max(3, Math.abs(vl) * 0.3) : Math.abs(vt) + Math.abs(fl) / (Fmax + 1) * 0.6;
      const slipPow = (Math.abs(ft) + Math.abs(fl)) * slipVel;
      slideSum += this.lock[i] || this.spin[i] ? 1 : Math.max(0, Math.abs(alpha) - 0.1) * 6;
      const ambient = (env.airTemp || 22) + 8;
      const heat = slipPow * 0.00042 * comp.warmRate + v * 0.045 + (fz[i] / 4000) * v * 0.012;
      const cool = (this.tyreT[i] - ambient) * (0.028 + v * 0.0011 + wet * 0.12);
      this.tyreT[i] += (heat - cool) * dt;
      let wr = slipPow * 5.2e-8 * comp.wear * this.wearScale;
      if (this.tyreT[i] > comp.optTemp + 25) wr *= 1 + (this.tyreT[i] - comp.optTemp - 25) / 15;
      if (comp.wetTyre && wet < 0.15) wr *= 2.5;
      if (this.lock[i]) wr += 0.00025 * dt * v * this.wearScale; // plano en la goma
      this.wear[i] = Math.min(1.05, this.wear[i] + wr * dt + v * 2.0e-6 * comp.wear * this.wearScale * dt);
      if (this.wear[i] >= 1 && !this.punctured[i]) this.punctured[i] = true;

      // frenos
      const bp = Math.abs(fb) * Math.abs(vl);
      const bcool = (this.brakeT[i] - 120) * (0.03 + v * 0.0025) * sp.brakeCool;
      this.brakeT[i] += (bp * (front ? 6.2e-4 : 4.6e-4) - bcool) * dt;

      // giro de las ruedas para el render
      const ws = this.lock[i] ? 0 : this.spin[i] ? Math.max(vl, 0) * 1.6 + 5 : vl;
      this.wheelSpeed[i] = ws;
      this.wheelRot[i] = (this.wheelRot[i] + (ws / TYRE_R) * dt) % (Math.PI * 2);
    }
    this.slideAmount = slideSum / 4;

    // gravedad por pendiente y resistencia aerodinámica
    track.project(this.x, this.z, this.ti, proj);
    this.ti = proj.i;
    this.s = proj.s; this.d = proj.d;
    const trackHead = proj.heading;
    const relH = this.psi - trackHead;
    const gradeF = -m * G * Math.sin(Math.atan(proj.grade)) * Math.cos(relH);
    Fx += gradeF - drag * (v > 0.01 ? vx / v : 0);
    Fy += -drag * (v > 0.01 ? vy / v : 0);

    // ERS: recuperación al frenar
    if (brake > 0.2 && vx > 10) this.battery = Math.min(4e6, this.battery + 120000 * dt * Math.min(1, brake * 1.5));

    // --- integración ---
    const axNew = Fx / m, ayNew = Fy / m;
    let nvx = vx + (axNew + r * vy) * dt;
    let nvy = vy + (ayNew - r * vx) * dt;
    let nr = r + (Mz / sp.izz) * dt;
    if (this.assists.stability && Math.abs(nvx) > 5) {
      const rRef = (nvx * Math.tan(delta)) / L;
      nr += (rRef - nr) * Math.min(1, dt * 2.5);
    }
    // a muy baja velocidad, amortiguar para evitar deriva numérica
    if (Math.abs(nvx) < 2.5) {
      nvy *= 1 - Math.min(1, dt * 8);
      nr = nr * (1 - Math.min(1, dt * 6)) + ((nvx * Math.tan(delta)) / L) * Math.min(1, dt * 6);
      if (throttle < 0.05 && Math.abs(nvx) < 0.4 && brake > 0.05) nvx = 0;
    }
    this.ax += (axNew - this.ax) * Math.min(1, dt * 18);
    this.ay += (ayNew - this.ay) * Math.min(1, dt * 18);
    this.vx = nvx; this.vy = nvy; this.r = nr;
    this.psi -= this.r * dt;
    const wvxW = this.vx * c + this.vy * s, wvzW = this.vx * s - this.vy * c;
    this.x += wvxW * dt; this.z += wvzW * dt;
    this.distance += Math.max(0, this.vx) * dt;
    this.y = proj.y;
    this.grade = proj.grade;

    this.throttleOut = throttle; this.brakeOut = brake;
    this._walls(track, dt);
  }

  shift(dir) {
    const g = this.gear + dir;
    if (g < 1 || g > 8 || this.shiftTimer > 0) return false;
    if (this.failure === 'gearbox' && g > 6) return false;
    this.gear = g;
    this.shiftTimer = 0.06;
    this.justShifted = dir;
    return true;
  }

  // Colisión con muros/barreras y separación de la calle de boxes
  _walls(track, dt) {
    const proj = this._proj;
    track.project(this.x, this.z, this.ti, proj);
    const [lo, hi] = track.limits(proj.s, proj.d);
    const c = Math.cos(this.psi), s = Math.sin(this.psi);
    // extensión lateral del auto respecto de la normal de la pista
    const th = proj.heading;
    const rel = this.psi - th;
    const halfLen = 2.8, halfW = 1.0;
    const ext = Math.abs(Math.sin(rel)) * halfLen + Math.abs(Math.cos(rel)) * halfW;
    let pen = 0, nSign = 0;
    if (proj.d + ext > hi) { pen = proj.d + ext - hi; nSign = 1; }
    else if (proj.d - ext < lo) { pen = lo - (proj.d - ext); nSign = -1; }
    this.impact = 0;
    if (pen > 0) {
      // normal hacia afuera del muro en el mundo (izquierda de la pista = (tz, -tx))
      const tx = Math.cos(th), tz = Math.sin(th);
      const nx = tz * nSign, nz = -tx * nSign;
      this.x -= nx * pen; this.z -= nz * pen;
      const wvx = this.vx * c + this.vy * s, wvz = this.vx * s - this.vy * c;
      const vn = wvx * nx + wvz * nz;
      if (vn > 0) {
        const e = 0.25;
        let nwx = wvx - (1 + e) * vn * nx, nwz = wvz - (1 + e) * vn * nz;
        const fr = Math.max(0.6, 1 - vn * 0.03);
        nwx *= fr; nwz *= fr;
        this.vx = nwx * c + nwz * s;
        this.vy = nwx * s - nwz * c;
        this.r += -nSign * vn * 0.05 * Math.sign(Math.cos(rel));
        this.impact = vn;
        this._applyImpact(vn, Math.cos(rel) > 0.8 ? 'side' : 'front');
      }
    }
  }

  _applyImpact(vn, kind) {
    if (vn < 3) return;
    const sev = Math.min(1, (vn - 3) / 22);
    const dmg = this.damage;
    if (kind === 'front') {
      dmg.frontWing = Math.min(1, dmg.frontWing + sev * 1.2);
      dmg.susp[0] = Math.min(1, dmg.susp[0] + sev * 0.5);
      dmg.susp[1] = Math.min(1, dmg.susp[1] + sev * 0.5);
    } else {
      const k = Math.random() < 0.5 ? 0 : 2;
      dmg.susp[k] = Math.min(1, dmg.susp[k] + sev * 0.7);
      dmg.floor = Math.min(1, dmg.floor + sev * 0.4);
      dmg.frontWing = Math.min(1, dmg.frontWing + sev * 0.3);
    }
    if (vn > 14) dmg.rearWing = Math.min(1, dmg.rearWing + sev * 0.5);
    this.lastImpact = { vn, kind, t: performance.now ? performance.now() : 0 };
  }

  get retired() {
    const d = this.damage;
    return d.engine >= 1 || d.susp.some(x => x >= 1) || this.failure === 'terminal';
  }

  // Estado para HUD y telemetría
  telemetry() {
    return {
      speed: this.speed * 3.6, gear: this.gear, rpm: this.rpm, throttle: this.throttleOut, brake: this.brakeOut,
      tyreT: this.tyreT, wear: this.wear, brakeT: this.brakeT, fuel: this.fuel, battery: this.battery / 4e6,
      compound: this.compound, drs: this.drsOpen, ers: this.ersMode, mix: this.fuelMix, damage: this.damage,
    };
  }
}

export { WHEELS };
