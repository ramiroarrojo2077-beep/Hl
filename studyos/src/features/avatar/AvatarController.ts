import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName } from '@pixiv/three-vrm';
import { CHARACTERS, type Gesture } from './store';
import { currentCharIndex, useVoice } from '@/voice/bus';

// Controlador del profesor 3D sobre modelos riggeados (VRM con huesos
// humanoides y expresiones, o GLB con clips de animación).
//
// La animación del VRM es procedural y por capas:
//  1. Postura base (relajado, manos juntas, explicando, pensando…) que se
//     interpola suavemente cuando cambia.
//  2. Capas aditivas: respiración, cambio del peso del cuerpo, balanceo,
//     dedos relajados, mirada con movimientos sacádicos y parpadeo.
//  3. En reposo: pequeñas acciones al azar (mirar alrededor, cambiar de
//     postura, inclinar la cabeza, mirarse las manos).
//  4. Al hablar: gestos de explicación que se alternan, «golpes» de énfasis
//     sincronizados con las palabras largas, asentimientos y boca por sílabas.
//  5. Escuchando o pensando: posturas y miradas propias de cada estado.
//  6. Gestos puntuales pedidos por la app (saludar, señalar, asentir…).

export type CharacterId = keyof typeof CHARACTERS;

const cache = new Map<string, Promise<GLTF>>();

function load(url: string): Promise<GLTF> {
  if (!cache.has(url)) {
    const loader = new GLTFLoader();
    loader.register((p) => new VRMLoaderPlugin(p));
    cache.set(
      url,
      loader.loadAsync(url).catch((e) => {
        cache.delete(url);
        throw e;
      }),
    );
  }
  return cache.get(url)!;
}

type V3 = [number, number, number];
type Viseme = 'aa' | 'ee' | 'ih' | 'oh' | 'ou';

const VOWELS: Record<string, Viseme> = { a: 'aa', á: 'aa', e: 'ee', é: 'ee', i: 'ih', í: 'ih', y: 'ih', o: 'oh', ó: 'oh', u: 'ou', ú: 'ou', ü: 'ou' };
// Consonantes con labios cerrados o casi cerrados
const LIPS_CLOSED = new Set(['m', 'b', 'p']);
const LIPS_TEETH = new Set(['f', 'v']);
const PAUSE = new Set([' ', ',', '.', ';', ':', '?', '!', '¿', '¡', '\n', '—', '-']);

/** Brazo derecho; el izquierdo se obtiene espejando (y, z cambian de signo). */
interface ArmPose {
  upper: V3;
  lower: V3;
  hand: V3;
}
interface Stance {
  r: ArmPose;
  l: ArmPose;
  /** inclinación del torso hacia adelante (rad) */
  lean?: number;
  /** cabeza: x (asentir), y (girar), z (inclinar) */
  head?: V3;
  /** curvatura extra de los dedos 0..1 */
  curl?: number;
}

const arm = (upper: V3, lower: V3, hand: V3): ArmPose => ({ upper, lower, hand });
const RELAXED_ARM = arm([0, 0.16, 1.3], [0, 0.32, 0], [0, 0, 0.12]);

