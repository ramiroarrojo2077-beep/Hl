// Física de la pelota real para el simulador (no la usa la app).
//
// Coordenadas del arco: x a la derecha, y arriba (piso real en y = 0), z hacia la
// cancha; la línea de gol es z = 0. Incluye cosas que el modelo de la app NO
// supone, para ver cuánto le afectan: efecto (Magnus) con distintos giros,
// arrastre distinto al que usa la app, piques con pérdida y rodado con roce.

const G = 9.81;
const suave = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// Generador de números al azar con semilla (mulberry32).
export function azar(semilla) {
  let a = semilla >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.entre = (a0, b0) => a0 + (b0 - a0) * f();
  f.normal = () => {
    const u = Math.max(f(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * f());
  };
  f.elegir = (lista) => lista[Math.floor(f() * lista.length)];
  return f;
}

const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norma = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => {
  const n = norma(a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

// Integra el vuelo con paso de 1 ms. Devuelve una trayectoria muestreada.
// opciones: p0, v0, R, k (arrastre), efecto: {eje (unitario), c} con
//   a = c·|v|·(eje × v) (≈ 0,01 es un tiro con mucho efecto), giro: rad/s visual.
export function volar({ p0, v0, R, k = 0.013, efecto = null, giro = 0, ejeGiro = [1, 0, 0], tMax = 3, rodado = 0.8 }) {
  const dt = 0.001;
  const n = Math.round(tMax / dt) + 1;
  const pos = new Float64Array(n * 3);
  const vel = new Float64Array(n * 3);
  const ang = new Float64Array(n); // ángulo de giro acumulado (para la textura)
  const ejes = new Float64Array(n * 3);
  let p = [...p0];
  let v = [...v0];
  let a = 0;
  let eje = unit(ejeGiro);
  let w = giro;
  for (let i = 0; i < n; i++) {
    pos.set(p, i * 3);
    vel.set(v, i * 3);
    ang[i] = a;
    ejes.set(eje, i * 3);
    const rapidez = norma(v);
    const acc = [0, -G, 0];
    // Arrastre cuadrático.
    acc[0] -= k * rapidez * v[0];
    acc[1] -= k * rapidez * v[1];
    acc[2] -= k * rapidez * v[2];
    const enPiso = p[1] <= R + 1e-6 && Math.abs(v[1]) < 0.3;
    if (efecto && !enPiso) {
      const m = cruz(efecto.eje, v);
      acc[0] += efecto.c * rapidez * m[0];
      acc[1] += efecto.c * rapidez * m[1];
      acc[2] += efecto.c * rapidez * m[2];
    }
    if (enPiso) {
      // Rodando: sin gravedad neta, roce que la frena.
      acc[1] = 0;
      v[1] = 0;
      p[1] = R;
      const h = Math.hypot(v[0], v[2]);
      if (h > 1e-6) {
        const frena = Math.min(rodado, h / dt);
        acc[0] -= (frena * v[0]) / h;
        acc[2] -= (frena * v[2]) / h;
      }
      // Rueda sin deslizar: gira alrededor del eje horizontal perpendicular.
      if (h > 0.05) {
        eje = unit([v[2], 0, -v[0]]);
        w = h / R;
      }
    }
    v = [v[0] + acc[0] * dt, v[1] + acc[1] * dt, v[2] + acc[2] * dt];
    p = [p[0] + v[0] * dt, p[1] + v[1] * dt, p[2] + v[2] * dt];
    a += w * dt;
    if (p[1] < R) {
      // Pique.
      p[1] = R;
      if (v[1] < -0.3) {
        v = [v[0] * 0.85, -v[1] * 0.55, v[2] * 0.85];
        w *= 0.7;
      } else {
        v[1] = 0;
      }
    }
  }
  const muestra = (t, arr) => {
    const x = Math.min(Math.max(t / dt, 0), n - 1.001);
    const i = Math.floor(x);
    const f = x - i;
    return [0, 1, 2].map((c) => arr[i * 3 + c] * (1 - f) + arr[(i + 1) * 3 + c] * f);
  };
  return {
    R,
    dt,
    n,
    posicion: (t) => muestra(t, pos),
    velocidad: (t) => muestra(t, vel),
    giro: (t) => {
      const x = Math.min(Math.max(t / dt, 0), n - 1.001);
      const i = Math.floor(x);
      return { eje: [ejes[i * 3], ejes[i * 3 + 1], ejes[i * 3 + 2]], angulo: ang[i] + (ang[i + 1] - ang[i]) * (x - i) };
    },
    // Instante y punto donde el centro cruza z = zPlano (null si no llega).
    cruce(zPlano = 0) {
      for (let i = 1; i < n; i++) {
        const z0 = pos[(i - 1) * 3 + 2];
        const z1 = pos[i * 3 + 2];
        if (z0 > zPlano && z1 <= zPlano) {
          const f = (z0 - zPlano) / (z0 - z1);
          const t = (i - 1 + f) * dt;
          const p = muestra(t, pos);
          return { t, x: p[0], y: p[1] };
        }
      }
      return null;
    },
  };
}

// Velocidad inicial para que la pelota (sin efecto) pase por `objetivo` en z = 0
// saliendo de p0 a `rapidez` m/s. Por el piso si `rasante`.
export function apuntar({ p0, objetivo, rapidez, R, k, rasante }) {
  const dx = objetivo[0] - p0[0];
  const dz = objetivo[2] - p0[2];
  let az = Math.atan2(dx, -dz);
  let el = rasante ? 0 : Math.atan2(objetivo[1] - p0[1], Math.hypot(dx, dz)) + 0.05;
  const vel = (a, e) => [rapidez * Math.cos(e) * Math.sin(a), rapidez * Math.sin(e), -rapidez * Math.cos(e) * Math.cos(a)];
  const prueba = (a, e) => {
    const tr = volar({ p0, v0: vel(a, e), R, k, tMax: 2.5 });
    return tr.cruce(0);
  };
  for (let it = 0; it < 12; it++) {
    const c = prueba(az, el);
    if (!c) {
      el += 0.05;
      continue;
    }
    const ex = c.x - objetivo[0];
    const ey = c.y - objetivo[1];
    if (Math.abs(ex) < 0.003 && (rasante || Math.abs(ey) < 0.003)) break;
    // Jacobiano numérico.
    const h = 0.002;
    const ca = prueba(az + h, el);
    const ce = rasante ? null : prueba(az, el + h);
    if (!ca || (!rasante && !ce)) break;
    const jxa = (ca.x - c.x) / h;
    if (rasante) {
      az -= ex / jxa;
      continue;
    }
    const jya = (ca.y - c.y) / h;
    const jxe = (ce.x - c.x) / h;
    const jye = (ce.y - c.y) / h;
    const det = jxa * jye - jxe * jya;
    if (Math.abs(det) < 1e-9) break;
    az -= (jye * ex - jxe * ey) / det;
    el -= (-jya * ex + jxa * ey) / det;
    // Tiro, no globo: la solución baja.
    el = Math.max(-0.2, Math.min(0.45, el));
  }
  return vel(az, el);
}

// Las piernas del que patea, como cápsulas {a, b, r, color} en el instante t.
// Patea en tPatada desde atrás de la pelota (en p0) en la dirección `dir`.
// Pierna de apoyo al costado; el pie que patea hace el swing, golpea y sigue.
export function piernas({ p0, dir, tPatada, R, lado = 1, kit, rapidez }) {
  const d = unit([dir[0], 0, dir[2]]);
  const lat = [-d[2] * lado, 0, d[0] * lado]; // hacia el lado de la pierna de apoyo
  const suma = (...vs) => vs.reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0]);
  const por = (v, k) => [v[0] * k, v[1] * k, v[2] * k];
  const contacto = suma(p0, por(d, -(R + 0.05)), [0, -0.02, 0]);
  const vPie = Math.max(6, rapidez * 0.75);
  const apoyo = suma(p0, por(lat, 0.22), por(d, -0.05));
  return (t) => {
    const tau = t - tPatada;
    if (tau < -1.0 || tau > 0.7) return [];
    let pie;
    let inclinacion;
    if (tau < -0.6) {
      // Llega corriendo desde atrás (toma carrera) hasta quedar detrás de la pelota.
      const s = suave((tau + 1.0) / 0.4);
      pie = suma(p0, por(d, -0.75 - 2.2 * (1 - s)), por(lat, 0.05 + 0.3 * (1 - s)), [0, 0.05 + 0.12 * Math.abs(Math.sin(tau * 14)) * (1 - s), 0]);
      inclinacion = 0.1 + 0.3 * Math.sin(tau * 14) * (1 - s);
    } else if (tau < -0.12) {
      // Lleva la pierna atrás.
      const s = (tau + 0.6) / 0.48;
      pie = suma(p0, por(d, -0.75 + 0.1 * s), [0, 0.05 + 0.3 * Math.sin((s * Math.PI) / 2), 0]);
      inclinacion = 0.1 + 0.6 * s;
    } else if (tau < 0) {
      // Swing hacia la pelota.
      const s = (tau + 0.12) / 0.12;
      const atras = suma(p0, por(d, -0.65), [0, 0.35, 0]);
      pie = suma(por(atras, 1 - s * s), por(contacto, s * s));
      pie[1] += 0.1 * Math.sin(s * Math.PI) * 0;
      inclinacion = 0.7 - 0.5 * s;
    } else {
      // Sigue después del golpe, frenando y subiendo.
      const avance = vPie * 0.09 * (1 - Math.exp(-tau / 0.09));
      const sube = 0.55 * (1 - Math.exp(-tau / 0.14));
      pie = suma(contacto, por(d, avance), [0, sube, 0]);
      inclinacion = 0.2 - 1.0 * Math.min(1, tau / 0.25);
    }
    const tobillo = suma(pie, [0, 0.06, 0], por(d, -0.06));
    const arriba = unit(suma([0, 1, 0], por(d, inclinacion)));
    const rodilla = suma(tobillo, por(arriba, 0.45));
    const punta = suma(pie, por(d, 0.12));
    const talon = suma(pie, por(d, -0.1));
    const cuerpo = [
      { a: talon, b: punta, r: 0.045, color: kit.botin },
      { a: tobillo, b: rodilla, r: 0.055, color: kit.media },
    ];
    // Pierna de apoyo: llega con la carrera y se planta al costado de la pelota.
    const s = suave((tau + 1.0) / 0.75);
    const planta = suma(apoyo, por(d, -1.8 * (1 - s)), [0, 0.15 * Math.abs(Math.cos(tau * 14)) * (1 - s), 0]);
    cuerpo.push({ a: suma(planta, [0, 0.05, 0], por(d, -0.08)), b: suma(planta, [0, 0.05, 0], por(d, 0.16)), r: 0.045, color: kit.botin });
    cuerpo.push({ a: suma(planta, [0, 0.11, 0]), b: suma(planta, [0, 0.55, 0], por(d, -0.12 - 0.2 * (1 - s))), r: 0.055, color: kit.media });
    return cuerpo;
  };
}
