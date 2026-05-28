/** localStorage key for the signed-in user's platform role (temporary until server RBAC). */
export const EDUCLEAR_ROLE_STORAGE_KEY = "educlearRole";

/** Known platform roles — extend when RBAC is wired to the API. */
export type EduClearRole = "superAdmin";

const SUPER_ADMIN_ROLE_VALUE: EduClearRole = "superAdmin";

/** Platform super-admin login — always exempt from school subscription gate. */
export const PLATFORM_SUPER_ADMIN_EMAIL = "info@educlear.co.za";

/** Default route after super-admin login (Migration Center). */
export const SUPER_ADMIN_ENTRY_PATH = "/super-admin/migration";

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeSessionEmail(email: unknown): string {
  return String(email || "").trim().toLowerCase();
}

function isSuperAdminRoleValue(value: unknown): boolean {
  return value === SUPER_ADMIN_ROLE_VALUE;
}

function isSuperAdminUserRole(value: unknown): boolean {
  return String(value || "").trim().toUpperCase() === "SUPER_ADMIN";
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

  if (isSuperAdminUserRole(user?.role) || isSuperAdminUserRole(root.role)) {
    return true;
  }

  if (
    normalizeSessionEmail(user?.email) === PLATFORM_SUPER_ADMIN_EMAIL ||
    normalizeSessionEmail(root.email) === PLATFORM_SUPER_ADMIN_EMAIL
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
  if (localStorage.getItem(EDUCLEAR_ROLE_STORAGE_KEY) === SUPER_ADMIN_ROLE_VALUE) {
    return true;
  }
  if (isSuperAdminUserRole(localStorage.getItem("userRole"))) {
    return true;
  }
  return normalizeSessionEmail(localStorage.getItem("userEmail")) === PLATFORM_SUPER_ADMIN_EMAIL;
}

export function getEduClearRole(): string | null {
  return localStorage.getItem(EDUCLEAR_ROLE_STORAGE_KEY);
}
