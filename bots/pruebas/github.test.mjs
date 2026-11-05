import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// GitHub falso: lo justo para las acciones.
const servidor = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    const ok = (d, st = 200) => { res.writeHead(st, { "content-type": "application/json" }); res.end(JSON.stringify(d)); };
    if (req.headers.authorization !== "Bearer github_pat_PRUEBA0123456789abcdefghij") return ok({ message: "Bad credentials" }, 401);
    if (req.url === "/user") return ok({ login: "ramiro" });
    if (req.url.startsWith("/user/repos")) return ok([{ full_name: "ramiro/tienda", private: true, description: "La tienda", updated_at: "2026-11-01T00:00:00Z" }]);
    if (req.url.startsWith("/repos/ramiro/tienda/contents/README.md")) return ok({ encoding: "base64", content: Buffer.from("# Tienda\nHola").toString("base64") });
    if (req.url.startsWith("/repos/ramiro/tienda/issues?")) return ok([{ number: 3, state: "open", title: "Falla el carrito", user: { login: "ana" }, updated_at: "2026-11-02T00:00:00Z" }, { number: 4, pull_request: {}, title: "PR" }]);
    if (req.url === "/repos/ramiro/tienda/issues" && req.method === "POST") return ok({ number: 5, html_url: "https://github.com/ramiro/tienda/issues/5" }, 201);
    ok({ message: "Not Found" }, 404);
  });
});
await new Promise((r) => servidor.listen(0, r));
process.env.GITHUB_API_BASE = `http://127.0.0.1:${servidor.address().port}`;

const A = await import("../src/almacen.ts");
const C = await import("../src/conexiones.ts");

test("GitHub: conecta con el token, lee repos, archivos e issues, y crear issue es de escritura", async () => {
  const bot = A.crearBot({ nombre: "Dev", titulo: "x", descripcion: "x", puedeEnviarAfuera: true });
  await assert.rejects(() => C.crearConexion("github", "GitHub", { token: "cualquiera" }, [bot.id]), /token de GitHub/);
  const c = await C.crearConexion("github", "GitHub", { token: "github_pat_PRUEBA0123456789abcdefghij" }, [bot.id]);
  assert.equal(c.cuenta, "ramiro");
  const run = (accion, p) => C.ejecutarConexion(bot.id, { conexion: c.id, accion, parametros: JSON.stringify(p) });
  assert.match(await run("repos", {}), /ramiro\/tienda \(privado\)/);
  assert.match(await run("archivo", { repo: "ramiro/tienda", ruta: "README.md" }), /# Tienda/);
  const issues = await run("issues", { repo: "ramiro/tienda" });
  assert.match(issues, /#3 \[open\] Falla el carrito/);
  assert.doesNotMatch(issues, /#4/, "sin pull requests");
  assert.ok(C.pedidoDeConexion(bot.id, { conexion: c.id, accion: "crear_issue", parametros: "{}" }), "crear issue pide aprobación");
  assert.equal(C.pedidoDeConexion(bot.id, { conexion: c.id, accion: "repos", parametros: "{}" }), null, "leer no");
  assert.match(await run("crear_issue", { repo: "ramiro/tienda", titulo: "Nuevo" }), /Issue #5 creado/);
  await assert.rejects(() => run("archivo", { repo: "no es un repo", ruta: "x" }), /dueño\/nombre/);
  servidor.close();
});
