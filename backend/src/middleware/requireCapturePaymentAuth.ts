/**
 * Trusted staff auth for Capture Payment (POST /api/payments).
 * JWT → DB User → appRole → payments.create. Client schoolId is never authority.
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

export type CapturePaymentAuthContext = StaffJwtPayload & {
  appRole: string;
  authorizedSchoolId: string;
  capturedByName: string;
  permissions: PermissionMap;
};

export type CapturePaymentAuthDecision =
  | {
      allowed: true;
      authorizedSchoolId: string;
      appRole: string;
      auth: CapturePaymentAuthContext;
    }
  | { allowed: false; status: 401 | 403; error: string; code?: string };

export type CapturePaymentAuthRequest = Request & {
  capturePaymentAuth?: CapturePaymentAuthContext;
};

export type CapturePaymentPermissionAction = "view" | "create";

export function evaluateCapturePaymentAuth(input: {
  jwtPayload: StaffJwtPayload | null;
  user: { id: string; schoolId: string; role: string; isActive: boolean } | null;
  appRole: string;
  permissions: PermissionMap | null;
  requestSchoolId?: string;
  capturedByName?: string;
  /** Default create (financial write). Use view for payment GET / allocation suggest. */
  requireAction?: CapturePaymentPermissionAction;
}): CapturePaymentAuthDecision {
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
  const requireAction: CapturePaymentPermissionAction = input.requireAction || "create";
  if (!hasPermission(permUser, "payments", requireAction)) {
    return {
      allowed: false,
      status: 403,
      error: `Permission denied: payments.${requireAction}`,
      code: "FORBIDDEN_PERMISSION",
    };
  }

  const capturedByName = String(input.capturedByName || "").trim();
  const auth: CapturePaymentAuthContext = {
    ...payload,
    userId: input.user.id,
    schoolId: authorizedSchoolId,
    email: String(payload.email || "").trim(),
    appRole,
    authorizedSchoolId,
    capturedByName,
    permissions,
  };

  return { allowed: true, authorizedSchoolId, appRole, auth };
}

export async function resolveCapturePaymentAuth(
  req: Request,
  opts?: { requireAction?: CapturePaymentPermissionAction }
): Promise<CapturePaymentAuthDecision> {
  const payload = verifyStaffJwt(req.headers.authorization);
  const user = payload?.userId
    ? await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, schoolId: true, role: true, isActive: true, fullName: true },
      })
    : null;

  const meta = user ? await getUserAccessMeta(user.id) : null;
  const appRole = String(meta?.appRole || (user ? appRoleFromPrismaRole(user.role) : "")).trim();
  const body = (req.body ?? {}) as Record<string, unknown>;
  const query = (req.query ?? {}) as Record<string, unknown>;
  const requestSchoolId = String(body.schoolId || query.schoolId || "").trim();
  const capturedByName = [meta?.firstName, meta?.surname]
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .join(" ")
    .trim() || String(user?.fullName || "").trim();

  return evaluateCapturePaymentAuth({
    jwtPayload: payload,
    user,
    appRole,
    permissions: (meta?.permissions as PermissionMap | null) || null,
    requestSchoolId,
    capturedByName,
    requireAction: opts?.requireAction || "create",
  });
}

async function applyCapturePaymentAuth(
  req: CapturePaymentAuthRequest,
  res: Response,
  next: NextFunction,
  requireAction: CapturePaymentPermissionAction
) {
  const decision = await resolveCapturePaymentAuth(req, { requireAction });
  if (!decision.allowed) {
    return res.status(decision.status).json({
      success: false,
      error: decision.error,
      code: decision.code || null,
      message: decision.error,
    });
  }
  req.capturePaymentAuth = decision.auth;
  return next();
}

export async function requireCapturePaymentAuth(
  req: CapturePaymentAuthRequest,
  res: Response,
  next: NextFunction
) {
  return applyCapturePaymentAuth(req, res, next, "create");
}

/** payments.view — GET payment/account data and allocation suggest (not a financial write). */
export async function requireCapturePaymentReadAuth(
  req: CapturePaymentAuthRequest,
  res: Response,
  next: NextFunction
) {
  return applyCapturePaymentAuth(req, res, next, "view");
}
