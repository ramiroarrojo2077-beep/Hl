import * as THREE from "three";
import { PixelReader } from "./pixels.js";
import { GRAVEDAD } from "./tracker.js";

// Demo sin AR: simula el "mundo real" (pasto, una pared y una pelota de verdad)
// y lo pasa por el mismo camino que la cámara del celular: la app reconoce la
// pelota en la imagen renderizada, igual que en AR. Sirve para probar el juego
// en la compu o en un celular sin ARCore.

function texturaPasto() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const franja = Math.floor(y / 64) % 2 ? 12 : 0;
      const n = Math.random() * 30;
      ctx.fillStyle = `rgb(${40 + n * 0.5},${115 + franja + n},${42 + n * 0.4})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(20, 20);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function texturaLadrillos() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#cfc6b8";
  ctx.fillRect(0, 0, 256, 128);
  for (let fila = 0; fila < 8; fila++) {
    for (let col = -1; col < 5; col++) {
      const x = col * 64 + (fila % 2) * 32;
      const tono = 150 + Math.random() * 40;
      ctx.fillStyle = `rgb(${tono + 30},${tono * 0.55},${tono * 0.42})`;
      ctx.fillRect(x + 2, fila * 16 + 2, 60, 12);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Pelota clásica: blanca con gajos negros.
function texturaPelota() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f4f4f0";
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = "#16161a";
  const gajos = [
    [32, 20], [96, 20], [160, 20], [224, 20],
    [0, 64], [64, 64], [128, 64], [192, 64], [256, 64],
    [32, 108], [96, 108], [160, 108], [224, 108],
  ];
  for (const [x, y] of gajos) {
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(x + Math.cos(a) * 13, y + Math.sin(a) * 11);
    }
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const CASA = new THREE.Vector3(0.6, 1.35, 1.5);
const MIRA = new THREE.Vector3(0, 0.2, -5);

export class DemoStage {
  constructor(renderer, canvas) {
    this.renderer = renderer;
    this.canvas = canvas;
    this.reader = new PixelReader(renderer);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.05, 200);
    this.camera.position.copy(CASA);
    this.camera.lookAt(MIRA);
    this.desde = null;

    const mundo = new THREE.Scene();
    mundo.background = new THREE.Color(0x9fc9ee);
    mundo.add(new THREE.HemisphereLight(0xffffff, 0x4a6b3a, 2.2));
    const sol = new THREE.DirectionalLight(0xffffff, 1.6);
    sol.position.set(3, 8, 4);
    mundo.add(sol);
    const piso = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ map: texturaPasto(), roughness: 1 }),
    );
    piso.rotation.x = -Math.PI / 2;
    mundo.add(piso);
    this.piso = piso;

    const ladrillos = texturaLadrillos();
    ladrillos.repeat.set(6, 1.5);
    this.pared = new THREE.Mesh(
      new THREE.BoxGeometry(24, 3, 0.3),
      new THREE.MeshStandardMaterial({ map: ladrillos, roughness: 0.9 }),
    );
    this.pared.position.set(0, 1.5, -9);
    mundo.add(this.pared);

    this.radio = 0.11;
    this.pelota = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 20),
      new THREE.MeshStandardMaterial({ map: texturaPelota(), roughness: 0.45 }),
    );
    this.pelota.visible = false;
    mundo.add(this.pelota);
    this.mundo = mundo;
    this.vel = new THREE.Vector3();
    this.enJuego = false;
    this.ultimo = null;
    this.raycaster = new THREE.Raycaster();
    // ?paso=0.0333 hace avanzar el tiempo simulado un paso fijo por cuadro (para pruebas en equipos lentos).
    this.pasoFijo = Number(new URLSearchParams(location.search).get("paso")) || 0;
    this.tSim = 0;
  }

  setBallRadius(r) {
    this.radio = r;
    this.pelota.scale.setScalar(r);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Punto del piso bajo un toque (coordenadas de pantalla) o null.
  floorAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.piso)[0];
    return hit ? hit.point : null;
  }

  // Rayo de cámara bajo un toque.
  rayAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray;
  }

  // El "jugador" deja la pelota frente al arco y pone la pared detrás.
  setup(arco, origen, normal) {
    const distancia = Math.min(7, Math.max(2.5, origen.distanceTo(CASA) * 0.55));
    this.puntoPenal = origen.clone().addScaledVector(normal, distancia).setY(this.radio);
    this.pared.position.copy(origen).addScaledVector(normal, -(arco.fondoAbajo + 0.8)).setY(1.5);
    this.pared.rotation.y = Math.atan2(normal.x, normal.z);
    this.reponerPelota();
    // Trípode: atrás y a un costado del punto penal, mirando al arco.
    this.tripode = this.puntoPenal.clone().addScaledVector(normal, 2.2).add(new THREE.Vector3(0, 1.25, 0));
    this.tripode.addScaledVector(new THREE.Vector3(normal.z, 0, -normal.x), 0.5);
    this.mira = origen.clone().setY(0.7);
  }

  reponerPelota() {
    this.pelota.visible = true;
    this.pelota.position.copy(this.puntoPenal);
    this.vel.set(0, 0, 0);
    this.enJuego = false;
  }

  // Animación de cámara: hacia la pelota para escanearla o al tripode para jugar.
  moveCamera(destino, mira, segundos = 1.2) {
    this.desde = {
      pos: this.camera.position.clone(),
      quat: this.camera.quaternion.clone(),
      t0: null,
      segundos,
    };
    const tmp = new THREE.PerspectiveCamera();
    tmp.position.copy(destino);
    tmp.lookAt(mira);
    this.hacia = { pos: destino.clone(), quat: tmp.quaternion.clone() };
  }

  // Se acerca a la pelota hasta que llena el círculo de escaneo (radio = 22 % del lado corto).
  lookAtBall(fraccion = 0.22) {
    const p = this.pelota.position;
    const desde = new THREE.Vector3().subVectors(this.camera.position, p).setY(0).normalize();
    const mitadVertical = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const tanCorto = Math.tan(mitadVertical) * Math.min(1, this.camera.aspect);
    const distancia = this.radio / (2 * fraccion * tanCorto * 1.05);
    const alto = distancia * 0.3;
    const horizontal = Math.sqrt(distancia * distancia - alto * alto);
    this.moveCamera(p.clone().addScaledVector(desde, horizontal).setY(p.y + alto), p);
  }

  // Para el escaneo completo: da la vuelta alrededor de la pelota (ángulo en
  // radianes, a la distancia en que llena el círculo).
  orbitarPelota(angulo, fraccion = 0.22) {
    const p = this.pelota.position;
    const mitadVertical = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const tanCorto = Math.tan(mitadVertical) * Math.min(1, this.camera.aspect);
    const distancia = this.radio / (2 * fraccion * tanCorto * 1.05);
    const alto = distancia * 0.3;
    const horizontal = Math.sqrt(distancia * distancia - alto * alto);
    const pos = new THREE.Vector3(p.x + horizontal * Math.sin(angulo), p.y + alto, p.z + horizontal * Math.cos(angulo));
    this.camera.position.copy(pos);
    this.camera.lookAt(p);
    // (Corta cualquier movimiento de cámara en curso.)
    this.desde = null;
    this.hacia = null;
  }

  goToTripod() {
    this.moveCamera(this.tripode, this.mira);
  }

  // Patea hacia un punto del mundo con cierta velocidad (m/s).
  kick(objetivo, velocidad) {
    const p = this.pelota.position;
    const horizontal = new THREE.Vector3(objetivo.x - p.x, 0, objetivo.z - p.z);
    const dist = horizontal.length();
    const t = dist / velocidad;
    const vy = (objetivo.y - p.y + (GRAVEDAD / 2) * t * t) / t;
    this.vel.copy(horizontal.normalize().multiplyScalar(velocidad)).setY(vy);
    this.enJuego = true;
    this.tPatada = null;
  }

  #fisica(dt) {
    if (!this.enJuego) return;
    const p = this.pelota.position;
    const v = this.vel;
    v.y -= GRAVEDAD * dt;
    p.addScaledVector(v, dt);
    if (p.y < this.radio) {
      p.y = this.radio;
      v.y = Math.abs(v.y) > 0.8 ? -v.y * 0.55 : 0;
      v.x *= 0.85;
      v.z *= 0.85;
    }
    if (p.y <= this.radio + 1e-3) {
      v.x *= 1 - 0.6 * dt;
      v.z *= 1 - 0.6 * dt;
    }
    // Rebote contra la pared.
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(this.pared.quaternion);
    const d = new THREE.Vector3().subVectors(p, this.pared.position).dot(n);
    if (d < 0.15 + this.radio && v.dot(n) < 0) v.addScaledVector(n, -1.6 * v.dot(n));
    this.pelota.rotation.x += v.z * dt * 3;
    this.pelota.rotation.z -= v.x * dt * 3;
  }

  frame(time, _xrFrame, { pixels }) {
    const t = this.pasoFijo ? (this.tSim += this.pasoFijo) : time / 1000;
    const dt = this.ultimo === null ? 0 : Math.min(0.05, t - this.ultimo);
    this.ultimo = t;
    this.#fisica(dt);
    // Si nadie la repuso (remate no detectado), la pelota vuelve sola al punto penal.
    if (this.enJuego) {
      this.tPatada ??= t;
      if (t - this.tPatada > 5) this.reponerPelota();
    }

    if (this.desde) {
      this.desde.t0 ??= t;
      const k = Math.min(1, (t - this.desde.t0) / this.desde.segundos);
      const e = k * k * (3 - 2 * k);
      this.camera.position.lerpVectors(this.desde.pos, this.hacia.pos, e);
      this.camera.quaternion.slerpQuaternions(this.desde.quat, this.hacia.quat, e);
      if (k >= 1) this.desde = null;
    }
    this.camera.updateMatrixWorld(true);

    let image = null;
    if (pixels) {
      const { width, height } = PixelReader.size(this.canvas.clientWidth, this.canvas.clientHeight);
      image = { data: this.reader.read({ scene: this.mundo, camera: this.camera }, width, height), width, height };
    }
    const fuente = { scene: this.mundo, camera: this.camera };
    return {
      t,
      camMatrix: this.camera.matrixWorld,
      projMatrix: this.camera.projectionMatrix,
      image,
      region: image
        ? {
            factor: (this.canvas.clientWidth * this.renderer.getPixelRatio()) / image.width,
            leer: (reg, w, h) => this.reader.readRegion(fuente, reg, w, h),
          }
        : null,
      hit: null,
      anchor: null,
      cameraAvailable: true,
      grabar: (recorder, escena) =>
        recorder.capture({
          escenaFondo: this.mundo,
          escena,
          camara: this.camera,
          ancho: this.canvas.clientWidth,
          alto: this.canvas.clientHeight,
        }),
    };
  }

  render(scene, camera) {
    const r = this.renderer;
    r.autoClear = false;
    r.clear();
    r.render(this.mundo, camera);
    r.clearDepth();
    r.render(scene, camera);
    r.autoClear = true;
  }
}
