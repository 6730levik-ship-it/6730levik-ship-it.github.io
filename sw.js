/* מצב 2 — service worker: FAST repeat-open caching + Web Push.
 *
 * Speed: content-hashed build output (/_expo/static/... and /assets/...) is
 * IMMUTABLE — every deploy emits a NEW filename hash — so it's cached CACHE-FIRST
 * and served instantly on repeat opens (no 2.6MB re-download). Because a changed
 * build has a different URL, a cached file can NEVER be stale: the old URL simply
 * stops being requested.
 *
 * Freshness: navigations (the HTML shell) are NETWORK-FIRST — an online user
 * ALWAYS gets the latest index.html, which references the current hashed bundle.
 * The cached shell is only used as an OFFLINE fallback. So "stale app at the URL"
 * (the bug that bit us before) cannot happen while online.
 *
 * Push: keeps the push / notificationclick handlers so daily reminders work.
 *
 * Bump CACHE_VERSION to drop every old cache on activate.
 */
const CACHE_VERSION = 'matzav2-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop any caches from older SW versions (and the legacy kill-switch had none).
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never touch POST/PUT (Supabase writes etc.)

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase / CDNs go straight to network

  // SPA navigations → NETWORK-FIRST so the shell is always fresh online; cache a
  // copy only as an offline fallback. Never serves a stale shell while online.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Immutable, content-hashed build output → CACHE-FIRST (instant repeat opens).
  if (url.pathname.startsWith('/_expo/') || url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(request, copy)).catch(() => {});
            return res;
          })
      )
    );
    return;
  }

  // Other same-origin GETs (icons, manifest) → cache-first with background refresh.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fromNet = fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(() => cached);
      return cached || fromNet;
    })
  );
});

/* ── Web Push: daily reminders ───────────────────────────────────────────── */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = {};
  }
  const title = data.title || 'מצב 2';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: data.icon || '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'combatfit',
      renotify: true,
      dir: 'rtl',
      lang: 'he',
      vibrate: [80, 40, 80],
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) {
        if ('focus' in c) {
          try {
            await c.navigate(url);
          } catch (_e) {}
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })()
  );
});
