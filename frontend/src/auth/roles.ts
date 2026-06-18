import {
  EDUCLEAR_ROLE_STORAGE_KEY,
  getSuperAdminSessionEmail,
  getSuperAdminToken,
  hasSuperAdminSession,
  isExplicitSuperAdminLoginPayload,
} from "./superAdminSession";

export { EDUCLEAR_ROLE_STORAGE_KEY, isExplicitSuperAdminLoginPayload };

/** Known platform roles — extend when RBAC is wired to the API. */
export type EduClearRole = "superAdmin";

/** Platform super-admin login — always exempt from school subscription gate. */
export const PLATFORM_SUPER_ADMIN_EMAIL = "info@educlear.co.za";

/** Default route after super-admin login. */
export const SUPER_ADMIN_ENTRY_PATH = "/super-admin/schools";

export function clearEduClearRole(): void {
  localStorage.removeItem(EDUCLEAR_ROLE_STORAGE_KEY);
}

/**
 * School / teacher login must not set platform super-admin session
 * (use Super Admin login for that boundary).
 */
export function syncEduClearRoleFromLoginResponse(_data: unknown): void {
  clearEduClearRole();
}

/** Platform super-admin session — dedicated token, not school staff session. */
export function isSuperAdmin(): boolean {
  return (
    hasSuperAdminSession() &&
    String(getSuperAdminSessionEmail() || "").trim().toLowerCase() === PLATFORM_SUPER_ADMIN_EMAIL
  );
}

export function getEduClearRole(): string | null {
  return localStorage.getItem(EDUCLEAR_ROLE_STORAGE_KEY);
}

/** Dev-only: log current session identity for routing/access debugging. */
export function logAuthSessionDebug(context: string): void {
  if (!import.meta.env.DEV) return;

  console.log("[auth-session]", context, {
    schoolEmail: localStorage.getItem("userEmail"),
    prismaRole: localStorage.getItem("userRole"),
    appRole: localStorage.getItem("userAppRole"),
    superAdminEmail: getSuperAdminSessionEmail(),
    superAdminToken: Boolean(getSuperAdminToken()),
    isSuperAdmin: isSuperAdmin(),
  });
}
