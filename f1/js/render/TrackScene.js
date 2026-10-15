// Construye el mundo 3D de un circuito a partir de Track: asfalto con goma en la trazada,
// pianos, líneas, escapatorias (pasto/grava/asfalto), muros, alambrados, terreno con relieve,
// agua, montañas, calle de boxes con garajes y mecánicos, tribunas con público animado,
// comisarios con banderas, fotógrafos, carteles, árboles, edificios, iluminación nocturna
// y puntos emblemáticos según el circuito.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { Person, makeCrowd, crowdUniforms, flagMesh, cameraProp, solid } from './People.js';
import { KERB_W } from '../core/Track.js';
import { TEAMS } from '../data/teams.js';

const yieldFrame = () => new Promise(r => (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function rng(seed) {
  let s = seed % 2147483647; if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// tira (ribbon) a lo largo de la pista entre dos desplazamientos laterales
function ribbon(track, i0, i1, dIn, dOut, yOff, opts = {}) {
  const pos = [], uv = [], col = [], idx = [];
  const cols = opts.cols || 2;
  const n = track.n;
  const step = opts.step || 1;
  let row = 0;
  const p = {};
  let flip = null;
  for (let k = i0; k <= i1; k += step) {
    const i = ((k % n) + n) % n;
    const s = k * track.ds;
    const a = typeof dIn === 'function' ? dIn(i, s) : dIn;
    const b = typeof dOut === 'function' ? dOut(i, s) : dOut;
    if (flip === null) flip = b < a;
    for (let c = 0; c < cols; c++) {
      const t = c / (cols - 1);
      const d = lerp(a, b, t);
      track.pointAt(s, d, p);
      const y = p.y + (typeof yOff === 'function' ? yOff(i, d, t, s) : yOff);
      pos.push(p.x, y, p.z);
      if (opts.worldUV) uv.push(p.x / opts.worldUV, p.z / opts.worldUV);
      else uv.push(opts.uAcross ? t * opts.uAcross : t, s / (opts.vScale || 4));
      if (opts.color) { const cc = opts.color(i, d, t, s); col.push(cc[0], cc[1], cc[2]); }
    }
    if (row > 0) {
      const base = (row - 1) * cols;
      for (let c = 0; c < cols - 1; c++) {
        const a0 = base + c, a1 = base + c + 1, b0 = a0 + cols, b1 = a1 + cols;
        if (flip) idx.push(a0, a1, b0, a1, b1, b0); else idx.push(a0, b0, a1, a1, b0, b1);
      }
    }
    row++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (opts.color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// tramos contiguos donde se cumple una condición
function runs(n, pred) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const ok = i < n && pred(i);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) { out.push([start, i - 1]); start = -1; }
  }
  // unir el último con el primero si ambos tocan los extremos
  if (out.length > 1 && out[0][0] === 0 && out[out.length - 1][1] === n - 1) {
    const last = out.pop();
    out[0] = [last[0], out[0][1] + n];
  }
  return out;
}

const hexToRgb = h => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

export class TrackScene {
  constructor(track, quality = 'alto') {
    this.track = track;
    this.meta = track.meta;
    this.env = track.meta.env;
    this.q = quality;
    this.qf = { bajo: 0.3, medio: 0.6, alto: 1, ultra: 1.25 }[quality] || 1;
    this.group = new THREE.Group();
    this.group.name = 'track';
    this.animated = [];
    this.marshals = [];
    this.tvCams = [];
    this.gantryLamps = [];
    this.crews = [];
    this.night = this.env.sky === 'night';
    this.dusk = this.env.sky === 'dusk';
    this.rand = rng(track.length * 7 + 13);
  }

  computeTvCams() {
    const tr = this.track, pit = tr.pit, p = {};
    this.tvCams = [];
    for (let s = 0; s < tr.length; s += 170) {
      const i = tr.idx(s);
      const c = tr.cornerNear(s);
      let sgn = c ? c.dir : (Math.floor(s / 170) % 2 ? 1 : -1);
      if (sgn === pit.side && tr.pitU(s) <= pit.length + 20) sgn = -sgn;
      const wall = sgn > 0 ? tr.wallL[i] : tr.wallR[i];
      tr.pointAt(s, sgn * (wall + 3), p);
      this.tvCams.push({ s, x: p.x, y: p.y + 8 + (s % 3) * 2.5, z: p.z, sgn });
    }
  }

  // zona ocupada por la calle de boxes, garajes y paddock
  inPitArea(x, z) {
    const tr = this.track, pit = tr.pit;
    const near = tr.groundHeight(x, z);
    if (!near || near.dist > 90) return false;
    const pr = tr.project(x, z, near.i);
    return tr.pitU(pr.s) < pit.length + 30 && pr.d * pit.side > 0 && Math.abs(pr.d) < Math.abs(pit.garageD) + 50;
  }

  nearTvCam(x, z, r) {
    for (const c of this.tvCams) if ((c.x - x) ** 2 + (c.z - z) ** 2 < r * r) return true;
    return false;
  }

  async build(progress = () => {}) {
    this.computeTvCams();
    const steps = [
      ['Asfalto y pianos', () => this.buildRoad()],
      ['Escapatorias', () => this.buildShoulders()],
      ['Muros y alambrados', () => this.buildWalls()],
      ['Terreno', () => this.buildTerrain()],
      ['Agua y montañas', () => this.buildWaterAndMountains()],
      ['Boxes y garajes', () => this.buildPits()],
      ['Tribunas y público', () => this.buildGrandstands()],
      ['Vegetación', () => this.buildTrees()],
      ['Edificios', () => this.buildBuildings()],
      ['Puntos emblemáticos', () => this.buildLandmarks()],
      ['Comisarios, carteles y cámaras', () => this.buildTrackside()],
    ];
    for (let k = 0; k < steps.length; k++) {
      progress(k / steps.length, steps[k][0]);
      await yieldFrame();
      steps[k][1]();
    }
    progress(1, 'Listo');
    this.group.traverse(o => { if (o.isMesh && o.userData.noShadow !== true) { o.receiveShadow = true; } });
    return this;
  }

  // ---------------- asfalto ----------------
  buildRoad() {
    const tr = this.track, hw = tr.halfW, n = tr.n;
    const asp = TX.asphalt();
    this.roadMat = new THREE.MeshStandardMaterial({
      map: asp.map, normalMap: asp.normalMap, normalScale: new THREE.Vector2(0.6, 0.6),
      roughness: 0.88, metalness: 0.0, vertexColors: true, color: 0xffffff,
    });
    const g = ribbon(tr, 0, n, -hw - 0.3, hw + 0.3, 0, {
      cols: 11, uAcross: (2 * hw) / 5, vScale: 5,
      color: (i, d) => {
        const line = tr.line[i];
        const rubber = Math.exp(-(((d - line) / 1.5) ** 2)) * 0.3;
        const dust = Math.abs(d) > hw - 1.2 ? 0.08 : 0;
        const v = 1 - rubber + dust;
        return [v, v, v * 1.01];
      },
    });
    const road = new THREE.Mesh(g, this.roadMat);
    road.name = 'road';
    this.group.add(road);
    this.road = road;

    // líneas blancas de borde
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    this.lineMat = white;
    const lines = [];
    for (const s of [1, -1]) lines.push(ribbon(tr, 0, n, s * (hw - 0.05), s * (hw - 0.3), 0.012, { flip: s < 0 }));
    this.group.add(new THREE.Mesh(mergeGeometries(lines), white));

    // pianos
    const kerbMat = new THREE.MeshStandardMaterial({ map: TX.kerb(), roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1 });
    this.kerbMat = kerbMat;
    const kgs = [];
    for (const [arr, sgn] of [[tr.kerbL, 1], [tr.kerbR, -1]]) {
      for (const [a, b] of runs(n, i => arr[i] === 1)) {
        kgs.push(ribbon(tr, a, b + 1, sgn * (hw - 0.3), sgn * (hw + KERB_W), (i, d, t) => 0.015 + Math.sin(t * Math.PI) * 0.05, {
          cols: 4, vScale: 3, flip: sgn < 0,
        }));
      }
    }
    if (kgs.length) this.group.add(new THREE.Mesh(mergeGeometries(kgs), kerbMat));

    // línea de largada (cuadriculada) y grilla
    const chk = document.createElement('canvas'); chk.width = 128; chk.height = 16;
    const cx = chk.getContext('2d');
    for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { cx.fillStyle = (x + y) % 2 ? '#111' : '#fff'; cx.fillRect(x * 8, y * 8, 8, 8); }
    const chkT = new THREE.CanvasTexture(chk); chkT.colorSpace = THREE.SRGBColorSpace;
    const sf = ribbon(tr, 0, 1, -hw, hw, 0.014, { cols: 2 });
    this.group.add(new THREE.Mesh(sf, new THREE.MeshStandardMaterial({ map: chkT, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 })));
    const gridG = [];
    for (const slot of tr.gridSlots.slice(0, 20)) {
      const i0 = tr.idx(slot.s);
      gridG.push(ribbon(tr, i0, i0 + 1, slot.d - 1.1, slot.d + 1.1, 0.014, { cols: 2 }));
      gridG.push(ribbon(tr, i0 - 3, i0, slot.d - 1.1, slot.d - 0.95, 0.014, { cols: 2 }));
      gridG.push(ribbon(tr, i0 - 3, i0, slot.d + 0.95, slot.d + 1.1, 0.014, { cols: 2 }));
    }
    this.group.add(new THREE.Mesh(mergeGeometries(gridG), white));

    // marcas de frenada antes de las curvas lentas
    const skidMat = new THREE.MeshBasicMaterial({ map: TX.skid(), transparent: true, opacity: 0.55, depthWrite: false, color: 0x000000, polygonOffset: true, polygonOffsetFactor: -3 });
    const sk = [];
    for (const c of tr.corners) {
      if (c.radius > 120) continue;
      const len = Math.min(120, 30 + 3000 / c.radius);
      const i1 = c.start, i0 = i1 - Math.round(len / tr.ds);
      for (const off of [-0.8, 0.8]) {
        sk.push(ribbon(tr, i0, i1, (i) => tr.line[((i % n) + n) % n] + off - 0.35, (i) => tr.line[((i % n) + n) % n] + off + 0.35, 0.016, { cols: 2, vScale: len }));
      }
    }
    if (sk.length) {
      const skm = new THREE.Mesh(mergeGeometries(sk), skidMat);
      skm.userData.noShadow = true;
      this.group.add(skm);
    }
    this.buildBridges();
  }

  // puentes donde el trazado pasa por encima de sí mismo (Suzuka)
  buildBridges() {
    const tr = this.track, n = tr.n;
    const mat = solid(0x9a9a96, 0.85);
    const parts = [];
    for (let i = 0; i < n; i += 2) {
      let under = null;
      tr.forNear(tr.x[i], tr.z[i], tr.halfW + 6, j => {
        const di = Math.abs(((j - i + n / 2) % n + n) % n - n / 2);
        if (di > 60 && tr.y[i] - tr.y[j] > 4) under = j;
      });
      if (under !== null) {
        const p = tr.pointAt(i * tr.ds, 0);
        const deck = new THREE.BoxGeometry(tr.ds * 2.2, 1.2, tr.halfW * 2 + 4);
        deck.rotateY(-p.heading);
        deck.translate(p.x, p.y - 0.75, p.z);
        parts.push(deck);
        for (const s of [1, -1]) {
          const q = tr.pointAt(i * tr.ds, s * (tr.halfW + 1.6));
          const par = new THREE.BoxGeometry(tr.ds * 2.2, 1.1, 0.4);
          par.rotateY(-p.heading); par.translate(q.x, q.y + 0.5, q.z);
          parts.push(par);
        }
        if (i % 8 === 0) {
          const lowY = tr.y[under];
          for (const s of [1, -1]) {
            const q = tr.pointAt(under * tr.ds, s * (tr.halfW + 2.5));
            const h = p.y - lowY;
            const pil = new THREE.BoxGeometry(1.2, h, 1.2); pil.translate(q.x, lowY + h / 2 - 1, q.z);
            parts.push(pil);
          }
        }
      }
    }
    if (parts.length) {
      const m = new THREE.Mesh(mergeGeometries(parts), mat);
      m.castShadow = true;
      this.group.add(m);
    }
  }

  // ---------------- escapatorias ----------------
  surfaceColor(type) {
    const g = hexToRgb(this.env.ground);
    if (type === 3) return [0.72, 0.64, 0.5];
    if (type === 4 || type === 0) return [0.33, 0.33, 0.35];
    if (type === 1) return g;
    return g;
  }

  buildShoulders() {
    const tr = this.track, n = tr.n, hw = tr.halfW;
    const mat = new THREE.MeshStandardMaterial({ map: TX.groundDetail(), vertexColors: true, roughness: 0.95, metalness: 0 });
    this.groundMat = mat;
    const geos = [];
    for (const sgn of [1, -1]) {
      const wall = sgn > 0 ? tr.wallL : tr.wallR;
      const def = this.meta.street ? hw + (this.meta.wallGap || 2) : hw + 14;
      const outer = i => wall[i] + (wall[i] < def - 1 ? 1 : 10);
      const g = ribbon(tr, 0, n, (i) => sgn * (hw + 0.2), (i) => sgn * outer(i), (i, d, t) => {
        const ad = Math.abs(d);
        if (ad > wall[i] + 0.5) return -0.05 - (ad - wall[i]) * 0.02;
        const type = tr.surface(i * tr.ds, d);
        return type === 3 ? -0.04 : -0.02;
      }, {
        cols: 12, worldUV: 7, flip: sgn < 0,
        color: (i, d) => {
          const ad = Math.abs(d);
          let type = ad > wall[i] ? 2 : tr.surface(i * tr.ds, d);
          if (type === 0 && this.meta.street) type = 4;
          const c = this.surfaceColor(type);
          const nz = TX.noise2(i * 0.05, d * 0.2) * 0.08;
          return [c[0] * (1 + nz), c[1] * (1 + nz), c[2] * (1 + nz)];
        },
      });
      geos.push(g);
    }
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.name = 'shoulders';
    this.group.add(m);
  }

  // ---------------- muros, barreras, alambrados ----------------
  buildWalls() {
    const tr = this.track, n = tr.n, hw = tr.halfW, pit = tr.pit;
    const street = this.meta.street;
    const wallH = street ? 1.1 : 1.0;
    const fenceH = street ? 3.4 : 4.0;
    const concreteMat = new THREE.MeshStandardMaterial({ map: TX.concrete(), roughness: 0.85 });
    const tyreMat = new THREE.MeshStandardMaterial({ map: TX.tyreWall(), roughness: 0.9 });
    const fenceT = TX.fence();
    const fenceMat = new THREE.MeshStandardMaterial({ map: fenceT, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.6, depthWrite: true });
    const wallGeos = [], tyreGeos = [], fenceGeos = [];
    for (const sgn of [1, -1]) {
      const wall = sgn > 0 ? tr.wallL : tr.wallR;
      const pitSide = sgn === pit.side;
      const skip = i => {
        if (!pitSide) return false;
        const u = tr.pitU(i * tr.ds);
        return u <= pit.length;
      };
      for (const [a, b] of runs(n, i => !skip(i))) {
        const inner = ribbon(tr, a, b + 1, i => sgn * wall[i], i => sgn * wall[i], (i, d, t) => 0, { cols: 2 });
        // pared vertical: construir manualmente desplazando la segunda columna hacia arriba
        const face = this.verticalStrip(a, b + 1, i => sgn * wall[i], 0, wallH, -sgn);
        const top = ribbon(tr, a, b + 1, i => sgn * wall[i], i => sgn * (wall[i] + 0.45), wallH, { cols: 2, flip: sgn < 0, vScale: 3 });
        inner.dispose();
        const isTyre = !street && this.meta.runoff !== 'wall';
        (isTyre ? tyreGeos : wallGeos).push(face);
        wallGeos.push(top);
        fenceGeos.push(this.verticalStrip(a, b + 1, i => sgn * (wall[i] + 0.3), wallH, fenceH, -sgn, 4));
      }
    }
    // muro de boxes y pared de garajes
    const pitWallRange = [Math.round(tr.wrapS(pit.sIn + tr.pitWallFrom) / tr.ds), Math.round(tr.wrapS(pit.sIn + tr.pitWallTo) / tr.ds)];
    let [pa, pb] = pitWallRange; if (pb < pa) pb += n;
    wallGeos.push(this.verticalStrip(pa, pb, () => pit.wallD - pit.side * 0.5, 0, 1.2, -pit.side));
    wallGeos.push(this.verticalStrip(pa, pb, () => pit.wallD, 0, 1.2, pit.side));
    wallGeos.push(ribbon(tr, pa, pb, () => pit.wallD - pit.side * 0.5, () => pit.wallD, 1.2, { cols: 2, flip: pit.side < 0 }));
    fenceGeos.push(this.verticalStrip(pa, pb, () => pit.wallD - pit.side * 0.25, 1.2, 4, pit.side, 4));
    // barrera del lado de afuera en la zona de boxes (lado contrario del garaje queda abierto)
    if (wallGeos.length) { const m = new THREE.Mesh(mergeGeometries(wallGeos), concreteMat); m.castShadow = true; this.group.add(m); }
    if (tyreGeos.length) { const m = new THREE.Mesh(mergeGeometries(tyreGeos), tyreMat); m.castShadow = true; this.group.add(m); }
    if (fenceGeos.length && this.qf >= 0.5) { const m = new THREE.Mesh(mergeGeometries(fenceGeos), fenceMat); m.userData.noShadow = true; this.group.add(m); }
    // postes del alambrado
    if (this.qf >= 0.6) {
      const posts = [];
      for (const sgn of [1, -1]) {
        const wall = sgn > 0 ? tr.wallL : tr.wallR;
        for (let i = 0; i < n; i += 3) {
          if (sgn === pit.side && tr.pitU(i * tr.ds) <= pit.length) continue;
          const p = tr.pointAt(i * tr.ds, sgn * (wall[i] + 0.35));
          const g = new THREE.BoxGeometry(0.08, fenceH, 0.08);
          g.translate(p.x, p.y + fenceH / 2, p.z);
          posts.push(g);
        }
      }
      const pm = new THREE.Mesh(mergeGeometries(posts), solid(0x6d7075, 0.5, 0.7));
      pm.userData.noShadow = true;
      this.group.add(pm);
    }
  }

  // tira vertical a desplazamiento lateral variable
  verticalStrip(i0, i1, dFn, y0, y1, facing, vRepeat = 1) {
    const tr = this.track, n = tr.n;
    const pos = [], uv = [], idx = [];
    const p = {};
    let row = 0, acc = 0, prev = null;
    for (let k = i0; k <= i1; k++) {
      const i = ((k % n) + n) % n;
      tr.pointAt(k * tr.ds, dFn(i), p);
      if (prev) acc += Math.hypot(p.x - prev.x, p.z - prev.z);
      prev = { x: p.x, z: p.z };
      pos.push(p.x, p.y + y0, p.z, p.x, p.y + y1, p.z);
      uv.push(acc / (vRepeat > 1 ? (y1 - y0) : 4), 0, acc / (vRepeat > 1 ? (y1 - y0) : 4), 1);
      if (row > 0) {
        const a = (row - 1) * 2, b = row * 2;
        if (facing > 0) idx.push(a, a + 1, b, a + 1, b + 1, b); else idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
      row++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // ---------------- terreno ----------------
  buildTerrain() {
    const tr = this.track, b = tr.bounds, env = this.env;
    const margin = 900;
    const x0 = b.minX - margin, x1 = b.maxX + margin, z0 = b.minZ - margin, z1 = b.maxZ + margin;
    // campo de alturas grueso (IDW de muestras del trazado)
    const C = 30;
    const cw = Math.ceil((x1 - x0) / C) + 1, ch = Math.ceil((z1 - z0) / C) + 1;
    const coarse = new Float32Array(cw * ch);
    const coarseD = new Float32Array(cw * ch);
    const sub = [];
    for (let i = 0; i < tr.n; i += 4) sub.push(i);
    for (let gz = 0; gz < ch; gz++) for (let gx = 0; gx < cw; gx++) {
      const x = x0 + gx * C, z = z0 + gz * C;
      let wsum = 0, ysum = 0, dmin = Infinity;
      for (const i of sub) {
        const d2 = (tr.x[i] - x) ** 2 + (tr.z[i] - z) ** 2 + 400;
        const w = 1 / (d2 * d2);
        wsum += w; ysum += w * tr.y[i];
        if (d2 < dmin) dmin = d2;
      }
      coarse[gz * cw + gx] = ysum / wsum;
      coarseD[gz * cw + gx] = Math.sqrt(dmin);
    }
    const sample = (arr, x, z) => {
      const fx = (x - x0) / C, fz = (z - z0) / C;
      const ix = Math.max(0, Math.min(cw - 2, Math.floor(fx))), iz = Math.max(0, Math.min(ch - 2, Math.floor(fz)));
      const tx = Math.min(1, Math.max(0, fx - ix)), tz = Math.min(1, Math.max(0, fz - iz));
      const a = arr[iz * cw + ix], b2 = arr[iz * cw + ix + 1], c = arr[(iz + 1) * cw + ix], d = arr[(iz + 1) * cw + ix + 1];
      return lerp(lerp(a, b2, tx), lerp(c, d, tx), tz);
    };
    // interior del circuito (para lagos)
    const inside = this.insideTest();
    this.waterLevel = Math.min(...tr.y) - 1.2;
    const hillAmp = { park: 4, harbor: 25, countryside: 3, ardennes: 30, japan: 12, 'city-hills': 18, mediterranean: 14, alpine: 30, texas: 5, 'desert-marina': 2, 'night-city': 2, hills: 20, island: 1, 'lake-park': 2, 'stadium-city': 5 }[env.theme] ?? 6;
    this.isWater = (x, z, dist) => {
      const w = env.water;
      if (!w || dist < 45) return false;
      if (w === 'sea') return z > tr.cz - 60 && dist > 35 && TX.fbm(x / 400, z / 400) > -0.25;
      if (w === 'lake') return inside(x, z) && dist > 70 && (env.theme === 'lake-park' || TX.fbm(x / 300, z / 300) > 0.05);
      if (w === 'river') return dist > 140;
      if (w === 'marina') return inside(x, z) && dist > 60 && TX.fbm(x / 250, z / 250) > -0.05;
      if (w === 'bay') return z > tr.cz + 80 && dist > 60;
      return false;
    };
    const R = this.qf < 0.5 ? 20 : this.qf < 1 ? 15 : this.qf > 1 ? 10 : 12;
    const nx = Math.ceil((x1 - x0) / R), nz = Math.ceil((z1 - z0) / R);
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
    const col = new Float32Array((nx + 1) * (nz + 1) * 3);
    const uv = new Float32Array((nx + 1) * (nz + 1) * 2);
    const base = hexToRgb(env.ground);
    const sand = [0.78, 0.7, 0.52];
    this.heightAt = (x, z) => {
      const near = tr.groundHeight(x, z);
      const dist = near ? near.dist : sample(coarseD, x, z);
      const yTrack = near ? near.y : sample(coarse, x, z);
      const flat = yTrack - 0.7;
      const wild = sample(coarse, x, z) + TX.fbm(x / 500, z / 500, 4) * hillAmp + Math.abs(TX.fbm(x / 160, z / 160, 3)) * hillAmp * 0.25;
      const k = smooth(55, 260, dist);
      let y = lerp(flat, Math.max(wild, flat - 2), k);
      if (this.isWater(x, z, dist)) y = this.waterLevel - 3;
      return { y, dist };
    };
    let k = 0;
    for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
      const x = x0 + ix * R, z = z0 + iz * R;
      const { y, dist } = this.heightAt(x, z);
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      uv[k * 2] = x / 9; uv[k * 2 + 1] = z / 9;
      const v = TX.fbm(x / 120, z / 120, 3) * 0.25;
      let c = base;
      if (env.theme === 'desert-marina' && dist > 80) c = sand;
      if (env.theme === 'mediterranean' && TX.fbm(x / 200, z / 200) > 0.15) c = [0.62, 0.58, 0.4];
      const shore = this.isWater(x, z, dist + 30) && !this.isWater(x, z, dist) ? 0.2 : 0;
      col[k * 3] = c[0] * (1 + v) + shore * 0.4; col[k * 3 + 1] = c[1] * (1 + v) + shore * 0.3; col[k * 3 + 2] = c[2] * (1 + v) + shore * 0.1;
      if (env.mountains > 0.8 && y > 120) { const s = smooth(120, 220, y); col[k * 3] = lerp(col[k * 3], 0.95, s); col[k * 3 + 1] = lerp(col[k * 3 + 1], 0.95, s); col[k * 3 + 2] = lerp(col[k * 3 + 2], 0.97, s); }
      k++;
    }
    const idx = [];
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const a = iz * (nx + 1) + ix, b2 = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, c, b2, b2, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: TX.groundDetail(), vertexColors: true, roughness: 0.97 });
    const terrain = new THREE.Mesh(g, mat);
    terrain.name = 'terrain';
    this.group.add(terrain);
    this.terrainBounds = { x0, x1, z0, z1 };
  }

  insideTest() {
    const tr = this.track, b = tr.bounds;
    const step = 20;
    const rows = new Map();
    for (let z = b.minZ; z <= b.maxZ; z += step) {
      const xs = [];
      for (let i = 0; i < tr.n; i++) {
        const j = (i + 1) % tr.n;
        const za = tr.z[i], zb = tr.z[j];
        if ((za <= z && zb > z) || (zb <= z && za > z)) {
          xs.push(tr.x[i] + ((z - za) / (zb - za)) * (tr.x[j] - tr.x[i]));
        }
      }
      xs.sort((a, c) => a - c);
      rows.set(Math.round((z - b.minZ) / step), xs);
    }
    return (x, z) => {
      if (z < b.minZ || z > b.maxZ || x < b.minX || x > b.maxX) return false;
      const xs = rows.get(Math.round((z - b.minZ) / step));
      if (!xs) return false;
      let c = 0;
      for (const v of xs) if (v < x) c++;
      return c % 2 === 1;
    };
  }

  buildWaterAndMountains() {
    const env = this.env, tb = this.terrainBounds;
    if (env.water) {
      const wn = TX.water();
      wn.repeat.set(60, 60);
      this.waterMat = new THREE.MeshStandardMaterial({
        color: env.water === 'sea' || env.water === 'bay' ? 0x1b4f72 : 0x2c5d63, roughness: 0.08, metalness: 0.35,
        normalMap: wn, normalScale: new THREE.Vector2(0.35, 0.35), transparent: true, opacity: 0.92,
      });
      const size = Math.max(tb.x1 - tb.x0, tb.z1 - tb.z0) + 6000;
      const w = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.waterMat);
      w.rotation.x = -Math.PI / 2;
      w.position.set((tb.x0 + tb.x1) / 2, this.waterLevel, (tb.z0 + tb.z1) / 2);
      w.userData.noShadow = true;
      this.group.add(w);
      this.water = w;
    }
    // anillo de montañas lejanas
    const amp = env.mountains * 520 + 40;
    const cx = (tb.x0 + tb.x1) / 2, cz = (tb.z0 + tb.z1) / 2;
    const r0 = Math.max(tb.x1 - tb.x0, tb.z1 - tb.z0) / 2 - 60, r1 = r0 + 5200;
    const segA = 128, segR = 12;
    const pos = [], col = [], idx = [];
    const base = hexToRgb(env.ground);
    for (let a = 0; a <= segA; a++) for (let r = 0; r <= segR; r++) {
      const ang = (a / segA) * Math.PI * 2, rr = lerp(r0, r1, (r / segR) ** 1.4);
      const x = cx + Math.cos(ang) * rr, z = cz + Math.sin(ang) * rr;
      const ridge = Math.max(0, TX.fbm(Math.cos(ang) * 3 + 10, Math.sin(ang) * 3 + r * 0.15, 5) + 0.35);
      let h = this.waterLevel - 2 + Math.sin(Math.min(1, r / segR) * Math.PI) ** 0.8 * ridge * amp * smooth(0, 3, r);
      if (env.water === 'sea' || env.water === 'bay') { if (Math.sin(ang) > 0.1) h = this.waterLevel - 10; }
      if (env.water === 'river') h = r < 3 ? this.waterLevel - 6 : h;
      pos.push(x, h, z);
      const snow = env.mountains > 0.7 && h > 350 ? 1 : 0;
      const shade = 0.75 + ridge * 0.2;
      col.push(snow ? 0.95 : base[0] * shade * 0.8, snow ? 0.95 : base[1] * shade * 0.85, snow ? 0.98 : base[2] * shade * 0.9 + 0.05);
    }
    for (let a = 0; a < segA; a++) for (let r = 0; r < segR; r++) {
      const p = a * (segR + 1) + r, q = p + segR + 1;
      idx.push(p, p + 1, q, p + 1, q + 1, q);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.userData.noShadow = true;
    this.group.add(m);
  }

  // ---------------- boxes ----------------
  buildPits() {
    const tr = this.track, pit = tr.pit, n = tr.n, side = pit.side;
    const asp = TX.asphalt();
    const pitMat = new THREE.MeshStandardMaterial({ map: asp.map, normalMap: asp.normalMap, roughness: 0.8, color: 0xc8c8c8 });
    const i0 = Math.round(pit.sIn / tr.ds);
    const steps = Math.round(pit.length / tr.ds);
    // carril (incluye rampas)
    const lane = ribbon(tr, i0, i0 + steps, (i, s) => tr.pitLaneD(tr.pitU(s)) - side * 3.8, (i, s) => tr.pitLaneD(tr.pitU(s)) + side * 3.8, 0.02, { cols: 3, flip: side < 0, vScale: 5 });
    // zona de trabajo
    const wa = Math.round((pit.sIn + tr.pitWallFrom) / tr.ds), wb = Math.round((pit.sIn + tr.pitWallTo) / tr.ds);
    const work = ribbon(tr, wa, wb, () => pit.wallD + side * 0.2, () => pit.garageD, 0.018, { cols: 3, flip: side < 0, vScale: 5 });
    this.group.add(new THREE.Mesh(mergeGeometries([lane, work]), pitMat));
    // línea divisoria y líneas del limitador
    const lines = [];
    lines.push(ribbon(tr, wa, wb, () => (pit.fastD + pit.workD) / 2 - 0.08, () => (pit.fastD + pit.workD) / 2 + 0.08, 0.03, { cols: 2 }));
    for (const u of [pit.ramp, pit.limitEnd]) {
      const ii = Math.round(tr.wrapS(pit.sIn + u) / tr.ds);
      lines.push(ribbon(tr, ii, ii + 1, pit.wallD + side * 0.3, pit.garageD, 0.03, { cols: 2 }));
    }
    this.group.add(new THREE.Mesh(mergeGeometries(lines), this.lineMat));
    // edificio de boxes
    const first = pit.boxes[0].u - 25, last = pit.boxes[9].u + 25;
    const bParts = [], roofParts = [];
    const p = {};
    for (let u = first; u < last; u += 6) {
      const s = tr.wrapS(pit.sIn + u);
      tr.pointAt(s, pit.garageD + side * 9, p);
      const g = new THREE.BoxGeometry(6.2, 9, 18);
      g.rotateY(-p.heading); g.translate(p.x, p.y + 4.5, p.z);
      bParts.push(g);
      tr.pointAt(s, pit.garageD + side * 3, p);
      const r = new THREE.BoxGeometry(6.2, 0.4, 10);
      r.rotateY(-p.heading); r.translate(p.x, p.y + 11, p.z);
      roofParts.push(r);
    }
    const bm = new THREE.Mesh(mergeGeometries(bParts), new THREE.MeshStandardMaterial({ color: 0xe8e8ea, roughness: 0.5, metalness: 0.2 }));
    bm.castShadow = true;
    this.group.add(bm);
    const rm = new THREE.Mesh(mergeGeometries(roofParts), new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.4, metalness: 0.6 }));
    rm.castShadow = true;
    this.group.add(rm);
    // vidriado superior (hospitality)
    const glassParts = [];
    for (let u = first; u < last; u += 6) {
      const s = tr.wrapS(pit.sIn + u);
      tr.pointAt(s, pit.garageD - side * 0.05, p);
      const g = new THREE.PlaneGeometry(6.2, 3);
      g.rotateY(-p.heading + (side > 0 ? 0 : Math.PI)); g.translate(p.x, p.y + 7.2, p.z);
      glassParts.push(g);
    }
    const glass = new THREE.Mesh(mergeGeometries(glassParts), new THREE.MeshStandardMaterial({ color: 0x2a3a4a, roughness: 0.05, metalness: 0.9, emissive: this.night ? 0x334455 : 0x000000 }));
    this.group.add(glass);
    // garajes por equipo
    TEAMS.forEach((team, k) => {
      const box = pit.boxes[k];
      tr.pointAt(box.s, pit.garageD, p);
      const g = new THREE.Group();
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = -p.heading + (side > 0 ? Math.PI : 0);
      // g: x a lo largo de la calle, z hacia la pista (negativo = dentro del garaje)
      const inside = new THREE.Mesh(new THREE.BoxGeometry(12, 5.5, 0.2), new THREE.MeshStandardMaterial({ color: team.colors.primary, roughness: 0.6, emissive: team.colors.primary, emissiveIntensity: 0.15 }));
      inside.position.set(0, 2.75, 10);
      const floor = new THREE.Mesh(new THREE.BoxGeometry(12, 0.05, 10), solid(0x5b5f66, 0.3, 0.2));
      floor.position.set(0, 0.03, 5);
      const sL = new THREE.BoxGeometry(0.3, 5.5, 10); sL.translate(-6.1, 2.75, 5);
      const sR = new THREE.BoxGeometry(0.3, 5.5, 10); sR.translate(6.1, 2.75, 5);
      const cg = new THREE.BoxGeometry(12.4, 0.3, 10); cg.translate(0, 5.6, 5);
      const shell = new THREE.Mesh(mergeGeometries([sL, sR, cg]), solid(0xd0d0d0, 0.5));
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(8, 0.1, 0.6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      lamp.position.set(0, 5.4, 5);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.6), new THREE.MeshBasicMaterial({ map: TX.textBoard(team.name.toUpperCase(), '#' + team.colors.primary.toString(16).padStart(6, '0'), '#' + team.colors.secondary.toString(16).padStart(6, '0'), 512, 96) }));
      board.position.set(0, 6.7, -0.1);
      board.rotation.y = Math.PI;
      // neumáticos apilados
      const tg = [];
      for (let r = 0; r < 4; r++) for (let h = 0; h < 3; h++) {
        const t = new THREE.CylinderGeometry(0.36, 0.36, 0.34, 14);
        t.translate(-4.5 + r * 0.8, 0.18 + h * 0.36, 8.5);
        tg.push(t);
      }
      const stack = new THREE.Mesh(mergeGeometries(tg), solid(0x151515, 0.9));
      // cajón del box pintado en el carril de trabajo
      const mark = ribbon(tr, Math.round(box.s / tr.ds) - 3, Math.round(box.s / tr.ds) + 3, pit.workD - side * 2.6, pit.workD + side * 2.6, 0.03, { cols: 2, flip: side < 0 });
      const markM = new THREE.Mesh(mark, new THREE.MeshStandardMaterial({ color: team.colors.primary, roughness: 0.7, transparent: true, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2 }));
      this.group.add(markM);
      g.add(inside, floor, shell, lamp, board, stack);
      this.group.add(g);
      this.crews.push({ team, group: g, box });
    });
    // grúa del muro de boxes (puestos de estrategia)
    const stands = [];
    for (const box of pit.boxes) {
      tr.pointAt(box.s, pit.wallD - side * 0.4, p);
      const g = new THREE.BoxGeometry(4, 2.6, 1.6);
      g.rotateY(-p.heading); g.translate(p.x, p.y + 2.5, p.z);
      stands.push(g);
    }
    const sm = new THREE.Mesh(mergeGeometries(stands), solid(0x22252b, 0.5, 0.4));
    sm.castShadow = true;
    this.group.add(sm);
    // paddock: motorhomes detrás de los garajes
    const mh = [];
    TEAMS.forEach((team, k) => {
      const s = pit.boxes[k].s;
      tr.pointAt(s, pit.garageD + side * 32, p);
      const g = new THREE.BoxGeometry(14, 7, 10);
      g.rotateY(-p.heading); g.translate(p.x, p.y + 3.5, p.z);
      const c = new THREE.Color(team.colors.primary);
      const cc = new Float32Array(g.attributes.position.count * 3);
      for (let v = 0; v < cc.length; v += 3) { cc[v] = c.r; cc[v + 1] = c.g; cc[v + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(cc, 3));
      mh.push(g);
    });
    const mhm = new THREE.Mesh(mergeGeometries(mh), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.3 }));
    mhm.castShadow = true;
    this.group.add(mhm);
  }

  // ---------------- tribunas ----------------
  buildGrandstands() {
    const tr = this.track, pit = tr.pit, n = tr.n;
    const spots = [];
    // recta principal, del lado opuesto a boxes
    spots.push({ s0: tr.wrapS(pit.sIn + 40), len: Math.min(320, pit.length - 60), side: -pit.side, rows: 14, roof: true });
    // curvas más importantes (exterior)
    const big = tr.corners.slice().sort((a, b) => a.radius - b.radius).slice(0, Math.round(5 * Math.max(0.6, this.qf)));
    for (const c of big) {
      const side = -c.dir;
      const s0 = tr.wrapS(c.sApex - 60);
      // no superponer con boxes
      if (tr.pitU(s0) < pit.length + 50 && side === pit.side) continue;
      spots.push({ s0, len: 120, side, rows: 10, roof: Math.random() < 0.4 });
    }
    const standParts = [], roofParts = [], crowd = [];
    const p = {}, p2 = {};
    const dens = Math.min(1, 0.85 * this.qf);
    for (const st of spots) {
      for (let s = st.s0; s < st.s0 + st.len; s += 6) {
        const i = tr.idx(s);
        const wall = st.side > 0 ? tr.wallL[i] : tr.wallR[i];
        if (tr.otherTrackNear(...this.xzAt(s, st.side * (wall + 20)), i, tr.halfW + 15)) continue;
        const dBase = st.side * (wall + 4);
        tr.pointAt(s, dBase, p);
        const head = -p.heading + (st.side > 0 ? Math.PI : 0);
        for (let r = 0; r < st.rows; r++) {
          const g = new THREE.BoxGeometry(6.1, 0.5 + r * 0.55, 0.9);
          // z local positivo = alejándose de la pista
          g.translate(0, (0.5 + r * 0.55) / 2 + 1.5, r * 0.9);
          g.rotateY(head);
          g.translate(p.x, p.y, p.z);
          standParts.push(g);
          // público
          for (let q = -2.6; q <= 2.6; q += 0.72) {
            if (Math.random() > dens) continue;
            const lx = q, lz = r * 0.9 + 0.1;
            const c = Math.cos(head), sn = Math.sin(head);
            crowd.push({ x: p.x + lx * c + lz * sn, y: p.y + 1.5 + 0.5 + r * 0.55, z: p.z - lx * sn + lz * c, rot: head + Math.PI });
          }
        }
        // estructura trasera
        const back = new THREE.BoxGeometry(6.1, 1.5 + st.rows * 0.55 + 4, 0.3);
        back.translate(0, (1.5 + st.rows * 0.55 + 4) / 2, st.rows * 0.9 + 0.3);
        back.rotateY(head); back.translate(p.x, p.y, p.z);
        standParts.push(back);
        if (st.roof) {
          const r = new THREE.BoxGeometry(6.1, 0.25, st.rows * 0.9 + 3);
          r.translate(0, 1.5 + st.rows * 0.55 + 4, st.rows * 0.45);
          r.rotateY(head); r.translate(p.x, p.y, p.z);
          roofParts.push(r);
        }
      }
    }
    if (standParts.length) {
      const m = new THREE.Mesh(mergeGeometries(standParts), new THREE.MeshStandardMaterial({ color: 0x7c8592, roughness: 0.7, metalness: 0.3 }));
      m.castShadow = true;
      this.group.add(m);
    }
    if (roofParts.length) {
      const m = new THREE.Mesh(mergeGeometries(roofParts), new THREE.MeshStandardMaterial({ color: 0xaeb3ba, roughness: 0.75, metalness: 0.2 }));
      m.castShadow = true;
      this.group.add(m);
    }
    if (crowd.length) {
      this.crowd = makeCrowd(crowd, TX.crowdColors());
      this.crowd.castShadow = false;
      this.group.add(this.crowd);
    }
    this.crowdCount = crowd.length;
  }

  xzAt(s, d) { const p = this.track.pointAt(s, d); return [p.x, p.z]; }

  // ---------------- árboles ----------------
  buildTrees() {
    const env = this.env, tr = this.track, tb = this.terrainBounds;
    if (!env.trees || env.treeDensity <= 0) return;
    const type = env.trees;
    const count = Math.round(5200 * env.treeDensity * this.qf);
    const geo = this.treeGeometry(type);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    const col = new THREE.Color();
    let placed = 0, tries = 0;
    const r = this.rand;
    const forest = ['ardennes', 'park', 'japan', 'alpine'].includes(env.theme);
    while (placed < count && tries < count * 8) {
      tries++;
      const x = lerp(tb.x0 + 100, tb.x1 - 100, r()), z = lerp(tb.z0 + 100, tb.z1 - 100, r());
      const nf = TX.fbm(x / 260, z / 260, 3);
      if (forest ? nf < -0.15 : nf < 0.05) continue;
      const near = tr.groundHeight(x, z);
      const dist = near ? near.dist : 999;
      if (dist < Math.max(tr.halfW + 30, 34)) continue;
      if (near) {
        // no en escapatorias, boxes ni tribunas
        const pr = tr.project(x, z, near.i);
        const wall = pr.d > 0 ? tr.wallL[pr.i] : tr.wallR[pr.i];
        if (Math.abs(pr.d) < wall + 22) continue;
        if (tr.pitU(pr.s) < tr.pit.length + 30 && Math.sign(pr.d) === tr.pit.side && Math.abs(pr.d) < 90) continue;
      }
      const h = this.heightAt(x, z);
      if (this.isWater(x, z, h.dist)) continue;
      if (this.nearTvCam(x, z, 45)) continue;
      pos.set(x, h.y, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
      const s = 0.75 + r() * 0.6;
      sc.set(s, s * (0.85 + r() * 0.35), s);
      m4.compose(pos, q, sc);
      mesh.setMatrixAt(placed, m4);
      col.setHSL(0.25 + (r() - 0.5) * 0.06, 0.4 + r() * 0.2, 0.75 + r() * 0.3);
      mesh.setColorAt(placed, col);
      placed++;
    }
    mesh.count = placed;
    mesh.castShadow = this.qf > 1;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  treeGeometry(type) {
    const parts = [];
    const paint = (g, hex) => {
      const c = new THREE.Color(hex);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const v = 0.85 + Math.random() * 0.3; arr[i * 3] = c.r * v; arr[i * 3 + 1] = c.g * v; arr[i * 3 + 2] = c.b * v; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return g.index ? g.toNonIndexed() : g;
    };
    const trunk = (h, r) => { const g = new THREE.CylinderGeometry(r * 0.7, r, h, 6); g.translate(0, h / 2, 0); return paint(g, 0x5a4330); };
    if (type === 'pine') {
      parts.push(trunk(4, 0.3));
      for (let k = 0; k < 3; k++) {
        const g = new THREE.ConeGeometry(3.2 - k * 0.8, 5 - k, 7);
        g.translate(0, 4.5 + k * 3, 0);
        parts.push(paint(g, 0x2c4a26));
      }
    } else if (type === 'palm' || type === 'tropical') {
      const g = new THREE.CylinderGeometry(0.18, 0.28, 9, 6); g.translate(0, 4.5, 0); parts.push(paint(g, 0x8a7458));
      for (let k = 0; k < 7; k++) {
        const leaf = new THREE.BoxGeometry(4.5, 0.08, 0.9);
        leaf.translate(2.2, 0, 0); leaf.rotateZ(-0.35); leaf.rotateY((k / 7) * Math.PI * 2); leaf.translate(0, 9, 0);
        parts.push(paint(leaf, type === 'palm' ? 0x4f7a2a : 0x3b6b2a));
      }
      if (type === 'tropical') { const b = new THREE.IcosahedronGeometry(2.4, 0); b.translate(0, 8.5, 0); parts.push(paint(b, 0x2f5f24)); }
    } else {
      parts.push(trunk(3.2, 0.35));
      const hue = type === 'eucalyptus' ? 0x5d7a52 : type === 'oak' ? 0x4a6b2b : 0x3f6e2c;
      for (let k = 0; k < 3; k++) {
        const b = new THREE.IcosahedronGeometry(2.4 - k * 0.3, 1);
        b.translate((k - 1) * 1.2, 4.5 + k * 1.1, (k % 2) * 0.9 - 0.4);
        parts.push(paint(b, hue));
      }
    }
    const g = mergeGeometries(parts);
    g.computeVertexNormals();
    return g;
  }

  // ---------------- edificios ----------------
  buildBuildings() {
    const env = this.env, tr = this.track, tb = this.terrainBounds;
    const kind = env.buildings;
    if (!kind || kind === 'none') return;
    const counts = { dense: 700, skyscrapers: 650, suburb: 380, sparse: 90 };
    const count = Math.round((counts[kind] || 100) * Math.max(0.4, this.qf));
    const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.2 });
    const night = this.night || this.dusk;
    mat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz; vWN = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float roof = step(0.6, vWN.y);
          float hcoord = abs(vWN.x) > 0.5 ? vWP.z : vWP.x;
          float wy = step(0.42, fract(vWP.y / 3.3));
          float wx = step(0.35, fract(hcoord / 2.6));
          float win = wy * wx * (1.0 - roof);
          float rnd = fract(sin(dot(floor(vec2(hcoord / 2.6, vWP.y / 3.3)), vec2(12.9898, 78.233))) * 43758.5453);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.15, 0.2), win * 0.75);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.25), roof);
          ${night ? 'totalEmissiveRadiance += win * step(0.55, rnd) * vec3(1.0, 0.82, 0.55) * 0.55;' : ''}`);
    };
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    const col = new THREE.Color();
    const r = this.rand;
    let placed = 0, tries = 0;
    const hBase = env.buildingHeight || 14;
    const close = kind === 'dense' || kind === 'skyscrapers';
    while (placed < count && tries < count * 12) {
      tries++;
      let x, z;
      if (close && r() < 0.55) {
        // pegados a la pista (circuitos urbanos)
        const s = r() * tr.length, sgn = r() < 0.5 ? 1 : -1;
        const i = tr.idx(s);
        const wall = sgn > 0 ? tr.wallL[i] : tr.wallR[i];
        const p = tr.pointAt(s, sgn * (wall + 9 + r() * 30));
        x = p.x; z = p.z;
      } else {
        x = lerp(tb.x0 + 50, tb.x1 - 50, r()); z = lerp(tb.z0 + 50, tb.z1 - 50, r());
      }
      const near = tr.groundHeight(x, z);
      const dist = near ? near.dist : 999;
      let headIdx = -1;
      if (near) {
        const pr = tr.project(x, z, near.i);
        headIdx = pr.i;
        const wall = pr.d > 0 ? tr.wallL[pr.i] : tr.wallR[pr.i];
        if (Math.abs(pr.d) < wall + 7) continue;
        if (tr.pitU(pr.s) < tr.pit.length + 40 && Math.sign(pr.d) === tr.pit.side && Math.abs(pr.d) < 70) continue;
      }
      const h0 = this.heightAt(x, z);
      if (this.isWater(x, z, h0.dist)) continue;
      if (this.nearTvCam(x, z, 40)) continue;
      if (kind === 'suburb' && dist < 150) continue;
      if (kind === 'sparse' && dist < 120) continue;
      let h = hBase * (0.5 + r() * 1.2);
      if (kind === 'skyscrapers' && r() < 0.25) h = hBase * (0.8 + r() * 1.6);
      if (kind === 'suburb' || kind === 'sparse') h = 5 + r() * 9;
      const w = kind === 'skyscrapers' ? 18 + r() * 22 : 10 + r() * 16;
      const d = 10 + r() * 16;
      pos.set(x, h0.y - 0.5, z);
      const ang = close && headIdx >= 0 ? Math.atan2(tr.tz[headIdx], tr.tx[headIdx]) : r() * 3;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang);
      sc.set(w, h, d);
      m4.compose(pos, q, sc);
      mesh.setMatrixAt(placed, m4);
      const pal = kind === 'dense' && env.theme === 'harbor' ? [0xf2d7b5, 0xefe4d0, 0xe8c3a0, 0xf4efe6, 0xd9b38c] : [0xc9ccd1, 0xb8bec6, 0xd8d2c4, 0x9fa8b3, 0xe6e6e6, 0x8c96a3];
      col.setHex(pal[Math.floor(r() * pal.length)]);
      mesh.setColorAt(placed, col);
      placed++;
    }
    mesh.count = placed;
    mesh.castShadow = this.qf >= 1;
    this.group.add(mesh);
  }

  // ---------------- puntos emblemáticos ----------------
  buildLandmarks() {
    const lm = this.env.landmarks || [];
    const tr = this.track, b = tr.bounds;
    const far = (ang, dist) => ({ x: tr.cx + Math.cos(ang) * (tr.radius + dist), z: tr.cz + Math.sin(ang) * (tr.radius + dist) });
    for (const name of lm) {
      if (name === 'ferris-wheel') {
        const pos = this.freeSpot(260, 600);
        const g = new THREE.Group();
        const R = this.env.theme === 'night-city' ? 75 : 45;
        const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.8, 8, 64), solid(0xeeeeee, 0.4, 0.6));
        const wheel = new THREE.Group();
        wheel.add(rim);
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, R, 4), solid(0xcccccc, 0.4, 0.6));
          sp.position.set(Math.cos(a) * R / 2, Math.sin(a) * R / 2, 0); sp.rotation.z = a - Math.PI / 2;
          wheel.add(sp);
          const cab = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 6), new THREE.MeshStandardMaterial({ color: [0xff4040, 0x40a0ff, 0xffd040, 0x40ff80][k % 4], emissive: this.night ? 0x223344 : 0, roughness: 0.4 }));
          cab.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
          wheel.add(cab);
        }
        if (this.night) { rim.material = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x66aaff, emissiveIntensity: 2 }); }
        wheel.position.y = R + 8;
        g.add(wheel);
        const legs = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.5, R + 8, 6), solid(0xdddddd, 0.4, 0.6));
        legs.position.y = (R + 8) / 2;
        g.add(legs);
        g.position.set(pos.x, pos.y, pos.z);
        g.rotation.y = Math.random() * 3;
        this.group.add(g);
        this.animated.push((dt) => { wheel.rotation.z += dt * 0.02; });
      } else if (name === 'tower') {
        const pos = this.freeSpot(120, 300);
        const g = new THREE.Group();
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const pts = [];
          for (let h = 0; h <= 10; h++) {
            const t = h / 10, r = 12 * (1 - t) + 2;
            pts.push(new THREE.Vector3(Math.cos(a + t * 0.6) * r, t * 77, Math.sin(a + t * 0.6) * r));
          }
          const c = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.25, 4);
          g.add(new THREE.Mesh(c, new THREE.MeshStandardMaterial({ color: 0xd8222a, roughness: 0.5, emissive: this.night || this.dusk ? 0x550000 : 0 })));
        }
        const deck = new THREE.Mesh(new THREE.CylinderGeometry(7, 6, 3, 16), solid(0x333333, 0.3, 0.6));
        deck.position.y = 64;
        g.add(deck);
        const core = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 70, 8), solid(0x888888));
        core.position.y = 35;
        g.add(core);
        g.position.set(pos.x, pos.y, pos.z);
        this.group.add(g);
      } else if (name === 'hotel') {
        // hotel con techo de grilla LED sobre la pista (Yas Marina)
        const c = tr.corners[Math.floor(tr.corners.length * 0.75)] || tr.corners[0];
        const s = c ? c.sApex + 200 : tr.length * 0.75;
        const p = tr.pointAt(s, 0);
        const g = new THREE.Group();
        const towerMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.2, metalness: 0.7 });
        for (const sgn of [1, -1]) {
          const t = new THREE.Mesh(new THREE.BoxGeometry(60, 40, 25), towerMat);
          t.position.set(0, 20, sgn * (tr.halfW + 25));
          g.add(t);
        }
        const shellMat = new THREE.MeshStandardMaterial({ color: 0x223344, emissive: 0x3060ff, emissiveIntensity: 1.2, wireframe: true });
        const shell = new THREE.Mesh(new THREE.SphereGeometry(70, 32, 12, 0, Math.PI * 2, 0, 1.0), shellMat);
        shell.scale.set(1.4, 0.45, 1);
        shell.position.y = 20;
        g.add(shell);
        g.position.set(p.x, p.y, p.z);
        g.rotation.y = -p.heading;
        this.group.add(g);
        this.animated.push((dt, t) => { const h = (t * 0.05) % 1; shellMat.emissive.setHSL(h, 0.9, 0.5); });
      } else if (name === 'yachts') {
        const yachts = [];
        for (let k = 0; k < 40; k++) {
          const pos = this.waterSpot();
          if (!pos) continue;
          const gL = 18 + Math.random() * 40;
          const hull = new THREE.BoxGeometry(gL, 4, gL * 0.22);
          hull.translate(0, 1, 0);
          const deck = new THREE.BoxGeometry(gL * 0.55, 3, gL * 0.17);
          deck.translate(-gL * 0.05, 4.5, 0);
          const g = mergeGeometries([hull, deck]);
          g.rotateY(Math.random() * 6.28);
          g.translate(pos.x, this.waterLevel, pos.z);
          yachts.push(g);
        }
        if (yachts.length) this.group.add(new THREE.Mesh(mergeGeometries(yachts), new THREE.MeshStandardMaterial({ color: 0xf6f6f6, roughness: 0.3, metalness: 0.2 })));
      } else if (name === 'skyline') {
        const ang = this.env.theme === 'lake-park' ? -0.8 : this.env.theme === 'island' ? -2.2 : 1.2;
        const c = far(ang, 900);
        const towers = [];
        for (let k = 0; k < 40; k++) {
          const h = 60 + Math.random() * 200, w = 20 + Math.random() * 25;
          const g = new THREE.BoxGeometry(w, h, w);
          g.translate(c.x + (Math.random() - 0.5) * 600, h / 2 - 5, c.z + (Math.random() - 0.5) * 400);
          towers.push(g);
        }
        const mat = new THREE.MeshStandardMaterial({ color: 0x8e9aa8, roughness: 0.25, metalness: 0.7, emissive: this.night ? 0x223355 : 0 });
        this.group.add(new THREE.Mesh(mergeGeometries(towers), mat));
      } else if (name === 'stadium') {
        // sector estadio (Foro Sol): tribunas en anillo alrededor de una curva lenta
        const c = tr.corners.slice().sort((a, b2) => a.radius - b2.radius)[1] || tr.corners[0];
        if (!c) continue;
        const p = tr.pointAt(c.sApex, 0);
        const parts = [];
        const crowd = [];
        for (let a = 0; a < Math.PI * 2; a += 0.08) {
          for (let r = 0; r < 18; r++) {
            const rad = 95 + r * 1.6, h = 2 + r * 0.9;
            const sx = p.x + Math.cos(a) * rad, sz = p.z + Math.sin(a) * rad;
            const nearT = tr.groundHeight(sx, sz);
            if (nearT && nearT.dist < tr.halfW + 16) continue;
            if (this.inPitArea(sx, sz)) continue;
            const g = new THREE.BoxGeometry(8, h, 1.7);
            g.translate(0, h / 2, 0); g.rotateY(-a); g.translate(p.x + Math.cos(a) * rad, p.y, p.z + Math.sin(a) * rad);
            parts.push(g);
            if (r % 2 === 0 && this.qf >= 0.6) for (let q = -3.5; q <= 3.5; q += 1.2) crowd.push({ x: p.x + Math.cos(a) * rad - Math.sin(a) * q, y: p.y + h, z: p.z + Math.sin(a) * rad + Math.cos(a) * q, rot: -a - Math.PI / 2 });
          }
        }
        this.group.add(new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ color: 0x7a8088, roughness: 0.8 })));
        if (crowd.length) this.group.add(makeCrowd(crowd, TX.crowdColors()));
      } else if (name === 'biosphere') {
        const pos = this.freeSpot(200, 500);
        const s = new THREE.Mesh(new THREE.IcosahedronGeometry(38, 3), new THREE.MeshStandardMaterial({ color: 0xcfd6dc, wireframe: true }));
        s.position.set(pos.x, pos.y + 30, pos.z);
        this.group.add(s);
      } else if (name === 'casino') {
        const c = tr.corners[Math.floor(tr.corners.length * 0.2)];
        if (!c) continue;
        const p = tr.pointAt(c.sApex, -c.dir * (tr.halfW + 30));
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(50, 16, 30), solid(0xeedcbc, 0.6));
        body.position.y = 8; g.add(body);
        for (const x of [-18, 18]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 26, 8), solid(0xeedcbc, 0.6)); t.position.set(x, 13, -10); g.add(t); const dome = new THREE.Mesh(new THREE.SphereGeometry(3.6, 8, 6), solid(0x5b7a6a, 0.4, 0.5)); dome.position.set(x, 27, -10); g.add(dome); }
        g.position.set(p.x, p.y, p.z); g.rotation.y = -p.heading;
        this.group.add(g);
      } else if (name === 'banking') {
        // la vieja peraltada de Monza, fuera de uso
        const pos = this.freeSpot(150, 260);
        const curve = new THREE.CatmullRomCurve3([0, 1, 2, 3, 4].map(k => new THREE.Vector3(pos.x + Math.cos(k * 0.5) * 200, pos.y, pos.z + Math.sin(k * 0.5) * 200)));
        const g = new THREE.TubeGeometry(curve, 40, 6, 3, false);
        this.group.add(new THREE.Mesh(g, solid(0x9a958c, 0.9)));
      } else if (name === 'cliffs' || name === 'favela-hills') {
        // casas de colores en las laderas
        const houses = [];
        for (let k = 0; k < 500 * this.qf; k++) {
          const ang = Math.random() * 6.28, dist = 260 + Math.random() * 500;
          const x = tr.cx + Math.cos(ang) * (tr.radius + dist), z = tr.cz + Math.sin(ang) * (tr.radius + dist);
          const h = this.heightAt(x, z);
          if (this.isWater(x, z, h.dist)) continue;
          const g = new THREE.BoxGeometry(6 + Math.random() * 6, 4 + Math.random() * 8, 6 + Math.random() * 6);
          const c = new THREE.Color().setHSL(Math.random(), 0.5, 0.65);
          const cc = new Float32Array(g.attributes.position.count * 3);
          for (let v = 0; v < cc.length; v += 3) { cc[v] = c.r; cc[v + 1] = c.g; cc[v + 2] = c.b; }
          g.setAttribute('color', new THREE.BufferAttribute(cc, 3));
          g.translate(x, h.y + 2, z);
          houses.push(g);
        }
        if (houses.length) this.group.add(new THREE.Mesh(mergeGeometries(houses), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })));
      }
    }
  }

  freeSpot(minD, maxD) {
    const tr = this.track;
    for (let k = 0; k < 200; k++) {
      const ang = Math.random() * 6.28, dist = minD + Math.random() * (maxD - minD);
      const x = tr.cx + Math.cos(ang) * (tr.radius * 0.5 + dist), z = tr.cz + Math.sin(ang) * (tr.radius * 0.5 + dist);
      const near = tr.groundHeight(x, z);
      if (near && near.dist < 80) continue;
      const h = this.heightAt(x, z);
      if (this.isWater(x, z, h.dist)) continue;
      return { x, y: h.y, z };
    }
    return { x: tr.cx + tr.radius + 300, y: 0, z: tr.cz };
  }

  waterSpot() {
    const tb = this.terrainBounds;
    for (let k = 0; k < 60; k++) {
      const x = lerp(tb.x0, tb.x1, Math.random()), z = lerp(tb.z0, tb.z1, Math.random());
      const h = this.heightAt(x, z);
      if (this.isWater(x, z, h.dist) && h.dist > 60) return { x, z };
    }
    return null;
  }

  // ---------------- borde de pista: comisarios, carteles, pórtico, cámaras, luces ----------------
  buildTrackside() {
    const tr = this.track, n = tr.n, pit = tr.pit, meta = this.meta;
    const p = {};
    // pórtico de largada con semáforos
    const g = new THREE.Group();
    const steel = solid(0x30343a, 0.4, 0.7);
    tr.pointAt(4, 0, p);
    const span = tr.halfW * 2 + 6;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, span), steel);
    beam.position.y = 7.5;
    g.add(beam);
    for (const sgn of [1, -1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 0.8), steel);
      post.position.set(0, 4, sgn * (span / 2));
      g.add(post);
    }
    const lampOff = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0x000000, roughness: 0.3 });
    for (let k = 0; k < 5; k++) {
      const unit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.7), solid(0x111111, 0.5));
      unit.position.set(-0.7, 7.2, (k - 2) * 1.1);
      g.add(unit);
      const lamps = [];
      for (let r = 0; r < 2; r++) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), lampOff.clone());
        lamp.position.set(-0.98, 7.45 - r * 0.42, (k - 2) * 1.1);
        g.add(lamp);
        lamps.push(lamp);
      }
      this.gantryLamps.push(lamps);
    }
    const board = new THREE.Mesh(new THREE.PlaneGeometry(span * 0.7, 1.1), new THREE.MeshBasicMaterial({ map: TX.textBoard(meta.gp.toUpperCase(), '#0a0a0a', '#ffffff', 1024, 96, '#e10600') }));
    board.position.set(-0.62, 8.6, 0); board.rotation.y = -Math.PI / 2;
    g.add(board);
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = -p.heading;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.group.add(g);
    this.gantry = g;

    // carteles publicitarios sobre el muro
    const sponsors = [...(meta.sponsors || []), 'VELOCITÀ', 'TURBO OIL', 'GRIP', 'APEX', 'NITRO', 'PITLANE', 'CARBONO', 'TELEMETRY'];
    const boardGeo = new Map();
    const mats = new Map();
    for (let s = 30; s < tr.length; s += 55) {
      const i = tr.idx(s);
      if (Math.abs(tr.k[i]) > 1 / 120 && Math.random() < 0.5) continue;
      const sgn = (Math.floor(s / 55) % 2) ? 1 : -1;
      if (sgn === pit.side && tr.pitU(s) <= pit.length) continue;
      const wall = sgn > 0 ? tr.wallL[i] : tr.wallR[i];
      const text = sponsors[Math.floor(Math.random() * sponsors.length)];
      if (!mats.has(text)) {
        const pal = [['#e10600', '#fff'], ['#0b1f4b', '#ffd400'], ['#111', '#36f1cd'], ['#ffd400', '#111'], ['#ffffff', '#c8102e']][mats.size % 5];
        mats.set(text, new THREE.MeshBasicMaterial({ map: TX.textBoard(text, pal[0], pal[1]), side: THREE.DoubleSide }));
      }
      tr.pointAt(s, sgn * (wall + 0.2), p);
      const bgeo = new THREE.PlaneGeometry(7, 1.6);
      bgeo.rotateY(-p.heading + (sgn > 0 ? 0 : Math.PI));
      bgeo.translate(p.x, p.y + 2.2, p.z);
      if (!boardGeo.has(text)) boardGeo.set(text, []);
      boardGeo.get(text).push(bgeo);
    }
    for (const [text, list] of boardGeo) {
      const bm = new THREE.Mesh(mergeGeometries(list), mats.get(text));
      bm.userData.noShadow = true;
      this.group.add(bm);
    }
    // puente publicitario sobre la pista
    for (const frac of [0.35, 0.7]) {
      const s = tr.straights[Math.round(frac * 2)] ? tr.wrapS(tr.straights[Math.round(frac * 2)].sStart + 120) : frac * tr.length;
      tr.pointAt(s, 0, p);
      const bg = new THREE.Group();
      const w = (tr.halfW + 6) * 2;
      const bb = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, w), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
      bb.position.y = 7;
      bg.add(bb);
      for (const sgn of [1, -1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(1, 7, 1), steel); post.position.set(0, 3.5, sgn * w / 2); bg.add(post); }
      const txt = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.85, 2), new THREE.MeshBasicMaterial({ map: TX.textBoard(sponsors[Math.floor(Math.random() * sponsors.length)], '#ffffff', '#e10600', 1024, 128) }));
      txt.position.set(-1.12, 7, 0); txt.rotation.y = -Math.PI / 2;
      bg.add(txt);
      bg.position.set(p.x, p.y, p.z); bg.rotation.y = -p.heading;
      this.group.add(bg);
    }

    // puestos de comisarios
    const hutMat = solid(0xf2f2f2, 0.6);
    for (let s = 120; s < tr.length - 60; s += 260) {
      const i = tr.idx(s);
      const sgn = Math.floor(s / 260) % 2 ? 1 : -1;
      if (sgn === pit.side && tr.pitU(s) <= pit.length + 20) continue;
      const wall = sgn > 0 ? tr.wallL[i] : tr.wallR[i];
      tr.pointAt(s, sgn * (wall + 1.6), p);
      const post = new THREE.Group();
      const hut = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.4, 1.2), hutMat);
      hut.position.set(0, 1.2, sgn * 0.0);
      post.add(hut);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.3, 1.22), solid(0xff6a00));
      stripe.position.y = 2.1; post.add(stripe);
      const m = new Person({ suit: 0xff6a00, cap: 0xff6a00 });
      m.root.position.set(1.4, 0, 0);
      m.root.rotation.y = sgn > 0 ? -Math.PI / 2 : Math.PI / 2;
      const flag = flagMesh(0xffd400);
      m.attach(flag, 0);
      flag.visible = false;
      post.add(m.root);
      post.position.set(p.x, p.y, p.z);
      post.rotation.y = -p.heading;
      this.group.add(post);
      this.marshals.push({ s, person: m, flag, post, sector: s < tr.sectors[1] ? 0 : s < tr.sectors[2] ? 1 : 2, x: p.x, z: p.z });
    }
    // fotógrafos en curvas
    for (const c of tr.corners.slice(0, Math.round(8 * this.qf))) {
      const sgn = -c.dir;
      const i = tr.idx(c.sApex + 30);
      const wall = sgn > 0 ? tr.wallL[i] : tr.wallR[i];
      tr.pointAt(c.sApex + 30, sgn * (wall + 1.2), p);
      const ph = new Person({ suit: 0x2b4a7a, cap: 0x111111 });
      ph.pose('photo');
      ph.attach(cameraProp(), 1);
      ph.root.position.set(p.x, p.y, p.z);
      ph.root.rotation.y = -p.heading + (sgn > 0 ? Math.PI / 2 : -Math.PI / 2) + 0.6;
      this.group.add(ph.root);
      this.photographers = this.photographers || [];
      this.photographers.push(ph.root);
    }
    // torres de cámaras de TV
    if (this.qf >= 0.6) {
      const towers = [];
      for (const c of this.tvCams.filter((_, k) => k % 2 === 0)) {
        const h = c.y - this.track.y[this.track.idx(c.s)];
        const t = new THREE.BoxGeometry(1.4, h, 1.4); t.translate(c.x, c.y - h / 2 - 1, c.z);
        const plat = new THREE.BoxGeometry(2.4, 0.2, 2.4); plat.translate(c.x, c.y - 1, c.z);
        towers.push(t, plat);
      }
      if (towers.length) this.group.add(new THREE.Mesh(mergeGeometries(towers), steel));
    }
    // torres de iluminación (carreras nocturnas)
    if (this.env.floodlights) {
      const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
      const poles = [], heads = [], glowPos = [];
      for (let s = 0; s < tr.length; s += 70) {
        const i = tr.idx(s);
        const sgn = Math.floor(s / 70) % 2 ? 1 : -1;
        const wall = sgn > 0 ? tr.wallL[i] : tr.wallR[i];
        tr.pointAt(s, sgn * (wall + 1.2), p);
        const pole = new THREE.CylinderGeometry(0.2, 0.3, 16, 6); pole.translate(p.x, p.y + 8, p.z);
        poles.push(pole);
        const head = new THREE.BoxGeometry(2.4, 0.5, 1.4); head.translate(p.x, p.y + 16, p.z);
        heads.push(head);
        glowPos.push(p.x, p.y + 16, p.z);
      }
      this.group.add(new THREE.Mesh(mergeGeometries(poles), steel));
      this.group.add(new THREE.Mesh(mergeGeometries(heads), lampMat));
      const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
      const glow = new THREE.Points(gg, new THREE.PointsMaterial({ map: TX.radialGlow('255,240,210'), size: 14, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff }));
      this.group.add(glow);
    }
  }

  // ---------------- actualización por cuadro ----------------
  update(dt, t, ctx) {
    crowdUniforms.uTime.value = t;
    crowdUniforms.uExcite.value += ((ctx.excite || 0.2) - crowdUniforms.uExcite.value) * Math.min(1, dt * 2);
    for (const fn of this.animated) fn(dt, t);
    if (this.water && this.waterMat.normalMap) { this.waterMat.normalMap.offset.x += dt * 0.006; this.waterMat.normalMap.offset.y += dt * 0.004; }
    // semáforos
    const lit = ctx.lightsOn || 0;
    this.gantryLamps.forEach((lamps, k) => {
      for (const l of lamps) {
        const on = k < lit;
        l.material.emissive.setHex(on ? 0xff0000 : 0x000000);
        l.material.emissiveIntensity = on ? 6 : 0;
      }
    });
    // comisarios: banderas según el estado de cada sector
    const cam = ctx.camPos;
    for (const ph of this.photographers || []) {
      const dx = ph.position.x - cam.x, dz = ph.position.z - cam.z;
      ph.visible = dx * dx + dz * dz < 250 * 250;
    }
    for (const m of this.marshals) {
      const dx = m.x - cam.x, dz = m.z - cam.z;
      m.post.visible = dx * dx + dz * dz < 380 * 380;
      if (!m.post.visible) continue;
      const y = ctx.yellow ? ctx.yellow[m.sector] : 0;
      const blue = ctx.blueNear && Math.abs(this.track.wrapS(ctx.blueNear - m.s + 200) - 200) < 150;
      const sc = ctx.sc;
      let color = null;
      if (y > 0 || sc) color = 0xffd400;
      else if (blue) color = 0x1f6fe0;
      else if (ctx.green && ctx.green[m.sector] > 0) color = 0x18b030;
      if (color !== null) {
        m.flag.visible = true;
        m.flag.userData.cloth.material.color.setHex(color);
        m.person.pose('wave', t + m.s, y > 1 || sc ? 1.4 : 1);
        // agitar la tela
        m.flag.userData.cloth.rotation.x = Math.sin(t * 12 + m.s) * 0.3;
      } else {
        m.flag.visible = false;
        m.person.pose('idle', t + m.s);
      }
    }
  }

  setWetness(w) {
    if (!this.roadMat) return;
    this.roadMat.roughness = 0.88 - w * 0.62;
    this.roadMat.color.setScalar(1 - w * 0.35);
    this.roadMat.metalness = w * 0.1;
    this.kerbMat.roughness = 0.55 - w * 0.4;
  }
}
