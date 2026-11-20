// Myrs service worker. It does two small things:
//   1. lets phones install the site as an app (with the web app manifest);
//   2. shows offline.html when a page cannot load because there is no network.
// It caches nothing else, so every visit still gets the latest version of the site.
// To switch it off later, publish a sw.js that calls self.registration.unregister().

const CACHE = 'myrs-offline-v1';
const OFFLINE_URL = new URL('offline.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('myrs-') && k !== CACHE).map((k) => caches.delete(k)));
      // Starts the page request while the worker wakes up, so pages are not slower.
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  // Only whole-page loads; images, scripts and data go straight to the network.
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;
        return await fetch(event.request);
      } catch {
        return (await caches.match(OFFLINE_URL)) ?? Response.error();
      }
    })(),
  );
});
