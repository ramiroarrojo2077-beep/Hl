// Vuelve a correr el seguimiento sobre un registro real ("Guardar registro para
// Claude"): usa lo que vio el detector en cada cuadro (candidatas y pose de la
// cámara) para ver qué decide el seguimiento y probar cambios con datos reales.
//   node arquero/sim/repetir.mjs registro.json [--detalle] [--fotos carpeta]
// Con --fotos guarda las fotos del registro (escaneo, vistazos con el mapa de
// lo que el detector creyó pelota, y las de cada remate).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import * as THREE from "three";
import { BallTracking } from "../js/seguimiento.js";

const [archivo] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const detalle = process.argv.includes("--detalle");
const reg = JSON.parse(readFileSync(archivo, "utf8"));
const proj = new THREE.Matrix4().fromArray(reg.proyeccion);
const arco = new THREE.Matrix4().fromArray(reg.arco);
// Tamaño de la imagen del detector: sale de la proyección (ancho/alto) y del escaneo.
const W = reg.imagen?.w ?? Number(process.env.ANCHO ?? 185);
const H = reg.imagen?.h ?? Number(process.env.ALTO ?? 400);

const iFotos = process.argv.indexOf("--fotos");
if (iFotos > 0) {
  const dir = process.argv[iFotos + 1];
  mkdirSync(dir, { recursive: true });
  const guardar = (nombre, url) => url && writeFileSync(`${dir}/${nombre}.jpg`, Buffer.from(url.split(",")[1], "base64"));
  const t00 = reg.cuadros[0]?.t ?? 0;
  guardar("escaneo", reg.escaneo?.jpeg);
  for (const v of reg.vistazos ?? []) {
    guardar(`vistazo-${(v.t - t00).toFixed(1)}`, v.jpeg);
    guardar(`vistazo-${(v.t - t00).toFixed(1)}-mapa`, v.mapa);
  }
  reg.tiros?.forEach((tiro, k) => tiro.fotos.forEach((f, j) => guardar(`tiro${k}-${j}-${(f.t - t00).toFixed(2)}`, f.jpeg)));
}

const seg = new BallTracking({ radio: reg.radioPelota?.calibrado ?? 0.11 });
seg.radio = reg.radioPelota?.calibrado ?? seg.radio;
seg.tracker.ballRadius = seg.radio;
const ARCOS = { mini: 2, futbol5: 3, cancha: 7.32 };
seg.setAnchoArco(ARCOS[reg.ajustes?.arco] ?? 3);
const { tracker } = seg;
const t0 = reg.cuadros[0].t;
let antes = null;
const eventos = [];
for (const f of reg.cuadros) {
  const info = { t: f.t, camMatrix: new THREE.Matrix4().fromArray(f.cam), projMatrix: proj };
  seg.tmp.proyInv.copy(proj).invert();
  seg.tmp.inv.copy(arco).invert();
  seg.tmp.vista.copy(info.camMatrix).invert();
  const ubicadas = f.cands
    .map(([x, y, r, score, moving, alargada]) => seg.ubicar(info, { x, y, r, score, moving, alargada }, f.wh?.[0] ?? W, f.wh?.[1] ?? H))
    .filter(Boolean);
  tracker.observe(f.t, ubicadas);
  const i = tracker.choose(f.t, ubicadas);
  let ev = null;
  if (i >= 0) {
    const { det: _d, ...obs } = ubicadas[i];
    ev = tracker.add(f.t, obs);
  }
  ev ??= tracker.tick(f.t);
  if (ev) eventos.push({ t: f.t - t0, ...ev });
  const estado = `${tracker.state}${tracker.ready ? " lista" : ""}`;
  if (detalle || estado !== antes || ev) {
    const u = i >= 0 ? ubicadas[i] : null;
    const q = tracker.quietos.map((k) => `(${k.x.toFixed(2)},${k.z.toFixed(2)}${k.armado ? " A" : ""} n${k.n} r${k.pr?.toFixed(1)})`).join(" ");
    console.log(
      `${(f.t - t0).toFixed(2)} ${estado}${ev ? ` [${ev.type}${ev.prediction ? ` x ${ev.prediction.x.toFixed(2)} y ${ev.prediction.y.toFixed(2)}` : ""}]` : ""}` +
        ` · elegida ${u ? `px (${u.px.toFixed(0)},${u.py.toFixed(0)}) r ${u.pr.toFixed(1)} → (${u.x.toFixed(2)}, ${u.y.toFixed(2)}, ${u.z.toFixed(2)}) esc ${u.escala?.toFixed(2)}` : "-"}` +
        ` · app: ${f.st}${f.lista ? " lista" : ""} · quietos ${q}`,
    );
  }
  antes = estado;
}
console.log(`eventos: ${eventos.map((e) => `${e.type}@${e.t.toFixed(1)}`).join(" ") || "ninguno"}`);
