import * as THREE from 'three';
import { compile } from '@/lib/mathexpr';
import { createScene3D, type Scene3D } from './scenes3d';
import type { Scene, VideoScript } from './types';
import { AvatarController } from '@/features/avatar/AvatarController';

// Motor de video basado en plantillas programáticas: cada escena se dibuja en
// un canvas 2D de 1280×720 en función del tiempo, con tipografía cinética,
// diagramas animados, gráficos, transiciones y escenas 3D (Three.js) compuestas
// encima. El mismo motor sirve para la vista previa y para la exportación.

export const VW = 1280;
export const VH = 720;

const C = { bg1: '#070b1c', bg2: '#141a4a', ink: '#f2f5ff', muted: '#a7b2d6', primary: '#5b7bff', violet: '#9b6dff', cyan: '#3fe0f5', ok: '#34d399', warn: '#fbbf24' };

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const easeIO = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export interface Timeline {
  scenes: { scene: Scene; start: number; end: number }[];
  duration: number;
}

export function buildTimeline(script: VideoScript, durations?: Record<string, number>): Timeline {
  let t = 0;
  const scenes = script.scenes.map((s) => {
    const d = durations?.[s.id] ?? s.duration;
    const item = { scene: s, start: t, end: t + d };
    t += d;
    return item;
  });
  return { scenes, duration: t };
}

export class VideoEngine {
  ctx: CanvasRenderingContext2D;
  private gl: THREE.WebGLRenderer | null = null;
  private glAvatar: THREE.WebGLRenderer | null = null;
  private s3d = new Map<string, Scene3D>();
  private avatar: AvatarController | null = null;
  private avatarScene: THREE.Scene | null = null;
  private avatarCam: THREE.PerspectiveCamera | null = null;
  private lastT = 0;
  subtitles = true;
  fonts = { display: '600 54px Poppins, Inter, sans-serif', body: '400 30px Inter, sans-serif' };

  constructor(public canvas: HTMLCanvasElement, public script: VideoScript) {
    canvas.width = VW;
    canvas.height = VH;
    this.ctx = canvas.getContext('2d')!;
  }

  async init() {
    try {
      this.gl = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.gl.setSize(VW, VH, false);
      this.gl.setClearColor(0x000000, 0);
      this.gl.outputColorSpace = THREE.SRGBColorSpace;
    } catch {
      this.gl = null;
    }
    if (this.script.presenter && this.gl) {
      try {
        this.glAvatar = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        this.glAvatar.setSize(360, 460, false);
        this.glAvatar.setClearColor(0x000000, 0);
        this.glAvatar.outputColorSpace = THREE.SRGBColorSpace;
        this.avatarScene = new THREE.Scene();
        this.avatarScene.add(new THREE.AmbientLight(0xffffff, 0.55));
        const k = new THREE.DirectionalLight(0xffffff, 1.2);
        k.position.set(1, 2, 2.5);
        this.avatarScene.add(k);
        const r = new THREE.DirectionalLight(0x8b5cf6, 2.2);
        r.position.set(-2, 1.5, -1.5);
        this.avatarScene.add(r);
        this.avatarCam = new THREE.PerspectiveCamera(26, 360 / 460, 0.1, 20);
        this.avatarScene.add(this.avatarCam);
        this.avatar = new AvatarController(this.script.presenter);
        await this.avatar.init(this.avatarCam);
        this.avatar.root.rotation.y = 0.35;
        this.avatarScene.add(this.avatar.root);
        const h = this.avatar.height;
        this.avatarCam.position.set(0, h - 0.18, 2.1);
        this.avatarCam.lookAt(0, h - 0.32, 0);
      } catch {
        this.avatar = null;
      }
    }
  }

  private scene3d(s: Scene): Scene3D | null {
    if (!this.gl || !s.preset3d) return null;
    if (!this.s3d.has(s.id)) this.s3d.set(s.id, createScene3D(s.preset3d, s.params3d ?? {}));
    return this.s3d.get(s.id)!;
  }

  dispose() {
    for (const s of this.s3d.values()) s.dispose();
    this.s3d.clear();
    this.avatar?.dispose();
    this.gl?.dispose();
    this.glAvatar?.dispose();
  }

