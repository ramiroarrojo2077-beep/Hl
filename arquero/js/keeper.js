import * as THREE from "three";
import { CUERPO } from "./keeper-ai.js";

// Arquero armado con piezas (sin archivos externos), en unidades de su propia
// altura (1 = alto del arquero). Mira hacia +z, la cancha. Se mueve con unos
// pocos parámetros de pose que se suavizan cuadro a cuadro.

const COLORES = {
  camiseta: "#b8f21a",
  panel: "#1d2a14",
  short: 0x16181c,
  medias: 0xb8f21a,
  piel: 0xc98e5f,
  pelo: 0x23160d,
  guante: 0xf4f6f2,
  guanteDorso: 0x9fe010,
  palma: 0xe9e9e4,
  correa: 0x111316,
  botin: 0x121212,
  suela: 0xb8f21a,
};

// Dónde van las manos (espacio del cuerpo: pies en y = 0, mira hacia +z).
const manos = (x, y, z) => ({ ix: -x, iy: y, iz: z, dx: x, dy: y, dz: z });
const MANOS = {
  listo: manos(0.2, 0.6, 0.16), // a la altura de la cintura, adelante, palmas a la pelota
  arriba: manos(0.075, 1.22, 0.03), // brazos estirados sobre la cabeza
  pecho: manos(0.05, 0.72, 0.2), // retiene contra el pecho
  suelo: manos(0.08, 0.26, 0.3), // recoge una pelota baja
  salto: manos(0.07, 1.18, 0.12),
};
const mezclar = (a, b, k) => {
  const r = {};
  for (const c in a) r[c] = a[c] + (b[c] - a[c]) * k;
  return r;
};

const REPOSO = {
  cx: 0,
  cy: CUERPO.centro - 0.06,
  giro: 0,
  agachado: 1,
  piernas: 0,
  inclinacion: 0.28,
  empuje: 0,
  lado: 1,
  torsion: 0,
  ...MANOS.listo,
};

// Brazo: del hombro al codo y del codo al centro de la palma.
const BRAZO = 0.165;
const ANTEBRAZO = 0.145 + 0.07;
const ABAJO = new THREE.Vector3(0, -1, 0);

// Camiseta: color, paneles laterales oscuros, cuello y el número 1 en la espalda.
// La textura se envuelve alrededor del torso: x = 0 es el frente, x = 256 la espalda.
function texturaCamiseta() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = COLORES.camiseta;
  ctx.fillRect(0, 0, 512, 256);
  // Rayado sutil de la tela.
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = "#000";
  for (let x = -256; x < 512; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x, 256);
    ctx.lineTo(x + 7, 256);
    ctx.lineTo(x + 263, 0);
    ctx.lineTo(x + 256, 0);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = COLORES.panel;
  for (const x of [128, 384]) ctx.fillRect(x - 22, 0, 44, 256);
  ctx.fillRect(0, 0, 512, 16); // cintura
  ctx.fillRect(0, 236, 512, 20); // cuello
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "900 140px Arial Black, Arial, sans-serif";
  ctx.lineWidth = 8;
  ctx.strokeStyle = COLORES.panel;
  ctx.strokeText("1", 256, 120);
  ctx.fillText("1", 256, 120);
  ctx.font = "900 34px Arial Black, Arial, sans-serif";
  ctx.fillText("1", 470, 175);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const material = (color, rugosidad = 0.7, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: rugosidad, ...extra });

