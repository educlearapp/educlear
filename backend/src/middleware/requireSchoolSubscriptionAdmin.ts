import type { NextFunction, Request, Response } from "express";

import { isPlatformSuperAdminEmail } from "../utils/superAdmin";
import { normalizeStaffEmail, verifyStaffJwt, type StaffJwtPayload } from "../utils/staffJwt";

export type SchoolSubscriptionAdminRequest = Request & {
  schoolAuth?: StaffJwtPayload;
};

/** School owner (SCHOOL_ADMIN) or platform super admin via JWT from /auth/login. */
export function requireSchoolSubscriptionAdmin(
  req: SchoolSubscriptionAdminRequest,
  res: Response,
  next: NextFunction,
) {
  const payload = verifyStaffJwt(req.headers.authorization);
  if (!payload?.userId || !payload?.schoolId) {
    return res.status(401).json({ success: false, error: "Authentication required" });
  }

  const email = normalizeStaffEmail(payload.email);
  const isSuperAdmin = isPlatformSuperAdminEmail(email);
  const role = String(payload.role || "").trim().toUpperCase();

  if (!isSuperAdmin && role !== "SCHOOL_ADMIN") {
    return res.status(403).json({
      success: false,
      error: "School owner or super admin access required",
    });
  }

  req.schoolAuth = payload;
  return next();
}
