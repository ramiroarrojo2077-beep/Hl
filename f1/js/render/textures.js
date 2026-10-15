// Texturas procedurales (canvas): asfalto, pianos, pasto, grava, fibra de carbono,
// neumáticos, carteles, ventanas de edificios, alambrado, etc. Se cachean.

import * as THREE from 'three';

const cache = new Map();
let maxAniso = 8;
export function setAnisotropy(a) { maxAniso = a; }

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// ruido de valor suave y determinista
function makeNoise(seed = 1) {
  const perm = new Uint8Array(512);
  let s = seed * 9301 + 49297;
  const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h, x, y) => ((h & 1) ? x : -x) + ((h & 2) ? y : -y);
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const a = perm[X] + Y, b = perm[X + 1] + Y;
    const l1 = grad(perm[a], x, y) + u * (grad(perm[b], x - 1, y) - grad(perm[a], x, y));
    const l2 = grad(perm[a + 1], x, y - 1) + u * (grad(perm[b + 1], x - 1, y - 1) - grad(perm[a + 1], x, y - 1));
    return l1 + v * (l2 - l1);
  };
}
export const noise2 = makeNoise(7);

export function fbm(x, y, oct = 4) {
  let a = 0, f = 1, amp = 0.5;
  for (let i = 0; i < oct; i++) { a += amp * noise2(x * f, y * f); f *= 2; amp *= 0.5; }
  return a;
}

function tex(c, repeat = true, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// mapa normal a partir de una función de altura en canvas
function normalFromHeight(hc, strength = 2) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h), ctx = out.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const nz = 1 / Math.sqrt(dx * dx + dy * dy + 1);
    const i = (y * w + x) * 4;
    d[i] = (-dx * nz * 0.5 + 0.5) * 255; d[i + 1] = (-dy * nz * 0.5 + 0.5) * 255; d[i + 2] = nz * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

