import type { Response } from "express";
import { isPlatformSuperAdminEmail, normalizeSuperAdminEmail } from "../utils/superAdmin";
import type { MigrationAccessRequest } from "../middleware/requireMigrationAccess";

export function resolveMigrationSchoolId(
  req: MigrationAccessRequest,
  bodySchoolId?: unknown
): string {
  const authSchoolId = String(req.migrationAuth?.schoolId || "").trim();
  const requested = String(bodySchoolId || "").trim();
  const email = normalizeSuperAdminEmail(req.migrationAuth?.email);

  if (isPlatformSuperAdminEmail(email) && requested) {
    return requested;
  }
  return authSchoolId;
}

export function assertMigrationSchoolScope(
  req: MigrationAccessRequest,
  schoolId: string,
  res: Response
): boolean {
  const authSchoolId = String(req.migrationAuth?.schoolId || "").trim();
  const email = normalizeSuperAdminEmail(req.migrationAuth?.email);
  if (isPlatformSuperAdminEmail(email)) return true;
  if (schoolId && schoolId === authSchoolId) return true;
  res.status(403).json({
    success: false,
    error: "School scope mismatch",
    code: "SCHOOL_SCOPE_DENIED",
  });
  return false;
}
