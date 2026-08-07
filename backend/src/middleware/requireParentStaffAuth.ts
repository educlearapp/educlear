/**
 * Trusted staff auth for Parent privileged / write operations.
 * Pattern mirrors requireInvoiceRunUndoAuth: JWT → DB User → appRole → school bind.
 * Client actorRole / x-app-role are NEVER authority sources.
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

export type ParentStaffAuthContext = StaffJwtPayload & {
  appRole: string;
  authorizedSchoolId: string;
  isOwnerAdmin: boolean;
  canCreateParents: boolean;
  canEditParents: boolean;
  canCreateLearners: boolean;
  canEditLearners: boolean;
  permissions: PermissionMap;
};

export type ParentStaffAuthDecision =
  | {
      allowed: true;
      authorizedSchoolId: string;
      appRole: string;
      auth: ParentStaffAuthContext;
    }
  | { allowed: false; status: 401 | 403; error: string; code?: string };

export type ParentStaffAuthRequest = Request & {
  parentStaffAuth?: ParentStaffAuthContext;
};

export function isTrustedOwnerAdminRole(appRole: string): boolean {
  const role = String(appRole || "").trim();
  return role === "Owner" || role === "Admin";
}

/** Pure auth decision — unit-testable; ignores client role headers/body. */
export function evaluateParentStaffAuth(input: {
  jwtPayload: StaffJwtPayload | null;
  user: { id: string; schoolId: string; role: string; isActive: boolean } | null;
  appRole: string;
  permissions: PermissionMap | null;
  requestSchoolId?: string;
  /** When true, only Owner/Admin may proceed. */
  requireOwnerAdmin?: boolean;
  /** When set, require the named module permission (Owner always passes via hasPermission). */
  requirePermission?: { module: "parents" | "learners"; action: "create" | "edit" | "view" };
}): ParentStaffAuthDecision {
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
  const isOwnerAdmin = isTrustedOwnerAdminRole(appRole);
  const permUser = { appRole, isActive: true, permissions };

  if (input.requireOwnerAdmin && !isOwnerAdmin) {
    return {
      allowed: false,
      status: 403,
      error: "Owner or Admin role required",
      code: "FORBIDDEN_OWNER_ADMIN",
    };
  }

  if (input.requirePermission) {
    const ok = hasPermission(
      permUser,
      input.requirePermission.module,
      input.requirePermission.action
    );
    if (!ok) {
      return {
        allowed: false,
        status: 403,
        error: `Permission denied: ${input.requirePermission.module}.${input.requirePermission.action}`,
        code: "FORBIDDEN_PERMISSION",
      };
    }
  }

  const auth: ParentStaffAuthContext = {
    ...payload,
    userId: input.user.id,
    schoolId: authorizedSchoolId,
    appRole,
    authorizedSchoolId,
    isOwnerAdmin,
    canCreateParents: hasPermission(permUser, "parents", "create"),
    canEditParents: hasPermission(permUser, "parents", "edit"),
    canCreateLearners: hasPermission(permUser, "learners", "create"),
    canEditLearners: hasPermission(permUser, "learners", "edit"),
    permissions,
  };

  return { allowed: true, authorizedSchoolId, appRole, auth };
}

export async function resolveParentStaffAuth(
  req: Request,
  opts?: {
    requireOwnerAdmin?: boolean;
    requirePermission?: { module: "parents" | "learners"; action: "create" | "edit" | "view" };
    /** Prefer this schoolId for mismatch checks (e.g. existing learner.schoolId). */
    requestSchoolId?: string;
  }
): Promise<ParentStaffAuthDecision> {
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
  const requestSchoolId = String(
    opts?.requestSchoolId ||
      body.schoolId ||
      query.schoolId ||
      ""
  ).trim();

  return evaluateParentStaffAuth({
    jwtPayload: payload,
    user,
    appRole,
    permissions: (meta?.permissions as PermissionMap | null) || null,
    requestSchoolId,
    requireOwnerAdmin: opts?.requireOwnerAdmin,
    requirePermission: opts?.requirePermission,
  });
}

export async function requireParentStaffAuth(
  req: ParentStaffAuthRequest,
  res: Response,
  next: NextFunction,
  opts?: {
    requireOwnerAdmin?: boolean;
    requirePermission?: { module: "parents" | "learners"; action: "create" | "edit" | "view" };
  }
) {
  const decision = await resolveParentStaffAuth(req, opts);
  if (!decision.allowed) {
    return res.status(decision.status).json({
      success: false,
      error: decision.error,
      code: decision.code || null,
      message: decision.error,
    });
  }
  req.parentStaffAuth = decision.auth;
  return next();
}

/** Express middleware factory. */
export function parentStaffAuthMiddleware(opts?: {
  requireOwnerAdmin?: boolean;
  requirePermission?: { module: "parents" | "learners"; action: "create" | "edit" | "view" };
}) {
  return (req: ParentStaffAuthRequest, res: Response, next: NextFunction) =>
    void requireParentStaffAuth(req, res, next, opts);
}
