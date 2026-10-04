// Reconoce la pelota escaneada en cada cuadro de la cámara.
//
// Trabaja sobre una imagen RGBA chica tal como la devuelve readPixels de WebGL:
// la fila 0 es la de abajo. Las coordenadas que devuelve (x, y, r) están en
// píxeles de esa imagen, con y creciendo hacia arriba.
//
// Al escanear arma dos histogramas de color (pelota y fondo) y de ahí una tabla
// con la probabilidad de que cada color sea de la pelota. El fondo también se
// aprende de lo que la cámara ve antes del escaneo y se sigue actualizando
// durante el juego, así se adapta al lugar desde donde se patea. Si la cámara
// está quieta (o se sabe cuánto giró), además favorece los píxeles que
// cambiaron respecto de los dos cuadros anteriores y tienen un color típico de
// la pelota: así la encuentra en movimiento aunque se parezca al fondo.
//
// La posición y el radio finales salen de momentos ponderados por la
// probabilidad de cada píxel (no de una máscara de sí/no), lo que da precisión
// de fracciones de píxel.

const NIVELES = 16; // por canal → 4096 casilleros
const CASILLEROS = NIVELES * NIVELES * NIVELES;
const UMBRAL = 0.5;
const FACTOR_QUIETO = 0.75;
const DIFERENCIA_MOVIMIENTO = 45;
const AREA_MINIMA = 5;
const UMBRAL_FOCO = 0.35; // donde se espera la pelota en vuelo
const CANDIDATAS = 4;
const BRILLOS = [0.82, 0.91, 1, 1.1]; // la pelota de lejos o a la sombra cambia de brillo
const CUADROS_POR_ACTUALIZACION = 6;

const casillero = (r, g, b) => ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);

// Suaviza el histograma para tolerar cambios de luz entre el escaneo y el remate.
function suavizar(h) {
  let a = h;
  for (const paso of [1, NIVELES, NIVELES * NIVELES]) {
    const b = new Float32Array(CASILLEROS);
    for (let i = 0; i < CASILLEROS; i++) {
      const nivel = Math.floor(i / paso) % NIVELES;
      let s = a[i] * 2;
      if (nivel > 0) s += a[i - paso];
      if (nivel < NIVELES - 1) s += a[i + paso];
      b[i] = s;
    }
    a = b;
  }
  return a;
}

function normalizar(h) {
  let total = 0;
  for (let q = 0; q < CASILLEROS; q++) total += h[q];
  if (total > 0) for (let q = 0; q < CASILLEROS; q++) h[q] /= total;
  return h;
}

// Cierre morfológico 3x3 (dilatar y erosionar): une los gajos negros y blancos
// de una pelota clásica en una sola mancha.
function dilatar(src, dst, w, h, valor) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 1 - valor;
      for (let dy = -1; dy <= 1 && r !== valor; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          if (src[yy * w + xx] === valor) {
            r = valor;
            break;
          }
        }
      }
      dst[y * w + x] = r;
    }
  }
}

// Cámara de un cuadro para compensar su giro:
// K: 3x3 (fila por fila) que lleva una dirección en coordenadas de cámara a
//    píxeles homogéneos de la imagen.
// R: 3x3 (fila por fila) con la rotación cámara → mundo.
export function matrizK(proyeccion, w, h) {
  // proyeccion: matriz 4x4 de WebGL (por columnas). En la imagen y crece hacia arriba.
  const P = proyeccion;
  return [(w / 2) * P[0], (w / 2) * P[4], (w / 2) * (P[8] - 1), (h / 2) * P[1], (h / 2) * P[5], (h / 2) * (P[9] - 1), 0, 0, -1];
}

const mul3 = (a, b) => {
  const c = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) c[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return c;
};
const trasp3 = (a) => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map(
    (v) => v / det,
  );
}

