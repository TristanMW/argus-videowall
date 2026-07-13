// ─────────────────────────────────────────────────────────────────────────────
// Argus service worker — NETWORK-FIRST.
//
// Every request goes to the network first, so a refresh always gets the latest
// version (no stale UI after a redeploy). The cache is only a fallback for when
// you're offline. Never caches /api/* or cross-origin (go2rtc) requests.
// ─────────────────────────────────────────────────────────────────────────────
const VERSION = "argus-v3";
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
  "./icons/favicon-32.png",
];

self.addEventListener("install", (e) => {
  // Precache the shell so the app still opens with no network, then take over.
  e.waitUntil(
    caches.open(VERSION).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // go2rtc streams etc. — untouched
  if (url.pathname.startsWith("/api/")) return;     // live data — always network

  // Network-first: fetch fresh, update the cache, fall back to cache offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || caches.match("./index.html"))
      )
  );
});
