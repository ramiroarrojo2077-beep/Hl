// Flujos del jugador sin gráficos: carrera con parada en boxes asistida, clasificación y práctica.
import { Track } from '../js/core/Track.js';
import { TRACK_BY_ID } from '../js/data/tracks.js';
import { Session, fmtTime } from '../js/core/Session.js';
import { ReplayRecorder, ReplayPlayer } from '../js/core/Replay.js';

const trackId = process.argv[2] || 'monza';
const tr = new Track(TRACK_BY_ID[trackId]);
const prof = tr.speedProfile({ mu: 1.5, mass: 830, clA: 4.1, cdA: 1.15, power: 700000, brakeG: 5, vmax: 97, rho: 1.2 });
const q = {};
function autopilot(s) {
  const ph = s.phys;
  if (!ph) return { steer: 0, throttle: 0, brake: 0 };
  const v = Math.max(ph.speed, 5), look = 5 + v * 0.3;
  tr.project(ph.x, ph.z, ph.ti, q);
  const tp = tr.pointAt(q.s + look, tr.sample(tr.line, q.s + look));
  const dx = tp.x - ph.x, dz = tp.z - ph.z;
  const ahead = dx * Math.cos(ph.psi) + dz * Math.sin(ph.psi), left = dx * Math.sin(ph.psi) - dz * Math.cos(ph.psi);
  const curv = 2 * left / (ahead * ahead + left * left);
  const steer = Math.max(-1, Math.min(1, -Math.atan(curv * 3.6) / (0.36 / (1 + v / 28))));
  let vt = 1e9;
  for (let k = 0; k < 160; k += 2) { const vk = prof.v[tr.idx(q.s + k)]; vt = Math.min(vt, Math.sqrt(vk * vk + 2 * 3.5 * 9.81 * k)); }
  vt *= 0.92;
  // entrar a boxes: abrirse al carril si se pidió
  const err = vt - ph.speed;
  return { steer, throttle: err > 0 ? Math.min(1, err * 0.5) : 0, brake: err < -0.5 ? Math.min(1, -err * 0.25) : 0, steerMode: 'pad', autoGear: true };
}

let failures = 0;
const check = (cond, msg) => { console.log((cond ? 'OK   ' : 'FALLA') + ' ' + msg); if (!cond) failures++; };

// --- carrera con parada asistida ---
{
  const s = new Session(tr, { type: 'race', laps: 3, difficulty: 'normal', weather: 'seco', playerDriverId: 'ibarra', assists: { abs: true, tc: true, stability: true } });
  const rec = new ReplayRecorder(s);
  const ev = [];
  s.on((t, d) => { if (d.car === s.player) ev.push(t); });
  let steps = 0, requested = false;
  while (!s.results && steps < 60 * 60 * 15) {
    const p = s.player;
    if (p.lap === 1 && !requested) { p.pitRequest = true; p.pitCompound = 'hard'; requested = true; }
    // asistencia de entrada (lo que hace main.js con pitAssist)
    if (p.pitRequest && !s.playerAuto && s.phase === 'race' && tr.wrapS(tr.pit.sIn - s.phys.s) < 60) {
      p.s = s.phys.s; p.d = s.phys.d; p.v = s.phys.speed; p.inPit = true; p.pitPhase = 'entry'; s.playerAuto = true; s.emit('pit_in', { car: p });
    }
    s.update(1 / 60, autopilot(s));
    rec.update(1 / 60);
    steps++;
  }
  const p = s.player;
  check(!!s.results, `carrera terminada en ${fmtTime(s.t)}`);
  check(ev.includes('pit_in') && ev.includes('pit_done') && ev.includes('pit_out'), 'parada en boxes del jugador completa (' + ev.filter(e => e.startsWith('pit')).join(',') + ')');
  check(p.compound === 'hard', 'neumático cambiado a duros: ' + p.compound);
  check(!s.playerAuto, 'el jugador recupera el control después de boxes');
  const me = s.results.find(r => r.isPlayer);
  console.log('     jugador P' + me.pos, me.gap, 'mejor', fmtTime(me.best), 'sanción', me.penalty);
  const rep = rec.finish('test');
  const pl = new ReplayPlayer(rep); pl.t = rep.duration / 2;
  const smp = pl.sample();
  check(smp.cars.length === 20 && isFinite(smp.cars[0].x), `repetición grabada (${rep.duration.toFixed(0)} s, ${rep.events.length} eventos)`);
}

// --- clasificación ---
{
  const s = new Session(tr, { type: 'quali', minutes: 4, difficulty: 'normal', weather: 'seco', playerDriverId: 'ibarra' });
  let steps = 0;
  while (!s.results && steps < 60 * 60 * 8) { s.update(1 / 60, autopilot(s)); steps++; }
  check(!!s.results, 'clasificación terminada');
  const timed = s.results.filter(r => isFinite(r.best)).length;
  check(timed === 20, `tiempos de los 20 pilotos (${timed})`);
  const me = s.results.find(r => r.isPlayer);
  console.log('     pole', s.results[0].name, fmtTime(s.results[0].best), '· jugador P' + me.pos, fmtTime(me.best));
}

// --- práctica con "terminar sesión" ---
{
  const s = new Session(tr, { type: 'practice', minutes: 100000, aiCount: 5, difficulty: 'normal', weather: 'seco', playerDriverId: 'ibarra' });
  for (let k = 0; k < 60 * 150; k++) s.update(1 / 60, autopilot(s));
  s.simulateRemaining();
  check(!!s.results && s.results.length === 6, `práctica cerrada con ${s.results.length} autos`);
}

// --- contrarreloj ---
{
  const s = new Session(tr, { type: 'timetrial', minutes: 100000, playerDriverId: 'ibarra', weather: 'seco', startCompound: 'soft' });
  let laps = [];
  s.on((t, d) => { if (t === 'lap_complete') laps.push(d.time); });
  for (let k = 0; k < 60 * 300 && laps.length < 2; k++) s.update(1 / 60, autopilot(s));
  check(laps.length >= 2 && s.entrants.length === 1, `contrarreloj: ${laps.map(fmtTime).join(', ')}`);
}
process.exit(failures ? 1 : 0);
