import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const A = await import("../src/almacen.ts");
const X = await import("../src/x.ts");

test("firma OAuth 1.0a: vector oficial de la documentación de X", () => {
  const c = { apiKey: "xvz1evFS4wEEPTGEFPHBog", apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw", accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", accessSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE" };
  const h = X.firmarOAuth1("POST", "https://api.twitter.com/1.1/statuses/update.json?include_entities=true", c, { status: "Hello Ladies + Gentlemen, a signed OAuth request!" }, { nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", timestamp: "1318622958" });
  assert.match(h, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);
  assert.match(h, /^OAuth oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"/);
});

test("peso como lo cuenta X y división en hilo", () => {
  assert.equal(X.peso("hola"), 4);
  assert.equal(X.peso("mirá https://ejemplo.com/una/ruta/larguisima?x=1"), 5 + 23);
  assert.equal(X.peso("日本"), 4);
  assert.equal(X.peso("👍🏽"), 2, "un emoji con tono cuenta 2");
  assert.deepEqual(X.dividirHilo("corto"), ["corto"]);
  const largo = Array.from({ length: 30 }, (_, i) => `Esta es la oración número ${i + 1} del texto.`).join(" ");
  const h = X.dividirHilo(largo);
  assert.ok(h.length >= 4);
  for (const [i, p] of h.entries()) { assert.ok(X.peso(p) <= 280, `${X.peso(p)}`); assert.match(p, new RegExp(` ${i + 1}/${h.length}$`)); }
  assert.ok(h[0].startsWith("Esta es la oración número 1 del texto."), "corta en oraciones");
  const palabra = "a".repeat(700);
  assert.ok(X.dividirHilo(palabra).every((p) => X.peso(p) <= 280));
});

// Una API de X de prueba.
const vistos = [];
let modo = "ok", tweets = 0;
const srv = http.createServer((req, res) => {
  const partes = []; req.on("data", (x) => partes.push(x)); req.on("end", () => {
    const cuerpo = Buffer.concat(partes);
    vistos.push({ m: req.method, u: req.url, auth: req.headers.authorization ?? "", tipo: req.headers["content-type"] ?? "", cuerpo: cuerpo.toString("latin1") });
    const j = (code, o, h = {}) => res.writeHead(code, { "content-type": "application/json", ...h }).end(JSON.stringify(o));
    if (!String(req.headers.authorization).startsWith("OAuth ")) return j(401, { title: "Unauthorized" });
    if (modo === "401") return j(401, { title: "Unauthorized" });
    if (modo === "429") return j(429, { title: "Too Many Requests" }, { "x-rate-limit-reset": "1893456000" });
    if (req.url === "/2/users/me") return j(200, { data: { id: "42", username: "gravityapp", name: "Gravity" } });
    if (req.url === "/2/media/upload") return modo === "sinv2" ? j(404, { title: "Not Found" }) : j(200, { data: { id: "m-v2" } });
    if (req.url === "/1.1/media/upload.json") return j(200, { media_id_string: "m-v1" });
    if (req.url === "/2/tweets" && req.method === "POST") { tweets++; if (modo === "falla2" && tweets === 2) return j(403, { detail: "duplicate content" }); return j(201, { data: { id: String(1000 + tweets), text: JSON.parse(cuerpo).text } }); }
    if (req.url.startsWith("/2/tweets/") && req.method === "DELETE") return j(200, { data: { deleted: true } });
    if (req.url.startsWith("/2/users/42/tweets")) return j(200, { data: [{ id: "9", text: "hola", created_at: "2026-11-07T10:00:00Z", public_metrics: { like_count: 3, retweet_count: 1 } }] });
    j(404, {});
  });
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
process.env.X_API_BASE = `http://127.0.0.1:${srv.address().port}`;
process.env.X_UPLOAD_BASE = process.env.X_API_BASE;
const cred = { apiKey: "k", apiSecret: "s", accessToken: "1-t", accessSecret: "ts" };
mkdirSync(path.join(A.COMPUTADORA, "fotos"), { recursive: true });
writeFileSync(path.join(A.COMPUTADORA, "fotos/a.png"), Buffer.from("89504e470d0a1a0a", "hex"));
writeFileSync(path.join(A.COMPUTADORA, "fotos/doc.pdf"), "x");

test("publicar un hilo con imagen: sube la imagen, responde cada parte a la anterior", async () => {
  modo = "ok"; tweets = 0; vistos.length = 0;
  const r = await X.publicarHilo(cred, ["Primera 1/2", "Segunda 2/2"], ["fotos/a.png"]);
  assert.deepEqual(r.ids, ["1001", "1002"]);
  assert.deepEqual(r.urls, ["https://x.com/gravityapp/status/1001", "https://x.com/gravityapp/status/1002"]);
  const posts = vistos.filter((v) => v.u === "/2/tweets").map((v) => JSON.parse(v.cuerpo));
  assert.deepEqual(posts[0], { text: "Primera 1/2", media: { media_ids: ["m-v2"] } });
  assert.deepEqual(posts[1], { text: "Segunda 2/2", reply: { in_reply_to_tweet_id: "1001" } });
  const sub = vistos.find((v) => v.u === "/2/media/upload");
  assert.match(sub.tipo, /^multipart\/form-data/);
  assert.match(sub.cuerpo, /name="media_category"\r\n\r\ntweet_image/);
  assert.ok(vistos.every((v) => /oauth_signature="/.test(v.auth)));
});

test("si no está el endpoint nuevo de imágenes, usa el v1.1; rechaza archivos que no son imagen", async () => {
  modo = "sinv2"; tweets = 0; vistos.length = 0;
  await X.publicarHilo(cred, ["con foto"], ["fotos/a.png"]);
  assert.deepEqual(JSON.parse(vistos.find((v) => v.u === "/2/tweets").cuerpo).media.media_ids, ["m-v1"]);
  await assert.rejects(X.publicarHilo(cred, ["x"], ["fotos/doc.pdf"]), /PNG, JPG/);
  await assert.rejects(X.publicarHilo(cred, ["x"], ["../../etc/passwd"]), /No está en la computadora/);
  await assert.rejects(X.publicarHilo(cred, ["a".repeat(281)]), /pesa 281/);
});

test("errores claros: claves, límite y una parte del hilo que falla", async () => {
  modo = "401"; await assert.rejects(X.yo(cred), /rechazó las claves/);
  modo = "429"; await assert.rejects(X.yo(cred), /límite de la API/);
  modo = "falla2"; tweets = 0;
  await assert.rejects(X.publicarHilo(cred, ["uno", "dos", "tres"]), /Se publicaron 1 de 3 partes \(https:\/\/x.com\/gravityapp\/status\/1001\)\. Falló la parte 2: .*duplicate content/);
  modo = "ok";
});

test("programar, cancelar y publicar las que llegaron a su hora", async () => {
  modo = "ok"; tweets = 0;
  assert.throws(() => X.programar({ conexion: "c1", textos: ["x"], imagenes: [], cuando: new Date(Date.now() - 1000).toISOString() }), /futuro/);
  const p = X.programar({ conexion: "c1", textos: ["Programada"], imagenes: [], cuando: new Date(Date.now() + 120_000).toISOString() });
  const q = X.programar({ conexion: "c1", textos: ["Cancelada"], imagenes: [], cuando: new Date(Date.now() + 120_000).toISOString() });
  X.cancelar(q.id);
  assert.equal(await X.revisarProgramadas(() => cred), 0, "todavía no es la hora");
  p.cuando = new Date(Date.now() - 1000).toISOString();
  let avisado = false;
  assert.equal(await X.revisarProgramadas(() => cred, () => { avisado = true; }), 1);
  assert.equal(avisado, true);
  const ps = X.programadas();
  assert.equal(ps.find((x) => x.id === p.id).estado, "publicada");
  assert.ok(!ps.some((x) => x.id === q.id), "las canceladas no se listan");
  assert.equal(X.historial()[0].quien, "programada");
});

test("la conexión: valida las claves contra X, las guarda cifradas y publica con aprobación", async () => {
  const C = await import("../src/conexiones.ts");
  modo = "ok";
  await assert.rejects(C.crearConexion("x", "X", { apiKey: "k", apiSecret: "s", accessToken: "bearer-sin-guion", accessSecret: "t" }, []), /Access Token de X empieza/);
  const c = await C.crearConexion("x", "Mi X", { ...cred }, []);
  const v = C.listarConexiones().find((x) => x.tipo === "x");
  assert.equal(v.cuenta, "@gravityapp");
  assert.equal(v.secreto, undefined, "las claves no salen");
  assert.deepEqual(v.acciones.map((a) => [a.nombre, a.escritura]), [["publicar", true], ["mis_publicaciones", false], ["borrar", true]]);
  assert.deepEqual(C.credencialesX(v.id), cred);
  // Un compañero sin permiso para mandar cosas afuera no puede publicar.
  const bot = A.crearBot({ nombre: "Ana", titulo: "Redes", descripcion: "x" });
  C.actualizarConexion(v.id, { bots: [bot.id] });
  await assert.rejects(C.ejecutarConexion(bot.id, { conexion: v.id, accion: "publicar", parametros: JSON.stringify({ texto: "hola" }) }), /permiso para mandar cosas afuera/);
  bot.puedeEnviarAfuera = true;
  assert.ok(C.pedidoDeConexion(bot.id, { conexion: v.id, accion: "publicar", parametros: '{"texto":"hola"}' }), "publicar pide aprobación");
  assert.equal(C.pedidoDeConexion(bot.id, { conexion: v.id, accion: "mis_publicaciones", parametros: "{}" }), null, "leer no");
  assert.match(await C.ejecutarConexion(bot.id, { conexion: v.id, accion: "publicar", parametros: JSON.stringify({ texto: "Hola desde Gravity" }) }), /Publicado: https:\/\/x.com\/gravityapp\/status\//);
  assert.match(await C.ejecutarConexion(bot.id, { conexion: v.id, accion: "mis_publicaciones", parametros: "{}" }), /hola · ❤ 3/);
  srv.close();
  void c;
});
