// Cámara de celular simulada para el banco de pruebas (no la usa la app).
//
// Dibuja por trazado de rayos lo que vería la cámara: pasto o cemento con
// textura, líneas de cal, arco real con palos blancos o una pared, árboles y
// cielo, la pelota con gajos y su sombra, y las piernas del que patea. Imita al
// sensor: tiempo de exposición (estela de movimiento), obturador que lee la
// imagen de a columnas (rolling shutter), ruido, curva de tono con saturación y
// color submuestreado (YUV 4:2:0). Las imágenes se leen como las lee la app en
// la GPU: muestreo bilineal de la textura de la cámara (pixels.js).
//
// Coordenadas del arco (como en la app): x a la derecha, y arriba (piso real en
// y = 0), z hacia la cancha. La imagen tiene la fila 0 abajo.

import { azar } from "./fisica.js";

const ICOSAEDRO = (() => {
  const f = (1 + Math.sqrt(5)) / 2;
  const v = [
    [-1, f, 0], [1, f, 0], [-1, -f, 0], [1, -f, 0],
    [0, -1, f], [0, 1, f], [0, -1, -f], [0, 1, -f],
    [f, 0, -1], [f, 0, 1], [-f, 0, -1], [-f, 0, 1],
  ];
  return v.map((p) => {
    const n = Math.hypot(...p);
    return p.map((c) => c / n);
  });
})();
const COS_PENTAGONO = Math.cos(0.33);

export const PELOTAS_SIM = {
  clasica: { base: [0.8, 0.8, 0.78], parche: [0.03, 0.03, 0.03] },
  azul: { base: [0.8, 0.8, 0.8], parche: [0.03, 0.08, 0.5] },
  amarilla: { base: [0.75, 0.62, 0.06], parche: [0.04, 0.04, 0.04] },
  naranja: { base: [0.85, 0.3, 0.04], parche: [0.85, 0.85, 0.85] },
};

// Textura con niveles de detalle (mipmaps), RGB lineal.
function mipmaps(base, n) {
  const niveles = [{ n, d: base }];
  let actual = base;
  let m = n;
  while (m > 1) {
    const k = m >> 1;
    const d = new Float32Array(k * k * 3);
    for (let y = 0; y < k; y++)
      for (let x = 0; x < k; x++)
        for (let c = 0; c < 3; c++) {
          const a = (y * 2 * m + x * 2) * 3 + c;
          d[(y * k + x) * 3 + c] = (actual[a] + actual[a + 3] + actual[a + m * 3] + actual[a + m * 3 + 3]) / 4;
        }
    niveles.push({ n: k, d });
    actual = d;
    m = k;
  }
  return niveles;
}

// Ruido suave por valores (para texturas), periódico en n.
function ruidoValor(rnd, n, celdas) {
  const g = new Float32Array(celdas * celdas).map(() => rnd());
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = (x / n) * celdas;
      const v = (y / n) * celdas;
      const i = Math.floor(u);
      const j = Math.floor(v);
      const fx = u - i;
      const fy = v - j;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const at = (a, b) => g[((b % celdas) * celdas + (a % celdas)) | 0];
      out[y * n + x] =
        at(i, j) * (1 - sx) * (1 - sy) + at(i + 1, j) * sx * (1 - sy) + at(i, j + 1) * (1 - sx) * sy + at(i + 1, j + 1) * sx * sy;
    }
  return out;
}

function texturaPasto(rnd, n = 512) {
  const a = ruidoValor(rnd, n, 8);
  const b = ruidoValor(rnd, n, 32);
  const d = new Float32Array(n * n * 3);
  for (let i = 0; i < n * n; i++) {
    const hoja = rnd();
    const k = 0.65 + 0.35 * a[i] + 0.25 * (b[i] - 0.5) + 0.35 * (hoja - 0.5);
    d[i * 3] = 0.07 * k * (0.9 + 0.3 * a[i]);
    d[i * 3 + 1] = 0.16 * k;
    d[i * 3 + 2] = 0.045 * k;
  }
  return mipmaps(d, n);
}

function texturaCemento(rnd, n = 512) {
  const a = ruidoValor(rnd, n, 6);
  const b = ruidoValor(rnd, n, 40);
  const d = new Float32Array(n * n * 3);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      let k = 0.3 * (0.85 + 0.3 * a[i] + 0.15 * (b[i] - 0.5) + 0.12 * (rnd() - 0.5));
      // Juntas cada metro (la textura cubre 4 m).
      if (x % (n / 4) < 2 || y % (n / 4) < 2) k *= 0.6;
      d[i * 3] = k;
      d[i * 3 + 1] = k * 0.98;
      d[i * 3 + 2] = k * 0.93;
    }
  return mipmaps(d, n);
}

