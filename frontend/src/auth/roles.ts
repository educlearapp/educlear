/** localStorage key for the signed-in user's platform role (temporary until server RBAC). */
export const EDUCLEAR_ROLE_STORAGE_KEY = "educlearRole";

/** Known platform roles — extend when RBAC is wired to the API. */
export type EduClearRole = "superAdmin";

const SUPER_ADMIN_ROLE_VALUE: EduClearRole = "superAdmin";

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function isSuperAdminRoleValue(value: unknown): boolean {
  return value === SUPER_ADMIN_ROLE_VALUE;
}

/** True only when the login payload explicitly marks the account as a platform super admin. */
export function isExplicitSuperAdminLoginPayload(data: unknown): boolean {
  const root = readRecord(data);
  if (!root) return false;

  const user = readRecord(root.user);

  if (
    isSuperAdminRoleValue(root.educlearRole) ||
    isSuperAdminRoleValue(root.platformRole) ||
    isSuperAdminRoleValue(user?.educlearRole) ||
    isSuperAdminRoleValue(user?.platformRole)
  ) {
    return true;
  }

  return root.isSuperAdmin === true || user?.isSuperAdmin === true;
}

export function clearEduClearRole(): void {
  localStorage.removeItem(EDUCLEAR_ROLE_STORAGE_KEY);
}

/** Persist or clear platform role from a successful login response. */
export function syncEduClearRoleFromLoginResponse(data: unknown): void {
  if (isExplicitSuperAdminLoginPayload(data)) {
    localStorage.setItem(EDUCLEAR_ROLE_STORAGE_KEY, SUPER_ADMIN_ROLE_VALUE);
    return;
  }

  clearEduClearRole();
}

/**
 * Temporary super-admin check via localStorage.
 * Replace with token claims / API permissions when RBAC is integrated.
 */
export function isSuperAdmin(): boolean {
  return localStorage.getItem(EDUCLEAR_ROLE_STORAGE_KEY) === SUPER_ADMIN_ROLE_VALUE;
}

export function getEduClearRole(): string | null {
  return localStorage.getItem(EDUCLEAR_ROLE_STORAGE_KEY);
}
