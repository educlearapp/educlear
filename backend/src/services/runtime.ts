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
