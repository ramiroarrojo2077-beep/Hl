// Banco de pruebas de precisión: corre el seguimiento real de la app
// (js/seguimiento.js) sobre imágenes simuladas de remates y mide los errores.
//
//   node arquero/sim/banco.mjs [--escenario nombre[,nombre…]] [--sesiones N] [--tiros N] [--semilla N] [--detalle]
//
// Cada escenario son varias "sesiones" (un lugar y una posición del celular)
// con varios remates al azar: distintas velocidades (hasta 30 m/s), alturas,
// efecto, distancias. Se mide:
//   remate: si detectó el remate (y si hubo falsos remates antes de patear);
//   resultado: si llegó a dar un cruce (gol / atajada / afuera);
//   error: distancia entre el cruce previsto y el real, en cm;
//   vuelo: de los cuadros con la pelota en vuelo, en cuántos la midió bien.

import * as THREE from "three";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { appendFileSync } from "node:fs";
import { BallTracking, camaraDe } from "../js/seguimiento.js";
import { PELOTAS } from "../js/keeper-ai.js";
import { PixelReader } from "../js/pixels.js";
import { CamaraSimulada, crearEscena } from "./escena.js";
import { azar, volar, apuntar, piernas } from "./fisica.js";

export const ESCENARIOS = {
  // Celular apoyado, día de sol (exposición corta).
  "fijo-sol": { modo: "fijo", luz: "sol", exposicion: 0.002, ruido: { foton: 0.0003, lectura: 0.00002 } },
  // Celular apoyado, nublado (más exposición: la pelota rápida sale estirada).
  "fijo-nublado": { modo: "fijo", luz: "nublado", exposicion: 0.01, ruido: { foton: 0.0006, lectura: 0.00004 } },
  // Celular apoyado, poca luz (exposición larga, ruido).
  "fijo-poca-luz": { modo: "fijo", luz: "interior", exposicion: 0.025, ruido: { foton: 0.0015, lectura: 0.0002 } },
  // Patio de cemento con pared clara.
  "patio": { modo: "fijo", lugar: "patio", luz: "nublado", exposicion: 0.012, ruido: { foton: 0.0008, lectura: 0.00005 } },
  // Alguien sostiene el celular mirando la jugada.
  "mano": { modo: "mano", luz: "sol", exposicion: 0.004, ruido: { foton: 0.0004, lectura: 0.00003 } },
  // Adentro de una casa, con el celular en la mano: luz artificial (exposición
  // larga, parpadeo), distancias cortas, la mano que se desplaza, muebles.
  "casa-mano": {
    modo: "mano",
    lugar: "interior",
    luz: "interior",
    exposicion: 0.025,
    ruido: { foton: 0.0015, lectura: 0.0002 },
    arco: { ancho: 2, alto: 1.3 },
    distancia: [3, 6],
    rapidez: [6, 20],
    traslacion: 3,
  },
  // Lo mismo con el celular apoyado.
  "casa-fijo": {
    modo: "fijo",
    lugar: "interior",
    luz: "interior",
    exposicion: 0.025,
    ruido: { foton: 0.0015, lectura: 0.0002 },
    arco: { ancho: 2, alto: 1.3 },
    distancia: [3, 6],
    rapidez: [6, 20],
  },
  // Como juega el usuario: adentro, piso de granito moteado, pelota blanca con
  // parches de colores, el que patea sostiene el celular a ~1 m casi encima de
  // la pelota y el arco chico está cerca (1,2 a 2,5 m).
  "casa-encima": {
    modo: "mano",
    encima: true,
    lugar: "interior",
    piso: "granito",
    pelota: "multicolor",
    luz: "interior",
    exposicion: 0.012,
    ruido: { foton: 0.0012, lectura: 0.00015 },
    arco: { ancho: 2, alto: 1.3 },
    distancia: [1.2, 2.5],
    rapidez: [5, 15],
  },
  // Lo mismo con una pelota negra N.º 3 (las motas oscuras del granito, las
  // sombras y las zapatillas se le parecen).
  "casa-negra": {
    modo: "mano",
    encima: true,
    lugar: "interior",
    piso: "granito",
    pelota: "negra",
    pelotaN: 3,
    luz: "interior",
    exposicion: 0.012,
    ruido: { foton: 0.0012, lectura: 0.00015 },
    arco: { ancho: 2, alto: 1.3 },
    distancia: [1.2, 2.5],
    rapidez: [5, 15],
  },
  // Pelota negra, celular en la mano más atrás (1,5 a 3,5 m del arco).
  "casa-negra-mano": {
    modo: "mano",
    lugar: "interior",
    piso: "granito",
    pelota: "negra",
    pelotaN: 3,
    luz: "interior",
    exposicion: 0.025,
    ruido: { foton: 0.0015, lectura: 0.0002 },
    arco: { ancho: 2, alto: 1.3 },
    distancia: [2, 4.5],
    rapidez: [6, 20],
    traslacion: 3,
  },
  // Lo mismo, con remates muy fuertes (la pelota sale como una estela).
  "casa-encima-rapido": {
    modo: "mano",
    encima: true,
    lugar: "interior",
    piso: "granito",
    pelota: "multicolor",
    luz: "interior",
    exposicion: 0.012,
    ruido: { foton: 0.0012, lectura: 0.00015 },
    arco: { ancho: 2, alto: 1.3 },
    distancia: [1.2, 2.5],
    rapidez: [16, 30],
  },
  // Adentro con el celular en la mano, remates muy fuertes.
  "casa-mano-rapido": {
    modo: "mano",
    lugar: "interior",
    luz: "interior",
    exposicion: 0.025,
    ruido: { foton: 0.0015, lectura: 0.0002 },
    arco: { ancho: 2, alto: 1.3 },
    distancia: [3, 6],
    rapidez: [20, 32],
    traslacion: 3,
  },
  // El que patea tiene el celular en la mano (se mueve mucho al patear).
  "pateando": { modo: "pateando", luz: "nublado", exposicion: 0.008, ruido: { foton: 0.0006, lectura: 0.00004 } },
};

