import * as THREE from "three";
import { BallTracking, camaraDe } from "./seguimiento.js";
import { ARCOS, DIFICULTADES, PELOTAS, alturaArquero, judgeShot } from "./keeper-ai.js";
import { Goal } from "./goal.js";
import { Keeper } from "./keeper.js";
import { Sounds } from "./sounds.js";
import { ShotRecorder, recordingSupported } from "./recorder.js";
import { XRStage, xrSupported } from "./xr-stage.js";
import { CameraOrientation, ORIENTACIONES } from "./orientacion.js";
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
  btnRegistro: $("btn-registro"),
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

// Botones rápidos para cada ajuste (cambian el select que lee el juego).
// "Fútbol 5 (3 × 2 m)" → Fútbol 5 con "3 × 2 m" chiquito abajo.
function chips(select) {
  const caja = document.querySelector(`.chips[data-select="${select.id}"]`);
  if (!caja) return;
  const marcar = () => {
    for (const b of caja.children) b.setAttribute("aria-pressed", String(b.dataset.valor === select.value));
  };
  caja.classList.toggle("cuatro", select.options.length === 4);
  caja.replaceChildren(
    ...[...select.options].map((o) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.valor = o.value;
      const [, principal, detalle] = o.text.match(/^(.*?)(?:\s*\((.*)\))?$/);
      b.textContent = principal;
      if (detalle) b.append(Object.assign(document.createElement("small"), { textContent: detalle }));
      b.onclick = () => {
        select.value = o.value;
        marcar();
        leerAjustes();
      };
      return b;
    }),
  );
  marcar();
}
for (const s of [ui.selArco, ui.selPelota, ui.selDificultad]) chips(s);
for (const r of ui.modos) r.addEventListener("change", leerAjustes);

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

// Trayectoria prevista (línea punteada) y punto donde entra al arco.
const PUNTOS_TRAYECTORIA = 32;
const trayectoria = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints(Array.from({ length: PUNTOS_TRAYECTORIA }, () => new THREE.Vector3())),
  new THREE.LineDashedMaterial({ color: 0xffd400, dashSize: 0.14, gapSize: 0.09, transparent: true, opacity: 0.95, depthTest: false }),
);
trayectoria.frustumCulled = false;
trayectoria.renderOrder = 9;
trayectoria.visible = false;
const impacto = new THREE.Mesh(
  new THREE.RingGeometry(0.09, 0.14, 40),
  new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false }),
);
impacto.renderOrder = 9;
impacto.visible = false;

