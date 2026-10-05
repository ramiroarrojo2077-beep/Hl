// Sigue la pelota en 3D y detecta el remate.
//
// Todo está en coordenadas del arco: x hacia la derecha (mirando el arco desde
// la cancha), y hacia arriba desde el piso, z hacia la cancha. La línea de gol
// es el plano z = 0 y el arco ocupa |x| ≤ ancho/2, 0 ≤ y ≤ alto.

export const GRAVEDAD = 9.81;

// Interruptores para comparar variantes en el banco de pruebas (en la app, vacío).
const EXP = globalThis.process?.env?.EXP ?? "";
const VELOCIDAD_MINIMA = 5; // m/s: más lento es acomodar la pelota, no patear
const ACERCAMIENTO_MINIMO = 3.5; // m/s hacia el arco
const VUELO_MAXIMO = 3; // s

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

// Radio real de una pelota apoyada en el piso, a partir del rayo de la cámara a
// su centro (origen o, dirección d) y su radio angular. Apoyada, su centro está a
// un radio del piso (y = R) y a una distancia R / sen(ang): de ahí sale R. Así
// se calibra el tamaño de la pelota tal como la ve esta cámara (y no depende de
// elegir bien el número de pelota). null si el rayo no baja hacia el piso.
export function radioApoyada(o, d, ang) {
  const s = Math.sin(ang);
  if (!(d.y < -0.05) || !(s > 0) || !(o.y > 0)) return null;
  return o.y / (1 - d.y / s);
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
// Casi nadie patea más fuerte que esto: una trayectoria que lo necesita para
// explicar lo medido (por ejemplo, rodando a 35 m/s cuando en realidad iba por
// el aire, más cerca de la cámara) es poco creíble.
const V_TIPICA = 30; // m/s
// Error relativo del tamaño medido (además de S_TAMANO): borrosa por el
// movimiento, la pelota se ve más chica o más grande de lo que es.
const TAMANO_RELATIVO = Number(EXP.match(/tamRel=([\d.]+)/)?.[1] ?? 0);
const S_V = 3; // m/s

function base(d) {
  // Dos ejes perpendiculares al rayo.
  const a = Math.abs(d.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let e1 = { x: a.y * d.z - a.z * d.y, y: a.z * d.x - a.x * d.z, z: a.x * d.y - a.y * d.x };
  const n1 = Math.hypot(e1.x, e1.y, e1.z);
  e1 = { x: e1.x / n1, y: e1.y / n1, z: e1.z / n1 };
  const e2 = { x: d.y * e1.z - d.z * e1.y, y: d.z * e1.x - d.x * e1.z, z: d.x * e1.y - d.y * e1.x };
  return [e1, e2];
}

// Resistencia del aire de una pelota de fútbol: a = -k·|v|·v, con
// k = ρ·Cd·A / (2·m) ≈ 1,2 · 0,25 · 0,038 / (2 · 0,43) ≈ 0,013 1/m. A 15 m/s la
// frena unos 3 m/s²: en 0,3 s se queda 15 cm atrás de una recta.
export const ARRASTRE = 0.013;

// Distancia recorrida a lo largo de la velocidad en τ segundos (con τ negativo,
// hacia atrás): s(τ) = ln(1 + k·v·τ) / (k·v). Sin arrastre sería v·τ; acá se
// devuelve el factor que multiplica a la velocidad.
function factorArrastre(rapidez, tau) {
  const a = ARRASTRE * rapidez * tau;
  if (ARRASTRE * rapidez < 1e-6 || a <= -0.9) return tau;
  return Math.log1p(a) / (ARRASTRE * rapidez);
}

// Tiempo para recorrer el factor f (inversa de factorArrastre).
function tiempoArrastre(rapidez, f) {
  if (ARRASTRE * rapidez < 1e-6) return f;
  return Math.expm1(ARRASTRE * rapidez * f) / (ARRASTRE * rapidez);
}

// p = [x0, y0, z0, vx, vy, vz, tPatada] en tRef (en piso, y0 = R y vy = 0).
function posicion(p, tau, R, piso) {
  const vy = piso ? 0 : p[4];
  const f = factorArrastre(Math.hypot(p[3], vy, p[5]), tau);
  return {
    x: p[0] + p[3] * f,
    y: piso ? R : p[1] + vy * f - (GRAVEDAD / 2) * tau * tau,
    z: p[2] + p[5] * f,
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
    out[k++] = (Math.asin(Math.min(1, R / dist)) - o.ang) / (TAMANO_RELATIVO ? Math.hypot(S_TAMANO, TAMANO_RELATIVO * o.ang) : S_TAMANO);
  }
  if (reposo) {
    const P = posicion(p, p[6] - tRef, R, piso);
    out[k++] = (P.x - reposo.x) / reposo.sigma;
    out[k++] = (P.y - reposo.y) / reposo.sigma;
    out[k++] = (P.z - reposo.z) / reposo.sigma;
  }
  if (caso.prior) out[k++] = Math.max(0, Math.hypot(p[3], p[4], p[5]) - V_TIPICA) / S_V;
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
  const m = caso.obs.length * 3 + (reposo ? 3 : 0) + (caso.prior ? 1 : 0);
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
// prior: penalizar velocidades poco creíbles (ver V_TIPICA).
export function ajustarTrayectoria(obs, tRef, inicial, R, reposo = null, { prior = false } = {}) {
  prior &&= !EXP.includes("sinPrior");
  const bases = obs.map((o) => base(o.d));
  const tPatada = reposo ? (reposo.tMin + reposo.tMax) / 2 : tRef;
  const p0 = [inicial.x0, inicial.y0, inicial.z0, inicial.vx, inicial.vy, inicial.vz, tPatada];
  const comun = { obs, bases, tRef, R, reposo, prior };
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
      const caso = { obs: despues, bases: despues.map((o) => base(o.d)), tRef, R, reposo: null, piso: false, prior };
      const rebote = minimizar(caso, [...aire.p.slice(0, 4), Math.abs(vy) * 0.5, aire.p[5], tPatada]);
      aire = { p: rebote.p, costo: rebote.costo * (obs.length / despues.length) };
    }
  }

  // La parábola tiene dos parámetros más: tiene que explicar bastante mejor.
  const alturaMax = Math.max(...obs.map((o) => posicion(aire.p, o.t - tRef, R, false).y));
  const datos = obs.length + (reposo ? 1 : 0);
  // Con pocos datos la parábola explica cualquier cosa: se usa sólo si rodando
  // haría falta una velocidad poco creíble (la pelota borrosa se ve más chica,
  // o sea más lejos: en el piso, mucho más adelante de lo que está).
  const rapidezPiso = Math.hypot(piso.p[3], piso.p[5]);
  const increible = prior && !EXP.includes("sinIncreible") && rapidezPiso > V_TIPICA && Math.hypot(aire.p[3], aire.p[4], aire.p[5]) < 0.85 * rapidezPiso;
  const usarAire = alturaMax > R + 0.04 && (datos >= 4 ? aire.costo < 0.6 * piso.costo : increible && aire.costo < piso.costo);
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
    // Qué tan bien explica las mediciones (suma de residuos al cuadrado, en
    // unidades del error de medición) y cuántos datos hubo.
    costo: usarAire ? aire.costo : piso.costo,
    datos,
  };
}