function texturaPared(rnd, n = 256, ladrillo = false) {
  const a = ruidoValor(rnd, n, 5);
  const d = new Float32Array(n * n * 3);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const g = 0.92 + 0.12 * a[i] + 0.06 * (rnd() - 0.5);
      let c = [0.55, 0.5, 0.42];
      if (ladrillo) {
        // Ladrillos de 25 x 7,5 cm (la textura cubre 2 m).
        const fila = Math.floor((y / n) * 2 / 0.075);
        const corrido = (fila % 2) * 0.125;
        const enJunta = ((y / n) * 2) % 0.075 < 0.01 || ((x / n) * 2 + corrido) % 0.25 < 0.01;
        c = enJunta ? [0.5, 0.48, 0.44] : [0.32, 0.12, 0.07];
      }
      d[i * 3] = c[0] * g;
      d[i * 3 + 1] = c[1] * g;
      d[i * 3 + 2] = c[2] * g;
    }
  return mipmaps(d, n);
}

// Lee una textura con mipmaps en (u, v) (en texeles del nivel 0, periódica) con
// el nivel que corresponde a `huella` texeles por píxel.
function leerTextura(t, u, v, huella, out) {
  let nivel = huella > 1 ? Math.min(t.length - 1, Math.floor(Math.log2(huella))) : 0;
  const { n, d } = t[nivel];
  const k = n / t[0].n;
  let x = u * k - 0.5;
  let y = v * k - 0.5;
  x -= Math.floor(x / n) * n;
  y -= Math.floor(y / n) * n;
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const i1 = (i + 1) % n;
  const j1 = (j + 1) % n;
  const a = (j * n + i) * 3;
  const b = (j * n + i1) * 3;
  const c = (j1 * n + i) * 3;
  const e = (j1 * n + i1) * 3;
  for (let q = 0; q < 3; q++)
    out[q] = (d[a + q] * (1 - fx) + d[b + q] * fx) * (1 - fy) + (d[c + q] * (1 - fx) + d[e + q] * fx) * fy;
  return out;
}

// Rayo contra cápsula (segmento a-b de radio r): distancia o Infinity.
function rayoCapsula(ox, oy, oz, dx, dy, dz, c) {
  // Descarte rápido con la esfera que la contiene.
  const e = c.esfera ?? (c.esfera = esferaDe(c));
  const ex = e[0], ey = e[1], ez = e[2], er = e[3];
  const qx = ox - ex, qy = oy - ey, qz = oz - ez;
  const bq = qx * dx + qy * dy + qz * dz;
  if (bq * bq - (qx * qx + qy * qy + qz * qz - er * er) < 0) return Infinity;
  if (bq > er) return Infinity; // la esfera queda atrás del rayo
  const { a, b, r } = c;
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const oax = ox - a[0], oay = oy - a[1], oaz = oz - a[2];
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * dx + bay * dy + baz * dz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const A = baba - bard * bard;
  let B = baba * rdoa - baoa * bard;
  let C = baba * oaoa - baoa * baoa - r * r * baba;
  let h = B * B - A * C;
  if (h >= 0 && A > 1e-12) {
    const t = (-B - Math.sqrt(h)) / A;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t > 0) return t;
  }
  // Tapas esféricas.
  let mejor = Infinity;
  for (const p of [a, b]) {
    const qx = ox - p[0], qy = oy - p[1], qz = oz - p[2];
    const bb = qx * dx + qy * dy + qz * dz;
    const cc = qx * qx + qy * qy + qz * qz - r * r;
    const hh = bb * bb - cc;
    if (hh >= 0) {
      const t = -bb - Math.sqrt(hh);
      if (t > 0 && t < mejor) mejor = t;
    }
  }
  return mejor;
}

function esferaDe(c) {
  const { a, b, r } = c;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 2 + r];
}

function normalCapsula(px, py, pz, c, out) {
  const { a, b, r } = c;
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  out[0] = (pax - h * bax) / r;
  out[1] = (pay - h * bay) / r;
  out[2] = (paz - h * baz) / r;
  return out;
}

