// EduClear Teacher PWA — placeholder service worker (install + activate only).
// Never cache private teacher-app attachments or authenticated APIs.

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth") ||
    url.pathname.startsWith("/uploads/teacher-app") ||
    url.pathname.startsWith("/uploads/parent-messages") ||
    url.pathname.startsWith("/uploads/migration-") ||
    url.pathname.startsWith("/uploads/reset-backups")
  ) {
    return; // network only — do not cache private documents
  }
});
