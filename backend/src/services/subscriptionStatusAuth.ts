/**
 * Authorize GET /api/subscriptions/school/:schoolId/status (Phase 6E).
 * Requires authenticated staff JWT; school match unless platform Super Admin.
 */
import { loadStaffSchoolAuth } from "../middleware/requireOwnerSchoolAccess";
import { isPlatformSuperAdminEmail } from "../utils/superAdmin";
import { normalizeStaffEmail } from "../utils/staffJwt";

export type SubscriptionStatusAuthDecision =
  | {
      allowed: true;
      userId: string;
      authorizedSchoolId: string;
      isSuperAdmin: boolean;
    }
  | {
      allowed: false;
      status: 401 | 403;
      error: string;
      code: "AUTH_REQUIRED" | "SCHOOL_MISMATCH" | "SCHOOL_ACCESS_DENIED";
    };

export async function authorizeSchoolSubscriptionStatusAccess(input: {
  authHeader: string | undefined;
  requestSchoolId: string;
}): Promise<SubscriptionStatusAuthDecision> {
  const requestSchoolId = String(input.requestSchoolId || "").trim();
  if (!requestSchoolId) {
    return {
      allowed: false,
      status: 403,
      error: "School access denied",
      code: "SCHOOL_ACCESS_DENIED",
    };
  }

  const auth = await loadStaffSchoolAuth(input.authHeader);
  if (!auth) {
    return {
      allowed: false,
      status: 401,
      error: "Authentication required",
      code: "AUTH_REQUIRED",
    };
  }

  const email = normalizeStaffEmail(auth.email);
  const isSuperAdmin = isPlatformSuperAdminEmail(email);
  const authorizedSchoolId = String(auth.authorizedSchoolId || "").trim();

  if (!isSuperAdmin && authorizedSchoolId !== requestSchoolId) {
    return {
      allowed: false,
      status: 403,
      error: "School access denied",
      code: "SCHOOL_MISMATCH",
    };
  }

  return {
    allowed: true,
    userId: auth.userId,
    authorizedSchoolId: isSuperAdmin ? requestSchoolId : authorizedSchoolId,
    isSuperAdmin,
  };
}