const ARCO_CANCHA = { ancho: 3, alto: 2 };
const FPS = 30;

function mirar(pos, objetivo) {
  const z = norm([pos[0] - objetivo[0], pos[1] - objetivo[1], pos[2] - objetivo[2]]);
  const x = norm(cruz([0, 1, 0], z));
  const y = cruz(z, x);
  // Columnas = ejes de la cámara, guardado fila por fila.
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}
const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const n = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / n, a[1] / n, a[2] / n];
};
function rotar(R, ax, ay, az) {
  // Gira la cámara en sus propios ejes (ángulos chicos, en radianes).
  const Rx = [1, 0, 0, 0, Math.cos(ax), -Math.sin(ax), 0, Math.sin(ax), Math.cos(ax)];
  const Ry = [Math.cos(ay), 0, Math.sin(ay), 0, 1, 0, -Math.sin(ay), 0, Math.cos(ay)];
  const Rz = [Math.cos(az), -Math.sin(az), 0, Math.sin(az), Math.cos(az), 0, 0, 0, 1];
  return mul(R, mul(Rz, mul(Ry, Rx)));
}
const mul = (a, b) => {
  const c = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return c;
};

function matrizCamara(cam) {
  const R = cam.R;
  return new THREE.Matrix4().set(R[0], R[1], R[2], cam.pos[0], R[3], R[4], R[5], cam.pos[1], R[6], R[7], R[8], cam.pos[2], 0, 0, 0, 1);
}

// Proyección de un punto (coordenadas del arco) en la imagen chica w × h.
function proyectar(sim, cam, p, w, h) {
  const R = cam.R;
  const d = [p[0] - cam.pos[0], p[1] - cam.pos[1], p[2] - cam.pos[2]];
  const q = [R[0] * d[0] + R[3] * d[1] + R[6] * d[2], R[1] * d[0] + R[4] * d[1] + R[7] * d[2], R[2] * d[0] + R[5] * d[1] + R[8] * d[2]];
  if (q[2] > -0.1) return null;
  const z = -q[2];
  return {
    x: ((q[0] / z / sim.tanX + 1) / 2) * w,
    y: ((q[1] / z / sim.tanY + 1) / 2) * h,
    r: (sim.escena.R / Math.hypot(...d)) * (h / 2 / sim.tanY),
  };
}

// Movimiento de la cámara en mano: temblor (varios senos) y deriva lenta.
function temblor(rnd, amplitud) {
  const ondas = [];
  for (let k = 0; k < 6; k++) ondas.push({ f: rnd.entre(1.5, 9), a: (rnd.entre(0.3, 1) * amplitud) / (1 + k * 0.4), fase: rnd.entre(0, 6.3), eje: k % 3 });
  const deriva = [rnd.entre(0, 6.3), rnd.entre(0, 6.3), rnd.entre(0, 6.3)];
  return (t) => {
    const a = [0, 0, 0];
    for (const o of ondas) a[o.eje] += o.a * Math.sin(2 * Math.PI * o.f * t + o.fase);
    for (let i = 0; i < 3; i++) a[i] += amplitud * 2 * Math.sin(0.25 * t + deriva[i]);
    return a;
  };
}

