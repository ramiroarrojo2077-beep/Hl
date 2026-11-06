// Gravity Game Engine: motor de juegos 2D (plataformas o aventura vista de arriba) definido por juego.json.
// La lógica (física, colisiones, IA de los NPC, ítems, misiones, diálogos) no depende del navegador: el
// probador de Gravity la corre en Node. En el navegador dibuja en canvas (2D) o con Three.js (3D) y arma la
// interfaz: menú, HUD, pausa, inventario, configuración y controles táctiles.

export const VERSION = 1;
const SOLIDOS_DEF = { "#": true, "=": true, "B": true };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** Prepara el estado inicial a partir del juego. */
export function crearEstado(j, semilla = 1) {
  const T = j.tamTile || 32, filas = j.mapa.filas, alto = filas.length, ancho = Math.max(...filas.map((f) => f.length));
  const tiles = { ...(j.tiles || {}) };
  const solido = (c) => (tiles[c]?.solido ?? SOLIDOS_DEF[c] ?? false);
  let inicio = { x: T, y: T };
  const items = [], actores = [];
  for (let y = 0; y < alto; y++) for (let x = 0; x < filas[y].length; x++) {
    const c = filas[y][x];
    if (c === "P") inicio = { x: x * T, y: y * T };
    if (c === "C") items.push({ id: `c${x}_${y}`, item: (j.items || [])[0]?.id || "moneda", x: x * T + T / 4, y: y * T + T / 4, w: T / 2, h: T / 2, tomado: false });
  }
  for (const it of j.colocados || []) items.push({ id: `i${items.length}`, item: it.item, x: it.x * T + T / 4, y: it.y * T + T / 4, w: T / 2, h: T / 2, tomado: false });
  const pj = (j.personajes || []).find((p) => p.rol === "jugador") || { id: "jugador", nombre: "Jugador", rol: "jugador", color: "#4cc9f0", velocidad: 3, salto: 9, vida: 3 };
  const actor = (p, x, y) => ({ id: `${p.id}-${actores.length}`, def: p, x, y, w: Math.round(T * (p.ancho ?? 0.75)), h: Math.round(T * (p.alto ?? 0.9)), vx: 0, vy: 0, suelo: false, vida: p.vida ?? 1, dir: 1, ia: { fase: 0, origenX: x, origenY: y, punto: 0 }, anim: 0, golpeado: 0, vivo: true });
  const jugador = actor(pj, inicio.x + 2, inicio.y + T - Math.round(T * (pj.alto ?? 0.9)));
  for (const e of j.entidades || []) { const p = (j.personajes || []).find((x) => x.id === e.personaje); if (p && p.rol !== "jugador") actores.push(actor(p, e.x * T + 2, e.y * T + T - Math.round(T * (p.alto ?? 0.9)))); }
  return { j, T, ancho, alto, solido, jugador, actores, items, inventario: {}, puntos: 0, tiempo: 0, dialogo: null, misiones: (j.historia?.misiones || []).map((m) => ({ ...m, progreso: 0, hecha: false })), fin: null, eventos: [], azar: semilla >>> 0 || 1, cuadros: 0 };
}
function azar(st) { st.azar = (st.azar * 1664525 + 1013904223) >>> 0; return st.azar / 4294967296; }
export function tileEn(st, px, py) { const x = Math.floor(px / st.T), y = Math.floor(py / st.T); if (x < 0 || y < 0) return "#"; if (y >= st.alto) return st.j.genero === "aventura" ? "#" : "."; /* en plataformas, abajo del mapa es el vacío */ return st.j.mapa.filas[y][x] ?? (x >= st.ancho ? "#" : "."); }
function choca(st, a, x, y) {
  for (const [dx, dy] of [[0, 0], [a.w - 0.01, 0], [0, a.h - 0.01], [a.w - 0.01, a.h - 0.01], [a.w / 2, 0], [a.w / 2, a.h - 0.01], [0, a.h / 2], [a.w - 0.01, a.h / 2]]) if (st.solido(tileEn(st, x + dx, y + dy))) return true;
  return false;
}
/** Mueve un actor con colisiones contra los tiles sólidos (eje por eje). */
function mover(st, a, dt) {
  const f = st.j.fisica || {}, plat = st.j.genero !== "aventura";
  if (plat) a.vy = Math.min(a.vy + (f.gravedad ?? 0.5) * dt, f.velMaxCaida ?? 12);
  const pasos = Math.ceil(Math.max(Math.abs(a.vx), Math.abs(a.vy)) * dt / (st.T / 4)) || 1;
  a.suelo = false;
  for (let i = 0; i < pasos; i++) {
    const nx = a.x + (a.vx * dt) / pasos;
    if (!choca(st, a, nx, a.y)) a.x = nx; else { a.vx = -a.vx * (f.rebote ?? 0); if (!a.def.rol || a.def.rol !== "jugador") a.dir *= -1; }
    const ny = a.y + (a.vy * dt) / pasos;
    if (!choca(st, a, a.x, ny)) a.y = ny; else { if (a.vy > 0) a.suelo = true; a.vy = Math.abs(a.vy) > 1.5 ? -a.vy * (f.rebote ?? 0) : 0; }
  }
  if (!plat) a.suelo = true;
  a.x = clamp(a.x, 0, st.ancho * st.T - a.w);
}
const superpone = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const centro = (a) => ({ x: a.x + a.w / 2, y: a.y + a.h / 2 });

