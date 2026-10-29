/**
 * Client-side Communication Centre audience helpers.
 * Server enforces the same rules on /contacts and send.
 */

export function isCommunicationSchoolAdmin(): boolean {
  const appRole = String(localStorage.getItem("appRole") || "").trim();
  const role = String(localStorage.getItem("userRole") || "").trim();
  const isOwner = localStorage.getItem("isOwner") === "true";
  return (
    isOwner ||
    appRole === "Owner" ||
    appRole === "Admin" ||
    role === "SCHOOL_ADMIN" ||
    role === "Owner" ||
    role === "Admin"
  );
}