export function asphalt() {
  if (cache.has('asphalt')) return cache.get('asphalt');
  const N = 512;
  const c = canvas(N, N), ctx = c.getContext('2d');
  const hc = canvas(N, N), hctx = hc.getContext('2d');
  const img = ctx.createImageData(N, N), d = img.data;
  const himg = hctx.createImageData(N, N), hd = himg.data;
  const nz = makeNoise(3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    const n = nz(x / 40, y / 40) * 0.5 + nz(x / 9, y / 9) * 0.3;
    const grain = Math.random();
    let v = 62 + n * 18 + (grain > 0.92 ? 30 * Math.random() : 0) - (grain < 0.05 ? 18 : 0);
    // pequeñas piedras claras del agregado
    d[i] = v; d[i + 1] = v; d[i + 2] = v + 3; d[i + 3] = 255;
    const hh = 128 + n * 40 + (grain > 0.85 ? 60 : 0) - (grain < 0.1 ? 40 : 0);
    hd[i] = hd[i + 1] = hd[i + 2] = Math.max(0, Math.min(255, hh)); hd[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  hctx.putImageData(himg, 0, 0);
  // fisuras y manchas
  ctx.globalAlpha = 0.18;
  for (let k = 0; k < 18; k++) {
    ctx.strokeStyle = '#1c1c1c'; ctx.lineWidth = 1 + Math.random() * 1.5;
    ctx.beginPath();
    let x = Math.random() * N, y = Math.random() * N;
    ctx.moveTo(x, y);
    for (let j = 0; j < 8; j++) { x += (Math.random() - 0.5) * 40; y += Math.random() * 30; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  for (let k = 0; k < 10; k++) {
    ctx.fillStyle = Math.random() < 0.5 ? '#2a2a2a' : '#555';
    ctx.beginPath(); ctx.ellipse(Math.random() * N, Math.random() * N, 10 + Math.random() * 40, 6 + Math.random() * 20, Math.random() * 3, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const res = { map: tex(c), normalMap: tex(normalFromHeight(hc, 3), true, false) };
  cache.set('asphalt', res);
  return res;
}

export function kerb(colorA = '#d81e1e', colorB = '#f4f4f4') {
  const key = 'kerb' + colorA + colorB;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(64, 256), ctx = c.getContext('2d');
  ctx.fillStyle = colorA; ctx.fillRect(0, 0, 64, 128);
  ctx.fillStyle = colorB; ctx.fillRect(0, 128, 64, 128);
  // desgaste
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
    ctx.fillRect(Math.random() * 64, Math.random() * 256, 2, 2);
  }
  // borde interior oscuro
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, 4, 256);
  const t = tex(c);
  cache.set(key, t);
  return t;
}

export function groundDetail() {
  if (cache.has('ground')) return cache.get('ground');
  const N = 256;
  const c = canvas(N, N), ctx = c.getContext('2d');
  const img = ctx.createImageData(N, N), d = img.data;
  const nz = makeNoise(11);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    const n = nz(x / 16, y / 16) * 0.5 + nz(x / 4, y / 4) * 0.3 + (Math.random() - 0.5) * 0.35;
    const v = 200 + n * 55;
    d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // briznas
  for (let k = 0; k < 2500; k++) {
    const x = Math.random() * N, y = Math.random() * N;
    ctx.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '90,90,90'},0.25)`;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (Math.random() - 0.5) * 3, y - 3 - Math.random() * 4); ctx.stroke();
  }
  const t = tex(c, true, true);
  cache.set('ground', t);
  return t;
}

export function carbon() {
  if (cache.has('carbon')) return cache.get('carbon');
  const N = 128;
  const c = canvas(N, N), ctx = c.getContext('2d');
  const cell = 8;
  for (let y = 0; y < N; y += cell) for (let x = 0; x < N; x += cell) {
    const odd = ((x + y) / cell) % 2 === 0;
    const g = ctx.createLinearGradient(x, y, odd ? x + cell : x, odd ? y : y + cell);
    g.addColorStop(0, '#0d0d0f'); g.addColorStop(0.5, '#2c2d31'); g.addColorStop(1, '#0d0d0f');
    ctx.fillStyle = g; ctx.fillRect(x, y, cell, cell);
  }
  const t = tex(c);
  t.repeat.set(6, 6);
  cache.set('carbon', t);
  return t;
}

export function tyreTread(compoundColor = '#f5d10a', wet = false) {
  const key = 'tyre' + compoundColor + wet;
  if (cache.has(key)) return cache.get(key);
  // u: alrededor del neumático, v: a lo ancho (incluye flancos)
  const c = canvas(512, 128), ctx = c.getContext('2d');
  ctx.fillStyle = '#161616'; ctx.fillRect(0, 0, 512, 128);
  // banda de rodadura
  ctx.fillStyle = '#1f1f1f'; ctx.fillRect(0, 22, 512, 84);
  if (wet) {
    ctx.strokeStyle = '#0a0a0a'; ctx.lineWidth = 4;
    for (let x = 0; x < 512; x += 16) {
      ctx.beginPath(); ctx.moveTo(x, 30); ctx.lineTo(x + 14, 64); ctx.lineTo(x, 98); ctx.stroke();
    }
  }
  // granulado de goma
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '60,60,60' : '0,0,0'},${Math.random() * 0.35})`;
    ctx.fillRect(Math.random() * 512, 22 + Math.random() * 84, 2, 1);
  }
  // flancos con franja del compuesto
  ctx.fillStyle = compoundColor; ctx.fillRect(0, 6, 512, 5); ctx.fillRect(0, 117, 512, 5);
  ctx.fillStyle = '#e8e8e8';
  ctx.font = 'bold 12px Arial';
  for (let x = 20; x < 512; x += 128) { ctx.fillText('PIRELLA', x, 19); ctx.fillText('P ZERO', x + 50, 126); }
  const t = tex(c);
  cache.set(key, t);
  return t;
}

export function textBoard(text, bg = '#111', fg = '#fff', w = 512, h = 128, accent = null) {
  const key = 'board' + text + bg + fg + w + h + accent;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  if (accent) { ctx.fillStyle = accent; ctx.fillRect(0, h - h * 0.14, w, h * 0.14); ctx.fillRect(0, 0, w * 0.04, h); }
  ctx.fillStyle = fg;
  let size = h * 0.62;
  ctx.font = `900 italic ${size}px "Arial Black", Arial, sans-serif`;
  while (ctx.measureText(text).width > w * 0.9 && size > 10) { size -= 2; ctx.font = `900 italic ${size}px "Arial Black", Arial, sans-serif`; }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h * 0.47);
  const t = tex(c, false);
  cache.set(key, t);
  return t;
}

export function windows(night = false, seed = 1) {
  const key = 'win' + night + seed;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(128, 256), ctx = c.getContext('2d');
  ctx.fillStyle = night ? '#141820' : '#8b8f96'; ctx.fillRect(0, 0, 128, 256);
  let r = seed * 13;
  const rand = () => { r = (r * 16807) % 2147483647; return (r % 1000) / 1000; };
  for (let y = 4; y < 256; y += 16) for (let x = 4; x < 128; x += 12) {
    const lit = rand();
    if (night) ctx.fillStyle = lit > 0.55 ? `rgba(255,${200 + lit * 50},${120 + lit * 80},${0.6 + lit * 0.4})` : '#0b0d12';
    else ctx.fillStyle = lit > 0.5 ? '#9fb8cf' : '#5f7387';
    ctx.fillRect(x, y, 8, 10);
  }
  const t = tex(c);
  cache.set(key, t);
  return t;
}

export function fence() {
  if (cache.has('fence')) return cache.get('fence');
  const c = canvas(64, 64), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(200,205,210,0.9)'; ctx.lineWidth = 1.2;
  for (let i = -64; i < 128; i += 8) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 64, 64); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i + 64, 0); ctx.lineTo(i, 64); ctx.stroke();
  }
  const t = tex(c);
  cache.set('fence', t);
  return t;
}

