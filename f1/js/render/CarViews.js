// Vincula los autos de la sesión con sus modelos 3D: pose, ruedas, suspensión, LOD,
// DRS, frenos incandescentes, partículas (humo, spray, tierra, chispas), Safety Car
// y los equipos de boxes animados durante las paradas.

import * as THREE from 'three';
import { CarModel, loft } from './CarModel.js';
import { Person, wheelGun, lollipop, spareWheel, solid } from './People.js';
import { COMPOUNDS, TEAMS } from '../data/teams.js';
import { TYRE_R } from '../core/CarPhysics.js';

export class CarViews {
  constructor(world, session, trackScene, settings) {
    this.world = world;
    this.session = session;
    this.ts = trackScene;
    this.settings = settings;
    this.views = new Map();
    this.group = new THREE.Group();
    world.scene.add(this.group);
    for (const e of session.entrants) {
      const m = new CarModel(e.team, e.driver, { lowOnly: settings.quality === 'bajo' && !e.isPlayer });
      this.group.add(m.root);
      this.views.set(e, { model: m, wheelRot: [0, 0, 0, 0], susp: [0, 0, 0, 0], yaw: 0, emitT: 0 });
    }
    this.buildSafetyCar();
    this.crews = new PitCrews(trackScene, session, this.group);
  }

