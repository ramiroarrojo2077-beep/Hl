// Monoplaza de F1 procedural: carrocería por secciones (loft), alerones multi-elemento,
// halo, suspensiones, fondo plano, difusor, neumáticos con textura de compuesto, frenos
// que se ponen incandescentes, volante con pantalla, piloto con casco y LOD lejano.
// Ejes locales: x adelante, y arriba, z derecha.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { COMPOUNDS } from '../data/teams.js';

const WB_F = 1.78, WB_R = -1.72; // posición de ejes
const TRACK_F = 0.79, TRACK_R = 0.77;
const R_TYRE = 0.36;

// Sección redondeada → anillo de puntos (en plano y-z) para un x dado
function ring(sec, segs) {
  const pts = [];
  const { w, h, y0 } = sec;
  const r = Math.min(sec.r ?? 0.35, 0.5) * Math.min(w, h);
  const hw = w / 2, top = y0 + h;
  // recorrido en sentido horario visto desde adelante, empezando abajo al centro
  const corners = [
    [hw - r, y0 + r, -Math.PI / 2], [hw - r, top - r, 0], [-hw + r, top - r, Math.PI / 2], [-hw + r, y0 + r, Math.PI],
  ];
  const per = Math.max(2, Math.floor(segs / 4));
  for (let c = 0; c < 4; c++) {
    const [cz, cy, a0] = corners[c];
    for (let k = 0; k < per; k++) {
      const a = a0 + (k / per) * (Math.PI / 2);
      const pinch = sec.pinch && Math.sin(a) > 0 ? sec.pinch : 1; // estrechamiento superior
      pts.push([cz * pinch + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return pts;
}

// Une secciones a lo largo de x. Devuelve geometría con UV (u = largo, v = contorno)
export function loft(sections, segs = 24, capEnds = true) {
  const rings = sections.map(s => ring(s, segs));
  const n = rings[0].length;
  const pos = [], uv = [], idx = [];
  const x0 = sections[0].x, x1 = sections[sections.length - 1].x;
  for (let i = 0; i < sections.length; i++) {
    const sx = sections[i].x, zo = sections[i].z || 0;
    for (let j = 0; j <= n; j++) {
      const p = rings[i][j % n];
      pos.push(sx, p[1], p[0] + zo);
      uv.push((sx - x1) / (x0 - x1), j / n);
    }
  }
  for (let i = 0; i < sections.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * (n + 1) + j, b = a + n + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  if (capEnds) {
    for (const [i, flip] of [[0, false], [sections.length - 1, true]]) {
      const base = pos.length / 3;
      const s = sections[i];
      pos.push(s.x, s.y0 + s.h / 2, s.z || 0); uv.push(0.5, 0.5);
      for (let j = 0; j < n; j++) {
        const a = i * (n + 1) + j, b = i * (n + 1) + j + 1;
        if (flip) idx.push(base, a, b); else idx.push(base, b, a);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Perfil alar extruido a lo ancho (z). chord a lo largo de x.
function airfoil(chord, thick, span, camber = 0.06) {
  const shape = new THREE.Shape();
  const N = 14;
  const top = [], bot = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = -t * chord;
    const yt = 5 * thick * chord * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1015 * t ** 4);
    const yc = camber * chord * 4 * t * (1 - t);
    top.push([x, yc + yt]); bot.push([x, yc - yt]);
  }
  shape.moveTo(top[0][0], top[0][1]);
  for (const p of top) shape.lineTo(p[0], p[1]);
  for (let i = bot.length - 1; i >= 0; i--) shape.lineTo(bot[i][0], bot[i][1]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -span / 2);
  return g;
}

function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function cyl(r1, r2, len, x, y, z, rx = 0, ry = 0, rz = 0, seg = 10) {
  const g = new THREE.CylinderGeometry(r1, r2, len, seg);
  g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

// tubo entre dos puntos
function rod(a, b, r = 0.012) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(r, r, len, 6);
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  const dir = vb.clone().sub(va).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyQuaternion(q);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

function stripUV(g) {
  // geometrías sin uv para mergear: agregar uv neutro
  if (!g.attributes.uv) {
    const n = g.attributes.position.count;
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  }
  if (g.index === null) return g;
  return g;
}

function merge(list) {
  const gs = list.map(g => {
    let gg = g.index ? g.toNonIndexed() : g;
    stripUV(gg);
    // normalizar atributos
    for (const k of Object.keys(gg.attributes)) if (!['position', 'normal', 'uv'].includes(k)) gg.deleteAttribute(k);
    if (!gg.attributes.normal) gg.computeVertexNormals();
    return gg;
  });
  return mergeGeometries(gs, false);
}

const sharedMats = {};
function mats() {
  if (sharedMats.carbon) return sharedMats;
  const carbon = TX.carbon();
  sharedMats.carbon = new THREE.MeshPhysicalMaterial({ color: 0x2a2b2e, map: carbon, roughness: 0.38, metalness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  sharedMats.black = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.55, metalness: 0.2 });
  sharedMats.metal = new THREE.MeshStandardMaterial({ color: 0x9a9da3, roughness: 0.3, metalness: 0.9 });
  sharedMats.titanium = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.25, metalness: 0.85 });
  sharedMats.glass = new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.05, metalness: 0.1, transmission: 0, transparent: true, opacity: 0.85, clearcoat: 1 });
  sharedMats.rim = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.28, metalness: 0.9 });
  sharedMats.cockpit = new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.9 });
  sharedMats.mirror = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.02, metalness: 1 });
  sharedMats.rainLight = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1010, emissiveIntensity: 0 });
  return sharedMats;
}