export function tyreWall() {
  if (cache.has('tyrewall')) return cache.get('tyrewall');
  const c = canvas(128, 64), ctx = c.getContext('2d');
  ctx.fillStyle = '#121212'; ctx.fillRect(0, 0, 128, 64);
  for (let x = 0; x < 128; x += 16) for (let y = 0; y < 64; y += 16) {
    ctx.fillStyle = '#1e1e1e'; ctx.beginPath(); ctx.arc(x + 8, y + 8, 7.5, 0, 7); ctx.fill();
    ctx.fillStyle = '#080808'; ctx.beginPath(); ctx.arc(x + 8, y + 8, 3, 0, 7); ctx.fill();
  }
  // cinta de goma con color
  ctx.fillStyle = '#c21b1b'; ctx.fillRect(0, 22, 128, 20);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 14px Arial'; ctx.fillText('SAFETY', 30, 37);
  const t = tex(c);
  cache.set('tyrewall', t);
  return t;
}

export function concrete(paint = null) {
  const key = 'concrete' + paint;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(256, 64), ctx = c.getContext('2d');
  ctx.fillStyle = '#bfbfbb'; ctx.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 1500; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 64, 2, 2);
  }
  if (paint) {
    ctx.fillStyle = paint; ctx.fillRect(0, 0, 128, 64);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 60, 256, 4);
  // marcas de goma
  ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(0, 40, 256, 10);
  const t = tex(c);
  cache.set(key, t);
  return t;
}

export function skid() {
  if (cache.has('skid')) return cache.get('skid');
  const c = canvas(64, 256), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 256);
  for (let k = 0; k < 7; k++) {
    const x = 6 + Math.random() * 52;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.3, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 3 + Math.random() * 3, 256);
  }
  const t = tex(c, true);
  cache.set('skid', t);
  return t;
}

export function radialGlow(color = '255,255,255') {
  const key = 'glow' + color;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(64, 64), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, `rgba(${color},1)`); g.addColorStop(0.4, `rgba(${color},0.35)`); g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const t = tex(c, false);
  cache.set(key, t);
  return t;
}

export function smokePuff() {
  if (cache.has('smoke')) return cache.get('smoke');
  const c = canvas(128, 128), ctx = c.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const x = 64 + (Math.random() - 0.5) * 50, y = 64 + (Math.random() - 0.5) * 50, r = 20 + Math.random() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  }
  const t = tex(c, false);
  cache.set('smoke', t);
  return t;
}

export function numberDecal(num, color = '#fff') {
  const key = 'num' + num + color;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(128, 128), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = color; ctx.font = '900 italic 92px Arial Black, Arial';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(num), 64, 68);
  const t = tex(c, false);
  cache.set(key, t);
  return t;
}

// librea: degradé y franjas con color de equipo + nombre del equipo
export function livery(team) {
  const key = 'livery' + team.id;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(1024, 512), ctx = c.getContext('2d');
  const hex = n => '#' + n.toString(16).padStart(6, '0');
  const p = hex(team.colors.primary), s = hex(team.colors.secondary), a = hex(team.colors.accent);
  ctx.fillStyle = p; ctx.fillRect(0, 0, 1024, 512);
  // franjas diagonales
  ctx.fillStyle = s;
  ctx.beginPath(); ctx.moveTo(0, 330); ctx.lineTo(1024, 220); ctx.lineTo(1024, 270); ctx.lineTo(0, 380); ctx.fill();
  ctx.fillStyle = a;
  ctx.beginPath(); ctx.moveTo(0, 390); ctx.lineTo(1024, 280); ctx.lineTo(1024, 300); ctx.lineTo(0, 410); ctx.fill();
  // nombre
  ctx.fillStyle = s; ctx.globalAlpha = 0.95;
  ctx.font = '900 italic 70px Arial Black, Arial'; ctx.textAlign = 'center';
  ctx.fillText(team.name.toUpperCase(), 512, 170);
  ctx.globalAlpha = 1;
  // pequeños patrocinadores
  ctx.font = 'bold 34px Arial'; ctx.fillStyle = a === '#ffffff' || a === '#f0f0f0' ? '#ffffff' : s;
  ctx.fillText(team.short + ' • RACING • ' + team.short, 512, 470);
  const t = tex(c, false);
  cache.set(key, t);
  return t;
}

export function crowdColors() {
  return [0xd62828, 0xf77f00, 0xfcbf49, 0x2a9d8f, 0x264653, 0xe9c46a, 0xffffff, 0x1d3557, 0x457b9d, 0xe63946, 0x8338ec, 0x06d6a0, 0x111111, 0xff006e];
}

export function water() {
  if (cache.has('water')) return cache.get('water');
  const N = 256;
  const hc = canvas(N, N), ctx = hc.getContext('2d');
  const img = ctx.createImageData(N, N), d = img.data;
  const nz = makeNoise(21);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    const v = 128 + (nz(x / 22, y / 22) * 0.6 + nz(x / 7, y / 9) * 0.4) * 120;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = tex(normalFromHeight(hc, 4), true, false);
  cache.set('water', t);
  return t;
}
