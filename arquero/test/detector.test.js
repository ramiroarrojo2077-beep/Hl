import { test } from "node:test";
import assert from "node:assert/strict";
import { BallDetector, matrizK } from "../js/detector.js";

const W = 200;
const H = 120;
const IDENTIDAD = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const QUIETA = { K: IDENTIDAD, R: IDENTIDAD };

// Generador pseudoaleatorio fijo para que los tests sean repetibles.
function azar(semilla) {
  let s = semilla;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// Pasto con ruido y, opcionalmente, una pelota blanca con gajos negros.
function cuadro({ fondo = "pasto", pelota = null, luz = 1, semilla = 1 }) {
  const rnd = azar(semilla);
  const img = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const n = (rnd() - 0.5) * 30;
      let c =
        fondo === "pasto"
          ? [50 + n, 130 + n + ((x >> 3) % 2) * 15, 45 + n]
          : [215 + n * 0.3, 212 + n * 0.3, 205 + n * 0.3];
      if (pelota) {
        const dx = x + 0.5 - pelota.x;
        const dy = y + 0.5 - pelota.y;
        if (dx * dx + dy * dy <= pelota.r * pelota.r) {
          const gajo = Math.sin((dx / pelota.r) * 7) * Math.sin((dy / pelota.r) * 7) > 0.55;
          c = gajo ? [30 + n * 0.3, 30 + n * 0.3, 32] : [235 + n * 0.3, 235 + n * 0.3, 232];
        }
      }
      img[i] = Math.max(0, Math.min(255, c[0] * luz));
      img[i + 1] = Math.max(0, Math.min(255, c[1] * luz));
      img[i + 2] = Math.max(0, Math.min(255, c[2] * luz));
      img[i + 3] = 255;
    }
  }
  return img;
}

test("aprende la pelota de cerca y la encuentra lejos con otra luz", () => {
  const det = new BallDetector(W, H);
  const escaneo = cuadro({ pelota: { x: 100, y: 60, r: 28 } });
  const res = det.learn(escaneo, 100, 60, 30);
  assert.equal(res.ok, true, JSON.stringify(res));

  const lejos = cuadro({ pelota: { x: 37, y: 85, r: 6 }, luz: 0.85, semilla: 7 });
  const d = det.detect(lejos);
  assert.ok(d, "no la encontró");
  assert.ok(Math.abs(d.x - 37) < 1.2 && Math.abs(d.y - 85) < 1.2, `centro ${d.x},${d.y}`);
  assert.ok(Math.abs(d.r - 6) < 1.8, `radio ${d.r}`);
});

test("no inventa una pelota si no hay ninguna", () => {
  const det = new BallDetector(W, H);
  det.learn(cuadro({ pelota: { x: 100, y: 60, r: 28 } }), 100, 60, 30);
  assert.equal(det.detect(cuadro({ semilla: 3 })), null);
});

test("rechaza el escaneo si la pelota no está en el círculo", () => {
  const det = new BallDetector(W, H);
  const res = det.learn(cuadro({ semilla: 5 }), 100, 60, 30);
  assert.equal(res.ok, false);
  assert.equal(det.trained, false);
});

test("con la cámara quieta se adapta al fondo y encuentra la pelota en movimiento", () => {
  const det = new BallDetector(W, H);
  // Escaneo sobre pasto; el remate es contra una pared clara y la pelota es blanca.
  det.learn(cuadro({ pelota: { x: 100, y: 60, r: 28 } }), 100, 60, 30);
  // Un segundo con la pelota quieta: aprende que la pared es fondo.
  for (let k = 0; k < 30; k++) {
    det.detect(cuadro({ fondo: "pared", pelota: { x: 60, y: 40, r: 9 }, semilla: 2 + (k % 3) }), { camera: QUIETA });
  }
  let anterior = { x: 60, y: 40, r: 9 };
  for (let k = 1; k <= 4; k++) {
    const pos = { x: 60 + k * 18, y: 40 + k * 5, r: 9 - k };
    const d = det.detect(cuadro({ fondo: "pared", pelota: pos, semilla: 2 + k }), { camera: QUIETA, near: anterior });
    assert.ok(d, `cuadro ${k}: no la encontró`);
    assert.ok(Math.abs(d.x - pos.x) < 2 && Math.abs(d.y - pos.y) < 2, `cuadro ${k}: centro ${d.x},${d.y}`);
    anterior = d;
  }
});