export const STANCES = {
  relaxed: { r: RELAXED_ARM, l: RELAXED_ARM },
  clasped: { r: arm([0.55, 0.42, 1.12], [0, 1.45, 0], [0.2, 0.25, 0]), l: arm([0.55, 0.42, 1.12], [0, 1.45, 0], [0.2, 0.25, 0]), curl: 0.4 },
  explainR: { r: arm([-0.15, 0.5, 1.08], [-1.35, 1.05, 0], [0, 0, -0.2]), l: RELAXED_ARM, lean: 0.03 },
  explainL: { r: RELAXED_ARM, l: arm([-0.15, 0.68, 1.0], [-1.35, 1.25, 0], [0, 0, -0.2]), lean: 0.03 },
  open: { r: arm([-0.3, 0.5, 1.0], [-1.2, 1.15, 0], [0, 0, -0.3]), l: arm([-0.3, 0.5, 1.0], [-1.2, 1.15, 0], [0, 0, -0.3]), lean: 0.04 },
  steeple: { r: arm([0.45, 0.62, 1.08], [-0.2, 1.85, 0], [0.1, 0.35, 0]), l: arm([0.45, 0.62, 1.08], [-0.2, 1.85, 0], [0.1, 0.35, 0]), lean: 0.02, curl: 0.15 },
  think: { r: arm([0.1, 1.25, 0.84], [-0.45, 2.55, 0], [0.4, 0, 0.2]), l: arm([0.5, 0.45, 1.15], [0, 1.4, 0], [0.2, 0.2, 0]), head: [0.06, 0.08, 0.1], curl: 0.55 },
} satisfies Record<string, Stance>;
export type StanceName = keyof typeof STANCES;

const TALK_STANCES: StanceName[] = ['explainR', 'open', 'explainL', 'steeple', 'explainR', 'relaxed', 'open'];

const GESTURE_DUR: Record<Gesture, number> = { explain: 2.4, point: 2.6, nod: 1.1, wave: 2.2, think: 3, shake: 1.2 };

