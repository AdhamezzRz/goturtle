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

// ---------------------------------------------------------------- Web Push
// Payload (from the API's PushService): { title, body, url, tag, icon, badge, ts }.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'GoTurtle';
  const text = `${title}${data.body || ''}`;
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    // Arabic messages render right-to-left on every OS.
    dir: /[؀-ۿ]/.test(text) ? 'rtl' : 'auto',
    lang: /[؀-ۿ]/.test(text) ? 'ar' : 'en',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    timestamp: data.ts || Date.now(),
    data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // A tab already on the target, else any tab of the app (navigated there), else a new window.
      const exact = windows.find((w) => w.url === target);
      if (exact) return exact.focus();
      const any = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (any) return any.focus().then((w) => (w && 'navigate' in w ? w.navigate(target) : undefined));
      return self.clients.openWindow(target);
    }),
  );
});

// The browser rotated the subscription: subscribe again with the same server key.
// The app re-registers the new endpoint with the API the next time it opens.
self.addEventListener('pushsubscriptionchange', (event) => {
  const key = event.oldSubscription && event.oldSubscription.options ? event.oldSubscription.options.applicationServerKey : null;
  if (key) event.waitUntil(self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
});
