// Service Worker — קאש בסיסי למעטפת האפליקציה כדי לאפשר התקנה וטעינה גם ללא רשת.
// בקשות ל-API (/api, /admin-api) תמיד הולכות ישירות לרשת — לא נשמרות בקאש,
// כדי שלא יוצג מידע ישן (רשימת קניות, חברי משפחה וכו').
const CACHE_NAME = 'shopping-app-v1';
const SHELL_URLS = ['/', '/index.html', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/admin-api')) return; // always network

  // network-first for navigations (get the newest app version when online),
  // falling back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
        return res;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // cache-first for static assets (icons/manifest), falling back to network.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
