import { test } from "node:test";
import assert from "node:assert/strict";
import { ARRASTRE, GRAVEDAD, ShotTracker, heightAt, locateBall } from "../js/tracker.js";

const R = 0.11;

// Simula mediciones de un remate desde (x0, z0) hacia la línea de gol, a 30 cuadros por segundo.
function remate({ x0 = 0.3, z0 = 6, vx = 0.5, vz = -12, vy = 0, ruido = 0, quieto = 0.3 }) {
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

function correr(obs) {
  const tr = new ShotTracker({ ballRadius: R });
  const eventos = [];
  for (const o of obs) {
    const { t, ...p } = o;
    const e = tr.add(t, p) ?? tr.tick(t);
    if (e) eventos.push(e);
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
  assert.ok(Math.abs(cruce.t - (0.3 + 0.5)) < 0.05, `t ${cruce.t}`);
  // El remate se detecta rápido: a lo sumo 0,15 s después de patear.
  assert.ok(eventos[0].t - 0.3 < 0.15);
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
function medirTrayectoria({ camara, p0, v0, semilla, ruidoDir = 0.0015, ruidoTam = 0.06, quieto = 0.3, arrastre = ARRASTRE }) {
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
    const terceraAntes = media(false, 2);
    assert.ok(final < 0.05, `error final ${(final * 100).toFixed(1)} cm`);
    // Un par de cuadros después del remate el arquero ya sabe a dónde tirarse.
    assert.ok(tercera < 0.15, `error a los 3 cuadros ${(tercera * 100).toFixed(1)} cm`);
    if (v0.y !== 0) assert.ok(tercera < terceraAntes * 0.5, `${(tercera * 100).toFixed(1)} cm vs ${(terceraAntes * 100).toFixed(1)} cm`);
    console.log(`  ${nombre}: a los 3 cuadros ${(tercera * 100).toFixed(1)} cm (antes ${(terceraAntes * 100).toFixed(1)}), final ${(final * 100).toFixed(1)} cm`);
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
