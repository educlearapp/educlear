/**
 * Trusted staff auth for Outstanding Accounts (GET read-only report).
 * JWT → DB User → statements.view. Client schoolId is never authority.
 */
import type { NextFunction, Request, Response } from "express";

import { prisma } from "../prisma";
import { getUserAccessMeta } from "../utils/userAccessStore";
import {
  appRoleFromPrismaRole,
  hasPermission,
  resolveStoredPermissions,
  type PermissionMap,
} from "../utils/userPermissions";
import { verifyStaffJwt, type StaffJwtPayload } from "../utils/staffJwt";

export type OutstandingAccountsAuthContext = StaffJwtPayload & {
  appRole: string;
  authorizedSchoolId: string;
  permissions: PermissionMap;
};

export type OutstandingAccountsAuthDecision =
  | {
      allowed: true;
      authorizedSchoolId: string;
      appRole: string;
      auth: OutstandingAccountsAuthContext;
    }
  | { allowed: false; status: 401 | 403; error: string; code?: string };

export type OutstandingAccountsAuthRequest = Request & {
  outstandingAccountsAuth?: OutstandingAccountsAuthContext;
};

export function evaluateOutstandingAccountsAuth(input: {
  jwtPayload: StaffJwtPayload | null;
  user: { id: string; schoolId: string; role: string; isActive: boolean } | null;
  appRole: string;
  permissions: PermissionMap | null;
  requestSchoolId?: string;
}): OutstandingAccountsAuthDecision {
  const payload = input.jwtPayload;
  if (!payload?.userId || !payload?.schoolId) {
    return {
      allowed: false,
      status: 401,
      error: "Authentication required",
      code: "AUTH_REQUIRED",
    };
  }
  if (!input.user?.isActive) {
    return {
      allowed: false,
      status: 401,
      error: "Authentication required",
      code: "AUTH_REQUIRED",
    };
  }
  if (String(input.user.schoolId) !== String(payload.schoolId)) {
    return {
      allowed: false,
      status: 403,
      error: "School access denied",
      code: "SCHOOL_ACCESS_DENIED",
    };
  }

  const authorizedSchoolId = String(input.user.schoolId || "").trim();
  if (!authorizedSchoolId) {
    return {
      allowed: false,
      status: 403,
      error: "Missing school authorization",
      code: "MISSING_SCHOOL",
    };
  }

  const requestSchoolId = String(input.requestSchoolId || "").trim();
  if (requestSchoolId && requestSchoolId !== authorizedSchoolId) {
    return {
      allowed: false,
      status: 403,
      error: "Request schoolId does not match authenticated school",
      code: "SCHOOL_MISMATCH",
    };
  }

  const appRole = String(input.appRole || "").trim();
  const permissions = resolveStoredPermissions(appRole || "Viewer", input.permissions);
  const permUser = { appRole, isActive: true, permissions };
  if (!hasPermission(permUser, "statements", "view")) {
    return {
      allowed: false,
      status: 403,
      error: "Permission denied: statements.view",
      code: "FORBIDDEN_PERMISSION",
    };
  }

  const auth: OutstandingAccountsAuthContext = {
    ...payload,
    userId: input.user.id,
    schoolId: authorizedSchoolId,
    email: String(payload.email || "").trim(),
    appRole,
    authorizedSchoolId,
    permissions,
  };

  return { allowed: true, authorizedSchoolId, appRole, auth };
}

export async function resolveOutstandingAccountsAuth(
  req: Request
): Promise<OutstandingAccountsAuthDecision> {
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
  const query = (req.query ?? {}) as Record<string, unknown>;
  const requestSchoolId = String(body.schoolId || query.schoolId || "").trim();

  return evaluateOutstandingAccountsAuth({
    jwtPayload: payload,
    user,
    appRole,
    permissions: (meta?.permissions as PermissionMap | null) || null,
    requestSchoolId,
  });
}

export async function requireOutstandingAccountsAuth(
  req: OutstandingAccountsAuthRequest,
  res: Response,
  next: NextFunction
) {
  const decision = await resolveOutstandingAccountsAuth(req);
  if (!decision.allowed) {
    return res.status(decision.status).json({
      success: false,
      error: decision.error,
      code: decision.code || null,
      message: decision.error,
    });
  }
  req.outstandingAccountsAuth = decision.auth;
  return next();
}
