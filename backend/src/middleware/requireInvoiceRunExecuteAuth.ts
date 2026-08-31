import type { NextFunction, Request, Response } from "express";

import { prisma } from "../prisma";
import { getUserAccessMeta } from "../utils/userAccessStore";
import { appRoleFromPrismaRole } from "../utils/userPermissions";
import { verifyStaffJwt, type StaffJwtPayload } from "../utils/staffJwt";

const ALLOWED_EXECUTE_ROLES = new Set(["Owner", "Admin", "Finance"]);

export type InvoiceRunExecuteAuthRequest = Request & {
  invoiceRunExecuteAuth?: StaffJwtPayload & { appRole: string; authorizedSchoolId: string };
};

export type InvoiceRunExecuteAuthDecision =
  | {
      allowed: true;
      authorizedSchoolId: string;
      appRole: string;
      auth: StaffJwtPayload & { appRole: string; authorizedSchoolId: string };
    }
  | { allowed: false; status: 401 | 403; error: string };

/** Pure auth decision — school is bound from the session user, never from client schoolId. */
export function evaluateInvoiceRunExecuteAuth(input: {
  jwtPayload: StaffJwtPayload | null;
  user: { schoolId: string; role: string; isActive: boolean } | null;
  appRole: string;
  requestSchoolId: string;
}): InvoiceRunExecuteAuthDecision {
  const payload = input.jwtPayload;
  if (!payload?.userId || !payload?.schoolId) {
    return { allowed: false, status: 401, error: "Authentication required" };
  }
  if (!input.user?.isActive) {
    return { allowed: false, status: 401, error: "Authentication required" };
  }
  if (String(input.user.schoolId) !== String(payload.schoolId)) {
    return { allowed: false, status: 403, error: "School access denied" };
  }

  const appRole = String(input.appRole || "").trim();
  if (!ALLOWED_EXECUTE_ROLES.has(appRole)) {
    return {
      allowed: false,
      status: 403,
      error: "Owner, Admin or Finance role required for invoice run preview and execute",
    };
  }

  const authorizedSchoolId = String(input.user.schoolId || "").trim();
  if (!authorizedSchoolId) {
    return { allowed: false, status: 403, error: "Missing school authorization" };
  }

  const requestSchoolId = String(input.requestSchoolId || "").trim();
  if (requestSchoolId && requestSchoolId !== authorizedSchoolId) {
    return {
      allowed: false,
      status: 403,
      error: "Request schoolId does not match authenticated school",
    };
  }

  const auth = { ...payload, appRole, authorizedSchoolId };
  return { allowed: true, authorizedSchoolId, appRole, auth };
}

export async function requireInvoiceRunExecuteAuth(
  req: InvoiceRunExecuteAuthRequest,
  res: Response,
  next: NextFunction
) {
  const payload = verifyStaffJwt(req.headers.authorization);
  const user = payload?.userId
    ? await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, schoolId: true, role: true, isActive: true },
      })
    : null;

  const meta = user ? await getUserAccessMeta(user.id) : null;
  const appRole = String(meta?.appRole || (user ? appRoleFromPrismaRole(user.role) : "")).trim();
  const body = (req.body ?? {}) as Record<string, unknown>;
  const decision = evaluateInvoiceRunExecuteAuth({
    jwtPayload: payload,
    user,
    appRole,
    requestSchoolId: String(body.schoolId || req.query?.schoolId || "").trim(),
  });

  if (!decision.allowed) {
    return res.status(decision.status).json({ success: false, error: decision.error });
  }

  req.invoiceRunExecuteAuth = decision.auth;
  return next();
}
