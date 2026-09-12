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

/**
 * Medical / health free-text on application detail.
 * Requires admissions.manage (Admin/Owner by default). Finance has edit but not manage —
 * so Finance/view-only staff do not receive allergies/medicalAlert/notes.
 */
export function canViewAdmissionsMedicalDetails(hasAdmissionsManage: boolean): boolean {
  return Boolean(hasAdmissionsManage);
}

/**
 * Internal AdmissionStaffNote bodies.
 * Requires admissions.edit or admissions.manage (Finance has edit; view-only does not).
 * A client includeStaffNotes flag must never grant this.
 */
export function canViewAdmissionsStaffNotes(hasAdmissionsEditOrManage: boolean): boolean {
  return Boolean(hasAdmissionsEditOrManage);
}
