import type { NextFunction, Request, Response } from "express";

import { isPlatformSuperAdminEmail } from "../utils/superAdmin";
import { verifyStaffJwt } from "../utils/staffJwt";

/**
 * Protects GET /api/auth/diagnostics/:email — platform super-admin JWT or
 * X-Auth-Diagnostics-Key matching AUTH_DIAGNOSTICS_SECRET.
 */
export function requireAuthDiagnostics(req: Request, res: Response, next: NextFunction) {
  const secret = String(process.env.AUTH_DIAGNOSTICS_SECRET || "").trim();
  const headerKey = String(req.headers["x-auth-diagnostics-key"] || "").trim();

  if (secret && headerKey && headerKey === secret) {
    return next();
  }

  const payload = verifyStaffJwt(req.headers.authorization);
  if (payload?.email && isPlatformSuperAdminEmail(payload.email)) {
    return next();
  }

  return res.status(403).json({
    error: "Auth diagnostics require super-admin JWT or X-Auth-Diagnostics-Key",
  });
}
