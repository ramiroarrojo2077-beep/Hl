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
const CANDIDATAS = 8;
const BRILLOS = [0.82, 0.91, 1, 1.1]; // la pelota de lejos o a la sombra cambia de brillo
// Para los colores casi grises (el blanco de la pelota) el brillo es lo único que
// los distingue de un piso gris claro: ahí se tolera menos (la sombra de la
// pelota ya está en el escaneo).
const BRILLOS_GRISES = [0.95, 0.98, 1, 1.04];
// Interruptores para comparar variantes en el banco de pruebas (en la app, todos falsos).
const EXP_DET = globalThis.process?.env?.EXP ?? "";
const SIN_PISO = EXP_DET.includes("sinPiso");
const PISO_SIEMPRE = EXP_DET.includes("pisoSiempre");
const SIN_CORTE_ADAPTIVO = EXP_DET.includes("sinCorteAdaptivo");
const SIN_TAMANO_PISO = EXP_DET.includes("sinTamanoPiso");
const SIN_CONTRASTE_TAMANO = EXP_DET.includes("sinContrasteTamano");
const SIN_BRILLO_GRIS = EXP_DET.includes("sinBrilloGris");
const SIN_APERTURA = EXP_DET.includes("sinApertura");
const SIN_AISLADA = EXP_DET.includes("sinAislada");
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
// Se hace por filas y después por columnas (6 lecturas por píxel en vez de 9).
let filas3 = new Uint8Array(0);
function dilatar(src, dst, w, h, valor) {
  const n = w * h;
  if (filas3.length < n) filas3 = new Uint8Array(n);
  const f = filas3;
  const otro = 1 - valor;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      const i = o + x;
      f[i] = src[i] === valor || (x > 0 && src[i - 1] === valor) || (x < w - 1 && src[i + 1] === valor) ? valor : otro;
    }
  }
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      const i = o + x;
      dst[i] = f[i] === valor || (y > 0 && f[i - w] === valor) || (y < h - 1 && f[i + w] === valor) ? valor : otro;
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
  return homografiaEntre(actual, anterior);
}

// Homografía (3x3 fila por fila) de los píxeles de `actual` a los de `anterior`
// suponiendo que la cámara sólo giró.
export function homografiaEntre(actual, anterior) {
  const rel = mul3(trasp3(anterior.R), actual.R);
  return mul3(mul3(anterior.K, rel), inv3(actual.K));
}

// Lo mismo para los puntos del piso, descontando además cuánto se desplazó el
// celular (a 1 o 2 m, un centímetro de la mano corre el piso varios píxeles).
// Un punto X del piso (n·X = pisoY, n hacia arriba) visto en la dirección d
// desde la cámara actual: X − p_ant ∝ (I + Δ·nᵀ / h)·d, con Δ = p_act − p_ant y
// h = pisoY − p_act.y. null si no se conocen las posiciones.
function homografiaPiso(actual, anterior) {
  if (SIN_PISO) return null;
  if (!actual.p || !anterior.p || actual.pisoY == null) return null;
  const h = actual.pisoY - actual.p[1];
  if (!(h < -0.05)) return null;
  const dx = actual.p[0] - anterior.p[0];
  const dy = actual.p[1] - anterior.p[1];
  const dz = actual.p[2] - anterior.p[2];
  // Con el celular quieto (apoyado) el desplazamiento que informa ARCore es sólo
  // ruido de ~1 mm, y dividido por la altura movería el piso un píxel: ahí basta
  // con el giro.
  if (Math.hypot(dx, dy, dz) < 0.004 && !PISO_SIEMPRE) return null;
  // I + Δ·nᵀ/h con n = (0, 1, 0): sólo cambia la segunda columna.
  const M = [1, dx / h, 0, 0, 1 + dy / h, 0, 0, dz / h, 1];
  return mul3(mul3(mul3(anterior.K, trasp3(anterior.R)), mul3(M, actual.R)), inv3(actual.K));
}

// Horizonte en la imagen: coeficientes (a, b, c) tales que a·x + b·y + c es la
// componente vertical (hacia arriba) del rayo del píxel (x, y). Negativa: el rayo
// baja (piso). camera: {K, R} como en homografia; null si no se sabe.
export function horizonte(camera) {
  if (!camera) return null;
  const Ki = inv3(camera.K);
  const R = camera.R;
  return [0, 1, 2].map((j) => R[3] * Ki[j] + R[4] * Ki[3 + j] + R[5] * Ki[6 + j]);
}

