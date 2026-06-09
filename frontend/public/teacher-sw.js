// EduClear Teacher PWA — placeholder service worker (install + activate only).
// Replace with caching/offline strategy when requirements are defined.

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