  buildSafetyCar() {
    const g = new THREE.Group();
    const paint = new THREE.MeshPhysicalMaterial({ color: 0xc9cdd2, metalness: 0.8, roughness: 0.25, clearcoat: 1 });
    const body = loft([
      { x: 2.4, w: 1.7, h: 0.5, y0: 0.25, r: 0.4 },
      { x: 1.2, w: 1.9, h: 0.75, y0: 0.2, r: 0.35 },
      { x: -0.2, w: 1.95, h: 1.15, y0: 0.2, r: 0.4, pinch: 0.75 },
      { x: -1.4, w: 1.95, h: 1.05, y0: 0.2, r: 0.4, pinch: 0.8 },
      { x: -2.3, w: 1.8, h: 0.7, y0: 0.25, r: 0.35 },
    ], 20);
    g.add(new THREE.Mesh(body, paint));
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, 1.7), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.05, metalness: 0.8 }));
    glass.position.set(-0.4, 1.15, 0);
    g.add(glass);
    const bar = new THREE.Group();
    this.scLights = [];
    for (let k = 0; k < 2; k++) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.5), new THREE.MeshStandardMaterial({ color: 0xffa000, emissive: 0xffa000, emissiveIntensity: 0 }));
      l.position.set(-0.5, 1.4, k ? 0.35 : -0.35);
      bar.add(l);
      this.scLights.push(l);
    }
    g.add(bar);
    for (const x of [1.5, -1.5]) for (const z of [0.85, -0.85]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.25, 16), solid(0x111111, 0.8));
      w.rotation.x = Math.PI / 2; w.position.set(x, 0.34, z);
      g.add(w);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.visible = false;
    this.sc = g;
    this.group.add(g);
  }

  update(dt, t, camPos, opts = {}) {
    const s = this.session, tr = s.track, ph = s.phys;
    const parts = this.world.particles;
    const wet = s.wetness;
    for (const [e, v] of this.views) {
      const m = v.model;
      const hidden = (e.retired && (!e.retiredOnTrack || e.removed)) || e.inGarage && !e.isPlayer && !opts.showGarage;
      m.root.visible = !hidden;
      if (hidden) continue;
      let st;
      if (e.isPlayer && !s.playerAuto && ph) {
        // auto del jugador: estado físico completo
        const susp = [0, 1, 2, 3].map(i => -(ph.fz[i] - 3200) / 3200 * 0.012);
        st = {
          x: ph.x, y: ph.y, z: ph.z, heading: ph.psi,
          pitch: Math.atan(ph.grade || 0) * Math.cos(ph.psi - tr.heading[tr.idx(ph.s)]) + ph.ax * 0.0012,
          roll: -ph.ay * 0.0016,
          steer: ph.steerAngle, wheelRot: ph.wheelRot, susp,
          compound: ph.compound, drs: ph.drsOpen, brakeT: (ph.brakeT[0] + ph.brakeT[1]) / 2,
          rainLight: wet > 0.15 || ph.limiter || s.playerAuto, damage: ph.damage.frontWing,
          bodyY: (ph.onKerb ? Math.sin(t * 60) * 0.008 : 0),
        };
        // vibración en pianos
      } else {
        v.yaw += 0;
        const rotSpeed = e.v / TYRE_R;
        for (let i = 0; i < 4; i++) v.wheelRot[i] = (v.wheelRot[i] + rotSpeed * dt) % (Math.PI * 2);
        const pitch = (e.pitch || 0) + (e.ax || 0) * 0.0012;
        const roll = -(e.ay || 0) * 0.0015;
        let bodyLift = 0;
        // gatos levantando el auto durante la parada
        if (e.pitPhase === 'service' && e.service) {
          const st2 = e.service, k = st2.t;
          bodyLift = k > st2.serve + 0.25 && k < st2.total - 0.35 ? 0.07 : 0;
        }
        st = {
          x: e.x, y: e.y + bodyLift, z: e.z, heading: e.heading, pitch, roll, steer: e.steerVis || 0,
          wheelRot: v.wheelRot, susp: [0, 0, 0, 0], compound: e.compound, drs: e.drsOpen,
          brakeT: 300 + (e.brake || 0) * 700, rainLight: wet > 0.15 || e.inPit, damage: e.damage.frontWing,
        };
        if (e.isPlayer && ph) { st.wheelRot = ph.wheelRot; }
      }
      // LOD por distancia
      const dx = st.x - camPos.x, dz = st.z - camPos.z, d2 = dx * dx + dz * dz;
      m.setLOD(d2 > 70 * 70 ? 1 : 0);
      m.update(st, dt, t);
      // ruedas durante el cambio de neumáticos
      if (e.pitPhase === 'service' && e.service) this.crews.wheelVisibility(e, m);
      else for (const w of m.wheels) w.spin.visible = true;
      // partículas
      if (d2 > 260 * 260) continue;
      const speed = e.isPlayer && ph && !s.playerAuto ? ph.speed : e.v;
      const hc = Math.cos(st.heading), hs = Math.sin(st.heading);
      const vx = hc * speed, vz = hs * speed;
      v.emitT += dt;
      if (v.emitT < 1 / 40) continue;
      const step = v.emitT; v.emitT = 0;
      const rx = st.x - hc * 1.9, rz = st.z - hs * 1.9;
      if (wet > 0.12 && speed > 18) {
        const amt = Math.min(1.6, wet * 1.5 * speed / 50);
        for (let k = 0; k < Math.ceil(amt * 2); k++) parts.spray(rx, st.y, rz, vx, vz, amt);
      }
      let locking = false, sliding = false, offT = false, kerbHit = false;
      if (e.isPlayer && ph && !s.playerAuto) {
        locking = ph.lock.some(Boolean); sliding = ph.slideAmount > 0.35 || ph.spin.some(Boolean);
        offT = ph.surf.filter(x => x >= 2).length >= 2; kerbHit = ph.onKerb > 0;
      } else {
        locking = !!(e.ai && e.ai.error && e.ai.error.t > 0.6) || e.lockFx > 0;
        sliding = e.spinTimer > 0;
        offT = Math.abs(e.d) > tr.halfW + 1.6;
      }
      if ((locking || sliding) && speed > 6 && wet < 0.3) {
        const fx = st.x + hc * (locking ? 1.8 : -1.8), fz = st.z + hs * (locking ? 1.8 : -1.8);
        parts.smoke(fx, st.y, fz, vx, vz, sliding ? 1.4 : 0.8);
      }
      if (offT && speed > 5) {
        const surf = tr.surface(e.s, e.d);
        parts.dust(rx, st.y, rz, vx, vz, surf === 3 ? [0.72, 0.64, 0.5] : [0.42, 0.5, 0.3]);
      }
      if (speed > 70 && (kerbHit || Math.random() < 0.02 * step * 40) && wet < 0.2 && Math.random() < 0.35) parts.sparks(st.x - hc * 0.5, st.y, st.z - hs * 0.5, vx, vz);
      if (e.smokeFx && (e.failure === 'engine' || e.failure === 'hydraulics' || e.retired)) parts.smoke(rx, st.y + 0.6, rz, vx, vz, 1.2, [0.55, 0.55, 0.58]);
    }
    // Safety Car
    const sc = s.safetyCar;
    if (sc && sc.onTrack) {
      this.sc.visible = true;
      this.sc.position.set(sc.x, sc.y, sc.z);
      this.sc.rotation.y = -sc.heading;
      const blink = Math.floor(t * 6) % 2;
      this.scLights[0].material.emissiveIntensity = blink ? 5 : 0;
      this.scLights[1].material.emissiveIntensity = blink ? 0 : 5;
    } else this.sc.visible = false;
    this.crews.update(dt, t, camPos);
  }

  setHelmetVisible(e, vis) {
    const v = this.views.get(e);
    if (v && v.model.helmet) v.model.helmet.visible = vis;
  }

  modelOf(e) { return this.views.get(e)?.model; }
}

// ---------- equipos de boxes ----------
class PitCrews {
  constructor(ts, session, group) {
    this.ts = ts; this.session = session; this.group = group;
    this.crews = new Map();
    this.track = session.track;
  }

