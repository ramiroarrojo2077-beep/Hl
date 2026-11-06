import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const A = await import("../src/almacen.ts");
const K = await import("../src/conocimiento.ts");

const escribir = (rel, txt) => { mkdirSync(path.dirname(path.join(A.COMPUTADORA, rel)), { recursive: true }); writeFileSync(path.join(A.COMPUTADORA, rel), txt); };

test("cuadernos: crear, documentos (copiados, el original queda), notas, búsqueda con fuente y biblioteca", () => {
  escribir("docs/revolucion.md", "# Revolución de Mayo\n\nEl 25 de mayo de 1810 se formó la Primera Junta en Buenos Aires.\n\nCornelio Saavedra presidió la Primera Junta.");
  escribir("docs/independencia.txt", "La independencia se declaró en Tucumán el 9 de julio de 1816.\n\nEl congreso sesionó en la casa de Francisca Bazán.");
  const c = K.crear({ nombre: "Historia Argentina", tema: "Siglo XIX" });
  assert.equal(c.nombre, "Historia-Argentina");
  assert.throws(() => K.crear({ nombre: "Historia Argentina" }), /Ya hay/);
  assert.equal(K.agregarDocumento(c.nombre, "docs/revolucion.md"), "revolucion.md");
  K.agregarDocumento(c.nombre, "docs/independencia.txt");
  assert.equal(K.agregarDocumento(c.nombre, "docs/revolucion.md"), "revolucion-2.md", "no pisa uno que ya está");
  K.quitarDocumento(c.nombre, "revolucion-2.md");
  assert.ok(existsSync(path.join(A.COMPUTADORA, "docs/revolucion.md")), "el original queda");
  assert.throws(() => K.agregarDocumento(c.nombre, "../../etc/passwd"), /computadora/);
  K.agregarNota(c.nombre, "Ojo: algunos libros dicen que Saavedra no presidió la Junta.");
  const r = K.buscar(c.nombre, "primera junta saavedra");
  assert.equal(r[0].doc, "revolucion.md");
  assert.equal(r[0].n, 1);
  assert.ok(r.some((f) => f.doc.startsWith("nota de usuario")));
  assert.equal(K.buscar(c.nombre, "Tucumán")[0].doc, "independencia.txt", "sin importar tildes");
  const b = K.biblioteca();
  assert.ok(b.some((x) => x.ruta === "docs/revolucion.md" && x.cuaderno === null));
  assert.ok(b.some((x) => x.cuaderno === "Historia-Argentina"));
  assert.equal(K.listar()[0].documentos, 2);
});

test("comparador de documentos: líneas agregadas, quitadas e iguales", () => {
  const r = K.comparar("uno\ndos\ntres\ncuatro", "uno\ntres\ntres y medio\ncuatro\ncinco");
  assert.deepEqual([r.iguales, r.quitadas, r.agregadas], [3, 1, 2]);
  assert.deepEqual(r.cambios.filter((x) => x.tipo !== "igual").map((x) => `${x.tipo[0]}${x.texto}`), ["qdos", "atres y medio", "acinco"]);
});

test("fichas con repaso espaciado (Leitner)", () => {
  K.crear({ nombre: "Repaso" });
  const f = K.agregarFicha("Repaso", { pregunta: "¿Capital de Francia?", respuesta: "París" });
  assert.equal(K.fichasParaHoy("Repaso").length, 1);
  let x = K.repasar("Repaso", f.id, true);
  assert.equal(x.caja, 2);
  assert.equal(K.fichasParaHoy("Repaso").length, 0, "acertada: se repasa más adelante");
  x = K.repasar("Repaso", f.id, false);
  assert.equal(x.caja, 1);
  assert.equal(K.fichasParaHoy("Repaso").length, 1, "errada: vuelve hoy");
});

test("orden de fechas de la línea de tiempo", () => {
  const xs = ["9 de julio de 1816", "1810-05-25", "500 a.C.", "marzo de 1816", "sin fecha"].sort((a, b) => K.ordenDeFecha(a) - K.ordenDeFecha(b));
  assert.deepEqual(xs, ["500 a.C.", "1810-05-25", "marzo de 1816", "9 de julio de 1816", "sin fecha"]);
});

