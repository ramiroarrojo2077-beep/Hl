import * as THREE from "three";
import { BallDetector, matrizK } from "./detector.js";
import { ShotTracker, locateBall } from "./tracker.js";
import { ARCOS, DIFICULTADES, PELOTAS, alturaArquero, judgeShot } from "./keeper-ai.js";
import { Goal } from "./goal.js";
import { Keeper } from "./keeper.js";
import { Sounds } from "./sounds.js";
import { ShotRecorder, recordingSupported } from "./recorder.js";
import { XRStage, xrSupported } from "./xr-stage.js";
import { DemoStage } from "./demo-stage.js";

// Radio del círculo de escaneo como fracción del lado corto de la pantalla.
// Tiene que coincidir con --radio-mira en index.html.
const RADIO_MIRA = 0.22;

const $ = (id) => document.getElementById(id);
const ui = {
  inicio: $("inicio"),
  hud: $("hud"),
  compat: $("compat"),
  btnAR: $("btn-ar"),
  btnDemo: $("btn-demo"),
  selArco: $("sel-arco"),
  selPelota: $("sel-pelota"),
  selDificultad: $("sel-dificultad"),
  modos: document.querySelectorAll('input[name="modo"]'),
  marcador: $("marcador"),
  paso: $("paso"),
  pasoTitulo: $("paso-titulo"),
  pasoTexto: $("paso-texto"),
  btnAccion: $("btn-accion"),
  btnSecundario: $("btn-secundario"),
  mira: $("mira"),
  banner: $("banner"),
  bannerTexto: $("banner-texto"),
  bannerSub: $("banner-sub"),
  estadoPelota: $("estado-pelota"),
  estadoCelu: $("estado-celu"),
  rec: $("rec"),
  btnReubicar: $("btn-reubicar"),
  btnReescanear: $("btn-reescanear"),
  btnDiag: $("btn-diag"),
  btnVideos: $("btn-videos"),
  btnSalir: $("btn-salir"),
  diag: $("diag"),
  diagCanvas: $("diag-canvas"),
  diagTexto: $("diag-texto"),
  videos: $("videos"),
  listaVideos: $("lista-videos"),
  btnCerrarVideos: $("btn-cerrar-videos"),
  clipsInicio: $("clips-inicio"),
  listaClipsInicio: $("lista-clips-inicio"),
};

// ---------- Ajustes ----------

function llenar(select, opciones, elegido) {
  for (const [clave, { label }] of Object.entries(opciones)) {
    const o = new Option(label, clave, false, clave === elegido);
    select.add(o);
  }
}

let ajustes = { arco: "f5", pelota: "5", dificultad: "normal", modo: "mano" };
try {
  ajustes = { ...ajustes, ...JSON.parse(localStorage.getItem("arquero-ajustes") ?? "{}") };
} catch {}
llenar(ui.selArco, ARCOS, ajustes.arco);
llenar(ui.selPelota, PELOTAS, ajustes.pelota);
llenar(ui.selDificultad, DIFICULTADES, ajustes.dificultad);
for (const r of ui.modos) r.checked = r.value === ajustes.modo;

function leerAjustes() {
  ajustes = {
    arco: ui.selArco.value,
    pelota: ui.selPelota.value,
    dificultad: ui.selDificultad.value,
    modo: [...ui.modos].find((r) => r.checked)?.value ?? "mano",
  };
  try {
    localStorage.setItem("arquero-ajustes", JSON.stringify(ajustes));
  } catch {}
}

// ---------- Escena ----------

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.xr.enabled = true;
renderer.domElement.id = "escena";
// three le pone display: block; sólo se muestra en la demo (en RA dibuja el casco/visor).
renderer.domElement.style.display = "none";
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 2.2));
const camaraVirtual = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 100);

const arcoGrupo = new THREE.Group();
arcoGrupo.visible = false;
scene.add(arcoGrupo);

const sol = new THREE.DirectionalLight(0xffffff, 1.4);
sol.castShadow = true;
sol.shadow.mapSize.set(1024, 1024);
sol.shadow.bias = -0.0005;
arcoGrupo.add(sol, sol.target);

const reticula = new THREE.Mesh(
  new THREE.RingGeometry(0.12, 0.16, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xc6ff1a }),
);
reticula.visible = false;
scene.add(reticula);

