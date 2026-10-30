import * as THREE from 'three';
import { MOLECULES } from '@/features/lab/sims/Molecules';
import type { Preset3D } from './types';

// Escenas 3D reutilizables para videos. Todas son determinísticas en función
// del tiempo t (mismo resultado en vista previa y en la exportación).

export interface Scene3D {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  update: (t: number, dur: number, camMode: string) => void;
  dispose: () => void;
}

function rand(i: number) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function base(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene();
  scene.background = null;
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const d = new THREE.DirectionalLight(0xffffff, 1.6);
  d.position.set(5, 8, 6);
  scene.add(d);
  const p = new THREE.PointLight(0x8b5cf6, 40);
  p.position.set(-6, 4, -4);
  scene.add(p);
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
  return { scene, camera };
}

function orbitCam(camera: THREE.PerspectiveCamera, t: number, mode: string, r: number, h: number, target = new THREE.Vector3(0, 0.8, 0)) {
  const a = mode === 'orbit' ? 0.6 + t * 0.25 : mode === 'pan' ? 0.3 + t * 0.08 : 0.6;
  const rr = mode === 'push' ? r * (1 - Math.min(0.25, t * 0.03)) : r;
  camera.position.set(Math.sin(a) * rr, h, Math.cos(a) * rr);
  camera.lookAt(target);
}

const mat = (c: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, ...extra });

