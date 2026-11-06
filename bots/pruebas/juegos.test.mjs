import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const A = await import("../src/almacen.ts");
const G = await import("../src/juegos.ts");
const M = await import("../public/vendor/juego/motor.js");

test("el ejemplo es válido, alcanzable y el motor lo simula sin errores", async () => {
  const r = await G.probar(G.EJEMPLO);
  assert.deepEqual(r.errores, []);
  assert.equal(r.alcance.meta, true);
  assert.equal(r.alcance.items, r.alcance.itemsTotal);
  assert.equal(r.simulacion.corridas, 4);
  assert.deepEqual(r.simulacion.problemas, []);
});

test("motor: gravedad, colisión con el suelo, salto, ítems, daño de enemigo y diálogo con NPC", () => {
  const j = G.normalizar(G.EJEMPLO);
  const st = M.crearEstado(j, 1);
  for (let i = 0; i < 90; i++) M.paso(st, {}, 1);
  assert.equal(st.jugador.suelo, true, "cae y queda parado");
  const y0 = st.jugador.y;
  M.paso(st, { saltar: true }, 1);
  for (let i = 0; i < 8; i++) M.paso(st, {}, 1);
  assert.ok(st.jugador.y < y0 - 10, "salta");
  for (let i = 0; i < 120; i++) M.paso(st, {}, 1);
  // Diálogo: la Guía está al lado del inicio
  const guia = st.actores.find((a) => a.def.id === "guia");
  st.jugador.x = guia.x; st.jugador.y = guia.y;
  M.paso(st, { accion: true, accionNueva: true }, 1);
  assert.equal(st.dialogo?.quien, "Guía");
  M.paso(st, { accionNueva: true }); M.paso(st, { accionNueva: true });
  assert.equal(st.dialogo, null);
  assert.equal(st.misiones.find((m) => m.id === "m2").hecha, true);
  // Ítem
  const it = st.items[0]; st.jugador.x = it.x; st.jugador.y = it.y; st.jugador.vy = 0;
  M.paso(st, {}, 1);
  assert.equal(st.inventario.moneda, 1);
  assert.equal(st.puntos, 10);
  // Enemigo de costado: daña
  const slime = st.actores.find((a) => a.def.id === "slime"); const vida = st.jugador.vida;
  st.jugador.x = slime.x; st.jugador.y = slime.y; st.jugador.vy = 0; st.jugador.golpeado = 0;
  M.paso(st, {}, 1);
  assert.equal(st.jugador.vida, vida - 1);
});

test("aventura (vista de arriba) e IA: el que persigue se acerca, el que huye se aleja", () => {
  const j = G.normalizar(G.Juego.parse({ nombre: "Laberinto", genero: "aventura", mapa: { filas: ["##########", "#P.......#", "#........#", "#........#", "##########"] }, personajes: [{ id: "yo", nombre: "Yo", rol: "jugador", color: "#ffffff" }, { id: "lobo", nombre: "Lobo", rol: "enemigo", color: "#000000", velocidad: 1, ia: { tipo: "perseguir", rango: 20 } }, { id: "conejo", nombre: "Conejo", rol: "npc", color: "#eeeeee", velocidad: 1, ia: { tipo: "huir", rango: 20 } }], entidades: [{ personaje: "lobo", x: 7, y: 3 }, { personaje: "conejo", x: 4, y: 2 }], historia: { sinopsis: "x", misiones: [{ id: "m", titulo: "Hablá con el conejo", objetivo: { tipo: "hablar", objetivo: "conejo" } }] } }));
  const st = M.crearEstado(j, 1);
  const d = (a) => Math.hypot(a.x - st.jugador.x, a.y - st.jugador.y);
  const [lobo, conejo] = st.actores, l0 = d(lobo), c0 = d(conejo);
  for (let i = 0; i < 40; i++) M.paso(st, {}, 1);
  assert.ok(d(lobo) < l0, "persigue");
  assert.ok(d(conejo) > c0, "huye");
});