// Cámara en mano: la escena se genera a partir de la dirección en el mundo de
// cada píxel, así un giro de la cámara mueve todo el fondo en la imagen.
function cuadroGirado({ yaw, pelota, semilla }) {
  const rnd = azar(semilla);
  // Proyección de WebGL con 60° de campo vertical.
  const f = 1 / Math.tan(Math.PI / 6);
  const P = new Float32Array(16);
  P[0] = f * (H / W);
  P[5] = f;
  P[10] = -1;
  P[11] = -1;
  P[14] = -0.1;
  const K = matrizK(P, W, H);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const R = [c, 0, s, 0, 1, 0, -s, 0, c];
  const img = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ndcX = ((x + 0.5) / W) * 2 - 1;
      const ndcY = ((y + 0.5) / H) * 2 - 1;
      const cam = [ndcX / P[0], ndcY / P[5], -1];
      const d = [R[0] * cam[0] + R[2] * cam[2], cam[1], R[6] * cam[0] + R[8] * cam[2]];
      const az = Math.atan2(d[0], -d[2]);
      const el = Math.atan2(d[1], Math.hypot(d[0], d[2]));
      const n = (rnd() - 0.5) * 20;
      let col = Math.floor(az / 0.08) % 2 ? [190 + n, 180 + n, 160 + n] : [120 + n, 100 + n, 80 + n];
      const dAz = az - pelota.az;
      const dEl = el - pelota.el;
      if (dAz * dAz + dEl * dEl < pelota.rho * pelota.rho) col = [235 + n * 0.2, 235 + n * 0.2, 232];
      const i = (y * W + x) * 4;
      img[i] = col[0];
      img[i + 1] = col[1];
      img[i + 2] = col[2];
      img[i + 3] = 255;
    }
  }
  return { img, camera: { K, R } };
}

test("en mano descuenta el giro de la cámara", () => {
  const det = new BallDetector(W, H);
  det.learn(cuadro({ pelota: { x: 100, y: 60, r: 28 } }), 100, 60, 30);
  const pelota = { az: 0.05, el: -0.2, rho: 0.06 };
  // La mano tiembla unos grados mientras la pelota está quieta.
  for (let k = 0; k < 24; k++) {
    const { img, camera } = cuadroGirado({ yaw: 0.04 * Math.sin(k * 0.9), pelota, semilla: k });
    det.detect(img, { camera });
  }
  let anterior = null;
  for (let k = 1; k <= 4; k++) {
    const p = { ...pelota, az: pelota.az + k * 0.07, rho: pelota.rho * (1 - k * 0.08) };
    const yaw = 0.04 * Math.sin((24 + k) * 0.9);
    const { img, camera } = cuadroGirado({ yaw, pelota: p, semilla: 40 + k });
    const d = det.detect(img, { camera, near: anterior });
    assert.ok(d, `cuadro ${k}: no la encontró`);
    // Dónde debería verse: dirección de la pelota en coordenadas de cámara.
    const dir = [Math.sin(p.az) * Math.cos(p.el), Math.sin(p.el), -Math.cos(p.az) * Math.cos(p.el)];
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const cam = [c * dir[0] - s * dir[2], dir[1], s * dir[0] + c * dir[2]];
    const K = camera.K;
    const u = (K[0] * cam[0] + K[1] * cam[1] + K[2] * cam[2]) / -cam[2];
    const v = (K[3] * cam[0] + K[4] * cam[1] + K[5] * cam[2]) / -cam[2];
    assert.ok(Math.hypot(d.x - u, d.y - v) < 3, `cuadro ${k}: ${d.x},${d.y} esperaba ${u},${v}`);
    anterior = d;
  }
});

// Pelota con bordes suavizados (como en una cámara real) en posiciones con decimales.
function cuadroSuave(pelota, semilla) {
  const rnd = azar(semilla);
  const img = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = (rnd() - 0.5) * 20;
      const pasto = [50 + n, 130 + n, 45 + n];
      // Fracción del píxel cubierta por la pelota (4×4 muestras).
      let dentro = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++)
          if ((x + (sx + 0.5) / 4 - pelota.x) ** 2 + (y + (sy + 0.5) / 4 - pelota.y) ** 2 <= pelota.r ** 2) dentro++;
      const a = dentro / 16;
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) img[i + c] = Math.max(0, Math.min(255, pasto[c] * (1 - a) + (235 + n * 0.2) * a));
      img[i + 3] = 255;
    }
  }
  return img;
}