export function createScene3D(preset: Preset3D, params: Record<string, number | string> = {}): Scene3D {
  const { scene, camera } = base();
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  let update: Scene3D['update'] = () => {};

  if (preset === 'magnetic-separation') {
    const belt = new THREE.Mesh(track(new THREE.BoxGeometry(7, 0.4, 1.8)), track(mat('#1f2937')));
    belt.position.set(-1, 0, 0);
    scene.add(belt);
    const drum = new THREE.Mesh(track(new THREE.CylinderGeometry(0.6, 0.6, 1.9, 32)), track(mat('#b91c1c', { emissive: '#7f1d1d', emissiveIntensity: 0.4, metalness: 0.6 })));
    drum.rotation.x = Math.PI / 2;
    drum.position.set(2.5, -0.1, 0);
    scene.add(drum);
    const binB = new THREE.Mesh(track(new THREE.BoxGeometry(1.2, 0.8, 2)), track(mat('#3d5bff', { transparent: true, opacity: 0.6 })));
    binB.position.set(2.0, -2.5, 0);
    const binA = new THREE.Mesh(track(new THREE.BoxGeometry(1.8, 0.8, 2)), track(mat('#12a58a', { transparent: true, opacity: 0.6 })));
    binA.position.set(4.2, -2.5, 0);
    scene.add(binA, binB);
    const N = 90;
    const geo = track(new THREE.IcosahedronGeometry(0.13, 0));
    const inst = new THREE.InstancedMesh(geo, track(new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.4 })), N);
    const kinds = Array.from({ length: N }, (_, i) => (rand(i) < 0.45 ? 0 : rand(i + 99) < 0.5 ? 1 : 2));
    const cols = [new THREE.Color('#9ca3af'), new THREE.Color('#f97316'), new THREE.Color('#e2e8f0')];
    kinds.forEach((k, i) => inst.setColorAt(i, cols[k]));
    scene.add(inst);
    const dummy = new THREE.Object3D();
    const v = 1.3;
    update = (t, _d, cam) => {
      drum.rotation.y = 0;
      drum.rotateOnAxis(new THREE.Vector3(0, 1, 0), -t * 2);
      for (let i = 0; i < N; i++) {
        const t0 = i * 0.22;
        const age = t - t0;
        const z = (rand(i + 7) - 0.5) * 1.3;
        let x = -4.5;
        let y = 0.32;
        let s = age < 0 ? 0 : 1;
        const tBelt = 7 / v;
        if (age >= 0 && age < tBelt) x = -4.5 + age * v;
        else if (age >= tBelt) {
          const tt = age - tBelt;
          if (kinds[i] === 0) {
            const ang = Math.min(Math.PI * 0.85, (tt * v) / 0.6);
            x = 2.5 + Math.sin(ang) * 0.72;
            y = -0.1 + Math.cos(ang) * 0.72;
            if (ang >= Math.PI * 0.85) {
              const t2 = tt - (Math.PI * 0.85 * 0.6) / v;
              x = 2.5 + Math.sin(Math.PI * 0.85) * 0.72 - t2 * 0.5;
              y = -0.1 + Math.cos(Math.PI * 0.85) * 0.72 - 2.5 * t2 * t2;
            }
          } else {
            x = 2.5 + tt * v * 1.1;
            y = 0.32 - 4.9 * tt * tt * 0.6;
          }
          if (y < -2.3) s = 0;
        }
        dummy.position.set(x, y, z);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      orbitCam(camera, t, cam, 9, 3.2, new THREE.Vector3(0.8, -0.6, 0));
    };
  } else if (preset === 'molecule') {
    const norm = (v: string) => v.replace(/[₀-₉]/g, (d) => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(d))).toUpperCase().trim();
    const name = norm(String(params.molecule ?? 'H2O'));
    const m = MOLECULES.find((x) => norm(x.formula) === name || norm(x.name) === name) ?? MOLECULES[0];
    const CPK: Record<string, [string, number]> = { H: ['#f1f5f9', 0.3], C: ['#3f3f46', 0.48], O: ['#ef4444', 0.45], N: ['#3b82f6', 0.45], Na: ['#a855f7', 0.5], Cl: ['#22c55e', 0.55] };
    const g = new THREE.Group();
    const pos = m.atoms.map(([, x, y, z]) => new THREE.Vector3(x * 1.7, y * 1.7, z * 1.7));
    m.atoms.forEach(([el], i) => {
      const s = new THREE.Mesh(track(new THREE.SphereGeometry(CPK[el][1], 32, 32)), track(mat(CPK[el][0])));
      s.position.copy(pos[i]);
      g.add(s);
    });
    for (const [a, b] of m.bonds) {
      const dir = pos[b].clone().sub(pos[a]);
      const c = new THREE.Mesh(track(new THREE.CylinderGeometry(0.08, 0.08, dir.length(), 12)), track(mat('#cbd5e1')));
      c.position.copy(pos[a].clone().add(pos[b]).multiplyScalar(0.5));
      c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      g.add(c);
    }
    g.position.y = 0.8;
    scene.add(g);
    update = (t, _d, cam) => {
      g.rotation.y = t * 0.6;
      g.rotation.x = Math.sin(t * 0.4) * 0.2;
      orbitCam(camera, t, cam === 'orbit' ? 'static' : cam, 7, 2.2);
    };
  } else if (preset === 'orbits') {
    const sun = new THREE.Mesh(track(new THREE.SphereGeometry(0.8, 48, 48)), track(new THREE.MeshBasicMaterial({ color: '#ffcf5c' })));
    scene.add(sun);
    const light = new THREE.PointLight(0xfff4d6, 300, 0, 1.6);
    scene.add(light);
    const planets = [
      { d: 1.8, T: 0.88, r: 0.12, c: '#a8a29e' },
      { d: 2.7, T: 2.25, r: 0.2, c: '#fcd34d' },
      { d: 3.7, T: 3.65, r: 0.22, c: '#3b82f6' },
      { d: 4.8, T: 6.87, r: 0.16, c: '#ef4444' },
    ].map((p) => {
      const mesh = new THREE.Mesh(track(new THREE.SphereGeometry(p.r, 32, 32)), track(mat(p.c, { roughness: 0.8 })));
      scene.add(mesh);
      const ring = new THREE.Mesh(track(new THREE.RingGeometry(p.d - 0.01, p.d + 0.01, 128)), track(new THREE.MeshBasicMaterial({ color: '#c7c2ff', transparent: true, opacity: 0.3, side: THREE.DoubleSide })));
      ring.rotation.x = -Math.PI / 2;
      scene.add(ring);
      return { ...p, mesh };
    });
    update = (t, _d, cam) => {
      for (const p of planets) {
        const a = (t / p.T) * Math.PI * 2 * 0.6;
        p.mesh.position.set(Math.cos(a) * p.d, 0, -Math.sin(a) * p.d);
      }
      orbitCam(camera, t, cam, 10, 5, new THREE.Vector3(0, 0, 0));
    };
  } else if (preset === 'diffusion') {
    const box = new THREE.Mesh(track(new THREE.BoxGeometry(6, 3, 3)), track(new THREE.MeshStandardMaterial({ color: '#60a5fa', transparent: true, opacity: 0.08 })));
    box.position.y = 1;
    scene.add(box);
    const wall = new THREE.Mesh(track(new THREE.BoxGeometry(0.06, 3, 3)), track(mat('#94a3b8', { transparent: true, opacity: 0.5 })));
    wall.position.y = 1;
    scene.add(wall);
    const N = 160;
    const inst = new THREE.InstancedMesh(track(new THREE.SphereGeometry(0.07, 10, 10)), track(new THREE.MeshStandardMaterial({ roughness: 0.3 })), N);
    for (let i = 0; i < N; i++) inst.setColorAt(i, new THREE.Color(i < N / 2 ? '#f43f5e' : '#22d3ee'));
    scene.add(inst);
    const dummy = new THREE.Object3D();
    update = (t, _d, cam) => {
      const open = t > 1.2;
      wall.scale.y = open ? Math.max(0.001, 1 - (t - 1.2) * 1.5) : 1;
      for (let i = 0; i < N; i++) {
        const side = i < N / 2 ? -1 : 1;
        const spread = open ? Math.min(1, (t - 1.2) / 6) : 0;
        const base = side * (0.3 + rand(i) * 2.6);
        const mixed = (rand(i + 500) - 0.5) * 5.8;
        const x = base * (1 - spread) + mixed * spread + Math.sin(t * 3 + i) * 0.08;
        dummy.position.set(Math.max(-2.9, Math.min(2.9, x)), 1 + (rand(i + 1) - 0.5) * 2.6 + Math.cos(t * 2.7 + i * 3) * 0.08, (rand(i + 2) - 0.5) * 2.6);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      orbitCam(camera, t, cam, 8, 3, new THREE.Vector3(0, 1, 0));
    };
  } else if (preset === 'wave') {
    const N = 60;
    const A = Number(params.amplitude ?? 0.8);
    const f = Number(params.frequency ?? 0.6);
    const balls = Array.from({ length: N }, (_, i) => {
      const s = new THREE.Mesh(track(new THREE.SphereGeometry(0.09, 12, 12)), track(mat(i % 10 === 0 ? '#ffd166' : '#5fdcff')));
      s.position.x = -6 + (i * 12) / N;
      scene.add(s);
      return s;
    });
    update = (t, _d, cam) => {
      balls.forEach((b, i) => (b.position.y = 1 + A * Math.sin(((i * 12) / N) * 1.1 - t * f * Math.PI * 2)));
      orbitCam(camera, t, cam === 'orbit' ? 'pan' : cam, 10, 2.5, new THREE.Vector3(0, 1, 0));
    };
  } else if (preset === 'cell') {
    const g = new THREE.Group();
    const membrane = new THREE.Mesh(track(new THREE.SphereGeometry(2.4, 48, 48)), track(new THREE.MeshStandardMaterial({ color: '#60a5fa', transparent: true, opacity: 0.16 })));
    membrane.scale.set(1.2, 0.9, 0.9);
    const nucleus = new THREE.Mesh(track(new THREE.SphereGeometry(0.7, 32, 32)), track(mat('#8b5cf6')));
    nucleus.position.set(-0.4, 0.2, 0);
    g.add(membrane, nucleus);
    for (let i = 0; i < 4; i++) {
      const mito = new THREE.Mesh(track(new THREE.CapsuleGeometry(0.16, 0.5, 6, 12)), track(mat('#f97316')));
      mito.position.set(Math.cos(i * 1.7) * 1.5, Math.sin(i * 2.1) * 0.8, Math.sin(i * 1.3) * 0.7);
      mito.rotation.set(i, i * 0.7, 0.5);
      g.add(mito);
    }
    g.position.y = 1;
    scene.add(g);
    update = (t, _d, cam) => {
      g.rotation.y = t * 0.35;
      orbitCam(camera, t, cam === 'orbit' ? 'static' : cam, 7.5, 2.5, new THREE.Vector3(0, 1, 0));
    };
  } else if (preset === 'projectile') {
    const v0 = Number(params.v0 ?? 14);
    const ang = (Number(params.angle ?? 50) * Math.PI) / 180;
    const g = 9.81;
    const T = (2 * v0 * Math.sin(ang)) / g;
    const R = v0 * Math.cos(ang) * T;
    const k = 9 / Math.max(R, 1);
    const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(16, 6)), track(mat('#14213d')));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const ball = new THREE.Mesh(track(new THREE.SphereGeometry(0.18, 24, 24)), track(mat('#ff8a3d', { emissive: '#ff6a00', emissiveIntensity: 0.4 })));
    scene.add(ball);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 60; i++) {
      const tt = (T * i) / 60;
      pts.push(new THREE.Vector3(-4.5 + v0 * Math.cos(ang) * tt * k, (v0 * Math.sin(ang) * tt - 0.5 * g * tt * tt) * k, 0));
    }
    const lineGeo = track(new THREE.BufferGeometry().setFromPoints(pts));
    const line = new THREE.Line(lineGeo, track(new THREE.LineDashedMaterial({ color: '#5fdcff', dashSize: 0.2, gapSize: 0.12 })));
    line.computeLineDistances();
    scene.add(line);
    update = (t, _d, cam) => {
      const tt = (t * 0.7) % (T + 0.6);
      const c = Math.min(tt, T);
      ball.position.set(-4.5 + v0 * Math.cos(ang) * c * k, Math.max(0.18, (v0 * Math.sin(ang) * c - 0.5 * g * c * c) * k + 0.18), 0);
      orbitCam(camera, t, cam === 'orbit' ? 'static' : cam, 10, 3, new THREE.Vector3(0, 1.5, 0));
    };
  } else {
    // surface
    const geo = track(new THREE.PlaneGeometry(8, 8, 70, 70));
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geo, track(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6 })));
    scene.add(mesh);
    const c = new THREE.Color();
    update = (t, _d, cam) => {
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const y = Math.sin(x * 0.9 + t * 0.8) * Math.cos(z * 0.9) * 1.2;
        pos.setY(i, y);
        c.setHSL(0.62 - (y + 1.2) * 0.2, 0.8, 0.55);
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
      pos.needsUpdate = true;
      (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      geo.computeVertexNormals();
      orbitCam(camera, t, cam, 10, 6, new THREE.Vector3(0, 0, 0));
    };
  }
  return {
    scene,
    camera,
    update,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}