// Aro que marca la pelota real cuando la app la reconoce.
const marcaPelota = new THREE.Mesh(
  new THREE.TorusGeometry(1.45, 0.12, 8, 40),
  new THREE.MeshBasicMaterial({ color: 0xc6ff1a, transparent: true, opacity: 0.85, depthTest: false }),
);
marcaPelota.renderOrder = 10;
marcaPelota.visible = false;
scene.add(marcaPelota);

// Pelota virtual que rebota en los guantes cuando el arquero ataja.
const pelotaRebote = new THREE.Mesh(
  new THREE.SphereGeometry(1, 20, 14),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, transparent: true }),
);
pelotaRebote.visible = false;
pelotaRebote.castShadow = true;
arcoGrupo.add(pelotaRebote);
const rebote = { activo: false, vel: new THREE.Vector3(), t0: 0 };

let arco = null;
let arquero = null;

function armarArco() {
  if (arco) arcoGrupo.remove(arco.group);
  if (arquero) arcoGrupo.remove(arquero.root);
  const dims = ARCOS[ajustes.arco];
  arco = new Goal(dims);
  arquero = new Keeper(alturaArquero(dims.alto));
  arcoGrupo.add(arco.group, arquero.root);
  const w = dims.ancho;
  sol.position.set(w * 0.25, 6, 3.5);
  sol.target.position.set(0, 0, 0.3);
  const c = sol.shadow.camera;
  c.left = c.bottom = -(w * 0.75 + 1);
  c.right = c.top = w * 0.75 + 1;
  c.near = 0.5;
  c.far = 20;
  c.updateProjectionMatrix();
  const r = PELOTAS[ajustes.pelota].radio;
  marcaPelota.scale.setScalar(r);
  pelotaRebote.scale.setScalar(r);
}

// ---------- Estado del juego ----------

const sonidos = new Sounds();
const detector = new BallDetector(64, 64);
let tracker = null;
let recorder = null;
let stage = null;
let modoStage = null; // 'ar' | 'demo'
let xrStage = null;
let demo = null;
let fase = "inicio"; // inicio → ubicar → escanear → jugar
let pedidoEscaneo = false;
let tiro = null;
let ultimaDeteccion = null;
let ultimaPosicion = null;
let pelotaVistaEn = -Infinity;
let ultimoT = null;
let reiniciarEn = null;
let camaraAnterior = null;
let quietoDesde = null;
let mostrarDiag = false;
let marcador = { goles: 0, atajadas: 0, afuera: 0 };
let puntoDemo = new THREE.Vector3(0, 0, -6);
// ?registro guarda lo que ve el detector cuadro a cuadro (para depurar).
const registro = new URLSearchParams(location.search).has("registro") ? [] : null;

const tmp = {
  inv: new THREE.Matrix4(),
  proyInv: new THREE.Matrix4(),
  origen: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  v: new THREE.Vector3(),
  quat: new THREE.Quaternion(),
};

function textoMarcador() {
  return `Goles ${marcador.goles} · Atajadas ${marcador.atajadas}`;
}

function mostrarPaso(titulo, texto, accion = null, secundaria = null) {
  ui.pasoTitulo.textContent = titulo;
  ui.pasoTexto.textContent = texto;
  ui.btnAccion.hidden = !accion;
  if (accion) {
    ui.btnAccion.textContent = accion.texto;
    ui.btnAccion.onclick = accion.fn;
    ui.btnAccion.disabled = Boolean(accion.deshabilitado);
  }
  ui.btnSecundario.hidden = !secundaria;
  if (secundaria) {
    ui.btnSecundario.textContent = secundaria.texto;
    ui.btnSecundario.onclick = secundaria.fn;
  }
}

