/* BLOOM service worker — offline-first for the shell, network-only for the API.
   Bump CACHE_NAME whenever any pre-cached asset changes so the activate step
   evicts the old cache. */
const CACHE_NAME = 'bloom-v3.2';

// Tiny, stable shell. mp3 files are deliberately NOT pre-cached because some
// browsers (Safari) misbehave when a service worker tries to fulfil Range
// requests for audio; the browser's HTTP cache handles them well enough.
const PRECACHE = [
  '/',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/assets/favicon.svg',
  '/assets/favicon-16.png',
  '/assets/favicon-32.png',
  '/assets/apple-touch-icon.png',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/social-share.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) { return cache.addAll(PRECACHE); })
      .then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys()
      .then(function(keys) {
        return Promise.all(keys
          .filter(function(k) { return k !== CACHE_NAME; })
          .map(function(k) { return caches.delete(k); }));
      })
      .then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event) {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Same-origin only
  if (url.origin !== self.location.origin) return;
  // API: never cache, never serve stale. Let the browser handle network errors.
  if (url.pathname.startsWith('/api/')) return;
  // Audio: skip SW entirely so Range requests stay honest.
  if (url.pathname.endsWith('.mp3')) return;

  // HTML / navigations: network-first with cache fallback (so users get the
  // latest version when online, and the cached shell when offline).
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') !== -1) {
    event.respondWith(
      fetch(req)
        .then(function(res) {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(function(cache) { cache.put(req, clone); });
          }
          return res;
        })
        .catch(function() {
          return caches.match(req).then(function(m) { return m || caches.match('/'); });
        })
    );
    return;
  }

  // Static assets: network-first for JS/CSS (ensures latest code),
  // cache-first for images/fonts (rarely change).
  var isCode = url.pathname.endsWith('.js') || url.pathname.endsWith('.css');
  if (isCode) {
    event.respondWith(
      fetch(req)
        .then(function(res) {
          if (res && res.ok) {
            var clone = res.clone();
            caches.open(CACHE_NAME).then(function(cache) { cache.put(req, clone); });
          }
          return res;
        })
        .catch(function() {
          return caches.match(req);
        })
    );
    return;
  }

  // Other static assets: cache-first, then network.
  event.respondWith(
    caches.match(req).then(function(cached) {
      if (cached) return cached;
      return fetch(req).then(function(res) {
        if (res && res.ok && res.status === 200 && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(req, clone); });
        }
        return res;
      });
    })
  );
});