test("ubica la pelota con precisión de fracciones de píxel", () => {
  const det = new BallDetector(W, H);
  det.learn(cuadroSuave({ x: 100, y: 60, r: 28 }, 1), 100, 60, 30);
  let errCentro = 0;
  let errRadio = 0;
  const casos = [
    { x: 40.3, y: 70.6, r: 6.4 },
    { x: 120.75, y: 35.2, r: 9.1 },
    { x: 77.5, y: 90.9, r: 4.3 },
    { x: 150.1, y: 50.45, r: 12.7 },
  ];
  for (const [k, p] of casos.entries()) {
    const d = det.detect(cuadroSuave(p, 10 + k));
    assert.ok(d, `no encontró ${JSON.stringify(p)}`);
    errCentro = Math.max(errCentro, Math.hypot(d.x - p.x, d.y - p.y));
    errRadio = Math.max(errRadio, Math.abs(d.r - p.r));
  }
  assert.ok(errCentro < 0.25, `centro: ${errCentro.toFixed(2)} px`);
  assert.ok(errRadio < 0.5, `radio: ${errRadio.toFixed(2)} px`);
});

// Recorte de tam×tam píxeles que cubre el cuadrado [x0, x0+lado]×[y0, y0+lado] de la imagen base.
function recorteSuave(pelota, x0, y0, lado, tam, semilla) {
  const rnd = azar(semilla);
  const img = new Uint8Array(tam * tam * 4);
  const k = lado / tam;
  for (let y = 0; y < tam; y++) {
    for (let x = 0; x < tam; x++) {
      const n = (rnd() - 0.5) * 20;
      const pasto = [50 + n, 130 + n, 45 + n];
      let dentro = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const bx = x0 + (x + (sx + 0.5) / 4) * k;
          const by = y0 + (y + (sy + 0.5) / 4) * k;
          if ((bx - pelota.x) ** 2 + (by - pelota.y) ** 2 <= pelota.r ** 2) dentro++;
        }
      const a = dentro / 16;
      const i = (y * tam + x) * 4;
      for (let c = 0; c < 3; c++) img[i + c] = Math.max(0, Math.min(255, pasto[c] * (1 - a) + (235 + n * 0.2) * a));
      img[i + 3] = 255;
    }
  }
  return img;
}

test("el recorte en alta resolución mide la pelota todavía mejor", () => {
  const det = new BallDetector(W, H);
  det.learn(cuadroSuave({ x: 100, y: 60, r: 28 }, 1), 100, 60, 30);
  let antes = 0;
  let despues = 0;
  let radioAntes = 0;
  let radioDespues = 0;
  const casos = [
    { x: 40.3, y: 70.6, r: 4.4 },
    { x: 120.75, y: 35.2, r: 3.1 },
    { x: 77.45, y: 90.9, r: 5.3 },
    { x: 150.1, y: 50.45, r: 6.7 },
  ];
  for (const [k, p] of casos.entries()) {
    const d = det.detect(cuadroSuave(p, 10 + k));
    assert.ok(d, `no encontró ${JSON.stringify(p)}`);
    // Como en la app: un cuadrado de 5 radios alrededor, leído 4 veces más fino.
    const lado = Math.max(5 * d.r, 24);
    const tam = Math.round(lado * 4);
    const x0 = d.x - lado / 2;
    const y0 = d.y - lado / 2;
    const fino = det.refine(recorteSuave(p, x0, y0, lado, tam, 50 + k), tam, tam, { x: tam / 2, y: tam / 2, r: (d.r * tam) / lado });
    assert.ok(fino, `el refinado no la encontró ${JSON.stringify(p)}`);
    const x = x0 + (fino.x * lado) / tam;
    const y = y0 + (fino.y * lado) / tam;
    const r = (fino.r * lado) / tam;
    antes = Math.max(antes, Math.hypot(d.x - p.x, d.y - p.y));
    despues = Math.max(despues, Math.hypot(x - p.x, y - p.y));
    radioAntes = Math.max(radioAntes, Math.abs(d.r - p.r));
    radioDespues = Math.max(radioDespues, Math.abs(r - p.r));
  }
  console.log(
    `  centro ${antes.toFixed(3)} → ${despues.toFixed(3)} px · radio ${radioAntes.toFixed(3)} → ${radioDespues.toFixed(3)} px`,
  );
  assert.ok(despues < 0.1, `centro ${despues.toFixed(3)} px`);
  assert.ok(radioDespues < 0.15, `radio ${radioDespues.toFixed(3)} px`);
  assert.ok(radioDespues < radioAntes, "el radio no mejoró");
});