// Homografía de los píxeles de `actual` a los de `anterior` si la cámara sólo
// giró (el desplazamiento de la mano es chico comparado con la distancia al arco).
// null si giró demasiado para comparar.
function homografia(actual, anterior) {
  const rel = mul3(trasp3(anterior.R), actual.R);
  const coseno = (rel[0] + rel[4] + rel[8] - 1) / 2;
  if (coseno < Math.cos((8 * Math.PI) / 180)) return null;
  return mul3(mul3(anterior.K, rel), inv3(actual.K));
}

// Índice (en bytes) del píxel del cuadro anterior que corresponde a (x, y), o -1.
function muestra(H, x, y, w, h) {
  const u = x + 0.5;
  const v = y + 0.5;
  const z = H[6] * u + H[7] * v + H[8];
  const px = Math.floor((H[0] * u + H[1] * v + H[2]) / z);
  const py = Math.floor((H[3] * u + H[4] * v + H[5]) / z);
  return px < 0 || py < 0 || px >= w || py >= h ? -1 : (py * w + px) * 4;
}

export class BallDetector {
  constructor(width, height) {
    this.prob = null;
    this.previo = new Float32Array(CASILLEROS);
    this.cuadrosPrevios = 0;
    this.resize(width, height);
  }

  get trained() {
    return this.prob !== null;
  }

  resize(width, height) {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    const n = width * height;
    this.prev = new Uint8Array(n * 4);
    this.prev2 = new Uint8Array(n * 4);
    this.hasPrev = false;
    this.hasPrev2 = false;
    this.score = new Float32Array(n);
    this.mask = new Uint8Array(n);
    this.tmp = new Uint8Array(n);
    this.closed = new Uint8Array(n);
    this.moving = new Uint8Array(n);
    this.labels = new Int32Array(n);
    this.stack = new Int32Array(n);
    this.last = null;
    this.acumulado = new Float32Array(CASILLEROS);
    this.cuadros = 0;
  }

  // Antes de escanear: junta los colores del lugar (piso, paredes) como fondo.
  // excluir: {x, y, r} zona a ignorar (donde debería estar la pelota).
  observeBackground(rgba, excluir = null) {
    const { width: w, height: h, previo } = this;
    const r2 = excluir ? (excluir.r * 1.4) ** 2 : -1;
    for (let y = 1; y < h; y += 3) {
      for (let x = 1; x < w; x += 3) {
        if (excluir && (x + 0.5 - excluir.x) ** 2 + (y + 0.5 - excluir.y) ** 2 < r2) continue;
        const i = (y * w + x) * 4;
        previo[casillero(rgba[i], rgba[i + 1], rgba[i + 2])]++;
      }
    }
    this.cuadrosPrevios++;
  }

