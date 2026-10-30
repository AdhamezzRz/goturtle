/* GoTurtle service worker: app-shell caching so the hero app opens instantly and survives weak 4G. */
const CACHE = 'goturtle-shell-v1';
const SHELL = ['/', '/hero', '/manifest.webmanifest', '/turtle.svg', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return; // API is always live
  if (url.pathname.startsWith('/assets/')) {
    // Hashed build assets: cache-first.
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    })));
    return;
  }
  if (req.mode === 'navigate') {
    // Pages: network-first, fall back to the cached shell when offline.
    event.respondWith(fetch(req).catch(() => caches.match('/').then((r) => r || caches.match('/hero'))));
  }
});
