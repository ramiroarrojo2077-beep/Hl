// Escenas fuera de pista: garaje del menú principal (auto en caballetes con mecánicos
// trabajando, luces de estudio) y la ceremonia del podio con confeti y champán.

import * as THREE from 'three';
import { CarModel } from './CarModel.js';
import { Person, wheelGun, spareWheel, solid } from './People.js';
import * as TX from './textures.js';

export class GarageScene {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.t = 0;
    this.build();
  }

  build() {
    const g = this.group;
    // piso epóxico brillante
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), new THREE.MeshStandardMaterial({ color: 0x5c6068, roughness: 0.18, metalness: 0.25 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    g.add(floor);
    // líneas del box
    const lineM = new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 0.5 });
    for (const z of [-3.2, 3.2]) { const l = new THREE.Mesh(new THREE.PlaneGeometry(9, 0.12), lineM); l.rotation.x = -Math.PI / 2; l.position.set(0, 0.005, z); g.add(l); }
    // paredes
    this.wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.7 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(40, 9), this.wallMat);
    back.position.set(-9, 4.5, 0); back.rotation.y = Math.PI / 2;
    g.add(back);
    for (const z of [-8, 8]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(30, 9), this.wallMat); w.position.set(5, 4.5, z); w.rotation.y = z < 0 ? 0 : Math.PI; g.add(w); }
    // paneles de color del equipo
    this.panelMat = new THREE.MeshStandardMaterial({ color: 0xe10600, emissive: 0xe10600, emissiveIntensity: 0.25, roughness: 0.5 });
    for (const z of [-5, 0, 5]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(4, 6), this.panelMat); p.position.set(-8.95, 3.6, z); p.rotation.y = Math.PI / 2; g.add(p); }
    this.board = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.board.position.set(-8.9, 7.4, 0); this.board.rotation.y = Math.PI / 2;
    g.add(this.board);
    // techo con luces
    for (let x = -6; x <= 8; x += 3.5) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      lamp.position.set(x, 8.5, 0);
      g.add(lamp);
    }
    const key = new THREE.SpotLight(0xffffff, 380, 30, 0.75, 0.5, 1.4);
    key.position.set(3, 8, 4); key.target.position.set(0, 0.5, 0);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    g.add(key, key.target);
    const fill = new THREE.PointLight(0xaaccff, 40, 25); fill.position.set(-4, 5, -5); g.add(fill);
    const rim = new THREE.PointLight(0xffd0b0, 40, 25); rim.position.set(6, 3, -6); g.add(rim);
    // carros de herramientas y neumáticos
    const cart = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1, 0.6), solid(0xc8102e, 0.4, 0.4));
    cart.position.set(-6, 0.5, -5.5); cart.castShadow = true; g.add(cart);
    for (let k = 0; k < 4; k++) for (let h = 0; h < 4; h++) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.33, 18), new THREE.MeshStandardMaterial({ map: TX.tyreTread(['#e8352c', '#f5d10a', '#f2f2f2', '#33b249'][k]), roughness: 0.9 }));
      t.position.set(-7.2 + k * 0.85, 0.17 + h * 0.34, 5.6);
      t.castShadow = true;
      g.add(t);
    }
    // caballetes
    for (const x of [1.78, -1.72]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 1.8), solid(0x333333, 0.4, 0.7)); st.position.set(x, 0.06, 0); g.add(st); }
    // mecánicos
    this.crew = [];
    const roles = [['kneel', 1.78, -1.35, Math.PI / 2], ['kneel', -1.72, 1.35, -Math.PI / 2], ['carry', 4.5, -2.4, Math.PI], ['idle', -4, 2.5, 0.5], ['photo', 3.2, 2.4, -2.4]];
    for (const [pose, x, z, ry] of roles) {
      const p = new Person({ suit: 0xe10600, helmet: pose === 'kneel' ? 0xffffff : null, cap: pose !== 'kneel' ? 0x111111 : null });
      if (pose === 'kneel') p.attach(wheelGun(), 1);
      if (pose === 'carry') { const w = spareWheel(0xe8352c); w.position.set(0.25, -0.35, 0); w.rotation.y = Math.PI / 2; p.attach(w, 1); }
      p.root.position.set(x, 0, z); p.root.rotation.y = ry;
      p.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
      g.add(p.root);
      this.crew.push({ p, pose });
    }
  }

  setTeam(team, driver) {
    if (this.car) { this.group.remove(this.car.root); }
    this.car = new CarModel(team, driver);
    this.car.root.position.set(0, 0.04, 0);
    this.car.update({ x: 0, y: 0.04, z: 0, heading: -0.35, pitch: 0, roll: 0, steer: 0.12, wheelRot: 0, compound: 'soft', drs: false }, 0.016, 0);
    this.group.add(this.car.root);
    this.panelMat.color.setHex(team.colors.primary); this.panelMat.emissive.setHex(team.colors.primary);
    const hx = n => '#' + n.toString(16).padStart(6, '0');
    this.board.material.map = TX.textBoard(team.name.toUpperCase(), hx(team.colors.primary), hx(team.colors.secondary), 1024, 160);
    this.board.material.needsUpdate = true;
    for (const c of this.crew) {
      c.p.root.traverse(o => { if (o.isMesh && o.material && o.material.color && o.material.color.getHex() === 0xe10600) { /* traje */ } });
    }
  }

  enter() {
    const w = this.world;
    w.scene.add(this.group);
    w.sky.visible = false; w.stars.visible = false;
    w.scene.background = new THREE.Color(0x07080b);
    w.scene.fog = null;
    w.sun.intensity = 0.4; w.sun.position.set(5, 10, 5); w.sun.target.position.set(0, 0, 0);
    w.hemi.intensity = 0.4;
    w.renderer.toneMappingExposure = 1.0;
    // entorno de estudio para reflejos
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x111318);
    for (let k = 0; k < 6; k++) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      panel.position.set(-9 + k * 3.5, 8, 0); panel.rotation.x = Math.PI / 2;
      env.add(panel);
    }
    const side = new THREE.Mesh(new THREE.PlaneGeometry(20, 4), new THREE.MeshBasicMaterial({ color: 0x884444 }));
    side.position.set(0, 3, -9); env.add(side);
    w.scene.environment = w.pmrem.fromScene(env, 0.02).texture;
    w.scene.environmentIntensity = 1;
    this.active = true;
  }

  exit() { this.world.scene.remove(this.group); this.active = false; }

  update(dt) {
    this.t += dt;
    const cam = this.world.camera;
    const a = this.t * 0.08 + 0.6;
    cam.position.set(Math.cos(a) * 7.5, 2.1 + Math.sin(this.t * 0.2) * 0.3, Math.sin(a) * 7.5);
    cam.lookAt(0.3, 0.55, 0);
    if (cam.fov !== 45) { cam.fov = 45; cam.updateProjectionMatrix(); }
    for (const c of this.crew) c.p.pose(c.pose, this.t, 1);
  }
}

