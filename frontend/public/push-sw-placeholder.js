// EduClear — placeholder service worker for future web push (install/activate only).
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", () => {});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
});
