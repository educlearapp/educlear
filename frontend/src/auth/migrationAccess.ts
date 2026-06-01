import { isSuperAdmin, PLATFORM_SUPER_ADMIN_EMAILS } from "./roles";

const MIGRATION_ACCESS_STORAGE_KEY = "educlearMigrationAccess";
const MIGRATION_ALLOWED_ROLES = new Set([
  "SUPER_ADMIN",
  "OWNER",
  "SCHOOL_OWNER",
  "SCHOOL_ADMIN",
  "PLATFORM_ADMIN",
]);

function normalizeEmail(email: unknown): string {
  return String(email || "").trim().toLowerCase();
}

function normalizeRole(role: unknown): string {
  return String(role || "").trim().toUpperCase();
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function isMigrationAllowedRole(role: unknown): boolean {
  return MIGRATION_ALLOWED_ROLES.has(normalizeRole(role));
}

export function canAccessMigration(): boolean {
  if (isSuperAdmin()) return true;
  if (localStorage.getItem(MIGRATION_ACCESS_STORAGE_KEY) === "1") return true;
  if (isMigrationAllowedRole(localStorage.getItem("userRole"))) return true;
  return false;
}

export type MigrationAccessDeniedDebug = {
  userId: string | null;
  role: string | null;
  schoolId: string | null;
  missingPermission: string;
};

export function migrationAccessDeniedDebug(): MigrationAccessDeniedDebug {
  const role = normalizeRole(localStorage.getItem("userRole"));
  const email = normalizeEmail(localStorage.getItem("userEmail"));
  let missingPermission = "migration_center";
  if (isSuperAdmin() || PLATFORM_SUPER_ADMIN_EMAILS.some((allowed) => email === allowed)) {
    missingPermission = "none";
  } else if (!role) {
    missingPermission = "role_missing";
  } else if (!isMigrationAllowedRole(role)) {
    missingPermission = `role_${role.toLowerCase()}_not_permitted`;
  }
  return {
    userId: localStorage.getItem("userId") || null,
    role: role || null,
    schoolId: localStorage.getItem("schoolId") || null,
    missingPermission,
  };
}

/** Persist migration flag from login payload (`canAccessMigration` or owner role). */
export function syncMigrationAccessFromLoginResponse(data: unknown): void {
  const root = readRecord(data);
  if (!root) {
    localStorage.removeItem(MIGRATION_ACCESS_STORAGE_KEY);
    return;
  }

  const user = readRecord(root.user);
  const explicit =
    root.canAccessMigration === true ||
    user?.canAccessMigration === true ||
    isMigrationAllowedRole(user?.role) ||
    isMigrationAllowedRole(root.role);

  if (explicit || isSuperAdmin()) {
    localStorage.setItem(MIGRATION_ACCESS_STORAGE_KEY, "1");
    if (user?.id) localStorage.setItem("userId", String(user.id));
    return;
  }

  localStorage.removeItem(MIGRATION_ACCESS_STORAGE_KEY);
}

export function clearMigrationAccess(): void {
  localStorage.removeItem(MIGRATION_ACCESS_STORAGE_KEY);
}
