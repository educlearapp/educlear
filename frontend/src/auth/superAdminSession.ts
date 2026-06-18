/** Legacy key — cleared for older call sites; never trusted for access. */
export const EDUCLEAR_ROLE_STORAGE_KEY = "educlearRole";

/** JWT for platform super-admin APIs — independent from school `token`. */
export const SUPER_ADMIN_TOKEN_KEY = "superAdminToken";

const SUPER_ADMIN_EMAIL_KEY = "superAdminEmail";
const SUPER_ADMIN_USER_ID_KEY = "superAdminUserId";
const SUPER_ADMIN_PLATFORM_ROLE_KEY = "superAdminPlatformRole";

const SUPER_ADMIN_ROLE_VALUE = "superAdmin";
const PLATFORM_SUPER_ADMIN_EMAIL = "info@educlear.co.za";

function normalizeSuperAdminEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/** Legacy role payload detector — retained only for callers that need to identify old responses. */
export function isExplicitSuperAdminLoginPayload(data: unknown): boolean {
  const root = readRecord(data);
  if (!root) return false;

  const user = readRecord(root.user);

  return (
    root.educlearRole === SUPER_ADMIN_ROLE_VALUE ||
    root.platformRole === SUPER_ADMIN_ROLE_VALUE ||
    user?.educlearRole === SUPER_ADMIN_ROLE_VALUE ||
    user?.platformRole === SUPER_ADMIN_ROLE_VALUE
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

export function getCurrentAuthenticatedEmail(): string {
  const schoolToken = String(localStorage.getItem("token") || "").trim();
  if (schoolToken) {
    return normalizeSuperAdminEmail(localStorage.getItem("userEmail"));
  }

  return normalizeSuperAdminEmail(localStorage.getItem(SUPER_ADMIN_EMAIL_KEY));
}

export function isPlatformSuperAdminEmail(value: unknown): boolean {
  return normalizeSuperAdminEmail(value) === PLATFORM_SUPER_ADMIN_EMAIL;
}

/** True when a dedicated super-admin login session exists (not school staff session). */
export function hasSuperAdminSession(): boolean {
  const token = getSuperAdminToken();
  return Boolean(token && isPlatformSuperAdminEmail(getCurrentAuthenticatedEmail()));
}

/** Persist super-admin session from login — does not modify school `token` / `schoolId`. */
export function syncSuperAdminSessionFromLoginResponse(data: unknown): boolean {
  clearSuperAdminSession();

  const root = readRecord(data);
  if (!root) return false;

  const user = readRecord(root.user) ?? {};
  const token = String(root.token || "").trim();
  const email = normalizeSuperAdminEmail(user.email || root.email);

  if (!token || !isPlatformSuperAdminEmail(email)) {
    return false;
  }

  localStorage.setItem(SUPER_ADMIN_TOKEN_KEY, token);
  localStorage.setItem(SUPER_ADMIN_EMAIL_KEY, email);

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
