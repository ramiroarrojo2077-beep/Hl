import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName } from '@pixiv/three-vrm';
import { CHARACTERS, type Gesture } from './store';
import { currentCharIndex, useVoice } from '@/voice/bus';

// Controlador del profesor 3D sobre modelos riggeados (VRM con huesos
// humanoides y expresiones, o GLB con clips de animación). Anima: respiración,
// parpadeo, mirada, gestos explicativos y sincronización labial aproximada
// a partir del texto que se está leyendo (o del volumen real del audio).

export type CharacterId = keyof typeof CHARACTERS;

const cache = new Map<string, Promise<GLTF>>();

function load(url: string): Promise<GLTF> {
  if (!cache.has(url)) {
    const loader = new GLTFLoader();
    loader.register((p) => new VRMLoaderPlugin(p));
    cache.set(url, loader.loadAsync(url).catch((e) => {
      cache.delete(url);
      throw e;
    }));
  }
  return cache.get(url)!;
}

const VOWELS: Record<string, 'aa' | 'ee' | 'ih' | 'oh' | 'ou'> = { a: 'aa', á: 'aa', e: 'ee', é: 'ee', i: 'ih', í: 'ih', y: 'ih', o: 'oh', ó: 'oh', u: 'ou', ú: 'ou', ü: 'ou' };
const CLOSED = new Set(['m', 'b', 'p', ' ', ',', '.', 'f', 'v']);

interface ActiveGesture {
  type: Gesture;
  start: number;
  dur: number;
}

const GESTURE_DUR: Record<Gesture, number> = { explain: 2.4, point: 2.6, nod: 1.1, wave: 2.2, think: 3, shake: 1.2 };

function env(t: number, dur: number) {
  // sube rápido, mantiene, baja suave
  if (t < 0 || t > dur) return 0;
  const a = Math.min(1, t / 0.35);
  const r = Math.min(1, (dur - t) / 0.5);
  return Math.min(a, r) * (0.5 - 0.5 * Math.cos(Math.PI * Math.min(a, r)));
}

export class AvatarController {
  root = new THREE.Group();
  vrm: VRM | null = null;
  mixer: THREE.AnimationMixer | null = null;
  actions: Record<string, THREE.AnimationAction> = {};
  headBone: THREE.Object3D | null = null;
  ready = false;
  private gesture: ActiveGesture | null = null;
  private nextBlink = 1.5;
  private blinkT = -1;
  private mouth = { aa: 0, ee: 0, ih: 0, oh: 0, ou: 0 };
  private lookTarget = new THREE.Object3D();
  private time = 0;
  private lastTalkGesture = 0;
  mood: 'neutral' | 'happy' | 'thinking' | 'surprised' = 'neutral';
  height = 1.5;

  constructor(public character: CharacterId) {}

  async init(camera: THREE.Camera) {
    const def = CHARACTERS[this.character];
    const url = new URL(def.file, document.baseURI).href;
    const gltf = await load(url);
    const scene = gltf.scene;
    if (def.kind === 'vrm') {
      const vrm = gltf.userData.vrm as VRM;
      VRMUtils.rotateVRM0(vrm);
      vrm.scene.traverse((o) => {
        if (/robo_arm/i.test(o.name)) o.visible = false;
        o.frustumCulled = false;
      });
      this.vrm = vrm;
      camera.add(this.lookTarget);
      if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;
      this.restPose();
      vrm.update(0);
      const head = vrm.humanoid.getNormalizedBoneNode('head');
      const p = new THREE.Vector3();
      head?.getWorldPosition(p);
      this.height = p.y || 1.4;
    } else {
      this.mixer = new THREE.AnimationMixer(scene);
      for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
      this.actions.Idle?.play();
      scene.traverse((o) => {
        if (!this.headBone && /head/i.test(o.name) && (o as THREE.Bone).isBone) this.headBone = o;
      });
      scene.scale.setScalar(0.42);
      this.height = 1.65;
    }
    this.root.add(scene);
    this.ready = true;
  }

  private bone(n: VRMHumanBoneName) {
    return this.vrm?.humanoid.getNormalizedBoneNode(n) ?? null;
  }

  private restPose() {
    const set = (n: VRMHumanBoneName, x: number, y: number, z: number) => this.bone(n)?.rotation.set(x, y, z);
    set('leftUpperArm', 0, -0.12, -1.22);
    set('rightUpperArm', 0, 0.12, 1.22);
    set('leftLowerArm', 0, -0.28, 0);
    set('rightLowerArm', 0, 0.28, 0);
    set('leftHand', 0, 0, -0.1);
    set('rightHand', 0, 0, 0.1);
  }

