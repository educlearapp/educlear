/** localStorage key for the signed-in user's platform role (set from login /auth/me only). */
export const EDUCLEAR_ROLE_STORAGE_KEY = "educlearRole";

/** Known platform roles — extend when RBAC is wired to the API. */
export type EduClearRole = "superAdmin";

const SUPER_ADMIN_ROLE_VALUE: EduClearRole = "superAdmin";

/** Platform super-admin login — always exempt from school subscription gate. */
export const PLATFORM_SUPER_ADMIN_EMAIL = "info@educlear.co.za";

/** Default route after super-admin login. */
export const SUPER_ADMIN_ENTRY_PATH = "/super-admin/schools";

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeSessionEmail(email: unknown): string {
  return String(email || "").trim().toLowerCase();
}

function isSuperAdminRoleValue(value: unknown): boolean {
  return value === SUPER_ADMIN_ROLE_VALUE;
}

/** True only when the login payload explicitly marks the account as a platform super admin. */
export function isExplicitSuperAdminLoginPayload(data: unknown): boolean {
  const root = readRecord(data);
  if (!root) return false;

  const user = readRecord(root.user);

  return (
    isSuperAdminRoleValue(root.educlearRole) ||
    isSuperAdminRoleValue(root.platformRole) ||
    isSuperAdminRoleValue(user?.educlearRole) ||
    isSuperAdminRoleValue(user?.platformRole)
  );
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
 * Platform super-admin session — requires backend `educlearRole` from login,
 * with a stale-session guard so legacy email-only flags cannot persist.
 */
export function isSuperAdmin(): boolean {
  if (localStorage.getItem(EDUCLEAR_ROLE_STORAGE_KEY) !== SUPER_ADMIN_ROLE_VALUE) {
    return false;
  }

  const sessionEmail = normalizeSessionEmail(localStorage.getItem("userEmail"));
  if (sessionEmail && sessionEmail !== normalizeSessionEmail(PLATFORM_SUPER_ADMIN_EMAIL)) {
    clearEduClearRole();
    return false;
  }

  return true;
}

export function getEduClearRole(): string | null {
  return localStorage.getItem(EDUCLEAR_ROLE_STORAGE_KEY);
}

/** Dev-only: log current session identity for routing/access debugging. */
export function logAuthSessionDebug(context: string): void {
  if (!import.meta.env.DEV) return;

  console.log("[auth-session]", context, {
    email: localStorage.getItem("userEmail"),
    prismaRole: localStorage.getItem("userRole"),
    appRole: localStorage.getItem("userAppRole"),
    educlearRole: localStorage.getItem(EDUCLEAR_ROLE_STORAGE_KEY),
    isSuperAdmin: isSuperAdmin(),
  });
}
