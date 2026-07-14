// Self-destructing service worker. The hosted site used to be the Argus app
// shell (a PWA with a caching SW); it is now a static landing page. Browsers
// that installed the old PWA will fetch this update, which wipes the old
// caches, unregisters itself, and reloads any open pages.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((c) => c.navigate(c.url));
    })()
  );
});
