// Carrera completa sin jugador (solo IA) en modo headless: valida reglas, boxes, adelantamientos y resultados.
import { Track } from '../js/core/Track.js';
import { TRACK_BY_ID } from '../js/data/tracks.js';
import { Session, fmtTime } from '../js/core/Session.js';

const id = process.argv[2] || 'monza';
const laps = +(process.argv[3] || 5);
const weather = process.argv[4] || 'seco';
const tr = new Track(TRACK_BY_ID[id]);
const s = new Session(tr, { type: 'race', laps, difficulty: 'normal', weather, playerDriverId: null, formationLap: process.env.FORM === '1' });
const counts = {};
s.on((type, d) => {
  counts[type] = (counts[type] || 0) + 1;
  if (['sc_deployed', 'vsc', 'red_flag', 'retire', 'checkered', 'rain_start', 'mechanical', 'restart', 'crash', 'penalty'].includes(type))
    console.log(fmtTime(s.raceTime), type, d.car ? d.car.name : '', d.reason || d.label || '');
});
let steps = 0;
const t0 = Date.now();
while (!s.results && steps < 60 * 60 * 40) { s.update(1 / 60, {}); steps++; }
console.log('sim', ((Date.now() - t0) / 1000).toFixed(1) + 's', 'session time', fmtTime(s.t));
for (const r of s.results) console.log(String(r.pos).padStart(2), r.name.padEnd(20), r.team.padEnd(20), String(r.gap).padStart(12), 'best', fmtTime(r.best), 'stops', r.stops, r.retired ? r.reason : '');
console.log(counts);
