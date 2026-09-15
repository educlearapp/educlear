/**
 * Trusted staff auth for statement send (email/SMS).
 * JWT → DB User → statements.send. Client schoolId is never authority.
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

export type StatementSendAuthContext = StaffJwtPayload & {
  appRole: string;
  authorizedSchoolId: string;
  permissions: PermissionMap;
};

export type StatementSendAuthDecision =
  | {
      allowed: true;
      authorizedSchoolId: string;
      appRole: string;
      auth: StatementSendAuthContext;
    }
  | { allowed: false; status: 401 | 403; error: string; code?: string };

export type StatementSendAuthRequest = Request & {
  statementSendAuth?: StatementSendAuthContext;
};

export function evaluateStatementSendAuth(input: {
  jwtPayload: StaffJwtPayload | null;
  user: { id: string; schoolId: string; role: string; isActive: boolean } | null;
  appRole: string;
  permissions: PermissionMap | null;
  requestSchoolId?: string;
}): StatementSendAuthDecision {
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
  if (!hasPermission(permUser, "statements", "send")) {
    return {
      allowed: false,
      status: 403,
      error: "Permission denied: statements.send",
      code: "FORBIDDEN_PERMISSION",
    };
  }

  const auth: StatementSendAuthContext = {
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

export async function resolveStatementSendAuth(
  req: Request
): Promise<StatementSendAuthDecision> {
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

  return evaluateStatementSendAuth({
    jwtPayload: payload,
    user,
    appRole,
    permissions: (meta?.permissions as PermissionMap | null) || null,
    requestSchoolId,
  });
}

export async function requireStatementSendAuth(
  req: StatementSendAuthRequest,
  res: Response,
  next: NextFunction
) {
  const decision = await resolveStatementSendAuth(req);
  if (!decision.allowed) {
    return res.status(decision.status).json({
      success: false,
      error: decision.error,
      code: decision.code || null,
      message: decision.error,
      simulated: false,
    });
  }
  req.statementSendAuth = decision.auth;
  return next();
}