  /** Dibuja el cuadro del instante t (segundos) de la línea de tiempo. */
  render(tl: Timeline, t: number) {
    const ctx = this.ctx;
    const dt = Math.max(0, Math.min(0.1, t - this.lastT));
    this.lastT = t;
    const idx = Math.max(0, tl.scenes.findIndex((x) => t >= x.start && t < x.end));
    const cur = tl.scenes[idx === -1 ? tl.scenes.length - 1 : idx];
    const prev = idx > 0 ? tl.scenes[idx - 1] : null;
    this.background(t);
    const local = t - cur.start;
    const trans = 0.55;
    const tp = Math.min(1, local / trans);
    if (prev && tp < 1) {
      // Transición: escena anterior debajo y la nueva entra según el tipo.
      ctx.save();
      ctx.globalAlpha = 1 - easeIO(tp);
      this.drawScene(prev.scene, prev.end - prev.start, prev.end - prev.start - 0.001 + local, t);
      ctx.restore();
    }
    ctx.save();
    const tr = cur.scene.transition ?? 'fade';
    const e = easeIO(tp);
    if (prev && tp < 1) {
      if (tr === 'fade') ctx.globalAlpha = e;
      if (tr === 'slide') ctx.translate((1 - e) * VW * 0.35, 0), (ctx.globalAlpha = e);
      if (tr === 'zoom') {
        ctx.translate(VW / 2, VH / 2);
        ctx.scale(1.15 - 0.15 * e, 1.15 - 0.15 * e);
        ctx.translate(-VW / 2, -VH / 2);
        ctx.globalAlpha = e;
      }
      if (tr === 'wipe') {
        ctx.beginPath();
        ctx.rect(0, 0, VW * e, VH);
        ctx.clip();
      }
    }
    // Cámara 2D suave
    const cam = cur.scene.camera ?? 'push';
    const dur = cur.end - cur.start;
    const p = local / dur;
    if (cur.scene.template !== 'scene3d') {
      if (cam === 'push') {
        const k = 1 + 0.045 * easeIO(p);
        ctx.translate(VW / 2, VH / 2);
        ctx.scale(k, k);
        ctx.translate(-VW / 2, -VH / 2);
      } else if (cam === 'pan') ctx.translate(-30 * easeIO(p) + 15, 0);
    }
    this.drawScene(cur.scene, dur, local, t);
    ctx.restore();
    if (this.avatar && this.glAvatar && this.avatarScene && this.avatarCam) {
      this.avatar.update(dt || 0.016);
      this.glAvatar.render(this.avatarScene, this.avatarCam);
      ctx.drawImage(this.glAvatar.domElement, VW - 330, VH - 430, 300, 383);
    }
    if (this.subtitles) this.subtitle(cur.scene.narration, local / dur);
    // Barra de progreso
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.fillRect(0, VH - 4, VW, 4);
    ctx.fillStyle = C.cyan;
    ctx.fillRect(0, VH - 4, (VW * t) / tl.duration, 4);
  }

