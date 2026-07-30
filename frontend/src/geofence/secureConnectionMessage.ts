/**
 * Owner-facing secure-connection copy for geolocation setup.
 * Technical details stay in DEV logging / diagnostics only.
 */

export const SECURE_CONNECTION_TITLE = "Secure connection required";

export const SECURE_CONNECTION_MESSAGE =
  "This setup needs a secure connection before your location can be used. Open EduClear using the secure setup link or contact your system administrator.";

export function isOwnerSecureContext(): boolean {
  return typeof window !== "undefined" && Boolean(window.isSecureContext);
}

/** DEV-only diagnostics — never show to owners. */
export function logInsecureContextDiagnostics(source: string): void {
  if (typeof window === "undefined") return;
  if (window.isSecureContext) return;
  try {
    // eslint-disable-next-line no-console
    console.debug(`[geofence:${source}] insecure context — geolocation blocked`, {
      protocol: window.location?.protocol,
      host: window.location?.host,
      href: window.location?.href,
    });
  } catch {
    // ignore
  }
}
