/**
 * Staff auth for GET /api/lists-registers/*.
 * JWT → DB user → authorizedSchoolId.
 * Allows any of: reports.view | registrations.view | learners.view |
 * employees.view | payroll.view | attendance.view
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

export type ListsRegistersAuthContext = StaffJwtPayload & {
  appRole: string;
  authorizedSchoolId: string;
  permissions: PermissionMap;
};

export type ListsRegistersAuthDecision =
  | {
      allowed: true;
      authorizedSchoolId: string;
      appRole: string;
      auth: ListsRegistersAuthContext;
    }
  | { allowed: false; status: 401 | 403; error: string; code?: string };

export type ListsRegistersAuthRequest = Request & {
  listsRegistersAuth?: ListsRegistersAuthContext;
};

function hasListsRegistersReadPermission(
  appRole: string,
  permissions: PermissionMap | null
): boolean {
  const permUser = {
    appRole,
    isActive: true,
    permissions: resolveStoredPermissions(appRole || "Viewer", permissions),
  };
  return (
    hasPermission(permUser, "reports", "view") ||
    hasPermission(permUser, "registrations", "view") ||
    hasPermission(permUser, "learners", "view") ||
    hasPermission(permUser, "employees", "view") ||
    hasPermission(permUser, "payroll", "view") ||
    hasPermission(permUser, "attendance", "view")
  );
}

export function evaluateListsRegistersAuth(input: {
  jwtPayload: StaffJwtPayload | null;
  user: { id: string; schoolId: string; role: string; isActive: boolean } | null;
  appRole: string;
  permissions: PermissionMap | null;
  requestSchoolId?: string;
}): ListsRegistersAuthDecision {
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
  if (!hasListsRegistersReadPermission(appRole, input.permissions)) {
    return {
      allowed: false,
      status: 403,
      error:
        "Permission denied: reports.view / registrations.view / learners.view / employees.view / payroll.view / attendance.view",
      code: "FORBIDDEN_PERMISSION",
    };
  }

  const permissions = resolveStoredPermissions(appRole || "Viewer", input.permissions);
  const auth: ListsRegistersAuthContext = {
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

export async function resolveListsRegistersAuth(
  req: Request
): Promise<ListsRegistersAuthDecision> {
  const payload = verifyStaffJwt(req.headers.authorization);
  const user = payload?.userId
    ? await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, schoolId: true, role: true, isActive: true },
      })
    : null;

  const meta = user ? await getUserAccessMeta(user.id) : null;
  const appRole = String(meta?.appRole || (user ? appRoleFromPrismaRole(user.role) : "")).trim();
  const query = (req.query ?? {}) as Record<string, unknown>;
  const requestSchoolId = String(query.schoolId || "").trim();

  return evaluateListsRegistersAuth({
    jwtPayload: payload,
    user,
    appRole,
    permissions: (meta?.permissions as PermissionMap | null) || null,
    requestSchoolId,
  });
}

export async function requireListsRegistersAuth(
  req: ListsRegistersAuthRequest,
  res: Response,
  next: NextFunction
) {
  const decision = await resolveListsRegistersAuth(req);
  if (!decision.allowed) {
    return res.status(decision.status).json({
      success: false,
      error: decision.error,
      code: decision.code || null,
      message: decision.error,
    });
  }
  req.listsRegistersAuth = decision.auth;
  return next();
}
