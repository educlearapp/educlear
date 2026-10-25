/**
 * EduClear Parent Portal service worker (Phase 4A–4C).
 * - No authenticated API caching.
 * - Push UI is privacy-safe by default; click opens /parent?panel=alerts.
 * - Skips OS notification when a visible Parent Portal client is already focused
 *   (avoids duplicate foreground + background presentation).
 *
 * Browser / iOS notes:
 * - iOS Web Push requires the PWA installed to Home Screen; background sound is
 *   controlled by iOS Focus / Silent Mode — the web app cannot override it.
 * - Chrome/Edge/Firefox on desktop support Badging + Notification APIs when permitted.
 */
/* eslint-disable no-restricted-globals */

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("educlear-parent-"))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never cache authenticated APIs or private teacher-app attachments.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth") ||
    url.pathname.startsWith("/uploads/teacher-app") ||
    url.pathname.startsWith("/uploads/parent-messages") ||
    url.pathname.startsWith("/uploads/migration-") ||
    url.pathname.startsWith("/uploads/reset-backups")
  ) {
    return;
  }
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(
        () =>
          new Response(
            "<!doctype html><title>EduClear Parent</title><body style='font-family:system-ui;padding:24px'><h1>You are offline</h1><p>Reconnect to open the Parent Portal. No private school data is stored offline.</p></body>",
            { headers: { "Content-Type": "text/html; charset=utf-8" } }
          )
      )
    );
  }
});

const ALERTS_URL = "/parent?panel=alerts";

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let title = "EduClear";
      let body = "You have a new school update. Open Parent Portal for details.";
      let data = { openPanel: "alerts" };
      try {
        if (event.data) {
          const parsed = event.data.json();
          if (parsed && typeof parsed === "object") {
            if (parsed.title) title = String(parsed.title).slice(0, 80);
            if (parsed.lockScreenPreview === true && parsed.body) {
              body = String(parsed.body).slice(0, 140);
            }
            data = {
              openPanel: "alerts",
              notificationId: parsed.notificationId || null,
              type: parsed.type || null,
            };
          }
        }
      } catch {
        /* defaults */
      }

      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const visibleParent = clients.filter(
        (c) => String(c.url || "").includes("/parent") && c.visibilityState === "visible"
      );
      if (visibleParent.length > 0) {
        for (const client of visibleParent) {
          client.postMessage({ type: "educlear-parent-push", ...data });
        }
        return;
      }

      await self.registration.showNotification(title, {
        body,
        data,
        icon: "/parent-pwa/educlear-parent-icon-v2-192.png",
        badge: "/parent-pwa/educlear-parent-icon-v2-192.png",
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if (String(client.url || "").includes("/parent") && "focus" in client) {
          await client.focus();
          client.postMessage({ type: "educlear-parent-open-alerts" });
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(ALERTS_URL);
      }
    })()
  );
});