  private background(t: number) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, VW, VH);
    g.addColorStop(0, C.bg1);
    g.addColorStop(1, C.bg2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);
    const r = ctx.createRadialGradient(VW * 0.8, VH * 0.1, 10, VW * 0.8, VH * 0.1, 600);
    r.addColorStop(0, 'rgba(139,92,246,.25)');
    r.addColorStop(1, 'rgba(139,92,246,0)');
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, VW, VH);
    // Partículas lentas
    ctx.fillStyle = 'rgba(200,210,255,.5)';
    for (let i = 0; i < 40; i++) {
      const x = (Math.sin(i * 91.7) * 0.5 + 0.5) * VW;
      const y = ((Math.cos(i * 37.3) * 0.5 + 0.5) * VH + t * (6 + (i % 5) * 3)) % VH;
      ctx.globalAlpha = 0.25 + (i % 4) * 0.12;
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  private heading(text: string | null | undefined, p: number, y = 92) {
    if (!text) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '600 46px Poppins, Inter, sans-serif';
    ctx.fillStyle = C.ink;
    ctx.globalAlpha *= ease(p * 3);
    ctx.fillText(text, 80 - 30 * (1 - ease(p * 3)), y);
    const w = ctx.measureText(text).width;
    const grad = ctx.createLinearGradient(80, 0, 80 + w, 0);
    grad.addColorStop(0, C.primary);
    grad.addColorStop(1, C.cyan);
    ctx.fillStyle = grad;
    ctx.fillRect(80, y + 16, w * ease(p * 2.2), 5);
    ctx.restore();
  }

  private subtitle(text: string, p: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '500 26px Inter, sans-serif';
    // Muestra la porción de la narración que corresponde al momento (por palabras)
    const words = text.split(/\s+/);
    const chunk = 12;
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += chunk) chunks.push(words.slice(i, i + chunk).join(' '));
    const cur = chunks[Math.min(chunks.length - 1, Math.floor(p * chunks.length))] ?? '';
    const lines = wrap(ctx, cur, VW - 520);
    const h = lines.length * 34 + 22;
    const y = VH - 40 - h;
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    roundRect(ctx, 80, y, VW - 480, h, 14);
    ctx.fill();
    ctx.fillStyle = '#fff';
    lines.forEach((l, i) => ctx.fillText(l, 100, y + 38 + i * 34));
    ctx.restore();
  }

  private drawScene(s: Scene, dur: number, local: number, globalT: number) {
    const ctx = this.ctx;
    const p = Math.max(0, Math.min(1, local / dur));
    switch (s.template) {
      case 'title': {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = '700 72px Poppins, Inter, sans-serif';
        const text = s.heading ?? '';
        const lines = wrap(ctx, text, VW - 240);
        lines.forEach((line, li) => {
          // Tipografía cinética: cada letra entra con un pequeño retraso.
          const w = ctx.measureText(line).width;
          let x = VW / 2 - w / 2;
          ctx.textAlign = 'left';
          for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            const cp = ease((p * dur - 0.15 - (i + li * 10) * 0.025) / 0.5);
            ctx.globalAlpha = cp;
            ctx.fillStyle = C.ink;
            ctx.fillText(ch, x, VH / 2 - 20 + li * 84 + (1 - cp) * 30);
            x += ctx.measureText(ch).width;
          }
        });
        ctx.globalAlpha = ease(p * 2 - 0.4);
        const grad = ctx.createLinearGradient(VW / 2 - 200, 0, VW / 2 + 200, 0);
        grad.addColorStop(0, C.primary);
        grad.addColorStop(0.5, C.violet);
        grad.addColorStop(1, C.cyan);
        ctx.fillStyle = grad;
        const lw = 400 * ease(p * 2 - 0.3);
        ctx.fillRect(VW / 2 - lw / 2, VH / 2 + 30 + (lines.length - 1) * 84, lw, 6);
        ctx.font = '500 24px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = C.muted;
        ctx.fillText('StudyOS AI', VW / 2, VH / 2 + 90 + (lines.length - 1) * 84);
        ctx.restore();
        break;
      }
      case 'bullets': {
        this.heading(s.heading, p);
        const items = s.bullets ?? [];
        ctx.save();
        ctx.font = '500 34px Inter, sans-serif';
        items.forEach((b, i) => {
          const start = 0.15 + (i / Math.max(1, items.length)) * 0.6;
          const k = ease((p - start) / 0.12);
          const y = 200 + i * 86;
          ctx.globalAlpha = k;
          const active = p >= start && (i === items.length - 1 || p < 0.15 + ((i + 1) / items.length) * 0.6);
          ctx.fillStyle = active ? 'rgba(91,123,255,.22)' : 'rgba(255,255,255,.05)';
          roundRect(ctx, 80 + (1 - k) * 60, y - 46, VW - 520, 68, 14);
          ctx.fill();
          ctx.fillStyle = i % 2 ? C.violet : C.cyan;
          ctx.beginPath();
          ctx.arc(116 + (1 - k) * 60, y - 12, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = C.ink;
          ctx.fillText(wrap(ctx, b, VW - 620)[0] ?? '', 144 + (1 - k) * 60, y);
        });
        ctx.restore();
        break;
      }
      case 'diagram': {
        this.heading(s.heading, p);
        const nodes = s.nodes ?? [];
        const n = nodes.length;
        const cx = VW / 2 - 150;
        const cy = 400;
        const R = Math.min(230, 90 + n * 22);
        const pos = new Map(nodes.map((nd, i) => [nd, n === 1 ? [cx, cy] : [cx + Math.cos((i / n) * Math.PI * 2 - Math.PI / 2) * R * 1.35, cy + Math.sin((i / n) * Math.PI * 2 - Math.PI / 2) * R]]));
        ctx.save();
        (s.edges ?? []).forEach((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return;
          const k = ease((p - 0.35 - i * 0.06) / 0.2);
          if (k <= 0) return;
          ctx.strokeStyle = 'rgba(63,224,245,.75)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k);
          ctx.stroke();
          if (k >= 1) {
            const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
            const ex = b[0] - Math.cos(ang) * 70;
            const ey = b[1] - Math.sin(ang) * 40;
            ctx.fillStyle = C.cyan;
            ctx.beginPath();
            ctx.moveTo(ex, ey);
            ctx.lineTo(ex - Math.cos(ang - 0.4) * 16, ey - Math.sin(ang - 0.4) * 16);
            ctx.lineTo(ex - Math.cos(ang + 0.4) * 16, ey - Math.sin(ang + 0.4) * 16);
            ctx.fill();
            if (e.label) {
              ctx.font = 'italic 400 20px Inter, sans-serif';
              ctx.fillStyle = C.muted;
              ctx.textAlign = 'center';
              ctx.fillText(e.label, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 10);
            }
          }
        });
        nodes.forEach((nd, i) => {
          const [x, y] = pos.get(nd)!;
          const k = ease((p - 0.1 - i * 0.06) / 0.15);
          if (k <= 0) return;
          ctx.font = '600 26px Poppins, Inter, sans-serif';
          const w = Math.max(140, ctx.measureText(nd).width + 40);
          ctx.save();
          ctx.translate(x, y);
          ctx.scale(0.6 + 0.4 * k, 0.6 + 0.4 * k);
          ctx.globalAlpha = k;
          ctx.fillStyle = i === 0 ? '#22307f' : '#1a2350';
          ctx.strokeStyle = i === 0 ? C.primary : 'rgba(155,109,255,.8)';
          ctx.lineWidth = 2.5;
          roundRect(ctx, -w / 2, -30, w, 60, 14);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = C.ink;
          ctx.textAlign = 'center';
          ctx.fillText(nd, 0, 9);
          ctx.restore();
        });
        ctx.restore();
        break;
      }
      case 'process': {
        this.heading(s.heading, p);
        const steps = s.steps ?? [];
        const n = Math.max(1, steps.length);
        const w = (VW - 160 - (n - 1) * 24) / n;
        ctx.save();
        steps.forEach((st, i) => {
          const k = ease((p - 0.1 - (i / n) * 0.6) / 0.12);
          const x = 80 + i * (w + 24);
          const y = 260;
          ctx.globalAlpha = Math.max(0.15, k);
          const active = p > 0.1 + (i / n) * 0.6 && p < 0.1 + ((i + 1) / n) * 0.6;
          ctx.fillStyle = active ? 'rgba(91,123,255,.3)' : 'rgba(255,255,255,.06)';
          ctx.strokeStyle = active ? C.cyan : 'rgba(155,170,230,.3)';
          ctx.lineWidth = 2;
          roundRect(ctx, x, y + (1 - k) * 30, w, 220, 18);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = C.cyan;
          ctx.font = '700 44px Poppins, Inter, sans-serif';
          ctx.fillText(String(i + 1), x + 22, y + 60);
          ctx.fillStyle = C.ink;
          ctx.font = '500 24px Inter, sans-serif';
          wrap(ctx, st, w - 40).slice(0, 4).forEach((l, j) => ctx.fillText(l, x + 22, y + 106 + j * 30));
        });
        // Token que recorre el proceso
        const tp = Math.min(1, Math.max(0, (p - 0.1) / 0.6));
        ctx.globalAlpha = 1;
        ctx.fillStyle = C.warn;
        ctx.beginPath();
        ctx.arc(80 + tp * (VW - 160), 520, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(251,191,36,.4)';
        ctx.beginPath();
        ctx.moveTo(80, 520);
        ctx.lineTo(VW - 80, 520);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'comparison': {
        this.heading(s.heading, p);
        const sides = [s.left, s.right];
        ctx.save();
        sides.forEach((side, si) => {
          if (!side) return;
          const k = ease((p - 0.1) / 0.2);
          const x = si === 0 ? 80 - (1 - k) * 200 : VW / 2 + 30 + (1 - k) * 200;
          ctx.globalAlpha = k;
          ctx.fillStyle = si === 0 ? 'rgba(91,123,255,.16)' : 'rgba(155,109,255,.16)';
          roundRect(ctx, x, 150, VW / 2 - 110, 380, 20);
          ctx.fill();
          ctx.fillStyle = si === 0 ? C.primary : C.violet;
          ctx.font = '600 34px Poppins, Inter, sans-serif';
          ctx.fillText(side.title, x + 30, 205);
          ctx.font = '400 26px Inter, sans-serif';
          side.points.slice(0, 5).forEach((pt, i) => {
            const kk = ease((p - 0.3 - i * 0.08 - si * 0.04) / 0.1);
            ctx.globalAlpha = kk;
            ctx.fillStyle = C.ink;
            ctx.fillText(`• ${wrap(ctx, pt, VW / 2 - 190)[0] ?? ''}`, x + 30, 260 + i * 52);
          });
        });
        ctx.globalAlpha = ease((p - 0.2) / 0.1);
        ctx.fillStyle = C.warn;
        ctx.beginPath();
        ctx.arc(VW / 2, 340, 34, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1a1300';
        ctx.font = '700 26px Poppins, Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('VS', VW / 2, 350);
        ctx.restore();
        break;
      }
      case 'formula': {
        this.heading(s.heading, p);
        const f = s.formula ?? '';
        ctx.save();
        ctx.font = '600 76px "Times New Roman", Georgia, serif';
        ctx.textAlign = 'center';
        const n = Math.floor(f.length * ease((p - 0.1) / 0.4));
        const shown = f.slice(0, n);
        const w = ctx.measureText(f).width;
        ctx.fillStyle = 'rgba(91,123,255,.14)';
        const pulse = 1 + Math.sin(globalT * 3) * 0.02;
        roundRect(ctx, VW / 2 - (w / 2 + 50) * pulse - 120, 250, (w + 100) * pulse, 150, 22);
        ctx.fill();
        ctx.strokeStyle = C.cyan;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = C.ink;
        ctx.fillText(shown, VW / 2 - 120, 350);
        if (s.formulaNote) {
          ctx.globalAlpha = ease((p - 0.55) / 0.2);
          ctx.font = '400 28px Inter, sans-serif';
          ctx.fillStyle = C.muted;
          wrap(ctx, s.formulaNote, VW - 560).slice(0, 2).forEach((l, i) => ctx.fillText(l, VW / 2 - 120, 460 + i * 38));
        }
        ctx.restore();
        break;
      }
      case 'chart': {
        this.heading(s.heading, p);
        ctx.save();
        const x0 = 110;
        const y0 = 560;
        const cw = VW - 560;
        const ch = 330;
        ctx.strokeStyle = 'rgba(200,210,255,.4)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0, y0 - ch);
        ctx.lineTo(x0, y0);
        ctx.lineTo(x0 + cw, y0);
        ctx.stroke();
        if (s.bars && s.bars.values.length) {
          const vals = s.bars.values;
          const max = Math.max(...vals, 1e-9);
          const bw = cw / vals.length;
          vals.forEach((v, i) => {
            const k = ease((p - 0.15 - i * 0.07) / 0.25);
            const h = (v / max) * ch * k;
            const gx = ctx.createLinearGradient(0, y0 - h, 0, y0);
            gx.addColorStop(0, i % 2 ? C.violet : C.cyan);
            gx.addColorStop(1, C.primary);
            ctx.fillStyle = gx;
            roundRect(ctx, x0 + i * bw + bw * 0.18, y0 - h, bw * 0.64, h, 8);
            ctx.fill();
            ctx.fillStyle = C.ink;
            ctx.font = '600 22px Inter, sans-serif';
            ctx.textAlign = 'center';
            if (k > 0.9) ctx.fillText(`${v}${s.bars!.unit ? ` ${s.bars!.unit}` : ''}`, x0 + i * bw + bw / 2, y0 - h - 10);
            ctx.fillStyle = C.muted;
            ctx.font = '400 20px Inter, sans-serif';
            ctx.fillText(s.bars!.labels[i] ?? '', x0 + i * bw + bw / 2, y0 + 30);
          });
        } else if (s.expression) {
          try {
            const fn = compile(s.expression, ['x']);
            const xs = Array.from({ length: 200 }, (_, i) => -6 + (12 * i) / 199);
            const ys = xs.map((x) => fn({ x })).map((y) => (Number.isFinite(y) ? y : NaN));
            const valid = ys.filter((y) => !Number.isNaN(y));
            const mn = Math.min(...valid);
            const mx = Math.max(...valid) === mn ? mn + 1 : Math.max(...valid);
            ctx.strokeStyle = C.cyan;
            ctx.lineWidth = 4;
            ctx.beginPath();
            const upto = Math.floor(200 * ease((p - 0.1) / 0.6));
            let pen = false;
            for (let i = 0; i < upto; i++) {
              if (Number.isNaN(ys[i])) {
                pen = false;
                continue;
              }
              const X = x0 + (i / 199) * cw;
              const Y = y0 - ((ys[i] - mn) / (mx - mn)) * ch;
              if (pen) ctx.lineTo(X, Y);
              else ctx.moveTo(X, Y);
              pen = true;
            }
            ctx.stroke();
            ctx.fillStyle = C.muted;
            ctx.font = '400 24px monospace';
            ctx.fillText(`y = ${s.expression}`, x0 + 10, y0 - ch - 10);
          } catch {
            ctx.fillStyle = C.muted;
            ctx.fillText('Expresión no válida', x0 + 20, y0 - 40);
          }
        }
        ctx.restore();
        break;
      }
      case 'scene3d': {
        const sc = this.scene3d(s);
        if (sc && this.gl) {
          sc.update(local, dur, s.camera ?? 'orbit');
          this.gl.render(sc.scene, sc.camera);
          ctx.drawImage(this.gl.domElement, 0, 0, VW, VH);
        } else {
          ctx.fillStyle = C.muted;
          ctx.font = '400 26px Inter, sans-serif';
          ctx.fillText('Escena 3D no disponible en este dispositivo (sin WebGL).', 80, VH / 2);
        }
        this.heading(s.heading, p);
        const labels = s.labels3d ?? [];
        ctx.save();
        ctx.font = '500 22px Inter, sans-serif';
        labels.slice(0, 5).forEach((l, i) => {
          const k = ease((p - 0.2 - i * 0.1) / 0.12);
          ctx.globalAlpha = k;
          const w = ctx.measureText(l).width + 30;
          ctx.fillStyle = 'rgba(10,16,48,.75)';
          roundRect(ctx, 80, 150 + i * 56, w, 42, 12);
          ctx.fill();
          ctx.strokeStyle = 'rgba(63,224,245,.6)';
          ctx.stroke();
          ctx.fillStyle = C.ink;
          ctx.fillText(l, 95, 178 + i * 56);
        });
        ctx.restore();
        break;
      }
      case 'quiz': {
        ctx.save();
        ctx.font = '600 40px Poppins, Inter, sans-serif';
        ctx.fillStyle = C.warn;
        ctx.fillText('Pregunta rápida', 80, 100);
        ctx.fillStyle = C.ink;
        ctx.font = '500 34px Inter, sans-serif';
        wrap(ctx, s.question ?? '', VW - 520).slice(0, 2).forEach((l, i) => ctx.fillText(l, 80, 170 + i * 44));
        const reveal = p > 0.62;
        (s.options ?? []).slice(0, 4).forEach((o, i) => {
          const k = ease((p - 0.15 - i * 0.07) / 0.1);
          const y = 280 + i * 80;
          ctx.globalAlpha = k;
          const right = reveal && i === s.answerIndex;
          ctx.fillStyle = right ? 'rgba(52,211,153,.25)' : 'rgba(255,255,255,.06)';
          ctx.strokeStyle = right ? C.ok : 'rgba(155,170,230,.3)';
          roundRect(ctx, 80, y, VW - 520, 62, 14);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = C.ink;
          ctx.font = '500 26px Inter, sans-serif';
          ctx.fillText(`${String.fromCharCode(65 + i)}) ${wrap(ctx, o, VW - 640)[0] ?? ''}`, 104, y + 40);
        });
        ctx.restore();
        break;
      }
    }
  }
}

/** MIME de grabación compatible: MP4 si el navegador lo soporta, si no WebM. */
export function pickRecorderMime(withAudio: boolean): string {
  const opts = withAudio ? ['video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'] : ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  if (typeof MediaRecorder === 'undefined') return '';
  return opts.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
}
