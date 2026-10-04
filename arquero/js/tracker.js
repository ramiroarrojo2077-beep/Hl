// Sigue la pelota en 3D y detecta el remate.
//
// Todo está en coordenadas del arco: x hacia la derecha (mirando el arco desde
// la cancha), y hacia arriba desde el piso, z hacia la cancha. La línea de gol
// es el plano z = 0 y el arco ocupa |x| ≤ ancho/2, 0 ≤ y ≤ alto.

export const GRAVEDAD = 9.81;

const VENTANA_REMATE = 0.2; // s de historia para decidir si hubo remate
const VELOCIDAD_MINIMA = 3; // m/s
const ACERCAMIENTO_MINIMO = 2; // m/s hacia el arco
const VUELO_MAXIMO = 3; // s
const SALTO_MAXIMO = 45; // m/s; más que esto entre dos cuadros es un error de medición

// Ubica la pelota a partir del rayo de la cámara que pasa por su centro.
// La distancia sale del tamaño aparente (radio angular); si la pelota va por el
// piso, cortar el rayo con el plano y = radio es mucho más preciso.
export function locateBall(origin, dir, angularRadius, ballRadius) {
  const porTamano = ballRadius / Math.sin(Math.max(angularRadius, 1e-4));
  let d = porTamano;
  let onGround = false;
  if (dir.y < -0.02) {
    const porPiso = (ballRadius - origin.y) / dir.y;
    // Si el tamaño dice que está bastante más cerca que el piso, va por el aire.
    if (porPiso > 0 && porTamano >= 0.82 * porPiso) {
      d = porPiso;
      onGround = true;
    }
  }
  return {
    x: origin.x + dir.x * d,
    y: Math.max(origin.y + dir.y * d, ballRadius * 0.5),
    z: origin.z + dir.z * d,
    onGround,
  };
}

// Ajuste por cuadrados mínimos de v(τ) = a + b·τ. Devuelve [a, b, error cuadrático medio].
function ajusteLineal(ts, vs) {
  const n = ts.length;
  let mt = 0;
  let mv = 0;
  for (let i = 0; i < n; i++) {
    mt += ts[i];
    mv += vs[i];
  }
  mt /= n;
  mv /= n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (ts[i] - mt) * (vs[i] - mv);
    den += (ts[i] - mt) ** 2;
  }
  const b = den > 1e-9 ? num / den : 0;
  const a = mv - b * mt;
  let err = 0;
  for (let i = 0; i < n; i++) err += (vs[i] - a - b * ts[i]) ** 2;
  return [a, b, Math.sqrt(err / n)];
}

// Altura de la pelota τ segundos después de estar en y0 con velocidad vertical
// vy, con hasta cuatro piques.
export function heightAt(y0, vy, tau, radius, g = GRAVEDAD) {
  let y = Math.max(y0, radius);
  let v = vy;
  let t = 0;
  for (let pique = 0; pique < 4; pique++) {
    const A = -g / 2;
    const C = y - radius;
    const s = (-v - Math.sqrt(Math.max(0, v * v - 4 * A * C))) / (2 * A);
    if (!(s > 1e-4) || t + s >= tau) {
      const dt = tau - t;
      return Math.max(radius, y + v * dt - (g / 2) * dt * dt);
    }
    t += s;
    v = -(v - g * s) * 0.6;
    y = radius;
    if (v < 0.5) return radius;
  }
  return radius;
}

// ---------- Ajuste de la trayectoria a lo que ve la cámara ----------
//
// Cada medición es un rayo desde la cámara (o, d) y un radio angular (ang). Se
// buscan la posición y la velocidad cuya trayectoria (recta por el piso, o
// parábola con gravedad por el aire) mejor explica todos los rayos a la vez.
// La dirección del rayo se mide con precisión de fracciones de píxel; la
// distancia sale del conjunto (perspectiva + gravedad + tamaño), mucho más
// estable que la distancia por tamaño de cada cuadro por separado.
//
// Además la trayectoria tiene que pasar por el punto desde donde se pateó (la
// pelota estuvo quieta ahí muchos cuadros, así que se conoce muy bien) en algún
// instante entre el último cuadro quieto y el primero en movimiento.

