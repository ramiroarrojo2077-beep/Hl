import { test } from "node:test";
import assert from "node:assert/strict";
import { ARRASTRE, GRAVEDAD, ShotTracker, heightAt, locateBall } from "../js/tracker.js";

const R = 0.11;

// Simula mediciones de un remate desde (x0, z0) hacia la línea de gol, a 30 cuadros por segundo.
function remate({ x0 = 0.3, z0 = 6, vx = 0.5, vz = -12, vy = 0, ruido = 0, quieto = 0.6 }) {
  const obs = [];
  let s = 11;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
  const dt = 1 / 30;
  for (let t = 0; t < quieto; t += dt) obs.push({ t, x: x0, y: R, z: z0, onGround: true, px: 100, py: 40, pr: 8 });
  for (let k = 1; k < 40; k++) {
    const tau = k * dt;
    const z = z0 + vz * tau;
    obs.push({
      t: quieto + tau,
      x: x0 + vx * tau + rnd() * ruido,
      y: heightAt(R, vy, tau, R) + rnd() * ruido,
      z: z + rnd() * ruido,
      onGround: vy === 0,
      px: 100 + vx * tau * 20,
      py: 40 + k * 3,
      pr: 8 - k * 0.1,
    });
    if (z < -0.5) break;
  }
  return obs;
}

// Pasa las mediciones por el seguimiento y devuelve los eventos (sin el aviso de "lista").
function correr(obs, tr = new ShotTracker({ ballRadius: R })) {
  const eventos = [];
  for (const o of obs) {
    const { t, ...p } = o;
    const e = tr.add(t, p) ?? tr.tick(t);
    if (e && e.type !== "ready") eventos.push(e);
  }
  return eventos;
}

test("detecta un remate rasante y predice dónde cruza la línea", () => {
  const eventos = correr(remate({}));
  assert.equal(eventos[0].type, "kick");
  const cruce = eventos.find((e) => e.type === "cross");
  assert.ok(cruce, "no hubo cruce");
  // Cruza en x = 0,3 + 0,5·(6/12) = 0,55
  assert.ok(Math.abs(cruce.prediction.x - 0.55) < 0.05, `x ${cruce.prediction.x}`);
  assert.ok(Math.abs(cruce.prediction.y - R) < 0.02);
  assert.ok(Math.abs(cruce.t - (0.6 + 0.5)) < 0.05, `t ${cruce.t}`);
  // El remate se detecta rápido: a lo sumo 0,1 s después de patear.
  assert.ok(eventos[0].t - 0.6 < 0.1, `detectado a los ${eventos[0].t - 0.6} s`);
});

test("predice la altura de un remate por arriba con ruido en la medición", () => {
  const vy = 4;
  const eventos = correr(remate({ vy, ruido: 0.12 }));
  const cruce = eventos.find((e) => e.type === "cross");
  assert.ok(cruce, "no hubo cruce");
  const tau = 0.5;
  const esperado = R + vy * tau - (GRAVEDAD / 2) * tau * tau;
  assert.ok(Math.abs(cruce.prediction.y - esperado) < 0.3, `y ${cruce.prediction.y} vs ${esperado}`);
});

test("no confunde una pelota quieta con ruido de profundidad con un remate", () => {
  const obs = [];
  for (let k = 0; k < 60; k++) {
    obs.push({ t: k / 30, x: 0, y: R, z: 5 + (k % 2 ? 0.4 : -0.4), onGround: false, px: 100, py: 40, pr: 6 });
  }
  assert.deepEqual(correr(obs), []);
});

test("ignora una pelota que se aleja del arco", () => {
  assert.equal(correr(remate({ vz: 8 })).length, 0);
});

