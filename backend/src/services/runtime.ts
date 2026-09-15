/** Owner-requested go-live: unlock dashboard + billing without migration gates. */
export function isGoLiveMode(): boolean {
  return String(process.env.EDU_CLEAR_GO_LIVE || "").trim().toLowerCase() === "true";
}

/** True on Render and other production hosts (not local dev). */
export function isProductionRuntime(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  if (String(process.env.RENDER || "").trim()) return true;
  if (String(process.env.RENDER_SERVICE_ID || "").trim()) return true;
  return false;
}

/** Production host or explicit go-live flag (local smoke tests). */
export function isProductionOrGoLive(): boolean {
  return isProductionRuntime() || isGoLiveMode();
}

const STAGING_BACKEND_HOSTNAME = "educlear-backend-staging.onrender.com";
const PRODUCTION_BACKEND_HOSTNAME = "educlear-backend.onrender.com";

/**
 * Positive server-side staging identity for safety diagnostics.
 * Uses Render service env (and optional EDU_CLEAR_RUNTIME=staging for tests).
 * Never trusts client Host / Origin headers.
 * Fail-closed: unknown or production identities return false.
 */
export function isStagingRuntime(): boolean {
  const host = String(process.env.RENDER_EXTERNAL_HOSTNAME || "")
    .trim()
    .toLowerCase();
  const service = String(process.env.RENDER_SERVICE_NAME || "")
    .trim()
    .toLowerCase();
  const externalUrl = String(process.env.RENDER_EXTERNAL_URL || "")
    .trim()
    .toLowerCase();
  const explicit =
    String(process.env.EDU_CLEAR_RUNTIME || "")
      .trim()
      .toLowerCase() === "staging";

  // Hard reject known production backend identities
  if (host === PRODUCTION_BACKEND_HOSTNAME) return false;
  if (service === "educlear-backend") return false;
  if (externalUrl.includes(`://${PRODUCTION_BACKEND_HOSTNAME}`)) return false;

  // Positive staging allowlist
  if (host === STAGING_BACKEND_HOSTNAME) return true;
  if (service === "educlear-backend-staging") return true;
  if (externalUrl.includes(`://${STAGING_BACKEND_HOSTNAME}`)) return true;
  if (explicit) return true;

  return false;
}