// ¿El píxel (x, y) mira al piso (con un margen de ~1°)?
const MARGEN_HORIZONTE = 0.02;
const alPiso = (hz, x, y) => !hz || hz[0] * (x + 0.5) + hz[1] * (y + 0.5) + hz[2] < MARGEN_HORIZONTE;

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
    // Histogramas del fondo por zona: [0] el piso (debajo del horizonte) y
    // [1] lo de arriba (paredes, árboles, cielo). Cada píxel se compara con el
    // fondo de su zona: un cielo blanco no hace que una pelota blanca en el
    // pasto parezca fondo, y una pared clara sí cuenta cuando la pelota vuela delante.
    this.previo = [new Float32Array(CASILLEROS), new Float32Array(CASILLEROS)];
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
    this.estela = new Uint8Array(n);
    this.alfa = new Float32Array(n);
    this.labels2 = new Int32Array(n);
    this.labels = new Int32Array(n);
    this.stack = new Int32Array(n);
    this.last = null;
    this.acumulado = [new Float32Array(CASILLEROS), new Float32Array(CASILLEROS)];
    this.cuadros = 0;
  }

  // Antes de escanear: junta los colores del lugar (el piso) como fondo.
  // excluir: {x, y, r} zona a ignorar (donde debería estar la pelota).
  // camera: {K, R} del cuadro; si se sabe, sólo cuenta lo que está debajo del
  // horizonte: la pelota quieta está en el piso, y el cielo o una pared clara
  // (blancos como la pelota) harían que el blanco parezca "fondo".
  observeBackground(rgba, excluir = null, camera = null) {
    const { width: w, height: h, previo } = this;
    const r2 = excluir ? (excluir.r * 1.4) ** 2 : -1;
    const hz = horizonte(camera);
    for (let y = 1; y < h; y += 3) {
      for (let x = 1; x < w; x += 3) {
        if (excluir && (x + 0.5 - excluir.x) ** 2 + (y + 0.5 - excluir.y) ** 2 < r2) continue;
        const i = (y * w + x) * 4;
        previo[alPiso(hz, x, y) ? 0 : 1][casillero(rgba[i], rgba[i + 1], rgba[i + 2])]++;
      }
    }
  }

  // Aprende los colores de la pelota: tiene que ocupar el círculo de centro
  // (cx, cy) y radio `radius`. Toma como pelota el 60 % interior del círculo
  // y como fondo todo lo que queda fuera de 1,35 radios.
  // Aprende los colores de la pelota con una sola imagen (ver aprenderVistas).
  learn(rgba, cx, cy, radius, camera = null) {
    return this.aprenderVistas([this.muestrasVista(rgba, cx, cy, radius, camera)], { rgba, cx, cy, radius, camera });
  }

  // Lo que hay en una imagen para aprender, ya contado en histogramas (sin
  // guardar la foto: es liviano y no traba la cámara mientras se escanea):
  // los colores de la pelota (el 60 % interior del círculo), con y sin la
  // tolerancia angosta de brillo para los grises (ver BRILLOS_GRISES), los del
  // fondo (fuera de 1,35 radios; por zona: piso o arriba del horizonte) y dos
  // histogramas chicos (pelota y lo que la rodea) para comparar vistas.
  muestrasVista(rgba, cx, cy, radius, camera = null) {
    const { width: w, height: h } = this;
    const hz = horizonte(camera);
    const rIn2 = (radius * 0.6) ** 2;
    const rOut2 = (radius * 1.35) ** 2;
    const rAnillo2 = (radius * 1.9) ** 2;
    const pelota = new Float32Array(CASILLEROS);
    const pelotaGris = new Float32Array(CASILLEROS);
    const fondo = [new Float32Array(CASILLEROS), new Float32Array(CASILLEROS)];
    const chica = new Float32Array(512);
    const anillo = new Float32Array(512);
    let nb = 0;
    let nbGris = 0;
    const nf = [0, 0];
    const suma = [0, 0, 0, 0];
    let na = 0;
    for (let y = 0; y < h; y++) {
      const dy = y + 0.5 - cy;
      for (let x = 0; x < w; x++) {
        const dx = x + 0.5 - cx;
        const d2 = dx * dx + dy * dy;
        if (d2 > rIn2 && d2 < rOut2) continue;
        const i = (y * w + x) * 4;
        const r = rgba[i];
        const g = rgba[i + 1];
        const b = rgba[i + 2];
        const q8 = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
        if (d2 <= rIn2) {
          suma[0] += r;
          suma[1] += g;
          suma[2] += b;
          suma[3]++;
          chica[q8]++;
          const mx = Math.max(r, g, b);
          const gris = mx - Math.min(r, g, b) < 0.15 * mx + 6;
          for (const k of BRILLOS) {
            pelota[casillero(Math.min(255, r * k), Math.min(255, g * k), Math.min(255, b * k))]++;
            nb++;
          }
          for (const k of gris ? BRILLOS_GRISES : BRILLOS) {
            pelotaGris[casillero(Math.min(255, r * k), Math.min(255, g * k), Math.min(255, b * k))]++;
            nbGris++;
          }
        } else {
          const z = alPiso(hz, x, y) ? 0 : 1;
          const f = fondo[z];
          for (const k of BRILLOS) {
            f[casillero(Math.min(255, r * k), Math.min(255, g * k), Math.min(255, b * k))]++;
            nf[z]++;
          }
          if (d2 <= rAnillo2) {
            anillo[q8]++;
            na++;
          }
        }
      }
    }
    for (let q = 0; q < 512; q++) {
      chica[q] /= Math.max(1, suma[3]);
      anillo[q] /= Math.max(1, na);
    }
    return { pelota, pelotaGris, fondo, nb, nbGris, nf, suma, chica, anillo };
  }

  // Escaneo completo: varias vistas de la pelota desde distintos lados (o
  // girándola). Cada vista suma sus colores; el fondo de todas también.
  // vistas: lista de muestrasVista. final: la última imagen {rgba, cx, cy, radius,
  // camera}, para comprobar que con lo aprendido se ve una pelota redonda.
  aprenderVistas(vistas, final) {
    const { rgba, cx, cy, radius, camera } = final;
    // grisesAngostos: para los colores casi grises de la pelota se tolera menos
    // cambio de brillo (ver BRILLOS_GRISES); sólo si el fondo se le parece.
    const acumular = (grisesAngostos) => {
      const pelota = new Float32Array(CASILLEROS);
      const fondo = [new Float32Array(CASILLEROS), new Float32Array(CASILLEROS)];
      let nb = 0;
      const nf = [0, 0];
      const suma = [0, 0, 0, 0];
      for (const v of vistas) {
        const p = grisesAngostos ? v.pelotaGris : v.pelota;
        for (let q = 0; q < CASILLEROS; q++) pelota[q] += p[q];
        nb += grisesAngostos ? v.nbGris : v.nb;
        for (const z of [0, 1]) {
          for (let q = 0; q < CASILLEROS; q++) fondo[z][q] += v.fondo[z][q];
          nf[z] += v.nf[z];
        }
        for (let c = 0; c < 4; c++) suma[c] += v.suma[c];
      }
      return { pelota, fondo, nb, nf, suma };
    };
    // ¿El fondo de este escaneo se parece a la pelota? (con los colores tal cual)
    const parecido = (a) => {
      const z = a.nf[0] >= 50 * BRILLOS.length ? 0 : 1;
      const pb = normalizar(suavizar(a.pelota.slice()));
      const pf = normalizar(suavizar(a.fondo[z].slice()));
      let confusos = 0;
      for (let q = 0; q < CASILLEROS; q++) if (pb[q] >= pf[q]) confusos += a.fondo[z][q];
      return confusos / Math.max(1, a.nf[z]);
    };
    let acum = acumular(false);
    const fondoParecido = !SIN_BRILLO_GRIS && acum.nb > 0 && parecido(acum) > 0.13;
    if (fondoParecido) acum = acumular(true);
    const { pelota, fondo, nb, nf, suma } = acum;
    if (nb < 12 * BRILLOS.length || nf[0] + nf[1] < 50 * BRILLOS.length) return { ok: false, motivo: "imagen-chica" };

    this.cortesPrevios = null; // la pelota (y el corte) se aprenden de nuevo
    const anterior = [this.prob, this.probs, this.colorPelota, this.pelota, this.fondoEscaneo, this.fondo, this.colorMedio, this.cortes];
    this.pelota = normalizar(suavizar(pelota));
    // Color promedio de la pelota: borrosa por la velocidad, se mezcla con el fondo
    // en esa dirección (ver #estelas).
    this.colorMedio = [suma[0] / suma[3], suma[1] / suma[3], suma[2] / suma[3]];
    // Fondo de cada zona: lo que rodea al círculo y lo que se vio antes de escanear.
    const escaneo = [0, 1].map((z) => {
      const total = this.previo[z].reduce((a, v) => a + v, 0);
      const delEscaneo = nf[z] >= 50 * BRILLOS.length ? normalizar(suavizar(fondo[z])) : null;
      const antes = total >= 50 ? normalizar(suavizar(this.previo[z])) : null;
      if (delEscaneo && antes) return delEscaneo.map((v, q) => 0.6 * v + 0.4 * antes[q]);
      return delEscaneo ?? antes;
    });
    // Si de una zona no se vio nada, se usa la otra.
    escaneo[0] ??= escaneo[1];
    escaneo[1] ??= escaneo[0];
    this.fondoEscaneo = escaneo;
    this.fondo = escaneo.slice();
    this.#armarTablas();

    // Qué parte del fondo (el piso, o lo que haya) se confundiría con la pelota.
    // Con los colores tal cual (antes de subir el corte): es lo que hay que
    // avisar, aunque el corte después lo compense en parte.
    const z = nf[0] >= 50 * BRILLOS.length ? 0 : 1;
    let confusos = 0;
    let confusosAlFinal = 0;
    for (let q = 0; q < CASILLEROS; q++) {
      const pb = this.pelota[q];
      if (pb / (pb + this.fondo[z][q] + 1e-9) >= UMBRAL) confusos += fondo[z][q];
      if (this.probs[z][q] >= UMBRAL) confusosAlFinal += fondo[z][q];
    }
    const fuga = confusos / nf[z];
    // Lo que se confunde aun después de subir el corte: si es mucho, no se puede.
    const fugaFinal = confusosAlFinal / nf[z];

    // ¿Aparece una pelota redonda en el círculo? Se mira sólo esa zona para que
    // una pared parecida (que el juego después aprende como fondo) no la tape.
    this.hasPrev = false;
    this.hasPrev2 = false;
    for (const a of this.acumulado) a.fill(0);
    this.cuadros = 0;
    // (Entre todas las candidatas: con un piso moteado, un puntito puede tener
    // más puntaje que la pelota, pero la pelota está centrada y llena el círculo.)
    const det =
      this.detectAll(rgba, { ventana: { x: cx, y: cy, r: radius * 1.7 }, aprender: false, camera }).find(
        (c) => Math.hypot(c.x - cx, c.y - cy) < radius * 0.6 && c.r > radius * 0.4,
      ) ?? null;
    const encontrada = det !== null;
    if (!encontrada || fugaFinal > 0.45) {
      [this.prob, this.probs, this.colorPelota, this.pelota, this.fondoEscaneo, this.fondo, this.colorMedio, this.cortes] = anterior;
      this.cortesPrevios = this.cortes;
      return { ok: false, motivo: encontrada ? "fondo-parecido" : "no-se-distingue", fuga };
    }
    this.fondoParecido = fondoParecido;
    return { ok: true, fuga, det, aviso: fuga > 0.15 ? "fondo-parecido" : null };
  }

  // ---------- Escaneo del entorno ----------
  // Después de escanear la pelota, mirando el lugar donde se va a jugar (piso,
  // arco, paredes): se aprende bien qué es "fondo" en ese lugar. excluir: zonas
  // {x, y, r} donde puede estar la pelota (no se cuentan como fondo).
  empezarEntorno() {
    this.entorno = [new Float32Array(CASILLEROS), new Float32Array(CASILLEROS)];
    this.entornoCuadros = 0;
  }

  observarEntorno(rgba, camera = null, excluir = []) {
    if (!this.entorno) return;
    const { width: w, height: h } = this;
    const hz = horizonte(camera);
    const zonas = excluir.filter(Boolean).map((e) => ({ x: e.x, y: e.y, r2: (e.r * 2 + 3) ** 2 }));
    for (let y = 0; y < h; y += 2) {
      for (let x = (y >> 1) & 1; x < w; x += 2) {
        if (zonas.some((z) => (x + 0.5 - z.x) ** 2 + (y + 0.5 - z.y) ** 2 < z.r2)) continue;
        // Lo que es claramente color de pelota (por si la pelota no salió entre
        // las candidatas) tampoco: no tiene que pasar a ser "fondo".
        if (this.score[y * w + x] >= 0.85) continue;
        const i = (y * w + x) * 4;
        this.entorno[alPiso(hz, x, y) ? 0 : 1][casillero(rgba[i], rgba[i + 1], rgba[i + 2])]++;
      }
    }
    this.entornoCuadros++;
  }

  // Mezcla lo visto del entorno con el fondo del escaneo. Devuelve qué parte
  // del entorno se confunde con la pelota (o null si no alcanzó lo que se vio).
  terminarEntorno() {
    const e = this.entorno;
    this.entorno = null;
    if (!e || this.entornoCuadros < 3 || !this.pelota) return null;
    let confusion = null;
    for (const z of [0, 1]) {
      const total = e[z].reduce((a, v) => a + v, 0);
      if (total < 500) continue;
      const visto = normalizar(suavizar(e[z].slice()));
      const mezcla = this.fondoEscaneo[z].map((v, q) => 0.35 * v + 0.65 * visto[q]);
      this.fondoEscaneo[z] = mezcla;
      this.fondo[z] = mezcla.slice();
      if (z === 0) {
        // Con los colores tal cual: ¿cuánto del piso pasaría por pelota?
        confusion = 0;
        for (let q = 0; q < CASILLEROS; q++) {
          const pb = this.pelota[q];
          if (pb / (pb + mezcla[q] + 1e-9) >= UMBRAL) confusion += e[z][q] / total;
        }
      }
    }
    this.fondoEscaneo[1] ??= this.fondoEscaneo[0];
    this.cortesPrevios = null;
    this.#armarTablas();
    if (confusion !== null && confusion > 0.13) this.fondoParecido = true;
    return confusion;
  }

  forget() {
    this.entorno = null;
    this.prob = null;
    this.fondoParecido = false;
    this.cortes = null;
    this.cortesPrevios = null;
    this.hasPrev = false;
    this.hasPrev2 = false;
    this.last = null;
    for (const p of this.previo) p.fill(0);
  }

  #armarTablas() {
    const probs = [new Float32Array(CASILLEROS), new Float32Array(CASILLEROS)];
    const color = new Float32Array(CASILLEROS);
    let max = 0;
    for (let q = 0; q < CASILLEROS; q++) max = Math.max(max, this.pelota[q]);
    for (let q = 0; q < CASILLEROS; q++) {
      const pb = this.pelota[q];
      probs[0][q] = pb / (pb + this.fondo[0][q] + 1e-9);
      probs[1][q] = pb / (pb + this.fondo[1][q] + 1e-9);
      // Qué tan típico es este color en la pelota (1 = de los más comunes).
      color[q] = Math.min(1, pb / (0.15 * max));
    }
    // Con un fondo parecido a la pelota (un piso gris claro moteado y una pelota
    // blanca) muchos colores del fondo pasan el 0,5. Se sube el corte hasta que
    // pase como pelota a lo sumo un 3 % del fondo, sin perder más de un 40 % de
    // la pelota (sus parches de color siguen pasando), y se reescala para que el
    // corte nuevo quede en 0,5 (el resto del detector no cambia).
    this.cortes = [UMBRAL, UMBRAL];
    if (!SIN_CORTE_ADAPTIVO) {
      this.cortes = [0, 1].map((z) => {
        let corte = UMBRAL;
        // Sólo si el fondo de verdad se confunde (más de un 13 % pasa como pelota):
        // con un fondo apenas parecido, subir el corte achica la pelota borrosa.
        let fp50 = 0;
        for (let q = 0; q < CASILLEROS; q++) if (probs[z][q] >= UMBRAL) fp50 += this.fondo[z][q];
        for (let k = fp50 > 0.13 ? 0 : 17; k <= 16; k++) {
          const c = UMBRAL + k * 0.025;
          let fp = 0;
          let tp = 0;
          for (let q = 0; q < CASILLEROS; q++) {
            if (probs[z][q] < c) continue;
            fp += this.fondo[z][q];
            tp += this.pelota[q];
          }
          if (tp < 0.6) break;
          corte = c;
          if (fp <= 0.03) break;
        }
        // Sin saltos de una actualización a la otra (la máscara titilaría).
        const antes = this.cortesPrevios?.[z];
        if (antes) corte = 0.6 * antes + 0.4 * corte;
        if (corte > UMBRAL) {
          const t = probs[z];
          for (let q = 0; q < CASILLEROS; q++)
            t[q] = t[q] < corte ? (t[q] * UMBRAL) / corte : UMBRAL + ((t[q] - corte) * (1 - UMBRAL)) / (1 - corte);
        }
        return corte;
      });
    }
    this.cortesPrevios = this.cortes;
    this.probs = probs;
    this.prob = probs[0];
    this.colorPelota = color;
  }

  // Promedio de "es pelota" y de "cambió" dentro del círculo (x, y, r) del último
  // cuadro (ver seguimiento: buscar la pelota quieta pegada a otra cosa).
  promedioEn(x, y, r) {
    const { width: w, height: h, score, moving } = this;
    let n = 0;
    let s = 0;
    let m = 0;
    const r2 = r * r;
    for (let yy = Math.max(0, Math.floor(y - r)); yy < Math.min(h, Math.ceil(y + r)); yy++)
      for (let xx = Math.max(0, Math.floor(x - r)); xx < Math.min(w, Math.ceil(x + r)); xx++) {
        if ((xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 > r2) continue;
        const i = yy * w + xx;
        n++;
        s += Math.min(1, score[i]);
        m += moving[i];
      }
    return n ? { score: s / n, moving: m / n } : null;
  }

  // ¿El punto (x, y) de la imagen chica está arriba del horizonte? (último cuadro)
  arribaDelHorizonte(x, y) {
    return !alPiso(this.hz, x - 0.5, y - 0.5);
  }

  // Suma al fondo lo que se ve fuera de la pelota (en el piso), para adaptarse al lugar.
  // excluir: zonas {x, y, r} que pueden ser la pelota (las mejores candidatas y
  // dónde la sigue el seguimiento): si una mancha del piso le gana a la pelota,
  // los colores de la pelota no tienen que pasar a ser "fondo".
  #aprenderFondo(rgba, excluir, hz) {
    const { width: w, height: h, acumulado } = this;
    const zonas = excluir.filter(Boolean).map((e) => ({ x: e.x, y: e.y, r2: (e.r * 2 + 3) ** 2 }));
    for (let y = 0; y < h; y += 2) {
      for (let x = (y >> 1) & 1; x < w; x += 2) {
        if (zonas.some((z) => (x + 0.5 - z.x) ** 2 + (y + 0.5 - z.y) ** 2 < z.r2)) continue;
        const i = (y * w + x) * 4;
        acumulado[alPiso(hz, x, y) ? 0 : 1][casillero(rgba[i], rgba[i + 1], rgba[i + 2])]++;
      }
    }
    if (++this.cuadros % CUADROS_POR_ACTUALIZACION) return;
    for (const z of [0, 1]) {
      const a = acumulado[z];
      if (a.reduce((x, v) => x + v, 0) < 200) continue;
      const vivo = normalizar(suavizar(a));
      const fondo = new Float32Array(CASILLEROS);
      for (let q = 0; q < CASILLEROS; q++) fondo[q] = 0.25 * this.fondoEscaneo[z][q] + 0.75 * vivo[q];
      this.fondo[z] = fondo;
      for (let q = 0; q < CASILLEROS; q++) a[q] *= 0.5;
    }
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
  // soloSuelo: buscar sólo debajo del horizonte (la pelota quieta está en el piso).
  // escalas: {min, max} radios (en píxeles) que puede tener la pelota, si se sabe.
  // radio: radio real de la pelota (m). Con la cámara y el piso (camera.p,
  //   camera.pisoY) se sabe de qué tamaño se vería apoyada en cada lugar.
  // etapa: "quieta" (se busca la pelota apoyada), "lista" (apoyada, pero la
  //   pueden patear: en el aire se ve más grande) o "vuelo".
  // proteger: {x, y, r} dónde el seguimiento sabe que está la pelota (no se
  //   aprende como fondo).
  detectAll(rgba, { camera = null, near = null, ventana = null, foco = null, aprender = true, soloSuelo = false, escalas = null, radio = null, etapa = null, proteger = null } = {}) {
    if (!this.prob) return [];
    const { width: w, height: h, probs, colorPelota, score, mask, prev, prev2, moving, estela, alfa } = this;
    const n = w * h;
    const cm = this.colorMedio;

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
      if (igual) {
        // La pantalla puede ir más rápido que la cámara: es la misma imagen.
        this.repetido = true;
        return this.last ? this.last.candidatas : [];
      }
    }
    if (!ventana) this.repetido = false;

    // Homografías que llevan cada píxel de este cuadro a los dos anteriores,
    // descontando cuánto giró la cámara (en mano se mueve todo el tiempo).
    const h1 = camera && this.hasPrev && this.camPrev ? homografia(camera, this.camPrev) : null;
    const h2 = h1 && this.hasPrev2 && this.camPrev2 ? homografia(camera, this.camPrev2) : null;
    // Para lo que está debajo del horizonte (el piso y lo que está sobre él), la
    // del piso: descuenta también el desplazamiento de la mano.
    const hp1 = h1 ? (homografiaPiso(camera, this.camPrev) ?? h1) : null;
    const hp2 = h2 ? (homografiaPiso(camera, this.camPrev2) ?? h2) : null;
    const v2 = ventana ? ventana.r * ventana.r : 0;
    const f2 = foco ? foco.r * foco.r : 0;
    const hz = horizonte(camera);
    if (!ventana) this.hz = hz;

    let pixelesEstela = 0;
    // Donde se espera la pelota en vuelo se acepta menos: el mismo color de
    // antes de subir el corte (ver #armarTablas).
    const umbralFoco = (this.cortes ?? [UMBRAL, UMBRAL]).map((c) => (UMBRAL_FOCO * UMBRAL) / Math.max(UMBRAL, c));
    for (let y = 0, i = 0; y < h; y++) {
      // Componente vertical del rayo, que cambia linealmente a lo largo de la fila.
      let hv = hz ? hz[0] * 0.5 + hz[1] * (y + 0.5) + hz[2] : -1;
      const dhv = hz ? hz[0] : 0;
      // Homografía al cuadro anterior, también lineal a lo largo de la fila.
      let hx = 0;
      let hy = 0;
      let hw = 1;
      let gx = 0;
      let gy = 0;
      let gw = 1;
      if (h1) {
        hx = h1[0] * 0.5 + h1[1] * (y + 0.5) + h1[2];
        hy = h1[3] * 0.5 + h1[4] * (y + 0.5) + h1[5];
        hw = h1[6] * 0.5 + h1[7] * (y + 0.5) + h1[8];
        gx = hp1[0] * 0.5 + hp1[1] * (y + 0.5) + hp1[2];
        gy = hp1[3] * 0.5 + hp1[4] * (y + 0.5) + hp1[5];
        gw = hp1[6] * 0.5 + hp1[7] * (y + 0.5) + hp1[8];
      }
      for (let x = 0; x < w; x++, i++, hv += dhv) {
        let k1 = -1;
        const pisoPx = hv < MARGEN_HORIZONTE;
        if (h1) {
          const px = Math.floor(pisoPx ? gx / gw : hx / hw);
          const py = Math.floor(pisoPx ? gy / gw : hy / hw);
          if (px >= 0 && py >= 0 && px < w && py < h) k1 = (py * w + px) * 4;
          hx += h1[0];
          hy += h1[3];
          hw += h1[6];
          gx += hp1[0];
          gy += hp1[3];
          gw += hp1[6];
        }
        moving[i] = 0;
        const piso = hv < MARGEN_HORIZONTE;
        if ((ventana && (x + 0.5 - ventana.x) ** 2 + (y + 0.5 - ventana.y) ** 2 > v2) || (soloSuelo && !piso)) {
          score[i] = 0;
          mask[i] = 0;
          estela[i] = 0;
          continue;
        }
        const j = i * 4;
        const r = rgba[j];
        const g = rgba[j + 1];
        const b = rgba[j + 2];
        const q = casillero(r, g, b);
        const prob = piso ? probs[0] : probs[1];
        let s = prob[q];
        estela[i] = 0;
        if (k1 >= 0) {
          const d = Math.abs(r - prev[k1]) + Math.abs(g - prev[k1 + 1]) + Math.abs(b - prev[k1 + 2]);
          if (cm && d > 18) {
            // ¿Cambió como cambia un píxel por el que pasa la pelota borrosa? Queda
            // una mezcla α·pelota + (1-α)·fondo: el cambio apunta hacia el color de
            // la pelota. (Lo que deja atrás va al revés, y otras cosas, a otro lado.)
            const ur = cm[0] - prev[k1];
            const ug = cm[1] - prev[k1 + 1];
            const ub = cm[2] - prev[k1 + 2];
            const uu = ur * ur + ug * ug + ub * ub;
            if (uu > 900) {
              const vr = r - prev[k1];
              const vg = g - prev[k1 + 1];
              const vb = b - prev[k1 + 2];
              const a = (vr * ur + vg * ug + vb * ub) / uu;
              const er = vr - a * ur;
              const eg = vg - a * ug;
              const eb = vb - a * ub;
              if (a > 0.1 && a < 1.4 && (er * er + eg * eg + eb * eb) / uu < 0.12) {
                // Y no estaba ahí dos cuadros antes (es la posición de ahora).
                const k2 = h2 ? muestra(pisoPx ? hp2 : h2, x, y, w, h) : -1;
                const d2 = k2 >= 0 ? Math.abs(r - prev2[k2]) + Math.abs(g - prev2[k2 + 1]) + Math.abs(b - prev2[k2 + 2]) : 99;
                if (d2 > 18) {
                  estela[i] = 1;
                  alfa[i] = Math.min(1, a);
                  pixelesEstela++;
                }
              }
            }
          }
          if (d > DIFERENCIA_MOVIMIENTO) {
            moving[i] = 1;
            // Si este píxel se volvió más "pelota" que antes, la pelota llegó acá;
            // si se volvió menos, es el hueco que dejó atrás.
            const antes = prob[casillero(prev[k1], prev[k1 + 1], prev[k1 + 2])];
            s += 0.6 * Math.max(0, s - antes);
            const k2 = h2 ? muestra(pisoPx ? hp2 : h2, x, y, w, h) : -1;
            if (k2 >= 0) {
              const d2 = Math.abs(r - prev2[k2]) + Math.abs(g - prev2[k2 + 1]) + Math.abs(b - prev2[k2 + 2]);
              if (d2 > DIFERENCIA_MOVIMIENTO) s += 0.25 * colorPelota[q];
            }
          } else if (foco && (x + 0.5 - foco.x) ** 2 + (y + 0.5 - foco.y) ** 2 >= f2) {
            // En vuelo, lo que está quieto lejos de donde se espera la pelota pesa menos.
            s *= FACTOR_QUIETO;
          }
        }
        score[i] = s;
        const enFoco = foco && (x + 0.5 - foco.x) ** 2 + (y + 0.5 - foco.y) ** 2 < f2;
        mask[i] = s >= (enFoco ? (piso ? umbralFoco[0] : umbralFoco[1]) : UMBRAL) ? 1 : 0;
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

    // Si el piso se parece a la pelota (hubo que subir el corte de color: un
    // granito o un terrazo claro), primero se borran los puntitos sueltos; si no,
    // al unir los gajos de la pelota se unirían también entre ellos en una red.
    // (Sólo buscando la pelota quieta: recién pateada se ve borrosa y finita, y
    // esto la achicaría.)
    let fuente = mask;
    const etapaActual = etapa ?? (near ? "vuelo" : soloSuelo ? "quieta" : "lista");
    if (!SIN_APERTURA && this.#pisoParecido && etapaActual === "quieta") {
      dilatar(mask, this.tmp, w, h, 0);
      dilatar(this.tmp, this.closed, w, h, 1);
      fuente = this.closed;
    }
    dilatar(fuente, this.tmp, w, h, 1);
    dilatar(this.tmp, this.closed, w, h, 0);

    this.#armarMapaRadio(ventana || SIN_TAMANO_PISO ? null : camera, radio, etapaActual);
    const manchas = this.#manchas(near);
    const formas = this.#picos(near, escalas);
    const estelas = h1 && cm && pixelesEstela >= 6 ? this.#estelas(near) : [];
    if (this.depurar) this.depuracion = { manchas, formas, estelas, todas: this.todasManchas };
    const candidatas = this.#combinar(manchas, [...formas, ...estelas]);
    this.last = { candidatas };
    // Lo que no se aprende como fondo: la mejor candidata y, si el piso se parece
    // a la pelota (ahí el corte de color se ajusta con el fondo), también dónde el
    // seguimiento sabe que está la pelota, para que sus colores no pasen a "fondo".
    // (Excluir más candidatas empeora: las piernas nunca pasarían a ser fondo.)
    if (aprender && !ventana) this.#aprenderFondo(rgba, [candidatas[0], this.#pisoParecido ? proteger : null], hz);
    return candidatas;
  }

  // Radio en píxeles que tendría la pelota apoyada en el piso en cada zona de la
  // imagen (cada 4 píxeles; 0 si ahí no se ve piso). Lo mucho más chico que eso
  // no puede ser la pelota (los puntitos de un piso de granito, que tienen su
  // color); buscándola apoyada, tampoco algo mucho más grande (una pierna cerca).
  // En el aire la pelota está más cerca que el piso detrás: se ve más grande.
  #armarMapaRadio(camera, radio, etapa) {
    this.mapaRadio = null;
    // Sólo con un piso que se parece a la pelota: en los demás no hace falta y,
    // medido en el banco de pruebas, ahí descarta a veces la pelota borrosa.
    if (!camera?.p || camera.pisoY == null || !radio || !this.#pisoParecido) return;
    const { width: w, height: h } = this;
    const mw = Math.ceil(w / 4);
    const mh = Math.ceil(h / 4);
    if (!this.mapaBuf || this.mapaBuf.length !== mw * mh) this.mapaBuf = new Float32Array(mw * mh);
    const m = this.mapaBuf;
    const Ki = inv3(camera.K);
    const R = camera.R;
    const f = Math.abs(camera.K[4]);
    const alto = camera.pisoY + radio - camera.p[1];
    if (!(alto < 0)) return;
    for (let j = 0; j < mh; j++)
      for (let i = 0; i < mw; i++) {
        const x = i * 4 + 2;
        const y = j * 4 + 2;
        // Rayo del píxel (en la cámara, con z = -1) y su componente vertical.
        const vx = Ki[0] * x + Ki[1] * y + Ki[2];
        const vy = Ki[3] * x + Ki[4] * y + Ki[5];
        const vz = Ki[6] * x + Ki[7] * y + Ki[8];
        const dy = R[3] * vx + R[4] * vy + R[5] * vz;
        // Profundidad (a lo largo del eje de la cámara) del piso en ese rayo:
        // de eso depende el tamaño en la imagen, también en los bordes.
        const prof = dy < -1e-4 ? alto / dy : 0;
        m[j * mw + i] = prof > radio ? (f * radio) / prof : 0;
      }
    this.mapaRadio = { m, mw, mh, etapa };
  }

  // ¿El piso se parece a la pelota? (granito o terrazo claro con una pelota
  // blanca): ahí se usan las ayudas más agresivas (ver #picos y detectAll).
  get #pisoParecido() {
    return Boolean(this.fondoParecido) || (this.cortes?.[0] ?? UMBRAL) > 0.55;
  }

  // Radio esperado (px) de la pelota apoyada en (x, y), o 0 si no se sabe.
  #radioEsperado(x, y) {
    const M = this.mapaRadio;
    if (!M) return 0;
    const i = Math.min(M.mw - 1, Math.max(0, Math.floor(x / 4)));
    const j = Math.min(M.mh - 1, Math.max(0, Math.floor(y / 4)));
    return M.m[j * M.mw + i];
  }

  // ¿Puede ser la pelota una mancha de radio r en (x, y)?
  #tamanoPosible(x, y, r, minimo = 0.4) {
    const re = this.#radioEsperado(x, y);
    if (!re) return true;
    // Lista para patear, recién pateada se ve borrosa y a veces más chica.
    const min = this.mapaRadio.etapa === "quieta" ? minimo : 0.75 * minimo;
    return r >= min * re && (this.mapaRadio.etapa !== "quieta" || r <= 2.5 * re);
  }

  // Qué tan creíble es el tamaño r en (x, y) (1 si no se sabe o en vuelo). Una
  // pelota con parches de color también da "forma redonda" en cada parche, más
  // chica: así gana la que tiene el tamaño de la pelota. Lista para patear, más
  // grande no se penaliza (en el aire, recién pateada).
  #pesoTamano(x, y, r) {
    const re = this.#radioEsperado(x, y);
    if (!re || this.mapaRadio.etapa === "vuelo") return 1;
    const l = Math.log(r / re);
    if (l > 0 && this.mapaRadio.etapa === "lista") return 1;
    return Math.exp(-(l * l) / (2 * 0.3 * 0.3));
  }

  // Qué tan sola está una mancha de radio r en (x, y): 1 si en un anillo
  // alrededor (de 1,4 a 2,2 radios) no hay nada marcado, 0 si está todo marcado.
  #aislamiento(x, y, r) {
    const { width: w, height: h, closed } = this;
    let vistos = 0;
    let marcados = 0;
    for (const k of [1.4, 2.2]) {
      for (let a = 0; a < 24; a++) {
        const px = Math.floor(x + k * r * Math.cos((a * Math.PI) / 12));
        const py = Math.floor(y + k * r * Math.sin((a * Math.PI) / 12));
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        vistos++;
        marcados += closed[py * w + px];
      }
    }
    return vistos ? 1 - marcados / vistos : 1;
  }

  #manchas(near) {
    const { width: w, height: h, closed, labels, stack, moving } = this;
    const n = w * h;
    const rMax = 0.45 * Math.min(w, h);
    labels.fill(0);
    let etiqueta = 0;
    const todas = [];
    this.todasManchas = [];

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
      if (this.depurar) (this.todasManchas ??= []).push({ x: mx, y: my, cnt, alargada: forma.alargada, rMenor: forma.rMenor, llenado: cnt / (Math.PI * forma.rMayor * forma.rMenor) });
      if (forma.alargada > 4 || cnt / (Math.PI * forma.rMayor * forma.rMenor) < 0.45 || forma.rMenor > rMax) continue;
      if (!this.#tamanoPosible(mx + 0.5, my + 0.5, forma.alargada < 1.3 ? Math.sqrt(forma.rMenor * forma.rMayor) : forma.rMenor)) continue;

      let score = Math.min(cnt / (Math.PI * forma.rMayor * forma.rMenor), 1) * Math.min(1, cnt / 40) * (1 + (0.5 * mov) / cnt);
      if (forma.alargada > 1.6) score *= 0.8;
      // Una mancha sola, con nada marcado alrededor, es muy probablemente la
      // pelota: gana prioridad. Pegada a otras cosas marcadas, pierde un poco.
      if (!SIN_AISLADA) score *= 0.7 + 0.5 * this.#aislamiento(mx + 0.5, my + 0.5, Math.sqrt(cnt / Math.PI));
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

  // Busca formas redondas por su tamaño: el centro tiene color de pelota y
  // alrededor (en 8 direcciones) no. Una pelota pegada a algo del mismo color (la
  // media blanca del que patea, una línea de cal, un palo) forma con eso una sola
  // mancha alargada, pero igual aparece acá: sólo 1 o 2 direcciones dan "pelota".
  // Se prueba en varias escalas y en cada lugar queda la que mejor responde.
  // escalas: {min, max} radios a probar (si se sabe de qué tamaño se espera).
  #picos(near, escalas = null) {
    const { width: w, height: h, score, moving } = this;
    const W1 = w + 1;
    const n1 = W1 * (h + 1);
    if (!this.integral || this.integral.length !== n1) {
      this.integral = new Float64Array(n1);
      this.integralMov = new Float64Array(n1);
    }
    const I = this.integral;
    const IM = this.integralMov;
    for (let y = 0; y < h; y++) {
      let fila = 0;
      let filaM = 0;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        fila += score[i] > 1 ? 1 : score[i];
        filaM += moving[i];
        I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + fila;
        IM[(y + 1) * W1 + x + 1] = IM[y * W1 + x + 1] + filaM;
      }
    }
    // Promedio en el cuadrado de centro (cx, cy) y medio lado a (-1 si queda afuera).
    const caja = (T, cx, cy, a) => {
      const x0 = Math.max(0, Math.round(cx - a));
      const x1 = Math.min(w, Math.round(cx + a));
      const y0 = Math.max(0, Math.round(cy - a));
      const y1 = Math.min(h, Math.round(cy + a));
      if (x1 <= x0 || y1 <= y0) return -1;
      const area = (x1 - x0) * (y1 - y0);
      if (area < 0.5 * (2 * a) * (2 * a)) return -1;
      return (T[y1 * W1 + x1] - T[y0 * W1 + x1] - T[y1 * W1 + x0] + T[y0 * W1 + x0]) / area;
    };
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];
    const sur = new Float64Array(8);
    const picos = [];
    const rMax = Math.min(40, 0.3 * Math.min(w, h), escalas ? escalas.max : Infinity);
    const rMin = escalas ? Math.max(1.8, escalas.min) : 1.8;
    for (let r = rMin; r <= rMax; r *= 1.3) {
      const a = Math.max(0.5, 0.62 * r);
      const b = Math.max(0.5, 0.33 * r);
      const D = 1.5 * r;
      const paso = Math.max(1, Math.floor(r / 2.5));
      for (let y = 0; y < h; y += paso) {
        for (let x = 0; x < w; x += paso) {
          if (score[y * w + x] < 0.4) continue;
          const cx = x + 0.5;
          const cy = y + 0.5;
          if (!this.#tamanoPosible(cx, cy, r)) continue;
          const C = caja(I, cx, cy, a);
          if (C < 0.55) continue;
          let validas = 0;
          let aisladas = 0;
          for (let k = 0; k < 8; k++) {
            const v = caja(I, cx + D * DIRS[k][0], cy + D * DIRS[k][1], b);
            if (v < 0) continue;
            // Inserción ordenada (de menor a mayor).
            let j = validas++;
            while (j > 0 && sur[j - 1] > v) {
              sur[j] = sur[j - 1];
              j--;
            }
            sur[j] = v;
            if (v < 0.3) aisladas++;
          }
          if (validas < 5) continue;
          // Los 5 costados más "limpios".
          const bajos = (sur[0] + sur[1] + sur[2] + sur[3] + sur[4]) / 5;
          const resp = C - bajos;
          // Si tiene justo el tamaño de la pelota apoyada ahí, alcanza con menos
          // contraste (un piso claro y moteado se parece a una pelota blanca).
          if (resp < 0.28) continue;
          const pesoT = this.#pisoParecido ? this.#pesoTamano(cx, cy, r) : 1;
          if (resp < 0.45 && (SIN_CONTRASTE_TAMANO || !this.#pisoParecido || pesoT < 0.6 || this.mapaRadio?.etapa === "vuelo" || !this.#radioEsperado(cx, cy))) continue;
          picos.push({ x: cx, y: cy, r, resp, aisladas: aisladas / validas, peso: resp * pesoT });
        }
      }
    }
    // Uno por lugar: el que mejor responde.
    picos.sort((p, q) => q.peso - p.peso || q.aisladas - p.aisladas);
    const elegidos = [];
    for (const p of picos) {
      if (elegidos.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 0.9 * Math.max(p.r, q.r))) continue;
      elegidos.push(p);
      if (elegidos.length >= 8) break;
    }
    const conMovimiento = this.conMovimiento;
    return elegidos.map((p) => {
      // Centro fino con momentos dentro del círculo (no se mezcla con lo que toca).
      const v = Math.ceil(1.2 * p.r);
      let sw = 0;
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      const r2 = (1.2 * p.r) ** 2;
      for (let y = Math.max(0, Math.floor(p.y - v)); y < Math.min(h, Math.ceil(p.y + v)); y++) {
        for (let x = Math.max(0, Math.floor(p.x - v)); x < Math.min(w, Math.ceil(p.x + v)); x++) {
          const dx = x + 0.5 - p.x;
          const dy = y + 0.5 - p.y;
          if (dx * dx + dy * dy > r2) continue;
          const q = Math.min(1, Math.max(0, (score[y * w + x] - 0.2) / (UMBRAL - 0.2)));
          sw += q;
          sx += q * dx;
          sy += q * dy;
          sxx += q * dx * dx;
          syy += q * dy * dy;
          sxy += q * dx * dy;
        }
      }
      const mx = sw > 0 ? sx / sw : 0;
      const my = sw > 0 ? sy / sw : 0;
      const forma = sw > 2 ? ejes(sxx / sw - mx * mx, syy / sw - my * my, sxy / sw - mx * my) : { alargada: 1 };
      const rArea = Math.sqrt(sw / Math.PI);
      const r = p.aisladas >= 0.75 ? Math.min(1.3 * p.r, Math.max(0.75 * p.r, rArea)) : p.r;
      const mov = (caja(IM, p.x, p.y, 0.7 * p.r) + 1e-9) * 1;
      let sc = p.resp * Math.min(1, (Math.PI * p.r * p.r) / 25) * (SIN_AISLADA ? 0.6 + 0.4 * p.aisladas : 0.5 + 0.6 * p.aisladas) * (1 + 0.5 * Math.max(0, mov));
      if (this.#pisoParecido) sc *= 0.25 + 0.75 * this.#pesoTamano(p.x, p.y, p.r);
      if (near) {
        const d = Math.hypot(p.x + mx - near.x, p.y + my - near.y) / (3 * near.r + 8);
        sc *= 1 / (1 + d * d);
      }
      return {
        x: p.x + mx,
        y: p.y + my,
        r,
        alargada: Math.min(forma.alargada, 1.5),
        area: sw,
        score: sc,
        moving: conMovimiento ? Math.max(0, mov) : null,
        redonda: p.aisladas,
        forma: true,
      };
    });
  }

  // Pelota borrosa por la velocidad: una estela de píxeles que cambiaron mezclando
  // su color con el de la pelota (ver detectAll). El centro de la estela es
  // dónde estaba la pelota en la mitad de la exposición; el ancho, su diámetro.
  #estelas(near) {
    const { width: w, height: h, estela, alfa, labels2: labels, stack } = this;
    const n = w * h;
    // Une huecos chicos (gajos, ruido).
    const m = this.tmp;
    dilatar(estela, m, w, h, 1);
    labels.fill(0);
    let etiqueta = 0;
    const todas = [];
    const rMax = 0.3 * Math.min(w, h);
    for (let inicio = 0; inicio < n; inicio++) {
      if (!m[inicio] || labels[inicio]) continue;
      etiqueta++;
      let tope = 0;
      stack[tope++] = inicio;
      labels[inicio] = etiqueta;
      let cnt = 0;
      let sw = 0;
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      let cobertura = 0;
      while (tope > 0) {
        const i = stack[--tope];
        const x = i % w;
        const y = (i - x) / w;
        if (estela[i]) {
          const a = 0.3 + alfa[i];
          cobertura += Math.min(1, Math.max(0, alfa[i]));
          cnt++;
          sw += a;
          sx += a * x;
          sy += a * y;
          sxx += a * x * x;
          syy += a * y * y;
          sxy += a * x * y;
        }
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const k = yy * w + xx;
            if (m[k] && !labels[k]) {
              labels[k] = etiqueta;
              stack[tope++] = k;
            }
          }
        }
      }
      if (cnt < 6) continue;
      const mx = sx / sw;
      const my = sy / sw;
      const forma = ejes(sxx / sw - mx * mx, syy / sw - my * my, sxy / sw - mx * my);
      if (forma.alargada > 12 || forma.rMenor > rMax || forma.rMenor < 0.8) continue;
      const llenado = Math.min(1, cnt / (Math.PI * forma.rMayor * forma.rMenor));
      if (llenado < 0.35) continue;
      let score = (sw / cnt - 0.3) * Math.min(1, cnt / 25) * llenado * 1.2;
      if (near) {
        const d = Math.hypot(mx + 0.5 - near.x, my + 0.5 - near.y) / (3 * near.r + 8);
        score *= 1 / (1 + d * d);
      }
      // Durante la exposición la pelota tapa siempre su área: sumando cuánto de
      // pelota tiene cada píxel de la estela sale su radio aunque esté borrosa.
      const rCobertura = Math.sqrt(cobertura / Math.PI);
      if (!this.#tamanoPosible(mx + 0.5, my + 0.5, Math.max(forma.rMenor, rCobertura), 0.35)) continue;
      if (score > 0.05) todas.push({ x: mx + 0.5, y: my + 0.5, r: forma.rMenor, rCobertura, alargada: forma.alargada, area: cnt, score, moving: 1, estela: true });
    }
    todas.sort((a, b) => b.score - a.score);
    return todas.slice(0, 4);
  }

  // Junta las manchas y las formas redondas: si una forma coincide con una
  // mancha redonda del mismo tamaño es lo mismo (queda la mancha, que mide
  // mejor); si la mancha es alargada o de otro tamaño, la forma es algo
  // distinto (la pelota pegada a otra cosa) y entra como candidata aparte.
  #combinar(manchas, formas) {
    const todas = manchas.map((m) => ({ ...m }));
    for (const f of formas) {
      const igual = todas.find(
        (m) =>
          !m.forma &&
          Math.hypot(m.x - f.x, m.y - f.y) < 0.8 * Math.max(m.r, f.r) &&
          (m.alargada ?? 1) < 1.5 &&
          Math.abs(Math.log(m.r / f.r)) < 0.4,
      );
      if (igual) {
        igual.score = Math.max(igual.score, f.score);
        igual.redonda = f.redonda;
        continue;
      }
      if (f.score > 0.08) todas.push(f);
    }
    todas.sort((a, b) => b.score - a.score);
    return todas.slice(0, CANDIDATAS);
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
  refine(rgba, w, h, guess, { borde = true, alto = false } = {}) {
    if (!this.prob) return null;
    const prob = alto ? this.probs[1] : this.probs[0];
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
      const s = prob[casillero(rgba[j], rgba[j + 1], rgba[j + 2])];
      score[i] = s;
      mask[i] = s >= UMBRAL ? 1 : 0;
    }
    // Con más resolución los gajos son más grandes: cierre de 5x5.
    dilatar(mask, tmp, w, h, 1);
    dilatar(tmp, closed, w, h, 1);
    dilatar(closed, tmp, w, h, 0);
    dilatar(tmp, closed, w, h, 0);

    const porColor = this.#refinarPorColor(w, h, guess);
    if (!borde) return porColor;
    // El borde real (donde la luz cambia) no depende del color: con sombra o
    // mucho sol el color "come" un costado de la pelota, o directamente no la
    // encuentra. Arranca de la medición por color si la hay, o de la aproximada.
    // Con estela de movimiento (alargada) no es un círculo: queda lo del color.
    if (porColor && porColor.alargada >= 1.3 && porColor.r >= guess.r * 0.8) return porColor;
    // Se prueba desde varios puntos de partida, se repite desde cada resultado
    // hasta que el círculo se asienta, y gana el que explica más puntos del borde.
    const inicios = porColor ? [porColor, guess] : [guess];
    const suave = suavizarColor(rgba, w, h);
    let mejor = null;
    for (const base of inicios) {
      if (base.r < 4) continue;
      let c = contornoEn(suave, w, h, base.x, base.y, base.r);
      for (let i = 0; i < 3 && c; i++) {
        const otra = contornoEn(suave, w, h, c.x, c.y, c.r);
        if (!otra) break;
        const quieto = Math.hypot(otra.x - c.x, otra.y - c.y) < 0.05 && Math.abs(otra.r - c.r) < 0.05;
        c = otra;
        if (quieto) break;
      }
      const valido = c && c.r > guess.r * 0.6 && c.r < guess.r * 1.6 && Math.hypot(c.x - guess.x, c.y - guess.y) < guess.r * 0.6;
      if (valido && c.inliers >= 0.55 && (!mejor || c.inliers > mejor.inliers)) mejor = c;
      if (mejor && mejor.inliers >= 0.85) break; // el contorno ya cierra casi entero
    }
    if (mejor) return { ...(porColor ?? {}), alargada: 1, x: mejor.x, y: mejor.y, r: mejor.r, borde: mejor.inliers };
    return porColor;
  }

  #refinarPorColor(w, h, guess) {
    const { closed, labels, stack, score } = this.recorte;
    const n = w * h;
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

