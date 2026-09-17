/**
 * Staff auth for /api/admissions/settings.
 * JWT → DB User → authorizedSchoolId. Client schoolId is never authority.
 */
import type { NextFunction, Request, Response } from "express";

import { loadStaffSchoolAuth, type StaffSchoolAuth } from "./requireOwnerSchoolAccess";
import {
  hasPermission,
  resolveStoredPermissions,
  type PermissionAction,
} from "../utils/userPermissions";

export type AdmissionsSettingsAuthRequest = Request & {
  admissionsSettingsAuth?: StaffSchoolAuth;
};

export function evaluateAdmissionsSettingsAuth(input: {
  auth: StaffSchoolAuth | null;
  requireAction: PermissionAction;
  requestSchoolId?: string;
}):
  | { allowed: true; auth: StaffSchoolAuth }
  | { allowed: false; status: 401 | 403; error: string; code?: string } {
  if (!input.auth) {
    return { allowed: false, status: 401, error: "Authentication required", code: "AUTH_REQUIRED" };
  }

  const requestSchoolId = String(input.requestSchoolId || "").trim();
  if (requestSchoolId && requestSchoolId !== input.auth.authorizedSchoolId) {
    return {
      allowed: false,
      status: 403,
      error: "Request schoolId does not match authenticated school",
      code: "SCHOOL_MISMATCH",
    };
  }

  const permissions = resolveStoredPermissions(input.auth.appRole, input.auth.permissions);
  const permUser = {
    appRole: input.auth.appRole,
    isActive: true,
    permissions,
  };

  if (!hasPermission(permUser, "admissions", input.requireAction)) {
    // manage implies view for settings read
    if (
      input.requireAction === "view" &&
      hasPermission(permUser, "admissions", "manage")
    ) {
      return { allowed: true, auth: input.auth };
    }
    return {
      allowed: false,
      status: 403,
      error: "Admissions permission required",
      code: "ADMISSIONS_FORBIDDEN",
    };
  }

  return { allowed: true, auth: input.auth };
}

export function requireAdmissionsSettingsAuth(requireAction: PermissionAction) {
  return async (req: AdmissionsSettingsAuthRequest, res: Response, next: NextFunction) => {
    try {
      const auth = await loadStaffSchoolAuth(req.headers.authorization);
      const requestSchoolId = String(
        (req.query.schoolId as string) || (req.body && req.body.schoolId) || ""
      ).trim();
      const decision = evaluateAdmissionsSettingsAuth({
        auth,
        requireAction,
        requestSchoolId,
      });
      if (!decision.allowed) {
        return res.status(decision.status).json({
          success: false,
          error: decision.error,
          code: decision.code,
        });
      }
      req.admissionsSettingsAuth = decision.auth;
      return next();
    } catch (err) {
      console.error("requireAdmissionsSettingsAuth failed", err);
      return res.status(500).json({ success: false, error: "Authentication failed" });
    }
  };
}
