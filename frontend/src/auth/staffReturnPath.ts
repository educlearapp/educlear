/**
 * Safe post-login return paths for school staff (dashboard / admin deep links).
 * Rejects open redirects and portal paths that must use their own login flows.
 */
export function safeStaffReturnPath(raw: unknown): string | null {
  const value = String(raw || "").trim();
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (value.includes("://")) return null;

  const pathOnly = value.split(/[?#]/)[0] || "";

  if (pathOnly === "/admin/homesafe" || pathOnly === "/admin/homesafe/") {
    return "/admin/homesafe";
  }

  if (pathOnly === "/dashboard" || pathOnly.startsWith("/dashboard/")) {
    return pathOnly === "/dashboard/" ? "/dashboard" : pathOnly;
  }

  if (pathOnly.startsWith("/learners/")) {
    return pathOnly;
  }

  if (pathOnly === "/teacher-performance") {
    return pathOnly;
  }

  return null;
}
