/** True on Render and other production hosts (not local dev). */
export function isProductionRuntime(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  if (String(process.env.RENDER || "").trim()) return true;
  if (String(process.env.RENDER_SERVICE_ID || "").trim()) return true;
  return false;
}
