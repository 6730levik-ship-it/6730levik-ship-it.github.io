/* מצב 2 — PUSH-ONLY service worker.
 *
 * Deliberately does NO caching: there is no `fetch` handler, so every request
 * goes straight to the network and this SW can NEVER serve a stale app shell
 * (that's the bug that bit us before — a caching SW served an old build). Its
 * ONLY job is to receive Web Push and show the daily reminder, which requires a
 * persistent registered SW with a `push` handler — something the old kill-switch
 * SW (which unregistered itself) could never do, so push silently never worked.
 *
 * On activate it still clears any legacy caches and takes control, but it does
 * NOT unregister itself (push needs it to stay alive).
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Purge any caches left by a previous caching SW — belt-and-braces against stale shells.
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((c) => caches.delete(c)));
      } catch (_e) {}
      await self.clients.claim();
    })()
  );
});

// Allow the page to fast-activate an updated SW.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Show the daily reminder pushed by the send-reminders edge function.
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

// Focus an open tab (or open one) at the notification's target URL on click.
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
