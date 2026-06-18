import type { NextFunction, Response } from "express";

import {
  migrationAccessDeniedDebug,
  type MigrationAccessContext,
} from "../utils/migrationAccess";
import { prisma } from "../prisma";
import { verifyStaffJwt, type StaffJwtPayload } from "../utils/staffJwt";
import { normalizeSuperAdminEmail } from "../utils/superAdmin";
import { isAuthenticatedSuperAdminEmail } from "./requireSuperAdmin";

export type MigrationAccessRequest = import("express").Request & {
  migrationAuth?: StaffJwtPayload;
};

/** Platform super admin only — same allowlist as Schools Management. */
export async function requireMigrationAccess(
  req: MigrationAccessRequest,
  res: Response,
  next: NextFunction
) {
  const payload = verifyStaffJwt(req.headers.authorization);
  if (!payload?.userId) {
    return res.status(401).json({
      success: false,
      error: "Authentication required",
      code: "AUTH_REQUIRED",
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, schoolId: true, email: true, role: true, isActive: true },
  });
  const authenticatedEmail = normalizeSuperAdminEmail(user?.email);
  const ctx: MigrationAccessContext = {
    userId: payload.userId,
    schoolId: user?.schoolId || payload.schoolId || "",
    email: authenticatedEmail,
    role: user?.role || payload.role || "",
  };

  if (!user || !isAuthenticatedSuperAdminEmail(authenticatedEmail, Boolean(user.isActive))) {
    const debug = migrationAccessDeniedDebug(ctx);
    return res.status(403).json({
      success: false,
      error: "Migration access denied",
      code: "MIGRATION_ACCESS_DENIED",
      debug,
    });
  }

  req.migrationAuth = {
    userId: user.id,
    schoolId: user.schoolId,
    email: authenticatedEmail,
    role: user.role,
  };
  return next();
}
