/** Legacy key — kept in sync with super-admin session for older call sites. */
export const EDUCLEAR_ROLE_STORAGE_KEY = "educlearRole";

/** JWT for platform super-admin APIs — independent from school `token`. */
export const SUPER_ADMIN_TOKEN_KEY = "superAdminToken";

const SUPER_ADMIN_EMAIL_KEY = "superAdminEmail";
const SUPER_ADMIN_USER_ID_KEY = "superAdminUserId";
const SUPER_ADMIN_PLATFORM_ROLE_KEY = "superAdminPlatformRole";

const SUPER_ADMIN_ROLE_VALUE = "superAdmin";

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

  return (
    isSuperAdminRoleValue(root.educlearRole) ||
    isSuperAdminRoleValue(root.platformRole) ||
    isSuperAdminRoleValue(user?.educlearRole) ||
    isSuperAdminRoleValue(user?.platformRole)
  );
}

export function getSuperAdminToken(): string {
  return String(localStorage.getItem(SUPER_ADMIN_TOKEN_KEY) || "").trim();
}

export function clearSuperAdminSession(): void {
  localStorage.removeItem(SUPER_ADMIN_TOKEN_KEY);
  localStorage.removeItem(SUPER_ADMIN_EMAIL_KEY);
  localStorage.removeItem(SUPER_ADMIN_USER_ID_KEY);
  localStorage.removeItem(SUPER_ADMIN_PLATFORM_ROLE_KEY);
  localStorage.removeItem(EDUCLEAR_ROLE_STORAGE_KEY);
}

/** True when a dedicated super-admin login session exists (not school staff session). */
export function hasSuperAdminSession(): boolean {
  const token = getSuperAdminToken();
  const role = localStorage.getItem(SUPER_ADMIN_PLATFORM_ROLE_KEY);
  return Boolean(token && role === SUPER_ADMIN_ROLE_VALUE);
}

/** Persist super-admin session from login — does not modify school `token` / `schoolId`. */
export function syncSuperAdminSessionFromLoginResponse(data: unknown): boolean {
  if (!isExplicitSuperAdminLoginPayload(data)) {
    return false;
  }

  const root = data as Record<string, unknown>;
  const user = (root.user as Record<string, unknown> | undefined) ?? {};
  const token = String(root.token || "").trim();

  if (!token) {
    return false;
  }

  localStorage.setItem(SUPER_ADMIN_TOKEN_KEY, token);
  localStorage.setItem(SUPER_ADMIN_PLATFORM_ROLE_KEY, SUPER_ADMIN_ROLE_VALUE);
  localStorage.setItem(EDUCLEAR_ROLE_STORAGE_KEY, SUPER_ADMIN_ROLE_VALUE);

  const email = String(user.email || root.email || "").trim();
  if (email) {
    localStorage.setItem(SUPER_ADMIN_EMAIL_KEY, email);
  }

  const userId = String(user.id || root.userId || "").trim();
  if (userId) {
    localStorage.setItem(SUPER_ADMIN_USER_ID_KEY, userId);
  }

  return true;
}

export function getSuperAdminSessionEmail(): string | null {
  return localStorage.getItem(SUPER_ADMIN_EMAIL_KEY);
}

export function getSuperAdminSessionUserId(): string | null {
  return localStorage.getItem(SUPER_ADMIN_USER_ID_KEY);
}