// Recorte realista: la pelota con un costado en sombra (luz desde arriba a la
// izquierda), gajos negros y, si se pide, un pie oscuro tapando parte del borde.
function recorteRealista(pelota, x0, y0, lado, tam, semilla, { pie = false } = {}) {
  const rnd = azar(semilla);
  const img = new Uint8Array(tam * tam * 4);
  const k = lado / tam;
  for (let y = 0; y < tam; y++) {
    for (let x = 0; x < tam; x++) {
      const n = (rnd() - 0.5) * 16;
      let suma = [0, 0, 0];
      for (let sy = 0; sy < 3; sy++)
        for (let sx = 0; sx < 3; sx++) {
          const bx = x0 + (x + (sx + 0.5) / 3) * k;
          const by = y0 + (y + (sy + 0.5) / 3) * k;
          let c = [50 + n, 130 + n, 45 + n];
          const dx = (bx - pelota.x) / pelota.r;
          const dy = (by - pelota.y) / pelota.r;
          if (dx * dx + dy * dy <= 1) {
            const nz = Math.sqrt(1 - dx * dx - dy * dy);
            // Luz desde arriba a la izquierda (y crece hacia arriba).
            const luz = Math.max(0, -0.55 * dx + 0.55 * dy + 0.62 * nz);
            const brillo = 0.38 + 0.62 * luz;
            const gajo = Math.sin(dx * 6.5) * Math.sin(dy * 6.5) > 0.55;
            c = gajo ? [25, 25, 28] : [242 * brillo, 242 * brillo, 236 * brillo];
          }
          if (pie && bx > pelota.x + 0.35 * pelota.r && by < pelota.y - 0.1 * pelota.r) c = [40 + n * 0.3, 32, 30];
          suma = suma.map((v, i) => v + c[i] / 9);
        }
      const i = (y * tam + x) * 4;
      for (let c = 0; c < 3; c++) img[i + c] = Math.max(0, Math.min(255, suma[c]));
      img[i + 3] = 255;
    }
  }
  return img;
}

for (const pie of [false, true]) {
  test(`el borde mide bien la pelota con sombra${pie ? " y un pie tapándola" : ""}`, () => {
    const det = new BallDetector(W, H);
    // Escaneo con la pelota bien iluminada.
    det.learn(cuadroSuave({ x: 100, y: 60, r: 28 }, 1), 100, 60, 30);
    const casos = [
      { x: 40.3, y: 70.6, r: 5.4 },
      { x: 120.75, y: 35.2, r: 7.1 },
      { x: 77.45, y: 90.9, r: 9.3 },
    ];
    const err = { color: { c: 0, r: 0 }, borde: { c: 0, r: 0 } };
    for (const [k, p] of casos.entries()) {
      const lado = Math.max(5 * p.r, 24);
      const tam = Math.round(lado * 4);
      // Centro de partida algo corrido, como sale de la imagen chica.
      const x0 = p.x + 0.3 - lado / 2;
      const y0 = p.y - 0.2 - lado / 2;
      const img = recorteRealista(p, x0, y0, lado, tam, 70 + k, { pie });
      const guess = { x: tam / 2, y: tam / 2, r: p.r * 0.9 * (tam / lado) };
      for (const modo of ["color", "borde"]) {
        const f = det.refine(img, tam, tam, guess, { borde: modo === "borde" });
        if (!f && modo === "color") {
          // Con sombra el color directamente puede no encontrarla.
          err.color.c = err.color.r = Infinity;
          continue;
        }
        assert.ok(f, `${modo}: no la encontró ${JSON.stringify(p)}`);
        const x = x0 + (f.x * lado) / tam;
        const y = y0 + (f.y * lado) / tam;
        const r = (f.r * lado) / tam;
        err[modo].c = Math.max(err[modo].c, Math.hypot(x - p.x, y - p.y));
        err[modo].r = Math.max(err[modo].r, Math.abs(r - p.r) / p.r);
      }
    }
    console.log(
      `  ${pie ? "con pie" : "con sombra"}: color centro ${err.color.c.toFixed(2)} px, radio ${(err.color.r * 100).toFixed(1)} % · borde centro ${err.borde.c.toFixed(2)} px, radio ${(err.borde.r * 100).toFixed(1)} %`,
    );
    assert.ok(err.borde.r < 0.02, `radio por borde ${(err.borde.r * 100).toFixed(1)} %`);
    assert.ok(err.borde.c < 0.15, `centro por borde ${err.borde.c.toFixed(2)} px`);
    assert.ok(err.borde.r < err.color.r, "el borde no mejoró el radio");
  });
}