const S_DIRECCION = 0.0015; // rad (~0,5 px)
const S_TAMANO = 0.002; // rad en el radio angular

function base(d) {
  // Dos ejes perpendiculares al rayo.
  const a = Math.abs(d.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let e1 = { x: a.y * d.z - a.z * d.y, y: a.z * d.x - a.x * d.z, z: a.x * d.y - a.y * d.x };
  const n1 = Math.hypot(e1.x, e1.y, e1.z);
  e1 = { x: e1.x / n1, y: e1.y / n1, z: e1.z / n1 };
  const e2 = { x: d.y * e1.z - d.z * e1.y, y: d.z * e1.x - d.x * e1.z, z: d.x * e1.y - d.y * e1.x };
  return [e1, e2];
}

// p = [x0, y0, z0, vx, vy, vz, tPatada] en tRef (en piso, y0 = R y vy = 0).
function posicion(p, tau, R, piso) {
  return {
    x: p[0] + p[3] * tau,
    y: piso ? R : p[1] + p[4] * tau - (GRAVEDAD / 2) * tau * tau,
    z: p[2] + p[5] * tau,
  };
}

function residuos(caso, p, out) {
  const { obs, bases, tRef, R, piso, reposo } = caso;
  let k = 0;
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    const P = posicion(p, o.t - tRef, R, piso);
    const qx = P.x - o.o.x;
    const qy = P.y - o.o.y;
    const qz = P.z - o.o.z;
    const dist = Math.hypot(qx, qy, qz);
    const [e1, e2] = bases[i];
    out[k++] = (qx * e1.x + qy * e1.y + qz * e1.z) / dist / S_DIRECCION;
    out[k++] = (qx * e2.x + qy * e2.y + qz * e2.z) / dist / S_DIRECCION;
    out[k++] = (Math.asin(Math.min(1, R / dist)) - o.ang) / S_TAMANO;
  }
  if (reposo) {
    const P = posicion(p, p[6] - tRef, R, piso);
    out[k++] = (P.x - reposo.x) / reposo.sigma;
    out[k++] = (P.y - reposo.y) / reposo.sigma;
    out[k++] = (P.z - reposo.z) / reposo.sigma;
  }
  return out;
}

const suma2 = (r) => r.reduce((a, v) => a + v * v, 0);