const suave = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// Una sesión: lugar, celular, escaneo y varios remates.
export async function sesion({ nombre, cfg, semilla, tiros, detalle, traza = false, fotos = null, soloVer = false }) {
  const ARCO = cfg.arco ?? ARCO_CANCHA;
  const rnd = azar(semilla);
  // Pelota N.º 5 (o la que diga PELOTA, p. ej. PELOTA=3: más chica).
  const R = rnd.elegir([0.11, 0.11, 0.108, 0.105]) * (PELOTAS[process.env.PELOTA ?? cfg.pelotaN ?? 5].radio / 0.11);
  const escena = crearEscena({
    semilla: semilla * 13 + 1,
    lugar: cfg.lugar ?? "cancha",
    arco: ARCO,
    luz: cfg.luz,
    pelota: cfg.pelota ?? rnd.elegir(["clasica", "clasica", "azul", "amarilla", "naranja"]),
    R,
    piso: cfg.piso ?? null,
  });
  // Apoyado, el celular suele ir horizontal (entran la pelota y el arco); en la mano, de las dos formas.
  const horizontal = !cfg.encima && (cfg.modo === "fijo" || (cfg.modo === "mano" && rnd() < 0.5));
  const sim = new CamaraSimulada({
    escena,
    ancho: horizontal ? 2160 : 1080,
    alto: horizontal ? 1080 : 2160,
    fovY: horizontal ? 36 : 66,
    exposicion: cfg.exposicion,
    ruido: cfg.ruido,
    obturador: 0.02,
    semilla,
  });
  const { width: w, height: h } = PixelReader.size(sim.ancho, sim.alto);
  const proj = new THREE.Matrix4().fromArray(sim.proyeccion());

  // Dónde se patea y dónde está el celular (en coordenadas del arco).
  const [dMin, dMax] = cfg.distancia ?? [5.5, 10];
  const base = [rnd.entre(-1.2, 1.2) * (dMin < 5 ? 0.5 : 1), R, rnd.entre(dMin, dMax)];
  let camBase;
  for (let intento = 0; intento < 400; intento++) {
    let pos;
    // Al costado: atrás del que patea, su cuerpo taparía la pelota.
    const costado = (a, b) => (rnd() < 0.5 ? -1 : 1) * rnd.entre(a, b);
    if (cfg.encima) pos = [base[0] + rnd.entre(-0.25, 0.25), rnd.entre(0.9, 1.15), base[2] + rnd.entre(0, 0.3)];
    else if (cfg.modo === "fijo" && escena.habitacion) pos = [base[0] + costado(0.6, 2.2), rnd.entre(0.4, 1.2), base[2] + rnd.entre(0.5, 2.5)];
    else if (cfg.modo === "fijo") pos = [base[0] + costado(1.2, 3), rnd.entre(0.5, 1.3), base[2] + rnd.entre(0.3, 2.5)];
    else if (cfg.modo === "mano" && escena.habitacion) pos = [base[0] + costado(0.5, 2.2), rnd.entre(1.3, 1.6), base[2] + rnd.entre(0.5, 2.5)];
    else if (cfg.modo === "mano") pos = [base[0] + costado(1.5, 3.5), rnd.entre(1.35, 1.6), base[2] + rnd.entre(0.3, 3)];
    else pos = [base[0] + rnd.entre(-0.35, -0.2), rnd.entre(1.2, 1.35), base[2] + rnd.entre(0.45, 0.7)];
    // Adentro, el celular tiene que estar dentro de la habitación.
    const H = escena.habitacion;
    if (H && (Math.abs(pos[0]) > H.ancho - 0.3 || pos[2] > H.fondo - 0.3)) continue;
    const mira = cfg.encima ? [base[0] * 0.6, 0, base[2] * rnd.entre(0.45, 0.65)] : [base[0] * 0.5, 0.6, base[2] * (cfg.modo === "pateando" ? 0.4 : 0.45)];
    const cam = { pos, R: mirar(pos, mira) };
    const enImagen = (p, m) => {
      const q = proyectar(sim, cam, p, w, h);
      return q && q.x > m && q.x < w - m && q.y > m && q.y < h - m;
    };
    const ok = cfg.encima
      ? // Casi encima de la pelota no entra todo el arco: alcanza con el centro.
        enImagen(base, 40) && enImagen([0, 0, 0], 10)
      : enImagen(base, 25) &&
      [[-ARCO.ancho / 2 - 0.3, 0, 0], [ARCO.ancho / 2 + 0.3, 0, 0], [-ARCO.ancho / 2 - 0.3, ARCO.alto + 0.2, 0], [ARCO.ancho / 2 + 0.3, ARCO.alto + 0.2, 0]].every((p) =>
        enImagen(p, 3),
      );
    if (ok) {
      camBase = cam;
      break;
    }
  }
  if (!camBase) return { omitida: true };
  if (soloVer) return { omitida: false, resultados: [] };

  // El arco virtual quedó apoyado donde ARCore cree que está el piso (con error).
  const errorPiso = rnd.entre(-0.025, 0.025);
  const giroArco = rnd.entre(-Math.PI, Math.PI);
  const posArco = [rnd.entre(-3, 3), 0, rnd.entre(-3, 3)];
  const arcoReal = new THREE.Matrix4().makeRotationY(giroArco).setPosition(posArco[0], posArco[1], posArco[2]);
  const arcoApp = new THREE.Matrix4().makeRotationY(giroArco).setPosition(posArco[0], posArco[1] + errorPiso, posArco[2]);

  const tiembla = temblor(rnd, cfg.modo === "fijo" ? 0 : (0.4 * Math.PI) / 180);
  // Movimiento del que patea con el celular (se adelanta y gira al patear).
  let tPatadaActual = Infinity;
  const camaraEn = (tau) => {
    let { pos, R } = camBase;
    if (cfg.modo === "fijo") return camBase;
    const a = tiembla(tau);
    const k = cfg.traslacion ?? 0.8;
    pos = [pos[0] + a[0] * k, pos[1] + a[1] * k, pos[2] + a[2] * k];
    let [ax, ay, az] = a;
    if (cfg.modo === "pateando") {
      const s = suave((tau - tPatadaActual + 0.45) / 0.8);
      pos = [pos[0] + 0.1 * s, pos[1] - 0.08 * s, pos[2] - 0.45 * s];
      ax += 0.25 * Math.sin(Math.PI * s);
      ay += 0.18 * Math.sin(Math.PI * s) - 0.05 * s;
      az += 0.1 * Math.sin(2 * Math.PI * s);
    }
    return { pos, R: rotar(R, ax, ay, az) };
  };
  // Lo que informa ARCore: la pose real con un poco de ruido.
  const poseInformada = (tau) => {
    const c = camaraEn(tau);
    const e = (0.03 * Math.PI) / 180;
    return { pos: c.pos.map((v) => v + rndC.normal() * 0.001), R: rotar(c.R, rndC.normal() * e, rndC.normal() * e, rndC.normal() * e) };
  };
  const aMundo = (cam) => new THREE.Matrix4().multiplyMatrices(arcoReal, matrizCamara(cam));

  // El número de pelota elegido en la app (AJUSTE; si no, el que es).
  const seg = new BallTracking({ radio: PELOTAS[process.env.AJUSTE ?? process.env.PELOTA ?? cfg.pelotaN ?? 5].radio });
  seg.setAnchoArco(ARCO.ancho);
  seg.detector.depurar = Boolean(process.env.DEPURAR);
  let estado = { pelota: { c: base, eje: [1, 0, 0], angulo: 0 }, cuerpos: [] };
  let estadoEn = () => estado;
  let t = 0;
  let cuadroN = 0;
  // Azar de cada cuadro (temblor de la pose, cuadros perdidos), aparte del de los
  // remates: así cada remate es el mismo aunque cambie lo que hace el seguimiento.
  let rndC = azar(semilla * 7919 + 1);
  const leer = (reg, ww, hh) => sim.leer(ww, hh, reg);
  const cuadro = (camEn = camaraEn, fija = cfg.modo === "fijo") => {
    // 30 cuadros por segundo con un poco de variación y alguno perdido.
    t += 1 / FPS + rndC.normal() * 0.001;
    if (rndC() < 0.03) t += 1 / FPS;
    cuadroN++;
    sim.cuadro(t, camEn, estadoEn, { fija });
    const img = sim.leer(w, h);
    const pose = camEn === camaraEn ? poseInformada(t) : camEn(t);
    return {
      t,
      camMatrix: aMundo(pose),
      projMatrix: proj,
      image: { data: img, width: w, height: h },
      region: { factor: sim.ancho / w, leer },
      camaraReal: camEn(t),
    };
  };

  // 1. Mirando el lugar (el detector aprende el fondo) y escaneo de cerca.
  for (let k = 0; k < 8; k++) {
    const info = cuadro();
    seg.detector.resize(w, h);
    if (k % 2 === 0) seg.detector.observeBackground(info.image.data, null, camaraDe(info, w, h));
  }
  const posEscaneo = [base[0] + 0.05, R + 0.85, base[2] + 0.35];
  const camEscaneo = { pos: posEscaneo, R: mirar(posEscaneo, base) };
  const infoEscaneo = cuadro(() => camEscaneo, false);
  const radioMira = 0.22 * Math.min(w, h);
  const camEsc = camaraDe(infoEscaneo, w, h);
  seg.detector.observeBackground(infoEscaneo.image.data, { x: w / 2, y: h / 2, r: radioMira }, camEsc);
  const aprendio = seg.detector.learn(infoEscaneo.image.data, w / 2, h / 2, radioMira, camEsc);
  if (!aprendio.ok) return { omitida: true, motivo: `escaneo: ${aprendio.motivo}` };
  // Como en la app: el radio real de la pelota sale del escaneo.
  const medidaEscaneo = seg.medirEscaneada?.(infoEscaneo, arcoApp, aprendio.det) ?? null;
  if (medidaEscaneo?.pisoDistinto) return { omitida: true, motivo: "escaneo: piso distinto" };
  const radioEscaneo = medidaEscaneo?.radio ?? null;
  seg.reiniciarRadio();
  seg.reset();
  if (!(process.env.EXP ?? "").includes("sinEscaneada")) seg.tracker.marcarEscaneada?.(medidaEscaneo?.pos ?? null);

  const resultados = [];
  let msTotal = 0;
  let msCuadros = 0;
  for (let n = 0; n < tiros; n++) {
    // Cada remate arranca en un instante fijo y con su propio azar.
    rndC = azar(semilla * 7919 + 100 + n);
    t = 40 + n * 25;
    sim.cuadroId = (n + 1) * 100000;
    seg.reset();
    // Remate al azar, desde un punto que se vea bien.
    let p0 = null;
    for (let k = 0; k < 20 && !p0; k++) {
      const p = [base[0] + rnd.entre(-0.4, 0.4), R, base[2] + rnd.entre(-0.4, 0.4)];
      const q = proyectar(sim, camaraEn(t), p, w, h);
      if (q && q.x > q.r + 8 && q.x < w - q.r - 8 && q.y > q.r + 8 && q.y < h - q.r - 8) p0 = p;
    }
    if (!p0) continue;
    const rasante = rnd() < 0.3;
    const objetivo = [rnd.entre(-ARCO.ancho / 2 - 0.4, ARCO.ancho / 2 + 0.4), rasante ? R : rnd.entre(0.2, ARCO.alto + 0.3), 0];
    const rapidez = cfg.rapidez ? rnd.entre(...cfg.rapidez) : rnd() < 0.5 ? rnd.entre(8, 18) : rnd.entre(18, 32);
    const k = rnd.entre(0.01, 0.016);
    let efecto = null;
    if (rnd() < 0.5) {
      const dir = norm([objetivo[0] - p0[0], 0, objetivo[2] - p0[2]]);
      const eje = rnd() < 0.6 ? [0, rnd() < 0.5 ? 1 : -1, 0] : norm(cruz([0, 1, 0], dir)).map((v) => v * (rnd() < 0.7 ? 1 : -1));
      efecto = { eje, c: rnd.entre(0.002, 0.009) };
    }
    const v0 = apuntar({ p0, objetivo, rapidez, R, k, rasante });
    const tray = volar({ p0, v0, R, k, efecto, giro: rnd.entre(5, 40), ejeGiro: efecto?.eje ?? [1, 0, 0], tMax: 3 });
    const real = tray.cruce(0);
    // Sin globos ni tiros que no llegan.
    if (!real || Math.abs(real.x - objetivo[0]) > 1.2 || real.y > ARCO.alto + 1.5 || real.t > 1.6) continue;
    const kit = {
      media: rnd.elegir([[0.8, 0.8, 0.8], [0.04, 0.04, 0.05], [0.6, 0.05, 0.05], [0.05, 0.1, 0.5]]),
      botin: rnd.elegir([[0.03, 0.03, 0.03], [0.8, 0.8, 0.8], [0.7, 0.75, 0.05], [0.8, 0.2, 0.05]]),
    };
    // La pelota queda sola un rato (el que patea toma carrera) y después el remate.
    const tPatada = t + 2.2;
    tPatadaActual = tPatada;
    const pies = piernas({ p0, dir: v0, tPatada, R, lado: rnd() < 0.5 ? 1 : -1, kit, rapidez });
    estadoEn = (tau) =>
      tau < tPatada
        ? { pelota: { c: p0, eje: [1, 0, 0], angulo: 0 }, cuerpos: pies(tau) }
        : { pelota: { c: tray.posicion(tau - tPatada), ...tray.giro(tau - tPatada) }, cuerpos: pies(tau) };
    seg.tracker.reset(); // como reiniciarTiro en la app

    const eventos = [];
    const filas = [];
    const vuelo = { cuadros: 0, bien: 0, mal: 0, nada: 0, presente: 0, siguiendo: 0, errores: [] };
    const fin = tPatada + real.t + 0.5;
    let terminado = null;
    let listaAlPatear = null;
    while (t < fin && !(terminado !== null && t > terminado + 0.2)) {
      const info = cuadro();
      const t0 = performance.now();
      const r = seg.procesar(info, arcoApp);
      msTotal += performance.now() - t0;
      msCuadros++;
      if (listaAlPatear === null && info.t >= tPatada) listaAlPatear = seg.tracker.ready || seg.tracker.state !== "idle";
      if (process.env.PROBS && Math.abs(info.t - tPatada - Number(process.env.PROBS)) < 0.017) {
        // Para depurar el modelo de color: cuánto "es pelota" el piso y la pelota.
        const d = seg.detector;
        const vp = proyectar(sim, info.camaraReal, p0, w, h);
        const img = info.image.data;
        const est = { piso: [], pelota: [] };
        for (let y = 0; y < h; y += 3)
          for (let x = 0; x < w; x += 3) {
            const i = (y * w + x) * 4;
            const q = ((img[i] >> 4) << 8) | ((img[i + 1] >> 4) << 4) | (img[i + 2] >> 4);
            const dentro = vp && Math.hypot(x + 0.5 - vp.x, y + 0.5 - vp.y) < 0.8 * vp.r;
            const lejos = !vp || Math.hypot(x + 0.5 - vp.x, y + 0.5 - vp.y) > 2.5 * vp.r;
            if (dentro) est.pelota.push([img[i], img[i + 1], img[i + 2], d.probs[0][q], d.pelota[q], d.fondo[0][q]]);
            else if (lejos && d.arribaDelHorizonte(x + 0.5, y + 0.5) === false) est.piso.push([img[i], img[i + 1], img[i + 2], d.probs[0][q], d.pelota[q], d.fondo[0][q]]);
          }
        const resumen = (v) => {
          const alto = v.filter((p) => p[3] >= 0.5).length / Math.max(1, v.length);
          const lum = v.map((p) => 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2]).sort((a, b) => a - b);
          return `n ${v.length} · prob≥0,5 ${(100 * alto).toFixed(0)}% · luz p10 ${lum[Math.floor(0.1 * lum.length)]?.toFixed(0)} p50 ${lum[lum.length >> 1]?.toFixed(0)} p90 ${lum[Math.floor(0.9 * lum.length)]?.toFixed(0)}`;
        };
        console.log("PROBS piso:", resumen(est.piso), "| pelota:", resumen(est.pelota));
        const muestras = (v, k) => v.filter((_, j) => j % Math.max(1, Math.floor(v.length / k)) === 0).slice(0, k).map((p) => `${p.slice(0, 3).join("/")} p${p[3].toFixed(2)} b${(1000 * p[4]).toFixed(2)} f${(1000 * p[5]).toFixed(2)}`);
        console.log("  piso:", muestras(est.piso, 12).join(" | "));
        console.log("  pelota:", muestras(est.pelota, 12).join(" | "));
      }
      if (fotos && fotos.taus.some((x) => Math.abs(info.t - tPatada - x) < 0.017)) {
        // Imagen y máscara del detector (violeta), con la pelota real marcada.
        const { png } = await import("./png.js");
        const { writeFileSync } = await import("node:fs");
        const img = info.image.data.slice();
        const m = seg.detector.closed;
        for (let i = 0; i < w * h; i++) if (m[i]) img.set([255, 0, 200], i * 4);
        const tau = info.t - tPatada;
        const v = proyectar(sim, info.camaraReal, tau < 0 ? p0 : tray.posicion(tau), w, h);
        if (v) for (let a = 0; a < 64; a++) {
          const x = Math.round(v.x + v.r * Math.cos((a / 64) * 6.283) - 0.5);
          const y = Math.round(v.y + v.r * Math.sin((a / 64) * 6.283) - 0.5);
          if (x >= 0 && y >= 0 && x < w && y < h) img.set([255, 255, 0], (y * w + x) * 4);
        }
        writeFileSync(`${fotos.dir}/s${semilla}-${n}-${tau.toFixed(2)}.png`, png(img, w, h));
        writeFileSync(`${fotos.dir}/s${semilla}-${n}-${tau.toFixed(2)}-orig.png`, png(info.image.data, w, h));
      }
      if (r.evento) {
        eventos.push({ t: info.t, ...r.evento });
        if (r.evento.type === "cross") terminado = info.t;
      }
      // ¿Midió bien la pelota en vuelo?
      const tau = info.t - tPatada;
      if (traza && process.env.DEPURAR && Math.abs(tau - Number(process.env.DEPURAR)) < 0.017) {
        console.log("DEPURAR", tau.toFixed(3), JSON.stringify(seg.detector.depuracion?.todas?.filter((m) => m.cnt > 20).map((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * 100) / 100])))));
        console.log("FORMAS", JSON.stringify(seg.detector.depuracion?.formas?.map((m) => [m.x, m.y, m.r, m.score, m.redonda].map((v) => Math.round(v * 100) / 100))));
      }
      if (traza && tau > -2.5) {
        const v = proyectar(sim, info.camaraReal, tau < 0 ? p0 : tray.posicion(tau), w, h);
        const f2 = (x) => Math.round(x * 100) / 100;
        filas.push({
          tau: f2(tau),
          verdad: v && [f2(v.x), f2(v.y), f2(v.r)],
          cands: r.candidatas.map((c) => [f2(c.x), f2(c.y), f2(c.r), f2(c.score), c.moving == null ? null : f2(c.moving), f2(c.alargada ?? 1)]),
          elegida: r.elegida,
          ub: process.env.UB ? r.ubicadas.map((c) => [f2(c.x), f2(c.y), f2(c.z), c.onGround ? "p" : "a", f2(c.escala ?? -1)]) : undefined,
          det: r.medida?.det && [f2(r.medida.det.x), f2(r.medida.det.y), f2(r.medida.det.r)],
          p: r.medida && [f2(r.medida.x), f2(r.medida.y), f2(r.medida.z), r.medida.onGround ? "piso" : "aire"],
          real: tau < 0 ? p0.map(f2) : tray.posicion(tau).map(f2),
          st: seg.tracker.state,
          lista: seg.tracker.ready,
          quietos: process.env.UB ? seg.tracker.quietos.map((q) => [f2(q.x), f2(q.z), q.armado ? "A" : "-", q.n, f2(q.pr), q.saliendo.length]) : undefined,
          ev: r.evento?.type,
          pred: r.evento?.prediction ? [f2(r.evento.prediction.x), f2(r.evento.prediction.y), r.evento.prediction.rolling ? "piso" : "aire"] : undefined,
          cruceReal: [f2(real.x), f2(real.y - errorPiso)],
        });
      }
      if (tau > 0.02 && tau < real.t) {
        const verdad = proyectar(sim, info.camaraReal, tray.posicion(tau), w, h);
        if (verdad && verdad.x > 0 && verdad.x < w && verdad.y > 0 && verdad.y < h) {
          vuelo.cuadros++;
          // ¿La pelota estaba entre las candidatas? (si no, el problema es detectarla)
          const tol = Math.max(2.5, 0.6 * verdad.r);
          if (r.ubicadas.some((u) => Math.hypot(u.px - verdad.x, u.py - verdad.y) < tol)) vuelo.presente++;
          if (seg.tracker.state === "flight" || seg.tracker.state === "done") vuelo.siguiendo++;
          if (process.env.ESTELAS) {
            // Para calibrar: tamaño (escala) de las estelas que son la pelota y de las que no.
            const lineas = r.ubicadas
              .filter((u) => u.estela)
              .map((u) => `${Math.hypot(u.px - verdad.x, u.py - verdad.y) < Math.max(2.5, 0.6 * verdad.r) ? "bien" : "mal"} ${(u.escala ?? -1).toFixed(3)} ${(u.alargada ?? 1).toFixed(2)} ${u.onGround ? "p" : "a"} ${u.pr.toFixed(2)} ${(u.det.rCobertura ?? -1).toFixed(2)} ${verdad.r.toFixed(2)}\n`);
            if (lineas.length) appendFileSync(process.env.ESTELAS, lineas.join(""));
          }
          const m = r.medida?.det;
          if (!m) vuelo.nada++;
          else {
            const e = Math.hypot(m.x - verdad.x, m.y - verdad.y);
            if (e < Math.max(2.5, 0.6 * verdad.r)) {
              vuelo.bien++;
              vuelo.errores.push(e);
            } else vuelo.mal++;
          }
        }
      }
    }
    const kick = eventos.find((e) => e.type === "kick");
    const cruce = eventos.find((e) => e.type === "cross");
    const falso = eventos.some((e) => e.type === "kick" && e.t < tPatada - 0.02);
    const verdad = { x: real.x, y: real.y - errorPiso, t: tPatada + real.t };
    // Última predicción disponible 0,2 s antes de que llegue (lo que puede usar el arquero).
    const antes = eventos.filter((e) => e.prediction && e.t <= verdad.t - 0.2 && e.t > tPatada).at(-1);
    const err = (p) => (p ? Math.hypot(p.x - verdad.x, p.y - verdad.y) * 100 : null);
    const res = {
      n,
      sesion: semilla,
      rapidez: Math.round(rapidez),
      rasante,
      efecto: efecto ? efecto.c : 0,
      distancia: Math.round(Math.hypot(p0[0], p0[2]) * 10) / 10,
      remate: Boolean(kick && kick.t >= tPatada - 0.02 && kick.t < tPatada + 0.35),
      lista: listaAlPatear,
      demora: kick ? kick.t - tPatada : null,
      falso,
      resultado: Boolean(cruce),
      error: cruce ? err(cruce.prediction) : null,
      errorX: cruce ? Math.abs(cruce.prediction.x - verdad.x) * 100 : null,
      errorY: cruce ? Math.abs(cruce.prediction.y - verdad.y) * 100 : null,
      // Velocidad que muestra la app (km/h) y la real.
      kmh: cruce && Number.isFinite(cruce.prediction.kickSpeed) ? cruce.prediction.kickSpeed * 3.6 : null,
      errorAntes: antes ? err(antes.prediction) : null,
      vuelo,
      filas: traza ? filas : undefined,
      ms: msTotal / Math.max(1, msCuadros),
    };
    resultados.push(res);
    if (detalle) {
      res.texto = (
        `  [${nombre} s${semilla} #${n}] ${res.rapidez} m/s ${rasante ? "rasante" : "aire"}${efecto ? " efecto" : ""} a ${res.distancia} m · ` +
          `${res.lista ? "" : "NO LISTA · "}remate ${res.remate ? "sí" : "NO"}${falso ? " (FALSO antes)" : ""} · ${res.resultado ? `error ${res.error.toFixed(1)} cm (x ${res.errorX.toFixed(1)}, y ${res.errorY.toFixed(1)})` : "sin resultado"}` +
          (res.kmh != null ? ` · ${res.kmh.toFixed(0)}/${(rapidez * 3.6).toFixed(0)} km/h` : "") +
          ` · vuelo ${vuelo.bien}/${vuelo.cuadros} bien, ${vuelo.mal} mal, ${vuelo.nada} nada · eventos ${eventos.map((e) => e.type[0]).join("")}` +
          ` · kicks ${eventos.filter((e) => e.type === "kick").map((e) => `${(e.t - tPatada).toFixed(2)}s/cal${e.prediction?.calidad?.toFixed(1)}/n${e.n ?? "?"}`).join(",")}` +
          (n === 0 ? ` · fuga ${aprendio.fuga?.toFixed(2)} · radio ${radioEscaneo ? (radioEscaneo * 100).toFixed(1) : "-"}/${(R * 100).toFixed(1)} cm` : "") +
          ` · calibrado ${(seg.radio * 100).toFixed(1)} cm (${seg.muestrasRadio.length})`
      );
    }
    // La pelota vuelve a su lugar: unos cuadros quieta antes del próximo.
    estadoEn = () => ({ pelota: { c: base, eje: [1, 0, 0], angulo: 0 }, cuerpos: [] });
  }
  return { resultados };
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "-");
const cuantil = (vs, q) => {
  if (!vs.length) return null;
  const o = [...vs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.floor(q * o.length))];
};
const cm = (v) => (v === null ? "-" : `${v.toFixed(1)}`);

