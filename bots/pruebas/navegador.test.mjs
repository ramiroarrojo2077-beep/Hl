import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const K = await import("../src/navegador.ts");

// Un "internet" de prueba en esta máquina (la app nunca abre la red local; esto solo vale con la variable de pruebas).
let recibidos = [];
const srv = http.createServer((req, res) => {
  let b = ""; req.on("data", (x) => (b += x)); req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const h = (code, tipo, cuerpo, extra = {}) => res.writeHead(code, { "content-type": tipo, ...extra }).end(cuerpo);
    if (u.pathname === "/robots.txt") return h(200, "text/plain", "User-agent: *\nDisallow: /privado/\nAllow: /privado/publico\nDisallow: /*.pdf$\n\nUser-agent: otrobot\nDisallow: /\n");
    if (u.pathname === "/nota") return h(200, "text/html; charset=utf-8", "<html><head><title>Mate y salud</title><script>alert(1)</script><style>p{}</style></head><body><nav>menú</nav><article><h1>Mate</h1><p>El mate es una infusión tradicional del Río de la Plata que se comparte en ronda.</p><p>Contiene cafeína (mateína) y antioxidantes según varios estudios publicados.</p></article></body></html>");
    if (u.pathname === "/lejos") return h(302, "text/plain", "", { location: "/nota" });
    if (u.pathname === "/privado/x") return h(200, "text/html", "<title>Privado</title><p>secreto secreto secreto secreto secreto secreto</p>");
    if (u.pathname === "/ddg/") return h(200, "text/html", `<div><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent("https://ejemplo.com/mate")}&amp;rut=x">Todo sobre el <b>mate</b></a><a class="result__snippet" href="#">La infusión &amp; su historia</a></div><div><a class="result__a" href="https://otro.com/a">Otro</a><a class="result__snippet">Texto</a></div>`);
    if (u.pathname === "/crossref/works") return h(200, "application/json", JSON.stringify({ message: { items: [{ DOI: "10.1/abc", title: ["Yerba mate and health"], author: [{ given: "Ana", family: "Pérez" }], issued: { "date-parts": [[2021]] }, "container-title": ["J. Food"], URL: "https://doi.org/10.1/abc", "is-referenced-by-count": 12 }] } }));
    if (u.pathname === "/openalex/works") return h(200, "application/json", JSON.stringify({ results: [{ title: "Yerba mate and health", doi: "https://doi.org/10.1/ABC", publication_year: 2021, cited_by_count: 15, open_access: { oa_url: "https://repo.org/mate.pdf" }, authorships: [{ author: { display_name: "Ana Pérez" } }], abstract_inverted_index: { mate: [1], La: [0], ayuda: [2] } }, { title: "Otro trabajo", doi: null, publication_year: 2019, cited_by_count: 3, authorships: [] }] }));
    if (u.pathname === "/arxiv/api/query") return h(200, "application/atom+xml", `<feed><entry><id>http://arxiv.org/abs/2101.00001v1</id><published>2021-01-01T00:00:00Z</published><title>Caffeine models</title><summary>Un modelo.</summary><author><name>Beto Gómez</name></author><link title="pdf" href="http://arxiv.org/pdf/2101.00001v1"/></entry></feed>`);
    if (u.pathname === "/form" && req.method === "POST") { recibidos.push(b); return h(303, "text/plain", "", { location: "/gracias" }); }
    if (u.pathname === "/gracias") return h(200, "text/html", "<title>Gracias</title><p>Recibido</p>");
    h(404, "text/plain", "no");
  });
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const B = `http://127.0.0.1:${srv.address().port}`;

test("sin la variable de pruebas no se abre nada de la red privada", async () => {
  delete process.env.GRAVITY_PRUEBAS_RED_LOCAL;
  await assert.rejects(K.abrir(`${B}/nota`), /red privada/);
  await assert.rejects(K.traer("file:///etc/passwd"), /http o https/);
  process.env.GRAVITY_PRUEBAS_RED_LOCAL = "1";
});

test("robots.txt: grupo propio o *, Allow más específico, comodines y $", () => {
  const r = K.reglasRobots("User-agent: *\nDisallow: /privado/\nAllow: /privado/publico\nDisallow: /*.pdf$\n");
  assert.equal(K.permitePor(r, "/nota"), true);
  assert.equal(K.permitePor(r, "/privado/x"), false);
  assert.equal(K.permitePor(r, "/privado/publico/1"), true);
  assert.equal(K.permitePor(r, "/doc.pdf"), false);
  assert.equal(K.permitePor(r, "/doc.pdf?x=1"), true);
  assert.equal(K.permitePor(K.reglasRobots("User-agent: gravity\nDisallow: /\n\nUser-agent: *\nDisallow:\n"), "/a"), false, "grupo propio");
  assert.equal(K.permitePor(K.reglasRobots("User-agent: *\nDisallow:\n"), "/a"), true, "Disallow vacío no prohíbe");
});

