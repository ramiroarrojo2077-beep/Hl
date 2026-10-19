/* Optional PWA shell cache. Private API replies and user data are NEVER cached. */
const CACHE='nexo-static-v3.0';const ASSETS=['/','/styles.css','/app.js','/icon.svg','/manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(x=>x!==CACHE).map(x=>caches.delete(x))))));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;if(!ASSETS.includes(url.pathname))return;event.respondWith(fetch(event.request).then(r=>{if(r.ok){const copy=r.clone();void caches.open(CACHE).then(c=>c.put(event.request,copy));}return r;}).catch(()=>caches.match(event.request)));});