/** IA de un NPC o enemigo: quieto, patrullar, perseguir (con rango), huir o seguir un camino de puntos. */
function pensar(st, a, dt) {
  const ia = a.def.ia || { tipo: "quieto" }, v = a.def.velocidad ?? 1.5, plat = st.j.genero !== "aventura";
  const yo = centro(a), el = centro(st.jugador), dx = el.x - yo.x, dy = el.y - yo.y, d = Math.hypot(dx, dy), rango = (ia.rango ?? 5) * st.T;
  let tipo = ia.tipo;
  if ((tipo === "perseguir" || tipo === "huir") && d > rango) tipo = ia.siNoVe || "patrullar";
  if (tipo === "quieto") { a.vx *= 0.8; if (!plat) a.vy *= 0.8; }
  else if (tipo === "patrullar") {
    const lejos = Math.abs(a.x - a.ia.origenX) > (ia.distancia ?? 3) * st.T;
    if (lejos) a.dir = a.x > a.ia.origenX ? -1 : 1;
    // En plataformas no se tira de los bordes.
    if (plat && a.suelo && !st.solido(tileEn(st, a.x + (a.dir > 0 ? a.w + 2 : -2), a.y + a.h + 2))) a.dir *= -1;
    a.vx = a.dir * v;
    if (!plat) a.vy = 0;
  } else if (tipo === "perseguir" || tipo === "huir") {
    const s = tipo === "huir" ? -1 : 1;
    a.vx = Math.sign(dx) * v * s; a.dir = Math.sign(a.vx) || a.dir;
    if (!plat) a.vy = Math.sign(dy) * v * s;
    else if (a.suelo && s > 0 && dy < -st.T && azar(st) < 0.05) a.vy = -(a.def.salto ?? 7);
  } else if (tipo === "camino") {
    const pts = ia.puntos || [];
    if (pts.length) {
      const p = pts[a.ia.punto % pts.length], tx = p[0] * st.T, ty = p[1] * st.T;
      const ex = tx - a.x, ey = ty - a.y;
      if (Math.hypot(ex, plat ? 0 : ey) < v * 2) a.ia.punto++;
      a.vx = Math.sign(ex) * v; a.dir = Math.sign(a.vx) || a.dir;
      if (!plat) a.vy = Math.abs(ey) > 1 ? Math.sign(ey) * v : 0;
    }
  }
}

