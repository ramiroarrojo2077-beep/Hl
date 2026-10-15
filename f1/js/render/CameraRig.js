// Cámaras: cockpit (casco), T-cam sobre el halo, TV (cámaras de la pista), exterior trasera,
// frontal, lateral, helicóptero y libre (repeticiones). Movimiento natural, vibraciones y FOV dinámico.

import * as THREE from 'three';

export const CAM_MODES = ['chase', 'tcam', 'cockpit', 'front', 'side', 'tv', 'heli', 'free'];
export const CAM_LABEL = {
  chase: 'Exterior trasera', tcam: 'T-cam (halo)', cockpit: 'Cockpit (casco)', front: 'Frontal',
  side: 'Lateral', tv: 'Televisión', heli: 'Helicóptero', free: 'Libre',
};

const v3 = () => new THREE.Vector3();

export class CameraRig {
  constructor(camera, dom) {
    this.cam = camera;
    this.mode = 'chase';
    this.pos = v3(); this.look = v3();
    this.vel = v3();
    this.fov = 60;
    this.shake = 0;
    this.tvIndex = -1;
    this.tvCams = [];
    this.lookBack = false;
    this.free = { yaw: 0.6, pitch: 0.35, dist: 14, dragging: false };
    this.first = true;
    this.t = 0;
    if (dom) this.bindFree(dom);
  }

