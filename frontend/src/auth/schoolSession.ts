import type { PermissionMap } from "../users/permissions";
import { mergePermissions, permissionsForRole } from "../users/permissions";

export const USER_APP_ROLE_STORAGE_KEY = "userAppRole";
export const USER_PERMISSIONS_STORAGE_KEY = "userPermissions";

export type SchoolSessionUser = {
  appRole: string;
  permissions: PermissionMap;
  isActive: boolean;
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function parsePermissions(raw: unknown): PermissionMap | null {
  if (!raw || typeof raw !== "object") return null;
  return mergePermissions(raw as PermissionMap);
}

export function clearSchoolSession(): void {
  localStorage.removeItem(USER_APP_ROLE_STORAGE_KEY);
  localStorage.removeItem(USER_PERMISSIONS_STORAGE_KEY);
}

/** Persist app role + permission map from login or /auth/me. */
export function syncSchoolSessionFromLoginResponse(data: unknown): void {
  const root = readRecord(data);
  const user = readRecord(root?.user) || root;
  if (!user) {
    clearSchoolSession();
    return;
  }

  const appRole = String(user.appRole || user.role || "Viewer").trim() || "Viewer";
  const permissions =
    parsePermissions(user.permissions) || permissionsForRole(appRole);

  localStorage.setItem(USER_APP_ROLE_STORAGE_KEY, appRole);
  localStorage.setItem(USER_PERMISSIONS_STORAGE_KEY, JSON.stringify(permissions));

  if (user.prismaRole != null) {
    localStorage.setItem("userRole", String(user.prismaRole));
  } else if (user.role != null && String(user.role).includes("_")) {
    localStorage.setItem("userRole", String(user.role));
  }
}

export function getSchoolSessionUser(): SchoolSessionUser {
  const appRole = localStorage.getItem(USER_APP_ROLE_STORAGE_KEY) || "Viewer";
  let permissions: PermissionMap | null = null;
  try {
    const raw = localStorage.getItem(USER_PERMISSIONS_STORAGE_KEY);
    if (raw) permissions = parsePermissions(JSON.parse(raw));
  } catch {
    permissions = null;
  }

  return {
    appRole,
    permissions: permissions || permissionsForRole(appRole),
    isActive: true,
  };
}