/** Un paso de simulación. entrada: { izq, der, arriba, abajo, saltar, accion }. dt en cuadros de 1/60 s. */
export function paso(st, entrada = {}, dt = 1) {
  if (st.fin || st.pausa) return st;
  st.cuadros++; st.tiempo += dt / 60; st.eventos = [];
  const j = st.j, J = st.jugador, f = j.fisica || {}, plat = j.genero !== "aventura", v = J.def.velocidad ?? 3;
  if (st.dialogo) { if (entrada.accionNueva) { st.dialogo.linea++; if (st.dialogo.linea >= st.dialogo.lineas.length) st.dialogo = null; } return st; }
  // Jugador
  const ax = (entrada.der ? 1 : 0) - (entrada.izq ? 1 : 0);
  if (ax) { J.vx = clamp(J.vx + ax * v * 0.35 * dt, -v, v); J.dir = ax; }
  else J.vx *= Math.pow(1 - (f.friccion ?? 0.25), dt);
  if (plat) { if (entrada.saltar && J.suelo) { J.vy = -(J.def.salto ?? 9); st.eventos.push("salto"); } }
  else { const ay = (entrada.abajo ? 1 : 0) - (entrada.arriba ? 1 : 0); if (ay) J.vy = clamp(J.vy + ay * v * 0.35 * dt, -v, v); else J.vy *= Math.pow(1 - (f.friccion ?? 0.25), dt); }
  mover(st, J, dt);
  J.anim += Math.abs(J.vx) * dt * 0.08;
  if (J.golpeado > 0) J.golpeado -= dt;
  // Tiles especiales
  const c = tileEn(st, J.x + J.w / 2, J.y + J.h / 2), pie = tileEn(st, J.x + J.w / 2, J.y + J.h + 1);
  if ((c === "^" || pie === "^" || c === "~" && j.tiles?.["~"]?.dano) && J.golpeado <= 0) danar(st, 1);
  if (c === "G" || c === "D" && j.tiles?.D?.meta) { const pend = st.misiones.filter((m) => !m.hecha && m.objetivo?.tipo !== "llegar"); if (!pend.length) ganar(st); else { st.misiones.filter((m) => m.objetivo?.tipo === "llegar").forEach((m) => { m.hecha = true; }); if (!st.avisoMeta) { st.avisoMeta = true; st.eventos.push("faltan misiones"); } } } else st.avisoMeta = false;
  if (J.y > st.alto * st.T + 64) { danar(st, 99); }
  // Ítems
  for (const it of st.items) if (!it.tomado && superpone(J, it)) {
    it.tomado = true; const def = (j.items || []).find((x) => x.id === it.item) || { id: it.item, efecto: "puntos", valor: 10 };
    st.inventario[def.id] = (st.inventario[def.id] || 0) + 1;
    if (def.efecto === "vida") J.vida = Math.min((J.def.vida ?? 3) + 2, J.vida + (def.valor ?? 1)); else st.puntos += def.valor ?? 10;
    st.eventos.push("item");
    avanzar(st, "recolectar", def.id, 1);
  }
  // NPC y enemigos
  for (const a of st.actores) {
    if (!a.vivo) continue;
    pensar(st, a, dt); mover(st, a, dt); a.anim += Math.abs(a.vx) * dt * 0.08;
    if (!superpone(J, a)) continue;
    if (a.def.rol === "enemigo") {
      // En plataformas, caerle encima lo derrota.
      if (plat && J.vy > 0 && J.y + J.h - a.y < 14) { a.vida--; J.vy = -6; if (a.vida <= 0) { a.vivo = false; st.puntos += 50; st.eventos.push("derrota"); avanzar(st, "derrotar", a.def.id, 1); } }
      else if (J.golpeado <= 0) { danar(st, a.def.dano ?? 1); J.vx = Math.sign(J.x - a.x || 1) * 5; if (plat) J.vy = -4; }
    } else if (a.def.rol === "npc" && entrada.accionNueva && a.def.dialogo?.length) {
      st.dialogo = { quien: a.def.nombre, lineas: a.def.dialogo, linea: 0 }; st.eventos.push("dialogo"); avanzar(st, "hablar", a.def.id, 1);
    }
  }
  return st;
}
function danar(st, n) { const J = st.jugador; J.vida -= n; J.golpeado = 60; st.eventos.push("dano"); if (J.vida <= 0) { st.fin = "perdiste"; st.eventos.push("fin"); } }
function ganar(st) { st.fin = "ganaste"; st.eventos.push("fin"); }
function avanzar(st, tipo, id, n) {
  for (const m of st.misiones) {
    const o = m.objetivo || {};
    if (m.hecha || o.tipo !== tipo || (o.objetivo && o.objetivo !== id)) continue;
    m.progreso += n;
    if (m.progreso >= (o.cantidad ?? 1)) { m.hecha = true; st.eventos.push("mision"); }
  }
  if (st.misiones.length && st.misiones.every((m) => m.hecha) && !(st.j.mapa.filas.some((f) => f.includes("G")))) ganar(st);
}