function irA(nueva) {
  fase = nueva;
  ui.hud.dataset.fase = nueva;
  ui.mira.hidden = nueva !== "escanear";
  reticula.visible = false;
  marcaPelota.visible = false;
  if (nueva !== "jugar") {
    recorder?.stop();
    actualizarRec();
  }

  if (nueva === "ubicar") {
    arcoGrupo.visible = false;
    arco.setPreview(true);
    tracker.reset();
    arquero.reset(0);
    mostrarPaso(
      "1 · Ubicá el arco",
      modoStage === "ar"
        ? "Mové el celular despacio apuntando al piso hasta que aparezca el arco. Ponelo donde quieras (contra una pared es ideal)."
        : "Tocá el pasto para elegir dónde va el arco.",
      { texto: "Colocar arco aquí", fn: colocarArco, deshabilitado: modoStage === "ar" },
    );
  } else if (nueva === "escanear") {
    arcoGrupo.visible = true;
    arco.setPreview(false);
    mostrarPaso(
      "2 · Escaneá tu pelota",
      "Acercate a la pelota hasta que llene el círculo y tocá Escanear. Así la app aprende cómo es tu pelota.",
      { texto: "Escanear pelota", fn: () => (pedidoEscaneo = true) },
      { texto: "Reubicar arco", fn: () => irA("ubicar") },
    );
    if (modoStage === "demo") demo.lookAtBall(RADIO_MIRA);
  } else if (nueva === "jugar") {
    arcoGrupo.visible = true;
    tracker.reset();
    detector.hasPrev = false;
    const fijo = ajustes.modo === "fijo";
    let texto = fijo
      ? "Apoyá el celular quieto donde se vean el arco y la pelota. Cada tiro se graba solo con el arquero."
      : "Apuntá al arco con la pelota a la vista y pateá. El arquero va a tirarse hacia tu remate.";
    if (modoStage === "demo") texto = "Deslizá el dedo desde la pelota hacia el arco para patear, o tocá Patear al azar.";
    mostrarPaso("3 · ¡Pateá!", texto, modoStage === "demo" ? { texto: "Patear al azar", fn: patearAlAzar } : null);
    if (modoStage === "demo") demo.goToTripod();
    if (fijo && recorder) {
      recorder.start();
      actualizarRec();
    }
  }
}

function colocarArco() {
  sonidos.unlock();
  const punto = modoStage === "ar" ? reticula.position.clone() : puntoDemo.clone();
  orientarArco(punto);
  if (modoStage === "ar") xrStage.anchorAtHit();
  else demo.setup(arco, arcoGrupo.position.clone(), normalArco());
  irA(detector.trained ? "jugar" : "escanear");
}

// El arco mira hacia donde está el celular.
function orientarArco(punto) {
  const cam = tmp.v.setFromMatrixPosition(camaraActual());
  arcoGrupo.position.copy(punto);
  arcoGrupo.rotation.set(0, Math.atan2(cam.x - punto.x, cam.z - punto.z), 0);
  arcoGrupo.updateMatrixWorld(true);
}

function normalArco() {
  return new THREE.Vector3(0, 0, 1).applyQuaternion(arcoGrupo.quaternion);
}

let ultimaInfo = null;
const camaraActual = () => ultimaInfo?.camMatrix ?? camaraVirtual.matrixWorld;

// ---------- Escaneo ----------

function escanear(info) {
  const { data, width, height } = info.image;
  detector.resize(width, height);
  const res = detector.learn(data, width / 2, height / 2, RADIO_MIRA * Math.min(width, height));
  if (res.ok) {
    sonidos.whistle();
    irA("jugar");
    return;
  }
  const motivos = {
    "no-se-distingue": "No pude distinguir la pelota. Acercate más (que llene el círculo) y probá con buena luz.",
    "fondo-parecido": "El piso se parece mucho a la pelota. Probá escanearla sobre otro fondo.",
    "imagen-chica": "La imagen de la cámara es muy chica. Probá de nuevo.",
  };
  ui.pasoTexto.textContent = motivos[res.motivo] ?? "No salió. Probá de nuevo.";
}

// ---------- Seguimiento de la pelota ----------

// Rayo de la cámara que pasa por el píxel (x, y) de la imagen (y hacia arriba).
function rayo(info, x, y, w, h, destino) {
  destino.set((x / w) * 2 - 1, (y / h) * 2 - 1, 0.5).applyMatrix4(tmp.proyInv).normalize();
  return destino.transformDirection(info.camMatrix);
}

