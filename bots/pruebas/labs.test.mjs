import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const A = await import("../src/almacen.ts");
const P = await import("../src/proyectos.ts");
const L = await import("../src/labs.ts");
const Au = await import("../src/automatizaciones.ts");

const ana = A.crearBot({ nombre: "Ana", titulo: "Analista", descripcion: "x" });
const beto = A.crearBot({ nombre: "Beto", titulo: "Redactor", descripcion: "x" });
const p = P.crearProyecto({ nombre: "Lanzamiento", objetivo: "Lanzar la web", coordinadorId: ana.id, carpeta: "" });
const t1 = P.agregarTarea(p.id, { titulo: "Investigar", asignadoA: ana.id, criterio: "informe" });
const t2 = P.agregarTarea(p.id, { titulo: "Escribir textos", asignadoA: beto.id, dependeDe: [t1.id] });
const t3 = P.agregarTarea(p.id, { titulo: "Diseño", dependeDe: [t1.id] });
const t4 = P.agregarTarea(p.id, { titulo: "Publicar", dependeDe: [t2.id, t3.id], vence: "2020-01-01" });

test("gemelo digital: niveles, bloqueadas y camino crítico", () => {
  const g = L.gemelo(p.id);
  const n = Object.fromEntries(g.nodos.map((x) => [x.titulo, x]));
  assert.deepEqual([n.Investigar.nivel, n["Escribir textos"].nivel, n.Publicar.nivel], [0, 1, 2]);
  assert.equal(n.Investigar.bloqueada, false);
  assert.equal(n.Publicar.bloqueada, true);
  assert.equal(g.critico.length, 3);
  assert.equal(g.critico[0], t1.id);
  assert.equal(g.critico.at(-1), t4.id);
  assert.equal(g.aristas.length, 4);
  P.cambiarTarea(p.id, t1.id, { estado: "completada" });
  assert.equal(L.gemelo(p.id).critico[0] !== t1.id, true, "lo terminado sale del camino crítico");
});

test("simulación Monte Carlo (PERT): percentiles en orden, menos personas tarda más, ciclos y datos inválidos", () => {
  const tareas = L.tareasParaSimular(p.id);
  assert.equal(tareas.length, 3);
  const r = L.simular(tareas, { semilla: 7 });
  assert.ok(r.minimo <= r.p50 && r.p50 <= r.p80 && r.p80 <= r.p95 && r.p95 <= r.maximo);
  assert.ok(r.p50 >= 2 && r.p50 <= 8, `${r.p50}`);
  assert.equal(r.histograma.reduce((a, b) => a + b, 0), r.corridas);
  assert.equal(r.criticidad.find((c) => c.titulo === "Publicar").pct, 100);
  const uno = L.simular(tareas, { semilla: 7, personas: 1 });
  assert.ok(uno.p50 > r.p50, "con una sola persona no hay paralelo");
  assert.deepEqual(L.simular(tareas, { semilla: 7 }), r, "misma semilla, mismo resultado");
  assert.throws(() => L.simular([{ id: "a", titulo: "A", min: 1, probable: 2, max: 3, dependeDe: ["b"] }, { id: "b", titulo: "B", min: 1, probable: 2, max: 3, dependeDe: ["a"] }]), /ciclo/);
  assert.throws(() => L.simular([{ id: "a", titulo: "A", min: 3, probable: 2, max: 1, dependeDe: [] }]), /mínimo/);
});

test("Project Doctor: hallazgos reales y plan con responsables reconocidos", async () => {
  const s = L.salud(P.buscarProyecto(p.id));
  const textos = s.hallazgos.map((h) => h.texto);
  assert.ok(textos.includes("Tareas vencidas"));
  assert.ok(textos.includes("Tareas sin responsable"));
  assert.ok(s.puntaje < 100);
  const original = L.ia.json;
  L.ia.json = async (_e, _s, u) => { assert.match(u, /Tareas vencidas/); return { diagnostico: "Falta responsable y está vencido.", pasos: [{ titulo: "Asignar diseño", detalle: "x", criterio: "asignado", prioridad: 1, responsable: "beto" }, { titulo: "Reprogramar", detalle: "x", criterio: "fecha nueva", prioridad: 2, responsable: "Nadie" }] }; };
  const r = await L.recetar(p.id, AbortSignal.timeout(5000));
  assert.equal(r.pasos[0].asignadoA, beto.id);
  assert.equal(r.pasos[1].asignadoA, null);
  L.ia.json = original;
});

