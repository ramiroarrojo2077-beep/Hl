import * as THREE from "three";
import { BallDetector, matrizK } from "./detector.js";
import { ShotTracker, locateBall, radioApoyada } from "./tracker.js";

// Seguimiento de la pelota cuadro a cuadro: detecta, mide fino, ubica en 3D y
// le pasa todo al ShotTracker. No toca la pantalla ni el DOM, así que también
// corre en Node (banco de pruebas con imágenes simuladas, ver sim/).
//
// Cada cuadro llega como `info`:
//   t: segundos; camMatrix, projMatrix: THREE.Matrix4 de la cámara (mundo);
//   image: {data, width, height} RGBA chica con la fila 0 abajo;
//   region: {factor, leer(reg, w, h)} para leer recortes en resolución real, o null.
// `arco` es la matriz (THREE.Matrix4) que lleva coordenadas del arco al mundo.

// Cámara del cuadro para comparar con el anterior: K (proyección a píxeles) y R (giro).
// Si se pasa la matriz del arco, también la posición de la cámara (p) y la altura
// del piso (pisoY): con eso se descuenta además cómo se desplazó el celular (ver
// homografia en detector.js).
export function camaraDe(info, w, h, arco = null) {
  const e = info.camMatrix.elements;
  const c = { K: matrizK(info.projMatrix.elements, w, h), R: [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]] };
  if (arco) {
    c.p = [e[12], e[13], e[14]];
    c.pisoY = arco.elements[13];
  }
  return c;
}

export class BallTracking {
  constructor({ radio }) {
    this.detector = new BallDetector(64, 64);
    this.tracker = new ShotTracker({ ballRadius: radio });
    this.radioNominal = radio;
    // Con la cámara real dos imágenes idénticas son la misma (el sensor siempre
    // tiene ruido); en la demo, con la escena quieta, pueden ser cuadros nuevos.
    this.saltarRepetidos = true;
    this.tmp = {
      inv: new THREE.Matrix4(),
      proyInv: new THREE.Matrix4(),
      vista: new THREE.Matrix4(),
      v: new THREE.Vector3(),
      c: new THREE.Vector3(),
    };
    this.reiniciarRadio();
    this.reset();
  }

  // Empieza de cero el seguimiento (no lo aprendido de la pelota).
  reset() {
    this.tracker.reset();
    this.detector.hasPrev = false;
    this.detector.hasPrev2 = false;
    this.ultimaDeteccion = null;
  }

  // ---------- Tamaño real de la pelota ----------
  //
  // Con la pelota quieta en el piso, la distancia se conoce por el piso y de ahí
  // sale su radio real tal como la ve esta cámara (ver radioApoyada). Ese radio
  // se usa para medir la distancia cuando va por el aire: así no importa si el
  // número de pelota elegido no es exacto, y se descuenta cualquier error fijo
  // de la medición del tamaño.
  setAnchoArco(ancho) {
    this.tracker.setGoalWidth(ancho);
  }

  setRadioNominal(r) {
    this.radioNominal = r;
    this.reiniciarRadio();
  }

  // La pelota escaneada (apoyada en el piso): dónde está (en coordenadas del
  // arco) y de qué tamaño la ve el detector. El tamaño, comparado con el que
  // tendría a esa distancia del piso del arco (ver radioApoyada), da:
  //  - escala ≈ 1: todo bien;
  //  - algo distinta (0,6 a 1,7): el detector la ve más chica o más grande (una
  //    pelota oscura sobre un piso oscuro: sólo se marcan sus dibujos) o el
  //    número elegido no es el de la pelota; se calibra con el radio aparente;
  //  - muy distinta: el arco no está apoyado en el mismo piso que la pelota
  //    (quedó sobre otra cosa), y con eso nada se puede medir bien.
  // det: la que encontró el escaneo. null si no se puede ubicar.
  medirEscaneada(info, arco, det) {
    if (!det || !arco) return null;
    const { width: w, height: h } = info.image;
    this.tmp.proyInv.copy(info.projMatrix).invert();
    this.tmp.inv.copy(arco).invert();
    const lugar = this.ubicar(info, det, w, h);
    if (!lugar) return null;
    const aparente = radioApoyada(lugar.o, lugar.d, lugar.ang);
    if (!aparente) return null;
    const escala = aparente / this.radioNominal;
    // Dónde está: el rayo al centro cortando el piso (a la altura de su radio).
    const enPiso = this.ubicar(info, { ...det, r: det.r / Math.max(escala, 0.2) }, w, h);
    const pos = enPiso?.onGround ? { x: enPiso.x, y: enPiso.y, z: enPiso.z } : null;
    return { pos, escala, radio: aparente, pisoDistinto: escala < 0.6 || escala > 1.7 };
  }