// ---------------------------------------------------------------- navegador
const ES_NAVEGADOR = typeof window !== "undefined" && typeof document !== "undefined";

/** Dibuja un personaje procedural según su forma, con animación de caminar/saltar (estirar y aplastar). */
function dibujarPersonaje(g, a, T, t) {
  const d = a.def, an = d.animaciones || {}, cam = an.caminar || {}, sal = an.salto || {};
  const paso = Math.sin(a.anim * (cam.frecuencia ?? 1) * 3) * (cam.amplitud ?? 1);
  const est = !a.suelo ? (sal.estirar ?? 0.12) : 0;
  const w = a.w * (1 - est * 0.5), h = a.h * (1 + est), x = a.x + (a.w - w) / 2, y = a.y + a.h - h - Math.abs(paso) * 1.5;
  if (a.golpeado > 0 && Math.floor(t * 12) % 2) return;
  g.save();
  g.fillStyle = d.color || "#e76f51";
  const forma = d.forma || "bloque";
  if (forma === "blob") { g.beginPath(); g.ellipse(x + w / 2, y + h * 0.6, w / 2, h * 0.45, 0, 0, Math.PI * 2); g.fill(); }
  else if (forma === "robot") { g.beginPath(); g.roundRect(x, y + h * 0.3, w, h * 0.7, 4); g.fill(); g.beginPath(); g.roundRect(x + w * 0.1, y, w * 0.8, h * 0.36, 5); g.fill(); g.fillStyle = "#9ef0ff"; g.fillRect(x + w * (a.dir > 0 ? 0.5 : 0.18), y + h * 0.12, w * 0.3, h * 0.1); }
  else if (forma === "caballero") { g.beginPath(); g.roundRect(x, y + h * 0.25, w, h * 0.75, 3); g.fill(); g.fillStyle = "#cfd6e4"; g.beginPath(); g.arc(x + w / 2, y + h * 0.2, w * 0.38, 0, Math.PI * 2); g.fill(); g.fillStyle = "#333"; g.fillRect(x + w * (a.dir > 0 ? 0.5 : 0.2), y + h * 0.16, w * 0.3, 3); }
  else { g.beginPath(); g.roundRect(x, y, w, h, 6); g.fill(); }
  // Ojos que miran hacia donde va
  if (forma !== "robot" && forma !== "caballero") { g.fillStyle = "#fff"; const ox = x + w * (a.dir > 0 ? 0.62 : 0.2); g.fillRect(ox, y + h * 0.3, w * 0.18, h * 0.16); g.fillStyle = "#111"; g.fillRect(ox + w * (a.dir > 0 ? 0.08 : 0), y + h * 0.33, w * 0.1, h * 0.1); }
  // Piernas
  g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(x + w * 0.2 + paso * 2, y + h - 3, w * 0.22, 3); g.fillRect(x + w * 0.58 - paso * 2, y + h - 3, w * 0.22, 3);
  g.restore();
}
const COLORES_TILE = { "#": "#3d405b", "=": "#6d597a", "B": "#9c6644", "~": "#4ea8de", "^": "#e63946", "G": "#ffd166", "D": "#8d6e63", ".": null, "P": null, "C": null };