  // Aprende los colores de la pelota: tiene que ocupar el círculo de centro
  // (cx, cy) y radio `radius`. Toma como pelota el 60 % interior del círculo
  // y como fondo todo lo que queda fuera de 1,35 radios.
  learn(rgba, cx, cy, radius) {
    const { width: w, height: h } = this;
    const pelota = new Float32Array(CASILLEROS);
    const fondo = new Float32Array(CASILLEROS);
    const rIn2 = (radius * 0.6) ** 2;
    const rOut2 = (radius * 1.35) ** 2;
    let nb = 0;
    let nf = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d2 = dx * dx + dy * dy;
        const dentro = d2 <= rIn2;
        if (!dentro && d2 < rOut2) continue;
        const i = (y * w + x) * 4;
        for (const k of BRILLOS) {
          const q = casillero(
            Math.min(255, rgba[i] * k),
            Math.min(255, rgba[i + 1] * k),
            Math.min(255, rgba[i + 2] * k),
          );
          if (dentro) {
            pelota[q]++;
            nb++;
          } else {
            fondo[q]++;
            nf++;
          }
        }
      }
    }
    if (nb < 12 * BRILLOS.length || nf < 50 * BRILLOS.length) return { ok: false, motivo: "imagen-chica" };

    const anterior = [this.prob, this.colorPelota, this.pelota, this.fondoEscaneo, this.fondo];
    this.pelota = normalizar(suavizar(pelota));
    const escaneo = normalizar(suavizar(fondo));
    if (this.cuadrosPrevios > 0) {
      const previo = normalizar(suavizar(this.previo));
      for (let q = 0; q < CASILLEROS; q++) escaneo[q] = 0.6 * escaneo[q] + 0.4 * previo[q];
    }
    this.fondoEscaneo = escaneo;
    this.fondo = escaneo;
    this.#armarTablas();

    // Qué parte del fondo se confundiría con la pelota.
    let confusos = 0;
    for (let q = 0; q < CASILLEROS; q++) if (this.prob[q] >= UMBRAL) confusos += fondo[q];
    const fuga = confusos / nf;

    // ¿Aparece una pelota redonda en el círculo? Se mira sólo esa zona para que
    // una pared parecida (que el juego después aprende como fondo) no la tape.
    this.hasPrev = false;
    this.hasPrev2 = false;
    this.acumulado.fill(0);
    this.cuadros = 0;
    const det = this.detect(rgba, { ventana: { x: cx, y: cy, r: radius * 1.7 }, aprender: false });
    const encontrada = det !== null && Math.hypot(det.x - cx, det.y - cy) < radius * 0.6 && det.r > radius * 0.4;
    if (!encontrada || fuga > 0.45) {
      [this.prob, this.colorPelota, this.pelota, this.fondoEscaneo, this.fondo] = anterior;
      return { ok: false, motivo: encontrada ? "fondo-parecido" : "no-se-distingue", fuga };
    }
    return { ok: true, fuga, det, aviso: fuga > 0.15 ? "fondo-parecido" : null };
  }

  forget() {
    this.prob = null;
    this.hasPrev = false;
    this.hasPrev2 = false;
    this.last = null;
    this.previo.fill(0);
    this.cuadrosPrevios = 0;
  }

  #armarTablas() {
    const prob = new Float32Array(CASILLEROS);
    const color = new Float32Array(CASILLEROS);
    let max = 0;
    for (let q = 0; q < CASILLEROS; q++) max = Math.max(max, this.pelota[q]);
    for (let q = 0; q < CASILLEROS; q++) {
      const pb = this.pelota[q];
      prob[q] = pb / (pb + this.fondo[q] + 1e-9);
      // Qué tan típico es este color en la pelota (1 = de los más comunes).
      color[q] = Math.min(1, pb / (0.15 * max));
    }
    this.prob = prob;
    this.colorPelota = color;
  }

  // Suma al fondo lo que se ve fuera de la pelota, para adaptarse al lugar.
  #aprenderFondo(rgba, best) {
    const { width: w, height: h, acumulado } = this;
    const r2 = best ? (best.r * 2 + 3) ** 2 : -1;
    for (let y = 0; y < h; y += 2) {
      for (let x = (y >> 1) & 1; x < w; x += 2) {
        if (best && (x + 0.5 - best.x) ** 2 + (y + 0.5 - best.y) ** 2 < r2) continue;
        const i = (y * w + x) * 4;
        acumulado[casillero(rgba[i], rgba[i + 1], rgba[i + 2])]++;
      }
    }
    if (++this.cuadros % CUADROS_POR_ACTUALIZACION) return;
    const vivo = normalizar(suavizar(acumulado));
    const fondo = new Float32Array(CASILLEROS);
    for (let q = 0; q < CASILLEROS; q++) fondo[q] = 0.25 * this.fondoEscaneo[q] + 0.75 * vivo[q];
    this.fondo = fondo;
    for (let q = 0; q < CASILLEROS; q++) acumulado[q] *= 0.5;
    this.#armarTablas();
  }

  // Busca la pelota.
  // camera: {K, R} del cuadro (ver homografia) para usar la pista de
  //   movimiento; null si no se sabe cómo se movió la cámara.
  // near: dónde estaba la pelota hace poco ({x, y, r}).
  // ventana: {x, y, r} para buscar sólo en esa zona.
  detect(rgba, opciones = {}) {
    return this.detectAll(rgba, opciones)[0] ?? null;
  }

  // Como detect, pero devuelve todas las manchas que podrían ser la pelota (las
  // mejores primero), para que el seguimiento elija la que tiene sentido.
  // foco: {x, y, r} zona donde se espera la pelota (en vuelo): ahí se acepta con
  //   menos probabilidad, porque a toda velocidad se ve borrosa y mezclada con el fondo.
  detectAll(rgba, { camera = null, near = null, ventana = null, foco = null, aprender = true } = {}) {
    if (!this.prob) return [];
    const { width: w, height: h, prob, colorPelota, score, mask, prev, prev2, moving } = this;
    const n = w * h;

    // Cuadro repetido (la pantalla refresca más rápido que la cámara). Se compara
    // entero: si sólo se movió la pelota, el cambio puede ser de pocos píxeles.
    if (this.hasPrev && !ventana) {
      let igual = true;
      for (let j = 0; j < n * 4; j += 4) {
        if (rgba[j] !== prev[j] || rgba[j + 1] !== prev[j + 1] || rgba[j + 2] !== prev[j + 2]) {
          igual = false;
          break;
        }
      }
      if (igual) return this.last ? this.last.candidatas : [];
    }

    // Homografías que llevan cada píxel de este cuadro a los dos anteriores,
    // descontando cuánto giró la cámara (en mano se mueve todo el tiempo).
    const h1 = camera && this.hasPrev && this.camPrev ? homografia(camera, this.camPrev) : null;
    const h2 = h1 && this.hasPrev2 && this.camPrev2 ? homografia(camera, this.camPrev2) : null;
    const v2 = ventana ? ventana.r * ventana.r : 0;
    const f2 = foco ? foco.r * foco.r : 0;

    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i++) {
        moving[i] = 0;
        if (ventana && (x + 0.5 - ventana.x) ** 2 + (y + 0.5 - ventana.y) ** 2 > v2) {
          score[i] = 0;
          mask[i] = 0;
          continue;
        }
        const j = i * 4;
        const r = rgba[j];
        const g = rgba[j + 1];
        const b = rgba[j + 2];
        const q = casillero(r, g, b);
        let s = prob[q];
        const k1 = h1 ? muestra(h1, x, y, w, h) : -1;
        if (k1 >= 0) {
          const d = Math.abs(r - prev[k1]) + Math.abs(g - prev[k1 + 1]) + Math.abs(b - prev[k1 + 2]);
          if (d > DIFERENCIA_MOVIMIENTO) {
            moving[i] = 1;
            // Si este píxel se volvió más "pelota" que antes, la pelota llegó acá;
            // si se volvió menos, es el hueco que dejó atrás.
            const antes = prob[casillero(prev[k1], prev[k1 + 1], prev[k1 + 2])];
            s += 0.6 * Math.max(0, s - antes);
            const k2 = h2 ? muestra(h2, x, y, w, h) : -1;
            if (k2 >= 0) {
              const d2 = Math.abs(r - prev2[k2]) + Math.abs(g - prev2[k2 + 1]) + Math.abs(b - prev2[k2 + 2]);
              if (d2 > DIFERENCIA_MOVIMIENTO) s += 0.25 * colorPelota[q];
            }
          } else {
            s *= FACTOR_QUIETO;
          }
        }
        score[i] = s;
        const enFoco = foco && (x + 0.5 - foco.x) ** 2 + (y + 0.5 - foco.y) ** 2 < f2;
        mask[i] = s >= (enFoco ? UMBRAL_FOCO : UMBRAL) ? 1 : 0;
      }
    }
    this.conMovimiento = Boolean(h1);
    if (!ventana) {
      this.hasPrev2 = this.hasPrev;
      this.camPrev2 = this.camPrev;
      prev2.set(prev);
      prev.set(rgba.subarray(0, n * 4));
      this.hasPrev = true;
      this.camPrev = camera;
    }

    dilatar(mask, this.tmp, w, h, 1);
    dilatar(this.tmp, this.closed, w, h, 0);

    const candidatas = this.#manchas(near);
    this.last = { candidatas };
    if (aprender && !ventana) this.#aprenderFondo(rgba, candidatas[0] ?? null);
    return candidatas;
  }

  #manchas(near) {
    const { width: w, height: h, closed, labels, stack, moving } = this;
    const n = w * h;
    const rMax = 0.45 * Math.min(w, h);
    labels.fill(0);
    let etiqueta = 0;
    const todas = [];

    for (let inicio = 0; inicio < n; inicio++) {
      if (!closed[inicio] || labels[inicio]) continue;
      etiqueta++;
      let tope = 0;
      stack[tope++] = inicio;
      labels[inicio] = etiqueta;
      let cnt = 0;
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      let mov = 0;
      let x0 = w;
      let x1 = 0;
      let y0 = h;
      let y1 = 0;
      while (tope > 0) {
        const i = stack[--tope];
        const x = i % w;
        const y = (i - x) / w;
        cnt++;
        sx += x;
        sy += y;
        sxx += x * x;
        syy += y * y;
        sxy += x * y;
        mov += moving[i];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const k = yy * w + xx;
            if (closed[k] && !labels[k]) {
              labels[k] = etiqueta;
              stack[tope++] = k;
            }
          }
        }
      }
      if (cnt < AREA_MINIMA) continue;

      const mx = sx / cnt;
      const my = sy / cnt;
      const forma = ejes(sxx / cnt - mx * mx, syy / cnt - my * my, sxy / cnt - mx * my);
      if (forma.alargada > 4 || cnt / (Math.PI * forma.rMayor * forma.rMenor) < 0.45 || forma.rMenor > rMax) continue;

      let score = Math.min(cnt / (Math.PI * forma.rMayor * forma.rMenor), 1) * Math.min(1, cnt / 40) * (1 + (0.5 * mov) / cnt);
      if (forma.alargada > 1.6) score *= 0.8;
      if (near) {
        const d = Math.hypot(mx + 0.5 - near.x, my + 0.5 - near.y) / (3 * near.r + 8);
        score *= 1 / (1 + d * d);
      }
      if (score > 0.08) todas.push({ etiqueta, score, mov: mov / cnt, caja: [x0, y0, x1, y1], mx, my, forma, cnt });
    }
    todas.sort((a, b) => b.score - a.score);
    const conMovimiento = this.conMovimiento;
    return todas.slice(0, CANDIDATAS).map((m) => ({ ...this.#refinar(m), moving: conMovimiento ? m.mov : null }));
  }

  // Centro y radio con precisión de fracciones de píxel.
  #refinar(m) {
    const { width: w, height: h, labels, score } = this;
    const fino = momentosSuaves(w, h, labels, score, m.etiqueta, m.caja);
    return { ...fino, area: m.cnt, score: m.score, moving: m.mov };
  }

  // Vuelve a medir la pelota en un recorte de la cámara con más resolución.
  // guess: {x, y, r} en píxeles del recorte. Devuelve {x, y, r, alargada} en
  // píxeles del recorte, o null si no la encuentra donde se esperaba.
  refine(rgba, w, h, guess) {
    if (!this.prob) return null;
    const n = w * h;
    if (!this.recorte || this.recorte.n !== n) {
      this.recorte = {
        n,
        score: new Float32Array(n),
        mask: new Uint8Array(n),
        tmp: new Uint8Array(n),
        closed: new Uint8Array(n),
        labels: new Int32Array(n),
        stack: new Int32Array(n),
      };
    }
    const { score, mask, tmp, closed, labels, stack } = this.recorte;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const s = this.prob[casillero(rgba[j], rgba[j + 1], rgba[j + 2])];
      score[i] = s;
      mask[i] = s >= UMBRAL ? 1 : 0;
    }
    // Con más resolución los gajos son más grandes: cierre de 5x5.
    dilatar(mask, tmp, w, h, 1);
    dilatar(tmp, closed, w, h, 1);
    dilatar(closed, tmp, w, h, 0);
    dilatar(tmp, closed, w, h, 0);

    // Semilla: el píxel de pelota más cercano a donde se la esperaba.
    let semilla = -1;
    let mejor = Infinity;
    const busca = Math.max(2, guess.r * 0.6);
    for (let y = Math.max(0, Math.floor(guess.y - busca)); y <= Math.min(h - 1, guess.y + busca); y++) {
      for (let x = Math.max(0, Math.floor(guess.x - busca)); x <= Math.min(w - 1, guess.x + busca); x++) {
        const d = (x + 0.5 - guess.x) ** 2 + (y + 0.5 - guess.y) ** 2;
        if (closed[y * w + x] && d < mejor) {
          mejor = d;
          semilla = y * w + x;
        }
      }
    }
    if (semilla < 0) return null;

    labels.fill(0);
    let tope = 0;
    stack[tope++] = semilla;
    labels[semilla] = 1;
    let x0 = w;
    let x1 = 0;
    let y0 = h;
    let y1 = 0;
    while (tope > 0) {
      const i = stack[--tope];
      const x = i % w;
      const y = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const k = yy * w + xx;
          if (closed[k] && !labels[k]) {
            labels[k] = 1;
            stack[tope++] = k;
          }
        }
      }
    }
    // Si la mancha toca el borde del recorte, el recorte no alcanzó: no sirve.
    if (x0 === 0 || y0 === 0 || x1 === w - 1 || y1 === h - 1) return null;
    // Las demás manchas (un pie, otra cosa) no cuentan.
    for (let i = 0; i < n; i++) if (closed[i] && !labels[i]) labels[i] = 2;

    const fino = momentosSuaves(w, h, labels, score, 1, [x0, y0, x1, y1]);
    const cerca = Math.hypot(fino.x - guess.x, fino.y - guess.y) < guess.r * 0.6;
    const parecido = fino.r > guess.r * 0.6 && fino.r < guess.r * 1.5;
    return cerca && parecido ? fino : null;
  }
}