function seguirPelota(info) {
  const { data, width: w, height: h } = info.image;
  detector.resize(w, h);
  const e = info.camMatrix.elements;
  const camara = { K: matrizK(info.projMatrix.elements, w, h), R: [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]] };
  const near = ultimaDeteccion && info.t - ultimaDeteccion.t < 0.4 ? ultimaDeteccion : null;
  const det = detector.detect(data, { camera: camara, near });
  const t = info.t;
  let evento = null;

  if (det) {
    tmp.proyInv.copy(info.projMatrix).invert();
    const centro = rayo(info, det.x, det.y, w, h, new THREE.Vector3());
    const a = rayo(info, det.x - det.r, det.y, w, h, new THREE.Vector3());
    const b = rayo(info, det.x + det.r, det.y, w, h, new THREE.Vector3());
    const c = rayo(info, det.x, det.y - det.r, w, h, new THREE.Vector3());
    const d = rayo(info, det.x, det.y + det.r, w, h, new THREE.Vector3());
    const angular = (a.angleTo(b) + c.angleTo(d)) / 4;

    // Al sistema del arco.
    tmp.inv.copy(arcoGrupo.matrixWorld).invert();
    const origen = tmp.origen.setFromMatrixPosition(info.camMatrix).applyMatrix4(tmp.inv);
    const dir = tmp.dir.copy(centro).transformDirection(tmp.inv);
    const radio = PELOTAS[ajustes.pelota].radio;
    const p = locateBall(origen, dir, angular, radio);

    if (p.z > -1.5 && Math.hypot(p.x, p.z) < 40) {
      ultimaDeteccion = { ...det, t };
      ultimaPosicion = p;
      pelotaVistaEn = t;
      marcaPelota.position.set(p.x, p.y, p.z).applyMatrix4(arcoGrupo.matrixWorld);
      evento = tracker.add(t, {
        ...p,
        px: det.x,
        py: det.y,
        pr: det.r,
        // Rayo de la cámara en coordenadas del arco, para ajustar la trayectoria.
        o: { x: origen.x, y: origen.y, z: origen.z },
        d: { x: dir.x, y: dir.y, z: dir.z },
        ang: angular,
      });
    }
  }
  if (registro) {
    registro.push({ t: +t.toFixed(3), det: det && { x: +det.x.toFixed(1), y: +det.y.toFixed(1), r: +det.r.toFixed(1) }, p: det && ultimaPosicion && { x: +ultimaPosicion.x.toFixed(2), y: +ultimaPosicion.y.toFixed(2), z: +ultimaPosicion.z.toFixed(2), g: ultimaPosicion.onGround }, ev: evento?.type, pred: evento?.prediction && { x: +evento.prediction.x.toFixed(3), y: +evento.prediction.y.toFixed(3), aire: !evento.prediction.rolling }, st: tracker.state });
    if (registro.length > 600) registro.shift();
  }
  evento ??= tracker.tick(t);
  if (evento) manejarEvento(evento, t);

  const vista = t - pelotaVistaEn < 0.25;
  marcaPelota.visible = vista;
  marcaPelota.material.color.set(tracker.state === "flight" ? 0xffd400 : 0xc6ff1a);
  marcaPelota.quaternion.setFromRotationMatrix(info.camMatrix);
  ui.estadoPelota.textContent = vista ? "● Pelota detectada" : "○ Buscando la pelota…";
  ui.estadoPelota.classList.toggle("ok", vista);
  if (tracker.state === "idle" && vista && ultimaPosicion) arquero.seguir(ultimaPosicion.x);
  arquero.mirar(t - pelotaVistaEn < 0.6 ? ultimaPosicion : null);

  if (mostrarDiag) dibujarDiagnostico(info.image, det, ultimaPosicion);
}

function manejarEvento(ev, t) {
  const dims = ARCOS[ajustes.arco];
  if (ev.type === "kick") {
    tiro = { tKick: ev.t, suerte: Math.random() };
    recorder?.shotStarted();
    planificar(ev.prediction);
  } else if (ev.type === "update") {
    planificar(ev.prediction);
  } else if (ev.type === "cancel") {
    tiro = null;
    arquero.reset(t);
    recorder?.shotCancelled();
  } else if (ev.type === "cross" && tiro) {
    const juicio = planificar(ev.prediction);
    resultado(juicio, ev.prediction, dims, t);
  }
}

function planificar(pred) {
  if (!tiro || !Number.isFinite(pred.tCross)) return null;
  const juicio = judgeShot({
    x: pred.x,
    y: pred.y,
    tiempo: pred.tCross - tiro.tKick,
    arco: ARCOS[ajustes.arco],
    radio: PELOTAS[ajustes.pelota].radio,
    dificultad: ajustes.dificultad,
    suerte: tiro.suerte,
  });
  arquero.dive({
    tSalida: tiro.tKick + DIFICULTADES[ajustes.dificultad].reaccion,
    tLlegada: pred.tCross,
    manos: juicio.manos,
    tipo: juicio.tipo,
    ataja: juicio.resultado === "atajada",
  });
  tiro.juicio = juicio;
  return juicio;
}