test("locateBall usa el piso cuando la pelota rueda", () => {
  const origin = { x: 0, y: 1.2, z: 8 };
  const target = { x: 0.5, y: R, z: 4 };
  const d = Math.hypot(target.x - origin.x, target.y - origin.y, target.z - origin.z);
  const dir = { x: (target.x - origin.x) / d, y: (target.y - origin.y) / d, z: (target.z - origin.z) / d };
  // Tamaño aparente con un 20 % de error: igual queda bien ubicada.
  const p = locateBall(origin, dir, Math.asin(R / (d * 1.2)), R);
  assert.equal(p.onGround, true);
  assert.ok(Math.hypot(p.x - target.x, p.z - target.z) < 0.01);

  // En el aire, el tamaño manda.
  const aire = { x: 0, y: 1.0, z: 4 };
  const da = Math.hypot(aire.y - origin.y, aire.z - origin.z);
  const dirA = { x: 0, y: (aire.y - origin.y) / da, z: (aire.z - origin.z) / da };
  const q = locateBall(origin, dirA, Math.asin(R / da), R);
  assert.equal(q.onGround, false);
  assert.ok(Math.abs(q.z - 4) < 0.01 && Math.abs(q.y - 1) < 0.01);
});

// ---------- Precisión con ruido realista de cámara ----------