  bindFree(dom) {
    let lx = 0, ly = 0;
    dom.addEventListener('pointerdown', e => { if (this.mode !== 'free') return; this.free.dragging = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('pointerup', () => { this.free.dragging = false; });
    window.addEventListener('pointermove', e => {
      if (!this.free.dragging || this.mode !== 'free') return;
      this.free.yaw -= (e.clientX - lx) * 0.006;
      this.free.pitch = Math.max(-0.1, Math.min(1.45, this.free.pitch + (e.clientY - ly) * 0.005));
      lx = e.clientX; ly = e.clientY;
    });
    dom.addEventListener('wheel', e => {
      if (this.mode !== 'free') return;
      this.free.dist = Math.max(4, Math.min(120, this.free.dist * (1 + Math.sign(e.deltaY) * 0.1)));
    }, { passive: true });
  }

  setMode(m) {
    if (m === this.mode) return;
    this.mode = m;
    this.first = true;
    this.tvIndex = -1;
  }

  cycle(list = CAM_MODES.slice(0, 6)) {
    const i = list.indexOf(this.mode);
    this.setMode(list[(i + 1) % list.length]);
    return this.mode;
  }

  // st: { x,y,z,heading,pitch,roll,speed,ax,ay,s,kerb,offTrack,impact }
  update(dt, st, track) {
    this.t += dt;
    const cam = this.cam;
    const c = Math.cos(st.heading), s = Math.sin(st.heading);
    const fwd = new THREE.Vector3(c, 0, s), right = new THREE.Vector3(-s, 0, c);
    const up = new THREE.Vector3(0, 1, 0);
    const base = new THREE.Vector3(st.x, st.y, st.z);
    const speed = st.speed || 0;
    // vibración
    const kerbShake = (st.kerb || 0) * Math.min(1, speed / 30) * 0.04;
    const offShake = st.offTrack ? 0.05 * Math.min(1, speed / 20) : 0;
    this.shake = Math.max(this.shake * Math.exp(-dt * 6), kerbShake + offShake + Math.min(0.012, speed * 0.00012));
    if (st.impact > 3) this.shake = Math.max(this.shake, Math.min(0.3, st.impact * 0.02));
    const sh = this.shake;
    const n = (f) => Math.sin(this.t * f) * Math.sin(this.t * f * 1.37 + 1.3);
    const jitter = new THREE.Vector3(n(37) * sh, n(43) * sh, n(29) * sh);
    let fovTarget = 60;
    let pos = v3(), look = v3(), smoothPos = false;
    const pitch = st.pitch || 0, roll = st.roll || 0;
    const mode = this.mode;
    const back = this.lookBack && ['chase', 'tcam', 'cockpit', 'front', 'side'].includes(mode);
    if (mode === 'chase') {
      const dist = 5.4 + Math.min(0.8, speed * 0.008), height = 1.55;
      pos.copy(base).addScaledVector(fwd, back ? dist : -dist).addScaledVector(up, height);
      look.copy(base).addScaledVector(fwd, back ? -8 : 8).addScaledVector(up, 0.75);
      fovTarget = 58 + Math.min(10, speed * 0.09);
      smoothPos = true;
    } else if (mode === 'tcam') {
      pos.copy(base).addScaledVector(fwd, -0.1).addScaledVector(up, 1.22);
      look.copy(pos).addScaledVector(fwd, back ? -20 : 20).addScaledVector(up, -1.3);
      fovTarget = 66 + Math.min(10, speed * 0.08);
    } else if (mode === 'cockpit') {
      pos.copy(base).addScaledVector(fwd, 0.08).addScaledVector(up, 0.86 + pitch * 0.2);
      // la cabeza se inclina con las fuerzas G
      pos.addScaledVector(right, -(st.ay || 0) * 0.0025);
      pos.addScaledVector(fwd, -(st.ax || 0) * 0.0015);
      look.copy(pos).addScaledVector(fwd, back ? -20 : 20).addScaledVector(up, -0.9).addScaledVector(right, (st.steer || 0) * -4);
      fovTarget = 72;
    } else if (mode === 'front') {
      pos.copy(base).addScaledVector(fwd, 3.05).addScaledVector(up, 0.3);
      look.copy(pos).addScaledVector(fwd, back ? -20 : 20).addScaledVector(up, 0.1);
      fovTarget = 70 + Math.min(8, speed * 0.06);
    } else if (mode === 'side') {
      pos.copy(base).addScaledVector(right, 0.75).addScaledVector(up, 0.82).addScaledVector(fwd, -0.4);
      look.copy(pos).addScaledVector(fwd, back ? -20 : 20).addScaledVector(up, -0.3);
      fovTarget = 70;
    } else if (mode === 'tv') {
      // elegir la cámara de pista más cercana por delante o recién pasada
      if (this.tvCams.length) {
        const L = track.length;
        let best = this.tvIndex, bestScore = Infinity;
        for (let i = 0; i < this.tvCams.length; i++) {
          const tc = this.tvCams[i];
          let ds = tc.s - st.s; if (ds > L / 2) ds -= L; else if (ds < -L / 2) ds += L;
          const dd = Math.hypot(tc.x - st.x, tc.z - st.z);
          const score = (ds < -60 ? 1e6 : 0) + dd + (ds > 0 ? 0 : 40);
          if (score < bestScore) { bestScore = score; best = i; }
        }
        const cur = this.tvIndex >= 0 ? this.tvCams[this.tvIndex] : null;
        const curD = cur ? Math.hypot(cur.x - st.x, cur.z - st.z) : Infinity;
        if (best !== this.tvIndex && (curD > 120 || !cur)) { this.tvIndex = best; this.first = true; }
        const tc = this.tvCams[Math.max(0, this.tvIndex)];
        pos.set(tc.x, tc.y, tc.z);
        look.copy(base).addScaledVector(up, 0.5).addScaledVector(fwd, Math.min(8, speed * 0.08));
        const dist = pos.distanceTo(look);
        fovTarget = Math.max(6, Math.min(55, THREE.MathUtils.radToDeg(2 * Math.atan(9 / dist))));
      }
    } else if (mode === 'heli') {
      pos.copy(base).addScaledVector(fwd, -45).addScaledVector(up, 40).addScaledVector(right, 25);
      look.copy(base).addScaledVector(fwd, 15);
      fovTarget = 45;
      smoothPos = true;
    } else if (mode === 'free') {
      const f = this.free;
      pos.set(st.x + Math.cos(f.yaw) * Math.cos(f.pitch) * f.dist, st.y + 1 + Math.sin(f.pitch) * f.dist, st.z + Math.sin(f.yaw) * Math.cos(f.pitch) * f.dist);
      look.copy(base).addScaledVector(up, 0.6);
      fovTarget = 55;
    }
    if (this.first) { this.pos.copy(pos); this.look.copy(look); this.fov = fovTarget; this.first = false; }
    if (smoothPos) {
      // resorte crítico para la cámara de persecución
      const k = 1 - Math.exp(-dt * (mode === 'heli' ? 2 : 9));
      this.pos.lerp(pos, k);
      // no meterse bajo el piso
      this.pos.y = Math.max(this.pos.y, st.y + 0.9);
      this.look.lerp(look, 1 - Math.exp(-dt * 16));
    } else {
      this.pos.copy(pos);
      this.look.lerp(look, mode === 'tv' ? 1 - Math.exp(-dt * 10) : 1);
    }
    this.fov += (fovTarget - this.fov) * Math.min(1, dt * 4);
    cam.position.copy(this.pos).add(jitter);
    cam.up.set(0, 1, 0);
    if (mode === 'cockpit' || mode === 'tcam' || mode === 'front' || mode === 'side') {
      // inclinar con el auto
      const m = new THREE.Matrix4().lookAt(cam.position, this.look, up);
      cam.quaternion.setFromRotationMatrix(m);
      cam.rotateZ(-(roll || 0) * 0.8);
    } else cam.lookAt(this.look);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }

  get interior() { return this.mode === 'cockpit' || this.mode === 'tcam'; }
}
