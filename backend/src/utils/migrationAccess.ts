import { isPlatformSuperAdminEmail, normalizeSuperAdminEmail } from "./superAdmin";

/** Roles allowed to use Migration Center (JWT `role` string, case-insensitive). */
export const MIGRATION_ALLOWED_ROLES = new Set([
  "SUPER_ADMIN",
  "OWNER",
  "SCHOOL_OWNER",
  "SCHOOL_ADMIN",
  "PLATFORM_ADMIN",
]);

export type MigrationAccessContext = {
  userId: string;
  schoolId: string;
  email: string;
  role: string;
};

export function normalizeMigrationRole(role: unknown): string {
  return String(role || "").trim().toUpperCase();
}

export function isMigrationAllowedRole(role: unknown): boolean {
  return MIGRATION_ALLOWED_ROLES.has(normalizeMigrationRole(role));
}

export function canAccessMigration(ctx: MigrationAccessContext): boolean {
  const email = normalizeSuperAdminEmail(ctx.email);
  if (isPlatformSuperAdminEmail(email)) return true;
  return isMigrationAllowedRole(ctx.role);
}

export function migrationAccessDeniedDebug(ctx: Partial<MigrationAccessContext>): {
  userId: string | null;
  role: string | null;
  schoolId: string | null;
  missingPermission: string;
} {
  const role = normalizeMigrationRole(ctx.role);
  const email = normalizeSuperAdminEmail(ctx.email);
  let missingPermission = "migration_center";
  if (isPlatformSuperAdminEmail(email)) {
    missingPermission = "none";
  } else if (!role) {
    missingPermission = "role_missing";
  } else if (!isMigrationAllowedRole(role)) {
    missingPermission = `role_${role.toLowerCase()}_not_permitted`;
  }
  return {
    userId: ctx.userId ? String(ctx.userId) : null,
    role: role || null,
    schoolId: ctx.schoolId ? String(ctx.schoolId) : null,
    missingPermission,
  };
}
