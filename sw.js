const CACHE = "payuu-studio-v1";
const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest"];
self.addEventListener("install", event => { event.waitUntil(caches.open(CACHE).then(c => c.addAll(APP_SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", event => { event.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  if (new URL(event.request.url).pathname === '/payuu-config.json') { event.respondWith(fetch(event.request, { cache: 'no-store' })); return; }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone();
    if (response.ok && new URL(event.request.url).origin === location.origin) caches.open(CACHE).then(c => c.put(event.request, copy));
    return response;
  }).catch(() => cached)));
});
