// KILL-SWITCH service worker.
// Any phone/browser still holding an old cached service worker from a previous
// PWA deploy will byte-check /sw.js on its next navigation, see THIS new script,
// install it, and on activation it deletes every cache, unregisters itself, and
// reloads open tabs — so the next load comes fresh from the server instead of a
// stale cached app shell. After it runs once, no service worker remains.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (_e) {}
      try {
        await self.registration.unregister();
      } catch (_e) {}
      try {
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach((c) => {
          try { c.navigate(c.url); } catch (_e) {}
        });
      } catch (_e) {}
    })()
  );
});

// Never intercept — always let requests go straight to the network.
self.addEventListener('fetch', () => {});
