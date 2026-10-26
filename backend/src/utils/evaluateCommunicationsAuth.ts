/**
 * Pure Communications Centre auth decision (no Prisma / Express).
 * View never implies send/create/edit/delete/print — callers pass the exact action.
 */
import {
  hasCommunicationsPermission,
  resolveStoredPermissions,
  type PermissionAction,
  type PermissionMap,
} from "./userPermissions";

export type CommunicationsAuthLike = {
  appRole: string;
  authorizedSchoolId: string;
  permissions?: PermissionMap | null;
};

export function evaluateCommunicationsAuth(input: {
  auth: CommunicationsAuthLike | null;
  requireAction: PermissionAction;
  requestSchoolId?: string;
}):
  | { allowed: true; auth: CommunicationsAuthLike & { permissions: PermissionMap } }
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

  const permissions = resolveStoredPermissions(input.auth.appRole, input.auth.permissions || null);
  const permUser = {
    appRole: input.auth.appRole,
    isActive: true,
    permissions,
  };

  if (hasCommunicationsPermission(permUser, input.requireAction)) {
    return { allowed: true, auth: { ...input.auth, permissions } };
  }

  return {
    allowed: false,
    status: 403,
    error: `Permission denied: communications.${input.requireAction}`,
    code: "COMMUNICATIONS_FORBIDDEN",
  };
}
