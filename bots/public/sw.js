// Service worker de Gravity (PWA).
// - Páginas (navegaciones): primero la red. Si la compu no responde, una página "sin conexión"
//   que vive acá adentro. Las páginas no se guardan: siempre ves lo último de tu compu.
// - Íconos (/iconos/*) y fuentes: primero la caché (cambian poco).
// - /api/* nunca pasa por la caché (ni por este service worker).
// Al cambiar algo de este archivo, subí VERSION para que se borren las cachés viejas.

const VERSION = "1";
const PREFIJO = "gravity-";
const CACHE_ESTATICOS = `${PREFIJO}estaticos-v${VERSION}`;
const PRECARGA = ["/iconos/gravity-192.png", "/iconos/gravity.svg"];

const PAGINA_SIN_CONEXION = `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#070A12">
<title>Gravity · Sin conexión</title>
<style>
  :root { --bg:#070A12; --s1:#0B101B; --line:#2A3654; --tx:#E8ECF5; --tx2:#AAB3C8; --tx3:#8D98B0; --ion:#6CD3F0; --pri:#E8ECF5; --on-pri:#0A0F1A; color-scheme: dark; }
  @media (prefers-color-scheme: light) {
    :root { --bg:#EEF1F6; --s1:#F7F8FB; --line:#C9D0DE; --tx:#0B1220; --tx2:#434E66; --tx3:#566079; --ion:#1F8FB5; --pri:#0B1220; --on-pri:#F7F8FB; color-scheme: light; }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body { min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; padding: max(24px, env(safe-area-inset-top)) 20px max(24px, env(safe-area-inset-bottom));
    background: var(--bg); color: var(--tx); font: 400 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
  main { width: 100%; max-width: 400px; text-align: center; }
  svg { width: 64px; height: 64px; }
  h1 { font-size: 22px; font-weight: 600; margin: 18px 0 8px; letter-spacing: -0.01em; }
  p { color: var(--tx2); margin: 0 auto; max-width: 34ch; text-wrap: pretty; }
  .estado { margin-top: 14px; color: var(--tx3); font-size: 13px; display: inline-flex; gap: 8px; align-items: center; }
  .estado i { width: 7px; height: 7px; border-radius: 50%; background: var(--ion); animation: latido 1.6s ease-in-out infinite; }
  @keyframes latido { 50% { opacity: .35; } }
  @media (prefers-reduced-motion: reduce) { .estado i { animation: none; } }
  button { margin-top: 26px; width: 100%; min-height: 50px; border: 0; border-radius: 12px; background: var(--pri); color: var(--on-pri);
    font: 600 16px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--ion); outline-offset: 3px; }
</style>
</head>
<body>
<main>
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M18.69,9.16 A13.4,5.6 -24 0,1 22.88,18.58 M13.31,22.84 A13.4,5.6 -24 0,1 9.12,13.42" fill="none" stroke="var(--tx2)" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="16" cy="16" r="5" fill="var(--tx)"/>
    <circle cx="27.33" cy="9.47" r="2.5" fill="var(--ion)"/>
  </svg>
  <h1>No llego a tu Gravity</h1>
  <p>Revisá que la compu esté prendida, que Gravity esté abierto y que tengas conexión (o Tailscale prendido).</p>
  <div class="estado" role="status"><i></i><span>Vuelvo a probar solo</span></div>
  <button type="button" id="reintentar">Reintentar</button>
</main>
<script>
  const recargar = () => location.reload();
  document.getElementById("reintentar").addEventListener("click", recargar);
  addEventListener("online", recargar);
  // Cada 10 s pregunta si la compu ya responde (no pasa por el service worker).
  setInterval(async () => {
    if (!navigator.onLine) return;
    try {
      const r = await fetch(location.href, { cache: "no-store", credentials: "same-origin" });
      if (!(r.status >= 502 && r.status <= 504) && !(r.status >= 520 && r.status <= 530)) recargar();
    } catch {}
  }, 10000);
</script>
</body>
</html>`;

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE_ESTATICOS)
      .then((cache) => cache.addAll(PRECARGA))
      .catch(() => {}) // si un ícono falla, igual se instala
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys();
      await Promise.all(
        nombres.filter((n) => n.startsWith(PREFIJO) && n !== CACHE_ESTATICOS).map((n) => caches.delete(n)),
      );
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

function esFuente(pedido, url) {
  if (pedido.destination === "font") return true;
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") return true;
  return url.origin === self.location.origin && /\.(woff2?|ttf|otf)$/i.test(url.pathname);
}

function paginaSinConexion() {
  return new Response(PAGINA_SIN_CONEXION, {
    status: 503,
    statusText: "Sin conexion",
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// 502/503/504: un túnel o proxy que no encuentra a Gravity. 520-530: errores de Cloudflare.
function esCompuSinResponder(estado) {
  return estado === 502 || estado === 503 || estado === 504 || (estado >= 520 && estado <= 530);
}

async function primeroLaRed(evento) {
  try {
    const respuesta = (await evento.preloadResponse) || (await fetch(evento.request));
    return esCompuSinResponder(respuesta.status) ? paginaSinConexion() : respuesta;
  } catch {
    return paginaSinConexion();
  }
}

async function primeroLaCache(pedido) {
  const cache = await caches.open(CACHE_ESTATICOS);
  const guardada = await cache.match(pedido);
  if (guardada) return guardada;
  const respuesta = await fetch(pedido);
  if (respuesta.ok) cache.put(pedido, respuesta.clone()).catch(() => {});
  return respuesta;
}

self.addEventListener("fetch", (evento) => {
  const pedido = evento.request;
  if (pedido.method !== "GET") return;
  const url = new URL(pedido.url);
  const mismoOrigen = url.origin === self.location.origin;

  // La API (incluidos los eventos en vivo) va directo a la red, sin pasar por acá.
  if (mismoOrigen && (url.pathname === "/api" || url.pathname.startsWith("/api/"))) return;

  if (pedido.mode === "navigate") {
    evento.respondWith(primeroLaRed(evento));
    return;
  }

  if ((mismoOrigen && url.pathname.startsWith("/iconos/")) || esFuente(pedido, url)) {
    evento.respondWith(primeroLaCache(pedido));
  }
  // Todo lo demás: el navegador lo maneja normalmente.
});
