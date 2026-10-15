// Geometría y consultas de un circuito. Sin dependencias de Three.js: se usa tanto
// para el render como para la simulación (y se puede probar en Node).
//
// Convenciones: plano x-z, y hacia arriba. Muestras cada ~2 m a lo largo del eje.
// s = distancia recorrida desde la línea de meta. d = desplazamiento lateral (+ = izquierda).

import { CIRCUIT_GEO } from '../data/circuitGeo.js';

const DS = 2;
export const KERB_W = 1.4;
export const PIT_SPEED = 80 / 3.6;

function wrap(i, n) { return ((i % n) + n) % n; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

function catmullRomClosed(ctrl, step) {
  // Catmull-Rom centrípeta cerrada. Devuelve puntos densos.
  const n = ctrl.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[wrap(i - 1, n)], p1 = ctrl[i], p2 = ctrl[wrap(i + 1, n)], p3 = ctrl[wrap(i + 2, n)];
    const t01 = Math.pow(Math.hypot(p1.x - p0.x, p1.z - p0.z), 0.5) || 1e-3;
    const t12 = Math.pow(Math.hypot(p2.x - p1.x, p2.z - p1.z), 0.5) || 1e-3;
    const t23 = Math.pow(Math.hypot(p3.x - p2.x, p3.z - p2.z), 0.5) || 1e-3;
    const seg = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const m1x = (p2.x - p1.x + t12 * ((p1.x - p0.x) / t01 - (p2.x - p0.x) / (t01 + t12)));
    const m1z = (p2.z - p1.z + t12 * ((p1.z - p0.z) / t01 - (p2.z - p0.z) / (t01 + t12)));
    const m2x = (p2.x - p1.x + t12 * ((p3.x - p2.x) / t23 - (p3.x - p1.x) / (t12 + t23)));
    const m2z = (p2.z - p1.z + t12 * ((p3.z - p2.z) / t23 - (p3.z - p1.z) / (t12 + t23)));
    const steps = Math.max(2, Math.ceil(seg / step));
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      out.push({ x: h00 * p1.x + h10 * m1x + h01 * p2.x + h11 * m2x, z: h00 * p1.z + h10 * m1z + h01 * p2.z + h11 * m2z });
    }
  }
  return out;
}

function polyLength(pts) {
  let L = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    L += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return L;
}

function resampleClosed(pts, count) {
  const n = pts.length, cum = [0];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    cum.push(cum[i] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const L = cum[n], out = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const s = (k / count) * L;
    while (cum[j + 1] < s) j++;
    const a = pts[j], b = pts[(j + 1) % n], t = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    out.push({ x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) });
  }
  return out;
}

function smoothClosed(arr, passes, get, set) {
  const n = arr.length;
  for (let p = 0; p < passes; p++) {
    const v = arr.map(get);
    for (let i = 0; i < n; i++) {
      set(arr[i], (v[wrap(i - 2, n)] + 4 * v[wrap(i - 1, n)] + 6 * v[i] + 4 * v[wrap(i + 1, n)] + v[wrap(i + 2, n)]) / 16);
    }
  }
}

function boxBlurClosed(a, r) {
  const n = a.length, out = new Float32Array(n);
  let acc = 0;
  for (let k = -r; k <= r; k++) acc += a[wrap(k, n)];
  for (let i = 0; i < n; i++) {
    out[i] = acc / (2 * r + 1);
    acc += a[wrap(i + r + 1, n)] - a[wrap(i - r, n)];
  }
  return out;
}