  playGesture(type: Gesture) {
    if (this.mixer) {
      const map: Record<Gesture, string> = { explain: 'Yes', point: 'ThumbsUp', nod: 'Yes', wave: 'Wave', think: 'No', shake: 'No' };
      const a = this.actions[map[type]];
      if (a) {
        a.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.25).play();
        a.clampWhenFinished = false;
        setTimeout(() => a.fadeOut(0.4), (a.getClip().duration - 0.4) * 1000);
      }
      return;
    }
    this.gesture = { type, start: this.time, dur: GESTURE_DUR[type] };
  }

  update(dt: number) {
    if (!this.ready) return;
    this.time += dt;
    const t = this.time;
    const voice = useVoice.getState();
    const speaking = voice.state === 'speaking' && !!voice.utterance;

    if (this.mixer) {
      this.mixer.update(dt);
      if (this.headBone && speaking) this.headBone.rotation.x += Math.sin(t * 9) * 0.015;
      return;
    }
    const vrm = this.vrm!;
    this.restPose();
    // Respiración y balanceo
    const chest = this.bone('chest') ?? this.bone('spine');
    const spine = this.bone('spine');
    if (chest) chest.rotation.x = Math.sin(t * 1.6) * 0.018;
    if (spine) {
      spine.rotation.y = Math.sin(t * 0.5) * 0.04;
      spine.rotation.z = Math.sin(t * 0.37) * 0.015;
    }
    const neck = this.bone('neck');
    const head = this.bone('head');
    if (head) {
      head.rotation.y = Math.sin(t * 0.7) * 0.05;
      head.rotation.x = Math.sin(t * 0.9) * 0.02 + (speaking ? Math.sin(t * 5.3) * 0.025 : 0);
    }
    this.lookTarget.position.set(Math.sin(t * 0.3) * 0.1, Math.sin(t * 0.4) * 0.05, 0);

    // Gestos automáticos al hablar
    if (speaking && t - this.lastTalkGesture > 5.5 && !this.gesture) {
      this.lastTalkGesture = t;
      this.playGesture(Math.random() < 0.6 ? 'explain' : 'nod');
    }
    const g = this.gesture;
    if (g) {
      const k = env(t - g.start, g.dur);
      const ru = this.bone('rightUpperArm');
      const rl = this.bone('rightLowerArm');
      const lu = this.bone('leftUpperArm');
      const ll = this.bone('leftLowerArm');
      const rh = this.bone('rightHand');
      switch (g.type) {
        case 'explain':
          if (ru) ru.rotation.set(0, 0.12 + 0.6 * k, 1.22 - 0.25 * k);
          if (rl) rl.rotation.set(0, 0.28 + 1.0 * k, -0.4 * k);
          if (lu) lu.rotation.set(0, -0.12 - 0.45 * k, -1.22 + 0.15 * k);
          if (ll) ll.rotation.set(0, -0.28 - 0.9 * k, 0.35 * k);
          if (rh) rh.rotation.x = -0.6 * k;
          break;
        case 'point':
          if (ru) ru.rotation.set(0, 0.12 + 0.75 * k, 1.22 - 0.95 * k);
          if (rl) rl.rotation.set(0, 0.28 + 0.25 * k, 0);
          if (rh) rh.rotation.set(-0.4 * k, 0, 0.1);
          if (head) head.rotation.y += 0.35 * k;
          break;
        case 'nod':
          if (head) head.rotation.x += Math.sin((t - g.start) * 11) * 0.12 * k;
          break;
        case 'shake':
          if (head) head.rotation.y += Math.sin((t - g.start) * 12) * 0.15 * k;
          break;
        case 'wave':
          if (ru) ru.rotation.set(0, 0.2, 1.22 - 2.2 * k);
          if (rl) rl.rotation.set(0, 0.2, -0.6 * k + Math.sin((t - g.start) * 9) * 0.35 * k);
          break;
        case 'think':
          if (ru) ru.rotation.set(0, 0.12 + 0.9 * k, 1.22 - 0.1 * k);
          if (rl) rl.rotation.set(0, 0.28 + 2.1 * k, -0.2 * k);
          if (head) head.rotation.z += 0.12 * k;
          break;
      }
      if (neck && g.type === 'point') neck.rotation.y = 0.15 * k;
      if (t - g.start > g.dur) this.gesture = null;
    }

    // Parpadeo
    const em = vrm.expressionManager;
    if (em) {
      if (this.blinkT < 0 && t > this.nextBlink) this.blinkT = 0;
      let blink = 0;
      if (this.blinkT >= 0) {
        this.blinkT += dt;
        blink = Math.sin(Math.min(1, this.blinkT / 0.16) * Math.PI);
        if (this.blinkT > 0.16) {
          this.blinkT = -1;
          this.nextBlink = t + 2 + Math.random() * 4;
        }
      }
      em.setValue('blink', blink);
      em.setValue('happy', this.mood === 'happy' ? 0.35 : 0);
      em.setValue('surprised', this.mood === 'surprised' ? 0.4 : 0);
      em.setValue('relaxed', this.mood === 'neutral' ? 0.12 : 0);

      // Boca: vocal del carácter que se está pronunciando (estimado) o volumen real
      const target = { aa: 0, ee: 0, ih: 0, oh: 0, ou: 0 };
      if (speaking) {
        const u = voice.utterance!;
        const idx = Math.floor(currentCharIndex());
        const ch = (u.text[idx] ?? ' ').toLowerCase();
        const open = voice.level !== null ? Math.min(1, voice.level * 1.4) : CLOSED.has(ch) ? 0.05 : 0.75;
        const v = VOWELS[ch] ?? VOWELS[(u.text[idx + 1] ?? '').toLowerCase()] ?? 'aa';
        target[v] = open;
        if (v !== 'aa') target.aa = open * 0.25;
      }
      const k = Math.min(1, dt * 18);
      for (const key of Object.keys(target) as (keyof typeof target)[]) {
        this.mouth[key] += (target[key] - this.mouth[key]) * k;
        em.setValue(key, this.mouth[key]);
      }
    }
    vrm.update(dt);
  }

  dispose() {
    this.root.clear();
    this.lookTarget.removeFromParent();
  }
}