test("probador: detecta errores reales (sin inicio, meta inalcanzable, misión imposible, personaje inexistente)", async () => {
  const base = G.normalizar(G.EJEMPLO);
  const sinP = { ...base, mapa: { filas: base.mapa.filas.map((f) => f.replace("P", ".")) } };
  assert.match((await G.probar(sinP)).errores.join(), /Falta el inicio/);
  const muro = { ...base, mapa: { filas: base.mapa.filas.map((f, i) => (i < 6 ? f.slice(0, 30) + "#" + f.slice(31) : f)) } };
  assert.match((await G.probar(muro)).errores.join(), /no parece alcanzable/);
  const imposible = { ...base, historia: { sinopsis: "", misiones: [{ id: "x", titulo: "Mil monedas", objetivo: { tipo: "recolectar", objetivo: "moneda", cantidad: 1000 } }] } };
  assert.match((await G.probar(imposible)).errores.join(), /pide 1000/);
  const fantasma = { ...base, entidades: [...base.entidades, { personaje: "dragon", x: 2, y: 2 }] };
  assert.match((await G.probar(fantasma)).errores.join(), /no existe: dragon/);
});

test("guardar crea un proyecto jugable y los exportadores (HTML único y Tiled) son válidos", () => {
  const j = G.guardar("Mi juego", { ...G.EJEMPLO, vista: "3d" });
  const dir = path.join(A.COMPUTADORA, "codigo", "Mi juego");
  for (const f of ["juego.json", "index.html", "motor.js", "three.module.min.js", "three.core.min.js", "HISTORIA.md", "README.md"]) assert.ok(existsSync(path.join(dir, f)), f);
  assert.match(readFileSync(path.join(dir, "index.html"), "utf8"), /import \{ iniciar \} from "\.\/motor\.js"/);
  assert.deepEqual(G.listar().map((x) => x.nombre), ["Mi juego"]);
  const h = G.htmlUnico(j);
  assert.doesNotMatch(h, /<\/script>[\s\S]*<\/script>[\s\S]*<\/script>/, "un solo script");
  assert.match(h, /iniciar\(document\.getElementById\("juego"\)/);
  const t = G.tiled(j);
  assert.equal(t.layers[0].data.length, t.width * t.height);
  assert.ok(t.layers[0].data.every((g) => g >= 0 && g <= t.tilesets[0].tilecount));
  assert.equal(t.layers[1].objects.find((o) => o.name === "inicio").type, "jugador");
  assert.throws(() => G.guardar("../fuera", G.EJEMPLO), /inválido/);
  assert.throws(() => G.guardar("x", { ...G.EJEMPLO, personajes: [] }));
});

test("generar con IA: valida, prueba y reintenta con los errores; la historia solo usa lo que existe", async () => {
  const s = AbortSignal.timeout(5000), original = G.ia.json;
  let llamadas = 0, segundo = "";
  G.ia.json = async (_e, sis) => { llamadas++; if (llamadas === 1) return { ...G.EJEMPLO, mapa: { filas: G.EJEMPLO.mapa.filas.map((f) => f.replace("P", ".")) } }; segundo = sis; return G.EJEMPLO; };
  const r = await G.generar("un robot que junta monedas", {}, s);
  assert.equal(llamadas, 2);
  assert.match(segundo, /Falta el inicio/);
  assert.deepEqual(r.informe.errores, []);
  G.ia.json = async () => ({ sinopsis: "Nueva historia", misiones: [{ id: "a", titulo: "Hablar con la guía", objetivo: { tipo: "hablar", objetivo: "guia" } }, { id: "b", titulo: "Vencer al dragón", objetivo: { tipo: "derrotar", objetivo: "dragon" } }], dialogos: [{ personaje: "guia", lineas: ["Bienvenida"] }, { personaje: "dragon", lineas: ["Grr"] }], personajesNuevos: [{ nombre: "Dragón", descripcion: "jefe" }] });
  const h = await G.generarHistoria(G.EJEMPLO, "", s);
  assert.equal(h.juego.historia.misiones.length, 1);
  assert.equal(h.descartadas, 1);
  assert.deepEqual(h.juego.personajes.find((p) => p.id === "guia").dialogo, ["Bienvenida"]);
  G.ia.json = original;
});

test("plataformas: caer por un pozo hace perder (abajo del mapa no hay piso)", () => {
  const j = G.normalizar(G.Juego.parse({ nombre: "Pozo", genero: "plataformas", mapa: { filas: [".....", "P....", "##.##"] }, personajes: [{ id: "yo", nombre: "Yo", rol: "jugador", color: "#ffffff", vida: 3 }] }));
  const st = M.crearEstado(j, 1);
  st.jugador.x = 2 * 32 + 4;
  for (let i = 0; i < 200 && !st.fin; i++) M.paso(st, {}, 1);
  assert.equal(st.fin, "perdiste");
});