export function resumir(rs) {
  const n = rs.length;
  const conRes = rs.filter((r) => r.resultado);
  const errores = conRes.map((r) => r.error);
  const antes = rs.filter((r) => r.errorAntes !== null).map((r) => r.errorAntes);
  const v = rs.reduce(
    (a, r) => ({ c: a.c + r.vuelo.cuadros, b: a.b + r.vuelo.bien, m: a.m + r.vuelo.mal, p: a.p + r.vuelo.presente, s: a.s + r.vuelo.siguiendo }),
    { c: 0, b: 0, m: 0, p: 0, s: 0 },
  );
  const rapidos = rs.filter((r) => r.rapidez >= 20);
  return {
    tiros: n,
    lista: pct(rs.filter((r) => r.lista).length, n),
    remate: pct(rs.filter((r) => r.remate).length, n),
    falsos: rs.filter((r) => r.falso).length,
    resultado: pct(conRes.length, n),
    resultadoRapidos: pct(rapidos.filter((r) => r.resultado).length, rapidos.length),
    errorMediana: cuantil(errores, 0.5),
    // Error de la velocidad mostrada (%), mediana.
    errorVelocidad: cuantil(rs.filter((r) => r.kmh != null).map((r) => Math.abs(r.kmh / (r.rapidez * 3.6) - 1) * 100), 0.5),
    error90: cuantil(errores, 0.9),
    errorAntesMediana: cuantil(antes, 0.5),
    vueloBien: pct(v.b, v.c),
    vueloMal: pct(v.m, v.c),
    vueloPresente: pct(v.p, v.c),
    vueloSiguiendo: pct(v.s, v.c),
    pxMediana: cuantil(rs.flatMap((r) => r.vuelo.errores), 0.5),
    ms: rs.length ? rs.reduce((a, r) => a + r.ms, 0) / rs.length : 0,
  };
}

