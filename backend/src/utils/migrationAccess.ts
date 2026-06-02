import { isPlatformSuperAdminEmail, normalizeSuperAdminEmail } from "./superAdmin";

export type MigrationAccessContext = {
  userId: string;
  schoolId: string;
  email: string;
  role: string;
};

export function normalizeMigrationRole(role: unknown): string {
  return String(role || "").trim().toUpperCase();
}

/** Platform super admin only — same allowlist as Schools Management (`requireSuperAdmin`). */
export function canAccessMigration(ctx: MigrationAccessContext): boolean {
  const email = normalizeSuperAdminEmail(ctx.email);
  if (isPlatformSuperAdminEmail(email)) return true;
  return normalizeMigrationRole(ctx.role) === "SUPER_ADMIN";
}

export function migrationAccessDeniedDebug(ctx: Partial<MigrationAccessContext>): {
  userId: string | null;
  role: string | null;
  schoolId: string | null;
  missingPermission: string;
} {
  const role = normalizeMigrationRole(ctx.role);
  const email = normalizeSuperAdminEmail(ctx.email);
  let missingPermission = "migration_center_super_admin_required";
  if (canAccessMigration({
    userId: String(ctx.userId || ""),
    schoolId: String(ctx.schoolId || ""),
    email,
    role,
  })) {
    missingPermission = "none";
  } else if (!email && !role) {
    missingPermission = "platform_super_admin_required";
  }
  return {
    userId: ctx.userId ? String(ctx.userId) : null,
    role: role || null,
    schoolId: ctx.schoolId ? String(ctx.schoolId) : null,
    missingPermission,
  };
}
