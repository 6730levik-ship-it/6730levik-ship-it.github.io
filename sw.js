/* CombatFit — service worker (PWA offline shell)
 * Strategy:
 *  - navigations: network-first, fall back to cached app shell (SPA routing / offline)
 *  - hashed build assets (/_expo/static/...): cache-first (immutable)
 *  - other same-origin GET: stale-while-revalidate
 *  - everything else (Supabase API, cross-origin, non-GET): pass through to network
 * Bump CACHE_VERSION on every deploy to invalidate the old shell.
 */
const CACHE_VERSION = 'combatfit-v2';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // addAll is atomic; tolerate a missing asset so install never wedges.
      Promise.allSettled(SHELL.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Allow the page to trigger an immediate activation after an update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let Supabase / CDNs hit network directly

  // SPA navigations → network-first, offline fallback to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Immutable, content-hashed build output → cache-first.
  if (url.pathname.startsWith('/_expo/') || url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(request, copy));
            return res;
          })
      )
    );
    return;
  }

  // Everything else same-origin → stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

/* ── Web Push: daily workout reminders ───────────────────────────────────── */

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_e) {
    payload = { title: 'מצב 2', body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'מצב 2 — זמן להתאמן 🪖';
  const options = {
    body: payload.body || 'האימון היומי שלך מחכה. קדימה, חייל.',
    icon: payload.icon || '/icon-192.png',
    badge: '/icon-192.png',
    lang: 'he',
    dir: 'rtl',
    tag: payload.tag || 'combatfit-reminder',
    renotify: true,
    data: { url: payload.url || '/' },
    // Vibrate on Android; ignored where unsupported.
    vibrate: [80, 40, 80],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Focus an open app window if one exists, else open a new one.
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