// Resuelve A·x = b (A n×n, por filas) con eliminación gaussiana.
function resolver(A, b, n) {
  const M = A.map((fila, i) => [...fila, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let f = c + 1; f < n; f++) if (Math.abs(M[f][c]) > Math.abs(M[piv][c])) piv = f;
    [M[c], M[piv]] = [M[piv], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) return null;
    for (let f = c + 1; f < n; f++) {
      const k = M[f][c] / M[c][c];
      for (let j = c; j <= n; j++) M[f][j] -= k * M[c][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let f = n - 1; f >= 0; f--) {
    let s = M[f][n];
    for (let j = f + 1; j < n; j++) s -= M[f][j] * x[j];
    x[f] = s / M[f][f];
  }
  return x;
}

// Levenberg-Marquardt con jacobiano numérico.
function minimizar(caso, inicial) {
  const { piso, reposo } = caso;
  const libres = [...(piso ? [0, 2, 3, 5] : [0, 1, 2, 3, 4, 5]), ...(reposo ? [6] : [])];
  const n = libres.length;
  const m = caso.obs.length * 3 + (reposo ? 3 : 0);
  const acotar = (q) => {
    if (piso) {
      q[1] = caso.R;
      q[4] = 0;
    }
    if (reposo) q[6] = Math.min(reposo.tMax, Math.max(reposo.tMin, q[6]));
    return q;
  };
  let p = acotar(inicial.slice());
  let r = residuos(caso, p, new Float64Array(m));
  let costo = suma2(r);
  let lambda = 1e-3;
  const rMas = new Float64Array(m);
  const rMenos = new Float64Array(m);
  for (let it = 0; it < 25; it++) {
    const J = libres.map((k) => {
      const h = 1e-5;
      const q = p.slice();
      q[k] += h;
      residuos(caso, q, rMas);
      q[k] -= 2 * h;
      residuos(caso, q, rMenos);
      return Array.from(rMas, (v, i) => (v - rMenos[i]) / (2 * h));
    });
    const A = [];
    const g = [];
    for (let a = 0; a < n; a++) {
      A.push([]);
      let s = 0;
      for (let i = 0; i < m; i++) s += J[a][i] * r[i];
      g.push(-s);
      for (let b = 0; b < n; b++) {
        let t = 0;
        for (let i = 0; i < m; i++) t += J[a][i] * J[b][i];
        A[a].push(t);
      }
    }
    let mejoro = false;
    for (let intento = 0; intento < 8 && !mejoro; intento++) {
      const Ad = A.map((fila, i) => fila.map((v, j) => (i === j ? v * (1 + lambda) + 1e-9 : v)));
      const paso = resolver(Ad, g, n);
      if (!paso) break;
      const q = p.slice();
      libres.forEach((k, i) => (q[k] += paso[i]));
      acotar(q);
      const rq = residuos(caso, q, new Float64Array(m));
      const c = suma2(rq);
      if (c < costo) {
        const chico = costo - c < 1e-6 * costo;
        p = q;
        r = rq;
        costo = c;
        lambda = Math.max(lambda * 0.3, 1e-7);
        mejoro = true;
        if (chico) return { p, costo };
      } else {
        lambda *= 10;
      }
    }
    if (!mejoro) break;
  }
  return { p, costo };
}

// Devuelve la trayectoria en tRef: {x0, y0, z0, vx, vy, vz, enPiso}.
// reposo: {x, y, z, sigma, tMin, tMax} punto de la patada, o null.
export function ajustarTrayectoria(obs, tRef, inicial, R, reposo = null) {
  const bases = obs.map((o) => base(o.d));
  const tPatada = reposo ? (reposo.tMin + reposo.tMax) / 2 : tRef;
  const p0 = [inicial.x0, inicial.y0, inicial.z0, inicial.vx, inicial.vy, inicial.vz, tPatada];
  const comun = { obs, bases, tRef, R, reposo };
  const piso = minimizar({ ...comun, piso: true }, p0);
  let aire = minimizar({ ...comun, piso: false }, p0);

  // Si la parábola pica dentro del tramo medido, se ajusta sólo después del pique.
  const [, y0, , , vy] = aire.p;
  const A = -GRAVEDAD / 2;
  const disc = vy * vy - 4 * A * (y0 - R);
  if (disc > 0) {
    const tauPique = (-vy - Math.sqrt(disc)) / (2 * A); // relativo a tRef
    const despues = obs.filter((o) => o.t - tRef > tauPique + 0.02);
    const primera = obs[0].t - tRef;
    if (tauPique > primera && tauPique < 0 && despues.length >= 3 && despues.length < obs.length) {
      const caso = { obs: despues, bases: despues.map((o) => base(o.d)), tRef, R, reposo: null, piso: false };
      const rebote = minimizar(caso, [...aire.p.slice(0, 4), Math.abs(vy) * 0.5, aire.p[5], tPatada]);
      aire = { p: rebote.p, costo: rebote.costo * (obs.length / despues.length) };
    }
  }

  // La parábola tiene dos parámetros más: tiene que explicar bastante mejor.
  const alturaMax = Math.max(...obs.map((o) => posicion(aire.p, o.t - tRef, R, false).y));
  const datos = obs.length + (reposo ? 1 : 0);
  const usarAire = datos >= 4 && aire.costo < 0.6 * piso.costo && alturaMax > R + 0.04;
  const p = usarAire ? aire.p : piso.p;
  return {
    x0: p[0],
    y0: usarAire ? p[1] : R,
    z0: p[2],
    vx: p[3],
    vy: usarAire ? p[4] : 0,
    vz: p[5],
    enPiso: !usarAire,
    tPatada: p[6],
  };
}

// ---------- Seguimiento ----------

// ¿La pelota se movió entre dos mediciones consecutivas (en la imagen)?
const semovio = (a, b) => Math.hypot(b.px - a.px, b.py - a.py) > 2 || Math.abs(b.pr - a.pr) > Math.max(1, 0.15 * a.pr);

export class ShotTracker {
  constructor({ ballRadius }) {
    this.ballRadius = ballRadius;
    this.reset();
  }

  reset() {
    this.state = "idle"; // idle → flight → done
    this.obs = [];
    this.shot = null;
  }

  // p: {x, y, z, onGround, px, py, pr} (posición en el arco y en la imagen) y,
  // si se conocen, el rayo de la cámara: o (origen), d (dirección) y ang (radio angular).
  // Devuelve un evento {type: 'kick' | 'update' | 'cross' | 'cancel', ...} o null.
  add(t, p) {
    if (this.state === "done") return null;
    const o = { t, ...p };

    if (this.state === "idle") {
      const ultimo = this.obs[this.obs.length - 1];
      if (ultimo && t > ultimo.t) {
        const salto = Math.hypot(o.x - ultimo.x, o.y - ultimo.y, o.z - ultimo.z) / (t - ultimo.t);
        if (salto > SALTO_MAXIMO) {
          this.obs = [o];
          return null;
        }
      }
      this.obs.push(o);
      while (this.obs.length && this.obs[0].t < t - 1) this.obs.shift();
      return this.#buscarRemate(t);
    }

    // En vuelo: descarta mediciones muy lejos de lo esperado (otra cosa que se
    // movió). Si se repite, el que está mal es el modelo y se aceptan.
    const s = this.shot;
    if (s.pred && s.obs.length >= 4 && s.rechazos < 2 && this.#rara(o, s.pred)) {
      s.rechazos++;
      return this.tick(t);
    }
    s.rechazos = 0;
    s.obs.push(o);
    if (s.obs.length > 14) s.obs.shift();
    s.lastSeen = t;
    s.pred = this.#predecir();

    if (!s.pred || s.pred.vz > -0.8) {
      if (s.obs.length >= 5 || t - s.tKick > 0.6) return this.#cancelar();
      return null;
    }
    if (t >= s.pred.tCross) return this.#cruce();
    return { type: "update", t, prediction: s.pred };
  }

  // Avanza el tiempo aunque no haya mediciones (la pelota se puede perder de vista).
  tick(t) {
    if (this.state !== "flight") return null;
    const s = this.shot;
    if (t - s.tKick > VUELO_MAXIMO) return this.#cancelar();
    if (s.pred && t >= s.pred.tCross + 0.03) return this.#cruce();
    if (!s.pred && t - s.lastSeen > 0.5) return this.#cancelar();
    return null;
  }

  // ¿La medición está lejos de donde la trayectoria dice que debería estar?
  #rara(o, pred) {
    const tau = o.t - pred.tRef;
    const p = {
      x: pred.x0 + pred.vx * tau,
      y: pred.rolling ? this.ballRadius : heightAt(pred.y0, pred.vy, tau, this.ballRadius),
      z: pred.z0 + pred.vz * tau,
    };
    if (o.d) {
      // Ángulo entre el rayo medido y la dirección esperada (0,06 rad ≈ 20 px).
      const q = { x: p.x - o.o.x, y: p.y - o.o.y, z: p.z - o.o.z };
      const n = Math.hypot(q.x, q.y, q.z);
      return (q.x * o.d.x + q.y * o.d.y + q.z * o.d.z) / n < Math.cos(0.06);
    }
    return Math.hypot(o.x - p.x, o.z - p.z) > Math.max(1.5, 0.4 * Math.abs(p.z));
  }

  #buscarRemate(t) {
    // Las tres últimas mediciones: con la pelota quieta antes, alcanzan dos
    // cuadros en movimiento para reconocer el remate.
    const recientes = this.obs.filter((o) => o.t >= t - VENTANA_REMATE).slice(-3);
    if (recientes.length < 3) return null;
    const primero = recientes[0];
    const ultimo = recientes[recientes.length - 1];
    const ts = recientes.map((o) => o.t - t);
    const [, vx, ex] = ajusteLineal(ts, recientes.map((o) => o.x));
    const [, vz, ez] = ajusteLineal(ts, recientes.map((o) => o.z));
    const velocidad = Math.hypot(vx, vz);

    // La profundidad medida por tamaño es ruidosa: además exigimos que la
    // pelota se haya movido de verdad en la imagen y siempre hacia el arco.
    const movioEnImagen =
      Math.hypot(ultimo.px - primero.px, ultimo.py - primero.py) > 2.5 ||
      Math.abs(ultimo.pr - primero.pr) / Math.max(primero.pr, 1) > 0.25;
    let retrocesos = 0;
    for (let i = 1; i < recientes.length; i++) if (recientes[i].z > recientes[i - 1].z + 0.05) retrocesos++;
    const remate =
      velocidad > VELOCIDAD_MINIMA &&
      -vz > ACERCAMIENTO_MINIMO &&
      ultimo.z > 0.15 &&
      Math.hypot(ex, ez) < 0.35 &&
      movioEnImagen &&
      retrocesos <= 1;
    if (!remate) return null;

    // Desde qué medición la pelota ya estaba en movimiento, y dónde estaba quieta antes.
    const h = this.obs;
    let m = h.length - 1;
    while (m > 0 && semovio(h[m - 1], h[m])) m--;
    const vuelo = h.slice(m);
    if (vuelo.length < 2) return null;
    let reposo = null;
    if (m > 0) {
      const ancla = h[m - 1];
      const quietas = h.slice(0, m).filter((o) => o.t >= ancla.t - 0.6 && !semovio(o, ancla));
      const prom = (k) => quietas.reduce((a, o) => a + o[k], 0) / quietas.length;
      const enPiso = quietas.filter((o) => o.onGround).length >= quietas.length / 2;
      reposo = {
        x: prom("x"),
        y: enPiso ? this.ballRadius : prom("y"),
        z: prom("z"),
        sigma: (enPiso ? 0.03 : 0.15) / Math.sqrt(Math.min(quietas.length, 4)),
        tMin: ancla.t,
        tMax: h[m].t,
      };
    }

    this.state = "flight";
    this.shot = { tKick: t, obs: vuelo, reposo, lastSeen: t, pred: null, rechazos: 0 };
    this.shot.pred = this.#predecir();
    if (!this.shot.pred) {
      this.reset();
      return null;
    }
    return { type: "kick", t, prediction: this.shot.pred };
  }

  #predecir() {
    const { obs, reposo } = this.shot;
    if (obs.length < 2) return null;
    const R = this.ballRadius;
    const tRef = obs[obs.length - 1].t;

    // Primera aproximación: rectas por cuadrados mínimos (con el punto de la patada).
    const puntos = reposo ? [{ t: (reposo.tMin + reposo.tMax) / 2, x: reposo.x, y: reposo.y, z: reposo.z }, ...obs] : obs;
    const ts = puntos.map((o) => o.t - tRef);
    let [x0, vx] = ajusteLineal(ts, puntos.map((o) => o.x));
    let [z0, vz] = ajusteLineal(ts, puntos.map((o) => o.z));
    let enPiso = obs.filter((o) => o.onGround).length / obs.length >= 0.6;
    let y0 = R;
    let vy = 0;
    if (!enPiso) {
      // y + g/2·τ² = a + b·τ
      [y0, vy] = ajusteLineal(ts, puntos.map((o, i) => o.y + (GRAVEDAD / 2) * ts[i] * ts[i]));
    }

    // Con los rayos de la cámara se ajusta la trayectoria física completa.
    if (obs.length + (reposo ? 1 : 0) >= 3 && obs.every((o) => o.d)) {
      const ajuste = ajustarTrayectoria(obs, tRef, { x0, y0: Math.max(y0, R), z0, vx, vy, vz }, R, reposo);
      ({ x0, y0, z0, vx, vy, vz } = ajuste);
      enPiso = ajuste.enPiso;
    }

    if (vz >= 0) return { tRef, x0, y0, z0, vx, vy, vz, tCross: Infinity, x: x0, y: y0, speed: 0, rolling: enPiso };

    // Puede ser negativo: la última medición ya pasó la línea y el cruce fue antes.
    const tauCruce = -z0 / vz;
    return {
      tRef,
      x0,
      y0,
      z0,
      vx,
      vy,
      vz,
      tCross: tRef + tauCruce,
      x: x0 + vx * tauCruce,
      y: heightAt(y0, vy, tauCruce, R),
      speed: Math.hypot(vx, vy - GRAVEDAD * tauCruce, vz),
      rolling: enPiso,
    };
  }

  #cruce() {
    this.state = "done";
    return { type: "cross", t: this.shot.pred.tCross, tKick: this.shot.tKick, prediction: this.shot.pred };
  }

  #cancelar() {
    this.reset();
    return { type: "cancel" };
  }
}