// Momentos de la mancha `etiqueta` ponderados por la probabilidad de cada píxel:
// dentro de la mancha (huecos del cierre incluidos) pesa 1; en el borde, según
// su probabilidad. Otras manchas no cuentan.
function momentosSuaves(w, h, labels, score, etiqueta, [x0, y0, x1, y1]) {
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let y = Math.max(0, y0 - 2); y <= Math.min(h - 1, y1 + 2); y++) {
    for (let x = Math.max(0, x0 - 2); x <= Math.min(w - 1, x1 + 2); x++) {
      const i = y * w + x;
      const l = labels[i];
      if (l !== 0 && l !== etiqueta) continue;
      const p =
        l === etiqueta
          ? Math.max(0.6, Math.min(1, score[i] / UMBRAL))
          : Math.min(1, Math.max(0, (score[i] - 0.2) / (UMBRAL - 0.2)));
      if (p <= 0) continue;
      const cx = x + 0.5;
      const cy = y + 0.5;
      sw += p;
      sx += p * cx;
      sy += p * cy;
      sxx += p * cx * cx;
      syy += p * cy * cy;
      sxy += p * cx * cy;
    }
  }
  const x = sx / sw;
  const y = sy / sw;
  const forma = ejes(sxx / sw - x * x, syy / sw - y * y, sxy / sw - x * y);
  const rArea = Math.sqrt(sw / Math.PI);
  // Redonda: promedio de dos estimaciones independientes. Con estela de
  // movimiento el eje menor es el diámetro real.
  const r = forma.alargada < 1.3 ? (rArea + (forma.rMenor + forma.rMayor) / 2) / 2 : forma.rMenor;
  return { x, y, r, alargada: forma.alargada };
}

// Ejes de una mancha a partir de sus varianzas. En un disco de radio r la
// varianza en cualquier eje es r²/4 (+1/12 por los píxeles).
function ejes(cxx, cyy, cxy) {
  const tr = (cxx + cyy) / 2;
  const disc = Math.sqrt(Math.max(0, tr * tr - (cxx * cyy - cxy * cxy)));
  const rMenor = 2 * Math.sqrt(Math.max(tr - disc - 1 / 12, 0.05));
  const rMayor = 2 * Math.sqrt(Math.max(tr + disc - 1 / 12, 0.05));
  return { rMenor, rMayor, alargada: rMayor / rMenor };
}
