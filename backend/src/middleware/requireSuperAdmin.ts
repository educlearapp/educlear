import type { NextFunction, Request, Response } from "express";

import { normalizeSuperAdminEmail } from "../utils/superAdmin";
import { verifyStaffJwt } from "../utils/staffJwt";
import { prisma } from "../prisma";

export type SuperAdminRequest = Request & {
  superAdmin?: {
    userId: string;
    schoolId: string;
    email: string;
    role: string;
  };
};

export function isAuthenticatedSuperAdminEmail(
  authenticatedEmail: unknown,
  isActive = true
): boolean {
  const email = normalizeSuperAdminEmail(authenticatedEmail);
  if (email !== "info@educlear.co.za") return false;
  return isActive;
}

/** Requires the authenticated database user email to be the platform super admin address. */
export async function requireSuperAdmin(req: SuperAdminRequest, res: Response, next: NextFunction) {
  const payload = verifyStaffJwt(req.headers.authorization);
  if (!payload?.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, schoolId: true, email: true, role: true, isActive: true },
  });
  const authenticatedEmail = normalizeSuperAdminEmail(user?.email);

  if (!user || !isAuthenticatedSuperAdminEmail(authenticatedEmail, Boolean(user.isActive))) {
    console.warn("[requireSuperAdmin] denied", {
      authenticatedEmail: authenticatedEmail || "(empty)",
      userId: payload.userId,
    });
    return res.status(403).json({ error: "Super admin access required" });
  }

  req.superAdmin = {
    userId: user.id,
    schoolId: user.schoolId,
    email: authenticatedEmail,
    role: user.role,
  };
  return next();
}
