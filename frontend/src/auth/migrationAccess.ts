import { isSuperAdmin } from "./roles";

export type MigrationAccessDeniedDebug = {
  userId: string | null;
  role: string | null;
  schoolId: string | null;
  missingPermission: string;
};

/** Platform super admin only — same gate as Schools Management. */
export function canAccessMigration(): boolean {
  return isSuperAdmin();
}

export function migrationAccessDeniedDebug(): MigrationAccessDeniedDebug {
  const role = String(localStorage.getItem("userRole") || "").trim().toUpperCase();
  const allowed = isSuperAdmin();
  return {
    userId: localStorage.getItem("userId") || null,
    role: role || null,
    schoolId: localStorage.getItem("schoolId") || null,
    missingPermission: allowed ? "none" : "migration_center_super_admin_required",
  };
}

/** Legacy login hook — migration access follows platform super-admin session only. */
export function syncMigrationAccessFromLoginResponse(_data: unknown): void {
  // No-op: canAccessMigration() reads super-admin session state from roles.ts.
}

export function clearMigrationAccess(): void {
  // No-op: kept for logout call sites.
}
