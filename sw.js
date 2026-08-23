const CACHE = 'payuu-studio-v4';
const BASE = self.registration.scope;
const APP_SHELL = [BASE, `${BASE}index.html`, `${BASE}manifest.webmanifest`];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.pathname.endsWith('/payuu-config.json')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }

  // Always check the network first for application code. This prevents an
  // older service-worker cache from keeping a broken WebRTC build alive after
  // a GitHub Pages deployment. Fall back to cache when offline.
  const isAppAsset = url.origin === self.location.origin &&
    (/\.(?:js|css|html)$/.test(url.pathname) || url.pathname.endsWith('/'));

  if (isAppAsset) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(response => {
        if (response.ok && url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => cached)
    )
  );
});