const LEYENDAS = {
  atajada: { texto: "¡ATAJÓ!", color: "#c6ff1a" },
  gol: { texto: "¡GOOOL!", color: "#ffd400" },
  palo: { texto: "¡PALO!", color: "#ffffff" },
  afuera: { texto: "¡AFUERA!", color: "#ffffff" },
};

function resultado(juicio, pred, dims, t) {
  if (!juicio) return;
  const leyenda = { ...LEYENDAS[juicio.resultado] };
  let sub = "";
  if (juicio.resultado === "atajada") {
    marcador.atajadas++;
    sonidos.save();
    sub = juicio.margen > 0.3 ? "La vio venir" : "¡Qué atajada!";
    // Al cuerpo, abajo o en salto la retiene; en la estirada la desvía.
    pelotaRebote.position.set(juicio.manos.x, juicio.manos.y, 0.15);
    rebote.retenida = juicio.tipo !== "estirada";
    rebote.vel.set(-pred.vx * 0.15 + (Math.random() - 0.5), 2.5 + Math.random() * 1.5, 3 + Math.random() * 2);
    rebote.t0 = t;
    rebote.activo = true;
    pelotaRebote.visible = true;
  } else if (juicio.resultado === "gol") {
    marcador.goles++;
    sonidos.goal();
    arco.ripple(pred.x, pred.y, t);
    sub = juicio.margen > -0.15 ? "¡Por poco!" : "Imposible para el arquero";
  } else if (juicio.resultado === "palo") {
    marcador.afuera++;
    sonidos.miss();
    leyenda.texto = juicio.detalle === "travesaño" ? "¡TRAVESAÑO!" : "¡PALO!";
  } else {
    marcador.afuera++;
    sonidos.miss();
    sub = { arriba: "Por arriba", derecha: "Desviado a la derecha", izquierda: "Desviado a la izquierda" }[juicio.detalle];
  }
  if (navigator.vibrate) navigator.vibrate(juicio.resultado === "gol" ? [80, 60, 160] : 60);
  ui.bannerTexto.textContent = leyenda.texto;
  ui.bannerTexto.style.color = leyenda.color;
  ui.bannerSub.textContent = sub;
  ui.banner.hidden = false;
  ui.banner.classList.remove("entra");
  void ui.banner.offsetWidth;
  ui.banner.classList.add("entra");
  ui.marcador.textContent = textoMarcador();
  if (recorder) {
    recorder.marcador = textoMarcador();
    recorder.leyenda = leyenda;
    recorder.shotFinished(juicio.resultado);
  }
  reiniciarEn = t + 3.2;
}

function reiniciarTiro(t) {
  reiniciarEn = null;
  tiro = null;
  tracker.reset();
  arquero.reset(t);
  ui.banner.hidden = true;
  pelotaRebote.visible = false;
  rebote.activo = false;
  if (recorder) recorder.leyenda = null;
  if (modoStage === "demo") demo.reponerPelota();
}

// ---------- Diagnóstico ----------

let imagenDiag = null;
function dibujarDiagnostico(img, det, pos) {
  const { width: w, height: h, data } = img;
  const cv = ui.diagCanvas;
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
    imagenDiag = null;
  }
  const ctx = cv.getContext("2d");
  imagenDiag ??= ctx.createImageData(w, h);
  const out = imagenDiag.data;
  const mask = detector.closed;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = ((h - 1 - y) * w + x) * 4;
      const m = mask[y * w + x];
      out[o] = m ? 255 : data[i] * 0.6;
      out[o + 1] = m ? 0 : data[i + 1] * 0.6;
      out[o + 2] = m ? 200 : data[i + 2] * 0.6;
      out[o + 3] = 255;
    }
  }
  ctx.putImageData(imagenDiag, 0, 0);
  if (det) {
    ctx.strokeStyle = "#c6ff1a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(det.x, h - det.y, det.r + 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ui.diagTexto.textContent =
    `${w}×${h} · ` +
    (det ? `r ${det.r.toFixed(1)} px` : "sin pelota") +
    (pos ? ` · a ${Math.hypot(pos.x, pos.z).toFixed(1)} m del arco, ${pos.onGround ? "por el piso" : "en el aire"}` : "") +
    ` · ${tracker.state}`;
}

