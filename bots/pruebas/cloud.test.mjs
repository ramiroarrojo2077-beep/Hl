import "./ayuda.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const K = await import("../src/cloud.ts");
const C = await import("../src/codigo.ts");

test("copias cifradas: ida y vuelta, y clave equivocada", () => {
  const datos = Buffer.from("contenido secreto ".repeat(100));
  const c = K.cifrarCopia(datos, "clave-1");
  assert.ok(!c.includes(Buffer.from("contenido secreto")), "no queda en claro");
  assert.deepEqual(K.descifrarCopia(c, "clave-1"), datos);
  assert.throws(() => K.descifrarCopia(c, "otra"), /no corresponde/);
  assert.throws(() => K.descifrarCopia(Buffer.from("cualquier cosa"), "x"), /No es una copia/);
});

test("servidor remoto con clave: inicia sesión, guarda la clave cifrada y reintenta si venció la sesión", async () => {
  let sesion = "s1", logins = 0;
  const srv = http.createServer((req, res) => {
    if (req.url === "/api/login") {
      let b = ""; req.on("data", (x) => (b += x)); req.on("end", () => {
        if (JSON.parse(b).clave !== "secreta") { res.writeHead(401).end("{}"); return; }
        logins++; res.writeHead(200, { "set-cookie": `gravity_sesion=${sesion}; HttpOnly` }).end("{}");
      });
      return;
    }
    if (!String(req.headers.cookie).includes(`gravity_sesion=${sesion}`)) { res.writeHead(401).end("{}"); return; }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(req.url === "/api/estado" ? { bots: [{ estado: "trabajando" }, { estado: "libre" }], gasto: { hoy: 0.5 } } : { cpu: 12, memoria: { rss: 100 * 1048576 } }));
  });
  await new Promise((r) => srv.listen(0, r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const s = K.agregarServidor({ nombre: "PC", url, clave: "secreta" });
  assert.equal(s.clave, undefined, "la clave no sale en la vista");
  const u = await K.revisar(s.id);
  assert.deepEqual([u.ok, u.compañeros, u.trabajando, u.gastoHoy, u.cpu, u.memoriaMb], [true, 2, 1, 0.5, 12, 100]);
  sesion = "s2"; // el servidor reinició: la sesión vieja ya no sirve
  assert.ok((await K.revisar(s.id)).ok);
  assert.equal(logins, 2);
  const mal = K.agregarServidor({ nombre: "X", url, clave: "mala" });
  assert.match((await K.revisar(mal.id)).error, /clave/);
  srv.close();
});

test("límites de recursos por trabajo (ulimit): un bucle infinito se corta por CPU", async () => {
  C.crearProyectoCodigo("lim", "vacio");
  const e = C.ejecutarEnProyecto("lim", "node -e 'for(;;){}'", false, undefined, { cpuSeg: 1 });
  for (let i = 0; i < 100 && C.listarEjecuciones("lim").find((x) => x.id === e.id).estado === "corriendo"; i++) await new Promise((r) => setTimeout(r, 100));
  const f = C.listarEjecuciones("lim").find((x) => x.id === e.id);
  assert.equal(f.estado, "error", "terminó por el límite de CPU, no por el tiempo general");
  assert.ok(f.segundos < 8);
  assert.equal(C.conLimites("ls", { memoriaMb: 512 }), "ulimit -v 524288 2>/dev/null; ls");
});

test("cola distribuida: reparte entre los servidores que responden y saltea el que falla al recibir", async () => {
  for (const s of K.listarServidores()) K.quitarServidor(s.id);
  C.crearProyectoCodigo("rep", "vacio");
  const crear = (trabajando, fallaSubir) => {
    const recibidos = [];
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", (x) => (b += x)); req.on("end", () => {
        const j = (code, x) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(x));
        if (req.url === "/api/login") return res.writeHead(404).end("{}");
        if (req.url === "/api/estado") return j(200, { bots: Array.from({ length: trabajando }, () => ({ estado: "trabajando" })), gasto: { hoy: 0 } });
        if (req.url === "/api/rendimiento") return j(200, { cpu: 1 });
        if (req.url.startsWith("/api/code/importar-zip")) return fallaSubir ? j(500, { error: "disco lleno" }) : j(200, { archivos: 1 });
        if (req.url.startsWith("/api/code/ejecutar")) { recibidos.push(JSON.parse(b).comando); return j(200, { id: String(recibidos.length), estado: "corriendo" }); }
        j(404, {});
      });
    });
    return { srv, recibidos };
  };
  const libre = crear(0, false), ocupado = crear(3, false), roto = crear(0, true);
  for (const x of [libre, ocupado, roto]) await new Promise((r) => x.srv.listen(0, r));
  const url = (x) => `http://127.0.0.1:${x.srv.address().port}`;
  K.agregarServidor({ nombre: "Ocupado", url: url(ocupado), clave: "x" });
  K.agregarServidor({ nombre: "Roto", url: url(roto), clave: "x" });
  K.agregarServidor({ nombre: "Libre", url: url(libre), clave: "x" });
  const r = await K.repartir("rep", ["a", "b", "c", "d"]);
  assert.ok(r.every((x) => !x.error), JSON.stringify(r));
  assert.equal(r[0].nombre, "Libre", "el primero va al más libre");
  assert.equal(libre.recibidos.length + ocupado.recibidos.length, 4);
  assert.ok(libre.recibidos.length >= 2 && ocupado.recibidos.length >= 1, "se reparten");
  for (const x of [libre, ocupado, roto]) x.srv.close();
  await assert.rejects(K.repartir("rep", []), /al menos un comando/);
});
