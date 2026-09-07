// Offline shell. Gym basements have no signal, so everything is precached.
//
// Assets are served stale-while-revalidate: a redeploy is fetched in the
// background and lands on the *next* launch. Bump CACHE when you want an
// update to apply immediately instead of one launch later.

const CACHE = 'gymtracker-v1';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-180.png',
  './assets/icon-maskable-512.png',
  './src/app.js',
  './src/charts.js',
  './src/db.js',
  './src/exercises.js',
  './src/share.js',
  './src/store.js',
  './src/theme.js',
  './src/timer.js',
  './src/ui.js',
  './src/util.js',
  './src/views/history.js',
  './src/views/library.js',
  './src/views/log.js',
  './src/views/picker.js',
  './src/views/progress.js',
  './src/views/routines.js',
  './src/views/settings.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll is all-or-nothing; add individually so one 404 can't break install.
      .then((cache) => Promise.all(ASSETS.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: try the network so updates land, fall back to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Everything else: cache first, refresh in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
