/** localStorage key for the signed-in user's platform role (temporary until server RBAC). */
export const EDUCLEAR_ROLE_STORAGE_KEY = "educlearRole";

/** Known platform roles — extend when RBAC is wired to the API. */
export type EduClearRole = "superAdmin";

/**
 * Temporary super-admin check via localStorage.
 * Replace with token claims / API permissions when RBAC is integrated.
 */
export function isSuperAdmin(): boolean {
  // const isSuperAdmin = localStorage.getItem("educlearRole") === "superAdmin";
  return localStorage.getItem(EDUCLEAR_ROLE_STORAGE_KEY) === "superAdmin";
}

export function getEduClearRole(): string | null {
  return localStorage.getItem(EDUCLEAR_ROLE_STORAGE_KEY);
}