  ensure(teamId) {
    if (this.crews.has(teamId)) return this.crews.get(teamId);
    const tr = this.track, pit = tr.pit;
    const k = TEAMS.findIndex(t => t.id === teamId);
    const team = TEAMS[k];
    const box = pit.boxes[k];
    const members = [];
    const roles = ['gunFL', 'gunFR', 'gunRL', 'gunRR', 'jackF', 'jackR', 'lolli', 'carryF', 'carryR'];
    for (const role of roles) {
      const p = new Person({ suit: team.colors.primary, helmet: team.colors.secondary });
      if (role.startsWith('gun')) p.attach(wheelGun(), 1);
      if (role === 'lolli') { p.prop = lollipop(); p.attach(p.prop, 1); }
      if (role.startsWith('carry')) { const w = spareWheel(); w.position.set(0.25, -0.35, 0); w.rotation.y = Math.PI / 2; p.attach(w, 1); p.wheel = w; }
      this.group.add(p.root);
      members.push({ role, p });
    }
    const crew = { team, box, members, state: 'idle', t: 0 };
    this.crews.set(teamId, crew);
    return crew;
  }

  // posición local respecto del box: a = a lo largo (m), b = lateral desde el carril de trabajo hacia el garaje
  place(p, s, d, faceHeading) {
    const pt = this.track.pointAt(s, d);
    p.root.position.set(pt.x, pt.y + 0.02, pt.z);
    p.root.rotation.y = -(faceHeading ?? pt.heading);
    return pt;
  }

  update(dt, t, camPos) {
    const s = this.session, tr = this.track, pit = tr.pit;
    // activar las cuadrillas de autos que llegan a su box (y siempre la del jugador)
    const isNear = e => e && e.inPit && (e.pitPhase === 'lane' || e.pitPhase === 'service' || e.pitPhase === 'release');
    for (const e of s.entrants) {
      if (isNear(e)) this.ensure(e.team.id).car = e;
      else if (e.isPlayer) this.ensure(e.team.id);
    }
    for (const crew of this.crews.values()) {
      if (!isNear(crew.car)) crew.car = null;
      const box = crew.box;
      const bp = tr.pointAt(box.s, pit.workD);
      const mine = s.player && s.player.team.id === crew.team.id;
      const visible = Math.hypot(camPos.x - bp.x, camPos.z - bp.z) < (crew.car ? 200 : mine ? 120 : 0);
      for (const m of crew.members) m.p.root.visible = visible;
      if (!visible) continue;
      const e = crew.car;
      const serving = e && e.pitPhase === 'service' && e.service;
      const arriving = e && e.pitPhase === 'lane' && tr.wrapS(box.s - e.s) < 70;
      const side = pit.side, w = pit.workD;
      const h = tr.heading[tr.idx(box.s)];
      const toLane = h + side * Math.PI / 2;
      // a = adelante (m), b = a la derecha del auto (m)
      const svc = {
        gunFL: [1.78, -0.95], gunFR: [1.78, 0.95], gunRL: [-1.72, -0.95], gunRR: [-1.72, 0.95],
        jackF: [3.6, 0], jackR: [-3.3, 0], lolli: [2.7, 1.9], carryF: [1.0, -1.8], carryR: [-2.4, -1.8],
      };
      crew.members.forEach((m, k) => {
        if (serving || arriving) {
          const [a, b] = svc[m.role];
          let face = b < 0 ? h + Math.PI / 2 : h - Math.PI / 2;
          if (m.role === 'jackF') face = h + Math.PI;
          if (m.role === 'jackR') face = h;
          const st = serving ? e.service : null;
          const k2 = st ? st.t - st.serve : -1;
          let pose = 'idle', kk = 1;
          if (m.role.startsWith('gun')) { pose = 'kneel'; kk = st && k2 > 0.2 && k2 < this.wheelDone(e, m.role) ? 1 : 0; }
          if (m.role.startsWith('jack')) { pose = 'jack'; kk = st && k2 > 0.2 && st.t < st.total - 0.3 ? 1 : 0; }
          if (m.role === 'lolli') {
            pose = 'lollipop';
            const sign = m.p.prop?.userData.sign;
            if (sign) sign.material.color.setHex(st && st.t >= st.total - 0.25 ? 0x20ff40 : 0xff2020);
          }
          if (m.role.startsWith('carry')) pose = 'carry';
          this.place(m.p, tr.wrapS(box.s + a), w - b, face);
          m.p.pose(pose, t, kk);
        } else {
          this.place(m.p, tr.wrapS(box.s + (k - 4) * 1.1), pit.garageD - side * 1.2, toLane);
          m.p.pose('idle', t + k);
        }
      });
    }
  }

  // cuándo termina cada rueda (con errores ocasionales)
  wheelDone(e, role) {
    const st = e.service;
    const idx = { gunFL: 0, gunFR: 1, gunRL: 2, gunRR: 3 }[role];
    let done = st.work - 0.45;
    if (st.problem && st.problem.wheel === idx) done = st.work - 0.2;
    return done;
  }

  wheelVisibility(e, model) {
    const st = e.service;
    const k = st.t - st.serve;
    for (let i = 0; i < 4; i++) {
      let off = 0.55, on = 1.05;
      if (st.problem && st.problem.wheel === i) on += st.problem.extra;
      model.wheels[i].spin.visible = !(k > off && k < on);
    }
    if (k > 0.8) model.setCompound(st.compound);
  }
}
