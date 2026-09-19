/** Fly Eagle Primary — only school in scope for this remediation. */
export const FLY_EAGLE_SCHOOL_ID = "cmt1e8bjp0jo8lcjeketlynhl";

export const FLY_EAGLE_SCHOOL_NAME = "Fly Eagle Primary School";

/** Production apply gates (env). */
export const CONFIRM_FLY_EAGLE_REPAIR_ENV = "CONFIRM_FLY_EAGLE_BILLING_REPAIR";
export const CONFIRM_PRODUCTION_WRITE_ENV = "CONFIRM_PRODUCTION_WRITE";

export function assertFlyEagleSchoolId(schoolId: string): void {
  const sid = String(schoolId || "").trim();
  if (sid !== FLY_EAGLE_SCHOOL_ID) {
    throw new Error(
      `Refuse non-Fly-Eagle schoolId="${sid}" (expected ${FLY_EAGLE_SCHOOL_ID})`
    );
  }
}
