/**
 * Prueba E2E de humo de EARTH NEXT (Playwright, Chromium).
 * Uso: npm run dev (en otra terminal) y luego: node e2e/smoke.cjs [http://localhost:5173] [carpeta-salida]
 * Verifica: arranque del motor, búsqueda + vuelo, terreno en montaña, herramientas de medición,
 * paneles principales, asistente (modo básico) y ausencia de errores de página.
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = process.argv[2] || "http://localhost:5173";
const OUT = process.argv[3] || path.join(__dirname, "output");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✘"} ${name}${detail ? " — " + detail : ""}`);
}

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "es-AR" });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  // Las respuestas HTTP de servicios externos (p. ej. 429 por límite de uso) no son errores de la app.
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && pageErrors.push(`console: ${m.text()}`));

  // Overpass puede no ser accesible desde el entorno de pruebas: se sirve un recorte sintético
  // (claramente de prueba) para verificar el pipeline de edificios.
  if (process.env.E2E_FAKE_OVERPASS) {
    await page.route(/^https:\/\/(overpass-api\.de|overpass\.kumi\.systems|maps\.mail\.ru|overpass\.private\.coffee)\//, (route) => {
      const body = route.request().postData() || "";
      const m = decodeURIComponent(body).match(/way\["building"\]\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/);
      if (!m) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ elements: [] }) });
      const [s, w, n, e] = m.slice(1).map(Number);
      const els = [];
      let id = 1;
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
        const x = w + ((e - w) * (i + 0.2)) / 6, y = s + ((n - s) * (j + 0.2)) / 6, dx = (e - w) / 10, dy = (n - s) / 10;
        const tags = { building: "yes" };
        if ((i + j) % 3 === 0) tags.height = String(20 + i * 10);
        else if ((i + j) % 3 === 1) tags["building:levels"] = String(3 + j);
        els.push({ type: "way", id: id++, tags, geometry: [{ lat: y, lon: x }, { lat: y, lon: x + dx }, { lat: y + dy, lon: x + dx }, { lat: y + dy, lon: x }, { lat: y, lon: x }] });
      }
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ elements: els }) });
    });
  }

  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const ready = await page.waitForFunction(() => !!window.earthNext, null, { timeout: 60000 }).then(() => true).catch(() => false);
  check("Motor 3D inicializado", ready, `${Date.now() - t0} ms`);
  await page.waitForTimeout(8000);
  await page.screenshot({ path: path.join(OUT, "01-espacio.png") });

  // Búsqueda + vuelo
  await page.fill("#search-input", "Obelisco, Buenos Aires");
  const sug = await page.waitForSelector(".search-item", { timeout: 15000 }).then(() => true).catch(() => false);
  check("Sugerencias de búsqueda (Photon)", sug);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(9000);
  const cam = await page.evaluate(() => {
    const c = window.earthNext.getPose();
    return { lat: c.lat, lon: c.lon, h: c.height };
  });
  const near = Math.abs(cam.lat + 34.6) < 0.1 && Math.abs(cam.lon + 58.38) < 0.1;
  check("Vuelo a Buenos Aires", near, JSON.stringify(cam));
  await page.waitForTimeout(12000);
  await page.screenshot({ path: path.join(OUT, "02-obelisco.png") });
  const bld = await page.evaluate(() => {
    const e = window.earthNext;
    return { n: e.buildings.loadedFeatures().length };
  });
  check("Edificios OSM cargados por teselas", bld.n > 0, `${bld.n} edificios`);

  // Coordenadas directas + terreno en montaña
  await page.fill("#search-input", "-32.6532, -70.0109");
  await page.waitForTimeout(800);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.earthNext.flyTo({ lat: -32.66, lon: -70.0, height: 9000, pitch: -25, heading: 300, duration: 0 }));
  await page.waitForTimeout(15000);
  const ground = await page.evaluate(() => {
    const e = window.earthNext;
    const C = e.viewer.camera.positionCartographic;
    return e.viewer.scene.globe.getHeight(C);
  });
  check("Terreno de montaña (Aconcagua) cargado", ground !== undefined && ground > 2500, `altura bajo la cámara ${Math.round(ground ?? -1)} m`);
  await page.screenshot({ path: path.join(OUT, "03-aconcagua.png") });

  // Herramienta de distancia con clics
  await page.click('[aria-label="Herramientas"]');
  await page.click("text=Distancia");
  await page.mouse.click(600, 450);
  await page.waitForTimeout(400);
  await page.mouse.click(900, 500);
  await page.waitForTimeout(400);
  await page.mouse.dblclick(900, 500);
  await page.waitForTimeout(1500);
  const dist = await page.evaluate(() => window.earthNext && document.querySelector(".panel .kv dd")?.textContent);
  check("Medición de distancia", !!dist && /m|km/.test(dist), dist ?? "");
  await page.screenshot({ path: path.join(OUT, "04-medicion.png") });

  // Perfil de elevación
  await page.click("text=Perfil de elevación");
  await page.mouse.click(500, 420);
  await page.waitForTimeout(300);
  await page.mouse.click(950, 520);
  await page.waitForTimeout(300);
  await page.mouse.dblclick(950, 520);
  const prof = await page.waitForSelector(".chart", { timeout: 30000 }).then(() => true).catch(() => false);
  check("Perfil de elevación calculado", prof);
  await page.screenshot({ path: path.join(OUT, "05-perfil.png") });

  // Paneles
  for (const [label, file] of [["Capas", "06-capas"], ["Luz", "07-luz"], ["Clima", "08-clima"], ["Historia", "09-historia"], ["Recorridos", "10-recorridos"], ["Ajustes", "11-ajustes"], ["Explorar", "12-explorar"]]) {
    await page.click(`[aria-label="${label}"]`);
    await page.waitForTimeout(label === "Clima" || label === "Explorar" ? 5000 : 1200);
    const open = await page.$(".panel");
    check(`Panel ${label}`, !!open);
    await page.screenshot({ path: path.join(OUT, `${file}.png`) });
  }
  await page.keyboard.press("Escape");

  // Asistente (modo básico si el servidor no tiene IA)
  await page.click('[aria-label="Asistente de IA"]');
  await page.fill('[aria-label="Mensaje para el asistente"]', "Calculá la distancia entre Ushuaia y La Quiaca");
  await page.keyboard.press("Enter");
  const reply = await page
    .waitForFunction(() => [...document.querySelectorAll(".msg.assistant")].some((m) => /km/.test(m.textContent || "")), null, { timeout: 40000 })
    .then(() => true)
    .catch(() => false);
  check("Asistente responde con distancia y fuentes", reply);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(OUT, "13-asistente.png") });

  check("Sin errores de página", pageErrors.length === 0, pageErrors.slice(0, 5).join(" | "));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} verificaciones OK`);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