// ---------- Cuadro a cuadro ----------

let cuadro = 0;
function paso(info) {
  cuadro++;
  ultimaInfo = info;
  if (registro && info.image) window.__arquero.imagen = info.image;
  const t = info.t;
  const dt = ultimoT === null ? 0 : Math.min(0.1, Math.max(0, t - ultimoT));
  ultimoT = t;

  // ¿El celular está quieto? (para el modo fijo)
  if (camaraAnterior) {
    tmp.quat.setFromRotationMatrix(info.camMatrix);
    const giro = tmp.quat.angleTo(camaraAnterior.quat) / Math.max(dt, 1e-3);
    const mov = tmp.v.setFromMatrixPosition(info.camMatrix).distanceTo(camaraAnterior.pos) / Math.max(dt, 1e-3);
    const quieto = giro < 0.08 && mov < 0.05;
    if (!quieto) quietoDesde = null;
    else quietoDesde ??= t;
  }
  camaraAnterior = {
    quat: new THREE.Quaternion().setFromRotationMatrix(info.camMatrix),
    pos: new THREE.Vector3().setFromMatrixPosition(info.camMatrix),
  };
  const estable = quietoDesde !== null && t - quietoDesde > 0.5;
  ui.estadoCelu.textContent = estable ? "Celular quieto ✓" : "Celular en movimiento";
  ui.estadoCelu.classList.toggle("ok", estable);

  if (info.anchor && fase !== "ubicar") {
    arcoGrupo.position.copy(info.anchor);
    arcoGrupo.updateMatrixWorld(true);
  }

  if (fase === "ubicar") {
    const punto = modoStage === "ar" ? info.hit : puntoDemo;
    reticula.visible = Boolean(punto);
    arcoGrupo.visible = Boolean(punto);
    if (punto) {
      reticula.position.copy(punto);
      orientarArco(punto);
    }
    if (modoStage === "ar") ui.btnAccion.disabled = !punto;
    if (info.image && cuadro % 4 === 0) {
      detector.resize(info.image.width, info.image.height);
      detector.observeBackground(info.image.data);
    }
  } else if (fase === "escanear") {
    if (pedidoEscaneo && info.image) {
      pedidoEscaneo = false;
      escanear(info);
    } else if (info.image && cuadro % 4 === 0) {
      // Mientras tanto aprende los colores del lugar (sin mirar el círculo).
      const { data, width: w, height: h } = info.image;
      detector.resize(w, h);
      detector.observeBackground(data, { x: w / 2, y: h / 2, r: RADIO_MIRA * Math.min(w, h) });
    }
  } else if (fase === "jugar") {
    if (!info.cameraAvailable) {
      ui.estadoPelota.textContent = "Sin acceso a la cámara";
    } else if (info.image && detector.trained) {
      seguirPelota(info);
    }
    if (reiniciarEn !== null && t >= reiniciarEn) reiniciarTiro(t);
  }

  if (rebote.activo && rebote.retenida) {
    // La pelota queda en los guantes.
    arcoGrupo.worldToLocal(arquero.handsWorld(pelotaRebote.position));
    pelotaRebote.position.z += pelotaRebote.scale.x * 0.6;
    if (t - rebote.t0 > 2.6) {
      rebote.activo = false;
      pelotaRebote.visible = false;
    }
  } else if (rebote.activo) {
    const k = t - rebote.t0;
    rebote.vel.y -= 9.81 * dt;
    pelotaRebote.position.addScaledVector(rebote.vel, dt);
    if (pelotaRebote.position.y < pelotaRebote.scale.x) {
      pelotaRebote.position.y = pelotaRebote.scale.x;
      rebote.vel.y = Math.abs(rebote.vel.y) * 0.5;
    }
    pelotaRebote.material.opacity = Math.max(0, 1 - Math.max(0, k - 1.2) / 0.5);
    if (k > 1.7) {
      rebote.activo = false;
      pelotaRebote.visible = false;
    }
  }

  arquero?.update(t, dt);
  arco?.update(t);
}

