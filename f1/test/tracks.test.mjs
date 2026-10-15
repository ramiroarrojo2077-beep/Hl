import { Track } from '../js/core/Track.js';
import { TRACKS } from '../js/data/tracks.js';
const perfBase = { mu: 1.75, mass: 830, clA: 4.2, cdA: 1.15, power: 760000, brakeG: 5.5, vmax: 98 };
for (const m of TRACKS) {
  const t0 = performance.now();
  const t = new Track(m);
  const rho = 1.225 * Math.exp(-m.altitude / 8500);
  const sp = t.speedProfile({ ...perfBase, rho });
  const ms = (performance.now() - t0).toFixed(0);
  const lt = sp.lapTime; const mm = Math.floor(lt / 60), ss = (lt - mm * 60).toFixed(2);
  let vmin = 999, vmax = 0; for (const v of sp.v) { vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
  console.log(m.id.padEnd(12), `n=${t.n} corners=${t.corners.length} drs=${t.drsZones.length} pit=${t.pit.side>0?'L':'R'} len=${t.pit.length.toFixed(0)} ramp=${t.pit.ramp.toFixed(0)} lap=${mm}:${ss.padStart(5,'0')} v=${(vmin*3.6).toFixed(0)}-${(vmax*3.6).toFixed(0)} build=${ms}ms`);
}
