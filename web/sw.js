// ─────────────────────────────────────────────────────────────────────────────
// Argus service worker. Caches the app *shell* (HTML/CSS/JS/icons) so the UI
// installs as a PWA and opens instantly offline. It deliberately does NOT cache:
//   • /api/* — live camera data, always from the network
//   • go2rtc streams — cross-origin (different host/port), never intercepted here
// ─────────────────────────────────────────────────────────────────────────────
const VERSION = "argus-v2";
const SHELL = [
  "./",
  "./index.html",
  "./config.html",
  "./styles.css",
  "./settings.js",
  "./wall.js",
  "./app.js",
  "./config-ui.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only handle same-origin GETs; let API + cross-origin (go2rtc) pass through.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Stale-while-revalidate for the shell: instant load, refresh in background.
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
