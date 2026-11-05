import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const A = await import("../src/almacen.ts");
const E = await import("../src/equipo.ts");
const T = await import("../src/talento.ts");
const { emitir } = await import("../src/eventos.ts");
const { registrar } = await import("../src/actividad.ts");
const { conflictosDeArchivos } = await import("../src/auditoria.ts");
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

test("confianza, delegación automática, respaldo y mentoría con datos reales", async () => {
  T.iniciarTalento();
  const jefa = A.crearBot({ nombre: "Rita", titulo: "Coordinadora", descripcion: "x", cargo: "manager" });
  const dis = A.crearBot({ nombre: "Dani", titulo: "Diseñadora gráfica", descripcion: "Logos, ilustraciones y paletas de color", reportaA: jefa.id });
  const pro = A.crearBot({ nombre: "Pablo", titulo: "Programador backend", descripcion: "APIs, bases de datos y servidores Node", reportaA: jefa.id });
  assert.equal(T.confianzaDe(dis.id).nivel, "sin datos");
  // auto elige por afinidad
  const [t1] = E.crearTareas(jefa, "Marca", [{ para: "auto", titulo: "Diseñar el logo", instrucciones: "Un logo con paleta de color para la marca", entregable: "logo.svg" }], {});
  assert.equal(t1.paraId, dis.id, "el logo va a la diseñadora");
  const [t2] = E.crearTareas(jefa, "API", [{ para: "auto", titulo: "Armar la API", instrucciones: "Servidor Node con base de datos", entregable: "api/" }], {});
  assert.equal(t2.paraId, pro.id, "la API va al programador");
  // confianza con resultados
  for (const t of [t1, t2]) { t.estado = "completa"; t.resultado = "ok"; t.fin = new Date().toISOString(); }
  assert.ok(T.confianzaDe(dis.id).puntaje > 50);
  // respaldo: apagado no hace nada
  const [t3] = E.crearTareas(jefa, "API", [{ para: pro.id, titulo: "Endpoint de pagos", instrucciones: "Servidor Node", entregable: "x" }], {});
  t3.estado = "fallida"; t3.resultado = "Se trabó"; t3.fin = new Date().toISOString();
  emitir("tarea", { id: t3.id });
  await espera(100);
  assert.ok(!A.listarTareas().some((t) => t.titulo === "Endpoint de pagos (respaldo)"));
  // prendido: otro miembro la retoma una vez, y se avisa al manager
  A.cambiarAjustes({ respaldoAutomatico: true });
  const [t4] = E.crearTareas(jefa, "API", [{ para: pro.id, titulo: "Endpoint de usuarios", instrucciones: "Servidor Node", entregable: "x" }], {});
  t4.estado = "vencida"; t4.resultado = "Se venció"; t4.fin = new Date().toISOString();
  emitir("tarea", { id: t4.id });
  await espera(150);
  const r = A.listarTareas().find((t) => t.titulo === "Endpoint de usuarios (respaldo)");
  assert.ok(r && r.paraId === dis.id && /\[Respaldo\] Pablo/.test(r.instrucciones));
  assert.ok(A.conversacion(jefa.id).notas.some((n) => /Respaldo automático/.test(n.texto)));
  // mentoría: al terminar, el mentor recibe el trabajo para revisarlo
  dis.mentorId = jefa.id;
  const [t5] = E.crearTareas(jefa, "Marca", [{ para: dis.id, titulo: "Paleta", instrucciones: "Tres colores", entregable: "paleta.md" }], {});
  t5.estado = "completa"; t5.resultado = "Listo: azul, cian, violeta"; t5.fin = new Date().toISOString();
  emitir("tarea", { id: t5.id });
  await espera(150);
  assert.ok(A.conversacion(jefa.id).mensajes.some((m) => typeof m.content === "string" ? /\[Mentoría\] Dani/.test(m.content) : JSON.stringify(m.content).includes("[Mentoría] Dani")));
  assert.deepEqual(T.aprendicesDe(jefa.id).map((b) => b.nombre), ["Dani"]);
  // conflictos: dos compañeros tocan el mismo archivo en minutos
  registrar({ botId: dis.id, tipo: "herramienta", que: "Escribiendo informe.md", ok: true, detalle: "" });
  registrar({ botId: pro.id, tipo: "herramienta", que: "Editando informe.md", ok: true, detalle: "" });
  assert.match(conflictosDeArchivos([jefa, dis, pro])[0] ?? "", /Posible conflicto en informe.md: Dani y Pablo/);
});
