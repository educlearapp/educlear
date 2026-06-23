const APP_VERSION_STORAGE_KEY = "educlear:lastAppBuildId";

const getCurrentBuildId = () => import.meta.env.VITE_FEE_CHECK_BUILD_ID || "dev";

async function clearBrowserCaches(): Promise<void> {
  if (!("caches" in window)) return;

  const keys = await window.caches.keys();
  await Promise.all(keys.map((key) => window.caches.delete(key)));
}

async function unregisterUnexpectedRootServiceWorkers(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;

  const rootScope = `${window.location.origin}/`;
  const registrations = await navigator.serviceWorker.getRegistrations();

  await Promise.all(
    registrations.map(async (registration) => {
      if (registration.scope !== rootScope) return;

      const scriptUrl =
        registration.active?.scriptURL ??
        registration.installing?.scriptURL ??
        registration.waiting?.scriptURL ??
        "";

      if (scriptUrl.endsWith("/push-sw-placeholder.js")) return;

      await registration.unregister();
    })
  );
}

export function reconcileEduClearAppVersionCache(): void {
  if (typeof window === "undefined") return;

  const buildId = getCurrentBuildId();
  const previousBuildId = window.localStorage.getItem(APP_VERSION_STORAGE_KEY);
  window.localStorage.setItem(APP_VERSION_STORAGE_KEY, buildId);

  if (!previousBuildId || previousBuildId === buildId) return;

  void Promise.all([clearBrowserCaches(), unregisterUnexpectedRootServiceWorkers()]).catch((error) => {
    console.warn("[EduClear] App cache reconciliation failed", error);
  });
}
