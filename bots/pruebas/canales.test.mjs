import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const A = await import("../src/almacen.ts");
const K = await import("../src/canales.ts");
const P = await import("../src/proyectos.ts");
const E = await import("../src/equipo.ts");
const { emitir } = await import("../src/eventos.ts");
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const recibio = (botId, re) => A.conversacion(botId).mensajes.some((m) => re.test(typeof m.content === "string" ? m.content : JSON.stringify(m.content)));

test("canales: anuncios, equipo, menciones, permisos, comentarios en tareas y anuncios automáticos", async () => {
  K.iniciarCanales();
  const jefa = A.crearBot({ nombre: "Rita", titulo: "Coordinadora", descripcion: "x", cargo: "manager" });
  const dev = A.crearBot({ nombre: "Dino Pérez", titulo: "Dev", descripcion: "x", reportaA: jefa.id });
  const otro = A.crearBot({ nombre: "Olga", titulo: "Ventas", descripcion: "x" });
  const cs = K.listarCanales();
  const anuncios = cs.find((c) => c.tipo === "anuncios"), equipo = cs.find((c) => c.tipo === "equipo");
  assert.ok(anuncios && equipo && equipo.nombre === "equipo-rita");
  assert.deepEqual(K.miembros(equipo).map((b) => b.nombre).sort(), ["Dino Pérez", "Rita"]);
  // mención con el primer nombre, sin acentos
  await K.publicar(equipo.id, "usuario", "@dino ¿cómo va el login?");
  await espera(50);
  assert.ok(recibio(dev.id, /\[Canal #equipo-rita\] Vos te mencionó: @dino/), "Dino recibe la mención con contexto");
  assert.ok(!recibio(jefa.id, /\[Canal #equipo-rita\]/), "a Rita no la mencionaron");
  await K.publicar(equipo.id, dev.id, "Va bien, @Rita lo reviso mañana");
  await espera(50);
  assert.ok(recibio(jefa.id, /Dino Pérez te mencionó/));
  await assert.rejects(K.publicar(equipo.id, otro.id, "hola"), /No formás parte/);
  await assert.rejects(K.publicar(anuncios.id, dev.id, "hola"), /solo Gravity/);
  // comentarios en tareas: avisan al responsable y a los mencionados
  const p = P.crearProyecto({ nombre: "Web", objetivo: "Sitio" });
  const tina = A.crearBot({ nombre: "Tina", titulo: "Front", descripcion: "x" });
  const t0 = P.agregarTarea(p.id, { titulo: "Diseño" });
  const t = P.agregarTarea(p.id, { titulo: "Login", asignadoA: tina.id, dependeDe: [t0.id] }); // bloqueada: no se despacha
  await P.comentarTarea(p.id, t.id, "usuario", "Usá OAuth. @Olga fijate el texto de bienvenida");
  await espera(50);
  assert.equal(P.buscarProyecto(p.id).tareas[1].comentarios.length, 1);
  assert.ok(recibio(tina.id, /\[Comentario en la tarea «Login»/));
  assert.ok(recibio(otro.id, /@Olga fijate/));
  // anuncio automático cuando una tarea de primer nivel se completa
  const [tt] = E.crearTareas(jefa, "Login", [{ para: dev.id, titulo: "Pantalla de login", instrucciones: "x", entregable: "x" }], {});
  tt.estado = "completa"; tt.resultado = "ok"; tt.fin = new Date().toISOString();
  emitir("tarea", { id: tt.id });
  await espera(50);
  assert.ok(K.buscarCanal("anuncios").mensajes.some((m) => /Dino Pérez completó «Pantalla de login»/.test(m.texto)));
  assert.throws(() => K.borrarCanal(equipo.id), /Solo se borran/);
  const libre = K.crearCanal("Ideas Locas");
  assert.equal(libre.nombre, "ideas-locas");
  K.borrarCanal(libre.id);
  assert.ok(!K.buscarCanal("ideas-locas"));
});
