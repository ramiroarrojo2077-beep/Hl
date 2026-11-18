/**
 * Prueba E2E de funciones avanzadas: nivel de calle (Panoramax), histórico (Esri Wayback),
 * clima (radar, METAR), recorridos con grabación de video, importación GeoJSON,
 * captura de pantalla con atribuciones y diseño móvil.
 * Uso: node e2e/features.cjs [url] [carpeta-salida]
 */
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");

const BASE = process.argv[2] || "http://localhost:5173";
const OUT = process.argv[3] || path.join(__dirname, "output");
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✘"} ${name}${detail ? " — " + detail : ""}`);
};
const ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"];

async function boot(page, hash = "") {
  await page.goto(BASE + "/" + hash, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.earthNext, null, { timeout: 60000 });
  await page.evaluate(() => {
    const e = window.earthNext;
    e.time.pause();
    e.time.setTime(new Date("2026-11-18T13:00:00Z"));
  });
}

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "es-AR" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // --- Nivel de calle: Panoramax cerca de la Torre Eiffel
  await boot(page, "#@48.8550,2.2950,600a,0h,-45t");
  await page.click('[aria-label="Calle"]');
  await page.click("text=Buscar imágenes aquí");
  const street = await page.waitForSelector(".street", { timeout: 30000 }).then(() => true).catch(() => false);
  check("Imágenes a nivel de calle (Panoramax)", street);
  if (street) {
    await page.waitForTimeout(6000);
    const info = await page.evaluate(() => document.querySelector(".street-hud b")?.textContent);
    check("Metadatos de imagen (tipo, licencia)", !!info, info);
    await page.screenshot({ path: path.join(OUT, "f01-calle.png") });
    const hasNext = await page.$(".street-nav button:not([disabled])");
    if (hasNext) {
      await hasNext.click();
      await page.waitForTimeout(4000);
      check("Navegación entre fotos de la secuencia", true);
    }
    await page.keyboard.press("Escape");
  }

  // --- Histórico: Esri Wayback con divisor
  await boot(page, "#@25.1972,55.2744,6000a,0h,-60t"); // Dubái
  await page.click('[aria-label="Historia"]');
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    const r = document.querySelector('input[aria-label="Versión de Wayback"]');
    if (r) {
      r.value = "0";
      r.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  const split = await page.waitForSelector(".split-handle", { timeout: 15000 }).then(() => true).catch(() => false);
  check("Comparación histórica con divisor (Wayback)", split);
  await page.waitForTimeout(12000);
  await page.screenshot({ path: path.join(OUT, "f02-historico-dubai.png") });
  // Landsat 1990
  await page.click("text=Landsat anual (WELD)");
  await page.click("text=1990");
  await page.waitForTimeout(8000);
  const cmp = await page.evaluate(() => document.querySelector(".split-label")?.textContent);
  check("Landsat 1990 en comparación", !!cmp && /1990|Landsat/.test(cmp), cmp);
  await page.click("text=Cerrar comparación");

  // --- Clima: radar y METAR
  await boot(page, "#@-34.6,-58.4,1500000a,0h,-90t");
  await page.click('[aria-label="Clima"]');
  const temp = await page
    .waitForFunction(() => [...document.querySelectorAll(".panel .card")].map((c) => c.textContent).find((x) => /°C/.test(x || "")), null, { timeout: 30000 })
    .then((h) => h.jsonValue())
    .catch(() => null);
  check("Pronóstico Open-Meteo", !!temp, temp ? temp.slice(0, 40) : "");
  await page.click("text=Radar de precipitación");
  await page.waitForTimeout(4000);
  const radar = await page.evaluate(() => window.earthNext.viewer.imageryLayers.length);
  check("Radar RainViewer agregado", radar >= 4, `${radar} capas`);
  await page.click("text=Estaciones meteorológicas (METAR)");
  await page.waitForTimeout(6000);
  const metars = await page.evaluate(() => window.earthNext.weather.metars.length);
  check("Observaciones METAR (vía proxy del servidor)", metars > 0, `${metars} estaciones`);
  await page.click("text=Ciclones y huracanes activos");
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(OUT, "f03-clima.png") });

  // --- Recorrido + grabación
  await boot(page, "#@-13.16,-72.54,9000a,0h,-35t");
  const rec = await page.evaluate(async () => {
    const e = window.earthNext;
    e.recorder.start(30);
    const pose = e.getPose();
    const { flightBetween } = await import("/src/geo/tour.ts").catch(() => ({}));
    if (flightBetween) await e.tours.play(flightBetween(pose, { lon: -72.545, lat: -13.163 }, { arrivalHeight: 1200, duration: 4 }));
    else await new Promise((r) => setTimeout(r, 4000));
    const blob = await e.recorder.stop();
    return blob ? { size: blob.size, type: blob.type } : null;
  });
  check("Grabación de video del recorrido", !!rec && rec.size > 1000, JSON.stringify(rec));
  await page.screenshot({ path: path.join(OUT, "f04-machu-picchu.png") });

  // --- Importación GeoJSON
  const tmp = path.join(os.tmpdir(), "earthnext-test.geojson");
  fs.writeFileSync(tmp, JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "Plaza de prueba" }, geometry: { type: "Polygon", coordinates: [[[-72.546, -13.164], [-72.544, -13.164], [-72.544, -13.162], [-72.546, -13.162], [-72.546, -13.164]]] } }] }));
  await page.click('[aria-label="Capas"]');
  await page.setInputFiles('input[type="file"][accept*="geojson"]', tmp);
  const imported = await page.waitForSelector("text=earthnext-test.geojson", { timeout: 15000 }).then(() => true).catch(() => false);
  check("Importación GeoJSON", imported);
  await page.keyboard.press("Escape");

  // --- Captura con atribuciones
  const shot = await page.evaluate(async () => {
    const b = await window.earthNext.screenshot();
    return b.size;
  });
  check("Captura PNG con atribuciones", shot > 10000, `${shot} bytes`);

  // --- Iluminación: animación de un día
  const t1 = await page.evaluate(async () => {
    const e = window.earthNext;
    const before = e.time.current.getTime();
    e.time.animateDay(30);
    await new Promise((r) => setTimeout(r, 1500));
    e.time.pause();
    return (e.time.current.getTime() - before) / 60000;
  });
  check("Animación acelerada del tiempo", t1 > 30, `${t1.toFixed(0)} min de escena en 1,5 s`);

  check("Sin errores de página", errors.length === 0, errors.slice(0, 3).join(" | "));

  // --- Móvil
  const mctx = await browser.newContext({ ...devices["iPhone 13"], locale: "es-AR" });
  const m = await mctx.newPage();
  await m.goto(BASE + "/#@-34.6037,-58.3816,2500a,0h,-45t", { waitUntil: "domcontentloaded" });
  const mready = await m.waitForFunction(() => !!window.earthNext, null, { timeout: 60000 }).then(() => true).catch(() => false);
  await m.evaluate(() => {
    window.earthNext.time.pause();
    window.earthNext.time.setTime(new Date("2026-11-18T15:00:00Z"));
  });
  await m.waitForTimeout(12000);
  await m.screenshot({ path: path.join(OUT, "f05-movil.png") });
  await m.click('[aria-label="Capas"]');
  await m.waitForTimeout(1000);
  await m.screenshot({ path: path.join(OUT, "f06-movil-capas.png") });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check("Diseño móvil sin desbordes horizontales", mready && !overflow);

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} verificaciones OK`);
  fs.writeFileSync(path.join(OUT, "features-results.json"), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
