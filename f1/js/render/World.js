// Renderizador, cielo físico, luces, sombras, niebla, post-proceso (bloom, AO, SMAA),
// resolución adaptativa, partículas (humo, spray, tierra, chispas, confeti) y lluvia.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import * as TX from './textures.js';

export const QUALITY = {
  bajo: { shadows: 0, pixel: 0.7, bloom: false, smaa: false, ao: false, particles: 600, rain: 1200 },
  medio: { shadows: 1024, pixel: 0.9, bloom: true, smaa: false, ao: false, particles: 1500, rain: 2500 },
  alto: { shadows: 2048, pixel: 1, bloom: true, smaa: true, ao: false, particles: 3000, rain: 4000 },
  ultra: { shadows: 4096, pixel: 1.25, bloom: true, smaa: true, ao: true, particles: 4000, rain: 6000 },
};

export class World {
  constructor(canvas, settings) {
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    TX.setAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 9000);
    this.scene.add(this.camera);
    this.clock = new THREE.Clock();
    this.pixelScale = 1;
    this.frameTimes = [];
    this.applyQuality(settings.quality || 'alto');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.buildSky();
    this.buildLights();
    this.particles = new Particles(this.scene, this.qcfg.particles);
    this.rain = new Rain(this.scene, this.qcfg.rain);
  }

  applyQuality(q) {
    this.quality = q;
    this.qcfg = QUALITY[q] || QUALITY.alto;
    const r = this.renderer;
    r.shadowMap.enabled = this.qcfg.shadows > 0 && this.settings.shadows !== false;
    if (this.sun) {
      this.sun.castShadow = r.shadowMap.enabled;
      this.sun.shadow.mapSize.set(this.qcfg.shadows || 512, this.qcfg.shadows || 512);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this.basePixel = Math.min(window.devicePixelRatio || 1, 2) * this.qcfg.pixel;
    this.setupComposer();
    this.resize();
  }

  setupComposer() {
    const r = this.renderer;
    if (this.composer) this.composer.dispose?.();
    this.composer = new EffectComposer(r);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    const post = this.settings.post !== false;
    if (post && this.qcfg.ao) {
      this.gtao = new GTAOPass(this.scene, this.camera, 512, 512);
      this.gtao.blendIntensity = 0.7;
      this.composer.addPass(this.gtao);
    } else this.gtao = null;
    if (post && this.qcfg.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.35, 0.5, 0.88);
      this.composer.addPass(this.bloom);
    } else this.bloom = null;
    this.composer.addPass(new OutputPass());
    if (post && this.qcfg.smaa) this.composer.addPass(new SMAAPass(512, 512));
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = this.basePixel * this.pixelScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }
  }

  // resolución adaptativa: baja si el cuadro tarda demasiado
  adapt(dt) {
    if (this.settings.dynamicRes === false) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 40) return;
    const avg = this.frameTimes.reduce((a, b) => a + b) / this.frameTimes.length;
    this.frameTimes.length = 0;
    let s = this.pixelScale;
    if (avg > 1 / 40) s = Math.max(0.5, s - 0.1);
    else if (avg < 1 / 58 && s < 1) s = Math.min(1, s + 0.05);
    if (s !== this.pixelScale) { this.pixelScale = s; this.resize(); }
  }

  buildSky() {
    this.sky = new Sky();
    this.sky.scale.setScalar(8000);
    this.scene.add(this.sky);
    this.sunDir = new THREE.Vector3();
    // estrellas para la noche
    const n = 1500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.9);
      pos[i * 3] = Math.sin(ph) * Math.cos(th) * 7000; pos[i * 3 + 1] = Math.cos(ph) * 7000; pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 7000;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false }));
    this.stars.visible = false;
    this.scene.add(this.stars);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a5a3a, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4e0, 3);
    this.sun.castShadow = this.renderer.shadowMap.enabled;
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 600;
    this.sun.shadow.mapSize.set(this.qcfg.shadows || 512, this.qcfg.shadows || 512);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  // condiciones de cielo: env = meta.env, weather = { rain 0..1 }
  setAtmosphere(env, rain = 0, force = false) {
    const key = env.sky + '|' + Math.round(rain * 4);
    if (!force && key === this.atmoKey) return;
    this.atmoKey = key;
    const u = this.sky.material.uniforms;
    let elev = env.sunElev, az = env.sunAz;
    const night = env.sky === 'night';
    const overcast = env.sky === 'overcast' || rain > 0.15;
    const phi = THREE.MathUtils.degToRad(90 - Math.max(elev, -10));
    const theta = THREE.MathUtils.degToRad(az);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value = overcast ? 14 : env.sky === 'dusk' ? 6 : 4.5;
    u.rayleigh.value = overcast ? 3.2 : env.sky === 'dusk' ? 2.6 : 1.6;
    u.mieCoefficient.value = overcast ? 0.02 : 0.005;
    u.mieDirectionalG.value = 0.8;
    this.stars.visible = night;
    this.sky.visible = !night;
    let fogColor, fogDensity = env.haze || 0.0005;
    const r = this.renderer;
    if (night) {
      this.scene.background = new THREE.Color(0x0a0f1c);
      fogColor = 0x10172a;
      this.sun.color.setHex(0xf3f6ff); this.sun.intensity = 2.4;
      this.sun.position.set(0.25, 1, 0.15);
      this.hemi.color.setHex(0xb8c4e0); this.hemi.groundColor.setHex(0x4a4c50); this.hemi.intensity = 1.9;
      r.toneMappingExposure = 0.95;
      if (this.bloom) { this.bloom.strength = 0.45; this.bloom.threshold = 0.92; this.bloom.radius = 0.4; }
    } else {
      this.scene.background = null;
      fogColor = overcast ? 0xa9b2ba : env.sky === 'dusk' ? 0xe0a578 : 0xbfd4e6;
      this.sun.position.copy(this.sunDir);
      this.sun.color.setHex(env.sky === 'dusk' ? 0xffb070 : 0xfff2df);
      this.sun.intensity = overcast ? 1.2 : env.sky === 'dusk' ? 1.8 : 2.6;
      this.hemi.color.setHex(overcast ? 0xc4ccd4 : 0xcfe3ff);
      this.hemi.groundColor.setHex(0x4d5a3c);
      this.hemi.intensity = overcast ? 0.75 : env.sky === 'dusk' ? 0.45 : 0.4;
      r.toneMappingExposure = overcast ? 0.9 : env.sky === 'dusk' ? 0.8 : 0.85;
      if (this.bloom) { this.bloom.strength = env.sky === 'dusk' ? 0.55 : 0.25; this.bloom.threshold = 0.9; }
    }
    if (rain > 0.1) { fogDensity *= 1 + rain * 4; this.sun.intensity *= 1 - rain * 0.45; }
    this.scene.fog = new THREE.FogExp2(fogColor, fogDensity);
    this.fogBase = fogDensity;
    // mapa de entorno para reflejos: cielo de gradiente controlado + sol (evita sobreexposición)
    const envScene = new THREE.Scene();
    const zen = new THREE.Color(night ? 0x0a1020 : overcast ? 0x8a949e : env.sky === 'dusk' ? 0x3a4a78 : 0x3f78c4);
    const hor = new THREE.Color(night ? 0x2a3348 : overcast ? 0xb4bcc4 : env.sky === 'dusk' ? 0xf0a060 : 0xc8dcf0);
    const gnd = new THREE.Color(night ? 0x101010 : 0x4a5240);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { zen: { value: zen }, hor: { value: hor }, gnd: { value: gnd } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 zen; uniform vec3 hor; uniform vec3 gnd; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(hor, zen, pow(h, 0.6)) : mix(hor, gnd, pow(-h, 0.4)); gl_FragColor = vec4(c, 1.0); }',
    });
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
    if (!night) {
      const sunBall = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(env.sky === 'dusk' ? 0xffa060 : 0xfff2e0).multiplyScalar(overcast ? 4 : 18) }));
      sunBall.position.copy(this.sunDir).multiplyScalar(90);
      envScene.add(sunBall);
    } else {
      for (let k = 0; k < 8; k++) {
        const l = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff4e0).multiplyScalar(10) }));
        const a = (k / 8) * Math.PI * 2;
        l.position.set(Math.cos(a) * 80, 35, Math.sin(a) * 80);
        envScene.add(l);
      }
    }
    if (this.envMap) this.envMap.dispose();
    this.envMap = this.pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = night ? 0.6 : 0.85;
  }

  // la sombra sigue al foco de la cámara
  focus(x, y, z) {
    const d = this.sunDir.y > 0.05 ? this.sunDir : new THREE.Vector3(0.25, 1, 0.15).normalize();
    this.sun.position.set(x + d.x * 250, y + d.y * 250, z + d.z * 250);
    this.sun.target.position.set(x, y, z);
    this.sun.target.updateMatrixWorld();
  }

  render() {
    if (this.composer && (this.bloom || this.gtao || this.composer.passes.length > 2)) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}

