import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const A = await import("../src/almacen.ts");
const K = await import("../src/audio.ts");
const { wav } = await import("../src/creativo.ts");

mkdirSync(path.join(A.COMPUTADORA, "audio"), { recursive: true });
writeFileSync(path.join(A.COMPUTADORA, "audio/charla.wav"), wav(Buffer.alloc(48000)));
writeFileSync(path.join(A.COMPUTADORA, "audio/golpe.wav"), wav(Buffer.alloc(4800)));

test("tipo de audio por su contenido", () => {
  assert.equal(K.tipoAudio(wav(Buffer.alloc(10))), "audio/wav");
  assert.equal(K.tipoAudio(Buffer.from("ID3\x03\x00")), "audio/mpeg");
  assert.equal(K.tipoAudio(Buffer.from("OggS\x00")), "audio/ogg");
  assert.equal(K.tipoAudio(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0])), "audio/webm");
  assert.equal(K.tipoAudio(Buffer.from("hola mundo")), null);
  assert.throws(() => K.absoluta("../../etc/passwd"), /no está en la computadora/);
});

test("subtítulos: parte frases largas en bloques de 2 líneas, tiempos en orden, SRT y VTT válidos", () => {
  const largo = "Esta es una frase bastante larga que tiene que partirse en varios subtítulos para que se pueda leer bien en pantalla sin problemas";
  const segs = [{ inicio: 0, fin: 4.5, hablante: "Ana", texto: "Hola, ¿cómo estás?" }, { inicio: 5, fin: 15, hablante: "Beto", texto: largo }];
  const s = K.subtitulos(segs, true);
  assert.ok(s.length >= 3);
  for (const x of s) { assert.ok(x.fin > x.inicio); for (const l of x.texto.split("\n")) assert.ok(l.length <= 50, l); assert.ok(x.texto.split("\n").length <= 2); }
  for (let i = 1; i < s.length; i++) assert.ok(s[i].inicio >= s[i - 1].inicio);
  assert.equal(s.at(-1).fin, 15);
  const srt = K.srt(segs);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:04,500\nAna: Hola, ¿cómo estás\?\n/);
  assert.match(K.vtt(segs), /^WEBVTT\n\n00:00:00\.000 --> 00:00:04\.500\n/);
  assert.doesNotMatch(K.srt(segs, false), /Ana:/);
});

test("biblioteca: etiquetas, categoría, favoritos y filtros", () => {
  K.etiquetar("audio/golpe.wav", { etiquetas: ["Golpe", "seco", "golpe"], categoria: "efecto", favorito: true });
  assert.deepEqual(K.metaDe("audio/golpe.wav").etiquetas, ["golpe", "seco"]);
  assert.equal(K.biblioteca()[0].ruta, "audio/golpe.wav", "favoritos primero");
  assert.deepEqual(K.biblioteca({ categoria: "efecto" }).map((x) => x.ruta), ["audio/golpe.wav"]);
  assert.deepEqual(K.biblioteca({ q: "seco" }).map((x) => x.ruta), ["audio/golpe.wav"]);
  assert.equal(K.biblioteca({ etiqueta: "nada" }).length, 0);
  assert.ok(K.todasLasEtiquetas().includes("seco"));
});

test("transcribir: ordena, corrige solapamientos, escribe SRT/VTT/MD; renombrar hablantes y traducir con los mismos tiempos", async () => {
  const s = AbortSignal.timeout(5000);
  const original = { ...K.ia };
  let pedido = "";
  K.ia.gemini = async (_r, instr) => { pedido = instr; return { datos: { idioma: "es", resumen: "Charla corta.", segmentos: [{ inicio: 3, fin: 6, hablante: "Hablante 2", texto: "Bien, ¿y vos?" }, { inicio: 0, fin: 3.5, hablante: "Hablante 1", texto: "Hola, ¿cómo andás?" }, { inicio: 7, fin: 8, hablante: "Hablante 1", texto: "  " }] }, modelo: "gemini-prueba" }; };
  const r = await K.transcribir("audio/charla.wav", { hablantes: 2 }, s);
  assert.match(pedido, /Hay 2 personas/);
  assert.deepEqual(r.transcripcion.segmentos.map((x) => x.hablante), ["Hablante 1", "Hablante 2"]);
  assert.equal(r.transcripcion.segmentos[0].fin, 3, "no se pisa con el siguiente");
  assert.deepEqual(r.archivos, ["audio/charla.srt", "audio/charla.vtt", "audio/charla.transcripcion.md"]);
  assert.match(readFileSync(path.join(A.COMPUTADORA, "audio/charla.srt"), "utf8"), /Hablante 1: Hola/);
  const n = K.renombrarHablantes("audio/charla.wav", { "Hablante 1": "Ana", "Hablante 2": "Beto" });
  assert.deepEqual(n.transcripcion.segmentos.map((x) => x.hablante), ["Ana", "Beto"]);
  assert.match(readFileSync(path.join(A.COMPUTADORA, "audio/charla.vtt"), "utf8"), /Beto: Bien/);
  K.ia.traducir = async (textos, idioma) => textos.map((t) => `[${idioma}] ${t}`);
  const t = await K.traducir("audio/charla.wav", "inglés", s);
  assert.equal(t.segmentos[1].inicio, 3);
  assert.match(t.segmentos[1].texto, /^\[inglés\] Bien/);
  assert.ok(existsSync(path.join(A.COMPUTADORA, "audio/charla.ingles.srt")));
  K.ia.gemini = async () => ({ datos: { segmentos: [] }, modelo: "x" });
  await assert.rejects(K.transcribir("audio/golpe.wav", {}, s), /No se escuchó/);
  await assert.rejects(K.traducir("audio/golpe.wav", "inglés", s), /Primero transcribí/);
  Object.assign(K.ia, original);
});

test("consentimiento de una grabación de reunión", () => {
  K.registrarConsentimiento("audio/charla.wav", "Ana, Beto");
  const m = K.metaDe("audio/charla.wav");
  assert.equal(m.consentimiento.participantes, "Ana, Beto");
  assert.equal(m.categoria, "reunión");
});