const tyreMats = {};
function tyreMat(compound) {
  if (tyreMats[compound]) return tyreMats[compound];
  const c = COMPOUNDS[compound];
  const m = new THREE.MeshStandardMaterial({ map: TX.tyreTread(c.color, !!c.wetTyre), roughness: 0.92, metalness: 0 });
  tyreMats[compound] = m;
  return m;
}

// Geometría del neumático (torno) con UV: u alrededor, v a lo ancho
let tyreGeoF = null, tyreGeoR = null;
function tyreGeometry(width) {
  const pts = [];
  const r = R_TYRE, rim = 0.235, hw = width / 2, sh = 0.05;
  // perfil (x = radio, y = ancho) desde llanta interior por flanco, banda, flanco
  const prof = [
    [rim, -hw + 0.01], [rim + 0.02, -hw], [r - sh, -hw - 0.005], [r - 0.012, -hw + 0.012], [r, -hw + sh],
    [r, hw - sh], [r - 0.012, hw - 0.012], [r - sh, hw + 0.005], [rim + 0.02, hw], [rim, hw - 0.01],
  ];
  for (const p of prof) pts.push(new THREE.Vector2(p[0], p[1]));
  const g = new THREE.LatheGeometry(pts, 40);
  // Lathe gira alrededor de Y; el eje de la rueda es Z
  g.rotateX(Math.PI / 2);
  // corregir uv: u alrededor (lathe usa u = segmento), v a lo largo del perfil
  return g;
}

function rimGeometry(width) {
  const parts = [];
  const rr = 0.235;
  // aro
  const ringG = new THREE.CylinderGeometry(rr, rr, width * 0.92, 32, 1, true);
  ringG.rotateX(Math.PI / 2);
  parts.push(ringG);
  // tapa (cubrerrueda) con leve concavidad
  const cover = new THREE.CylinderGeometry(rr * 0.98, rr * 0.98, 0.02, 32);
  cover.rotateX(Math.PI / 2);
  cover.translate(0, 0, width * 0.42);
  parts.push(cover);
  const cover2 = cover.clone(); cover2.translate(0, 0, -width * 0.84);
  parts.push(cover2);
  // tuerca central
  parts.push(cyl(0.045, 0.045, 0.06, 0, 0, width * 0.46, Math.PI / 2, 0, 0, 6));
  return merge(parts);
}