export function dibujar2D(g, st, W, H, t) {
  const T = st.T, J = st.jugador, j = st.j;
  g.fillStyle = j.fondo || (j.genero === "aventura" ? "#7cb36b" : "#a8dadc"); g.fillRect(0, 0, W, H);
  // Si el mapa es más bajo que la pantalla, se agranda para llenarla.
  const k = Math.max(1, Math.min(3, H / (st.alto * T)));
  W /= k; H /= k;
  const camX = clamp(J.x + J.w / 2 - W / 2, 0, Math.max(0, st.ancho * T - W)), camY = clamp(J.y + J.h / 2 - H / 2, 0, Math.max(0, st.alto * T - H));
  g.save(); g.scale(k, k); g.translate(-Math.round(camX), -Math.round(camY));
  const x0 = Math.floor(camX / T), x1 = Math.ceil((camX + W) / T), y0 = Math.floor(camY / T), y1 = Math.ceil((camY + H) / T);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = j.mapa.filas[y]?.[x]; if (!c) continue;
    const col = j.tiles?.[c]?.color ?? COLORES_TILE[c];
    if (!col) continue;
    g.fillStyle = col; g.fillRect(x * T, y * T, T, T);
    if (c === "^") { g.fillStyle = "#fff"; for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(x * T + k * T / 3, y * T + T); g.lineTo(x * T + k * T / 3 + T / 6, y * T + T / 3); g.lineTo(x * T + (k + 1) * T / 3, y * T + T); g.fill(); } }
    else if (c === "G") { g.fillStyle = "#fff"; g.fillRect(x * T + T * 0.45, y * T, 3, T); g.fillStyle = "#ef476f"; g.fillRect(x * T + T * 0.45 + 3, y * T + 2, T * 0.4, T * 0.3); }
    else { g.fillStyle = "rgba(255,255,255,.08)"; g.fillRect(x * T, y * T, T, 3); }
  }
  for (const it of st.items) if (!it.tomado) { const def = (j.items || []).find((d) => d.id === it.item); g.fillStyle = def?.color || "#ffd166"; g.beginPath(); g.arc(it.x + it.w / 2, it.y + it.h / 2 + Math.sin(t * 4 + it.x) * 2, it.w / 2, 0, Math.PI * 2); g.fill(); }
  for (const a of st.actores) if (a.vivo) dibujarPersonaje(g, a, T, t);
  dibujarPersonaje(g, J, T, t);
  g.restore();
}