// Busca el borde de la pelota en 64 direcciones desde (cx, cy) y ajusta un
// círculo a esos puntos descartando los tramos que no cierran (un pie encima,
// una sombra pegada). El borde es el último salto fuerte de color hacia afuera:
// se usa el color y no sólo el brillo porque el costado en sombra de una pelota
// blanca puede brillar igual que el pasto, y los gajos dan saltos adentro.
// Devuelve {x, y, r, inliers} o null.
export function contorno(rgba, w, h, cx, cy, r) {
  return contornoEn(suavizarColor(rgba, w, h), w, h, cx, cy, r);
}

// Color suavizado 3x3 (menos ruido en la derivada), 3 valores por píxel.
function suavizarColor(rgba, w, h) {
  const S = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r0 = 0;
      let g0 = 0;
      let b0 = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = (yy * w + xx) * 4;
          r0 += rgba[j];
          g0 += rgba[j + 1];
          b0 += rgba[j + 2];
          n++;
        }
      }
      const k = (y * w + x) * 3;
      S[k] = r0 / n;
      S[k + 1] = g0 / n;
      S[k + 2] = b0 / n;
    }
  }
  return S;
}

function contornoEn(S, w, h, cx, cy, r) {
  const puntos = [];
  const N = 64;
  const paso = 0.25;
  const desde = 0.55 * r;
  const hasta = 1.6 * r;
  const cuantos = Math.floor((hasta - desde) / paso) + 1;
  const der = new Float32Array(cuantos);
  for (let n = 0; n < N; n++) {
    const ang = (2 * Math.PI * n) / N;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    let m = 0; // derivadas válidas
    let max = 0;
    let r0 = 0;
    let g0 = 0;
    let b0 = 0;
    let afuera = false;
    for (let k = 0; k < cuantos; k++) {
      const s = desde + k * paso;
      // Muestra bilineal del color suavizado.
      const u = cx + dx * s - 0.5;
      const v = cy + dy * s - 0.5;
      const i = Math.floor(u);
      const j = Math.floor(v);
      if (i < 0 || j < 0 || i + 1 >= w || j + 1 >= h) {
        afuera = true;
        break;
      }
      const a = u - i;
      const bb = v - j;
      const p0 = (j * w + i) * 3;
      const p1 = p0 + w * 3;
      const w00 = (1 - a) * (1 - bb);
      const w10 = a * (1 - bb);
      const w01 = (1 - a) * bb;
      const w11 = a * bb;
      const r1 = S[p0] * w00 + S[p0 + 3] * w10 + S[p1] * w01 + S[p1 + 3] * w11;
      const g1 = S[p0 + 1] * w00 + S[p0 + 4] * w10 + S[p1 + 1] * w01 + S[p1 + 4] * w11;
      const b1 = S[p0 + 2] * w00 + S[p0 + 5] * w10 + S[p1 + 2] * w01 + S[p1 + 5] * w11;
      if (k > 0) {
        const d = Math.sqrt((r1 - r0) ** 2 + (g1 - g0) ** 2 + (b1 - b0) ** 2) / paso;
        der[m++] = d;
        if (d > max) max = d;
      }
      r0 = r1;
      g0 = g1;
      b0 = b1;
    }
    if (afuera || m < 5 || !(max > 4)) continue;
    // El último pico fuerte hacia afuera.
    let k = -1;
    for (let i = m - 2; i >= 1; i--) {
      if (der[i] >= 0.4 * max && der[i] >= der[i - 1] && der[i] >= der[i + 1]) {
        k = i;
        break;
      }
    }
    if (k < 1) continue;
    // Ajuste parabólico del pico: posición del borde con fracción de paso.
    const a = der[k - 1];
    const b = der[k];
    const c = der[k + 1];
    const off = Math.max(-0.5, Math.min(0.5, (a - c) / (2 * (a - 2 * b + c) || 1)));
    const s = desde + (k + 0.5 + off) * paso;
    puntos.push([cx + dx * s, cy + dy * s]);
  }
  if (puntos.length < N * 0.5) return null;

  let usados = puntos;
  let circulo = null;
  for (let iter = 0; iter < 5; iter++) {
    circulo = ajustarCirculo(usados);
    if (!circulo) return null;
    const res = puntos.map(([x, y]) => Math.abs(Math.hypot(x - circulo.x, y - circulo.y) - circulo.r));
    const mad = [...res].sort((p, q) => p - q)[res.length >> 1] * 1.4826;
    const corte = Math.max(0.6, 2.5 * mad);
    const nuevos = puntos.filter((_, i) => res[i] <= corte);
    if (nuevos.length < 10) return null;
    if (nuevos.length === usados.length) break;
    usados = nuevos;
  }
  return { ...ajustarCirculo(usados), inliers: usados.length / N };
}

