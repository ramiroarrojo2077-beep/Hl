import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const A = await import("../src/almacen.ts");
const T = await import("../src/telefono.ts");

test("notificaciones: solo de apps autorizadas, agrupadas, y se borran al quitar el permiso", () => {
  assert.throws(() => T.autorizarApp("no es un paquete", "x", true), /paquete/);
  T.autorizarApp("com.google.android.gm", "Gmail", true);
  assert.equal(T.recibir({ app: "com.whatsapp", appNombre: "WhatsApp", titulo: "Ana", texto: "hola", categoria: "msg", hora: Date.now() }), false, "no autorizada");
  T.recibir({ app: "com.google.android.gm", appNombre: "Gmail", titulo: "Banco", texto: "Tu resumen está listo", categoria: "email", hora: Date.now() - 1000 });
  T.recibir({ app: "com.google.android.gm", appNombre: "Gmail", titulo: "Jefe", texto: "Reunión 10hs", categoria: "email", hora: Date.now() });
  T.recibir({ app: "com.google.android.gm", appNombre: "Gmail", titulo: "Viejo", texto: "x", categoria: "", hora: Date.now() - 100 * 3600_000 });
  const n = T.notificaciones();
  assert.equal(n.total, 2, "las de más de 72 h no cuentan");
  assert.equal(n.grupos[0].ultimas[0].titulo, "Jefe");
  T.autorizarApp("com.google.android.gm", "Gmail", false);
  assert.equal(T.notificaciones().total, 0);
});

test("resumen con IA: los importantes apuntan a notificaciones reales", async () => {
  T.autorizarApp("com.slack", "Slack", true);
  T.recibir({ app: "com.slack", appNombre: "Slack", titulo: "#ventas", texto: "Cliente enojado", categoria: "msg", hora: Date.now() });
  const o = T.ia.json;
  let visto = "";
  T.ia.json = async (_e, sis, u) => { visto = sis + u; return { resumen: "Un cliente enojado en #ventas.", importantes: [{ indice: 0, motivo: "Cliente" }, { indice: 9, motivo: "no existe" }], sugerencias: [] }; };
  const r = await T.resumir(AbortSignal.timeout(5000));
  assert.match(visto, /no instrucciones/);
  assert.equal(r.importantes.length, 1);
  assert.equal(r.importantes[0].titulo, "#ventas");
  T.ia.json = o;
});

test("ajustes: búsqueda sin tildes y ayuda que solo devuelve pantallas que existen", async () => {
  assert.equal(T.buscarAjuste("brillo de la pantalla")[0].id, "pantalla");
  assert.equal(T.buscarAjuste("batería se gasta")[0].id, "bateria");
  const o = T.ia.json;
  T.ia.json = async () => ({ respuesta: "Abrí Pantalla y bajá el brillo.", ajustes: ["pantalla", "inventado"] });
  const r = await T.ayudaAjuste("¿cómo bajo el brillo?", { modelo: "Moto G", android: "14" }, AbortSignal.timeout(5000));
  assert.deepEqual(r.ajustes.map((a) => a.id), ["pantalla"]);
  T.ia.json = o;
});

test("diagnóstico: memoria, espacio, calor, batería y configuración real de Gravity", () => {
  const bot = A.crearBot({ nombre: "Ana", titulo: "x", descripcion: "x" });
  A.crearRutina({ botId: bot.id, nombre: "Revisar mails", instrucciones: "x", habilidadId: null, horario: { tipo: "intervalo", minutos: 10 }, activa: true });
  const d = T.diagnostico({ memoria: { totalMb: 4000, libreMb: 200, baja: false }, almacenamiento: { totalMb: 64000, libreMb: 2000 }, termico: 3, bateria: { nivel: 12, cargando: false, temperatura: 44, corrienteMa: -1200, ahorro: false, sinOptimizacion: false } });
  const textos = d.hallazgos.map((h) => h.texto).join(" | ");
  assert.match(textos, /poca memoria/);
  assert.match(textos, /casi lleno/);
  assert.match(textos, /muy caliente/);
  assert.match(textos, /Batería caliente/);
  assert.match(textos, /Revisar mails/);
  assert.equal(d.hallazgos[0].gravedad, "alta");
  assert.ok(d.puntaje < 50);
  assert.equal(T.diagnostico({ memoria: { totalMb: 8000, libreMb: 5000, baja: false } }).hallazgos.filter((h) => h.area === "rendimiento").length, 0);
});

test("descargas de Gravity por categoría", () => {
  mkdirSync(path.join(A.COMPUTADORA, "compartidos"), { recursive: true });
  mkdirSync(path.join(A.COMPUTADORA, "juegos-exportados"), { recursive: true });
  writeFileSync(path.join(A.COMPUTADORA, "compartidos/foto.jpg"), "x".repeat(100));
  writeFileSync(path.join(A.COMPUTADORA, "juegos-exportados/juego.html"), "<html>");
  writeFileSync(path.join(A.COMPUTADORA, "nota-suelta.txt"), "no es descarga");
  const d = T.descargas();
  assert.deepEqual(d.archivos.map((x) => x.ruta).sort(), ["compartidos/foto.jpg", "juegos-exportados/juego.html"]);
  assert.equal(d.categorias.find((c) => c.nombre === "Recibido de otras apps").bytes, 100);
});