function pieza(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// Cilindro con un extremo más fino que el otro, colgando hacia -y desde el origen.
function segmento(largo, rArriba, rAbajo, mat) {
  const g = new THREE.CylinderGeometry(rArriba, rAbajo, largo, 16, 1);
  g.translate(0, -largo / 2, 0);
  return pieza(g, mat);
}

const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const suave = (k) => k * k * (3 - 2 * k);

export class Keeper {
  constructor(altura) {
    this.altura = altura;
    this.root = new THREE.Group();
    this.root.scale.setScalar(altura);
    this.pivot = new THREE.Group();
    const cuerpo = new THREE.Group();
    cuerpo.position.y = -CUERPO.centro;
    this.pivot.add(cuerpo);
    this.root.add(this.pivot);

    const m = {
      camiseta: material(0xffffff, 0.8, { map: texturaCamiseta() }),
      manga: material(COLORES.camiseta, 0.8),
      panel: material(COLORES.panel, 0.8),
      short: material(COLORES.short, 0.75),
      medias: material(COLORES.medias, 0.85),
      piel: material(COLORES.piel, 0.55),
      pelo: material(COLORES.pelo, 0.95),
      guante: material(COLORES.guante, 0.5),
      dorso: material(COLORES.guanteDorso, 0.5),
      palma: material(COLORES.palma, 0.6),
      correa: material(COLORES.correa, 0.6),
      botin: material(COLORES.botin, 0.35),
      suela: material(COLORES.suela, 0.5),
      blanco: material(0xffffff, 0.3),
      negro: material(0x111111, 0.3),
    };

    // ---- Cadera y piernas ----
    const cadera = new THREE.Group();
    cadera.position.y = 0.5;
    cuerpo.add(cadera);
    const short = pieza(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.07, -0.07),
          new THREE.Vector2(0.092, -0.04),
          new THREE.Vector2(0.095, 0.0),
          new THREE.Vector2(0.088, 0.05),
          new THREE.Vector2(0.0, 0.05),
        ],
        24,
      ),
      m.short,
    );
    short.scale.set(1.05, 1, 0.75);
    cadera.add(short);

    this.piernas = [-1, 1].map((lado) => {
      const muslo = new THREE.Group();
      muslo.position.set(lado * 0.058, -0.02, 0);
      const pierna = segmento(0.23, 0.052, 0.04, m.piel);
      const botamanga = segmento(0.1, 0.06, 0.055, m.short);
      botamanga.position.y = 0.01;
      muslo.add(pierna, botamanga);
      const rodilla = new THREE.Group();
      rodilla.position.y = -0.23;
      rodilla.add(pieza(new THREE.SphereGeometry(0.041, 14, 10), m.piel));
      const canilla = segmento(0.2, 0.041, 0.029, m.medias);
      const franja = segmento(0.025, 0.043, 0.042, m.panel);
      franja.position.y = -0.03;
      rodilla.add(canilla, franja);
      const tobillo = new THREE.Group();
      tobillo.position.y = -0.205;
      const botin = pieza(new THREE.CapsuleGeometry(0.032, 0.075, 6, 12), m.botin, 0, -0.012, 0.03);
      botin.rotation.x = Math.PI / 2;
      botin.scale.set(1, 1, 0.8);
      const suela = pieza(new THREE.BoxGeometry(0.06, 0.012, 0.14), m.suela, 0, -0.04, 0.03);
      tobillo.add(botin, suela);
      rodilla.add(tobillo);
      muslo.add(rodilla);
      cadera.add(muslo);
      return { lado, muslo, rodilla, tobillo };
    });

    // ---- Torso ----
    this.torso = new THREE.Group();
    this.torso.position.y = 0.52;
    cuerpo.add(this.torso);
    const perfil = [
      [0.082, -0.02],
      [0.088, 0.04],
      [0.098, 0.1],
      [0.112, 0.17],
      [0.12, 0.23],
      [0.112, 0.28],
      [0.08, 0.305],
      [0.034, 0.32],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const pecho = pieza(new THREE.LatheGeometry(perfil, 32), m.camiseta);
    pecho.scale.set(1.12, 1, 0.68);
    this.torso.add(pecho);

    // Cuello y cabeza.
    this.cabeza = new THREE.Group();
    this.cabeza.position.y = 0.33;
    this.torso.add(this.cabeza);
    this.cabeza.add(pieza(new THREE.CylinderGeometry(0.03, 0.034, 0.06, 12), m.piel, 0, 0.0, 0));
    const craneo = pieza(new THREE.SphereGeometry(0.062, 24, 18), m.piel, 0, 0.085, 0);
    craneo.scale.set(0.9, 1.08, 1);
    const mandibula = pieza(new THREE.SphereGeometry(0.048, 18, 12), m.piel, 0, 0.05, 0.016);
    mandibula.scale.set(0.95, 0.85, 1);
    const pelo = pieza(new THREE.SphereGeometry(0.066, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), m.pelo, 0, 0.092, -0.006);
    pelo.scale.set(0.93, 1.08, 1.03);
    pelo.rotation.x = -0.35;
    const nariz = pieza(new THREE.ConeGeometry(0.011, 0.028, 8), m.piel, 0, 0.078, 0.064);
    nariz.rotation.x = Math.PI / 2;
    this.cabeza.add(craneo, mandibula, pelo, nariz);
    for (const lado of [-1, 1]) {
      const oreja = pieza(new THREE.SphereGeometry(0.014, 10, 8), m.piel, lado * 0.056, 0.083, -0.004);
      oreja.scale.set(0.45, 1.1, 0.8);
      const ojo = pieza(new THREE.SphereGeometry(0.0085, 10, 8), m.blanco, lado * 0.021, 0.093, 0.052);
      const pupila = pieza(new THREE.SphereGeometry(0.0048, 8, 6), m.negro, lado * 0.021, 0.093, 0.0595);
      const ceja = pieza(new THREE.BoxGeometry(0.022, 0.004, 0.006), m.pelo, lado * 0.022, 0.106, 0.056);
      ceja.rotation.z = lado * -0.12;
      this.cabeza.add(oreja, ojo, pupila, ceja);
    }
    this.cabeza.add(pieza(new THREE.BoxGeometry(0.022, 0.003, 0.004), material(0x7a3b2e, 0.6), 0, 0.054, 0.061));

    // ---- Brazos con guantes ----
    this.brazos = [-1, 1].map((lado) => {
      const hombro = new THREE.Group();
      hombro.position.set(lado * 0.128, 0.262, 0);
      hombro.add(pieza(new THREE.SphereGeometry(0.045, 16, 12), m.manga));
      hombro.add(segmento(0.165, 0.04, 0.033, m.manga));
      const codo = new THREE.Group();
      codo.position.y = -0.165;
      codo.add(pieza(new THREE.SphereGeometry(0.036, 12, 10), m.panel));
      codo.add(segmento(0.145, 0.033, 0.026, m.manga));
      const muneca = new THREE.Group();
      muneca.position.y = -0.145;
      const guante = new THREE.Group();
      const correa = segmento(0.03, 0.034, 0.034, m.correa);
      const palma = pieza(new THREE.CapsuleGeometry(0.034, 0.045, 6, 12), m.guante, 0, -0.06, 0);
      palma.scale.set(1.18, 1, 0.58);
      const dorso = pieza(new THREE.CapsuleGeometry(0.03, 0.04, 6, 10), m.dorso, 0, -0.06, -0.008);
      dorso.scale.set(1.15, 1, 0.45);
      const dedos = pieza(new THREE.CapsuleGeometry(0.03, 0.045, 6, 12), m.guante, 0, -0.112, 0.004);
      dedos.scale.set(1.25, 1, 0.5);
      const pulgar = pieza(new THREE.CapsuleGeometry(0.014, 0.036, 4, 8), m.guante, -lado * 0.036, -0.062, 0.014);
      pulgar.rotation.z = -lado * 0.55;
      const palmaInterior = pieza(new THREE.BoxGeometry(0.05, 0.07, 0.004), m.palma, 0, -0.08, 0.018);
      guante.add(correa, palma, dorso, dedos, pulgar, palmaInterior);
      muneca.add(guante);
      codo.add(muneca);
      hombro.add(codo);
      this.torso.add(hombro);
      return { lado, hombro, codo, muneca, guante: dedos };
    });

    this.actual = { ...REPOSO };
    this.mirada = null;
    this.reset(0);
  }

  // Vuelve a la posición de espera.
  reset(t) {
    this.modo = "espera";
    this.plan = null;
    this.desdeReset = t;
    this.seguirX = 0;
  }

  // Antes del remate se acomoda frente a la pelota (x en metros).
  seguir(x) {
    this.seguirX = x / this.altura;
  }

  // Hacia dónde mira (punto en coordenadas del arco, metros) o null.
  mirar(p) {
    this.mirada = p ? { x: p.x / this.altura, y: p.y / this.altura, z: p.z / this.altura } : null;
  }

  // plan: {tSalida, tLlegada, manos: {x, y} en metros, tipo, ataja}
  dive(plan) {
    const desde = this.plan?.desde ?? this.actual.cx;
    this.modo = "remate";
    this.plan = { ...plan, desde, manos: { x: plan.manos.x / this.altura, y: plan.manos.y / this.altura } };
  }

  // Posición de los guantes en el mundo (para la pelota atajada o el rebote).
  handsWorld(destino = new THREE.Vector3()) {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    this.brazos[0].guante.getWorldPosition(a);
    this.brazos[1].guante.getWorldPosition(b);
    return destino.addVectors(a, b).multiplyScalar(0.5);
  }

  #objetivo(t) {
    if (this.modo === "espera") {
      // Atento: peso de un pie al otro, pequeños saltitos y alineado con la pelota.
      const balanceo = Math.sin(t * 2.2);
      return {
        ...REPOSO,
        cx: Math.max(-0.6, Math.min(0.6, this.seguirX * 0.35)) + balanceo * 0.025,
        cy: CUERPO.centro - 0.06 + Math.abs(Math.sin(t * 4.4)) * 0.012,
        giro: balanceo * 0.03,
        torsion: balanceo * 0.04,
      };
    }

    const { tSalida, tLlegada, manos: objetivo, tipo, desde, ataja } = this.plan;
    const c0 = { x: desde, y: CUERPO.centro - 0.06 };
    if (t < tSalida) return { ...REPOSO, cx: desde, cy: c0.y - 0.02, agachado: 1.15 };
    const duracion = Math.max(0.1, tLlegada - tSalida);
    const p = clamp01((t - tSalida) / duracion);
    const despues = clamp01((t - tLlegada) / 0.5);
    const e = 1 - (1 - p) * (1 - p);
    const dx = objetivo.x - c0.x;
    const dy = objetivo.y - CUERPO.centro;

    if (tipo === "estirada") {
      const dist = Math.hypot(dx, dy) || 1;
      const ux = dx / dist;
      const uy = dy / dist;
      const lado = Math.sign(dx) || 1;
      const giroFinal = Math.max(-1.75, Math.min(1.75, Math.atan2(ux, uy)));
      const centro = {
        x: objetivo.x - ux * CUERPO.alcance,
        y: Math.max(0.13, objetivo.y - uy * CUERPO.alcance),
      };
      // 0-20 %: paso de impulso hacia el lado; después, el vuelo.
      const carga = clamp01(p / 0.2);
      const vuelo = clamp01((p - 0.2) / 0.8);
      const ev = 1 - (1 - vuelo) * (1 - vuelo);
      const xVuelo = lerp(c0.x + lado * 0.07 * carga, centro.x, ev);
      const yVuelo = lerp(c0.y - 0.05 * carga, centro.y, ev) + Math.sin(Math.PI * vuelo) * 0.07;
      // Al caer apoya el costado en el piso y rebota un poco.
      const caida = suave(despues);
      const rebote = Math.sin(Math.PI * clamp01((t - tLlegada - 0.28) / 0.22)) * 0.025;
      const acostado = Math.abs(giroFinal) > 0.5;
      // Brazos estirados hacia la pelota; si la retiene, después la trae al pecho.
      let m = mezclar(MANOS.listo, MANOS.arriba, clamp01(p * 1.8));
      if (ataja) m = mezclar(m, MANOS.pecho, suave(clamp01((t - tLlegada) / 0.35)));
      return {
        cx: xVuelo + lado * 0.1 * caida,
        cy: lerp(yVuelo, 0.12 + rebote, acostado ? caida : 0),
        giro: lerp(giroFinal * ev, lado * Math.PI * 0.5, acostado ? caida : 0),
        agachado: lerp(1.1 * (1 - carga * 0.3), 0, ev),
        piernas: ev,
        inclinacion: lerp(0.28, -0.05, ev),
        empuje: ev,
        lado,
        torsion: lado * 0.2 * ev,
        ...m,
      };
    }
    if (tipo === "salto") {
      const cy = Math.max(CUERPO.centro, objetivo.y - CUERPO.alcance);
      const arriba = lerp(c0.y - 0.04 * clamp01(p / 0.2), cy, e);
      let m = mezclar(MANOS.listo, MANOS.salto, clamp01(p * 2));
      m = mezclar(m, ataja ? MANOS.pecho : MANOS.listo, suave(despues));
      return {
        ...REPOSO,
        cx: lerp(c0.x, objetivo.x * 0.6, e),
        cy: lerp(arriba, CUERPO.centro - 0.06, suave(despues)),
        giro: Math.atan2(objetivo.x * 0.4, CUERPO.alcance) * e * (1 - despues),
        agachado: lerp(1 - e, 1, despues),
        piernas: 0.15 * e,
        inclinacion: lerp(0.28, 0.05, e),
        ...m,
      };
    }
    if (tipo === "abajo") {
      let m = mezclar(MANOS.listo, MANOS.suelo, e);
      if (ataja) m = mezclar(m, MANOS.pecho, suave(despues));
      return {
        ...REPOSO,
        cx: lerp(c0.x, objetivo.x, e),
        cy: lerp(c0.y, 0.36, e),
        agachado: 1.25,
        piernas: 0.25 * e,
        inclinacion: lerp(0.28, 0.7, e) - 0.4 * suave(despues),
        ...m,
      };
    }
    // Al cuerpo: brazos al pecho.
    return {
      ...REPOSO,
      cx: lerp(c0.x, objetivo.x * 0.7, e),
      cy: c0.y,
      inclinacion: lerp(0.28, 0.12, e),
      ...mezclar(MANOS.listo, MANOS.pecho, e),
    };
  }

  // Lleva la mano al punto `objetivo` (espacio del cuerpo) doblando el codo.
  #brazo({ lado, hombro, codo, muneca }, objetivo) {
    const v = this._ik ??= {
      inv: new THREE.Matrix4(),
      t: new THREE.Vector3(),
      s: new THREE.Vector3(),
      u: new THREE.Vector3(),
      polo: new THREE.Vector3(),
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      q: new THREE.Quaternion(),
    };
    v.t.copy(objetivo).applyMatrix4(v.inv.copy(this.torso.matrix).invert());
    v.s.copy(hombro.position);
    v.u.subVectors(v.t, v.s);
    const d = Math.min(Math.max(v.u.length(), 0.08), BRAZO + ANTEBRAZO - 1e-3);
    v.u.normalize();
    const cosA = (BRAZO * BRAZO + d * d - ANTEBRAZO * ANTEBRAZO) / (2 * BRAZO * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    // Los codos apuntan hacia afuera y un poco abajo.
    v.polo.set(lado * 0.8, -0.5, -0.35).normalize();
    v.polo.addScaledVector(v.u, -v.polo.dot(v.u));
    if (v.polo.lengthSq() < 1e-6) v.polo.set(lado, 0, 0);
    v.polo.normalize();
    v.a.copy(v.u).multiplyScalar(cosA).addScaledVector(v.polo, sinA);
    hombro.quaternion.setFromUnitVectors(ABAJO, v.a);
    // Antebrazo: del codo a la mano, en el espacio del hombro.
    v.b.copy(v.s).addScaledVector(v.u, d).sub(v.s.addScaledVector(v.a, BRAZO)).normalize();
    v.b.applyQuaternion(v.q.copy(hombro.quaternion).invert());
    codo.quaternion.setFromUnitVectors(ABAJO, v.b);
    muneca.rotation.set(0.2, 0, 0);
  }

  update(t, dt) {
    const objetivo = this.#objetivo(t);
    const rapidez = this.modo === "remate" ? 28 : 7;
    const k = 1 - Math.exp(-rapidez * Math.min(dt, 0.1));
    for (const clave in objetivo) this.actual[clave] = lerp(this.actual[clave], objetivo[clave], clave === "lado" ? 1 : k);
    const a = this.actual;

    this.pivot.position.set(a.cx, a.cy, 0);
    this.pivot.rotation.z = -a.giro;
    this.torso.rotation.set(a.inclinacion, a.torsion, 0);

    this.torso.updateMatrix();
    for (const brazo of this.brazos) {
      const i = brazo.lado < 0;
      this.#brazo(brazo, new THREE.Vector3(i ? a.ix : a.dx, i ? a.iy : a.dy, i ? a.iz : a.dz));
    }
    for (const { lado, muslo, rodilla, tobillo } of this.piernas) {
      // En la estirada la pierna del lado del salto empuja estirada y la otra
      // queda flexionada atrás.
      const cerca = lado === a.lado ? 1 : 0;
      const empuje = a.empuje;
      muslo.rotation.set(
        -0.48 * a.agachado - empuje * (cerca ? 0.1 : 0.55),
        0,
        lado * (0.06 + 0.1 * a.piernas) + empuje * a.lado * (cerca ? 0.25 : -0.05),
      );
      rodilla.rotation.x = 0.95 * a.agachado + empuje * (cerca ? 0.1 : 1.2);
      tobillo.rotation.x = -0.45 * a.agachado + empuje * 0.5;
    }

    // La cabeza sigue a la pelota.
    let yaw = 0;
    let pitch = 0.05;
    if (this.mirada) {
      const dx = this.mirada.x - a.cx;
      const dy = this.mirada.y - (a.cy + 0.35);
      const dz = this.mirada.z;
      yaw = Math.max(-0.9, Math.min(0.9, Math.atan2(dx, Math.max(0.2, dz)))) - a.torsion;
      pitch = Math.max(-0.5, Math.min(0.5, -Math.atan2(dy, Math.hypot(dx, dz)))) - a.inclinacion * 0.7;
    }
    this.cabeza.rotation.y = lerp(this.cabeza.rotation.y, yaw, k);
    this.cabeza.rotation.x = lerp(this.cabeza.rotation.x, pitch, k);
  }
}
