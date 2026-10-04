// Detecta si la imagen de la cámara llega dada vuelta o espejada.
//
// Cada navegador puede entregar la textura de la cámara con otra orientación, y
// si se la interpreta al revés, la pelota se encuentra igual pero todas las
// posiciones en 3D salen mal. Para no depender de eso, se compara la imagen con
// el giro del celular que informa ARCore: cuando el celular gira, el fondo se
// corre en la imagen de una forma que se puede predecir exactamente
// (homografía). Sólo con la orientación correcta el cuadro anterior, corrido
// según el giro, coincide con el actual.

import { homografiaEntre } from "./detector.js";

export const ORIENTACIONES = [
  { x: false, y: false, nombre: "normal" },
  { x: false, y: true, nombre: "dada vuelta" },
  { x: true, y: false, nombre: "espejada" },
  { x: true, y: true, nombre: "girada 180°" },
];

const GIRO_MINIMO = (0.6 * Math.PI) / 180; // menos que esto, el fondo casi no se corre
const GIRO_MAXIMO = (8 * Math.PI) / 180;
const VOTOS_NECESARIOS = 8;

export class CameraOrientation {
  constructor() {
    this.reset();
  }

  reset() {
    this.votos = [0, 0, 0, 0];
    this.anterior = null;
    // Índice en ORIENTACIONES (relativo a como se lee ahora) o null si todavía no se sabe.
    this.resultado = null;
  }

  get total() {
    return this.votos.reduce((a, b) => a + b, 0);
  }

  // rgba: imagen tal como se leyó (fila 0 abajo); camera: {K, R} como en el detector.
  // Devuelve el índice de la orientación cuando ya está segura, o null.
  observe(rgba, w, h, camera) {
    if (this.resultado !== null) return this.resultado;
    const anterior = this.anterior;
    if (!anterior || anterior.w !== w || anterior.h !== h) {
      this.anterior = { lum: luminancia(rgba, w, h), w, h, camera };
      return null;
    }
    const giro = anguloEntre(anterior.camera.R, camera.R);
    if (giro < GIRO_MINIMO) return null; // se espera a que gire más
    const lum = luminancia(rgba, w, h);
    this.anterior = { lum, w, h, camera };
    if (giro > GIRO_MAXIMO) return null;

    const H = homografiaEntre(camera, anterior.camera);
    const errores = ORIENTACIONES.map((o) => error(lum, anterior.lum, w, h, H, o));
    const orden = errores.map((e, i) => ({ e, i })).sort((a, b) => a.e - b.e);
    // Sólo vota si una orientación explica el movimiento claramente mejor que las otras.
    if (orden[0].e < 0.8 * orden[1].e) this.votos[orden[0].i]++;
    const total = this.total;
    if (total >= VOTOS_NECESARIOS) {
      const mejor = this.votos.indexOf(Math.max(...this.votos));
      if (this.votos[mejor] >= 0.75 * total) this.resultado = mejor;
    }
    return this.resultado;
  }
}

function luminancia(rgba, w, h) {
  const l = new Float32Array(w * h);
  for (let i = 0, j = 0; i < l.length; i++, j += 4) l[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return l;
}

function anguloEntre(A, B) {
  // Ángulo de la rotación Aᵀ·B (matrices 3x3 fila por fila).
  let traza = 0;
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) traza += A[k * 3 + i] * B[k * 3 + i];
  return Math.acos(Math.max(-1, Math.min(1, (traza - 1) / 2)));
}

// Diferencia media entre el cuadro actual y el anterior corrido según el giro,
// suponiendo que la imagen leída tiene la orientación `o` respecto de la real.
function error(actual, anterior, w, h, H, o) {
  let suma = 0;
  let n = 0;
  const paso = Math.max(2, Math.round(Math.min(w, h) / 60));
  for (let y = paso; y < h - paso; y += paso) {
    for (let x = paso; x < w - paso; x += paso) {
      // Coordenadas reales del píxel leído.
      const u = o.x ? w - (x + 0.5) : x + 0.5;
      const v = o.y ? h - (y + 0.5) : y + 0.5;
      const z = H[6] * u + H[7] * v + H[8];
      const pu = (H[0] * u + H[1] * v + H[2]) / z;
      const pv = (H[3] * u + H[4] * v + H[5]) / z;
      // De vuelta a coordenadas de la imagen leída.
      const px = Math.floor(o.x ? w - pu : pu);
      const py = Math.floor(o.y ? h - pv : pv);
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      suma += Math.abs(actual[y * w + x] - anterior[py * w + px]);
      n++;
    }
  }
  return n > 50 ? suma / n : Infinity;
}