export class CarModel {
  constructor(team, driver, opts = {}) {
    this.team = team;
    this.driver = driver;
    this.lowOnly = !!opts.lowOnly;
    this.root = new THREE.Group(); // posición y yaw
    this.body = new THREE.Group(); // cabeceo y rolido
    this.root.add(this.body);
    this.wheels = [];
    this.compound = null;
    this.damageState = 0;
    const m = mats();
    const hex = team.colors.primary;
    const isSilver = team.id === 'argento';
    this.paint = new THREE.MeshPhysicalMaterial({
      color: hex, map: TX.livery(team), roughness: 0.32, metalness: isSilver ? 0.75 : 0.35,
      clearcoat: 1, clearcoatRoughness: 0.06,
    });
    this.accent = new THREE.MeshPhysicalMaterial({ color: team.colors.secondary, roughness: 0.35, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
    this.helmetMat = new THREE.MeshPhysicalMaterial({ color: driver?.helmet ?? 0xffffff, roughness: 0.25, metalness: 0.3, clearcoat: 1 });
    this.brakeMat = new THREE.MeshStandardMaterial({ color: 0x2b2522, roughness: 0.6, metalness: 0.4, emissive: 0xff3300, emissiveIntensity: 0 });

    this.high = new THREE.Group();
    this.low = new THREE.Group();
    if (!this.lowOnly) this.buildHigh(m);
    this.buildLow(m);
    this.body.add(this.high);
    this.body.add(this.low);
    this.buildWheels(m);
    this.setLOD(this.lowOnly ? 2 : 0);
    this.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  buildHigh(m) {
    const H = this.high;
    // ---- chasis y trompa ----
    const chassis = loft([
      { x: 2.82, w: 0.16, h: 0.1, y0: 0.2, r: 0.5 },
      { x: 2.55, w: 0.24, h: 0.15, y0: 0.2, r: 0.5 },
      { x: 2.15, w: 0.32, h: 0.22, y0: 0.19, r: 0.45 },
      { x: 1.65, w: 0.42, h: 0.33, y0: 0.15, r: 0.4 },
      { x: 1.15, w: 0.52, h: 0.45, y0: 0.1, r: 0.35, pinch: 0.85 },
      { x: 0.75, w: 0.6, h: 0.56, y0: 0.07, r: 0.3, pinch: 0.85 },
      { x: 0.25, w: 0.72, h: 0.6, y0: 0.06, r: 0.25, pinch: 0.9 },
      { x: -0.2, w: 0.76, h: 0.62, y0: 0.06, r: 0.25 },
    ], 28);
    // ---- pontones (sidepods) con "coca-cola" ----
    const pods = loft([
      { x: 0.52, w: 1.2, h: 0.34, y0: 0.1, r: 0.45 },
      { x: 0.3, w: 1.42, h: 0.42, y0: 0.08, r: 0.4 },
      { x: -0.3, w: 1.36, h: 0.46, y0: 0.07, r: 0.42 },
      { x: -0.9, w: 1.05, h: 0.42, y0: 0.07, r: 0.45 },
      { x: -1.45, w: 0.62, h: 0.36, y0: 0.08, r: 0.45 },
      { x: -1.95, w: 0.34, h: 0.3, y0: 0.12, r: 0.5 },
    ], 28);
    // ---- cubierta de motor y toma de aire ----
    const cover = loft([
      { x: 0.02, w: 0.34, h: 0.36, y0: 0.62, r: 0.45 },
      { x: -0.25, w: 0.4, h: 0.42, y0: 0.6, r: 0.45 },
      { x: -0.75, w: 0.38, h: 0.28, y0: 0.6, r: 0.5 },
      { x: -1.35, w: 0.28, h: 0.16, y0: 0.52, r: 0.5 },
      { x: -1.95, w: 0.16, h: 0.08, y0: 0.42, r: 0.5 },
    ], 20);
    const paintParts = [chassis, pods, cover];

    // toma de aire superior (negra) y aleta de tiburón
    const intake = loft([
      { x: 0.05, w: 0.22, h: 0.18, y0: 0.8, r: 0.5 },
      { x: -0.05, w: 0.24, h: 0.2, y0: 0.79, r: 0.5 },
    ], 12);
    const fin = new THREE.Shape();
    fin.moveTo(0, 0); fin.lineTo(-1.3, 0); fin.lineTo(-1.45, -0.32); fin.lineTo(-0.2, 0.12); fin.lineTo(0, 0);
    const finG = new THREE.ExtrudeGeometry(fin, { depth: 0.012, bevelEnabled: false });
    finG.translate(-0.45, 0.98, -0.006);
    const blackParts = [intake, finG];

    // ---- piso, tabla, difusor, pontones inferiores (fibra de carbono) ----
    const carbonParts = [];
    const floor = new THREE.Shape();
    floor.moveTo(1.4, 0.38); floor.lineTo(0.9, 0.86); floor.lineTo(-1.2, 0.86); floor.lineTo(-1.95, 0.6);
    floor.lineTo(-1.95, -0.6); floor.lineTo(-1.2, -0.86); floor.lineTo(0.9, -0.86); floor.lineTo(1.4, -0.38); floor.lineTo(1.4, 0.38);
    const floorG = new THREE.ExtrudeGeometry(floor, { depth: 0.025, bevelEnabled: false });
    floorG.rotateX(Math.PI / 2); floorG.translate(0, 0.065, 0);
    carbonParts.push(floorG);
    // bordes del piso
    carbonParts.push(box(2.0, 0.07, 0.02, -0.15, 0.08, 0.85), box(2.0, 0.07, 0.02, -0.15, 0.08, -0.85));
    // difusor
    for (const z of [-0.5, -0.17, 0.17, 0.5]) {
      const d = box(0.6, 0.02, 0.012, -2.15, 0.17, z); carbonParts.push(d);
    }
    const diff = box(0.65, 0.02, 1.15, -2.2, 0.2, 0); diff.rotateZ(0); carbonParts.push(diff);
    // deflectores de pontón
    carbonParts.push(box(0.5, 0.36, 0.015, 0.55, 0.28, 0.82), box(0.5, 0.36, 0.015, 0.55, 0.28, -0.82));
    // espejos
    for (const s of [1, -1]) {
      carbonParts.push(rod([0.62, 0.62, s * 0.36], [0.6, 0.76, s * 0.56], 0.01));
      carbonParts.push(box(0.06, 0.07, 0.17, 0.6, 0.78, s * 0.58));
    }
    // suspensión delantera (triángulos + pushrod)
    for (const s of [1, -1]) {
      const hub = [WB_F, R_TYRE, s * TRACK_F];
      carbonParts.push(rod([WB_F + 0.32, 0.3, s * 0.18], [hub[0], 0.43, s * (TRACK_F - 0.12)]));
      carbonParts.push(rod([WB_F - 0.38, 0.3, s * 0.22], [hub[0], 0.43, s * (TRACK_F - 0.12)]));
      carbonParts.push(rod([WB_F + 0.32, 0.2, s * 0.15], [hub[0], 0.24, s * (TRACK_F - 0.12)]));
      carbonParts.push(rod([WB_F - 0.4, 0.2, s * 0.2], [hub[0], 0.24, s * (TRACK_F - 0.12)]));
      carbonParts.push(rod([WB_F - 0.05, 0.25, s * (TRACK_F - 0.14)], [WB_F - 0.2, 0.5, s * 0.22], 0.014));
      carbonParts.push(rod([WB_F + 0.15, 0.3, s * 0.18], [hub[0] + 0.12, 0.33, s * (TRACK_F - 0.14)], 0.01)); // dirección
    }
    // suspensión trasera
    for (const s of [1, -1]) {
      const hx = WB_R;
      carbonParts.push(rod([hx + 0.45, 0.35, s * 0.2], [hx, 0.46, s * (TRACK_R - 0.14)]));
      carbonParts.push(rod([hx - 0.15, 0.38, s * 0.15], [hx, 0.46, s * (TRACK_R - 0.14)]));
      carbonParts.push(rod([hx + 0.5, 0.2, s * 0.22], [hx, 0.22, s * (TRACK_R - 0.14)]));
      carbonParts.push(rod([hx - 0.2, 0.2, s * 0.15], [hx, 0.22, s * (TRACK_R - 0.14)]));
      carbonParts.push(rod([hx + 0.05, 0.42, s * (TRACK_R - 0.16)], [hx + 0.3, 0.2, s * 0.2], 0.014));
    }
    H.add(new THREE.Mesh(merge(carbonParts), m.carbon));

    // ---- alerón delantero ----
    const fw = [];
    const fwSpan = 1.9;
    const main = airfoil(0.32, 0.08, fwSpan, -0.05); main.translate(3.02, 0.09, 0); fw.push(main);
    const f1 = airfoil(0.2, 0.07, fwSpan * 0.92, -0.08); f1.rotateZ(-0.22); f1.translate(2.72, 0.14, 0); fw.push(f1);
    const f2 = airfoil(0.16, 0.07, fwSpan * 0.86, -0.1); f2.rotateZ(-0.42); f2.translate(2.55, 0.2, 0); fw.push(f2);
    // endplates
    for (const s of [1, -1]) {
      const ep = new THREE.Shape();
      ep.moveTo(0, 0); ep.lineTo(-0.62, 0); ep.lineTo(-0.66, 0.24); ep.lineTo(-0.3, 0.26); ep.lineTo(0.02, 0.1); ep.lineTo(0, 0);
      const epg = new THREE.ExtrudeGeometry(ep, { depth: 0.012, bevelEnabled: false });
      epg.translate(3.04, 0.04, s * fwSpan / 2 - 0.006);
      fw.push(epg);
    }
    // pilares
    fw.push(box(0.25, 0.12, 0.02, 2.75, 0.18, 0.09), box(0.25, 0.12, 0.02, 2.75, 0.18, -0.09));
    this.frontWing = new THREE.Mesh(merge(fw), this.accent);
    H.add(this.frontWing);

    // ---- alerón trasero + beam wing ----
    const rw = [];
    const rwSpan = 1.0;
    const rmain = airfoil(0.34, 0.1, rwSpan, -0.08); rmain.rotateZ(-0.12); rmain.translate(-2.28, 0.86, 0); rw.push(rmain);
    const beam = airfoil(0.2, 0.09, 0.8, -0.06); beam.rotateZ(-0.2); beam.translate(-2.2, 0.42, 0); rw.push(beam);
    for (const s of [1, -1]) {
      const ep = new THREE.Shape();
      ep.moveTo(0, 0); ep.lineTo(-0.55, 0.05); ep.lineTo(-0.6, 0.62); ep.lineTo(0.02, 0.58); ep.lineTo(0, 0);
      const epg = new THREE.ExtrudeGeometry(ep, { depth: 0.014, bevelEnabled: false });
      epg.translate(-2.12, 0.5, s * rwSpan / 2 - 0.007);
      rw.push(epg);
    }
    // pilón cuello de cisne
    rw.push(rod([-2.0, 0.42, 0], [-2.35, 0.95, 0], 0.025));
    H.add(new THREE.Mesh(merge([...paintParts, ...rw]), this.paint));
    // flap DRS (se abre)
    const flapG = airfoil(0.24, 0.08, rwSpan * 0.98, -0.12);
    this.drsFlap = new THREE.Mesh(flapG, this.accent);
    this.drsPivot = new THREE.Group();
    this.drsPivot.position.set(-2.58, 1.0, 0);
    this.drsFlap.position.set(0.24, 0, 0);
    this.drsFlap.rotation.z = -0.55;
    this.drsPivot.add(this.drsFlap);
    H.add(this.drsPivot);

    // ---- halo (titanio) ----
    const haloCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.0, 0.66, 0.36), new THREE.Vector3(0.35, 0.88, 0.38), new THREE.Vector3(0.75, 0.92, 0.26),
      new THREE.Vector3(0.92, 0.93, 0), new THREE.Vector3(0.75, 0.92, -0.26), new THREE.Vector3(0.35, 0.88, -0.38),
      new THREE.Vector3(0.0, 0.66, -0.36),
    ]);
    const halo = new THREE.TubeGeometry(haloCurve, 40, 0.028, 8, false);
    const pillar = rod([1.1, 0.63, 0], [0.92, 0.93, 0], 0.03);
    H.add(new THREE.Mesh(merge([halo, pillar]), m.titanium));

    // ---- cockpit, piloto y volante ----
    const cockpitG = new THREE.CylinderGeometry(0.27, 0.27, 0.02, 24);
    cockpitG.scale(1.9, 1, 1); cockpitG.translate(0.35, 0.665, 0);
    blackParts.push(cockpitG);
    const helmet = new THREE.SphereGeometry(0.135, 20, 14);
    helmet.scale(1.12, 1, 1);
    this.helmet = new THREE.Mesh(helmet, this.helmetMat);
    this.helmet.position.set(0.12, 0.79, 0);
    H.add(this.helmet);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.137, 16, 8, Math.PI - 0.9, 1.8, 1.15, 0.5), m.glass);
    this.helmet.add(visor);
    // reposacabezas
    blackParts.push(box(0.22, 0.12, 0.66, -0.06, 0.7, 0));
    H.add(new THREE.Mesh(merge(blackParts), m.black));
    // volante con pantalla
    const steerTilt = new THREE.Group();
    steerTilt.position.set(0.62, 0.69, 0);
    steerTilt.rotation.z = -0.35;
    this.steering = new THREE.Group();
    steerTilt.add(this.steering);
    const glovesG = [1, -1].map(sd => { const g = new THREE.SphereGeometry(0.035, 8, 6); g.translate(-0.03, -0.01, sd * 0.15); return g; });
    const sw = new THREE.Mesh(merge([box(0.03, 0.15, 0.27, 0, 0, 0), box(0.05, 0.1, 0.05, 0, -0.02, 0.15), box(0.05, 0.1, 0.05, 0, -0.02, -0.15), ...glovesG]), m.black);
    this.steering.add(sw);
    this.screenCanvas = document.createElement('canvas');
    this.screenCanvas.width = 128; this.screenCanvas.height = 64;
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.06), new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false }));
    screen.position.set(-0.017, 0.02, 0);
    screen.rotation.y = -Math.PI / 2;
    this.steering.add(screen);
    H.add(steerTilt);
    // número en la trompa
    const numMat = new THREE.MeshBasicMaterial({ map: TX.numberDecal(this.driver?.num ?? 0), transparent: true, depthWrite: false });
    const num = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), numMat);
    num.rotation.x = -Math.PI / 2; num.rotation.z = -Math.PI / 2;
    num.position.set(2.0, 0.413, 0);
    H.add(num);
    // T-cam
    H.add(new THREE.Mesh(box(0.1, 0.05, 0.12, -0.02, 1.0, 0), new THREE.MeshStandardMaterial({ color: this.driver && this.driver.num % 2 ? 0xffd400 : 0x111111 })));
    // luz de lluvia
    this.rainLight = new THREE.Mesh(box(0.04, 0.08, 0.1, -2.42, 0.36, 0), m.rainLight.clone());
    H.add(this.rainLight);
    this.parts = { chassis, pods };
  }

  buildLow(m) {
    const L = this.low;
    const body = loft([
      { x: 2.8, w: 0.18, h: 0.12, y0: 0.2, r: 0.5 },
      { x: 1.4, w: 0.48, h: 0.4, y0: 0.12, r: 0.4 },
      { x: 0.4, w: 1.4, h: 0.5, y0: 0.07, r: 0.35 },
      { x: -0.3, w: 1.3, h: 0.8, y0: 0.07, r: 0.35 },
      { x: -1.9, w: 0.35, h: 0.35, y0: 0.1, r: 0.45 },
    ], 10);
    L.add(new THREE.Mesh(body, this.paint));
    const wings = merge([box(0.45, 0.06, 1.9, 2.82, 0.12, 0), box(0.45, 0.25, 1.0, -2.4, 0.92, 0), box(3.2, 0.03, 1.6, -0.2, 0.07, 0)]);
    L.add(new THREE.Mesh(wings, m.carbon));
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, 8, 6), this.helmetMat);
    helmet.position.set(0.12, 0.79, 0);
    L.add(helmet);
    // ruedas fusionadas para la distancia (una sola llamada de dibujo)
    const wg = [];
    for (const [x, z, w] of [[WB_F, -TRACK_F, 0.3], [WB_F, TRACK_F, 0.3], [WB_R, -TRACK_R, 0.38], [WB_R, TRACK_R, 0.38]]) {
      const c = new THREE.CylinderGeometry(R_TYRE, R_TYRE, w, 14);
      c.rotateX(Math.PI / 2); c.translate(x, R_TYRE, z);
      wg.push(c);
    }
    L.add(new THREE.Mesh(merge(wg), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 })));
  }

  buildWheels(m) {
    const defs = [
      { x: WB_F, z: -TRACK_F, w: 0.3, front: true }, { x: WB_F, z: TRACK_F, w: 0.3, front: true },
      { x: WB_R, z: -TRACK_R, w: 0.38, front: false }, { x: WB_R, z: TRACK_R, w: 0.38, front: false },
    ];
    // orden de ruedas igual que la física: FL, FR, RL, RR (izquierda = -z)
    tyreGeoF = tyreGeoF || tyreGeometry(0.3);
    tyreGeoR = tyreGeoR || tyreGeometry(0.38);
    const rimF = rimGeometry(0.3), rimR = rimGeometry(0.38);
    for (const d of defs) {
      const steer = new THREE.Group();
      steer.position.set(d.x, R_TYRE, d.z);
      const spin = new THREE.Group();
      steer.add(spin);
      const tyre = new THREE.Mesh(d.front ? tyreGeoF : tyreGeoR, tyreMat('medium'));
      tyre.castShadow = true;
      spin.add(tyre);
      const rim = new THREE.Mesh(d.front ? rimF : rimR, m.rim);
      spin.add(rim);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.035, 20), this.brakeMat);
      disc.rotation.x = Math.PI / 2;
      disc.position.z = d.z > 0 ? -0.06 : 0.06;
      steer.add(disc);
      this.root.add(steer);
      this.wheels.push({ steer, spin, tyre, rim, disc, front: d.front, baseY: R_TYRE });
    }
  }

  setCompound(c) {
    if (c === this.compound) return;
    this.compound = c;
    for (const w of this.wheels) w.tyre.material = tyreMat(c);
  }

  // 0 = completo, 1 = carrocería detallada sin llantas ni discos, 2 = lejano (fusionado)
  setLOD(level) {
    if (this.lowOnly && level < 2) level = 2;
    if (this.lod === level) return;
    this.lod = level;
    this.high.visible = level < 2;
    this.low.visible = level === 2;
    for (const w of this.wheels) { w.steer.visible = level < 2; w.rim.visible = level === 0; w.disc.visible = level === 0; }
    if (this.steering) this.steering.parent.visible = level === 0;
  }

  setDamage(frontWing) {
    if (!this.frontWing) return;
    const state = frontWing > 0.6 ? 2 : frontWing > 0.25 ? 1 : 0;
    if (state === this.damageState) return;
    this.damageState = state;
    this.frontWing.visible = state < 2;
    this.frontWing.scale.z = state === 1 ? 0.7 : 1;
    this.frontWing.rotation.x = state === 1 ? 0.06 : 0;
  }

  // Actualiza la pose. st: { x,y,z,heading,pitch,roll,steer,wheelRot[] o número, compound, drs, brakeGlow, rainLight }
  update(st, dt, t) {
    const r = this.root;
    r.position.set(st.x, st.y, st.z);
    r.rotation.y = -st.heading;
    this.body.rotation.z = st.pitch || 0;
    this.body.rotation.x = st.roll || 0;
    this.body.position.y = st.bodyY || 0;
    const steer = st.steer || 0;
    this.wheels[0].steer.rotation.y = steer;
    this.wheels[1].steer.rotation.y = steer;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const rot = Array.isArray(st.wheelRot) ? st.wheelRot[i] : st.wheelRot;
      w.spin.rotation.z = -(rot || 0);
      const susp = st.susp ? st.susp[i] : 0;
      w.steer.position.y = w.baseY + susp;
    }
    // pendiente: inclinar todo el auto
    r.rotation.z = st.slope || 0;
    if (st.compound) this.setCompound(st.compound);
    if (this.drsFlap) this.drsFlap.rotation.z += ((st.drs ? -0.05 : -0.55) - this.drsFlap.rotation.z) * Math.min(1, dt * 12);
    if (this.steering) this.steering.rotation.x = -steer * 4.5;
    this.brakeMat.emissiveIntensity = Math.max(0, Math.min(3, ((st.brakeT || 300) - 450) / 250));
    if (this.rainLight) this.rainLight.material.emissiveIntensity = st.rainLight ? (Math.floor(t * 4) % 2 ? 4 : 0.3) : 0;
    if (st.damage !== undefined) this.setDamage(st.damage);
  }

  drawScreen(data) {
    const c = this.screenCanvas, ctx = c.getContext('2d');
    ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, 128, 64);
    // leds de cambio
    const frac = Math.max(0, Math.min(1, (data.rpm - 9000) / 3000));
    for (let i = 0; i < 15; i++) {
      const on = i / 15 < frac;
      ctx.fillStyle = on ? (i < 5 ? '#18e018' : i < 10 ? '#ff2020' : '#4060ff') : '#151515';
      ctx.fillRect(4 + i * 8, 2, 6, 5);
    }
    ctx.fillStyle = '#fff'; ctx.font = 'bold 30px monospace'; ctx.textAlign = 'center';
    ctx.fillText(data.gear === 0 ? 'N' : String(data.gear), 64, 40);
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left'; ctx.fillText(String(Math.round(data.speed)), 4, 24);
    ctx.textAlign = 'right';
    ctx.fillStyle = data.delta > 0 ? '#ff5050' : '#40ff60';
    ctx.fillText((data.delta >= 0 ? '+' : '') + (data.delta || 0).toFixed(2), 124, 24);
    ctx.fillStyle = '#ffd000'; ctx.textAlign = 'left';
    ctx.fillText('ERS ' + Math.round((data.battery || 0) * 100) + '%', 4, 60);
    ctx.textAlign = 'right'; ctx.fillStyle = data.drs ? '#30ff30' : '#666';
    ctx.fillText('DRS', 124, 60);
    this.screenTex.needsUpdate = true;
  }
}

export const CAR_DIMS = { WB_F, WB_R, TRACK_F, TRACK_R, R_TYRE };
