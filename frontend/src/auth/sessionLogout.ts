import { clearEduClearRole } from "./roles";
import { clearSchoolSession } from "./schoolSession";
import { clearMigrationAccess } from "./migrationAccess";
import { clearSuperAdminSession, getSuperAdminToken } from "./superAdminSession";
import {
  clearSchoolSubscriptionStatusCache,
  clearSubscriptionGateCache,
} from "../subscriptions/subscriptionsApi";
import { clearParentSession, getParentToken } from "../parent/parentApi";

export const INACTIVITY_LOGOUT_MESSAGE = "You were logged out due to inactivity.";
export const INACTIVITY_LOGOUT_STORAGE_KEY = "educlearLogoutReason";

export type ActiveSessionKind = "parent" | "teacher" | "staff" | "superAdmin";

const STAFF_AUTH_KEYS = [
  "token",
  "schoolId",
  "userEmail",
  "userName",
  "userRole",
  "userId",
  "schoolName",
  "schoolLogoUrl",
  "isOwner",
] as const;

export function clearStaffAuthSession(): void {
  for (const key of STAFF_AUTH_KEYS) {
    localStorage.removeItem(key);
  }
  clearEduClearRole();
  clearSchoolSession();
  clearMigrationAccess();
  clearSubscriptionGateCache();
  clearSchoolSubscriptionStatusCache();
}

export function detectActiveSessionKind(pathname: string): ActiveSessionKind | null {
  if (pathname.startsWith("/super-admin")) {
    return getSuperAdminToken() ? "superAdmin" : null;
  }
  if (getParentToken()) return "parent";
  const token = String(localStorage.getItem("token") || "").trim();
  const schoolId = String(localStorage.getItem("schoolId") || "").trim();
  if (!token || !schoolId) return null;
  if (pathname.startsWith("/teacher")) return "teacher";
  return "staff";
}

export function consumeInactivityLogoutMessage(): string | null {
  try {
    const msg = sessionStorage.getItem(INACTIVITY_LOGOUT_STORAGE_KEY);
    if (msg) sessionStorage.removeItem(INACTIVITY_LOGOUT_STORAGE_KEY);
    return msg;
  } catch {
    return null;
  }
}

export function performInactivityLogout(kind: ActiveSessionKind): void {
  try {
    sessionStorage.setItem(INACTIVITY_LOGOUT_STORAGE_KEY, INACTIVITY_LOGOUT_MESSAGE);
  } catch {
    /* ignore */
  }

  if (kind === "parent") {
    clearParentSession();
    window.location.assign("/parent");
    return;
  }

  if (kind === "superAdmin") {
    clearSuperAdminSession();
    clearEduClearRole();
    window.location.assign("/super-admin/login");
    return;
  }

  clearStaffAuthSession();
  window.location.assign(kind === "teacher" ? "/teacher/login" : "/login");
}
