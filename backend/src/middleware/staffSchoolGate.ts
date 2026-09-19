import type { Response } from "express";

import { loadStaffSchoolAuth, type StaffSchoolAuth } from "./requireOwnerSchoolAccess";
import { isAuthenticatedSuperAdminEmail } from "./requireSuperAdmin";
import { prisma } from "../prisma";
import { hasPermission, type PermissionAction } from "../utils/userPermissions";

export type StaffSchoolGate = {
  auth: StaffSchoolAuth;
  superAdmin: boolean;
};

export function isCrossSchoolRequest(
  gate: Pick<StaffSchoolGate, "superAdmin" | "auth">,
  requestedSchoolId: string
): boolean {
  if (gate.superAdmin) return false;
  const requested = String(requestedSchoolId || "").trim();
  if (!requested) return false;
  return requested !== gate.auth.authorizedSchoolId;
}

export async function resolveStaffSchoolGate(
  authHeader: string | undefined
): Promise<StaffSchoolGate | null> {
  const auth = await loadStaffSchoolAuth(authHeader);
  if (!auth) return null;
  const row = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { email: true, isActive: true },
  });
  return {
    auth,
    superAdmin: isAuthenticatedSuperAdminEmail(row?.email, Boolean(row?.isActive)),
  };
}

export function sendAuthRequired(res: Response) {
  return res.status(401).json({
    success: false,
    error: "Authentication required",
    code: "AUTH_REQUIRED",
  });
}

export function sendSchoolDenied(res: Response) {
  return res.status(403).json({
    success: false,
    error: "School access denied",
    code: "SCHOOL_MISMATCH",
  });
}

export function allowSchool(
  gate: StaffSchoolGate,
  requestedSchoolId: string,
  res: Response
): boolean {
  if (!isCrossSchoolRequest(gate, requestedSchoolId)) return true;
  sendSchoolDenied(res);
  return false;
}

export function allowUsersAction(
  gate: StaffSchoolGate,
  action: PermissionAction,
  res: Response
): boolean {
  if (gate.superAdmin) return true;
  const raw = gate.auth.permissions;
  const stored = raw && Object.keys(raw).length > 0 ? raw : null;
  if (
    hasPermission(
      {
        appRole: gate.auth.appRole,
        isActive: true,
        permissions: stored,
      },
      "users",
      action
    )
  ) {
    return true;
  }
  res.status(403).json({
    success: false,
    error: "Users access required",
    code: "FORBIDDEN",
  });
  return false;
}
