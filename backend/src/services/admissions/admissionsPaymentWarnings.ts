/**
 * Informational enrolment warnings for admission-fee state (owner decision 2026-10-14: warn, never block).
 * Application-scoped only — never reads or writes the FamilyAccount billing ledger.
 */

export function admissionFeeEnrolmentWarning(input: {
  feeRequired: boolean;
  paymentStatus: string | null | undefined;
}): { code: string; message: string } | null {
  if (!input.feeRequired) return null;
  const status = String(input.paymentStatus || "AWAITING_PAYMENT");
  switch (status) {
    case "NOT_REQUIRED":
    case "VERIFIED":
    case "WAIVED":
      return null;
    case "PROOF_UPLOADED":
    case "UNDER_VERIFICATION":
      return {
        code: "ADMISSION_FEE_VERIFICATION_PENDING",
        message:
          "Admission fee proof of payment has been uploaded but receipt of funds has not been verified.",
      };
    case "REJECTED":
      return {
        code: "ADMISSION_FEE_PROOF_REJECTED",
        message: "Admission fee proof of payment was rejected. The fee remains outstanding.",
      };
    default:
      return {
        code: "ADMISSION_FEE_OUTSTANDING",
        message: "Admission fee has not been paid or verified.",
      };
  }
}
