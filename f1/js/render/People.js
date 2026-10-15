// Personas: público instanciado y animado por shader, comisarios con banderas,
// fotógrafos y mecánicos articulados para las paradas en boxes.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const matCache = new Map();
let _pm = null;
function personMat() { return _pm || (_pm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 })); }
export function solid(color, rough = 0.8, metal = 0) {
  const key = color + ':' + rough + ':' + metal;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  return matCache.get(key);
}

function part(geo, x, y, z) { geo.translate(x, y, z); return geo; }

// ---------- público instanciado ----------
let crowdGeo = null;
function crowdGeometry() {
  if (crowdGeo) return crowdGeo;
  const parts = [];
  const add = (g, arm) => {
    const n = g.attributes.position.count;
    g.setAttribute('arm', new THREE.Float32BufferAttribute(new Float32Array(n).fill(arm), 1));
    const ng = g.index ? g.toNonIndexed() : g;
    parts.push(ng);
  };
  add(part(new THREE.BoxGeometry(0.42, 0.55, 0.26), 0, 0.72, 0), 0); // torso
  add(part(new THREE.BoxGeometry(0.38, 0.45, 0.4), 0, 0.25, 0.08), 0); // piernas sentadas
  add(part(new THREE.BoxGeometry(0.2, 0.24, 0.22), 0, 1.13, 0), 0); // cabeza
  add(part(new THREE.BoxGeometry(0.1, 0.5, 0.1), 0.27, 0.95, 0), 1); // brazos
  add(part(new THREE.BoxGeometry(0.1, 0.5, 0.1), -0.27, 0.95, 0), 1);
  crowdGeo = mergeGeometries(parts, false);
  return crowdGeo;
}

export const crowdUniforms = { uTime: { value: 0 }, uExcite: { value: 0.2 } };