/** Render 3D con Three.js: el mismo mundo, con tiles en relieve y personajes con volumen. */
export function crear3D(THREE, lienzo, st) {
  const T = st.T, r = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true });
  const esc = new THREE.Scene(); esc.background = new THREE.Color(st.j.fondo || "#a8dadc");
  const cam = new THREE.PerspectiveCamera(55, 1, 1, 4000);
  esc.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2));
  const sol = new THREE.DirectionalLight(0xffffff, 1.6); sol.position.set(300, 600, 400); esc.add(sol);
  const plat = st.j.genero !== "aventura";
  const caja = new THREE.BoxGeometry(T, T, T), mats = {};
  const mat = (c) => (mats[c] ??= new THREE.MeshStandardMaterial({ color: st.j.tiles?.[c]?.color ?? COLORES_TILE[c] ?? "#888", roughness: 0.8 }));
  st.j.mapa.filas.forEach((f, y) => [...f].forEach((c, x) => {
    if (!(st.j.tiles?.[c]?.color ?? COLORES_TILE[c])) return;
    const m = new THREE.Mesh(caja, mat(c));
    // Plataformas: el mapa es una pared vertical; aventura: el mapa es el piso y los sólidos son bloques.
    if (plat) m.position.set(x * T + T / 2, -(y * T + T / 2), 0); else { m.position.set(x * T + T / 2, st.solido(c) ? T / 2 : -T / 2 + 2, y * T + T / 2); if (!st.solido(c)) m.scale.y = 0.1; }
    esc.add(m);
  }));
  if (!plat) { const piso = new THREE.Mesh(new THREE.PlaneGeometry(st.ancho * T, st.alto * T), new THREE.MeshStandardMaterial({ color: st.j.fondo || "#7cb36b" })); piso.rotation.x = -Math.PI / 2; piso.position.set(st.ancho * T / 2, -T / 2, st.alto * T / 2); esc.add(piso); }
  const cuerpos = new Map();
  const cuerpo = (a) => { if (!cuerpos.has(a)) { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.CapsuleGeometry(a.w / 2.2, a.h - a.w / 1.1, 4, 12), new THREE.MeshStandardMaterial({ color: a.def.color || "#e76f51", roughness: 0.5 })); const ojo = new THREE.Mesh(new THREE.SphereGeometry(a.w / 7, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff })); ojo.position.set(a.w / 4, a.h / 4, a.w / 2.4); g.add(b, ojo); esc.add(g); cuerpos.set(a, g); } return cuerpos.get(a); };
  const items = st.items.map((it) => { const m = new THREE.Mesh(new THREE.TorusGeometry(it.w / 2.5, it.w / 8, 8, 16), new THREE.MeshStandardMaterial({ color: (st.j.items || []).find((d) => d.id === it.item)?.color || "#ffd166", metalness: 0.6, roughness: 0.3 })); esc.add(m); return [it, m]; });
  return {
    render(W, H, t) {
      r.setSize(W, H, false); cam.aspect = W / H; cam.updateProjectionMatrix();
      const J = st.jugador;
      for (const a of [J, ...st.actores]) { const g = cuerpo(a); g.visible = a.vivo !== false && !(a.golpeado > 0 && Math.floor(t * 12) % 2); const sal = !a.suelo ? 1.12 : 1; g.scale.set(1 / Math.sqrt(sal), sal, 1 / Math.sqrt(sal)); if (plat) g.position.set(a.x + a.w / 2, -(a.y + a.h / 2), 0); else g.position.set(a.x + a.w / 2, a.h / 2 - T / 2 + Math.abs(Math.sin(a.anim * 3)) * 3, a.y + a.h / 2); g.rotation.y = plat ? (a.dir > 0 ? 0.5 : -0.5) : (a.dir > 0 ? Math.PI / 2 : -Math.PI / 2); }
      for (const [it, m] of items) { m.visible = !it.tomado; m.rotation.y = t * 2; if (plat) m.position.set(it.x + it.w / 2, -(it.y + it.h / 2), 0); else m.position.set(it.x + it.w / 2, 4, it.y + it.h / 2); }
      if (plat) { cam.position.set(J.x, -J.y + 60, 520); cam.lookAt(J.x, -J.y, 0); } else { cam.position.set(J.x, 300, J.y + 220); cam.lookAt(J.x, 0, J.y); }
      r.render(esc, cam);
    },
  };
}

