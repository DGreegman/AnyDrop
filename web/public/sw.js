// Minimal service worker — exists to make AnyDrop installable, not to
// provide offline support. Resolving/downloading a video inherently needs
// a live connection, so this never caches API responses or video data.
// The one thing it does cache is a small *static* offline page, purely so
// a dropped connection shows AnyDrop's own offline UI instead of the
// browser's default error page.
//
// This deliberately does NOT cache the live "/" route. That was tried
// first and caused a real bug: "/" is server-rendered and its <link
// rel="stylesheet"> points at a content-hashed CSS filename that changes
// on every rebuild — old ones get deleted. A cached copy of "/" served
// later (via the catch() below, e.g. after a fetch hiccups during a
// deploy) would still reference a since-deleted CSS file and 404, so the
// page would render with none of the app's styling even though the HTML
// itself looked otherwise current. offline.html has no external asset
// references at all, so it can never go stale this way.
const SHELL_CACHE = "anydrop-shell-v2";
const SHELL_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.add(SHELL_URL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.mode !== "navigate") return; // never touch API/asset/video requests

  event.respondWith(fetch(request).catch(() => caches.match(SHELL_URL)));
});