renderer.setAnimationLoop((time, xrFrame) => {
  if (!stage) return;
  if (modoStage === "ar" && !xrFrame) return;
  const pixeles = fase === "ubicar" || fase === "escanear" || fase === "jugar";
  const grabar = Boolean(recorder?.grabando);
  const info = stage.frame(time, xrFrame, { pixels: pixeles, record: grabar });
  if (info) paso(info);
  stage.render(scene, modoStage === "demo" ? demo.camera : camaraVirtual);
  if (info && grabar) {
    // El aro de seguimiento no va en el video.
    const aro = marcaPelota.visible;
    marcaPelota.visible = false;
    info.grabar(recorder, scene);
    marcaPelota.visible = aro;
  }
});

// ---------- Videos ----------

function actualizarRec() {
  const grabando = Boolean(recorder?.grabando);
  ui.rec.hidden = !grabando;
  const n = recorder?.clips.length ?? 0;
  ui.btnVideos.hidden = n === 0;
  ui.btnVideos.textContent = `Videos (${n})`;
}

function itemClip(clip, ext) {
  const li = document.createElement("li");
  const video = document.createElement("video");
  video.src = clip.url;
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  const nombre = `arquero-${clip.fecha.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${ext}`;
  const acciones = document.createElement("div");
  acciones.className = "acciones";
  const etiqueta = document.createElement("span");
  etiqueta.textContent = LEYENDAS[clip.resultado]?.texto ?? "Tiro";
  const bajar = document.createElement("a");
  bajar.href = clip.url;
  bajar.download = nombre;
  bajar.textContent = "Descargar";
  bajar.className = "boton chico";
  acciones.append(etiqueta, bajar);
  const archivo = new File([clip.blob], nombre, { type: clip.blob.type });
  if (navigator.canShare?.({ files: [archivo] })) {
    const compartir = document.createElement("button");
    compartir.textContent = "Compartir";
    compartir.className = "boton chico";
    compartir.onclick = () => navigator.share({ files: [archivo], title: "Mi tiro contra el arquero" }).catch(() => {});
    acciones.append(compartir);
  }
  li.append(video, acciones);
  return li;
}

function listarClips(lista) {
  lista.replaceChildren(...(recorder?.clips ?? []).map((c) => itemClip(c, recorder.extension)));
}

// ---------- Entrar y salir ----------

function prepararJuego() {
  leerAjustes();
  sonidos.unlock();
  armarArco();
  tracker = new ShotTracker({ ballRadius: PELOTAS[ajustes.pelota].radio });
  detector.forget();
  marcador = { goles: 0, atajadas: 0, afuera: 0 };
  ui.marcador.textContent = textoMarcador();
  if (ajustes.modo === "fijo" && recordingSupported()) {
    recorder ??= new ShotRecorder(renderer);
    recorder.onClip = () => {
      actualizarRec();
      listarClips(ui.listaVideos);
    };
    recorder.marcador = textoMarcador();
  }
  ui.hud.dataset.modo = ajustes.modo;
  ui.inicio.hidden = true;
  ui.hud.hidden = false;
  ui.banner.hidden = true;
  ultimoT = null;
  actualizarRec();
}

function salir() {
  recorder?.stop();
  stage = null;
  modoStage = null;
  fase = "inicio";
  ui.hud.hidden = true;
  ui.inicio.hidden = false;
  renderer.domElement.style.display = "none";
  const n = recorder?.clips.length ?? 0;
  ui.clipsInicio.hidden = n === 0;
  if (n) listarClips(ui.listaClipsInicio);
}

ui.btnAR.addEventListener("click", async () => {
  prepararJuego();
  xrStage ??= new XRStage(renderer, ui.hud);
  xrStage.onEnd = salir;
  try {
    await xrStage.start();
  } catch (err) {
    console.error(err);
    salir();
    ui.compat.textContent = `No se pudo iniciar la realidad aumentada: ${err.message ?? err}`;
    ui.compat.className = "aviso error";
    return;
  }
  stage = xrStage;
  modoStage = "ar";
  irA("ubicar");
  if (xrStage.hasCameraAccess === false) {
    mostrarPaso(
      "Falta acceso a la cámara",
      "Tu Chrome no permite leer la cámara dentro de la realidad aumentada (camera-access), así que no puedo reconocer la pelota. Actualizá Chrome y Servicios de Google Play para RA.",
    );
  }
});

