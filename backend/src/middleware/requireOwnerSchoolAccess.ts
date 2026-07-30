import type { Request } from "express";

import { prisma } from "../prisma";
import { getUserAccessMeta } from "../utils/userAccessStore";
import {
  appRoleFromPrismaRole,
  isSchoolOwnerRole,
  type PermissionMap,
} from "../utils/userPermissions";
import { verifyStaffJwt, type StaffJwtPayload } from "../utils/staffJwt";

export type StaffSchoolAuth = StaffJwtPayload & {
  appRole: string;
  authorizedSchoolId: string;
  permissions: PermissionMap;
};

export type StaffSchoolAuthDecision =
  | { allowed: true; auth: StaffSchoolAuth }
  | { allowed: false; status: 401 | 403; error: string };

export async function loadStaffSchoolAuth(
  authHeader: string | undefined
): Promise<StaffSchoolAuth | null> {
  const payload = verifyStaffJwt(authHeader);
  if (!payload?.userId || !payload?.schoolId) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, schoolId: true, role: true, isActive: true },
  });
  if (!user?.isActive) return null;
  if (String(user.schoolId) !== String(payload.schoolId)) return null;

  const meta = await getUserAccessMeta(user.id);
  const appRole = String(meta?.appRole || appRoleFromPrismaRole(user.role)).trim();
  const permissions = meta?.permissions || ({} as PermissionMap);

  return {
    ...payload,
    appRole,
    authorizedSchoolId: String(user.schoolId),
    permissions,
  };
}

export function evaluateStaffSchoolMatch(
  auth: StaffSchoolAuth | null,
  requestSchoolId: string
): StaffSchoolAuthDecision {
  if (!auth) {
    return { allowed: false, status: 401, error: "Authentication required" };
  }
  const requested = String(requestSchoolId || "").trim();
  if (requested && requested !== auth.authorizedSchoolId) {
    return { allowed: false, status: 403, error: "School access denied" };
  }
  return { allowed: true, auth };
}

export function evaluateOwnerSchoolAuth(input: {
  auth: StaffSchoolAuth | null;
  requestSchoolId: string;
  deniedMessage?: string;
}): StaffSchoolAuthDecision {
  const match = evaluateStaffSchoolMatch(input.auth, input.requestSchoolId);
  if (!match.allowed) return match;
  if (!isSchoolOwnerRole(match.auth.appRole)) {
    return {
      allowed: false,
      status: 403,
      error: input.deniedMessage || "School Owner access required",
    };
  }
  return match;
}

/** @deprecated path alias kept only if needed — prefer evaluateOwnerSchoolAuth */
export type OwnerSchoolRequest = Request & { ownerSchoolAuth?: StaffSchoolAuth };
