import type { NextFunction, Response } from "express";

import {
  canAccessMigration,
  migrationAccessDeniedDebug,
  type MigrationAccessContext,
} from "../utils/migrationAccess";
import { normalizeStaffEmail, verifyStaffJwt, type StaffJwtPayload } from "../utils/staffJwt";

export type MigrationAccessRequest = import("express").Request & {
  migrationAuth?: StaffJwtPayload;
};

/** Platform super admin only — same allowlist as Schools Management. */
export function requireMigrationAccess(
  req: MigrationAccessRequest,
  res: Response,
  next: NextFunction
) {
  const payload = verifyStaffJwt(req.headers.authorization);
  if (!payload?.userId || !payload?.schoolId) {
    return res.status(401).json({
      success: false,
      error: "Authentication required",
      code: "AUTH_REQUIRED",
    });
  }

  const ctx: MigrationAccessContext = {
    userId: payload.userId,
    schoolId: payload.schoolId,
    email: normalizeStaffEmail(payload.email),
    role: payload.role,
  };

  if (!canAccessMigration(ctx)) {
    const debug = migrationAccessDeniedDebug(ctx);
    return res.status(403).json({
      success: false,
      error: "Migration access denied",
      code: "MIGRATION_ACCESS_DENIED",
      debug,
    });
  }

  req.migrationAuth = payload;
  return next();
}