test("Workflow Generator: resuelve compañero y evento, y avisa lo que falta", async () => {
  const original = L.ia.json;
  L.ia.json = async () => ({ tipo: "automatizacion", nombre: "Avisar fallas", companero: "ana", instrucciones: "Revisá la falla.", evento: "tarea_fallida", horario: { tipo: "ninguno", minutos: null, hora: null, dia: null, fecha: null }, explicacion: "x", dudas: [] });
  const r = await L.generarFlujo("si falla una tarea que Ana la revise", AbortSignal.timeout(5000));
  assert.equal(r.botId, ana.id);
  assert.equal(r.evento, "tarea_fallida");
  assert.deepEqual(r.problemas, []);
  L.ia.json = async () => ({ tipo: "rutina", nombre: "x", companero: "Zoe", instrucciones: "x", evento: "", horario: { tipo: "ninguno", minutos: null, hora: null, dia: null, fecha: null }, explicacion: "", dudas: ["¿A qué hora?"] });
  const m = await L.generarFlujo("algo todos los días", AbortSignal.timeout(5000));
  assert.equal(m.botId, null);
  assert.equal(m.problemas.length, 3);
  L.ia.json = original;
});

test("Agent Arena: juez ciego, ranking acumulado y fallas aisladas", async () => {
  const oj = L.ia.json, ot = L.ia.texto;
  L.ia.texto = async (_s, _u, _sig, botId) => ({ texto: botId === ana.id ? "Eslogan uno" : "Eslogan dos", ms: 10, modelo: "m" });
  let vistoJuez = "";
  L.ia.json = async (_e, _s, u) => { vistoJuez = u; return { evaluaciones: [{ participante: 1, puntaje: 6, fortalezas: "", debilidades: "" }, { participante: 2, puntaje: 9, fortalezas: "clara", debilidades: "" }], ganador: 2, razon: "Más clara" }; };
  const r = await L.arena("Escribí un eslogan", [ana.id, beto.id], "", AbortSignal.timeout(5000));
  assert.doesNotMatch(vistoJuez, /Ana|Beto/, "el juez no sabe quién es quién");
  assert.equal(r.ganador, beto.id);
  assert.equal(r.resultado[0].nombre, "Beto");
  assert.deepEqual(L.tablaArena().map((x) => [x.nombre, x.ganadas, x.jugadas]), [["Beto", 1, 1], ["Ana", 0, 1]]);
  L.ia.texto = async (_s, _u, _sig, botId) => { if (botId === ana.id) throw new Error("sin cupo"); return { texto: "x", ms: 1, modelo: "m" }; };
  await assert.rejects(L.arena("x".repeat(10), [ana.id, beto.id], "", AbortSignal.timeout(5000)), /Menos de dos/);
  L.ia.json = oj; L.ia.texto = ot;
});

test("Quality Inspector: revisión automática sin IA", () => {
  const r = L.revisionAutomatica("# Informe\n\nTODO completar esto esto.\n\n## Vacía\n\n## Fin\n\nVer [anexo](anexo.pdf) y [web](https://x.com).");
  const tipos = r.avisos.map((a) => a.tipo);
  assert.ok(tipos.includes("Marcadores sin resolver"));
  assert.ok(tipos.includes("Secciones vacías"));
  assert.ok(tipos.includes("Enlaces a archivos que no existen"));
  assert.ok(tipos.includes("Palabras repetidas"));
  assert.deepEqual(r.avisos.find((a) => a.tipo === "Secciones vacías").detalle, "Vacía", "la que tiene texto no cuenta");
});

test("Learning Center y Nexus usan el estado real", async () => {
  const l = await L.progresoAprendizaje();
  assert.equal(l.find((x) => x.id === "companero").hecha, true);
  assert.equal(l.find((x) => x.id === "proyecto").hecha, true);
  assert.equal(l.find((x) => x.id === "automatizacion").hecha, false);
  Au.crearAutomatizacion({ nombre: "Fallas", evento: "tarea_fallida", botId: ana.id, instrucciones: "Revisá." });
  assert.equal((await L.progresoAprendizaje()).find((x) => x.id === "automatizacion").hecha, true);
  const n = await L.nexus();
  assert.ok(n.nodos.some((x) => x.tipo === "automatización"));
  assert.ok(n.aristas.some((e) => e.de === `b:${ana.id}` && e.a === `p:${p.id}` && e.tipo === "coordina"));
  assert.ok(n.aristas.some((e) => e.de === `b:${beto.id}` && e.tipo === "trabaja en"));
  assert.ok(L.misiones()[0].salud.puntaje <= 100);
});
