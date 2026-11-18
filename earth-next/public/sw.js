/* EARTH NEXT — service worker: app shell + caché de teselas para uso sin conexión parcial. */
const VERSION = "earth-next-v1";
const SHELL = ["/", "/index.html", "/favicon.svg", "/manifest.webmanifest"];
const TILE_HOSTS = ["gibs.earthdata.nasa.gov", "services.arcgisonline.com", "s3.amazonaws.com", "tile.openstreetmap.org", "wayback.maptiles.arcgis.com"];
const MAX_TILES = 3000;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== `${VERSION}-tiles`).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trimTiles(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map((k) => cache.delete(k)));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Teselas: primero caché, luego red (las teselas de un mismo URL no cambian).
  if (TILE_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.open(`${VERSION}-tiles`).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === "opaque") {
          cache.put(req, res.clone());
          if (Math.random() < 0.02) trimTiles(cache);
        }
        return res;
      }),
    );
    return;
  }
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // App: red primero, caché como respaldo sin conexión.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
        return res;
      })
      .catch(() => caches.match(req).then((r) => r ?? caches.match("/index.html"))),
  );
});