  reiniciarRadio() {
    this.radio = this.radioNominal;
    this.muestrasRadio = [];
    this.tracker.setBallRadius(this.radio);
  }

  #calibrarRadio(medida) {
    const { tracker } = this;
    if (!tracker.ready || !medida?.onGround || !medida.det?.refinada) return;
    const reposo = tracker.restPosition();
    if (!reposo || Math.hypot(medida.x - reposo.x, medida.z - reposo.z) > 0.25) return;
    const r = radioApoyada(medida.o, medida.d, medida.ang);
    if (!r) return;
    const m = this.muestrasRadio;
    m.push(r);
    if (m.length > 90) m.shift();
    if (m.length < 20) return;
    const mediana = [...m].sort((a, b) => a - b)[m.length >> 1];
    // Si da algo muy distinto, el problema es otro (el piso del arco a otra altura).
    if (Math.abs(mediana / this.radioNominal - 1) > 0.25) return;
    this.radio = mediana;
    tracker.setBallRadius(mediana);
  }

  // ---------- Cuadro a cuadro ----------

  // Devuelve {candidatas, elegida, medida, evento}.
  procesar(info, arco) {
    const { detector, tracker, tmp } = this;
    const { data, width: w, height: h } = info.image;
    detector.resize(w, h);
    const camara = camaraDe(info, w, h, arco);
    const t = info.t;
    tmp.proyInv.copy(info.projMatrix).invert();
    tmp.inv.copy(arco).invert();
    tmp.vista.copy(info.camMatrix).invert();

    // Dónde buscar: en vuelo, donde dice la trayectoria; lista, donde quedó quieta.
    const enVuelo = tracker.state === "flight";
    const esperado = tracker.expectedPosition(t) ?? tracker.restPosition();
    const enImagen = esperado ? this.proyectar(info, esperado, arco, w, h) : null;
    // En vuelo se favorece lo que está cerca de donde dice la trayectoria. Quieta
    // no: si la que quedó "lista" fuera otra cosa, la pelota de verdad perdería
    // puntaje y nunca se corregiría.
    const near = enVuelo ? enImagen : null;
    const foco = enVuelo && enImagen ? { x: enImagen.x, y: enImagen.y, r: Math.max(4 * enImagen.r, 20) } : null;
    // Mientras no hay una pelota lista, se busca sólo en el piso (ahí está quieta);
    // lista o en vuelo, en toda la imagen: al patearla se eleva sobre el horizonte.
    const soloSuelo = !enVuelo && !tracker.ready;
    // Si se sabe dónde está (quieta o en vuelo), se sabe de qué tamaño se ve:
    // las formas redondas se buscan sólo en esas escalas (mucho más rápido).
    const EXP = globalThis.process?.env?.EXP ?? "";
    const escalas = enImagen ? (EXP.includes("escalasAnchas") ? { min: 0.35 * enImagen.r, max: 2.2 * enImagen.r } : { min: 0.5 * enImagen.r, max: 1.8 * enImagen.r }) : null;
    const etapa = enVuelo || tracker.state === "done" ? "vuelo" : soloSuelo ? "quieta" : "lista";
    const candidatas = detector.detectAll(data, { camera: camara, near, foco, soloSuelo, escalas, radio: this.radio, etapa, proteger: enImagen });
    // La misma imagen que el cuadro anterior (la pantalla va más rápido que la
    // cámara): no es una medición nueva. Contarla haría parecer que la pelota se
    // quedó quieta un instante y arruinaría la velocidad y la trayectoria.
    if (detector.repetido && this.saltarRepetidos) return { candidatas, ubicadas: [], elegida: -1, medida: null, evento: tracker.tick(t), repetido: true };

    // El seguimiento elige cuál es la pelota (la que sigue quieta, la que sale del
    // punto de reposo o la que va por la trayectoria); las demás se descartan.
    const ubicadas = candidatas.map((c) => this.ubicar(info, c, w, h)).filter(Boolean);
    // En vuelo, además, se la busca directamente donde dice la trayectoria, en la
    // imagen de alta resolución y por su borde redondo: si está ahí se la
    // encuentra aunque la búsqueda general la haya confundido con otra cosa.
    // Sólo si la búsqueda general no encontró nada cerca de lo previsto.
    const nadaCerca = enImagen && !ubicadas.some((u) => Math.hypot(u.px - enImagen.x, u.py - enImagen.y) < Math.max(4, 1.5 * enImagen.r));
    if (!EXP.includes("sinLocal") && enVuelo && enImagen && nadaCerca && tracker.shot?.obs.length >= 2) {
      const guia = { x: enImagen.x, y: enImagen.y, r: enImagen.r, score: 1, moving: 1, alargada: 1 };
      const fina = this.refinar(info, guia, w, h);
      const cerca = Math.hypot(fina.x - guia.x, fina.y - guia.y) < Math.max(3, 1.3 * guia.r);
      if (fina.refinada && cerca && fina.r > 0.6 * guia.r && fina.r < 1.6 * guia.r && (fina.borde ?? 0) >= 0.55) {
        const local = this.ubicar(info, { ...fina, score: 1.3 }, w, h);
        const repetida = local && ubicadas.some((u) => Math.hypot(u.px - local.px, u.py - local.py) < 0.5 * local.pr);
        if (local && !repetida) ubicadas.push({ ...local, local: true });
      }
    }
    // Quieta (lista, o viéndose quieta en un lugar): si no aparece sola ahí
    // porque está pegada a algo también marcado (una pierna, una línea: forman
    // una sola mancha), se la busca por su borde redondo y su tamaño en ese
    // lugar. Sólo si ahí sigue habiendo color de pelota y nada se movió (si se
    // movió, puede estar saliendo: que decida el seguimiento).
    const quieta = !enVuelo && tracker.state === "idle" ? (tracker.ready ? enImagen : this.#quietaEnImagen(info, arco, w, h)) : null;
    if (!EXP.includes("sinLocalQuieta") && quieta) {
      const ocupada = ubicadas.some((u) => Math.hypot(u.px - quieta.x, u.py - quieta.y) < 0.5 * quieta.r && Math.abs(Math.log(u.pr / quieta.r)) < 0.35);
      const zona = ocupada ? null : detector.promedioEn(quieta.x, quieta.y, 0.8 * quieta.r);
      if (zona && zona.score >= 0.45 && zona.moving < 0.3) {
        const guia = { x: quieta.x, y: quieta.y, r: quieta.r, score: 1, moving: 0, alargada: 1 };
        const fina = this.refinar(info, guia, w, h);
        const cerca = Math.hypot(fina.x - guia.x, fina.y - guia.y) < Math.max(2, 0.4 * guia.r);
        if (fina.refinada && cerca && Math.abs(Math.log(fina.r / guia.r)) < 0.3 && (fina.borde ?? 0) >= 0.6) {
          const local = this.ubicar(info, { ...fina, score: 1.2, moving: zona.moving }, w, h);
          if (local) ubicadas.push({ ...local, local: true });
        }
      }
    }
    tracker.observe(t, ubicadas);
    const elegida = tracker.choose(t, ubicadas);
    let evento = null;
    let medida = null;
    if (elegida >= 0) {
      medida = ubicadas[elegida];
      const fina = this.refinar(info, medida.det, w, h);
      if (fina.refinada) medida = this.ubicar(info, fina, w, h) ?? medida;
      this.ultimaDeteccion = { ...medida.det, t };
      const { det: _det, ...obs } = medida;
      evento = tracker.add(t, obs);
      this.#calibrarRadio(medida);
    }
    evento ??= tracker.tick(t);
    return { candidatas, ubicadas, elegida, medida, evento };
  }

  // Dónde (en la imagen) está lo que se viene viendo quieto, todavía sin estar
  // lista (visto al menos 3 veces hace poco), o null.
  #quietaEnImagen(info, arco, w, h) {
    let mejor = null;
    for (const q of this.tracker.quietos) if (q.n >= 3 && info.t - q.tUlt < 0.5 && (!mejor || q.n > mejor.n)) mejor = q;
    return mejor ? this.proyectar(info, mejor, arco, w, h) : null;
  }

  // Proyección en la imagen de un punto del arco (metros), o null si queda fuera.
  proyectar(info, p, arco, w, h) {
    const { tmp } = this;
    const mundo = tmp.v.set(p.x, p.y, p.z).applyMatrix4(arco);
    const distancia = mundo.distanceTo(tmp.c.setFromMatrixPosition(info.camMatrix));
    const ndc = mundo.applyMatrix4(tmp.vista.copy(info.camMatrix).invert()).applyMatrix4(info.projMatrix);
    if (!(Math.abs(ndc.x) < 1.2 && Math.abs(ndc.y) < 1.2 && ndc.z < 1)) return null;
    const radio = ((info.projMatrix.elements[5] * h) / 2) * (this.radio / distancia);
    return { x: ((ndc.x + 1) / 2) * w, y: ((ndc.y + 1) / 2) * h, r: Math.max(2, radio) };
  }

  // Vuelve a medir la pelota en un recorte de la cámara con su resolución real
  // (hasta 4 veces más fino que la imagen chica). Si no sale, queda la medición original.
  refinar(info, det, w, h) {
    const reg = info.region;
    if (det.estela) return det; // borrosa: no hay borde que medir
    // Hasta 4 veces más fino, sin pasar de ~20 px de radio en el recorte: con eso
    // el borde ya se mide con centésimas de píxel y cuesta poco.
    const factor = Math.min(4, reg?.factor ?? 0, 20 / Math.max(det.r, 1));
    if (factor < 1.5) return det;
    const lado = Math.max(5 * det.r, 24);
    const x0 = det.x - lado / 2;
    const y0 = det.y - lado / 2;
    if (x0 < 0 || y0 < 0 || x0 + lado > w || y0 + lado > h) return det;
    const tam = Math.min(128, Math.round(lado * factor));
    const recorte = reg.leer({ x: x0 / w, y: y0 / h, w: lado / w, h: lado / h }, tam, tam);
    const k = tam / lado;
    const alto = this.detector.arribaDelHorizonte(det.x, det.y);
    const fino = this.detector.refine(recorte, tam, tam, { x: tam / 2, y: tam / 2, r: det.r * k }, { alto });
    if (!fino) return det;
    return { ...det, x: x0 + fino.x / k, y: y0 + fino.y / k, r: fino.r / k, refinada: true, borde: fino.borde ?? null };
  }

  // Posición 3D (en el arco) de una mancha de la imagen, con el rayo de la cámara
  // que pasa por su centro. null si queda en un lugar imposible.
  // Usa tmp.proyInv y tmp.inv del cuadro (ver procesar).
  ubicar(info, det, w, h) {
    const { tmp } = this;
    const rayo = (x, y) =>
      new THREE.Vector3((x / w) * 2 - 1, (y / h) * 2 - 1, 0.5).applyMatrix4(tmp.proyInv).normalize().transformDirection(info.camMatrix);
    const centro = rayo(det.x, det.y);
    const angular = (rayo(det.x - det.r, det.y).angleTo(rayo(det.x + det.r, det.y)) + rayo(det.x, det.y - det.r).angleTo(rayo(det.x, det.y + det.r))) / 4;
    const origen = new THREE.Vector3().setFromMatrixPosition(info.camMatrix).applyMatrix4(tmp.inv);
    const dir = centro.transformDirection(tmp.inv);
    const p = locateBall(origen, dir, angular, this.radio);
    if (!(p.z > -1.5 && Math.hypot(p.x, p.z) < 40)) return null;
    // Qué radio real tendría si estuviera apoyada en el piso ahí, comparado con
    // el de la pelota: una mancha chica en el piso (un botín lejos, la base de un
    // palo) o una grande (una pierna cerca) no es la pelota.
    const real = radioApoyada(origen, dir, angular);
    return {
      ...p,
      escala: real ? real / this.radio : null,
      px: det.x,
      py: det.y,
      pr: det.r,
      score: det.score,
      moving: det.moving,
      alargada: det.alargada,
      estela: Boolean(det.estela),
      // Rayo de la cámara en coordenadas del arco, para ajustar la trayectoria.
      o: { x: origen.x, y: origen.y, z: origen.z },
      d: { x: dir.x, y: dir.y, z: dir.z },
      ang: angular,
      det,
    };
  }
}