// Mediciones como las arma la app: rayo desde la cámara al centro de la pelota
// (con ruido de ~0,5 px) y radio angular (con ruido de ~6 %).
function medirTrayectoria({ camara, p0, v0, semilla, ruidoDir = 0.0015, ruidoTam = 0.06, quieto = 0.6, arrastre = ARRASTRE }) {
  let s = semilla;
  const gauss = () => {
    let u = 0;
    for (let k = 0; k < 6; k++) u += (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    return (u - 3) / Math.sqrt(0.5);
  };
  const obs = [];
  const dt = 1 / 30;
  // Física real: gravedad, resistencia del aire y piques, en pasos de 1 ms.
  const p = { ...p0 };
  const v = { ...v0 };
  const avanzar = () => {
    for (let n = 0; n < 1000 * dt; n++) {
      const h = 0.001;
      const rapidez = Math.hypot(v.x, v.y, v.z);
      v.x -= arrastre * rapidez * v.x * h;
      v.y -= (arrastre * rapidez * v.y + (p.y > R + 1e-4 || v.y > 0 ? GRAVEDAD : 0)) * h;
      v.z -= arrastre * rapidez * v.z * h;
      p.x += v.x * h;
      p.y += v.y * h;
      p.z += v.z * h;
      if (p.y < R) {
        p.y = R;
        v.y = v.y < -0.5 ? -v.y * 0.6 : 0;
      }
    }
  };
  for (let k = -Math.round(quieto / dt); k < 40; k++) {
    if (k > 0) avanzar();
    if (p.z < -0.3) break;
    const q = { x: p.x - camara.x, y: p.y - camara.y, z: p.z - camara.z };
    const dist = Math.hypot(q.x, q.y, q.z);
    let d = { x: q.x / dist + gauss() * ruidoDir, y: q.y / dist + gauss() * ruidoDir, z: q.z / dist + gauss() * ruidoDir };
    const nd = Math.hypot(d.x, d.y, d.z);
    d = { x: d.x / nd, y: d.y / nd, z: d.z / nd };
    const ang = Math.asin(R / dist) * (1 + gauss() * ruidoTam);
    const pos = locateBall(camara, d, ang, R);
    obs.push({ t: 1 + k * dt, ...pos, px: 333 * (d.x / -d.z), py: 333 * (d.y / -d.z), pr: 333 * ang, o: camara, d, ang, real: { ...p } });
  }
  return obs;
}

// Error (m) de cada predicción del punto de cruce, en orden: la primera es la
// del momento en que se detecta el remate.
// Dónde cruza de verdad la línea (z = 0), interpolando la simulación.
function cruceReal(obs) {
  for (let i = 1; i < obs.length; i++) {
    const a = obs[i - 1].real;
    const b = obs[i].real;
    if (a.z > 0 && b.z <= 0) {
      const k = a.z / (a.z - b.z);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  return null;
}

function erroresPrediccion(obs, conRayos) {
  const tr = new ShotTracker({ ballRadius: R });
  const errores = [];
  const { x, y } = cruceReal(obs);
  const anotar = (e) => e?.prediction && errores.push(Math.hypot(e.prediction.x - x, e.prediction.y - y));
  for (const o of obs) {
    const { t, ...p } = o;
    if (!conRayos) delete p.d;
    anotar(tr.add(t, p) ?? tr.tick(t));
  }
  // La pelota se pierde de vista: el tiempo sigue corriendo.
  for (let k = 1; k <= 30 && tr.state === "flight"; k++) anotar(tr.tick(obs[obs.length - 1].t + k / 30));
  return errores;
}

for (const [nombre, v0] of [
  ["por arriba", { x: 1.6, y: 3.2, z: -14 }],
  ["globo", { x: 0.8, y: 4.5, z: -10 }],
  ["rasante", { x: -1.4, y: 0, z: -11 }],
]) {
  test(`la trayectoria ajustada a los rayos es precisa desde temprano (${nombre})`, () => {
    const camara = { x: 0.5, y: 1.3, z: 7.5 };
    const p0 = { x: 0, y: R, z: 5 };
    const N = 20;
    const media = (conRayos, i) => {
      let s = 0;
      for (let k = 0; k < N; k++) {
        const e = erroresPrediccion(medirTrayectoria({ camara, p0, v0, semilla: 300 + k }), conRayos);
        s += (i < 0 ? e[e.length - 1] : e[i]) / N;
      }
      return s;
    };
    const final = media(true, -1);
    const tercera = media(true, 2);
    assert.ok(final < 0.05, `error final ${(final * 100).toFixed(1)} cm`);
    // Un par de cuadros después del remate el arquero ya sabe a dónde tirarse.
    assert.ok(tercera < 0.12, `error a los 3 cuadros ${(tercera * 100).toFixed(1)} cm`);
    console.log(`  ${nombre}: a los 3 cuadros ${(tercera * 100).toFixed(1)} cm, final ${(final * 100).toFixed(1)} cm`);
  });
}

test("si la última medición ya pasó la línea, el cruce se calcula hacia atrás", () => {
  // Remate por arriba medido hasta medio metro detrás de la línea.
  const v0 = { x: 1.5, y: 3, z: -14 };
  const p0 = { x: 0, y: R, z: 5 };
  const obs = remate({ x0: p0.x, z0: p0.z, vx: v0.x, vz: v0.z, vy: v0.y });
  const tr = new ShotTracker({ ballRadius: R });
  let cruce = null;
  for (const { t, ...p } of obs) {
    const e = tr.add(t, p) ?? tr.tick(t);
    if (e?.type === "cross") cruce = e.prediction;
  }
  const T = p0.z / -v0.z;
  assert.ok(cruce, "no hubo cruce");
  assert.ok(Math.abs(cruce.x - (p0.x + v0.x * T)) < 0.05, `x ${cruce.x}`);
  assert.ok(Math.abs(cruce.y - heightAt(R, v0.y, T, R)) < 0.08, `y ${cruce.y}`);
});

// ---------- Falsas alarmas ----------

// Mediciones de una pelota quieta en (x, z) entre t0 y t1, a 30 cuadros por segundo.
function quieta(x, z, t0, t1, extra = {}) {
  const obs = [];
  for (let t = t0; t < t1 - 1e-9; t += 1 / 30) obs.push({ t, x, y: R, z, onGround: true, px: 100 + x * 20, py: 40 - z * 3, pr: 8, ...extra });
  return obs;
}

test("acomodar la pelota con el pie no es un remate", () => {
  // Quieta, después la llevan despacio (1,5 m/s) hacia el arco y queda quieta otra vez.
  const obs = quieta(0, 6, 0, 0.8);
  for (let k = 1; k <= 20; k++) {
    const z = 6 - 1.5 * (k / 30);
    obs.push({ t: 0.8 + k / 30, x: 0.05 * k * 0.03, y: R, z, onGround: true, px: 100, py: 40 - z * 3, pr: 8 });
  }
  obs.push(...quieta(0.03, 5, 0.8 + 21 / 30, 2));
  assert.deepEqual(correr(obs), []);
});

test("un salto de la detección a otra cosa no es un remate", () => {
  // La detección se va 3 cuadros a un objeto claro a 2 m de la pelota y vuelve.
  const obs = [...quieta(0.3, 6, 0, 0.8)];
  for (let k = 0; k < 3; k++) {
    obs.push({ t: 0.8 + k / 30, x: -1.5, y: R, z: 4.2 - k * 0.5, onGround: true, px: 60, py: 60 + k * 6, pr: 9 });
  }
  obs.push(...quieta(0.3, 6, 0.9, 2));
  assert.deepEqual(correr(obs), []);
});

test("un pie que pasa rápido al lado de la pelota no es un remate", () => {
  // Aparece un "pie" saliendo del punto de la pelota hacia el arco 2 cuadros, pero
  // la pelota se sigue viendo en su lugar: si hubo alarma, se cancela sin resultado.
  const tr = new ShotTracker({ ballRadius: R });
  const obs = [...quieta(0, 6, 0, 0.8)];
  obs.push({ t: 0.8, x: 0.05, y: R, z: 5.6, onGround: true, px: 101, py: 23.2, pr: 8.3 });
  obs.push({ t: 0.8 + 1 / 30, x: 0.1, y: R, z: 5.2, onGround: true, px: 102, py: 24.4, pr: 8.6 });
  obs.push(...quieta(0, 6, 0.8 + 2 / 30, 1.5));
  const eventos = correr(obs, tr);
  assert.ok(!eventos.some((e) => e.type === "cross"), JSON.stringify(eventos.map((e) => e.type)));
  // Y sigue lista: el remate de verdad que viene después se detecta.
  assert.equal(tr.ready, true);
  const despues = correr(
    remate({ x0: 0, z0: 6, vx: 0.4, vz: -12, quieto: 0 }).map((o) => ({ ...o, t: o.t + 1.5 })),
    tr,
  );
  assert.equal(despues[0]?.type, "kick", JSON.stringify(despues.map((e) => e.type)));
  assert.ok(despues.some((e) => e.type === "cross"));
});

test("con el celular en mano la pelota quieta no se mueve", () => {
  // La cámara tiembla: la pelota cambia de lugar en la imagen, pero no en el piso.
  const obs = quieta(0.2, 5, 0, 2).map((o, k) => ({ ...o, px: o.px + 15 * Math.sin(k * 0.7), py: o.py + 10 * Math.cos(k * 0.5) }));
  const tr = new ShotTracker({ ballRadius: R });
  assert.deepEqual(correr(obs, tr), []);
  assert.equal(tr.ready, true);
});

test("elige la pelota entre varias manchas", () => {
  const tr = new ShotTracker({ ballRadius: R });
  correr(quieta(0, 6, 0, 0.8), tr);
  assert.equal(tr.ready, true);
  const pelota = { x: 0.01, y: R, z: 6.02, onGround: true, px: 100, py: 22, pr: 8, score: 0.6, moving: 0 };
  const otra = { x: 1.8, y: R, z: 3, onGround: true, px: 140, py: 31, pr: 10, score: 0.95, moving: 0.4 };
  // Quieta: aunque la otra tenga más puntaje, se queda con la pelota.
  assert.equal(tr.choose(0.8, [otra, pelota]), 1);
  // Una mancha muy alargada (una pierna) no es la pelota.
  assert.equal(tr.choose(0.8, [{ ...pelota, alargada: 5 }]), -1);
});

// Como en la app: en cada cuadro se observan todas las manchas, se elige una y se agrega.
function correrConCandidatas(cuadros, tr = new ShotTracker({ ballRadius: R })) {
  const eventos = [];
  for (const { t, candidatas } of cuadros) {
    tr.observe(t, candidatas);
    const i = tr.choose(t, candidatas);
    const e = (i >= 0 ? tr.add(t, candidatas[i]) : null) ?? tr.tick(t);
    if (e) eventos.push(e);
  }
  return eventos;
}

test("otro objeto redondo y claro quieto no impide detectar el remate de la pelota", () => {
  // Un balde blanco quieto (con más puntaje que la pelota) y la pelota, que después se patea.
  const balde = { x: 1.5, y: R, z: 1.6, onGround: true, px: 150, py: 70, pr: 12, score: 0.95, moving: 0, alargada: 1.05 };
  const tiro = remate({ x0: 0.2, z0: 4, vx: 1, vz: -13, quieto: 0.8 });
  const cuadros = tiro.map(({ t, ...p }) => ({ t, candidatas: [balde, { ...p, score: 0.6, moving: t > 0.8 ? 0.6 : 0, alargada: 1.1 }] }));
  const eventos = correrConCandidatas(cuadros);
  const tipos = eventos.map((e) => e.type);
  assert.equal(tipos[0], "kick", JSON.stringify(tipos));
  const cruce = eventos.find((e) => e.type === "cross");
  assert.ok(cruce, JSON.stringify(tipos));
  // Cruza en x = 0,2 + 1·(4/13) ≈ 0,51
  assert.ok(Math.abs(cruce.prediction.x - (0.2 + 4 / 13)) < 0.05, `x ${cruce.prediction.x}`);
});

test("al salir la pelota no se confunde con el pie que la sigue", () => {
  // En el primer cuadro del remate el pie (alargado, más angosto y con más
  // puntaje por estar cerca del lugar) y la pelota (redonda, del mismo tamaño) se ven a la vez.
  const tr = new ShotTracker({ ballRadius: R });
  correr(quieta(0, 6, 0, 0.8), tr);
  assert.equal(tr.ready, true);
  const pie = { x: 0.02, y: R, z: 5.7, onGround: true, px: 100.5, py: 23, pr: 4.5, score: 1.1, moving: 1, alargada: 2.8 };
  const pelota = { x: 0.05, y: R, z: 5.4, onGround: true, px: 101, py: 26, pr: 7.6, score: 0.7, moving: 1, alargada: 1.02 };
  assert.equal(tr.choose(0.8, [pie, pelota]), 1);
});

test("un objeto quieto que nunca se mueve no dispara nada", () => {
  const balde = { x: 1.5, y: R, z: 1.6, onGround: true, px: 150, py: 70, pr: 12, score: 0.95, moving: 0, alargada: 1.05 };
  const cuadros = [];
  for (let k = 0; k < 90; k++) cuadros.push({ t: k / 30, candidatas: [balde] });
  assert.deepEqual(correrConCandidatas(cuadros), []);
});

test("calibra el radio real de la pelota apoyada", async () => {
  const { radioApoyada } = await import("../js/tracker.js");
  const o = { x: 0.4, y: 1.25, z: 7.2 };
  for (const radio of [0.095, 0.103, 0.11]) {
    const c = { x: -0.3, y: radio, z: 3.1 };
    const dist = Math.hypot(c.x - o.x, c.y - o.y, c.z - o.z);
    const d = { x: (c.x - o.x) / dist, y: (c.y - o.y) / dist, z: (c.z - o.z) / dist };
    assert.ok(Math.abs(radioApoyada(o, d, Math.asin(radio / dist)) - radio) < 1e-9);
    // Con un 2 % de error en el radio angular, el radio sale con ~2 % de error.
    assert.ok(Math.abs(radioApoyada(o, d, Math.asin(radio / dist) * 1.02) / radio - 1) < 0.025);
  }
});

test("un remate muy rápido y borroso no se va a las nubes", () => {
  // A toda velocidad la pelota sale estirada y su ancho se mide más chico: por
  // tamaño parece más lejos (y, con el rayo hacia arriba, más alta).
  const camara = { x: 1.2, y: 1.4, z: 6.5 };
  const p0 = { x: 0, y: R, z: 4.5 };
  for (const [semilla, v0] of [
    [41, { x: 1.5, y: 1, z: -27 }],
    [42, { x: -2, y: 2.5, z: -26 }],
  ]) {
    const obs = medirTrayectoria({ camara, p0, v0, semilla }).map((o) => {
      if (o.t <= 1) return o;
      const ang = o.ang * 0.6;
      return { ...o, ang, pr: o.pr * 0.6, ...locateBall(camara, o.d, ang, R) };
    });
    // Altura real al cruzar la línea (pasa en un cuadro casi 1 m: se extrapola).
    const [a, b] = obs.slice(-2).map((o) => o.real);
    const y = a.y + ((b.y - a.y) * a.z) / (a.z - b.z);
    const tr = new ShotTracker({ ballRadius: R });
    let pred = null;
    for (const o of obs) {
      const { t, ...p } = o;
      const e = tr.add(t, p) ?? tr.tick(t);
      if (e?.prediction) pred = e.prediction;
    }
    assert.ok(pred, "tiene que detectar el remate");
    assert.ok(Math.abs(pred.y - y) < 0.6, `cruza a ${pred.y.toFixed(2)} m (de verdad ${y.toFixed(2)} m)`);
  }
});