ui.btnDemo.addEventListener("click", () => {
  prepararJuego();
  demo ??= new DemoStage(renderer, renderer.domElement);
  demo.setBallRadius(PELOTAS[ajustes.pelota].radio);
  demo.resize(innerWidth, innerHeight);
  renderer.domElement.style.display = "block";
  stage = demo;
  modoStage = "demo";
  irA("ubicar");
});

ui.btnSalir.addEventListener("click", () => {
  if (modoStage === "ar") xrStage.end();
  else salir();
});
ui.btnReubicar.addEventListener("click", () => irA("ubicar"));
ui.btnReescanear.addEventListener("click", () => irA("escanear"));
ui.btnDiag.addEventListener("click", () => {
  mostrarDiag = !mostrarDiag;
  ui.diag.hidden = !mostrarDiag;
});
ui.btnVideos.addEventListener("click", () => {
  listarClips(ui.listaVideos);
  ui.videos.hidden = false;
});
ui.btnCerrarVideos.addEventListener("click", () => (ui.videos.hidden = true));

// En la demo: tocar el pasto mueve el arco y deslizar hacia arriba patea.
let gesto = null;
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (modoStage !== "demo") return;
  if (fase === "ubicar") {
    const p = demo.floorAt(e.clientX, e.clientY);
    if (p) puntoDemo.copy(p);
  } else if (fase === "jugar") {
    gesto = { x: e.clientX, y: e.clientY, t: performance.now() };
  }
});
renderer.domElement.addEventListener("pointerup", (e) => {
  if (modoStage !== "demo" || fase !== "jugar" || !gesto) return;
  const dx = e.clientX - gesto.x;
  const dy = gesto.y - e.clientY;
  const ms = Math.max(30, performance.now() - gesto.t);
  gesto = null;
  if (dy < 30 || demo.enJuego) return;
  // A dónde apunta: el rayo del final del gesto cortando el plano del arco.
  const ray = demo.rayAt(e.clientX, e.clientY);
  const plano = new THREE.Plane().setFromNormalAndCoplanarPoint(normalArco(), arcoGrupo.position);
  const objetivo = ray.intersectPlane(plano, new THREE.Vector3());
  if (!objetivo) return;
  const velocidad = Math.min(26, Math.max(8, 8 + (Math.hypot(dx, dy) / ms) * 9));
  demo.kick(objetivo, velocidad);
});

function patearAlAzar() {
  if (demo.enJuego) return;
  const { ancho, alto } = ARCOS[ajustes.arco];
  const local = new THREE.Vector3((Math.random() - 0.5) * (ancho + 0.8), 0.15 + Math.random() * (alto + 0.2), 0);
  demo.kick(local.applyMatrix4(arcoGrupo.matrixWorld), 9 + Math.random() * 13);
}

addEventListener("resize", () => {
  if (renderer.xr.isPresenting) return;
  renderer.setSize(innerWidth, innerHeight);
  camaraVirtual.aspect = innerWidth / innerHeight;
  camaraVirtual.updateProjectionMatrix();
  demo?.resize(innerWidth, innerHeight);
});

// ---------- Compatibilidad ----------

(async () => {
  if (!isSecureContext) {
    ui.compat.textContent = "Abrí esta página con https:// para poder usar la cámara.";
    ui.compat.className = "aviso error";
    ui.btnAR.disabled = true;
    return;
  }
  if (await xrSupported()) {
    ui.compat.textContent = "Tu celular soporta realidad aumentada ✓";
    ui.compat.className = "aviso ok";
  } else {
    ui.btnAR.disabled = true;
    ui.compat.textContent =
      "Este navegador no soporta realidad aumentada (WebXR). Usá Chrome en un Android compatible con ARCore. En iPhone, Safari todavía no lo permite. Mientras tanto podés probar la demo.";
    ui.compat.className = "aviso error";
  }
  if (!recordingSupported()) {
    for (const r of ui.modos) if (r.value === "fijo") r.closest("label").title = "Este navegador no puede grabar video";
  }
})();

// Para pruebas automáticas.
window.__arquero = {
  get fase() {
    return fase;
  },
  get marcador() {
    return { ...marcador };
  },
  get tracker() {
    return tracker?.state;
  },
  get clips() {
    return recorder?.clips.length ?? 0;
  },
  registro,
  patearA(x, y, velocidad) {
    const objetivo = new THREE.Vector3(x, y, 0).applyMatrix4(arcoGrupo.matrixWorld);
    demo.kick(objetivo, velocidad);
  },
};