export function makeCrowd(positions, colors) {
  const geo = crowdGeometry();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = crowdUniforms.uTime;
    sh.uniforms.uExcite = crowdUniforms.uExcite;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float arm;\nuniform float uTime;\nuniform float uExcite;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = fract(instanceMatrix[3].x * 0.137 + instanceMatrix[3].z * 0.071) * 6.283;
        float jump = max(0.0, sin(uTime * 7.0 + ph)) * 0.12 * uExcite;
        float wave = (0.5 + 0.5 * sin(uTime * 9.0 + ph * 2.0)) * uExcite;
        transformed.y += jump + arm * wave * 0.45 * step(0.5, fract(ph * 3.1));
        transformed.x += arm * sign(transformed.x) * wave * 0.08;`);
  };
  const mesh = new THREE.InstancedMesh(geo, mat, positions.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), c = new THREE.Color();
  positions.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot);
    const sc = 0.9 + Math.random() * 0.2;
    s.set(sc, sc, sc);
    m.compose(new THREE.Vector3(p.x, p.y, p.z), q, s);
    mesh.setMatrixAt(i, m);
    c.setHex(colors[Math.floor(Math.random() * colors.length)]);
    mesh.setColorAt(i, c);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------- persona articulada ----------
export class Person {
  constructor({ suit = 0xff6a00, helmet = null, skin = 0xc68e6a, cap = null, scale = 1 } = {}) {
    this.root = new THREE.Group();
    this.root.scale.setScalar(scale);
    const vc = (g, hex) => {
      const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g.index ? g.toNonIndexed() : g;
    };
    const mat = personMat();
    this.hips = new THREE.Group(); this.hips.position.y = 0.92; this.root.add(this.hips);
    const body = [vc(part(new THREE.BoxGeometry(0.26, 0.56, 0.4), 0, 0.3, 0), suit), vc(part(new THREE.SphereGeometry(0.11, 8, 6), 0, 0.72, 0), skin)];
    if (helmet !== null) {
      body.push(vc(part(new THREE.SphereGeometry(0.135, 8, 6, 0, 6.3, 0, 1.9), 0, 0.74, 0), helmet));
      body.push(vc(part(new THREE.BoxGeometry(0.03, 0.06, 0.18), 0.12, 0.72, 0), 0x111111));
    } else if (cap !== null) body.push(vc(part(new THREE.CylinderGeometry(0.115, 0.115, 0.07, 8), 0, 0.8, 0), cap));
    this.torso = new THREE.Mesh(mergeGeometries(body), mat);
    this.hips.add(this.torso);
    this.arms = [];
    for (const sd of [1, -1]) {
      const sh = new THREE.Group();
      sh.position.set(0, 0.54, sd * 0.24);
      sh.add(new THREE.Mesh(vc(part(new THREE.BoxGeometry(0.09, 0.32, 0.09), 0, -0.16, 0), suit), mat));
      const elbow = new THREE.Group(); elbow.position.y = -0.32; sh.add(elbow);
      elbow.add(new THREE.Mesh(mergeGeometries([vc(part(new THREE.BoxGeometry(0.08, 0.3, 0.08), 0, -0.15, 0), suit), vc(part(new THREE.BoxGeometry(0.08, 0.08, 0.08), 0, -0.32, 0), 0x1a1a1a)]), mat));
      this.hips.add(sh);
      this.arms.push({ sh, elbow });
    }
    this.legs = [];
    for (const sd of [1, -1]) {
      const hip = new THREE.Group(); hip.position.set(0, 0, sd * 0.1);
      hip.add(new THREE.Mesh(vc(part(new THREE.BoxGeometry(0.12, 0.46, 0.12), 0, -0.23, 0), suit), mat));
      const knee = new THREE.Group(); knee.position.y = -0.46; hip.add(knee);
      knee.add(new THREE.Mesh(mergeGeometries([vc(part(new THREE.BoxGeometry(0.11, 0.44, 0.11), 0, -0.22, 0), suit), vc(part(new THREE.BoxGeometry(0.22, 0.06, 0.11), 0.05, -0.45, 0), 0x1a1a1a)]), mat));
      this.hips.add(hip);
      this.legs.push({ hip, knee });
    }
    this.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.prop = null;
  }

  pose(name, t = 0, k = 1) {
    const [aL, aR] = this.arms, [lL, lR] = this.legs;
    // reset
    this.hips.position.y = 0.92; this.hips.rotation.set(0, 0, 0);
    for (const a of this.arms) { a.sh.rotation.set(0, 0, 0); a.elbow.rotation.set(0, 0, 0); }
    for (const l of this.legs) { l.hip.rotation.set(0, 0, 0); l.knee.rotation.set(0, 0, 0); }
    if (name === 'idle') {
      const b = Math.sin(t * 1.7) * 0.02;
      aL.sh.rotation.z = -0.15 + b; aR.sh.rotation.z = -0.1 - b;
      aL.elbow.rotation.z = 0.2; aR.elbow.rotation.z = 0.2;
    } else if (name === 'wave') {
      // agitar bandera con el brazo derecho
      aR.sh.rotation.z = 2.6 + Math.sin(t * 10) * 0.5 * k;
      aR.sh.rotation.x = Math.sin(t * 10) * 0.6 * k;
      aR.elbow.rotation.z = 0.3;
      aL.sh.rotation.z = -0.2;
    } else if (name === 'kneel') {
      // mecánico de rueda agachado con la pistola
      this.hips.position.y = 0.5;
      lL.hip.rotation.z = 1.4; lL.knee.rotation.z = -1.5;
      lR.hip.rotation.z = 0.3; lR.knee.rotation.z = -2.2;
      this.hips.rotation.z = -0.35;
      aL.sh.rotation.z = 1.3 + Math.sin(t * 30) * 0.03 * k; aR.sh.rotation.z = 1.3;
      aL.elbow.rotation.z = 0.5; aR.elbow.rotation.z = 0.5;
    } else if (name === 'carry') {
      aL.sh.rotation.z = 0.9; aR.sh.rotation.z = 0.9;
      aL.elbow.rotation.z = 1.0; aR.elbow.rotation.z = 1.0;
      this.hips.rotation.z = -0.15;
    } else if (name === 'jack') {
      this.hips.rotation.z = -0.5 - k * 0.15;
      this.hips.position.y = 0.8;
      aL.sh.rotation.z = 1.2 + k * 0.4; aR.sh.rotation.z = 1.2 + k * 0.4;
      lL.hip.rotation.z = 0.5; lR.hip.rotation.z = -0.3; lL.knee.rotation.z = -0.6;
    } else if (name === 'lollipop') {
      aR.sh.rotation.z = 1.6; aR.elbow.rotation.z = -0.2;
      aL.sh.rotation.z = -0.1;
    } else if (name === 'photo') {
      aL.sh.rotation.z = 1.4; aR.sh.rotation.z = 1.4;
      aL.elbow.rotation.z = 1.5; aR.elbow.rotation.z = 1.5;
      this.hips.position.y = 0.6; lL.hip.rotation.z = 1.2; lL.knee.rotation.z = -1.7; lR.knee.rotation.z = -1.2; lR.hip.rotation.z = 0.2;
    } else if (name === 'cheer') {
      aL.sh.rotation.z = 2.8 + Math.sin(t * 8) * 0.2; aR.sh.rotation.z = 2.8 - Math.sin(t * 8) * 0.2;
      this.hips.position.y = 0.92 + Math.max(0, Math.sin(t * 8)) * 0.12;
    }
  }

  attach(obj, armIdx = 1) {
    this.arms[armIdx].elbow.add(obj);
    this.prop = obj;
  }
}

export function flagMesh(color = 0xffd400) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 5), solid(0x333333));
  pole.position.y = -0.55;
  g.add(pole);
  const clothMat = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.9 });
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.45, 6, 1), clothMat);
  cloth.position.set(0, -1.0, 0.3);
  cloth.rotation.y = Math.PI / 2;
  g.add(cloth);
  g.userData.cloth = cloth;
  g.position.y = -0.3;
  return g;
}

export function wheelGun() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.28, 8), solid(0x222222, 0.4, 0.6));
  body.rotation.z = Math.PI / 2; body.position.set(0.14, -0.33, 0);
  g.add(body);
  const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 5), solid(0x111111));
  hose.position.set(-0.1, -0.6, 0); hose.rotation.z = 0.6;
  g.add(hose);
  return g;
}

export function cameraProp() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.1), solid(0x111111, 0.4));
  body.position.set(0.1, -0.32, 0.12);
  g.add(body);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.35, 10), solid(0xdddddd, 0.4));
  lens.rotation.z = Math.PI / 2; lens.position.set(0.35, -0.32, 0.12);
  g.add(lens);
  return g;
}

export function lollipop() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.2, 5), solid(0x333333));
  pole.rotation.z = Math.PI / 2; pole.position.set(0.6, -0.3, 0);
  g.add(pole);
  const sign = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 16), new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0x400000 }));
  sign.rotation.x = Math.PI / 2; sign.position.set(1.2, -0.3, 0);
  g.add(sign);
  g.userData.sign = sign;
  return g;
}

export function spareWheel(compoundColor = 0xf5d10a) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.1, 8, 16), solid(0x151515, 0.9));
  g.add(t);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.012, 4, 20), solid(compoundColor, 0.6));
  g.add(band);
  return g;
}
