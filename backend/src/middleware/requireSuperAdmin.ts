import type { NextFunction, Request, Response } from "express";

import { isPlatformSuperAdminEmail } from "../utils/superAdmin";
import { normalizeStaffEmail, verifyStaffJwt } from "../utils/staffJwt";

export type SuperAdminRequest = Request & {
  superAdmin?: {
    userId: string;
    schoolId: string;
    email: string;
    role: string;
  };
};

/** Requires a valid staff JWT whose email is listed in SUPER_ADMIN_EMAILS. */
export function requireSuperAdmin(req: SuperAdminRequest, res: Response, next: NextFunction) {
  const payload = verifyStaffJwt(req.headers.authorization);
  if (!payload) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const email = normalizeStaffEmail(payload.email);
  if (!isPlatformSuperAdminEmail(email)) {
    return res.status(403).json({ error: "Super admin access required" });
  }

  req.superAdmin = { ...payload, email };
  return next();
}
