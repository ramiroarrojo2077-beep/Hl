// Piloto automático sobre el modelo físico completo: valida estabilidad, tiempos y temperaturas.
import { Track } from '../js/core/Track.js';
import { TRACK_BY_ID } from '../js/data/tracks.js';
import { CarPhysics, buildSpec } from '../js/core/CarPhysics.js';
import { TEAMS } from '../js/data/teams.js';

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['monza', 'monaco', 'spa', 'suzuka', 'interlagos'];
const LAPS = 3;
const PACE = +(process.env.PACE || 0.97);
for (const id of ids) {
  const meta = TRACK_BY_ID[id];
  const tr = new Track(meta);
  const spec = buildSpec(TEAMS[3]);
  const rho = 1.225 * Math.exp(-meta.altitude / 8500);
  const prof = tr.speedProfile({ mu: 1.62, mass: 830, clA: spec.clA, cdA: spec.cdA, power: 700000, brakeG: 5.0, vmax: 97, rho });
  const car = new CarPhysics(spec);
  car.fuel = 15;
  car.fitTyres('medium');
  const p0 = tr.pointAt(tr.wrapS(-50), tr.line[tr.idx(-50)]);
  car.reset(p0.x, p0.z, p0.heading, p0.y);
  const v0 = prof.v[tr.idx(-50)] * 0.9;
  car.setVelocityWorld(Math.cos(p0.heading) * v0, Math.sin(p0.heading) * v0);
  const dt = 1 / 300;
  let t = 0, lap = 0, lapStart = 0, lastS = car.s, maxOff = 0, spins = 0, crashes = 0;
  const env = { track: tr, rho, wetness: 0, airTemp: meta.env.temp };
  const laps = [];
  let tyreAvg = 0, tyreN = 0, brakeMax = 0;
  const q = {};
  while (lap < LAPS && t < 600) {
    // control: pure pursuit sobre la línea de carrera
    const v = Math.max(car.speed, 5);
    const look = 5 + v * 0.3;
    tr.project(car.x, car.z, car.ti, q);
    const tp = tr.pointAt(q.s + look, tr.sample(tr.line, q.s + look));
    const dx = tp.x - car.x, dz = tp.z - car.z;
    const fx = Math.cos(car.psi), fz = Math.sin(car.psi);
    const lx = Math.sin(car.psi), lz = -Math.cos(car.psi);
    const ahead = dx * fx + dz * fz, left = dx * lx + dz * lz;
    const curv = (2 * left) / (ahead * ahead + left * left);
    const lineErr = tr.sample(tr.line, q.s) - q.d;
    const deltaWanted = Math.atan(curv * 3.6) + lineErr * 0.004;
    const maxLock = 0.36 / (1 + v / 28);
    const steer = Math.max(-1, Math.min(1, -deltaWanted / maxLock));
    // velocidad objetivo: mirar adelante la distancia de frenada
    let vt = 1e9;
    for (let k = 0; k < 160; k += 2) {
      const vk = prof.v[tr.idx(q.s + k)];
      const allowed = Math.sqrt(vk * vk + 2 * 3.6 * 9.81 * k);
      vt = Math.min(vt, allowed);
    }
    vt *= PACE;
    const err = vt - car.speed;
    const input = { steer, throttle: err > 0 ? Math.min(1, err * 0.5) * Math.max(0, 1 - Math.abs(car.vy) * 0.25) : 0, brake: err < -0.5 ? Math.min(1, -err * 0.25) : 0, steerMode: 'pad' };
    car.step(dt, input, env);
    t += dt;
    maxOff = Math.max(maxOff, Math.abs(car.d - tr.sample(tr.line, car.s)));
    if (Math.abs(car.vy) > 6) spins++;
    if (car.impact > 2) crashes++;
    if (lastS > tr.length - 100 && car.s < 100) {
      if (lap > 0) laps.push(t - lapStart);
      lap++; lapStart = t;
    }
    lastS = car.s;
    if (lap >= 1) { tyreAvg += car.tyreT.reduce((a, b) => a + b) / 4; tyreN++; brakeMax = Math.max(brakeMax, car.brakeT[0]); }
  }
  const f = x => `${Math.floor(x / 60)}:${(x % 60).toFixed(2).padStart(5, '0')}`;
  console.log(id.padEnd(12), 'profile', f(prof.lapTime), 'laps', laps.map(f).join(' '), 'maxOff', maxOff.toFixed(1),
    'spinFrames', spins, 'crash', crashes, 'tyreT', (tyreAvg / tyreN).toFixed(0), 'brakeMax', brakeMax.toFixed(0),
    'wear/lap', (car.wear.reduce((a, b) => a + b) / 4 / Math.max(1, laps.length + 1)).toFixed(4), 'fuel', car.fuel.toFixed(1));
}