// Corre las sesiones en paralelo (un hilo por núcleo).
function enParalelo(trabajos) {
  const hilos = Math.max(1, Math.min(availableParallelism(), trabajos.length));
  const resultados = new Array(trabajos.length);
  let siguiente = 0;
  return new Promise((ok, mal) => {
    let activos = 0;
    const lanzar = () => {
      if (siguiente >= trabajos.length) {
        if (activos === 0) ok(resultados);
        return;
      }
      const i = siguiente++;
      activos++;
      const w = new Worker(new URL(import.meta.url), { workerData: trabajos[i] });
      w.once("message", (r) => {
        resultados[i] = r;
        activos--;
        w.terminate();
        lanzar();
      });
      w.once("error", mal);
    };
    for (let k = 0; k < hilos; k++) lanzar();
  });
}

export async function correr({ escenarios, sesiones, tiros, semilla, detalle }) {
  const tabla = {};
  for (const nombre of escenarios) {
    const t0 = Date.now();
    // Se piden semillas de más: las sesiones donde el celular no ve la pelota y
    // el arco a la vez se descartan enseguida (sin dibujar nada).
    const trabajos = [];
    for (let k = 1; k <= sesiones * 3; k++) trabajos.push({ nombre, semilla: semilla + k * 101, tiros, detalle, soloVer: true });
    const validas = (await enParalelo(trabajos)).map((r, i) => (r.omitida ? null : trabajos[i])).filter(Boolean).slice(0, sesiones);
    const salidas = await enParalelo(validas.map((t) => ({ ...t, soloVer: false })));
    const todos = [];
    for (const r of salidas) {
      if (r.omitida) {
        console.log(`  [${nombre}] sesión omitida${r.motivo ? `: ${r.motivo}` : ""}`);
        continue;
      }
      for (const x of r.resultados) {
        if (detalle && x.texto) console.log(x.texto);
        todos.push(x);
      }
    }
    tabla[nombre] = { ...resumir(todos), segundos: Math.round((Date.now() - t0) / 1000) };
    const f = tabla[nombre];
    console.log(
      `${nombre.padEnd(14)} tiros ${f.tiros} · lista ${f.lista} · remate ${f.remate} · falsos ${f.falsos} · resultado ${f.resultado} (≥20 m/s: ${f.resultadoRapidos})` +
        ` · error cm mediana ${cm(f.errorMediana)} / 90% ${cm(f.error90)} · 0,2 s antes ${cm(f.errorAntesMediana)}` +
        ` · velocidad error ${f.errorVelocidad == null ? "-" : `${f.errorVelocidad.toFixed(0)} %`}` +
        ` · vuelo bien ${f.vueloBien} mal ${f.vueloMal} (detectada ${f.vueloPresente}, ya en vuelo ${f.vueloSiguiendo}) · px ${f.pxMediana?.toFixed(2) ?? "-"} · ${f.ms.toFixed(1)} ms/cuadro · ${f.segundos} s`,
    );
  }
  return tabla;
}

if (!isMainThread) {
  const { nombre, semilla, tiros, detalle, soloVer } = workerData;
  parentPort.postMessage(await sesion({ nombre, cfg: ESCENARIOS[nombre], semilla, tiros, detalle, soloVer }));
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1] : d;
  };
  await correr({
    escenarios: arg("escenario", Object.keys(ESCENARIOS).join(",")).split(","),
    sesiones: Number(arg("sesiones", 4)),
    tiros: Number(arg("tiros", 5)),
    semilla: Number(arg("semilla", 1)),
    detalle: process.argv.includes("--detalle"),
  });
}