// ---------- Seguimiento ----------
//
// La pelota pasa por tres momentos:
// 1. Sin ubicar: se la ve, pero todavía no quedó quieta en un lugar.
// 2. Lista: quedó quieta (QUIETA_TIEMPO) y ese punto queda como "reposo". Sólo
//    desde acá se puede patear: el remate tiene que arrancar en ese punto, ir
//    rápido hacia el arco y en línea. Cualquier otra cosa que se mueva lejos de
//    la pelota (una pierna, otro objeto claro) se descarta.
// 3. En vuelo: se ajusta la trayectoria. Si la pelota vuelve a verse en el
//    punto de reposo, era una falsa alarma y se cancela. El resultado sólo se
//    da si la trayectoria se confirmó con más mediciones.

const QUIETA_TIEMPO = 0.4; // s quieta para quedar lista
const TOLERANCIA_LATERAL = 0.12; // m (la dirección del rayo se mide muy bien)
const TOLERANCIA_PROFUNDIDAD = 0.12; // m, más un 10 % de la distancia si se mide por tamaño
const VELOCIDAD_MAXIMA = 45; // m/s; más rápido que esto entre dos mediciones no es la pelota
const ALARGADA_MAXIMA = 3; // estela de movimiento de un remate; más que eso no es la pelota
const ALARGADA_QUIETA = 1.6; // quieta, la pelota se ve redonda (una pierna o una media, no)
const MOVIMIENTO_MINIMO = 0.15; // fracción de píxeles que cambiaron (si se sabe)

// Cuánto se apartó `o` del punto `r`, en unidades de la tolerancia (1 = en el borde).
// De costado la medición es muy precisa; en profundidad depende de cómo se midió.
function apartamiento(o, r) {
  const dx = o.x - r.x;
  const dy = o.y - r.y;
  const dz = o.z - r.z;
  if (!o.d) return Math.hypot(dx, dy, dz) / (TOLERANCIA_LATERAL + (o.onGround ? 0 : 0.15));
  const radial = dx * o.d.x + dy * o.d.y + dz * o.d.z;
  const lateral = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - radial * radial));
  const distancia = Math.hypot(o.x - o.o.x, o.y - o.o.y, o.z - o.o.z);
  const tolProf = TOLERANCIA_PROFUNDIDAD + (o.onGround && r.onGround ? 0 : 0.1 * distancia);
  return Math.max(lateral / TOLERANCIA_LATERAL, Math.abs(radial) / tolProf);
}

// ¿Tiene el tamaño de la pelota? Apoyada en el piso, su tamaño en la imagen
// depende sólo de dónde está (escala = radio real que tendría / radio de la
// pelota). En el aire está más cerca que el piso detrás, así que se ve más grande.
function tamanoDePelota(c) {
  if (c.escala == null) return true;
  // Borrosa, el ancho de la estela se ve más angosto (los bordes casi no cambian),
  // pero no tanto: las estelas finitas son de una pierna o un brazo que se mueven.
  if (c.estela) return c.escala < 1.8 && (EXP.includes("sinEstelaMin") || c.escala > 0.5);
  return c.onGround ? c.escala > 0.75 && c.escala < 1.35 : c.escala > 0.75;
}

// ¿La mancha `c` es la pelota que está quieta en `q`? Tiene que estar en el lugar,
// ser redonda y del mismo tamaño en la imagen (un botín apoyado ahí no cuenta).
function ocupa(c, q, tolerancia = 1.5) {
  if ((c.alargada ?? 1) > ALARGADA_QUIETA) return false;
  if (c.pr && q.pr && Math.abs(Math.log(c.pr / q.pr)) > 0.4) return false;
  return apartamiento(c, q) < tolerancia;
}

