/**
 * Online Admissions decision authority (OA-03A).
 *
 * Module×action `admissions.manage` is shared by settings and (later) accept/decline.
 * Finance may receive admissions.edit for payment verification but MUST NOT accept/decline.
 * Future accept/decline routes must call canMakeAdmissionDecision() in addition to permissions.
 */

export function canMakeAdmissionDecision(appRole: string | null | undefined): boolean {
  const role = String(appRole || "").trim();
  return role === "Owner" || role === "Admin";
}

/** Payment verify / reject / waive — Finance with admissions.edit may act; accept still blocked above. */
export function canAdministerAdmissionPayment(
  appRole: string | null | undefined,
  hasAdmissionsEditOrManage: boolean
): boolean {
  if (!hasAdmissionsEditOrManage) return false;
  const role = String(appRole || "").trim();
  return role === "Owner" || role === "Admin" || role === "Finance";
}