function env(t: number, dur: number) {
  // sube rápido, mantiene, baja suave
  if (t < 0 || t > dur) return 0;
  const a = Math.min(1, t / 0.35);
  const r = Math.min(1, (dur - t) / 0.5);
  return Math.min(a, r) * (0.5 - 0.5 * Math.cos(Math.PI * Math.min(a, r)));
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
// ruido suave (suma de senos) para que nada se repita de forma mecánica
const noise = (t: number, seed: number) => Math.sin(t * 1.13 + seed) * 0.5 + Math.sin(t * 0.71 + seed * 2.3) * 0.3 + Math.sin(t * 2.07 + seed * 0.7) * 0.2;

type IdleAction = 'look' | 'tilt' | 'hands' | 'stance' | 'glance';

const FINGERS = ['Index', 'Middle', 'Ring', 'Little'] as const;
const PHALANX = ['Proximal', 'Intermediate', 'Distal'] as const;

export class AvatarController {
  root = new THREE.Group();
  vrm: VRM | null = null;
  mixer: THREE.AnimationMixer | null = null;
  actions: Record<string, THREE.AnimationAction> = {};
  headBone: THREE.Object3D | null = null;
  ready = false;
  mood: 'neutral' | 'happy' | 'thinking' | 'surprised' = 'neutral';
  height = 1.5;
  /** Solo para depuración: fuerza una postura */
  debugStance: StanceName | null = null;

  private gesture: { type: Gesture; start: number; dur: number } | null = null;
  private time = 0;
  private nextBlink = 1.5;
  private blinkT = -1;
  private mouth: Record<Viseme, number> = { aa: 0, ee: 0, ih: 0, oh: 0, ou: 0 };
  private lookTarget = new THREE.Object3D();
  // postura actual (interpolada) por hueso: brazo derecho/izquierdo
  private cur = { r: structuredClone(RELAXED_ARM), l: structuredClone(RELAXED_ARM), lean: 0, head: [0, 0, 0] as V3, curl: 0 };
  private idleStance: StanceName = 'relaxed';
  private talkStance: StanceName = 'explainR';
  private nextTalkStance = 0;
  private nextIdle = 4;
  private idle: { type: IdleAction; start: number; dur: number; dir: number } | null = null;
  private look = { x: 0, y: 0, tx: 0, ty: 0, next: 0 };
  private beat = 0;
  private lastWordIdx = -1;
  private nextListenNod = 0;
  private wasSpeaking = false;
  private robotNext = 0;

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
      // Orden de rotación de los brazos: x = giro sobre el eje del hueso, z = bajar, y = adelantar
      for (const side of ['left', 'right'] as const) for (const b of ['UpperArm', 'LowerArm', 'Hand'] as const) this.bone(`${side}${b}` as VRMHumanBoneName)?.rotation.reorder('YZX');
      this.applyVrm(0);
      vrm.update(0);
      const head = vrm.humanoid.getNormalizedBoneNode('head');
      const p = new THREE.Vector3();
      head?.getWorldPosition(p);
      this.height = p.y || 1.4;
      this.nextIdle = rand(3, 6);
    } else {
      this.mixer = new THREE.AnimationMixer(scene);
      for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
      this.actions.Idle?.play();
      scene.traverse((o) => {
        if (!this.headBone && /head/i.test(o.name) && (o as THREE.Bone).isBone) this.headBone = o;
      });
      // Se escala a 1,2 m de alto (cabeza grande): así entra cabeza y torso en el plano medio
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      const tall = box.max.y - box.min.y;
      scene.scale.setScalar(Number.isFinite(tall) && tall > 0 ? 1.2 / tall : 0.42);
      this.height = 1.2 * 0.9;
    }
    this.root.add(scene);
    this.ready = true;
  }

  private bone(n: VRMHumanBoneName) {
    return this.vrm?.humanoid.getNormalizedBoneNode(n) ?? null;
  }

  playGesture(type: Gesture) {
    if (this.mixer) {
      const map: Record<Gesture, string> = { explain: 'Yes', point: 'ThumbsUp', nod: 'Yes', wave: 'Wave', think: 'No', shake: 'No' };
      this.playClip(map[type]);
      return;
    }
    this.gesture = { type, start: this.time, dur: GESTURE_DUR[type] };
  }

  private playClip(name: string) {
    const a = this.actions[name];
    if (!a) return;
    a.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.25).play();
    a.clampWhenFinished = false;
    setTimeout(() => a.fadeOut(0.4), Math.max(0, a.getClip().duration - 0.4) * 1000);
  }

  update(dt: number) {
    if (!this.ready) return;
    this.time += dt;
    if (this.mixer) return this.updateRobot(dt);
    this.applyVrm(dt);
    this.vrm!.update(dt);
  }

  // ---------- Robot (GLB con clips) ----------
  private updateRobot(dt: number) {
    const t = this.time;
    const v = useVoice.getState();
    const speaking = v.state === 'speaking' && !!v.utterance;
    if (t > this.robotNext) {
      if (speaking) {
        this.playClip(pick(['Yes', 'Yes', 'ThumbsUp', 'Yes', 'No']));
        this.robotNext = t + rand(2.6, 4.2);
      } else {
        if (this.robotNext > 0 && Math.random() < 0.35) this.playClip(pick(['Yes', 'Wave']));
        this.robotNext = t + rand(9, 16);
      }
    }
    this.mixer!.update(dt);
    if (this.headBone) {
      this.headBone.rotation.y += noise(t * 0.5, 1) * 0.08;
      if (speaking) this.headBone.rotation.x += Math.sin(t * 8.5) * 0.03 + noise(t * 3, 2) * 0.03;
      else if (v.state === 'listening') this.headBone.rotation.z += 0.12;
    }
  }

  // ---------- VRM ----------
  private applyVrm(dt: number) {
    const t = this.time;
    const v = useVoice.getState();
    const speaking = v.state === 'speaking' && !!v.utterance;
    const listening = v.state === 'listening';
    const thinking = v.state === 'processing' || this.mood === 'thinking';

    // --- Elección de postura según el estado ---
    let stance: StanceName;
    if (this.debugStance) stance = this.debugStance;
    else if (speaking) {
      if (!this.wasSpeaking || t > this.nextTalkStance) {
        const options = TALK_STANCES.filter((s) => s !== this.talkStance);
        this.talkStance = pick(options);
        this.nextTalkStance = t + rand(1.8, 3.4);
      }
      stance = this.talkStance;
    } else if (thinking) stance = 'think';
    else if (listening) stance = 'clasped';
    else stance = this.idleStance;
    this.wasSpeaking = speaking;

    // --- Acciones en reposo ---
    const calm = !speaking && !listening && !thinking && !this.gesture && !this.debugStance;
    if (calm && !this.idle && t > this.nextIdle) {
      const type = pick<IdleAction>(['look', 'look', 'tilt', 'hands', 'stance', 'stance', 'glance']);
      if (type === 'stance') {
        this.idleStance = this.idleStance === 'relaxed' ? 'clasped' : 'relaxed';
        this.nextIdle = t + rand(5, 9);
      } else {
        this.idle = { type, start: t, dur: type === 'look' ? 3.2 : type === 'hands' ? 2.2 : 2.4, dir: Math.random() < 0.5 ? -1 : 1 };
      }
    }
    if (this.idle && (!calm || t - this.idle.start > this.idle.dur)) {
      this.idle = null;
      this.nextIdle = t + rand(4, 9);
    }

    // --- Interpolación hacia la postura elegida ---
    const target = STANCES[stance] as Stance;
    const rate = speaking ? 5 : 2.6;
    const k = 1 - Math.exp(-dt * rate);
    const ease = (a: V3, b: V3) => {
      a[0] = lerp(a[0], b[0], k);
      a[1] = lerp(a[1], b[1], k);
      a[2] = lerp(a[2], b[2], k);
    };
    for (const side of ['r', 'l'] as const) {
      ease(this.cur[side].upper, target[side].upper);
      ease(this.cur[side].lower, target[side].lower);
      ease(this.cur[side].hand, target[side].hand);
    }
    this.cur.lean = lerp(this.cur.lean, (target.lean ?? 0) + (speaking ? 0.02 : 0), k);
    ease(this.cur.head, target.head ?? [0, 0, 0]);
    this.cur.curl = lerp(this.cur.curl, target.curl ?? 0, k);

    // --- Énfasis al hablar: un «golpe» al empezar cada palabra larga ---
    let syllable = 0;
    if (speaking) {
      const u = v.utterance!;
      const idx = Math.floor(currentCharIndex());
      if (idx !== this.lastWordIdx && idx > 0 && PAUSE.has(u.text[idx - 1] ?? ' ') && !PAUSE.has(u.text[idx] ?? ' ')) {
        const word = u.text.slice(idx).split(/[\s,.;:?!]/)[0] ?? '';
        if (word.length >= 5 || Math.random() < 0.25) this.beat = Math.min(1, this.beat + rand(0.6, 1));
      }
      this.lastWordIdx = idx;
      syllable = this.mouth.aa + this.mouth.oh * 0.8 + this.mouth.ee * 0.6;
    }
    this.beat *= Math.exp(-dt * 5.5);
    const beat = this.beat;

    // --- Capas comunes ---
    const breath = Math.sin(t * 1.55); // -1..1, ~4 s por ciclo
    const weight = noise(t * 0.22, 3); // cambio de peso lento
    const sway = noise(t * 0.5, 5);

    // Gesto puntual (se mezcla por encima de la postura)
    const g = this.gesture;
    const gk = g ? env(t - g.start, g.dur) : 0;
    const gt = g ? t - g.start : 0;
    if (g && gt > g.dur) this.gesture = null;

    const set = (n: VRMHumanBoneName, x: number, y: number, z: number) => this.bone(n)?.rotation.set(x, y, z);

    // Cadera, piernas y columna
    const hipsZ = weight * 0.035;
    set('hips', 0, sway * 0.03, hipsZ);
    set('leftUpperLeg', 0, 0, -hipsZ + 0.02);
    set('rightUpperLeg', 0, 0, -hipsZ - 0.02);
    set('spine', this.cur.lean * 0.6 + breath * 0.006, -sway * 0.02, -hipsZ * 0.7);
    set('chest', breath * 0.018 + this.cur.lean * 0.4 + beat * 0.025, sway * 0.025 + (stance === 'explainR' ? -0.05 : stance === 'explainL' ? 0.05 : 0), -hipsZ * 0.3);
    set('upperChest', breath * 0.01, 0, 0);
    // Hombros: suben un poco al inhalar
    set('leftShoulder', 0, 0, -breath * 0.015);
    set('rightShoulder', 0, 0, breath * 0.015);

    // Brazos
    const armSet = (side: 'r' | 'l', p: ArmPose) => {
      const s = side === 'r' ? 1 : -1;
      const pre = side === 'r' ? 'right' : 'left';
      const micro = noise(t * 0.8, side === 'r' ? 7 : 11) * 0.03;
      set(`${pre}UpperArm` as VRMHumanBoneName, p.upper[0], s * (p.upper[1] + micro), s * (p.upper[2] + breath * 0.012));
      set(`${pre}LowerArm` as VRMHumanBoneName, p.lower[0], s * p.lower[1], s * p.lower[2]);
      set(`${pre}Hand` as VRMHumanBoneName, p.hand[0], s * p.hand[1], s * p.hand[2]);
    };
    const r = structuredClone(this.cur.r);
    const l = structuredClone(this.cur.l);
    // Golpes de énfasis en la(s) mano(s) que explican
    if (speaking) {
      const activeR = stance !== 'explainL';
      const activeL = stance === 'explainL' || stance === 'open' || stance === 'steeple';
      const flick = beat * 0.22 + syllable * 0.04;
      if (activeR && stance !== 'relaxed') {
        r.lower[1] += flick;
        r.hand[2] -= beat * 0.25;
        r.upper[1] += noise(t * 1.7, 13) * 0.06;
      }
      if (activeL) {
        l.lower[1] += flick * 0.8;
        l.hand[2] -= beat * 0.2;
        l.upper[1] += noise(t * 1.5, 17) * 0.06;
      }
    }
    // Acción en reposo «mirarse las manos»: junta un poco las manos
    if (this.idle?.type === 'hands') {
      const ik = env(t - this.idle.start, this.idle.dur);
      r.lower[1] += ik * 0.5;
      l.lower[1] += ik * 0.5;
    }
    if (g) this.blendGesture(g.type, gk, gt, r, l);
    armSet('r', r);
    armSet('l', l);

    // Dedos: relajados (levemente flexionados), más cerrados según la postura
    const curl = 0.22 + this.cur.curl * 0.6;
    for (const side of ['left', 'right'] as const) {
      const s = side === 'right' ? 1 : -1;
      FINGERS.forEach((f, fi) => {
        PHALANX.forEach((ph, pi) => {
          const amount = curl * (0.8 + fi * 0.15) * (pi === 0 ? 0.7 : pi === 1 ? 1.1 : 0.8);
          set(`${side}${f}${ph}` as VRMHumanBoneName, 0, 0, s * amount);
        });
      });
      set(`${side}ThumbProximal` as VRMHumanBoneName, 0, s * -0.25 * (0.5 + this.cur.curl), 0);
      set(`${side}ThumbDistal` as VRMHumanBoneName, 0, s * -0.2 * (0.5 + this.cur.curl), 0);
    }

    // --- Mirada: sacadas (saltos rápidos) y la cabeza que acompaña ---
    if (t > this.look.next) {
      if (speaking || listening) {
        // contacto visual con pequeñas desviaciones
        this.look.tx = rand(-0.12, 0.12);
        this.look.ty = rand(-0.06, 0.08);
        this.look.next = t + rand(0.8, 2.2);
      } else if (thinking) {
        this.look.tx = rand(0.35, 0.6);
        this.look.ty = rand(0.3, 0.5);
        this.look.next = t + rand(1.2, 2.5);
      } else {
        this.look.tx = Math.random() < 0.55 ? rand(-0.15, 0.15) : rand(-0.5, 0.5);
        this.look.ty = rand(-0.12, 0.12);
        this.look.next = t + rand(0.7, 2.8);
      }
    }
    let lx = this.look.tx;
    let ly = this.look.ty;
    let headZ = 0;
    let headX = 0;
    if (this.idle) {
      const ik = env(t - this.idle.start, this.idle.dur);
      if (this.idle.type === 'look') {
        // mira hacia un costado y luego al otro
        const ph = (t - this.idle.start) / this.idle.dur;
        lx = this.idle.dir * (ph < 0.5 ? 0.9 : -0.7) * ik;
        ly = 0.05 * ik;
      } else if (this.idle.type === 'tilt') headZ = this.idle.dir * 0.11 * ik;
      else if (this.idle.type === 'hands') {
        headX = 0.2 * ik;
        ly = -0.5 * ik;
      } else if (this.idle.type === 'glance') {
        lx = this.idle.dir * 0.6 * ik;
        ly = 0.25 * ik;
      }
    }
    // los ojos saltan rápido; la cabeza sigue con retraso
    const ek = 1 - Math.exp(-dt * 22);
    this.look.x = lerp(this.look.x, lx, ek);
    this.look.y = lerp(this.look.y, ly, ek);
    this.lookTarget.position.set(this.look.x, this.look.y, 0);
    const hk = 1 - Math.exp(-dt * 3.5);
    const neck = this.bone('neck');
    const head = this.bone('head');
    if (listening && t > this.nextListenNod) this.nextListenNod = t + rand(2, 3.5);
    const listenNod = listening ? Math.max(0, Math.sin(((this.nextListenNod - t) / 0.7) * Math.PI)) * 0.06 * Number(this.nextListenNod - t < 0.7) : 0;
    const talkNod = speaking ? beat * 0.07 + Math.sin(t * 4.7) * 0.012 + noise(t * 2.2, 19) * 0.02 : 0;
    const headTarget: V3 = [
      this.cur.head[0] + headX + talkNod + listenNod + noise(t * 0.6, 23) * 0.015 - this.look.y * 0.12,
      this.cur.head[1] + this.look.x * 0.32 + sway * 0.02,
      this.cur.head[2] + headZ + (listening ? 0.08 : 0) + (speaking ? noise(t * 0.9, 29) * 0.04 : 0) - hipsZ * 0.4,
    ];
    if (head) {
      head.rotation.set(lerp(head.rotation.x, headTarget[0], hk), lerp(head.rotation.y, headTarget[1], hk), lerp(head.rotation.z, headTarget[2], hk));
    }
    if (neck) neck.rotation.set((head?.rotation.x ?? 0) * 0.3, (head?.rotation.y ?? 0) * 0.35, (head?.rotation.z ?? 0) * 0.3);
    if (g) this.blendGestureHead(g.type, gk, gt, head, neck);

    this.updateFace(dt, speaking, v.utterance?.text ?? '', v.level);
  }

  private blendGesture(type: Gesture, k: number, gt: number, r: ArmPose, l: ArmPose) {
    const mix = (p: ArmPose, q: ArmPose) => {
      for (const key of ['upper', 'lower', 'hand'] as const) for (let i = 0; i < 3; i++) p[key][i] = lerp(p[key][i], q[key][i], k);
    };
    switch (type) {
      case 'explain':
        mix(r, STANCES.explainR.r);
        break;
      case 'point':
        mix(r, arm([0, 0.87, 0.27], [0, 0.53, 0], [-0.4, 0, 0.1]));
        break;
      case 'wave':
        mix(r, arm([0, 0.2, -0.98], [0, 0.2, -0.6 + Math.sin(gt * 9) * 0.35], [0, 0, 0]));
        break;
      case 'think':
        mix(r, STANCES.think.r);
        mix(l, STANCES.think.l);
        break;
    }
  }

  private blendGestureHead(type: Gesture, k: number, gt: number, head: THREE.Object3D | null, neck: THREE.Object3D | null) {
    if (!head) return;
    if (type === 'nod') head.rotation.x += Math.sin(gt * 11) * 0.12 * k;
    if (type === 'shake') head.rotation.y += Math.sin(gt * 12) * 0.15 * k;
    if (type === 'point') {
      head.rotation.y += 0.35 * k;
      if (neck) neck.rotation.y = 0.15 * k;
    }
    if (type === 'think') head.rotation.z += 0.12 * k;
    if (type === 'wave') head.rotation.z += 0.06 * k;
  }

  private updateFace(dt: number, speaking: boolean, text: string, level: number | null) {
    const em = this.vrm!.expressionManager;
    if (!em) return;
    const t = this.time;
    // Parpadeo (a veces doble)
    if (this.blinkT < 0 && t > this.nextBlink) this.blinkT = 0;
    let blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      blink = Math.sin(Math.min(1, this.blinkT / 0.15) * Math.PI);
      if (this.blinkT > 0.15) {
        this.blinkT = -1;
        this.nextBlink = t + (Math.random() < 0.15 ? 0.25 : rand(1.8, 5));
      }
    }
    em.setValue('blink', blink);
    const smile = this.mood === 'happy' ? 0.4 : speaking ? 0.12 + Math.max(0, noise(t * 0.4, 31)) * 0.1 : 0.05;
    em.setValue('happy', smile);
    em.setValue('surprised', this.mood === 'surprised' ? 0.4 : 0);
    em.setValue('relaxed', this.mood === 'neutral' && !speaking ? 0.15 : 0);

    // Boca por sílabas: las vocales abren, las consonantes casi cierran y
    // toman la forma de la vocal siguiente; m/b/p cierran los labios.
    const target: Record<Viseme, number> = { aa: 0, ee: 0, ih: 0, oh: 0, ou: 0 };
    if (speaking) {
      const pos = currentCharIndex();
      const idx = Math.floor(pos);
      if (level !== null) {
        // audio real (voz en la nube): apertura por volumen, forma por el texto
        const v = VOWELS[(text[idx] ?? '').toLowerCase()] ?? 'aa';
        target[v] = Math.min(1, level * 1.5);
        target.aa = Math.max(target.aa, level * 0.4);
      } else if (idx >= text.length - 1) {
        // la estimación llegó al final pero la voz sigue: balbuceo natural
        const o = Math.max(0, Math.sin(t * 2 * Math.PI * 4.6)) * (0.5 + 0.3 * noise(t * 3, 37));
        target.aa = o;
        target.oh = o * 0.3;
      } else {
        const ch = (text[idx] ?? ' ').toLowerCase();
        const nextVowel = text.slice(idx, idx + 4).toLowerCase().split('').map((c) => VOWELS[c]).find(Boolean) ?? 'aa';
        const amp = 0.75 + 0.25 * noise(idx * 0.9, 41);
        if (VOWELS[ch]) {
          target[VOWELS[ch]] = amp;
          if (VOWELS[ch] !== 'aa') target.aa = amp * 0.3;
        } else if (LIPS_CLOSED.has(ch) || PAUSE.has(ch)) {
          // labios cerrados
        } else if (LIPS_TEETH.has(ch)) target.ih = 0.25;
        else {
          target[nextVowel] = 0.28;
          target.aa = Math.max(target.aa, 0.12);
        }
      }
    }
    const mk = 1 - Math.exp(-dt * 26);
    for (const key of Object.keys(target) as Viseme[]) {
      this.mouth[key] = lerp(this.mouth[key], target[key], mk);
      em.setValue(key, this.mouth[key]);
    }
  }

  dispose() {
    this.root.clear();
    this.lookTarget.removeFromParent();
  }
}
