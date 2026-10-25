/**
 * Parent Portal Web Push client helpers (Phase 4A).
 * Permission is requested only after an explicit parent action — never on load.
 */

export type PushSupportState =
  | "supported"
  | "unsupported"
  | "insecure_context"
  | "denied"
  | "default"
  | "granted";

export function getPushSupportState(): PushSupportState {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext && window.location.hostname !== "localhost") return "insecure_context";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  const perm = Notification.permission;
  if (perm === "denied") return "denied";
  if (perm === "granted") return "granted";
  return "default";
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function ensureParentServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration("/parent");
  if (existing) return existing;
  return navigator.serviceWorker.register("/parent-sw.js", { scope: "/parent" });
}

/**
 * Request notification permission then create/refresh a PushSubscription.
 * Call only from a user gesture handler.
 */
export async function subscribeParentPush(vapidPublicKey: string): Promise<{
  endpoint: string;
  keys: { p256dh: string; auth: string };
} | null> {
  const support = getPushSupportState();
  if (support === "unsupported" || support === "insecure_context" || support === "denied") {
    return null;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  const reg = await ensureParentServiceWorker();
  if (!reg) return null;

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });
  const json = sub.toJSON();
  const endpoint = String(json.endpoint || "");
  const p256dh = String(json.keys?.p256dh || "");
  const auth = String(json.keys?.auth || "");
  if (!endpoint || !p256dh || !auth) return null;
  return { endpoint, keys: { p256dh, auth } };
}

export async function getCurrentBrowserPushEndpoint(): Promise<string | null> {
  const reg = await navigator.serviceWorker.getRegistration("/parent");
  if (!reg) return null;
  const sub = await reg.pushManager.getSubscription();
  return sub?.endpoint || null;
}

export async function unsubscribeBrowserPush(): Promise<boolean> {
  const reg = await navigator.serviceWorker.getRegistration("/parent");
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return false;
  return sub.unsubscribe();
}
