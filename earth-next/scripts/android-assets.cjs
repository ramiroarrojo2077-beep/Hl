/**
 * Genera los íconos (adaptativos, cuadrados y redondos) y las pantallas de inicio de la app
 * Android a partir de un diseño SVG. Requiere Playwright (Chromium).
 * Uso: node scripts/android-assets.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const RES = path.join(__dirname, "..", "android", "app", "src", "main", "res");
const BG = "#05080f";

// Globo con relieve, atmósfera y anillo orbital (diseño propio de EARTH NEXT).
const globe = (cx, cy, r) => `
  <defs>
    <radialGradient id="ocean" cx="35%" cy="30%" r="80%">
      <stop offset="0" stop-color="#7dd3fc"/><stop offset=".45" stop-color="#0ea5e9"/><stop offset="1" stop-color="#062146"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset=".78" stop-color="#38bdf8" stop-opacity="0"/><stop offset=".9" stop-color="#38bdf8" stop-opacity=".45"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="land" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#6ee7b7"/><stop offset="1" stop-color="#059669"/>
    </linearGradient>
    <linearGradient id="shade" x1="0" x2="1" y1="0" y2="0">
      <stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/>
    </linearGradient>
    <clipPath id="c"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
  </defs>
  <circle cx="${cx}" cy="${cy}" r="${r * 1.18}" fill="url(#glow)"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#ocean)"/>
  <g clip-path="url(#c)" fill="url(#land)">
    <path d="M${cx - r * 0.75} ${cy - r * 0.15} q${r * 0.25} -${r * 0.45} ${r * 0.6} -${r * 0.3} t${r * 0.45} ${r * 0.15} q-${r * 0.1} ${r * 0.35} -${r * 0.4} ${r * 0.3} q-${r * 0.25} ${r * 0.45} -${r * 0.55} ${r * 0.2} z"/>
    <path d="M${cx + r * 0.1} ${cy + r * 0.2} q${r * 0.35} -${r * 0.1} ${r * 0.55} ${r * 0.15} q-${r * 0.05} ${r * 0.4} -${r * 0.35} ${r * 0.55} q-${r * 0.25} -${r * 0.2} -${r * 0.2} -${r * 0.7} z"/>
  </g>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#shade)"/>
  <ellipse cx="${cx}" cy="${cy}" rx="${r * 1.42}" ry="${r * 0.42}" fill="none" stroke="#f8fafc" stroke-opacity=".85" stroke-width="${r * 0.07}" transform="rotate(-22 ${cx} ${cy})"/>
  <circle cx="${cx + r * 1.22}" cy="${cy - r * 0.62}" r="${r * 0.09}" fill="#fbbf24"/>`;

const svg = (w, h, body, bg) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bg ? `<rect width="100%" height="100%" fill="${bg}"/>` : ""}${body}</svg>`;

async function render(page, markup, w, h, out, transparent = false) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:${transparent ? "transparent" : BG}">${markup}</body></html>`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    const icon = Math.round(48 * k);
    const fg = Math.round(108 * k);
    // Ícono adaptativo: el contenido ocupa la zona segura (66 dp de 108 dp).
    await render(page, svg(fg, fg, globe(fg / 2, fg / 2, fg * 0.24)), fg, fg, path.join(RES, `mipmap-${d}`, "ic_launcher_foreground.png"), true);
    // Íconos heredados (Android < 8): cuadrado con esquinas redondeadas y redondo.
    const r = icon * 0.18;
    await render(page, `<svg xmlns="http://www.w3.org/2000/svg" width="${icon}" height="${icon}"><rect width="${icon}" height="${icon}" rx="${r}" fill="${BG}"/>${globe(icon / 2, icon / 2, icon * 0.3)}</svg>`, icon, icon, path.join(RES, `mipmap-${d}`, "ic_launcher.png"), true);
    await render(page, `<svg xmlns="http://www.w3.org/2000/svg" width="${icon}" height="${icon}"><circle cx="${icon / 2}" cy="${icon / 2}" r="${icon / 2}" fill="${BG}"/>${globe(icon / 2, icon / 2, icon * 0.28)}</svg>`, icon, icon, path.join(RES, `mipmap-${d}`, "ic_launcher_round.png"), true);
  }
  // Pantallas de inicio
  const splashes = [];
  for (const f of fs.readdirSync(RES)) {
    const p = path.join(RES, f, "splash.png");
    if (fs.existsSync(p)) {
      const b = fs.readFileSync(p);
      splashes.push({ p, w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
    }
  }
  for (const s of splashes) {
    const m = Math.min(s.w, s.h);
    const r = m * 0.13;
    const fs1 = Math.round(m * 0.06);
    const body = `${globe(s.w / 2, s.h / 2 - m * 0.06, r)}<text x="${s.w / 2}" y="${s.h / 2 + r * 1.9}" text-anchor="middle" font-family="Inter, Segoe UI, Roboto, sans-serif" font-weight="800" letter-spacing="${fs1 * 0.3}" font-size="${fs1}" fill="#e6edf7">EARTH NEXT</text>`;
    await render(page, svg(s.w, s.h, body, BG), s.w, s.h, s.p);
  }
  fs.writeFileSync(path.join(RES, "values", "ic_launcher_background.xml"), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`);
  await browser.close();
  console.log(`Íconos en 5 densidades y ${splashes.length} pantallas de inicio generadas.`);
})();
