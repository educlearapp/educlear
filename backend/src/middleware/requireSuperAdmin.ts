import type { NextFunction, Request, Response } from "express";

import { prisma } from "../prisma";
import { isPlatformSuperAdminEmail, normalizeSuperAdminEmail } from "../utils/superAdmin";
import { verifyStaffJwt } from "../utils/staffJwt";

export type SuperAdminRequest = Request & {
  superAdmin?: {
    userId: string;
    schoolId: string;
    email: string;
    role: string;
  };
};

async function resolveSuperAdminSessionEmail(payload: {
  userId: string;
  email: string;
}): Promise<string | null> {
  const jwtEmail = normalizeSuperAdminEmail(payload.email);
  if (jwtEmail && isPlatformSuperAdminEmail(jwtEmail)) {
    return jwtEmail;
  }

  const userId = String(payload.userId || "").trim();
  if (!userId) return null;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, isActive: true },
    });
    if (!user?.isActive) return null;

    const dbEmail = normalizeSuperAdminEmail(user.email);
    if (dbEmail && isPlatformSuperAdminEmail(dbEmail)) {
      return dbEmail;
    }
  } catch (error) {
    console.error("[requireSuperAdmin] user email lookup failed:", error);
  }

  return null;
}

/** Requires a valid staff JWT whose email is a platform super admin (env + built-in defaults). */
export async function requireSuperAdmin(req: SuperAdminRequest, res: Response, next: NextFunction) {
  const payload = verifyStaffJwt(req.headers.authorization);
  if (!payload) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const email = await resolveSuperAdminSessionEmail(payload);
  if (!email) {
    console.warn("[requireSuperAdmin] denied", {
      jwtEmail: normalizeSuperAdminEmail(payload.email) || "(empty)",
      userId: payload.userId,
    });
    return res.status(403).json({ error: "Super admin access required" });
  }

  req.superAdmin = { ...payload, email };
  return next();
}