function mostrarTrayectoria(t) {
  const pred = tracker.state === "flight" ? tracker.shot?.pred : null;
  if (!pred || !Number.isFinite(pred.tCross)) {
    if (tracker.state !== "done") trayectoria.visible = impacto.visible = false;
    return;
  }
  const pos = trayectoria.geometry.attributes.position;
  const desde = Math.min(t, pred.tCross);
  for (let k = 0; k < PUNTOS_TRAYECTORIA; k++) {
    const p = tracker.expectedPosition(desde + ((pred.tCross - desde) * k) / (PUNTOS_TRAYECTORIA - 1));
    if (p) pos.setXYZ(k, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  trayectoria.computeLineDistances();
  trayectoria.geometry.computeBoundingSphere();
  impacto.position.set(pred.x, pred.y, 0.02);
  trayectoria.visible = impacto.visible = true;
}

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
  arcoGrupo.add(arco.group, arquero.root, trayectoria, impacto);
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

// Orientación de la imagen de la cámara: se detecta sola (ver orientacion.js) y
// se recuerda para la próxima vez en este celular.
let volteo = { x: false, y: false };
try {
  volteo = { ...volteo, ...JSON.parse(localStorage.getItem("arquero-volteo") ?? "{}") };
} catch {}
const orientacion = new CameraOrientation();

function aplicarVolteo() {
  xrStage?.setFlip(volteo.x, volteo.y);
  recorder?.setFlip(volteo.x, volteo.y);
}

// Verifica la orientación con cada cuadro hasta estar seguro; si estaba al
// revés, la corrige y descarta lo medido hasta ahora.
function verificarOrientacion(info) {
  if (orientacion.resultado !== null || !info.image) return;
  const { data, width: w, height: h } = info.image;
  const r = orientacion.observe(data, w, h, camaraDe(info, w, h));
  if (r === null || r === 0) return;
  const o = ORIENTACIONES[r];
  volteo = { x: volteo.x !== o.x, y: volteo.y !== o.y };
  try {
    localStorage.setItem("arquero-volteo", JSON.stringify(volteo));
  } catch {}
  aplicarVolteo();
  orientacion.reset(); // vuelve a verificar con la imagen corregida
  seg.reset();
  pelotaVistaEn = -Infinity;
}

const sonidos = new Sounds();
// Detección, medición y seguimiento de la pelota (ver seguimiento.js).
const seg = new BallTracking({ radio: 0.11 });
const { detector, tracker } = seg;
let recorder = null;
let stage = null;
let modoStage = null; // 'ar' | 'demo'
let xrStage = null;
let demo = null;
let fase = "inicio"; // inicio → ubicar → escanear → jugar
let pedidoEscaneo = false;
let tiro = null;
let ultimaPosicion = null;
let pelotaVistaEn = -Infinity;
let ultimoT = null;
let reiniciarEn = null;
let camaraAnterior = null;
let quietoDesde = null;
let mostrarDiag = false;
let marcador = { goles: 0, atajadas: 0, afuera: 0 };
// Remate más fuerte medido en este celular (km/h).
let record = 0;
try {
  record = Number(localStorage.getItem("arquero-record")) || 0;
} catch {}
function mostrarRecord() {
  const el = document.getElementById("record");
  el.hidden = !record;
  el.textContent = `⚡ Tu remate más fuerte: ${record} km/h`;
}
mostrarRecord();
let puntoDemo = new THREE.Vector3(0, 0, -6);
// ?registro guarda lo que ve el detector cuadro a cuadro (para depurar).
const registro = new URLSearchParams(location.search).has("registro") ? [] : null;

const tmp = {
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
      ? "Apoyá el celular quieto y horizontal, al costado (no detrás del que patea: su pierna tapa la pelota), donde se vean el arco y la pelota. Cuando diga «Pelota lista», pateá. Cada tiro se graba solo."
      : "Apuntá al arco con la pelota a la vista, mejor desde el costado. Cuando diga «Pelota lista», pateá: el arquero se tira hacia tu remate. Cada tiro se graba solo.";
    if (modoStage === "demo") texto = "Deslizá el dedo desde la pelota hacia el arco para patear, o tocá Patear al azar.";
    mostrarPaso("3 · ¡Pateá!", texto, modoStage === "demo" ? { texto: "Patear al azar", fn: patearAlAzar } : null);
    if (modoStage === "demo") demo.goToTripod();
    // Se graba en los dos modos (en mano, se ve lo que vio el celular).
    if (recorder) {
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
  const res = detector.learn(data, width / 2, height / 2, RADIO_MIRA * Math.min(width, height), camaraDe(info, width, height));
  bitacora.escaneo = { foto: copiaImagen(info.image, info.t), res: { ok: res.ok, motivo: res.motivo ?? null, fuga: res.fuga ?? null } };
  if (res.ok) seg.reiniciarRadio();
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

function radioNominal() {
  return PELOTAS[ajustes.pelota].radio;
}

// ---------- Registro para diagnóstico ----------
//
// Guarda, cuadro a cuadro, lo que ve la cámara y lo que calcula la app (los
// últimos ~40 s) y fotos de antes y durante los últimos tiros. Con el botón
// "Guardar registro" se exporta en un archivo para mandárselo a quien arregla la app.

const MAX_CUADROS = 1200;
const bitacora = { cuadros: [], escaneo: null, tiros: [], previos: [], siguientePrevia: 0, tiroActual: null };
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;

function copiaImagen(img, t) {
  return { t, w: img.width, h: img.height, data: img.data.slice() };
}

function anotarCuadro(info, t, candidatas, elegida, medida, evento) {
  const d = medida?.det;
  const fila = {
    t: r4(t),
    cam: Array.from(info.camMatrix.elements, r4),
    cands: candidatas.map((c) => [r2(c.x), r2(c.y), r2(c.r), r2(c.score), c.moving == null ? null : r2(c.moving), r2(c.alargada ?? 1)]),
    elegida,
    det: d && { x: r2(d.x), y: r2(d.y), r: r2(d.r), fino: Boolean(d.refinada), borde: d.borde ? r2(d.borde) : null },
    p: medida && { x: r2(medida.x), y: r2(medida.y), z: r2(medida.z), g: medida.onGround },
    ev: evento?.type,
    pred: evento?.prediction && { x: r4(evento.prediction.x), y: r4(evento.prediction.y), aire: !evento.prediction.rolling },
    st: tracker.state,
    lista: tracker.ready,
  };
  bitacora.cuadros.push(fila);
  if (bitacora.cuadros.length > MAX_CUADROS) bitacora.cuadros.shift();
  registro?.push(fila);
  if (registro && registro.length > 600) registro.shift();

  // Fotos: siempre las últimas 3 (en lugares reusados, para no generar basura de
  // memoria en cada cuadro); durante un remate, todas (hasta 18).
  if (evento?.type === "kick") bitacora.tiroActual = { fotos: ultimasFotos().map((f) => ({ ...f, data: f.data.slice() })), eventos: [] };
  if (bitacora.tiroActual) {
    if (bitacora.tiroActual.fotos.length < 18) bitacora.tiroActual.fotos.push(copiaImagen(info.image, t));
    if (evento) bitacora.tiroActual.eventos.push({ t: r4(t), tipo: evento.type, pred: fila.pred });
    if (evento?.type === "cross" || evento?.type === "cancel") {
      bitacora.tiros.push(bitacora.tiroActual);
      if (bitacora.tiros.length > 3) bitacora.tiros.shift();
      bitacora.tiroActual = null;
    }
  } else {
    guardarPrevia(info.image, t);
  }
}

function guardarPrevia(img, t) {
  const k = bitacora.siguientePrevia++ % 3;
  let f = bitacora.previos[k];
  if (!f || f.data.length !== img.data.length) f = bitacora.previos[k] = { data: new Uint8Array(img.data.length) };
  f.data.set(img.data);
  f.t = t;
  f.w = img.width;
  f.h = img.height;
}

// Las fotos previas en orden.
function ultimasFotos() {
  return bitacora.previos.filter(Boolean).sort((a, b) => a.t - b.t);
}

function jpeg(foto) {
  const c = document.createElement("canvas");
  c.width = foto.w;
  c.height = foto.h;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(foto.w, foto.h);
  const fila = foto.w * 4;
  // La imagen viene con la fila 0 abajo.
  for (let y = 0; y < foto.h; y++) img.data.set(foto.data.subarray((foto.h - 1 - y) * fila, (foto.h - y) * fila), y * fila);
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/jpeg", 0.8);
}

async function exportarRegistro() {
  const boton = ui.btnRegistro;
  const texto = boton.textContent;
  boton.disabled = true;
  boton.textContent = "Preparando…";
  await new Promise((ok) => setTimeout(ok, 30));
  try {
    const datos = {
      app: "Arquero AR",
      fecha: new Date().toISOString(),
      navegador: navigator.userAgent,
      ajustes,
      modo: modoStage,
      volteo,
      orientacion: { resultado: orientacion.resultado, votos: orientacion.votos },
      radioPelota: { nominal: seg.radioNominal, calibrado: seg.radio, muestras: seg.muestrasRadio.length },
      proyeccion: ultimaInfo ? Array.from(ultimaInfo.projMatrix.elements, r4) : null,
      arco: ultimaInfo ? Array.from(arcoGrupo.matrixWorld.elements, r4) : null,
      escaneo: bitacora.escaneo && { ...bitacora.escaneo.res, jpeg: jpeg(bitacora.escaneo.foto) },
      tiros: bitacora.tiros.map((tiro) => ({ eventos: tiro.eventos, fotos: tiro.fotos.map((f) => ({ t: r4(f.t), jpeg: jpeg(f) })) })),
      cuadros: bitacora.cuadros,
    };
    const nombre = `arquero-registro-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
    const contenido = JSON.stringify(datos);
    // Como texto se puede compartir por WhatsApp, mail, Drive…; si no, se descarga.
    const archivo = new File([contenido], `${nombre}.txt`, { type: "text/plain" });
    if (navigator.canShare?.({ files: [archivo] })) {
      await navigator.share({ files: [archivo], title: "Registro de Arquero AR" }).catch(() => {});
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([contenido], { type: "application/json" }));
      a.download = `${nombre}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
  } finally {
    boton.disabled = false;
    boton.textContent = texto;
  }
}

// ---------- Seguimiento de la pelota ----------

const marca = { pos: new THREE.Vector3(), lista: false };

function seguirPelota(info) {
  const t = info.t;
  const { candidatas, elegida, medida, evento, repetido } = seg.procesar(info, arcoGrupo.matrixWorld);
  if (medida) {
    ultimaPosicion = medida;
    pelotaVistaEn = t;
  }
  mostrarTrayectoria(t);
  // Una imagen repetida de la cámara no se anota (no es un cuadro nuevo).
  if (!repetido || evento) anotarCuadro(info, t, candidatas, elegida, medida, evento);
  if (evento) manejarEvento(evento, t);

  // El aro sigue la trayectoria ajustada (suave) en vuelo y queda fijo donde
  // la pelota está quieta; no salta con cada medición.
  const vista = t - pelotaVistaEn < 0.25;
  const lista = tracker.ready;
  const fija = tracker.expectedPosition(t) ?? (lista ? tracker.restPosition() : null);
  if (fija) marca.pos.set(fija.x, fija.y, fija.z);
  else if (vista && ultimaPosicion) marca.pos.lerp(tmp.v.set(ultimaPosicion.x, ultimaPosicion.y, ultimaPosicion.z), 0.5);
  marcaPelota.position.copy(marca.pos).applyMatrix4(arcoGrupo.matrixWorld);
  marcaPelota.visible = tracker.state === "flight" || (lista && t - pelotaVistaEn < 1.5) || vista;
  marcaPelota.material.color.set(tracker.state === "flight" ? 0xffd400 : lista ? 0xc6ff1a : 0xffffff);
  marcaPelota.quaternion.setFromRotationMatrix(info.camMatrix);

  ui.estadoPelota.textContent = lista
    ? "● Pelota lista: ¡pateá!"
    : vista
      ? "● Pelota vista: dejala quieta"
      : "○ Buscando la pelota…";
  ui.estadoPelota.classList.toggle("ok", lista);
  if (tracker.state === "idle" && (lista || vista)) arquero.seguir(marca.pos.x);
  arquero.mirar(tracker.state === "flight" || lista || t - pelotaVistaEn < 0.6 ? { x: marca.pos.x, y: marca.pos.y, z: marca.pos.z } : null);

  if (mostrarDiag) dibujarDiagnostico(info.image, medida?.det ?? null, medida);
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
    // Falsa alarma (la pelota seguía en su lugar) o un tiro que no se pudo seguir.
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
    radio: seg.radio,
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
  // Velocidad del remate.
  const kmh = Number.isFinite(pred.kickSpeed) ? Math.round(pred.kickSpeed * 3.6) : null;
  if (kmh && kmh > 10 && kmh < 200) {
    leyenda.detalle = `${kmh} km/h`;
    sub = sub ? `${kmh} km/h · ${sub}` : `${kmh} km/h`;
    if (kmh > record) {
      record = kmh;
      try {
        localStorage.setItem("arquero-record", String(record));
      } catch {}
      if (marcador.goles + marcador.atajadas + marcador.afuera > 1) sub += " · ¡récord!";
    }
  }
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
  trayectoria.visible = impacto.visible = false;
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

function volteoTexto() {
  const o = ORIENTACIONES.find((k) => k.x === volteo.x && k.y === volteo.y).nombre;
  if (modoStage !== "ar") return "simulada";
  if (orientacion.resultado === 0) return `${o} (verificada)`;
  return `${o} (verificando: mové un poco el celular)`;
}

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
    ` · ${tracker.state}` +
    ` · cámara ${volteoTexto()}` +
    ` · pelota ${(seg.radio * 200).toFixed(1)} cm${seg.muestrasRadio.length >= 20 ? " (medida)" : ""}`;
}

// ---------- Cuadro a cuadro ----------

let cuadro = 0;
function paso(info) {
  cuadro++;
  ultimaInfo = info;
  if (registro && info.image) window.__arquero.imagen = info.image;
  if (modoStage === "ar") verificarOrientacion(info);
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
      detector.observeBackground(info.image.data, null, camaraDe(info, info.image.width, info.image.height));
    }
  } else if (fase === "escanear") {
    if (pedidoEscaneo && info.image) {
      pedidoEscaneo = false;
      escanear(info);
    } else if (info.image && cuadro % 4 === 0) {
      // Mientras tanto aprende los colores del lugar (sin mirar el círculo).
      const { data, width: w, height: h } = info.image;
      detector.resize(w, h);
      detector.observeBackground(data, { x: w / 2, y: h / 2, r: RADIO_MIRA * Math.min(w, h) }, camaraDe(info, w, h));
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
  seg.setRadioNominal(radioNominal());
  seg.setAnchoArco(ARCOS[ajustes.arco].ancho);
  seg.reset();
  detector.forget();
  orientacion.reset();
  marcador = { goles: 0, atajadas: 0, afuera: 0 };
  ui.marcador.textContent = textoMarcador();
  if (recordingSupported()) {
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
  mostrarRecord();
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
  seg.saltarRepetidos = true;
  aplicarVolteo();
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
  seg.saltarRepetidos = false;
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
ui.btnRegistro.addEventListener("click", exportarRegistro);
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
    ui.compat.textContent = new URLSearchParams(location.search).has("app")
      ? "Esta ventana no tiene realidad aumentada. Volvé a la app Arquero AR y tocá «Abrir en Chrome». Si tampoco anda, instalá o actualizá «Servicios de Google Play para RA»."
      : "Este navegador no soporta realidad aumentada (WebXR). Usá Chrome en un Android compatible con ARCore. En iPhone, Safari todavía no lo permite. Mientras tanto podés probar la demo.";
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
    return tracker.state;
  },
  get clips() {
    return recorder?.clips.length ?? 0;
  },
  get radioPelota() {
    return { nominal: seg.radioNominal, calibrado: seg.radio, muestras: seg.muestrasRadio.length };
  },
  get orientacion() {
    return { volteo, verificada: orientacion.resultado === 0, votos: [...orientacion.votos] };
  },
  registro,
  patearA(x, y, velocidad) {
    const objetivo = new THREE.Vector3(x, y, 0).applyMatrix4(arcoGrupo.matrixWorld);
    demo.kick(objetivo, velocidad);
  },
};
