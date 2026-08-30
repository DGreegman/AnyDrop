// Minimal service worker — exists to make XDrop installable, not to
// provide offline support. Resolving/downloading a video inherently needs
// a live connection, so this never caches API responses or video data.
// The one thing it does cache is the app shell itself ("/"), purely so a
// dropped connection shows XDrop's own offline UI instead of the browser's
// default error page.
const SHELL_CACHE = "xdrop-shell-v1";
const SHELL_URL = "/";

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
