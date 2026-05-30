/* BLOOM service worker — offline-first for the shell, network-only for the API.
   Bump CACHE_NAME whenever any pre-cached asset changes so the activate step
   evicts the old cache.
   Server.js rewrites CACHE_NAME to `bloom-v1-${BOOT_TS}` on every deploy so
   the file you see here is just a template — the live SW always has a
   deploy-unique cache key. */
const CACHE_NAME = 'bloom-v21.2';

// ============================================================
// WEB PUSH — closed-app notifications
// ============================================================
// Handles incoming server pushes (duel invites, gifts, results)
// when BLOOM isn't even open. The 'push' event fires on the
// device's OS notification thread, the SW wakes up, shows a
// system notification, and goes back to sleep.
self.addEventListener('push', function(event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = (data.title || 'BLOOM').toString().slice(0, 80);
  const options = {
    body: (data.body || '').toString().slice(0, 200),
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    image: data.image || undefined,
    data: data.data || {},
    // tag = same-tag pushes replace each other (e.g. multiple duel-invite
    // pings collapse into one banner instead of stacking).
    tag: data.tag || 'bloom-' + Date.now(),
    // requireInteraction=false → auto-dismisses; the user gets the alert
    // sound + lockscreen banner regardless.
    requireInteraction: !!data.requireInteraction,
    // Vibration pattern per Android — iOS ignores this.
    vibrate: data.vibrate || [100, 50, 100, 50, 100],
    // Custom actions show as inline buttons on Android (e.g. "Accept" + "Decline").
    actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : undefined
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tap handler — focus the existing BLOOM tab if open, otherwise
// open a new one, optionally deep-linking via the `url` field on
// the payload (e.g. ?action=duels to open the duel modal).
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = (data.url && typeof data.url === 'string')
    ? new URL(data.url, self.location.origin).toString()
    : self.location.origin + '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin) && 'focus' in c) {
          // Already-open tab wins. Tell it where to navigate via postMessage.
          c.postMessage({ type: 'bloom-push-click', url: targetUrl, data: data });
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

// Subscription change (browser rotated the endpoint) — re-subscribe
// silently in the background. Without this, expired endpoints
// silently stop receiving pushes.
self.addEventListener('pushsubscriptionchange', function(event) {
  event.waitUntil((async function() {
    try {
      const newSub = await self.registration.pushManager.subscribe(event.oldSubscription.options);
      // Notify the server via a clients.matchAll round trip so the
      // active page can call /api/push/subscribe with the device's token.
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clients) {
        c.postMessage({ type: 'bloom-push-resubscribe', subscription: newSub.toJSON() });
      }
    } catch (e) { /* swallow — the next page-open will resubscribe via the normal flow */ }
  })());
});

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