// ---------------- partículas ----------------
const PVERT = `
attribute float size; attribute float alpha; attribute vec3 tint;
varying float vAlpha; varying vec3 vTint;
void main() {
  vAlpha = alpha; vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const PFRAG = `
uniform sampler2D map; varying float vAlpha; varying vec3 vTint;
void main() {
  vec4 c = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(vTint * c.rgb, c.a * vAlpha);
  if (gl_FragColor.a < 0.01) discard;
}`;

class PSystem {
  constructor(scene, max, map, additive) {
    this.max = max;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.tint = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max); this.grow = new Float32Array(max);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max); this.a0 = new Float32Array(max);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      uniforms: { map: { value: map } }, vertexShader: PVERT, fragmentShader: PFRAG,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, o) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.size[i] = o.size; this.grow[i] = o.grow || 0; this.life[i] = o.life; this.maxLife[i] = o.life;
    this.a0[i] = o.alpha ?? 1; this.alpha[i] = this.a0[i];
    this.drag[i] = o.drag ?? 1; this.grav[i] = o.grav ?? 0;
    const c = o.color || [1, 1, 1];
    this.tint[i * 3] = c[0]; this.tint[i * 3 + 1] = c[1]; this.tint[i * 3 + 2] = c[2];
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.a0[i] * Math.min(1, f * 2) * Math.min(1, (1 - f) * 8 + 0.2);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.size.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true; g.attributes.tint.needsUpdate = true;
  }
}

export class Particles {
  constructor(scene, max) {
    this.soft = new PSystem(scene, max, TX.smokePuff(), false);
    this.glow = new PSystem(scene, Math.round(max / 3), TX.radialGlow('255,200,120'), true);
  }
  smoke(x, y, z, vx, vz, amount = 1, color = [0.92, 0.92, 0.92]) {
    this.soft.emit(x + (Math.random() - 0.5) * 0.4, y + 0.2, z + (Math.random() - 0.5) * 0.4, vx * 0.3 + (Math.random() - 0.5), 0.6 + Math.random(), vz * 0.3 + (Math.random() - 0.5),
      { size: 1.2 * amount, grow: 3.5, life: 1.6 + Math.random(), alpha: 0.55, drag: 1.2, color });
  }
  spray(x, y, z, vx, vz, amount = 1) {
    this.soft.emit(x + (Math.random() - 0.5) * 1.2, y + 0.3 + Math.random() * 0.4, z + (Math.random() - 0.5) * 1.2, vx * 0.55 + (Math.random() - 0.5) * 3, 0.8 + Math.random() * 1.5, vz * 0.55 + (Math.random() - 0.5) * 3,
      { size: 1.5 * amount, grow: 5, life: 0.9 + Math.random() * 0.6, alpha: 0.3, drag: 2.2, color: [0.85, 0.88, 0.92] });
  }
  dust(x, y, z, vx, vz, color = [0.65, 0.55, 0.4]) {
    this.soft.emit(x, y + 0.1, z, vx * 0.2 + (Math.random() - 0.5) * 2, 1 + Math.random() * 2, vz * 0.2 + (Math.random() - 0.5) * 2,
      { size: 1.0, grow: 3, life: 1.2 + Math.random(), alpha: 0.5, drag: 1.5, color });
  }
  sparks(x, y, z, vx, vz) {
    for (let k = 0; k < 3; k++) this.glow.emit(x, y + 0.05, z, vx * 0.7 + (Math.random() - 0.5) * 6, 1 + Math.random() * 3, vz * 0.7 + (Math.random() - 0.5) * 6,
      { size: 0.22, life: 0.25 + Math.random() * 0.25, alpha: 1, drag: 0.5, grav: 9.8, color: [1, 0.8, 0.5] });
  }
  confetti(x, y, z) {
    const cols = [[1, 0.2, 0.2], [1, 0.85, 0.1], [0.2, 0.6, 1], [1, 1, 1], [0.2, 1, 0.4]];
    this.soft.emit(x + (Math.random() - 0.5) * 6, y, z + (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 2, -1 - Math.random(), (Math.random() - 0.5) * 2,
      { size: 0.25, life: 4, alpha: 1, drag: 0.8, grav: 0.4, color: cols[Math.floor(Math.random() * cols.length)] });
  }
  update(dt) { this.soft.update(dt); this.glow.update(dt); }
}

// ---------------- lluvia ----------------
class Rain {
  constructor(scene, max) {
    this.max = max;
    const pos = new Float32Array(max * 6);
    this.offsets = new Float32Array(max * 3);
    for (let i = 0; i < max; i++) {
      this.offsets[i * 3] = (Math.random() - 0.5) * 60;
      this.offsets[i * 3 + 1] = Math.random() * 30;
      this.offsets[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaab4c0, transparent: true, opacity: 0.45, depthWrite: false }));
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    scene.add(this.lines);
    this.intensity = 0;
  }
  update(dt, cam, intensity) {
    this.intensity = intensity;
    this.lines.visible = intensity > 0.02;
    if (!this.lines.visible) return;
    const n = Math.floor(this.max * Math.min(1, intensity * 1.2));
    this.lines.geometry.setDrawRange(0, n * 2);
    const pos = this.lines.geometry.attributes.position.array;
    const fall = 26 * dt;
    for (let i = 0; i < n; i++) {
      let y = this.offsets[i * 3 + 1] - fall;
      if (y < -2) y += 30;
      this.offsets[i * 3 + 1] = y;
      const x = cam.x + this.offsets[i * 3], z = cam.z + this.offsets[i * 3 + 2], yy = cam.y - 8 + y;
      pos[i * 6] = x; pos[i * 6 + 1] = yy; pos[i * 6 + 2] = z;
      pos[i * 6 + 3] = x + 0.08; pos[i * 6 + 4] = yy - 0.7; pos[i * 6 + 5] = z;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.material.opacity = 0.25 + intensity * 0.35;
  }
}