// ¿`c` puede ser la pelota que estaba quieta en `q` y salió? Tiene que estar a
// una distancia alcanzable y verse de un tamaño parecido (en los primeros
// cuadros se aleja o se acerca poco): el pie o la pierna se ven más grandes.
function puedeSalirDe(t, q, c) {
  const dt = Math.max(t - q.tUlt, 1 / 60);
  if (distancia3(c, q) > VELOCIDAD_MAXIMA * dt + 0.25) return false;
  // Pateada, la pelota va hacia el arco: no puede estar detrás de donde estaba
  // (ahí está el pie que viene a pegarle).
  if (c.z > q.z + 0.05) return false;
  if (!tamanoDePelota(c)) return false;
  if (!c.pr || !q.pr) return true;
  const k = c.pr / q.pr;
  // Alejándose de la cámara se achica según la distancia: a 1,5 m, un remate
  // fuerte la deja a la mitad en dos cuadros; a 8 m casi no cambia. Que se
  // agrande mucho no puede ser (va hacia el arco, no hacia la cámara): el pie o
  // la pierna que se cruzan delante, sí.
  const D = c.o ? distancia3(q, c.o) : 5;
  const minimo = (0.85 * D) / (D + VELOCIDAD_MAXIMA * Math.min(dt, 0.15));
  if (c.estela) return k < 1.6;
  return k >= minimo && k <= 1.35 + 3 * Math.min(dt, 0.1);
}

// Rapidez en el piso de una serie de mediciones (m/s), por mediana de tramos.
function velocidadDe(serie) {
  const v = [];
  for (let i = 1; i < serie.length; i++) {
    const dt = serie[i].t - serie[i - 1].t;
    if (dt > 1e-3) v.push(Math.hypot(serie[i].x - serie[i - 1].x, serie[i].z - serie[i - 1].z) / dt);
  }
  return v.length ? [...v].sort((a, b) => a - b)[v.length >> 1] : 0;
}

// ¿`c` continúa el recorrido que traía la pelota hasta `u`?
function continuaDe(t, u, c) {
  const dt = Math.max(t - u.t, 1 / 60);
  // Un remate se ve cuadro a cuadro: con un hueco tan largo, es otra cosa.
  if (dt > 0.2 && !EXP.includes("sinHueco")) return false;
  if (distancia3(c, u) > VELOCIDAD_MAXIMA * dt + 0.25) return false;
  if (c.estela || u.estela) return true;
  return !(c.pr && u.pr && Math.abs(Math.log(c.pr / u.pr)) > Math.log(1.45) + 1.5 * dt);
}