// Círculo por cuadrados mínimos (Kåsa): x² + y² + D·x + E·y + F = 0.
function ajustarCirculo(p) {
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, sz = 0, sxz = 0, syz = 0;
  const n = p.length;
  for (const [x, y] of p) {
    const z = x * x + y * y;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    sx += x;
    sy += y;
    sz += z;
    sxz += x * z;
    syz += y * z;
  }
  // [sxx sxy sx; sxy syy sy; sx sy n] · [D E F] = -[sxz syz sz]
  const A = [sxx, sxy, sx, sxy, syy, sy, sx, sy, n];
  const det = A[0] * (A[4] * A[8] - A[5] * A[7]) - A[1] * (A[3] * A[8] - A[5] * A[6]) + A[2] * (A[3] * A[7] - A[4] * A[6]);
  if (Math.abs(det) < 1e-9) return null;
  const b = [-sxz, -syz, -sz];
  const resolver = (k) => {
    const M = A.slice();
    for (let f = 0; f < 3; f++) M[f * 3 + k] = b[f];
    return (M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6])) / det;
  };
  const D = resolver(0);
  const E = resolver(1);
  const F = resolver(2);
  const x = -D / 2;
  const y = -E / 2;
  const r2 = x * x + y * y - F;
  return r2 > 0 ? { x, y, r: Math.sqrt(r2) } : null;
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