export class Track {
  constructor(meta) {
    this.meta = meta;
    this.id = meta.id;
    const geo = CIRCUIT_GEO[meta.id];
    if (!geo) throw new Error('Circuito sin geometría: ' + meta.id);
    const raw = [];
    for (let i = 0; i < geo.pts.length; i += 2) raw.push({ x: geo.pts[i], z: geo.pts[i + 1] });
    const ctrl = [raw[0]];
    for (const p of raw) {
      const q = ctrl[ctrl.length - 1];
      if (Math.hypot(p.x - q.x, p.z - q.z) > 3) ctrl.push(p);
    }
    let dense = catmullRomClosed(ctrl, 1);
    const scale = meta.length / polyLength(dense);
    for (const p of dense) { p.x *= scale; p.z *= scale; }
    const N = Math.round(meta.length / DS);
    let pts = resampleClosed(dense, N);
    smoothClosed(pts, 3, p => p.x, (p, v) => (p.x = v));
    smoothClosed(pts, 3, p => p.z, (p, v) => (p.z = v));
    const sc2 = meta.length / polyLength(pts);
    for (const p of pts) { p.x *= sc2; p.z *= sc2; }
    pts = resampleClosed(pts, N);

    this.n = N;
    this.length = meta.length;
    this.ds = meta.length / N;
    this.halfW = meta.width / 2;
    const n = N;
    this.x = new Float32Array(n); this.z = new Float32Array(n); this.y = new Float32Array(n);
    this.tx = new Float32Array(n); this.tz = new Float32Array(n);
    this.k = new Float32Array(n); this.heading = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.x[i] = pts[i].x; this.z[i] = pts[i].z; }
    for (let i = 0; i < n; i++) {
      const a = wrap(i - 1, n), b = wrap(i + 1, n);
      let dx = this.x[b] - this.x[a], dz = this.z[b] - this.z[a];
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l; this.tz[i] = dz / l;
      this.heading[i] = Math.atan2(this.tz[i], this.tx[i]);
    }
    const kRaw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = wrap(i - 1, n), b = wrap(i + 1, n);
      const dtx = this.tx[b] - this.tx[a], dtz = this.tz[b] - this.tz[a];
      // normal izquierda = (tz, -tx)
      kRaw[i] = (dtx * this.tz[i] - dtz * this.tx[i]) / (2 * this.ds);
    }
    this.k = boxBlurClosed(boxBlurClosed(kRaw, 3), 3);

    // Elevación a partir de los keyframes (Catmull-Rom en fracción de vuelta)
    const kf = meta.elevation;
    for (let i = 0; i < n; i++) {
      const f = i / n;
      let j = 0;
      while (j < kf.length - 2 && kf[j + 1][0] < f) j++;
      const p1 = kf[j], p2 = kf[j + 1];
      const p0 = kf[Math.max(0, j - 1)], p3 = kf[Math.min(kf.length - 1, j + 2)];
      const t = (f - p1[0]) / ((p2[0] - p1[0]) || 1);
      const m1 = (p2[1] - p0[1]) / 2, m2 = (p3[1] - p1[1]) / 2;
      const t2 = t * t, t3 = t2 * t;
      this.y[i] = (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
    }
    this.y = boxBlurClosed(boxBlurClosed(this.y, 12), 12);
    this.grade = new Float32Array(n);
    for (let i = 0; i < n; i++) this.grade[i] = (this.y[wrap(i + 1, n)] - this.y[wrap(i - 1, n)]) / (2 * this.ds);

    this._centroid();
    this._buildGrid();
    this._corners();
    this._straights();
    this._pitLane();
    this._edges();
    this._racingLine();
    this._grid();
    this.sectors = [0, Math.round(this.length / 3), Math.round((2 * this.length) / 3)];
  }

  _centroid() {
    let cx = 0, cz = 0, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < this.n; i++) {
      cx += this.x[i]; cz += this.z[i];
      minX = Math.min(minX, this.x[i]); maxX = Math.max(maxX, this.x[i]);
      minZ = Math.min(minZ, this.z[i]); maxZ = Math.max(maxZ, this.z[i]);
    }
    this.cx = cx / this.n; this.cz = cz / this.n;
    this.bounds = { minX, maxX, minZ, maxZ };
    this.radius = Math.max(maxX - minX, maxZ - minZ) / 2;
  }

  _buildGrid() {
    const C = 25, b = this.bounds;
    this.gcell = C;
    this.gx0 = b.minX - 200; this.gz0 = b.minZ - 200;
    this.gw = Math.ceil((b.maxX - b.minX + 400) / C); this.gh = Math.ceil((b.maxZ - b.minZ + 400) / C);
    const cells = new Map();
    for (let i = 0; i < this.n; i++) {
      const key = Math.floor((this.x[i] - this.gx0) / C) + Math.floor((this.z[i] - this.gz0) / C) * this.gw;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(i);
    }
    this.cells = cells;
  }

  // Índices de muestras dentro de un radio aproximado (celdas vecinas)
  forNear(x, z, r, fn) {
    const C = this.gcell, cr = Math.ceil(r / C);
    const gx = Math.floor((x - this.gx0) / C), gz = Math.floor((z - this.gz0) / C);
    for (let a = -cr; a <= cr; a++) for (let b = -cr; b <= cr; b++) {
      const list = this.cells.get(gx + a + (gz + b) * this.gw);
      if (list) for (const i of list) fn(i);
    }
  }

  otherTrackNear(x, z, i, r) {
    const n = this.n, r2 = r * r;
    let hit = false;
    this.forNear(x, z, r, j => {
      if (hit) return;
      const di = Math.abs(wrap(j - i + n / 2, n) - n / 2);
      if (di > 45 && Math.abs(this.y[j] - this.y[i]) < 4 && (this.x[j] - x) ** 2 + (this.z[j] - z) ** 2 < r2) hit = true;
    });
    return hit;
  }

  // Elevación del terreno cerca de un punto (la menor de los tramos cercanos: puentes)
  groundHeight(x, z) {
    let best = Infinity, bestY = 0, low = Infinity, bi = 0;
    this.forNear(x, z, 50, j => {
      const d2 = (this.x[j] - x) ** 2 + (this.z[j] - z) ** 2;
      if (d2 < best) { best = d2; bestY = this.y[j]; bi = j; }
      if (d2 < 30 * 30) low = Math.min(low, this.y[j]);
    });
    if (best === Infinity) return null;
    return { y: Math.min(bestY, low), dist: Math.sqrt(best), i: bi };
  }

  idx(s) { return wrap(Math.round(s / this.ds), this.n); }
  wrapS(s) { const L = this.length; return ((s % L) + L) % L; }

  sample(arr, s) {
    const f = this.wrapS(s) / this.ds, i = Math.floor(f), t = f - i;
    return lerp(arr[wrap(i, this.n)], arr[wrap(i + 1, this.n)], t);
  }

  // Posición en el mundo para (s, d)
  pointAt(s, d, out = {}) {
    const f = this.wrapS(s) / this.ds, i = Math.floor(f) % this.n, j = (i + 1) % this.n, t = f - Math.floor(f);
    const x = lerp(this.x[i], this.x[j], t), z = lerp(this.z[i], this.z[j], t);
    let tx = lerp(this.tx[i], this.tx[j], t), tz = lerp(this.tz[i], this.tz[j], t);
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    out.x = x + tz * d; out.z = z - tx * d;
    out.y = lerp(this.y[i], this.y[j], t);
    out.heading = Math.atan2(tz, tx);
    out.tx = tx; out.tz = tz;
    return out;
  }

  // Proyección de un punto del mundo sobre el eje del circuito. hint = índice previo.
  project(x, z, hint = -1, out = {}) {
    const n = this.n;
    let best = -1, bestD = Infinity;
    if (hint >= 0) {
      for (let k = -25; k <= 25; k++) {
        const i = wrap(hint + k, n);
        const d2 = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
        if (d2 < bestD) { bestD = d2; best = i; }
      }
      if (bestD > 60 * 60) best = -1;
    }
    if (best < 0) {
      bestD = Infinity;
      this.forNear(x, z, 60, i => {
        const d2 = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
        if (d2 < bestD) { bestD = d2; best = i; }
      });
    }
    if (best < 0) {
      bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const d2 = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
        if (d2 < bestD) { bestD = d2; best = i; }
      }
    }
    const i = best;
    const dx = x - this.x[i], dz = z - this.z[i];
    const along = dx * this.tx[i] + dz * this.tz[i];
    const lat = dx * this.tz[i] - dz * this.tx[i];
    out.i = i;
    out.s = this.wrapS(i * this.ds + along);
    out.d = lat;
    const f = out.s / this.ds, i0 = Math.floor(f) % n, t = f - Math.floor(f);
    out.y = lerp(this.y[i0], this.y[(i0 + 1) % n], t);
    out.grade = this.grade[i];
    out.heading = this.heading[i];
    return out;
  }

  _corners() {
    const n = this.n, thr = 1 / 320;
    const corners = [];
    let i0 = 0;
    // arrancamos en una zona recta para no partir una curva al medio
    for (let i = 0; i < n; i++) if (Math.abs(this.k[i]) < thr * 0.5) { i0 = i; break; }
    let cur = null;
    for (let c = 0; c < n; c++) {
      const i = wrap(i0 + c, n), k = this.k[i];
      if (Math.abs(k) > thr) {
        const dir = Math.sign(k);
        if (cur && cur.dir === dir && c - cur.endC < 12) {
          cur.endC = c; cur.end = i;
          if (Math.abs(k) > cur.peak) { cur.peak = Math.abs(k); cur.apex = i; }
        } else {
          if (cur) corners.push(cur);
          cur = { start: i, end: i, startC: c, endC: c, apex: i, peak: Math.abs(k), dir };
        }
      }
    }
    if (cur) corners.push(cur);
    // descartar curvas mínimas (ondulaciones del trazado)
    const real = corners.filter(c => {
      let turn = 0;
      for (let c2 = c.startC; c2 <= c.endC; c2++) turn += this.k[wrap(i0 + c2, n)] * this.ds;
      c.angle = Math.abs(turn);
      return c.angle > 0.35 || c.peak > 1 / 60;
    });
    real.sort((a, b) => a.apex - b.apex);
    real.forEach((c, k) => {
      c.number = k + 1;
      c.radius = 1 / c.peak;
      c.sApex = c.apex * this.ds;
      c.sStart = c.start * this.ds;
      c.sEnd = c.end * this.ds;
      c.name = 'curva ' + (k + 1);
    });
    this.corners = real;
    // cornerAt[i] = índice de curva más cercana hacia adelante
    this.nextCorner = new Int16Array(n);
    let ci = 0;
    for (let i = 0; i < n; i++) {
      while (ci < real.length && real[ci].apex < i) ci++;
      this.nextCorner[i] = ci < real.length ? ci : 0;
    }
  }

  cornerAhead(s) { return this.corners[this.nextCorner[this.idx(s)]]; }

  cornerNear(s) {
    let best = null, bd = Infinity;
    for (const c of this.corners) {
      let dd = Math.abs(this.wrapS(s - c.sApex + this.length / 2) - this.length / 2);
      if (dd < bd) { bd = dd; best = c; }
    }
    return bd < 260 ? best : null;
  }

  _straights() {
    const n = this.n, thr = 1 / 900;
    const flags = new Uint8Array(n);
    for (let i = 0; i < n; i++) flags[i] = Math.abs(this.k[i]) < thr ? 1 : 0;
    let start = 0;
    while (flags[start] && start < n - 1) start++;
    const list = [];
    let run = null;
    for (let c = 0; c <= n; c++) {
      const i = wrap(start + c, n);
      if (flags[i] && c < n) {
        if (!run) run = { start: i, len: 0 };
        run.len++;
      } else if (run) { run.end = wrap(i - 1, n); list.push(run); run = null; }
    }
    this.straights = list.map(r => ({ sStart: r.start * this.ds, sEnd: r.end * this.ds, length: r.len * this.ds }))
      .sort((a, b) => b.length - a.length);
    // DRS: las dos (o tres) rectas más largas
    const zones = this.straights.filter(r => r.length > 420).slice(0, this.length > 5000 ? 3 : 2);
    this.drsZones = zones.map(r => ({
      start: this.wrapS(r.sStart + 60), end: this.wrapS(r.sEnd - 60),
      detection: this.wrapS(r.sStart - 180), length: r.length - 120,
    }));
  }

  inDrsZone(s) {
    for (const z of this.drsZones) {
      if (z.start < z.end ? (s >= z.start && s <= z.end) : (s >= z.start || s <= z.end)) return z;
    }
    return null;
  }

  // Calle de boxes paralela a la recta principal, del lado interno del circuito.
  _pitLane() {
    const n = this.n, hw = this.halfW;
    // extensión de la recta principal alrededor de s = 0
    const limit = 1 / 500;
    let back = 0, fwd = 0;
    while (back < 450 && Math.abs(this.k[this.idx(-back - this.ds)]) < limit) back += this.ds;
    while (fwd < 400 && Math.abs(this.k[this.idx(fwd + this.ds)]) < limit) fwd += this.ds;
    let total = back + fwd;
    if (total < 420) { const extra = (420 - total) / 2; back += extra; fwd += extra; total = 420; }
    const ramp = Math.min(110, total * 0.22);
    // lado: hacia el centroide salvo que choque con otra parte del trazado
    const i0 = 0;
    const toC = (this.cx - this.x[i0]) * this.tz[i0] - (this.cz - this.z[i0]) * this.tx[i0];
    const clearance = (side) => {
      let worst = Infinity;
      for (let s = -back; s <= fwd; s += 20) {
        const p = this.pointAt(s, side * (hw + 22));
        const si = this.idx(s);
        for (let j = 0; j < n; j += 3) {
          const ds = Math.abs(wrap(j - si + n / 2, n) - n / 2) * this.ds;
          if (ds < 260) continue;
          const dd = Math.hypot(this.x[j] - p.x, this.z[j] - p.z);
          worst = Math.min(worst, dd);
        }
      }
      return worst;
    };
    let side = toC >= 0 ? 1 : -1;
    const cA = clearance(side), cB = clearance(-side);
    if (cA < 26 && cB > cA) side = -side;
    const pit = {
      side,
      sIn: this.wrapS(-back),
      sOut: this.wrapS(fwd),
      length: total,
      ramp,
      fastD: side * (hw + 10.5),
      workD: side * (hw + 16),
      wallD: side * (hw + 4),
      garageD: side * (hw + 20.5),
      laneHalf: 6.5,
    };
    pit.limitStart = ramp; // coordenadas relativas a la entrada (u)
    pit.limitEnd = total - ramp;
    // boxes por equipo (10)
    const usable = pit.limitEnd - pit.limitStart - 40;
    pit.boxSpacing = Math.min(22, usable / 10);
    pit.boxes = [];
    for (let k = 0; k < 10; k++) {
      const u = pit.limitStart + 20 + pit.boxSpacing * (k + 0.5);
      pit.boxes.push({ u, s: this.wrapS(pit.sIn + u) });
    }
    this.pit = pit;
  }

  // u = distancia desde la entrada de boxes. Devuelve d sobre el carril rápido.
  pitU(s) { return this.wrapS(s - this.pit.sIn); }
  inPitRange(s) { return this.pitU(s) <= this.pit.length; }

  pitLaneD(u, lane = 'fast') {
    const p = this.pit, edge = p.side * (this.halfW - 1.5);
    const target = lane === 'work' ? p.workD : p.fastD;
    if (u < p.ramp) return lerp(edge, p.fastD, smoothstep(u / p.ramp));
    if (u > p.length - p.ramp) return lerp(p.fastD, edge, smoothstep((u - (p.length - p.ramp)) / p.ramp));
    return target;
  }

  _edges() {
    const n = this.n, hw = this.halfW, m = this.meta;
    this.kerbL = new Uint8Array(n); this.kerbR = new Uint8Array(n);
    this.wallL = new Float32Array(n); this.wallR = new Float32Array(n);
    this.gravelL = new Uint8Array(n); this.gravelR = new Uint8Array(n);
    // pianos en curvas: interior desde la entrada hasta la salida, exterior en la salida
    for (const c of this.corners) {
      const pad = Math.round(25 / this.ds);
      const inside = c.dir > 0 ? this.kerbL : this.kerbR;
      const outside = c.dir > 0 ? this.kerbR : this.kerbL;
      for (let i = c.start - pad; i <= c.end + pad; i++) inside[wrap(i, n)] = 1;
      for (let i = c.apex; i <= c.end + pad * 2; i++) outside[wrap(i, n)] = 1;
      for (let i = c.start - pad * 2; i <= c.start; i++) outside[wrap(i, n)] = 1;
    }
    for (let i = 0; i < n; i++) {
      if (m.street) {
        this.wallL[i] = this.wallR[i] = hw + (m.wallGap || 2);
      } else {
        this.wallL[i] = this.wallR[i] = hw + 14;
      }
    }
    if (!m.street) {
      // escapatorias más grandes en el exterior de las curvas
      for (const c of this.corners) {
        const outsideW = c.dir > 0 ? this.wallR : this.wallL;
        const insideW = c.dir > 0 ? this.wallL : this.wallR;
        const gravel = c.dir > 0 ? this.gravelR : this.gravelL;
        const big = Math.min(48, 18 + 8000 / Math.max(40, c.radius));
        for (let i = c.start - 40; i <= c.end + 30; i++) {
          const w = wrap(i, n);
          const t = Math.min(1, Math.min(i - (c.start - 40), c.end + 30 - i) / 12);
          outsideW[w] = Math.max(outsideW[w], hw + lerp(14, big, t));
          if (m.runoff === 'gravel' || c.radius < 120) {
            if (i > c.start - 10 && i < c.end + 25) gravel[w] = 1;
          }
        }
        for (let i = c.start; i <= c.end; i++) insideW[wrap(i, n)] = Math.max(insideW[wrap(i, n)], hw + 10);
      }
    } else if (m.runoff === 'gravel') {
      for (const c of this.corners) {
        if (c.radius > 150) continue;
        const outsideW = c.dir > 0 ? this.wallR : this.wallL;
        const gravel = c.dir > 0 ? this.gravelR : this.gravelL;
        for (let i = c.start - 20; i <= c.end + 20; i++) { outsideW[wrap(i, n)] = hw + 14; gravel[wrap(i, n)] = 1; }
      }
    }
    // los muros no pueden meterse en otra parte del trazado
    for (let i = 0; i < n; i++) {
      for (const sgn of [1, -1]) {
        const arr = sgn > 0 ? this.wallL : this.wallR;
        let lo = hw + 1.5, hi = arr[i];
        const at = (dd) => this.otherTrackNear(this.x[i] + this.tz[i] * sgn * dd, this.z[i] - this.tx[i] * sgn * dd, i, hw + 5);
        if (!at(hi)) continue;
        for (let it = 0; it < 7; it++) {
          const mid = (lo + hi) / 2;
          if (at(mid)) hi = mid; else lo = mid;
        }
        arr[i] = Math.max(hw + 1.5, lo - 1.5);
      }
    }
    // suavizar muros
    const minBlur = (a) => { const b = boxBlurClosed(a, 4); for (let i = 0; i < n; i++) b[i] = Math.min(b[i], a[i]); return b; };
    this.wallL = minBlur(this.wallL);
    this.wallR = minBlur(this.wallR);
    // muro de boxes
    const p = this.pit;
    this.pitWallFrom = p.ramp * 0.55;
    this.pitWallTo = p.length - p.ramp * 0.55;
  }

  // Límites laterales [min, max] de d para un auto en (s, d).
  limits(s, d) {
    const i = this.idx(s), p = this.pit, side = p.side;
    let left = this.wallL[i], right = -this.wallR[i];
    const u = this.pitU(s);
    if (u <= p.length) {
      const wall = Math.abs(p.wallD), garage = Math.abs(p.garageD);
      const ds = d * side; // distancia hacia el lado de boxes
      const walled = u > this.pitWallFrom && u < this.pitWallTo;
      if (ds > wall + 0.4 && u > p.ramp * 0.35 && u < p.length - p.ramp * 0.35) {
        // dentro de la calle de boxes
        const lo = walled ? wall + 0.7 : this.halfW - 2;
        if (side > 0) { right = lo; left = garage; } else { left = -lo; right = -garage; }
      } else if (walled) {
        if (side > 0) left = wall - 0.4; else right = -(wall - 0.4);
      } else {
        if (side > 0) left = Math.max(left, garage); else right = Math.min(right, -garage);
      }
    }
    return [right, left];
  }

  // Superficie bajo una rueda en (s, d)
  surface(s, d) {
    const i = this.idx(s), hw = this.halfW, ad = Math.abs(d);
    if (ad <= hw) return 0; // asfalto
    const p = this.pit, u = this.pitU(s);
    if (u <= p.length && d * p.side > hw) {
      const dp = this.pitLaneD(Math.min(Math.max(u, 0), p.length));
      if (Math.abs(d - dp) < p.laneHalf + 1 || (d * p.side > Math.abs(p.wallD) && d * p.side < Math.abs(p.garageD))) return 0;
    }
    const kerb = d > 0 ? this.kerbL[i] : this.kerbR[i];
    if (kerb && ad <= hw + KERB_W) return 1; // piano
    if (this.meta.street && this.meta.runoff === 'wall') return ad < hw + 3 ? 4 : 2; // banquina asfaltada
    const gravel = d > 0 ? this.gravelL[i] : this.gravelR[i];
    if (this.meta.runoff === 'asphalt' && ad < hw + 9 && !gravel) return 4; // escapatoria asfaltada
    if (gravel && ad > hw + KERB_W + 2) return 3; // grava
    return 2; // pasto
  }

  // Línea de carrera: minimiza curvatura dentro del ancho disponible.
  _racingLine() {
    const n = this.n, step = 4, m = Math.floor(n / step);
    const hw = this.halfW - 1.3;
    const cx = new Float32Array(m), cz = new Float32Array(m), nx = new Float32Array(m), nz = new Float32Array(m);
    for (let j = 0; j < m; j++) {
      const i = j * step;
      cx[j] = this.x[i]; cz[j] = this.z[i]; nx[j] = this.tz[i]; nz[j] = -this.tx[i];
    }
    // Algoritmo K1999 (Rémi Coulom): cada punto toma la curvatura promedio de sus vecinos,
    // desplazándose sólo sobre su normal dentro del ancho de pista.
    const d = new Float32Array(m);
    const P = (j) => { j = wrap(j, m); return [cx[j] + nx[j] * d[j], cz[j] + nz[j] * d[j]]; };
    const rInv = (a, b, c) => {
      const x1 = b[0] - a[0], z1 = b[1] - a[1], x2 = c[0] - a[0], z2 = c[1] - a[1], x3 = c[0] - b[0], z3 = c[1] - b[1];
      const det = x1 * z2 - x2 * z1;
      const den = Math.sqrt((x1 * x1 + z1 * z1) * (x2 * x2 + z2 * z2) * (x3 * x3 + z3 * z3)) || 1e-9;
      return (2 * det) / den;
    };
    for (let k = 32; k >= 1; k = k >> 1) {
      const iters = k >= 8 ? 60 : 120;
      for (let it = 0; it < iters; it++) {
        for (let j = 0; j < m; j += k) {
          const pp = P(j - 2 * k), pr = P(j - k), nx1 = P(j + k), nn = P(j + 2 * k), cur = P(j);
          const ri0 = rInv(pp, pr, cur), ri1 = rInv(cur, nx1, nn);
          const lPrev = Math.hypot(cur[0] - pr[0], cur[1] - pr[1]), lNext = Math.hypot(cur[0] - nx1[0], cur[1] - nx1[1]);
          const target = (lNext * ri0 + lPrev * ri1) / (lNext + lPrev);
          // intersección de la cuerda prev-next con la normal del punto
          const ex = nx1[0] - pr[0], ez = nx1[1] - pr[1];
          const den = nx[j] * ez - nz[j] * ex;
          if (Math.abs(den) < 1e-6) continue;
          const t0 = ((pr[0] - cx[j]) * ez - (pr[1] - cz[j]) * ex) / den;
          const dl = 0.05;
          const dr = rInv(pr, [cx[j] + nx[j] * (t0 + dl), cz[j] + nz[j] * (t0 + dl)], nx1);
          let nd = t0;
          if (Math.abs(dr) > 1e-9) nd = t0 + (dl * target) / dr;
          // margen de seguridad extra hacia el interior de la curva
          const marg = Math.min(1.2, Math.abs(target) * 40);
          const lo = -hw + (target < 0 ? marg : 0), hi = hw - (target > 0 ? marg : 0);
          d[j] = Math.max(lo, Math.min(hi, nd));
        }
        if (k > 1) {
          for (let j = 0; j < m; j += k) {
            const j2 = j + k;
            for (let q = 1; q < k; q++) {
              const jj = j + q;
              if (jj >= m) break;
              d[jj] = lerp(d[j], d[wrap(j2, m)], q / k);
            }
          }
        }
      }
    }
    // interpolar a resolución completa y suavizar
    let line = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const f = i / step, j = Math.floor(f) % m, t = f - Math.floor(f);
      line[i] = lerp(d[j], d[(j + 1) % m], t);
    }
    line = boxBlurClosed(line, 3);
    this.line = line;
    // geometría de la línea: curvatura y longitud de arco
    const lx = new Float32Array(n), lz = new Float32Array(n);
    for (let i = 0; i < n; i++) { lx[i] = this.x[i] + this.tz[i] * line[i]; lz[i] = this.z[i] - this.tx[i] * line[i]; }
    const lk = new Float32Array(n), lds = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = wrap(i - 1, n), b = wrap(i + 1, n);
      const ax = lx[i] - lx[a], az = lz[i] - lz[a], bx = lx[b] - lx[i], bz = lz[b] - lz[i];
      const la = Math.hypot(ax, az) || 1e-3, lb = Math.hypot(bx, bz) || 1e-3;
      const cross = ax * bz - az * bx; // >0 = giro a la derecha en x-z con z hacia el sur
      const ang = Math.asin(Math.max(-1, Math.min(1, cross / (la * lb))));
      lk[i] = -ang / ((la + lb) / 2);
      lds[i] = lb;
    }
    this.lineK = boxBlurClosed(lk, 2);
    this.lineDs = lds;
  }

  _grid() {
    const slots = [];
    const lineSide = Math.sign(this.line[this.idx(-10)]) || 1;
    for (let p = 0; p < 22; p++) {
      const s = this.wrapS(-12 - p * 8);
      const side = p % 2 === 0 ? lineSide : -lineSide;
      slots.push({ s, d: side * this.halfW * 0.38 });
    }
    this.gridSlots = slots;
  }

  // Perfil de velocidad máximo a lo largo de la línea de carrera para un auto dado.
  // perf: { mu, mass, clA, cdA, power, rho, brakeG }
  speedProfile(perf, wetness = 0) {
    const n = this.n, v = new Float32Array(n);
    const g = 9.81, m = perf.mass, ka = 0.5 * perf.rho * perf.clA, kd = 0.5 * perf.rho * perf.cdA;
    const mu = perf.mu;
    for (let i = 0; i < n; i++) {
      const k = Math.abs(this.lineK[i]);
      const den = m * k - mu * ka;
      v[i] = den > 0 ? Math.sqrt((mu * m * g) / den) : perf.vmax;
      v[i] = Math.min(v[i], perf.vmax);
    }
    const latUse = (vv, i) => {
      const k = Math.abs(this.lineK[i]);
      const aLat = vv * vv * k, aMax = mu * (g + (ka * vv * vv) / m);
      return Math.min(1, aLat / aMax);
    };
    // dos pasadas por si el circuito empieza en zona de frenada
    for (let pass = 0; pass < 2; pass++) {
      for (let c = 0; c < n; c++) {
        const i = c, j = wrap(c + 1, n), vv = v[i];
        const grip = mu * (g + (ka * vv * vv) / m) * Math.sqrt(Math.max(0, 1 - latUse(vv, i) ** 2));
        const power = perf.power / (m * Math.max(vv, 8));
        const acc = Math.min(power, grip * 0.62) - (kd * vv * vv) / m - g * this.grade[i];
        const nv = Math.sqrt(Math.max(0, vv * vv + 2 * acc * this.lineDs[i]));
        if (nv < v[j]) v[j] = nv;
      }
      for (let c = n - 1; c >= 0; c--) {
        const i = wrap(c + 1, n), j = c, vv = v[i];
        const grip = mu * (g + (ka * vv * vv) / m) * Math.sqrt(Math.max(0, 1 - latUse(vv, i) ** 2));
        const dec = Math.min(grip, perf.brakeG * g) + (kd * vv * vv) / m + g * this.grade[i];
        const nv = Math.sqrt(Math.max(0, vv * vv + 2 * dec * this.lineDs[j]));
        if (nv < v[j]) v[j] = nv;
      }
    }
    let t = 0;
    for (let i = 0; i < n; i++) t += this.lineDs[i] / Math.max(1, (v[i] + v[wrap(i + 1, n)]) / 2);
    return { v, lapTime: t };
  }
}