test("abrir: sigue redirecciones, saca scripts y estilos, toma el título y queda en el historial", async () => {
  process.env.GRAVITY_PRUEBAS_RED_LOCAL = "1";
  const p = await K.abrir(`${B}/lejos`);
  assert.equal(p.url, `${B}/nota`);
  assert.equal(p.titulo, "Mate y salud");
  assert.doesNotMatch(p.html, /alert\(1\)|<style/);
  assert.equal(p.robots, true);
  assert.equal((await K.abrir(`${B}/privado/x`)).robots, false);
  assert.equal(K.historial()[0].url, `${B}/privado/x`);
  assert.equal(K.historial("mate")[0].titulo, "Mate y salud");
});

test("búsqueda web y académica (Crossref + OpenAlex + arXiv, sin repetidos)", async () => {
  process.env.GRAVITY_BUSCADOR_URL = `${B}/ddg/`;
  process.env.GRAVITY_CROSSREF_URL = `${B}/crossref`;
  process.env.GRAVITY_OPENALEX_URL = `${B}/openalex`;
  process.env.GRAVITY_ARXIV_URL = `${B}/arxiv`;
  const w = await K.buscarWeb("mate");
  assert.deepEqual(w.map((x) => x.url), ["https://ejemplo.com/mate", "https://otro.com/a"]);
  assert.equal(w[0].titulo, "Todo sobre el mate");
  assert.equal(w[0].extracto, "La infusión & su historia");
  const a = await K.buscarAcademico("mate");
  assert.deepEqual(a.errores, []);
  assert.equal(a.resultados.length, 3, "el mismo DOI de Crossref y OpenAlex queda una vez");
  const m = a.resultados.find((x) => x.doi?.toLowerCase() === "10.1/abc");
  assert.equal(m.pdf, "https://repo.org/mate.pdf");
  assert.equal(m.citas, 15);
  assert.match(m.fuente, /Crossref \+ OpenAlex/);
  assert.equal(a.resultados.find((x) => x.fuente === "arXiv").pdf, "http://arxiv.org/pdf/2101.00001v1");
  process.env.GRAVITY_ARXIV_URL = `${B}/no-existe`;
  const b = await K.buscarAcademico("mate");
  assert.equal(b.errores.length, 1, "si una fuente falla, las otras siguen");
});

test("marcadores por proyecto y referencias", () => {
  const m = K.marcar({ url: `${B}/nota`, titulo: "Mate", proyecto: "p1", etiquetas: ["Salud", "salud"] });
  assert.deepEqual(m.etiquetas, ["salud"]);
  assert.equal(K.marcar({ url: `${B}/nota`, proyecto: "p1", nota: "ver" }).id, m.id, "mismo marcador");
  K.marcar({ url: `${B}/gracias`, titulo: "Otra" });
  assert.equal(K.marcadores("p1").length, 1);
  assert.match(K.referenciasMd(K.marcadores("p1"), "Marcadores"), /^# Marcadores\n\n- \[Mate\]\(http/);
  K.desmarcar(m.id);
  assert.equal(K.marcadores("p1").length, 0);
});

test("con IA: resumen con párrafos verificados, extracción respeta robots, CSV, traducción por bloques", async () => {
  const s = AbortSignal.timeout(5000), original = K.ia.json;
  K.ia.json = async (_e, _s, u) => ({ resumen: "Sobre el mate.", tipo: "artículo", minutos: 1, puntos: [{ texto: "Es tradicional", parrafo: 1 }, { texto: "Inventado", parrafo: 40 }], _u: u });
  const r = await K.resumir(`${B}/nota`, s);
  assert.equal(r.puntos.length, 1);
  assert.match(r.puntos[0].cita, /infusión tradicional/);
  await assert.rejects(K.extraer(`${B}/privado/x`, ["dato"], s), /robots\.txt/);
  K.ia.json = async () => ({ filas: [{ nombre: "Mate", "precio": "1.500, con \"bombilla\"" }] });
  const e = await K.extraer(`${B}/nota`, ["nombre", "precio"], s);
  assert.equal(K.aCsv(e.campos, e.filas), 'nombre,precio\nMate,"1.500, con ""bombilla"""\n');
  K.ia.json = async (_e, _s, u) => ({ textos: JSON.parse(u).map((t) => `EN ${t}`) });
  assert.deepEqual(await K.traducir(["Hola", "Chau"], "inglés", s), ["EN Hola", "EN Chau"]);
  K.ia.json = async () => ({ textos: ["uno"] });
  await assert.rejects(K.traducir(["a", "b"], "inglés", s), /un texto por bloque/);
  K.ia.json = original;
});

test("formularios: rechaza contraseñas, envía lo aprobado, sigue el 303 y queda auditado", async () => {
  await assert.rejects(K.enviarFormulario({ pagina: `${B}/nota`, accion: "/form", metodo: "POST", campos: { usuario: "a", password: "x" } }), /contraseñas/);
  const r = await K.enviarFormulario({ pagina: `${B}/nota`, accion: "/form", metodo: "POST", campos: { nombre: "Ana", mensaje: "Hola & chau" } });
  assert.equal(recibidos.at(-1), "nombre=Ana&mensaje=Hola+%26+chau");
  assert.equal(r.titulo, "Gracias");
  const h = K.historial().find((x) => x.tipo === "envío");
  assert.match(h.detalle, /POST \/form · nombre, mensaje/);
  await assert.rejects(K.enviarFormulario({ pagina: `${B}/nota`, accion: "/privado/enviar", metodo: "POST", campos: { a: "1" } }), /robots/);
  srv.close();
});