// ---------- Piso de granito (gris claro moteado) y pelota blanca con parches ----------

// Cámara a 1 m del piso mirando hacia abajo, en coordenadas del mundo (y arriba).
const FY = 1 / Math.tan(Math.PI / 6); // 60° de campo vertical
const PROY = [FY / (W / H), 0, 0, 0, 0, FY, 0, 0, 0, 0, -1, -1, 0, 0, -0.02, 0];
const ABAJO = { K: matrizK(PROY, W, H), R: [1, 0, 0, 0, 0, 1, 0, -1, 0], p: [0, 1, 0], pisoY: 0 };
const RADIO = 0.11;
const RADIO_PX = ((H / 2) * FY * RADIO) / (1 - RADIO); // apoyada en el centro de la imagen

function granito({ pelota = null, puntos = [], semilla = 1 }) {
  const rnd = azar(semilla);
  const img = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const u = rnd();
      // Moteado: gris claro con puntitos blancos y negros (del color de la pelota).
      let c = u < 0.15 ? [236, 236, 233] : u < 0.3 ? [50, 50, 52] : [178 + (rnd() - 0.5) * 20, 176, 172];
      for (const p of puntos) if ((x + 0.5 - p.x) ** 2 + (y + 0.5 - p.y) ** 2 <= p.r * p.r) c = [238, 238, 235];
      if (pelota) {
        const dx = x + 0.5 - pelota.x;
        const dy = y + 0.5 - pelota.y;
        if (dx * dx + dy * dy <= pelota.r * pelota.r) {
          const parche = Math.sin((dx / pelota.r) * 5) * Math.sin((dy / pelota.r) * 5) > 0.5;
          c = parche ? [30, 60, 170] : [245, 245, 242];
        }
      }
      img[i] = c[0];
      img[i + 1] = c[1];
      img[i + 2] = c[2];
      img[i + 3] = 255;
    }
  }
  return img;
}

test("en un piso de granito encuentra la pelota del tamaño que corresponde, no los puntitos", () => {
  const det = new BallDetector(W, H);
  const res = det.learn(granito({ pelota: { x: 100, y: 60, r: 30 } }), 100, 60, 32, ABAJO);
  assert.equal(res.ok, true, JSON.stringify(res));
  // Unos puntos blancos grandes del piso (del color de la pelota), lejos de ella.
  const puntos = [
    { x: 30, y: 30, r: 3 },
    { x: 170, y: 95, r: 2.5 },
    { x: 160, y: 20, r: 3 },
  ];
  let c = [];
  for (let k = 0; k < 8; k++) c = det.detectAll(granito({ pelota: { x: 100, y: 60, r: RADIO_PX }, puntos, semilla: 3 + k }), { camera: ABAJO, radio: RADIO, etapa: "quieta", soloSuelo: true });
  assert.ok(c.length, "no encontró nada");
  const [a] = c;
  assert.ok(Math.hypot(a.x - 100, a.y - 60) < 0.3 * RADIO_PX, `la primera está en ${a.x.toFixed(1)},${a.y.toFixed(1)} r ${a.r.toFixed(1)}`);
  assert.ok(Math.abs(Math.log(a.r / RADIO_PX)) < 0.35, `radio ${a.r.toFixed(1)} (se esperaba ${RADIO_PX.toFixed(1)})`);
  // Ningún puntito de 3 px entre las candidatas: la pelota ahí mediría ~13 px.
  assert.ok(!c.some((k) => k.r < 0.4 * RADIO_PX), `candidatas chicas: ${c.map((k) => k.r.toFixed(1)).join(", ")}`);
});

test("lista para patear no descarta la pelota más grande (recién pateada, en el aire)", () => {
  const det = new BallDetector(W, H);
  assert.equal(det.learn(granito({ pelota: { x: 100, y: 60, r: 30 } }), 100, 60, 32, ABAJO).ok, true);
  // En el aire, más cerca de la cámara: el doble y medio de grande.
  let c = [];
  for (let k = 0; k < 4; k++) c = det.detectAll(granito({ pelota: { x: 100, y: 60, r: 2.6 * RADIO_PX }, semilla: 20 + k }), { camera: ABAJO, radio: RADIO, etapa: "lista" });
  assert.ok(c.some((k) => Math.hypot(k.x - 100, k.y - 60) < 4 && k.r > 1.8 * RADIO_PX), `candidatas: ${c.map((k) => `${k.x.toFixed(0)},${k.y.toFixed(0)} r${k.r.toFixed(1)}`).join(" ")}`);
});
