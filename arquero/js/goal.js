import * as THREE from "three";
import { radioPalo } from "./keeper-ai.js";

const CELDA_RED = 0.12; // m

function texturaRed() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  // Rombos, como una red de verdad.
  ctx.moveTo(0, 32);
  ctx.lineTo(32, 0);
  ctx.lineTo(64, 32);
  ctx.lineTo(32, 64);
  ctx.closePath();
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Cilindro entre dos puntos.
function barra(a, b, radio, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radio, radio, dir.length(), 12), material);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  m.castShadow = true;
  return m;
}

// Arco con red. Origen en el centro de la línea de gol, sobre el piso; la red
// queda hacia -z y la cancha hacia +z.
export class Goal {
  constructor({ ancho, alto }) {
    this.ancho = ancho;
    this.alto = alto;
    this.group = new THREE.Group();
    const r = radioPalo(alto);
    const fondoArriba = 0.35 * alto;
    const fondoAbajo = 0.8 * alto;
    this.fondoAbajo = fondoAbajo;

    const blanco = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.1 });
    const gris = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.6 });
    const v = (x, y, z) => new THREE.Vector3(x, y, z);
    const w2 = ancho / 2;
    this.group.add(
      barra(v(-w2, 0, 0), v(-w2, alto + r, 0), r, blanco),
      barra(v(w2, 0, 0), v(w2, alto + r, 0), r, blanco),
      barra(v(-w2 - r, alto, 0), v(w2 + r, alto, 0), r, blanco),
      barra(v(-w2, alto, -fondoArriba), v(w2, alto, -fondoArriba), r * 0.5, gris),
      barra(v(-w2, r * 0.5, -fondoAbajo), v(w2, r * 0.5, -fondoAbajo), r * 0.5, gris),
      barra(v(-w2, alto, 0), v(-w2, alto, -fondoArriba), r * 0.5, gris),
      barra(v(w2, alto, 0), v(w2, alto, -fondoArriba), r * 0.5, gris),
      barra(v(-w2, alto, -fondoArriba), v(-w2, 0, -fondoAbajo), r * 0.5, gris),
      barra(v(w2, alto, -fondoArriba), v(w2, 0, -fondoAbajo), r * 0.5, gris),
      barra(v(-w2, r * 0.5, 0), v(-w2, r * 0.5, -fondoAbajo), r * 0.5, gris),
      barra(v(w2, r * 0.5, 0), v(w2, r * 0.5, -fondoAbajo), r * 0.5, gris),
    );

    const base = texturaRed();
    const materialRed = (repX, repY) => {
      const t = base.clone();
      t.repeat.set(repX, repY);
      t.needsUpdate = true;
      return new THREE.MeshBasicMaterial({
        map: t,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
    };

    // Red del fondo, inclinada; tiene vértices de sobra para ondular con el gol.
    const largo = Math.hypot(alto, fondoAbajo - fondoArriba);
    this.anguloFondo = Math.atan2(fondoAbajo - fondoArriba, alto);
    const geo = new THREE.PlaneGeometry(ancho, largo, 32, 16);
    this.redFondo = new THREE.Mesh(geo, materialRed(ancho / CELDA_RED, largo / CELDA_RED));
    this.redFondo.position.set(0, alto / 2, -(fondoArriba + fondoAbajo) / 2);
    this.redFondo.rotation.x = this.anguloFondo;
    this.redFondo.renderOrder = 2;
    this.baseFondo = Float32Array.from(geo.attributes.position.array);

    const techo = new THREE.Mesh(new THREE.PlaneGeometry(ancho, fondoArriba), materialRed(ancho / CELDA_RED, fondoArriba / CELDA_RED));
    techo.rotation.x = -Math.PI / 2;
    techo.position.set(0, alto, -fondoArriba / 2);
    techo.renderOrder = 2;
    this.group.add(this.redFondo, techo);

    const forma = new THREE.Shape([
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0, alto),
      new THREE.Vector2(-fondoArriba, alto),
      new THREE.Vector2(-fondoAbajo, 0),
    ]);
    for (const lado of [-1, 1]) {
      const geoLado = new THREE.ShapeGeometry(forma);
      geoLado.rotateY(-Math.PI / 2);
      const m = materialRed(1, 1);
      m.map.repeat.set(1 / CELDA_RED, 1 / CELDA_RED);
      const lateral = new THREE.Mesh(geoLado, m);
      lateral.position.x = lado * w2;
      lateral.renderOrder = 2;
      this.group.add(lateral);
    }

    // Sombra sobre el piso real.
    const sombra = new THREE.Mesh(
      new THREE.PlaneGeometry(ancho * 2.5, ancho * 2.5),
      new THREE.ShadowMaterial({ opacity: 0.32 }),
    );
    sombra.rotation.x = -Math.PI / 2;
    sombra.position.set(0, 0.002, ancho * 0.3);
    sombra.receiveShadow = true;
    this.group.add(sombra);

    this.onda = null;
  }

  // Hace ondular la red donde entró la pelota (x, y en metros sobre la línea).
  ripple(x, y, t) {
    this.onda = { x, v: (y - this.alto / 2) / Math.cos(this.anguloFondo), t0: t };
  }

  update(t) {
    if (!this.onda) return;
    const pos = this.redFondo.geometry.attributes.position;
    const dt = t - this.onda.t0;
    const fuerza = Math.exp(-dt * 3.5);
    const sigma = 0.18 * this.alto;
    const amplitud = 0.22 * this.alto;
    for (let i = 0; i < pos.count; i++) {
      const x = this.baseFondo[i * 3];
      const y = this.baseFondo[i * 3 + 1];
      const d2 = (x - this.onda.x) ** 2 + (y - this.onda.v) ** 2;
      const golpe = Math.exp(-d2 / (2 * sigma * sigma));
      pos.setZ(i, -amplitud * golpe * fuerza * Math.cos(dt * 16));
    }
    pos.needsUpdate = true;
    if (fuerza < 0.01) {
      for (let i = 0; i < pos.count; i++) pos.setZ(i, 0);
      this.onda = null;
    }
  }

  setPreview(preview) {
    this.group.traverse((o) => {
      if (!o.material || o.material.isShadowMaterial) return;
      o.material.transparent = true;
      o.material.opacity = preview ? 0.45 : o.material.map ? 0.85 : 1;
    });
  }
}