const mediana = (vs) => {
  const o = [...vs].sort((a, b) => a - b);
  return o[o.length >> 1];
};
const distancia3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export class ShotTracker {
  constructor({ ballRadius, goalWidth = 7.32 }) {
    this.ballRadius = ballRadius;
    this.goalWidth = goalWidth;
    this.reset();
  }

  // Ancho del arco (m): un remate tiene que ir más o menos hacia él.
  setGoalWidth(w) {
    this.goalWidth = w;
  }

  // Radio calibrado de la pelota (ver radioApoyada). Sólo se cambia fuera de un remate.
  setBallRadius(r) {
    if (this.state !== "flight") this.ballRadius = r;
  }

  reset() {
    this.state = "idle"; // idle → flight → done
    // Objetos quietos que pueden ser la pelota. Puede haber más de uno (otra
    // pelota, un cono o un balde claro): se vigilan todos y el remate puede salir
    // de cualquiera; lo que nunca se mueve nunca dispara nada.
    this.quietos = [];
    this.shot = null;
    this.vistoEn = -Infinity;
    this.historial = [];
  }

  // ¿Hay una pelota quieta y lista para patear?
  get ready() {
    return this.state === "idle" && this.quietos.some((q) => q.armado);
  }

  // La pelota lista principal (la que más se parece a la escaneada y se vio hace poco).
  #principal() {
    let mejor = null;
    for (const q of this.quietos) {
      if (!q.armado) continue;
      const valor = q.score * Math.min(q.n, 30) - (this.vistoEn - q.tUlt) * 10;
      if (!mejor || valor > mejor.valor) mejor = { q, valor };
    }
    return mejor?.q ?? null;
  }

  // Dónde está quieta la pelota lista para patear (o null).
  restPosition() {
    const q = this.#principal();
    return q ? { x: q.x, y: q.y, z: q.z } : null;
  }

  // Mira todas las manchas del cuadro y lleva la cuenta de las que están quietas.
  observe(t, candidatas) {
    this.vistoEn = t;
    this.observadoEn = t;
    // Lo visto en los últimos cuadros, para elegir después la secuencia que mejor
    // explica un remate (ver #mejorCadena).
    this.historial.push({ t, cands: candidatas });
    if (this.historial.length > 10) this.historial.shift();
    if (this.state === "flight") {
      // ¿La pelota sigue en su lugar? (lo que se movió era otra cosa: una pierna
      // que la tapaba). Se mira entre todas las manchas, no sólo la que se sigue.
      const s = this.shot;
      if (t - s.tKick < 0.6 && candidatas.some((c) => !c.estela && tamanoDePelota(c) && ocupa(c, s.origen, 1.0))) s.vuelveAVerse++;
      return;
    }
    if (this.state !== "idle") return;
    for (const c of candidatas) {
      if ((c.alargada ?? 1) > ALARGADA_QUIETA) continue;
      if (!c.onGround || !tamanoDePelota(c)) continue; // quieta, está en el piso
      let q = null;
      let menor = 1.2;
      for (const k of this.quietos) {
        const a = apartamiento(c, k);
        if (a < menor && ocupa(c, k, 1.2)) {
          menor = a;
          q = k;
        }
      }
      if (q) {
        // Promedio que se va asentando: cuanto más tiempo quieta, más fija.
        const k = 1 / Math.min(q.n + 1, 12);
        q.x += (c.x - q.x) * k;
        q.y += (c.y - q.y) * k;
        q.z += (c.z - q.z) * k;
        q.score += ((c.score ?? 0.5) - q.score) * k;
        q.n++;
        q.tUlt = t;
        q.px = c.px;
        q.py = c.py;
        q.pr = c.pr;
        q.onGround = c.onGround;
        if (!q.armado && t - q.t0 >= QUIETA_TIEMPO && q.n >= 5) q.armado = true;
      } else if (this.quietos.length < 6) {
        this.quietos.push({ ...posicionDe(c), t0: t, tUlt: t, n: 1, score: c.score ?? 0.5, armado: false, saliendo: [], saltos: 0 });
      }
    }
    // Se olvidan los que no se ven más (los armados aguantan más: el jugador
    // puede tapar la pelota al acercarse).
    this.quietos = this.quietos.filter((q) => t - q.tUlt < (q.armado ? 4 : 0.4) || q.saliendo.length);
  }

  // Elige cuál de las manchas candidatas es la pelota (índice, o -1 si ninguna).
  // Cada candidata: {x, y, z, onGround, px, py, pr, score, moving, alargada, o?, d?}.
  choose(t, candidatas) {
    if (!candidatas.length || this.state === "done") return -1;
    const validas = candidatas.map((c, i) => ({ c, i })).filter(({ c }) => (c.alargada ?? 1) <= (c.estela ? 12 : ALARGADA_MAXIMA));
    if (!validas.length) return -1;

    if (this.state === "flight") {
      // La más cerca de donde la trayectoria dice que tiene que estar.
      // La más cerca de donde la trayectoria dice que tiene que estar, del tamaño
      // que tiene que tener a esa distancia y redonda (el pie que sigue a la pelota
      // en el remate pasa cerca, pero es más grande o más chico y alargado).
      // Con el rayo de la cámara se compara el ángulo (0,08 rad ≈ 25 px); sin él, metros.
      // Al principio del vuelo la trayectoria todavía es poco confiable: también
      // vale la continuidad del movimiento en la imagen (cuadro a cuadro la pelota
      // se corre parejo).
      const e = this.expectedPosition(t);
      const vuelo = this.shot.obs;
      const confiable = vuelo.length >= 4;
      let enImagen = null;
      if (vuelo.length >= 2) {
        const [a, b] = vuelo.slice(-2);
        const k = (t - b.t) / Math.max(b.t - a.t, 1e-3);
        enImagen = { x: b.px + (b.px - a.px) * k, y: b.py + (b.py - a.py) * k, r: b.pr };
      }
      let mejor = -1;
      let menor = Infinity;
      for (const { c, i } of validas) {
        let cerca = c.d ? anguloA(c, e) / (confiable ? 0.08 : 0.12) : distancia3(c, e) / 0.6;
        if (enImagen) cerca = Math.min(cerca, Math.hypot(c.px - enImagen.x, c.py - enImagen.y) / Math.max(15, 2.5 * enImagen.r));
        if (cerca >= 1) continue;
        let tamano = 0;
        if (confiable && c.d && c.ang && !c.estela) {
          const esperado = Math.asin(Math.min(1, this.ballRadius / Math.max(distancia3(e, c.o), this.ballRadius * 1.01)));
          tamano = Math.abs(Math.log(c.ang / esperado));
          if (tamano > Math.log(1.8)) continue;
        }
        // La medida buscando donde dice la trayectoria (ver seguimiento.js) es la
        // más confiable si está cerca.
        const costo = cerca + tamano / 0.4 + ((c.alargada ?? 1) - 1) * (c.estela ? 0.04 : 0.3);
        if (costo < menor) {
          menor = costo;
          mejor = i;
        }
      }
      return mejor;
    }

    const armados = this.quietos.filter((q) => q.armado);
    if (armados.length) {
      // Si una pelota ya venía saliendo de su lugar, se sigue con la que continúa.
      const enCurso = armados.find((q) => q.saliendo.length);
      if (enCurso) {
        const i = this.#queSale(t, enCurso, validas);
        if (i >= 0) return i;
      }
      // ¿Sigue alguna en su lugar? Se queda con la principal.
      const principal = this.#principal();
      let quieta = null;
      for (const v of validas) {
        for (const q of armados) {
          if (!ocupa(v.c, q)) continue;
          const a = apartamiento(v.c, q) + (q === principal ? 0 : 0.5);
          if (!quieta || a < quieta.a) quieta = { ...v, a };
        }
      }
      // ¿O alguna salió de su lugar? (Ya no hay una pelota donde estaba.)
      for (const q of armados) {
        const sigue = validas.some(({ c }) => ocupa(c, q));
        if (sigue) continue;
        const i = this.#queSale(t, q, validas);
        if (i >= 0) return i;
      }
      return quieta ? quieta.i : -1;
    }

    // Todavía ninguna lista: la de mejor puntaje, priorizando la que ya se venía
    // viendo quieta y la que tiene el tamaño de la pelota.
    const delTamano = validas.filter(({ c }) => tamanoDePelota(c));
    const conocida = delTamano.filter(({ c }) => this.quietos.some((q) => apartamiento(c, q) < 1.2));
    const grupo = conocida.length ? conocida : delTamano.length ? delTamano : validas;
    return grupo.sort((a, b) => b.c.score - a.c.score)[0].i;
  }

  // Entre las candidatas, la que puede haber salido del lugar de `q` (o seguir
  // su recorrido), con más puntaje y movimiento. -1 si ninguna.
  // Tiene que tener el tamaño que traía la pelota en la imagen: cuadro a cuadro
  // cambia poco (se aleja o se acerca de a medio metro). El pie que la sigue en
  // el remate pasa por el mismo lugar, pero se ve alargado y de otro ancho (con
  // estela de movimiento el ancho de la pelota sigue siendo su diámetro).
  #queSale(t, q, validas) {
    const ultima = q.saliendo[q.saliendo.length - 1];
    let mejor = null;
    for (const v of validas) {
      if (apartamiento(v.c, q) < 1.5) continue;
      if (!puedeSalirDe(t, q, v.c)) continue;
      // Se prefiere la que continúa lo que venía saliendo, pero si eso empezó
      // con otra cosa (el pie que tapaba la pelota) la pelota igual entra.
      const continua = !ultima || continuaDe(t, ultima, v.c);
      const parecido = v.c.pr && q.pr ? 1 - 0.5 * Math.min(1, Math.abs(Math.log(v.c.pr / q.pr)) / Math.log(1.5)) : 1;
      // En el golpe la pelota sale más rápido que el pie (que viene detrás y frena):
      // entre lo que sale del lugar, la que más avanzó hacia el arco es la pelota.
      const avance = EXP.includes("sinAvance") ? 1 : 1 + 1.5 * Math.min(2, Math.max(0, q.z - v.c.z));
      const puntaje =
        (v.c.score * (0.5 + (v.c.moving ?? 0)) * parecido * avance * (continua ? 1 : 0.6)) /
        (1 + (v.c.estela ? 0.05 : 0.3) * ((v.c.alargada ?? 1) - 1));
      if (!mejor || puntaje > mejor.puntaje) mejor = { ...v, puntaje };
    }
    return mejor ? mejor.i : -1;
  }

  // p: {x, y, z, onGround, px, py, pr} (posición en el arco y en la imagen) y,
  // si se conocen, el rayo de la cámara: o (origen), d (dirección) y ang (radio
  // angular); moving: fracción de píxeles que cambiaron (null si no se sabe).
  // Devuelve un evento {type: 'kick' | 'update' | 'cross' | 'cancel', ...} o null.
  add(t, p) {
    if (this.state === "done") return null;
    const o = { t, ...p };
    if (this.state === "flight") return this.#enVuelo(t, o);
    // Si no se llamó a observe en este cuadro, la medición elegida cuenta como la única.
    if (this.observadoEn !== t) this.observe(t, [p]);

    const armados = this.quietos.filter((q) => q.armado);
    if (!armados.length) return null;
    // Sigue (o volvió) a su lugar: si algo venía "saliendo", era otra cosa.
    const enLugar = armados.find((q) => ocupa(o, q));
    if (enLugar) {
      enLugar.saliendo = [];
      enLugar.saltos = 0;
      return null;
    }
    // ¿De cuál salió? Primero la que ya venía saliendo.
    const ordenados = [...armados].sort((a, b) => b.saliendo.length - a.saliendo.length);
    for (const q of ordenados) {
      if (!puedeSalirDe(t, q, o)) continue;
      // Si lo que venía "saliendo" no lleva a esto, era otra cosa: empieza de nuevo.
      const ultima = q.saliendo[q.saliendo.length - 1];
      if (ultima && !continuaDe(t, ultima, o)) q.saliendo = [];
      q.saliendo.push(o);
      if (q.saliendo.length >= 2 && this.#esRemate(t, q)) return this.#arrancarVuelo(t, q);
      if (t - q.saliendo[0].t > 0.3 || q.saliendo.length > 5) {
        // Se fue despacio (la están acomodando): deja de estar lista. Si se fue
        // rápido pero las mediciones no cierran, se sigue probando con las últimas.
        // Acomodándola se la ve redonda y nítida; si lo que "salió" son sólo
        // estelas, es una pierna que pasa delante (la pelota sigue tapada ahí).
        const nitidas = q.saliendo.filter((s) => !s.estela).length;
        if (velocidadDe(q.saliendo) < VELOCIDAD_MINIMA && (nitidas >= 2 || EXP.includes("sinNitidas"))) {
          this.quietos = this.quietos.filter((k) => k !== q);
          return null;
        }
        q.saliendo = q.saliendo.slice(-3);
      }
      return null;
    }
    // Apareció lejos de todo de golpe: no es la pelota.
    return null;
  }

  // Avanza el tiempo aunque no haya mediciones (la pelota se puede perder de vista).
  tick(t) {
    if (this.state !== "flight") return null;
    const s = this.shot;
    if (s.vuelveAVerse >= 2) return this.#cancelar(true, { t });
    if (t - s.tKick > VUELO_MAXIMO) return this.#cancelar(false);
    if (s.pred && t >= s.pred.tCross + 0.03) {
      // Sin confirmar (la pelota no se volvió a ver) no se da resultado.
      return s.confirmadas >= 1 ? this.#cruce() : this.#cancelar(false);
    }
    if (!s.pred && t - s.lastSeen > 0.5) return this.#cancelar(false);
    return null;
  }

  // Dónde debería estar la pelota en el instante t según la trayectoria (o null).
  expectedPosition(t) {
    const pred = this.state === "flight" ? this.shot?.pred : null;
    if (!pred) return null;
    const p = posicion([pred.x0, pred.y0, pred.z0, pred.vx, pred.vy, pred.vz], t - pred.tRef, this.ballRadius, pred.rolling);
    if (!pred.rolling && p.y < this.ballRadius) p.y = heightAt(pred.y0, pred.vy, t - pred.tRef, this.ballRadius);
    return p;
  }

  // ¿Lo que sale del lugar de `q` es un remate de verdad?
  // Con 3 o más mediciones se tolera una mala (a toda velocidad la pelota sale
  // borrosa y en un cuadro puede parecer más grande, o sea más cerca y en el aire).
  #esRemate(t, q) {
    if (this.#remateCon(t, q, q.saliendo)) return true;
    if (q.saliendo.length < 3) return false;
    for (let k = 0; k < q.saliendo.length; k++) {
      const sin = q.saliendo.filter((_, i) => i !== k);
      if (this.#remateCon(t, q, sin)) {
        q.saliendo = sin;
        return true;
      }
    }
    return false;
  }

  // Con 2 mediciones y el punto de reposo, la física ajusta casi cualquier cosa:
  // hace falta además la prueba lineal; con 3 o más, alcanza con la física.
  #remateCon(t, q, saliendo) {
    const lineal = this.#remateLineal(t, q, saliendo);
    if (saliendo.length < 3) return lineal && (EXP.includes("sinFisico") || !saliendo.every((o) => o.d) || this.#remateFisico(t, q, saliendo));
    return lineal || this.#remateFisico(t, q, saliendo);
  }

  // Con los rayos de la cámara: la trayectoria física que sale del punto de
  // reposo tiene que explicar las mediciones (la dirección se mide muy bien; la
  // distancia por tamaño de una pelota borrosa, no) y ser un remate: rápido,
  // hacia el arco.
  #remateFisico(t, q, saliendo) {
    if (EXP.includes("sinFisico") || saliendo.length < 2 || !saliendo.every((o) => o.d)) return false;
    const pred = this.#predecir(saliendo, this.#reposoDe(q, saliendo), false);
    if (!pred || pred.calidad == null || pred.calidad > 30) return false;
    if (!(pred.vz < -ACERCAMIENTO_MINIMO) || Math.hypot(pred.vx, pred.vy, pred.vz) < VELOCIDAD_MINIMA) return false;
    if (Number.isFinite(pred.tCross) && Math.abs(pred.x) > this.goalWidth / 2 + 4) return false;
    if (!this.#seAleja(q, saliendo)) return false;
    return true;
  }

  // En la imagen se tiene que ir alejando del lugar donde estaba, cuadro a
  // cuadro, y (si se sabe) estar entre los píxeles que cambiaron.
  #seAleja(q, saliendo) {
    let antes = 0;
    for (const m of saliendo) {
      const d = Math.hypot(m.px - q.px, m.py - q.py) + Math.abs(m.pr - q.pr);
      if (d < antes - 1) return false;
      antes = d;
    }
    if (antes < 2.5) return false;
    const conMovimiento = saliendo.filter((m) => m.moving != null);
    return !(conMovimiento.length && conMovimiento.reduce((a, m) => a + m.moving, 0) / conMovimiento.length < MOVIMIENTO_MINIMO);
  }

  #remateLineal(t, q, saliendo) {
    const pts = [{ ...q, t: (q.tUlt + saliendo[0].t) / 2 }, ...saliendo];
    const ts = pts.map((m) => m.t - t);
    const [, vx, ex] = ajusteLineal(ts, pts.map((m) => m.x));
    const [, vz, ez] = ajusteLineal(ts, pts.map((m) => m.z));
    const porTamano = saliendo.some((m) => !m.onGround);
    // En línea: con la distancia medida por tamaño se tolera más ruido.
    if (Math.hypot(ex, ez) > (porTamano ? 0.45 : 0.25)) return false;
    if (Math.hypot(vx, vz) < VELOCIDAD_MINIMA || -vz < ACERCAMIENTO_MINIMO) return false;
    // Hacia el arco (con margen: también cuentan los que se van afuera).
    const ultimo = saliendo[saliendo.length - 1];
    const xCruce = ultimo.x + vx * (ultimo.z / -vz);
    if (Math.abs(xCruce) > this.goalWidth / 2 + 4) return false;
    if (saliendo[saliendo.length - 1].z < 0.15) return false;
    // En la imagen se tiene que ir alejando del lugar donde estaba, cuadro a cuadro.
    let antes = 0;
    for (const m of saliendo) {
      const d = Math.hypot(m.px - q.px, m.py - q.py) + Math.abs(m.pr - q.pr);
      if (d < antes - 1) return false;
      antes = d;
    }
    if (antes < 2.5) return false;
    // Si se sabe qué píxeles cambiaron, la pelota tiene que estar entre ellos.
    const conMovimiento = saliendo.filter((m) => m.moving != null);
    if (conMovimiento.length && conMovimiento.reduce((a, m) => a + m.moving, 0) / conMovimiento.length < MOVIMIENTO_MINIMO) {
      return false;
    }
    return true;
  }

  // Entre todo lo que se vio desde que la pelota dejó de estar quieta, la
  // secuencia que mejor explica un remate: sale del punto de reposo en línea
  // recta, hacia el arco, a velocidad de pelota (el pie que sale junto con ella
  // va más lento y frena). Se prueba cada candidata de los dos últimos cuadros
  // como punta y se cuenta en cuántos cuadros anteriores hay algo donde esa
  // recta dice. Devuelve la lista de mediciones o null.
  #mejorCadena(t, q) {
    return this.#cadenas(t, q)[0] ?? null;
  }

  // Las secuencias candidatas (las mejores primero, sin repetir la punta).
  #cadenas(t, q) {
    const cuadros = this.historial.filter((h) => h.t > q.tUlt && h.t <= t);
    if (cuadros.length < 2) return [];
    const t0 = (q.tUlt + cuadros[0].t) / 2;
    const R = this.ballRadius;
    const todas = [];
    for (const fin of cuadros.slice(-2)) {
      for (const c of fin.cands) {
        if (!tamanoDePelota(c) || (c.alargada ?? 1) > (c.estela ? 12 : ALARGADA_MAXIMA)) continue;
        const dt = fin.t - t0;
        if (dt <= 0) continue;
        const vx = (c.x - q.x) / dt;
        const vz = (c.z - q.z) / dt;
        // Altura: tiro por el aire (con gravedad) o rasante.
        const vy = (c.y - (q.onGround ? R : q.y) + (GRAVEDAD / 2) * dt * dt) / dt;
        const rapidez = Math.hypot(vx, vy, vz);
        if (rapidez < VELOCIDAD_MINIMA || rapidez > VELOCIDAD_MAXIMA || -vz < ACERCAMIENTO_MINIMO) continue;
        if (Math.abs(c.x + vx * (c.z / -vz)) > this.goalWidth / 2 + 4) continue;
        const cadena = [];
        let error = 0;
        for (const h of cuadros) {
          if (h === fin) {
            cadena.push({ ...c, t: h.t });
            continue;
          }
          if (h.t > fin.t) continue;
          const tau = h.t - t0;
          const px = q.x + vx * tau;
          const pz = q.z + vz * tau;
          const py = Math.max(R, (q.onGround ? R : q.y) + vy * tau - (GRAVEDAD / 2) * tau * tau);
          let cerca = null;
          for (const k of h.cands) {
            // Con la distancia medida por tamaño se tolera más error en profundidad.
            const tol = 0.2 + (k.onGround ? 0 : 0.12 * Math.hypot(k.x - (k.o?.x ?? k.x), k.z - (k.o?.z ?? k.z)));
            const e = Math.hypot(k.x - px, k.z - pz, k.onGround ? 0 : k.y - py) / tol;
            if (e < 1 && (!cerca || e < cerca.e)) cerca = { k, e };
          }
          if (cerca) {
            cadena.push({ ...cerca.k, t: h.t });
            error += cerca.e;
          }
        }
        if (cadena.length < 2) continue;
        // Más cuadros que la confirman; a igualdad, la más rápida (la pelota, no el pie).
        const valor = cadena.length - 0.3 * (error / cadena.length) + rapidez / 100;
        todas.push({ valor, cadena: cadena.sort((a, b) => a.t - b.t), rapidez });
      }
    }
    todas.sort((a, b) => b.valor - a.valor);
    const distintas = [];
    for (const c of todas) {
      const fin = c.cadena.at(-1);
      if (distintas.some((d) => d.cadena.at(-1) === fin || (d.cadena.at(-1).px === fin.px && d.cadena.at(-1).py === fin.py))) continue;
      distintas.push(c);
      if (distintas.length >= 4) break;
    }
    return distintas;
  }

  // Entre la secuencia que se viene siguiendo y las alternativas, la que mejor
  // cumple la física de una pelota (ajuste de la trayectoria completa a los
  // rayos de la cámara: el pie que sale junto con la pelota sube y frena, y no
  // ajusta). Devuelve las mediciones de la elegida.
  #mejorHipotesis(t, q, actual) {
    const opciones = [actual, ...this.#cadenas(t, q).map((c) => c.cadena)];
    let mejor = null;
    for (const obs of opciones) {
      if (obs.length < 2 || !obs.every((o) => o.d)) continue;
      const reposo = this.#reposoDe(q, obs);
      const pred = this.#predecir(obs, reposo, false);
      if (!pred || pred.calidad == null || !(pred.vz < 0)) continue;
      // Más mediciones explicadas es mejor; con pocas, cualquier cosa ajusta.
      const valor = this.#valorHipotesis(pred, obs);
      if (!mejor || valor < mejor.valor) mejor = { obs, valor, actual: obs === actual };
    }
    if (!mejor) return actual;
    if (mejor.actual) return actual;
    // Para cambiar, la otra tiene que ser claramente mejor.
    const actualPred = actual.length >= 2 && actual.every((o) => o.d) ? this.#predecir(actual, this.#reposoDe(q, actual), false) : null;
    const valorActual = actualPred?.calidad != null && actualPred.vz < 0 ? this.#valorHipotesis(actualPred, actual) : Infinity;
    return mejor.valor < 0.6 * valorActual ? mejor.obs : actual;
  }

  // Qué tan creíble es una secuencia como el remate (menos es mejor). Además del
  // ajuste: la pelota se ve salir de su lugar. Si para explicarla hay que suponer
  // que salió mucho antes de la primera medición (y nadie la vio en el camino),
  // es otra cosa que se movía lejos: una pierna, alguien que pasa.
  #valorHipotesis(pred, obs) {
    const hueco = pred.tPatada != null && !EXP.includes("sinPenaHueco") ? Math.max(0, obs[0].t - pred.tPatada - 0.12) : 0;
    return pred.calidad + 4 / obs.length + 20 * hueco;
  }

  #reposoDe(q, obs) {
    return {
      x: q.x,
      y: q.onGround ? this.ballRadius : q.y,
      z: q.z,
      onGround: q.onGround,
      sigma: q.onGround ? 0.02 : 0.08,
      tMin: q.tUlt,
      tMax: obs[0].t,
    };
  }

  #arrancarVuelo(t, q) {
    // ¿Hay una secuencia que explique mejor el remate que la que se venía siguiendo?
    let obs = q.saliendo.slice();
    if (!EXP.includes("sinCadena")) obs = this.#mejorHipotesis(t, q, obs);
    this.state = "flight";
    this.shot = {
      tKick: t,
      obs,
      origen: q,
      reposo: this.#reposoDe(q, obs),
      lastSeen: t,
      pred: null,
      rechazos: 0,
      confirmadas: 0,
      vuelveAVerse: 0,
    };
    q.saliendo = [];
    // Si hubo remate se decide sin suponer nada de la velocidad (ver #predecir).
    const sinPrior = this.#predecir(this.shot.obs, this.shot.reposo, false);
    if (!sinPrior || !(sinPrior.vz < 0)) {
      this.state = "idle";
      this.shot = null;
      return null;
    }
    const pred = this.#predecir();
    this.shot.pred = pred && pred.vz < 0 ? pred : sinPrior;
    return { type: "kick", t, prediction: this.shot.pred, n: this.shot.obs.length };
  }

  #enVuelo(t, o) {
    const s = this.shot;
    // Ya llega al arco: queda lo previsto con lo medido hasta acá (lo que se vea
    // después, detrás de la línea o un palo, no tiene que cambiar el resultado).
    if (s.pred && s.confirmadas >= 1 && t >= s.pred.tCross - 0.02) return this.#cruce();
    // La pelota sigue en el punto de reposo: no la patearon (se movió otra cosa).
    if (t - s.tKick < 0.6 && ocupa(o, s.origen, 1.2)) return this.#cancelar(true, o);

    // Descarta mediciones muy lejos de lo esperado. Si se repite, el que está mal
    // es el modelo y se aceptan.
    if (s.pred && s.obs.length >= 3 && s.rechazos < 2 && this.#rara(o, s.pred)) {
      s.rechazos++;
      return this.tick(t);
    }
    s.rechazos = 0;
    s.obs.push(o);
    // Al principio del vuelo: ¿hay otra secuencia que explique mejor el remate
    // (sale del punto de reposo, en línea, más rápido)? El pie que salió junto
    // con la pelota frena; la pelota sigue. Si es así, se cambia a esa.
    if (!EXP.includes("sinHipotesis") && t - s.tKick < 0.35 && s.reposo && s.origen) {
      const elegida = this.#mejorHipotesis(t, s.origen, s.obs);
      if (elegida !== s.obs) {
        s.obs = elegida;
        s.reposo = this.#reposoDe(s.origen, elegida);
      }
    }
    if (s.obs.length > 14) {
      s.obs.shift();
      // Con muchas mediciones manda lo último: el punto de la patada ya quedó
      // lejos (y una pelota que rueda se va frenando por el roce del piso).
      s.reposo = null;
    }
    s.lastSeen = t;
    s.confirmadas++;
    const anterior = s.pred;
    s.pred = this.#predecir();

    if (!s.pred || s.pred.vz > -0.8) {
      // Un remate que se viene siguiendo bien no se descarta por un ajuste malo.
      if (anterior && anterior.vz <= -0.8 && s.confirmadas >= 4) {
        s.pred = anterior;
        return t >= anterior.tCross ? this.#cruce() : null;
      }
      if (s.obs.length >= 5 || t - s.tKick > 0.6) return this.#cancelar(false);
      return null;
    }
    if (t >= s.pred.tCross) return this.#cruce();
    return { type: "update", t, prediction: s.pred };
  }

  // ¿La medición está lejos de donde la trayectoria dice que debería estar?
  #rara(o, pred) {
    const tau = o.t - pred.tRef;
    const p = posicion([pred.x0, pred.y0, pred.z0, pred.vx, pred.vy, pred.vz], tau, this.ballRadius, pred.rolling);
    if (!pred.rolling && p.y < this.ballRadius) p.y = heightAt(pred.y0, pred.vy, tau, this.ballRadius);
    // 0,06 rad ≈ 20 px; con muchas mediciones la trayectoria ya es firme: 0,035.
    if (o.d) return anguloA(o, p) > (this.shot.obs.length >= 6 ? 0.035 : 0.06);
    return Math.hypot(o.x - p.x, o.z - p.z) > Math.max(1.5, 0.4 * Math.abs(p.z));
  }



  // prior: sólo para la trayectoria de un remate ya detectado. Para decidir si
  // hubo remate (y cuál secuencia es) no: ahí haría pasar por buena una
  // secuencia que no es la pelota.
  #predecir(obs = this.shot.obs, reposo = this.shot.reposo, prior = true) {
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
    let calidad = null;
    let tPatada = null;
    if (obs.length + (reposo ? 1 : 0) >= 3 && obs.every((o) => o.d)) {
      const ajuste = ajustarTrayectoria(obs, tRef, { x0, y0: Math.max(y0, R), z0, vx, vy, vz }, R, reposo, { prior });
      ({ x0, y0, z0, vx, vy, vz } = ajuste);
      enPiso = ajuste.enPiso;
      calidad = ajuste.costo / (3 * ajuste.datos);
      if (reposo) tPatada = ajuste.tPatada;
    }

    if (vz >= 0) return { tRef, x0, y0, z0, vx, vy, vz, tCross: Infinity, x: x0, y: y0, speed: 0, rolling: enPiso, calidad, tPatada };

    // Con arrastre: primero cuánto avanza a lo largo de la velocidad hasta la
    // línea, después cuánto tiempo le lleva.
    const rapidez = Math.hypot(vx, vy, vz);
    const f = -z0 / vz;
    const tauCruce = tiempoArrastre(rapidez, f);
    let y = enPiso ? R : y0 + vy * f - (GRAVEDAD / 2) * tauCruce * tauCruce;
    if (!enPiso && y < R) y = heightAt(y0, vy, tauCruce, R); // picó antes de llegar
    return {
      tRef,
      x0,
      y0,
      z0,
      vx,
      vy,
      vz,
      tCross: tRef + tauCruce,
      x: x0 + vx * f,
      y,
      speed: rapidez / (1 + ARRASTRE * rapidez * tauCruce),
      // Velocidad con la que salió del pie (hacia atrás desde tRef, con el arrastre).
      kickSpeed: reposo ? rapidez / Math.max(0.5, 1 - ARRASTRE * rapidez * Math.max(0, tRef - reposo.tMax)) : rapidez,
      rolling: enPiso,
      calidad,
      tPatada,
    };
  }

  #cruce() {
    this.state = "done";
    return { type: "cross", t: this.shot.pred.tCross, tKick: this.shot.tKick, prediction: this.shot.pred };
  }

  // seguiaQuieta: la pelota se vio otra vez en su lugar, así que sigue lista.
  #cancelar(seguiaQuieta, o = null) {
    const origen = this.shot?.origen;
    this.state = "idle";
    this.shot = null;
    if (!seguiaQuieta && origen) this.quietos = this.quietos.filter((q) => q !== origen);
    if (seguiaQuieta && origen && o) origen.tUlt = o.t;
    return { type: "cancel", falsaAlarma: seguiaQuieta };
  }
}

const posicionDe = (c) => ({ x: c.x, y: c.y, z: c.z, onGround: c.onGround, px: c.px, py: c.py, pr: c.pr });

// Ángulo entre el rayo medido de `o` y la dirección desde su cámara hasta `p`.
function anguloA(o, p) {
  const q = { x: p.x - o.o.x, y: p.y - o.o.y, z: p.z - o.o.z };
  const n = Math.hypot(q.x, q.y, q.z) || 1;
  return Math.acos(Math.min(1, (q.x * o.d.x + q.y * o.d.y + q.z * o.d.z) / n));
}