export class PodiumScene {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.t = 0;
  }

  build(top3, trackScene) {
    const g = this.group;
    g.clear();
    const tr = trackScene.track, pit = tr.pit;
    // ubicar el podio frente al edificio de boxes
    const s = tr.wrapS(pit.sIn + pit.length * 0.5);
    const p = tr.pointAt(s, pit.garageD + pit.side * 2);
    this.origin = new THREE.Vector3(p.x, p.y + 11.5, p.z);
    this.heading = p.heading;
    const base = new THREE.Group();
    base.position.copy(this.origin);
    base.rotation.y = -p.heading + (pit.side > 0 ? 0 : Math.PI);
    g.add(base);
    const mat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.4, metalness: 0.4 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(14, 0.4, 7), mat);
    deck.position.y = -0.2; base.add(deck);
    const hs = [1.2, 0.85, 0.6];
    const xs = [0, -2.2, 2.2];
    for (let k = 0; k < 3; k++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(2, hs[k], 1.6), new THREE.MeshStandardMaterial({ color: 0xe10600, roughness: 0.35, metalness: 0.3 }));
      step.position.set(xs[k], hs[k] / 2, 0); base.add(step);
      const num = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ map: TX.numberDecal(k + 1), transparent: true }));
      num.position.set(xs[k], hs[k] / 2, 0.81); base.add(num);
      const e = top3[k];
      if (!e) continue;
      const person = new Person({ suit: e.team.colors.primary, cap: e.team.colors.secondary });
      person.root.position.set(xs[k], hs[k], 0);
      person.root.rotation.y = -Math.PI / 2;
      base.add(person.root);
      this['p' + k] = person;
    }
    const back = new THREE.Mesh(new THREE.PlaneGeometry(14, 5), new THREE.MeshBasicMaterial({ map: TX.textBoard(tr.meta.gp.toUpperCase(), '#0b0d12', '#ffffff', 1024, 256, '#e10600') }));
    back.position.set(0, 2.5, -1.5); base.add(back);
    this.base = base;
    this.sprayT = 0;
  }

  enter() { this.world.scene.add(this.group); this.t = 0; }
  exit() { this.world.scene.remove(this.group); }

  update(dt) {
    this.t += dt;
    const cam = this.world.camera;
    const o = this.origin;
    const a = -this.heading + Math.sin(this.t * 0.15) * 0.4;
    const fwd = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.base.rotation.y);
    cam.position.copy(o).addScaledVector(fwd, 11 - Math.min(3, this.t * 0.3)).add(new THREE.Vector3(Math.sin(a) * 2, 2.2, Math.cos(a) * 2));
    cam.lookAt(o.x, o.y + 1.6, o.z);
    if (cam.fov !== 50) { cam.fov = 50; cam.updateProjectionMatrix(); }
    for (let k = 0; k < 3; k++) if (this['p' + k]) this['p' + k].pose('cheer', this.t + k, 1);
    const parts = this.world.particles;
    if (Math.random() < dt * 25) parts.confetti(o.x, o.y + 8, o.z);
    // champán desde el ganador
    if (this.t > 2) {
      const w = new THREE.Vector3(0, 2.1, 0).applyMatrix4(this.base.matrixWorld);
      for (let k = 0; k < 2; k++) parts.soft.emit(w.x, w.y, w.z, (Math.random() - 0.5) * 3 + fwd.x * 5, 3 + Math.random() * 2, (Math.random() - 0.5) * 3 + fwd.z * 5, { size: 0.3, life: 1.2, alpha: 0.8, drag: 0.5, grav: 6, color: [1, 0.95, 0.75] });
    }
  }
}