test("con IA: citas verificadas, contradicciones solo entre fuentes distintas, mapa sin relaciones inválidas, fichas con fuente", async () => {
  const s = AbortSignal.timeout(5000);
  const original = K.ia.json;
  let vistoUsuario = "";
  K.ia.json = async (_e, _sis, usuario) => { vistoUsuario = usuario; return { respuesta: "La presidió Saavedra [1] y se juró en Tucumán [99].", citas: [1, 42], suficiente: true }; };
  const p = await K.preguntar("Historia-Argentina", "¿Quién presidió la Primera Junta?", s);
  assert.deepEqual(p.referencias.map((f) => f.n), [1], "las citas que no existen se descartan");
  assert.match(p.respuesta, /Tucumán \[sin fuente\]/);
  assert.match(vistoUsuario, /<fragmento n="1" fuente="revolucion.md">/);
  K.ia.json = async () => ({ contradicciones: [{ citaA: 1, afirmacionA: "Saavedra presidió", citaB: 3, afirmacionB: "No presidió", explicacion: "x" }, { citaA: 1, afirmacionA: "a", citaB: 1, afirmacionB: "b", explicacion: "misma fuente" }] });
  const co = await K.contradicciones("Historia-Argentina", s);
  assert.equal(co.length, 1);
  assert.notEqual(co[0].fuenteA, co[0].fuenteB);
  K.ia.json = async () => ({ nodos: [{ id: "a", etiqueta: "Primera Junta" }, { id: "b", etiqueta: "Saavedra" }], relaciones: [{ de: "b", a: "a", etiqueta: "preside" }, { de: "a", a: "zzz", etiqueta: "x" }, { de: "a", a: "a", etiqueta: "x" }] });
  const m = await K.generarMapa("Historia-Argentina", s);
  assert.equal(m.relaciones.length, 1);
  K.ia.json = async () => ({ eventos: [{ fecha: "9 de julio de 1816", titulo: "Independencia", detalle: "", cita: 2 }, { fecha: "25 de mayo de 1810", titulo: "Primera Junta", detalle: "", cita: 1 }, { fecha: "1900", titulo: "Inventado", detalle: "", cita: 77 }] });
  const l = await K.generarLinea("Historia-Argentina", s);
  assert.deepEqual(l.eventos.map((e) => e.titulo), ["Primera Junta", "Independencia"]);
  K.ia.json = async () => ({ fichas: [{ pregunta: "¿Cuándo se formó la Junta?", respuesta: "25/5/1810", cita: 1 }, { pregunta: "¿Inventada?", respuesta: "x", cita: 50 }] });
  const f = await K.generarFichas("Historia-Argentina", 10, s);
  assert.equal(f.length, 1);
  assert.ok(["revolucion.md", "independencia.txt"].includes(f[0].fuente));
  K.ia.json = original;
  K.crear({ nombre: "Vacio" });
  await assert.rejects(K.generarMapa("Vacio", s), /vacío/);
});

test("biblioteca colaborativa: el compañero solo ve los cuadernos compartidos con él y firma sus notas", async () => {
  const bot = A.crearBot({ nombre: "Lucía", titulo: "Investigadora", descripcion: "x" });
  const H = await import("../src/herramientas.ts");
  const t = (await H.herramientasDe(bot.id)).get("conocimiento");
  const correr = (entrada) => t.run(entrada);
  assert.equal(K.listar().filter((c) => K.puedeVer(c, bot.id)).length, 0);
  K.compartir("Historia-Argentina", [bot.id]);
  assert.ok(K.puedeVer(K.leer("Historia-Argentina"), bot.id));
  assert.ok(!K.puedeVer(K.leer("Repaso"), bot.id));
  const r = await correr({ accion: "listar", cuaderno: null, texto: null });
    assert.match(r, /Historia-Argentina/);
    assert.doesNotMatch(r, /Repaso/);
    assert.match(await correr({ accion: "buscar", cuaderno: "Repaso", texto: "x" }), /no está compartido/);
    await correr({ accion: "agregar_nota", cuaderno: "historia argentina", texto: "La Junta tuvo 9 miembros (fuente: revolucion.md)." });
  assert.equal(K.leer("Historia-Argentina").notas.at(-1).autor, "Lucía");
});
