import { test } from "node:test";
import assert from "node:assert/strict";
import { matrizK } from "../js/detector.js";
import { CameraOrientation, ORIENTACIONES } from "../js/orientacion.js";

const W = 160;
const H = 120;

// Escena con textura (ladrillos y franjas) generada desde la dirección en el
// mundo de cada píxel, como la vería una cámara que gira (yaw, pitch).
function cuadro(yaw, pitch) {
  const f = 1 / Math.tan(Math.PI / 6);
  const P = new Float32Array(16);
  P[0] = f * (H / W);
  P[5] = f;
  P[10] = -1;
  P[11] = -1;
  P[14] = -0.1;
  const K = matrizK(P, W, H);
  const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
  // R = Ry(yaw)·Rx(pitch), fila por fila (cámara → mundo).
  const R = [cy, sy * sp, sy * cp, 0, cp, -sp, -sy, cy * sp, cy * cp];
  const img = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = [(((x + 0.5) / W) * 2 - 1) / P[0], (((y + 0.5) / H) * 2 - 1) / P[5], -1];
      const d = [R[0] * c[0] + R[1] * c[1] + R[2] * c[2], R[3] * c[0] + R[4] * c[1] + R[5] * c[2], R[6] * c[0] + R[7] * c[1] + R[8] * c[2]];
      const az = Math.atan2(d[0], -d[2]);
      const el = Math.atan2(d[1], Math.hypot(d[0], d[2]));
      // Textura asimétrica arriba/abajo e izquierda/derecha.
      const v = 120 + 60 * Math.sin(az * 23) * Math.cos(el * 17) + 50 * Math.sin(az * 7 + el * 11) + 40 * (el > 0.05 ? 1 : -1);
      const i = (y * W + x) * 4;
      img[i] = img[i + 1] = img[i + 2] = Math.max(0, Math.min(255, v));
      img[i + 3] = 255;
    }
  }
  return { img, camera: { K, R } };
}

// La imagen leída con una orientación distinta de la real.
function transformar(img, o) {
  const out = new Uint8Array(img.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = o.x ? W - 1 - x : x;
      const sy = o.y ? H - 1 - y : y;
      out.set(img.subarray((sy * W + sx) * 4, (sy * W + sx) * 4 + 4), (y * W + x) * 4);
    }
  }
  return out;
}

for (const [i, o] of ORIENTACIONES.entries()) {
  test(`detecta la imagen ${o.nombre} cuando el celular gira`, () => {
    const cal = new CameraOrientation();
    let resultado = null;
    for (let k = 0; k < 40 && resultado === null; k++) {
      // La mano tiembla: unos grados de giro entre cuadros.
      const { img, camera } = cuadro(0.03 * Math.sin(k * 0.8), -0.2 + 0.025 * Math.cos(k * 0.6));
      resultado = cal.observe(transformar(img, o), W, H, camera);
    }
    assert.equal(resultado, i, `votos ${cal.votos}`);
  });
}

test("si el celular no gira, no decide nada", () => {
  const cal = new CameraOrientation();
  for (let k = 0; k < 30; k++) {
    const { img, camera } = cuadro(0, -0.2);
    assert.equal(cal.observe(img, W, H, camera), null);
  }
});