function rayoEsfera(ox, oy, oz, dx, dy, dz, cx, cy, cz, R) {
  const qx = ox - cx, qy = oy - cy, qz = oz - cz;
  const b = qx * dx + qy * dy + qz * dz;
  const c = qx * qx + qy * qy + qz * qz - R * R;
  const h = b * b - c;
  if (h < 0) return Infinity;
  const t = -b - Math.sqrt(h);
  return t > 1e-6 ? t : Infinity;
}

function rotacionEjeAngulo(eje, ang) {
  const [x, y, z] = eje;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}

const srgbExacta = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const SRGB = new Float32Array(8193).map((_, i) => 255 * srgbExacta(i / 8192));
const srgb255 = (x) => {
  const f = x * 8192;
  const i = Math.floor(f);
  return i >= 8192 ? 255 : SRGB[i] + (SRGB[i + 1] - SRGB[i]) * (f - i);
};

// Tabla de ruido gaussiano (se recorre desde un punto distinto en cada cuadro).
const RUIDO = (() => {
  const n = 1 << 20;
  const r = azar(12345);
  return new Float32Array(n).map(() => r.normal());
})();

// Hash entero → [0, 1).
function hash(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Escena: piso, lugar, luz. opciones.lugar: 'cancha' | 'patio'.
export function crearEscena({ semilla = 1, lugar = "cancha", arco = { ancho: 3, alto: 2 }, luz = "sol", pelota = "clasica", R = 0.11 }) {
  const rnd = azar(semilla);
  const azSol = rnd.entre(0, 2 * Math.PI);
  const elSol = luz === "sol" ? rnd.entre(0.45, 1.0) : rnd.entre(0.5, 1.2);
  const L = [Math.cos(elSol) * Math.sin(azSol), Math.sin(elSol), Math.cos(elSol) * Math.cos(azSol)];
  const luces = {
    sol: { sol: 1.0, cielo: 0.45 },
    nublado: { sol: 0.12, cielo: 0.9 },
    interior: { sol: 0.35, cielo: 0.55 },
  }[luz];
  const total = luces.sol * L[1] + luces.cielo;
  const arboles = new Float32Array(360).map(() => rnd());
  return {
    lugar,
    arco,
    R,
    L,
    sol: luces.sol,
    cielo: luces.cielo,
    total,
    pelota: PELOTAS_SIM[pelota],
    piso: lugar === "cancha" ? texturaPasto(rnd) : texturaCemento(rnd),
    pared: lugar === "patio" ? { z: -0.5, tex: texturaPared(rnd, 256, rnd() < 0.5) } : null,
    palos:
      lugar === "cancha"
        ? [
            { a: [-arco.ancho / 2, 0, 0], b: [-arco.ancho / 2, arco.alto, 0], r: 0.05, color: [0.75, 0.75, 0.73] },
            { a: [arco.ancho / 2, 0, 0], b: [arco.ancho / 2, arco.alto, 0], r: 0.05, color: [0.75, 0.75, 0.73] },
            { a: [-arco.ancho / 2, arco.alto, 0], b: [arco.ancho / 2, arco.alto, 0], r: 0.05, color: [0.75, 0.75, 0.73] },
          ]
        : [],
    arboles: (az) => {
      const k = ((az / (2 * Math.PI)) * 360 + 360) % 360;
      const i = Math.floor(k);
      const f = k - i;
      return 0.05 + 0.12 * (arboles[i] * (1 - f) + arboles[(i + 1) % 360] * f);
    },
  };
}

export class CamaraSimulada {
  // ancho × alto: textura de la cámara (vertical: 1080 × 2160).
  // exposicion: s; ruido: {foton, lectura} (varianza en lineal);
  // obturador: s que tarda en leer la imagen de un costado al otro (0 = global).
  constructor({ escena, ancho = 1080, alto = 2160, fovY = 66, exposicion = 0.004, ruido = { foton: 0.0004, lectura: 0.00002 }, obturador = 0, muestras = 8, muestrasFondo = 1, semilla = 7 }) {
    Object.assign(this, { escena, ancho, alto, exposicion, ruido, obturador, muestras, muestrasFondo, semilla });
    this.tanY = Math.tan(((fovY / 2) * Math.PI) / 180);
    this.tanX = (this.tanY * ancho) / alto;
    this.pixAng = (2 * this.tanY) / alto;
    const n = ancho * alto;
    this.rgb = new Uint8Array(n * 3);
    this.marca = new Int32Array(n);
    this.fondo = new Float32Array(n * 3);
    this.fondoOk = new Uint8Array(n);
    this.quieto = new Float32Array(n * 3);
    this.quietoId = new Int32Array(n);
    this.firma = null;
    this.firmaId = 1;
    this.claveFondo = null;
    this.cuadroId = 0;
    // Ganancia de la exposición automática: el pasto (~0,12) queda gris medio.
    this.ganancia = 0.2 / (0.13 * escena.total);
    this.tmp = new Float32Array(3);
    this.vals = new Float32Array(12);
    this.Y = new Float32Array(4);
    this.tmp2 = new Float32Array(3);
    this.nrm = new Float32Array(3);
  }

  // Matriz de proyección (como la de WebXR, por columnas).
  proyeccion(cerca = 0.01, lejos = 100) {
    const P = new Array(16).fill(0);
    P[0] = 1 / this.tanX;
    P[5] = 1 / this.tanY;
    P[10] = -(lejos + cerca) / (lejos - cerca);
    P[11] = -1;
    P[14] = (-2 * lejos * cerca) / (lejos - cerca);
    return P;
  }

  // Prepara un cuadro. t: mitad de la exposición. camaraEn(τ) → {pos:[3], R:[9] (columnas = ejes
  // de la cámara, fila por fila)}; estadoEn(τ) → {pelota: {c, eje, angulo} | null, cuerpos: [cápsulas]}.
  // fija: la cámara no se mueve (permite guardar el fondo entre cuadros).
  cuadro(t, camaraEn, estadoEn, { fija = false } = {}) {
    this.cuadroId++;
    this.desplazamientoRuido = Math.floor(hash(this.cuadroId, this.semilla) * 0xfffff);
    this.t = t;
    const ventana = this.exposicion / 2 + this.obturador / 2;
    this.tA = t - ventana;
    this.tB = t + ventana;
    const M = 48;
    this.M = M;
    this.estados = [];
    this.camaras = [];
    for (let k = 0; k < M; k++) {
      const tau = this.tA + ((this.tB - this.tA) * (k + 0.5)) / M;
      const e = estadoEn(tau);
      const cam = camaraEn(tau);
      const p = e.pelota;
      this.estados.push({
        pelota: p ? { c: p.c, Rot: rotacionEjeAngulo(p.eje ?? [1, 0, 0], -(p.angulo ?? 0)) } : null,
        cuerpos: e.cuerpos ?? [],
      });
      this.camaras.push(cam);
    }
    const clave = fija ? JSON.stringify(camaraEn(t)) : null;
    if (clave !== this.claveFondo) {
      this.fondoOk.fill(0);
      this.claveFondo = clave;
    }
    this.fija = fija && clave !== null;
    // Firma de cómo están los objetos: si no cambió, lo quieto se reusa.
    const r = (v) => Math.round(v * 1e4);
    const medio = this.estados[M >> 1];
    const firma = `${clave}|${medio.pelota ? medio.pelota.c.map(r).join(",") : "-"}|${medio.cuerpos.map((c) => [...c.a, ...c.b].map(r).join(",")).join(";")}|${this.estados[0].pelota?.c.map(r).join(",")}`;
    if (firma !== this.firma) {
      this.firma = firma;
      this.firmaId++;
    }
    this.#zonasMoviles();
  }

  // Zonas de la imagen (en texeles) donde hay algo que no es el fondo fijo (con
  // su sombra), con cuántas muestras en el tiempo hay que calcularlas: 1 si está
  // quieto; si se mueve durante la exposición, varias (para la estela).
  #zonasMoviles() {
    const zonas = [];
    const { L } = this.escena;
    let tipo = 1;
    const agregar = (cx, cy, cz, radio) => {
      for (const k of [0, this.M >> 1, this.M - 1]) {
        const cam = this.camaras[k];
        const q = this.#aCamara(cam, cx, cy, cz);
        if (q[2] > -0.05) {
          if (-q[2] < -radio) continue; // totalmente atrás
          zonas.push([0, 0, this.ancho - 1, this.alto - 1, tipo]);
          return;
        }
        const z = -q[2];
        const u = ((q[0] / z / this.tanX + 1) / 2) * this.ancho;
        const v = ((q[1] / z / this.tanY + 1) / 2) * this.alto;
        const r = ((radio / z) * (this.alto / 2)) / this.tanY * 1.3 + 3;
        zonas.push([u - r, v - r, u + r, v + r, tipo]);
      }
    };
    const ultimo = this.estados[this.M - 1];
    const mueve = (a, b) => !a || !b || Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 5e-4;
    for (const e of [this.estados[0], this.estados[this.M >> 1], ultimo]) {
      const p = e.pelota;
      if (p) {
        tipo = mueve(p.c, this.estados[0].pelota?.c) || mueve(p.c, ultimo.pelota?.c) ? this.muestras : 1;
        agregar(p.c[0], p.c[1], p.c[2], this.escena.R);
        const s = p.c[1] / L[1];
        agregar(p.c[0] - L[0] * s, 0, p.c[2] - L[2] * s, this.escena.R / Math.max(L[1], 0.3) + 0.05);
      }
      for (const [ci, c] of e.cuerpos.entries()) {
        const c0 = this.estados[0].cuerpos[ci];
        const c1 = ultimo.cuerpos[ci];
        tipo = mueve(c.a, c0?.a) || mueve(c.b, c0?.b) || mueve(c.a, c1?.a) || mueve(c.b, c1?.b) ? Math.min(3, this.muestras) : 1;
        const m = [(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2, (c.a[2] + c.b[2]) / 2];
        const r = Math.hypot(c.a[0] - c.b[0], c.a[1] - c.b[1], c.a[2] - c.b[2]) / 2 + c.r;
        agregar(m[0], m[1], m[2], r);
        const s = m[1] / L[1];
        agregar(m[0] - L[0] * s, 0, m[2] - L[2] * s, r / Math.max(L[1], 0.3) + m[1] * 0.1);
      }
    }
    // Grilla de celdas de 16 texeles: 1 donde algo se mueve.
    const gw = Math.ceil(this.ancho / 16);
    const gh = Math.ceil(this.alto / 16);
    if (!this.grilla || this.grilla.length !== gw * gh) this.grilla = new Uint8Array(gw * gh);
    this.grilla.fill(0);
    this.gw = gw;
    for (const [a, b, c, d, k] of zonas) {
      const x0 = Math.max(0, Math.floor(a / 16));
      const x1 = Math.min(gw - 1, Math.floor(c / 16));
      const y0 = Math.max(0, Math.floor(b / 16));
      const y1 = Math.min(gh - 1, Math.floor(d / 16));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.grilla[y * gw + x] < k) this.grilla[y * gw + x] = k;
    }
  }

  #aCamara(cam, x, y, z) {
    const R = cam.R;
    const dx = x - cam.pos[0];
    const dy = y - cam.pos[1];
    const dz = z - cam.pos[2];
    // R tiene los ejes de la cámara como columnas: coordenadas de cámara = Rᵀ·d.
    return [R[0] * dx + R[3] * dy + R[6] * dz, R[1] * dx + R[4] * dy + R[7] * dz, R[2] * dx + R[5] * dy + R[8] * dz];
  }

  #zona(i, j) {
    return this.grilla[(j >> 4) * this.gw + (i >> 4)];
  }

  // Radiancia (lineal) que llega al texel (i, j), en out.
  #texelRadiancia(i, j, out) {
    const zona = this.#zona(i, j);
    const movil = zona > 0;
    const idx = j * this.ancho + i;
    if (!movil && this.fija && this.fondoOk[idx]) {
      const k = idx * 3;
      out[0] = this.fondo[k];
      out[1] = this.fondo[k + 1];
      out[2] = this.fondo[k + 2];
      return out;
    }
    // Objetos quietos que siguen igual que en el cuadro anterior: se reusa.
    if (zona === 1 && this.fija && this.quietoId[idx] === this.firmaId) {
      const k = idx * 3;
      out[0] = this.quieto[k];
      out[1] = this.quieto[k + 1];
      out[2] = this.quieto[k + 2];
      return out;
    }
    const N = zona > 1 ? zona : this.fija ? 1 : this.muestrasFondo;
    // El sensor se lee de a filas a lo largo de su lado largo: con el celular
    // horizontal, de arriba abajo; vertical, de un costado al otro.
    const corrimiento = this.ancho > this.alto ? this.obturador * (0.5 - j / this.alto) : this.obturador * (i / this.ancho - 0.5);
    let r = 0;
    let g = 0;
    let b = 0;
    const c = this.tmp2;
    for (let s = 0; s < N; s++) {
      const azarT = hash(this.cuadroId * 977 + s, j * this.ancho + i);
      const jx = N > 1 ? hash(s * 31 + 7, j * this.ancho + i + this.cuadroId) : 0.5;
      const jy = N > 1 ? hash(s * 17 + 3, j * this.ancho + i - this.cuadroId) : 0.5;
      const tau = N > 1 || !this.fija ? this.t + corrimiento + this.exposicion * ((s + azarT) / N - 0.5) : this.t;
      let k = Math.floor(((tau - this.tA) / (this.tB - this.tA)) * this.M);
      k = Math.max(0, Math.min(this.M - 1, k));
      const cam = this.camaras[k];
      const nx = ((i + jx) / this.ancho) * 2 - 1;
      const ny = ((j + jy) / this.alto) * 2 - 1;
      const cx = nx * this.tanX;
      const cy = ny * this.tanY;
      const R = cam.R;
      let dx = R[0] * cx + R[1] * cy - R[2];
      let dy = R[3] * cx + R[4] * cy - R[5];
      let dz = R[6] * cx + R[7] * cy - R[8];
      const n = Math.hypot(dx, dy, dz);
      dx /= n;
      dy /= n;
      dz /= n;
      this.#trazar(cam.pos[0], cam.pos[1], cam.pos[2], dx, dy, dz, movil ? this.estados[k] : null, c);
      r += c[0];
      g += c[1];
      b += c[2];
    }
    out[0] = r / N;
    out[1] = g / N;
    out[2] = b / N;
    if (!movil && this.fija) {
      const q = idx * 3;
      this.fondo[q] = out[0];
      this.fondo[q + 1] = out[1];
      this.fondo[q + 2] = out[2];
      this.fondoOk[idx] = 1;
    } else if (zona === 1 && this.fija) {
      const q = idx * 3;
      this.quieto[q] = out[0];
      this.quieto[q + 1] = out[1];
      this.quieto[q + 2] = out[2];
      this.quietoId[idx] = this.firmaId;
    }
    return out;
  }

  // Radiancia por un rayo. estado: objetos que se mueven (o null).
  #trazar(ox, oy, oz, dx, dy, dz, estado, out) {
    const E = this.escena;
    let t = Infinity;
    let tipo = 0; // 1 piso, 2 pared, 3 palo, 4 pelota, 5 cuerpo
    let obj = null;
    if (dy < -1e-6) {
      t = -oy / dy;
      tipo = 1;
    }
    if (E.pared && dz < 0 && oz > E.pared.z) {
      const tp = (E.pared.z - oz) / dz;
      const y = oy + dy * tp;
      const x = ox + dx * tp;
      if (tp < t && y >= 0 && y <= 3 && Math.abs(x) < 8) {
        t = tp;
        tipo = 2;
      }
    }
    for (const p of E.palos) {
      const tp = rayoCapsula(ox, oy, oz, dx, dy, dz, p);
      if (tp < t) {
        t = tp;
        tipo = 3;
        obj = p;
      }
    }
    if (estado) {
      const p = estado.pelota;
      if (p) {
        const tp = rayoEsfera(ox, oy, oz, dx, dy, dz, p.c[0], p.c[1], p.c[2], E.R);
        if (tp < t) {
          t = tp;
          tipo = 4;
          obj = p;
        }
      }
      for (const c of estado.cuerpos) {
        const tp = rayoCapsula(ox, oy, oz, dx, dy, dz, c);
        if (tp < t) {
          t = tp;
          tipo = 5;
          obj = c;
        }
      }
    }
    if (tipo === 0 || t > 200) return this.#lejos(dx, dy, dz, out);
    const px = ox + dx * t;
    const py = oy + dy * t;
    const pz = oz + dz * t;
    const n = this.nrm;
    const alb = this.tmp;
    if (tipo === 1) {
      n[0] = 0;
      n[1] = 1;
      n[2] = 0;
      const huella = (t * this.pixAng) / Math.max(-dy, 0.03) / (4 / 512);
      leerTextura(E.piso, (px / 4) * 512, (pz / 4) * 512, huella, alb);
      if (E.lugar === "cancha") {
        // Franjas del corte del pasto y líneas de cal.
        const franja = Math.floor(pz / 1.5) % 2 === 0 ? 1.12 : 0.88;
        alb[0] *= franja;
        alb[1] *= franja;
        alb[2] *= franja;
        const area = E.arco.ancho / 2 + 5.5;
        const linea =
          (Math.abs(pz) < 0.06 && Math.abs(px) < 30) ||
          (Math.abs(pz - 5.5) < 0.06 && Math.abs(px) < area) ||
          (Math.abs(Math.abs(px) - area) < 0.06 && pz > 0 && pz < 5.5);
        if (linea) {
          alb[0] = 0.62;
          alb[1] = 0.64;
          alb[2] = 0.6;
        }
      }
    } else if (tipo === 2) {
      n[0] = 0;
      n[1] = 0;
      n[2] = 1;
      const huella = (t * this.pixAng) / Math.max(-dz, 0.03) / (2 / 256);
      leerTextura(E.pared.tex, (px / 2) * 256, (py / 2) * 256, huella, alb);
    } else if (tipo === 3 || tipo === 5) {
      normalCapsula(px, py, pz, obj, n);
      alb[0] = obj.color[0];
      alb[1] = obj.color[1];
      alb[2] = obj.color[2];
    } else {
      const R = E.R;
      n[0] = (px - obj.c[0]) / R;
      n[1] = (py - obj.c[1]) / R;
      n[2] = (pz - obj.c[2]) / R;
      // Gajos: en el sistema de la pelota (que gira).
      const M = obj.Rot;
      const lx = M[0] * n[0] + M[1] * n[1] + M[2] * n[2];
      const ly = M[3] * n[0] + M[4] * n[1] + M[5] * n[2];
      const lz = M[6] * n[0] + M[7] * n[1] + M[8] * n[2];
      let max = -1;
      for (const v of ICOSAEDRO) max = Math.max(max, v[0] * lx + v[1] * ly + v[2] * lz);
      const col = max > COS_PENTAGONO ? E.pelota.parche : E.pelota.base;
      alb[0] = col[0];
      alb[1] = col[1];
      alb[2] = col[2];
    }
    // Luz: sol (con sombra), cielo y lo que rebota del piso.
    const L = E.L;
    const nl = n[0] * L[0] + n[1] * L[1] + n[2] * L[2];
    let sol = 0;
    if (nl > 0 && E.sol > 0) {
      const e = 1e-4;
      const visible = !this.#sombra(px + n[0] * e, py + n[1] * e, pz + n[2] * e, L, estado, tipo === 4 ? obj : null);
      if (visible) sol = E.sol * nl;
    }
    const cielo = E.cielo * (0.55 + 0.45 * n[1]);
    const rebote = 0.12 * E.total * (0.5 - 0.5 * n[1]);
    let brillo = 0;
    if (tipo === 4) {
      // Un poco de brillo especular en la pelota.
      const hx = L[0] - dx;
      const hy = L[1] - dy;
      const hz = L[2] - dz;
      const hn = Math.hypot(hx, hy, hz);
      const nh = Math.max(0, (n[0] * hx + n[1] * hy + n[2] * hz) / hn);
      brillo = sol > 0 ? 0.25 * Math.pow(nh, 30) * E.sol : 0;
    }
    const luz = sol + cielo + rebote;
    out[0] = alb[0] * luz + brillo;
    out[1] = alb[1] * luz + brillo;
    out[2] = alb[2] * luz + brillo;
    return out;
  }

  #sombra(px, py, pz, L, estado, propia) {
    const E = this.escena;
    for (const p of E.palos) if (rayoCapsula(px, py, pz, L[0], L[1], L[2], p) < Infinity) return true;
    if (!estado) return false;
    const p = estado.pelota;
    if (p && p !== propia && rayoEsfera(px, py, pz, L[0], L[1], L[2], p.c[0], p.c[1], p.c[2], E.R) < Infinity) return true;
    for (const c of estado.cuerpos) if (rayoCapsula(px, py, pz, L[0], L[1], L[2], c) < Infinity) return true;
    return false;
  }

  #lejos(dx, dy, dz, out) {
    const E = this.escena;
    const el = Math.asin(Math.max(-1, Math.min(1, dy)));
    const az = Math.atan2(dx, dz);
    if (el < E.arboles(az) && el > -0.2) {
      const k = 0.06 + 0.03 * hash(Math.floor(az * 300), Math.floor(el * 300));
      out[0] = 0.5 * k * E.total;
      out[1] = 0.9 * k * E.total;
      out[2] = 0.35 * k * E.total;
      return out;
    }
    const k = (0.75 + 0.25 * Math.min(1, el * 3)) * E.total;
    out[0] = 0.7 * k;
    out[1] = 0.82 * k;
    out[2] = 1.0 * k;
    return out;
  }

  // Calcula (si hace falta) el bloque de 2x2 texeles que contiene (i, j): sensor,
  // ruido, curva de tono y color submuestreado.
  #bloque(i, j) {
    const i0 = i & ~1;
    const j0 = j & ~1;
    const W = this.ancho;
    const vals = this.vals;
    const rad = this.tmp;
    let k = 0;
    for (let b = 0; b < 2; b++)
      for (let a = 0; a < 2; a++) {
        const x = Math.min(i0 + a, W - 1);
        const y = Math.min(j0 + b, this.alto - 1);
        this.#texelRadiancia(x, y, rad);
        for (let c = 0; c < 3; c++) {
          const v = Math.max(0, rad[c] * this.ganancia);
          // Ruido de fotones y de lectura (gaussiano, determinístico por texel y cuadro).
          const z = RUIDO[((y * W + x) * 3 + c + this.desplazamientoRuido) & 0xfffff];
          const s = Math.sqrt(this.ruido.foton * v + this.ruido.lectura);
          vals[k++] = srgb255(Math.max(0, Math.min(1, v + z * s)));
        }
      }
    // YUV 4:2:0: brillo por texel, color promedio del bloque.
    let su = 0;
    let sv = 0;
    const Y = this.Y;
    for (let q = 0; q < 4; q++) {
      const r = vals[q * 3];
      const g = vals[q * 3 + 1];
      const b = vals[q * 3 + 2];
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      Y[q] = y;
      su += b - y;
      sv += r - y;
    }
    su /= 4;
    sv /= 4;
    let q = 0;
    for (let b = 0; b < 2; b++)
      for (let a = 0; a < 2; a++, q++) {
        const x = i0 + a;
        const y = j0 + b;
        if (x >= W || y >= this.alto) continue;
        const R = Y[q] + sv;
        const B = Y[q] + su;
        const G = (Y[q] - 0.299 * R - 0.114 * B) / 0.587;
        const idx = y * W + x;
        this.rgb[idx * 3] = Math.max(0, Math.min(255, Math.round(R)));
        this.rgb[idx * 3 + 1] = Math.max(0, Math.min(255, Math.round(G)));
        this.rgb[idx * 3 + 2] = Math.max(0, Math.min(255, Math.round(B)));
        this.marca[idx] = this.cuadroId;
      }
  }

  // Índice (en rgb) del texel (i, j), calculándolo si hace falta.
  #texel(i, j) {
    i = i < 0 ? 0 : i >= this.ancho ? this.ancho - 1 : i;
    j = j < 0 ? 0 : j >= this.alto ? this.alto - 1 : j;
    const idx = j * this.ancho + i;
    if (this.marca[idx] !== this.cuadroId) this.#bloque(i, j);
    return idx * 3;
  }

  // Lee la imagen como la app (pixels.js): w × h muestras bilineales de la
  // región {x, y, w, h} (0..1, y hacia arriba). RGBA, fila 0 abajo.
  leer(w, h, region = null, out = new Uint8Array(w * h * 4)) {
    const rx = region?.x ?? 0;
    const ry = region?.y ?? 0;
    const rw = region?.w ?? 1;
    const rh = region?.h ?? 1;
    for (let y = 0; y < h; y++) {
      const v = ry + ((y + 0.5) / h) * rh;
      const ty = v * this.alto - 0.5;
      const j = Math.floor(ty);
      const fy = ty - j;
      for (let x = 0; x < w; x++) {
        const u = rx + ((x + 0.5) / w) * rw;
        const tx = u * this.ancho - 0.5;
        const i = Math.floor(tx);
        const fx = tx - i;
        const o = (y * w + x) * 4;
        const k00 = this.#texel(i, j);
        const k10 = this.#texel(i + 1, j);
        const k01 = this.#texel(i, j + 1);
        const k11 = this.#texel(i + 1, j + 1);
        const rgb = this.rgb;
        for (let c = 0; c < 3; c++) {
          const a = rgb[k00 + c] * (1 - fx) + rgb[k10 + c] * fx;
          const b = rgb[k01 + c] * (1 - fx) + rgb[k11 + c] * fx;
          out[o + c] = Math.round(a * (1 - fy) + b * fy);
        }
        out[o + 3] = 255;
      }
    }
    return out;
  }
}

export { azar };
