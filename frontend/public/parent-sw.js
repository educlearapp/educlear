/**
 * EduClear Parent Portal service worker (Phase 4A).
 * - Install/activate only for PWA + future Web Push.
 * - Does NOT cache authenticated API responses (billing, messages, learners).
 * - Push handler shows a generic notification; bodies stay server-side until Phase 4B.
 */
/* eslint-disable no-restricted-globals */

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop any accidental caches from earlier experiments — never retain private API data.
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
  // Never intercept API or auth traffic — network only, no offline cache of private data.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth")) {
    return;
  }
  // Navigation: network-first; on failure show a minimal offline response (no cached app shell with secrets).
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

self.addEventListener("push", (event) => {
  // Phase 4A: foundation only — real payloads arrive in 4B. Always show a visible notification
  // when a push arrives so iOS does not revoke the subscription for silent handling.
  let title = "EduClear";
  let body = "You have a new school update. Open Parent Portal for details.";
  let data = {};
  try {
    if (event.data) {
      const parsed = event.data.json();
      if (parsed && typeof parsed === "object") {
        if (parsed.title) title = String(parsed.title).slice(0, 80);
        // Default privacy: ignore body unless explicitly allowed by payload flag from server (4B).
        if (parsed.lockScreenPreview === true && parsed.body) {
          body = String(parsed.body).slice(0, 140);
        }
        data = {
          notificationId: parsed.notificationId || null,
          type: parsed.type || null,
        };
      }
    }
  } catch {
    /* use defaults */
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data,
      icon: "/parent-pwa/educlear-parent-icon-v2-192.png",
      badge: "/parent-pwa/educlear-parent-icon-v2-192.png",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = "/parent";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client && String(client.url || "").includes("/parent")) {
          await client.focus();
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(target);
      }
    })()
  );
});
