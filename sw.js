// Bump this when you change any app file so installed copies pick up the update.
const CACHE = 'h2h-v8';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './sync.js',
  './firebase-config.js',
  './manifest.webmanifest',
  './icons/favicon-64.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

// Versioned, never-changing Firebase SDK files used by sync.js.
const SDK_ORIGIN = 'https://www.gstatic.com';
const SDK = [
  `${SDK_ORIGIN}/firebasejs/10.12.2/firebase-app.js`,
  `${SDK_ORIGIN}/firebasejs/10.12.2/firebase-firestore.js`,
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(async (cache) => {
    // Bypass the HTTP cache so an update really gets the new files.
    await cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })));
    // Best effort: the app still works locally if the SDK can't be fetched right now.
    await cache.addAll(SDK).catch(() => {});
  }));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Firebase SDK: cache-first, since each URL is pinned to a version.
  if (url.origin === SDK_ORIGIN && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }));
    return;
  }

  // Everything else from other origins (e.g. Firestore traffic) goes straight to the network.
  if (url.origin !== self.location.origin) return;

  // App files: stale-while-revalidate. Serve from cache instantly (works offline),
  // refresh the cache in the background when the network is available.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const key = request.mode === 'navigate' ? './index.html' : request;
      const cached = await cache.match(key, { ignoreSearch: true });
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(key, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