/** Arma el juego completo en la página: menú, HUD, pausa, inventario, configuración y controles táctiles. */
export async function iniciar(raiz, j, op = {}) {
  if (!ES_NAVEGADOR) throw new Error("iniciar() es para el navegador.");
  const ui = { titulo: j.nombre, colorPrincipal: "#4361ee", menu: true, inventario: true, controlesTactiles: true, ...(j.ui || {}) };
  raiz.innerHTML = `<style>
  .gj{position:relative;width:100%;height:100%;overflow:hidden;font-family:system-ui,sans-serif;color:#fff;background:#111;touch-action:none;user-select:none}
  .gj canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
  .gj-hud{position:absolute;top:8px;left:10px;right:10px;display:flex;gap:12px;align-items:center;font-weight:700;text-shadow:0 1px 2px #000;pointer-events:none}
  .gj-hud .sp{flex:1}.gj-b{pointer-events:auto;background:rgba(0,0,0,.45);border:0;color:#fff;border-radius:10px;padding:6px 10px;font:inherit;cursor:pointer}
  .gj-cap{position:absolute;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.55)}.gj-cap[hidden]{display:none}
  .gj-cap>div{background:#1b1f2a;border-radius:16px;padding:20px;min-width:240px;max-width:90%;text-align:center;box-shadow:0 10px 40px #0008}
  .gj-cap h1{margin:0 0 6px;font-size:26px}.gj-cap button{display:block;width:100%;margin:8px 0 0;padding:10px;border:0;border-radius:10px;font:inherit;font-weight:700;color:#fff;background:${ui.colorPrincipal};cursor:pointer}
  .gj-dlg{position:absolute;left:10px;right:10px;bottom:90px;background:rgba(10,14,24,.9);border:2px solid ${ui.colorPrincipal};border-radius:12px;padding:10px 14px}
  .gj-dlg[hidden]{display:none}.gj-tac{position:absolute;bottom:12px;left:12px;right:12px;display:flex;justify-content:space-between;pointer-events:none}
  .gj-tac div{display:flex;gap:8px}.gj-tac button{pointer-events:auto;width:58px;height:58px;border-radius:50%;border:2px solid #fff6;background:#0006;color:#fff;font-size:22px}
  .gj-mis{position:absolute;top:40px;left:10px;font-size:13px;background:rgba(0,0,0,.35);border-radius:8px;padding:4px 8px;pointer-events:none}
  </style><div class="gj"><canvas></canvas><div class="gj-hud"><span class="gj-vida"></span><span class="gj-pts"></span><span class="sp"></span><button class="gj-b gj-inv" ${ui.inventario ? "" : "hidden"}>🎒</button><button class="gj-b gj-pausa">⏸</button></div><div class="gj-mis"></div><div class="gj-dlg" hidden></div><div class="gj-tac" ${ui.controlesTactiles && matchMedia("(pointer:coarse)").matches ? "" : "hidden"}><div><button data-k="izq">◀</button><button data-k="der">▶</button></div><div>${j.genero === "aventura" ? '<button data-k="arriba">▲</button><button data-k="abajo">▼</button>' : ""}<button data-k="accion">💬</button>${j.genero === "aventura" ? "" : '<button data-k="saltar">⤒</button>'}</div></div><div class="gj-cap"></div></div>`;
  const $ = (s) => raiz.querySelector(s), lienzo = $("canvas"), cap = $(".gj-cap");
  const conf = { volumen: 0.5, ...(JSON.parse((() => { try { return localStorage.getItem(`gj-${j.nombre}`) || "{}"; } catch { return "{}"; } })())) };
  let st = crearEstado(j, Date.now()), en = {}, accionPrev = false, ctxA = null, r3d = null, g2 = null;
  const sonar = (f, d = 0.08) => { if (!conf.volumen) return; try { ctxA ??= new AudioContext(); const o = ctxA.createOscillator(), v = ctxA.createGain(); o.frequency.value = f; v.gain.value = conf.volumen * 0.2; o.connect(v).connect(ctxA.destination); o.start(); v.gain.exponentialRampToValueAtTime(0.0001, ctxA.currentTime + d); o.stop(ctxA.currentTime + d); } catch {} };
  if (j.vista === "3d" && op.three) { try { r3d = crear3D(op.three, lienzo, st); } catch (e) { console.warn(e); } }
  if (!r3d) g2 = lienzo.getContext("2d");
  const teclas = { ArrowLeft: "izq", a: "izq", ArrowRight: "der", d: "der", ArrowUp: j.genero === "aventura" ? "arriba" : "saltar", w: j.genero === "aventura" ? "arriba" : "saltar", ArrowDown: "abajo", s: "abajo", " ": j.genero === "aventura" ? "accion" : "saltar", e: "accion", Enter: "accion" };
  addEventListener("keydown", (e) => { if (e.key === "Escape" || e.key === "p") return pausar(); const k = teclas[e.key]; if (k) { en[k] = true; e.preventDefault(); } });
  addEventListener("keyup", (e) => { const k = teclas[e.key]; if (k) en[k] = false; });
  raiz.querySelectorAll(".gj-tac button").forEach((b) => { const k = b.dataset.k; b.onpointerdown = (e) => { en[k] = true; e.preventDefault(); }; b.onpointerup = b.onpointerleave = () => { en[k] = false; }; });
  const pantalla = (html, botones) => { cap.innerHTML = `<div>${html}${botones.map(([t]) => `<button>${t}</button>`).join("")}</div>`; cap.hidden = false; cap.querySelectorAll("button").forEach((b, i) => (b.onclick = botones[i][1])); };
  const jugar = () => { cap.hidden = true; st.pausa = false; };
  const reiniciar = () => { st = crearEstado(j, Date.now()); if (j.vista === "3d" && op.three) { try { r3d = crear3D(op.three, lienzo, st); } catch {} } jugar(); };
  const config = () => pantalla(`<h1>Configuración</h1><label>Volumen <input type="range" min="0" max="1" step="0.1" value="${conf.volumen}" class="gj-vol"></label><p style="font-size:13px;opacity:.8">Teclado: flechas o WASD · ${j.genero === "aventura" ? "espacio/E habla" : "espacio salta · E habla"} · P pausa</p>`, [["Listo", () => { conf.volumen = Number(cap.querySelector(".gj-vol").value); try { localStorage.setItem(`gj-${j.nombre}`, JSON.stringify(conf)); } catch {} st.pausa ? pausar() : menu(); }]]);
  const menu = () => { st.pausa = true; pantalla(`<h1>${esc(ui.titulo)}</h1><p>${esc(j.historia?.sinopsis || "")}</p>`, [["Jugar", jugar], ["Configuración", config]]); };
  const pausar = () => { if (st.fin) return; st.pausa = true; pantalla("<h1>Pausa</h1>", [["Seguir", jugar], ["Reiniciar", reiniciar], ["Configuración", config]]); };
  $(".gj-pausa").onclick = pausar;
  $(".gj-inv").onclick = () => { st.pausa = true; const xs = Object.entries(st.inventario); pantalla(`<h1>Inventario</h1>${xs.length ? xs.map(([id, n]) => `<p>${esc((j.items || []).find((d) => d.id === id)?.nombre || id)} × ${n}</p>`).join("") : "<p>Vacío</p>"}`, [["Volver", jugar]]); };
  if (ui.menu) menu(); else jugar();
  let previo = 0;
  const cuadro = (now) => {
    const dt = previo ? Math.min(3, (now - previo) / (1000 / 60)) : 1; previo = now;
    const W = lienzo.clientWidth, H = lienzo.clientHeight;
    if (g2 && (lienzo.width !== W || lienzo.height !== H)) { lienzo.width = W; lienzo.height = H; }
    paso(st, { ...en, accionNueva: en.accion && !accionPrev }, dt); accionPrev = !!en.accion;
    for (const e of st.eventos) ({ salto: () => sonar(520), item: () => sonar(880, 0.12), dano: () => sonar(140, 0.25), derrota: () => sonar(300, 0.15), mision: () => sonar(1040, 0.3) })[e]?.();
    if (r3d) r3d.render(W, H, now / 1000); else dibujar2D(g2, st, W, H, now / 1000);
    $(".gj-vida").textContent = "❤".repeat(Math.max(0, st.jugador.vida));
    $(".gj-pts").textContent = `${st.puntos} pts`;
    $(".gj-mis").innerHTML = st.misiones.map((m) => `${m.hecha ? "✅" : "⬜"} ${esc(m.titulo)}${m.objetivo?.cantidad > 1 && !m.hecha ? ` (${m.progreso}/${m.objetivo.cantidad})` : ""}`).join("<br>");
    const dl = $(".gj-dlg"); if (st.dialogo) { dl.hidden = false; dl.innerHTML = `<b>${esc(st.dialogo.quien)}:</b> ${esc(st.dialogo.lineas[st.dialogo.linea] || "")} <small style="opacity:.7">(acción para seguir)</small>`; } else dl.hidden = true;
    if (st.fin && cap.hidden) pantalla(`<h1>${st.fin === "ganaste" ? "¡Ganaste!" : "Perdiste"}</h1><p>${st.puntos} puntos · ${Math.round(st.tiempo)} s</p>`, [["Jugar de nuevo", reiniciar]]);
    requestAnimationFrame(cuadro);
  };
  requestAnimationFrame(cuadro);
  return { get estado() { return st; }, entrada: en };
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
if (ES_NAVEGADOR) window.GravityJuego = { crearEstado, paso, iniciar, dibujar2D, crear3D, VERSION };
