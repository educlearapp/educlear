import { useEffect } from "react";

/**
 * Registers the placeholder service worker when enabled.
 * Full Web Push (VAPID, subscribe, server send) is intentionally not implemented yet.
 */
export function useParentPortalPushPreparation(opts: {
  enabled: boolean;
  schoolId: string;
  parentId: string;
}) {
  useEffect(() => {
    if (!opts.enabled || !opts.schoolId || !opts.parentId) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/push-sw-placeholder.js").catch(() => {});
  }, [opts.enabled, opts.schoolId, opts.parentId]);
}
