const CACHE_NAME = 'expense-tracker-v14';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/db.js',
  './js/drive.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Explicitly bypass the browser's HTTP cache when fetching each app-shell
      // asset, so a new service worker always caches genuinely fresh bytes
      // instead of whatever the browser happened to have cached already.
      return Promise.all(
        APP_SHELL.map((url) =>
          fetch(url, { cache: 'reload' }).then((res) => cache.put(url, res))
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// App shell: cache-first. Only handle same-origin GET requests so this
// never interferes with future Google Drive API calls.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
