/**
 * Applicant payment status helpers (OA-06F).
 * Mirrors backend paymentInstructionsService guidance + POP_UPLOADABLE statuses.
 */
import type { ApplicantPaymentView } from "./publicAdmissionsTypes";

/** Application statuses where POP upload is allowed by backend. */
export const POP_UPLOADABLE_APP_STATUSES = new Set([
  "SUBMITTED",
  "UNDER_REVIEW",
  "INFO_REQUESTED",
]);

export function isPaymentEligibleApplicationStatus(
  status: string | null | undefined
): boolean {
  const s = String(status || "").toUpperCase();
  return (
    s === "SUBMITTED" ||
    s === "UNDER_REVIEW" ||
    s === "INFO_REQUESTED" ||
    s === "ACCEPTED" ||
    s === "DECLINED" ||
    s === "WITHDRAWN" ||
    s === "CANCELLED"
  );
}

/** Parent-facing payment status title. Never map to "Paid" before VERIFIED. */
export function parentFacingPaymentStatusTitle(paymentStatus: string | null | undefined): string {
  switch (String(paymentStatus || "").toUpperCase()) {
    case "NOT_REQUIRED":
      return "No admission fee required";
    case "AWAITING_PAYMENT":
      return "Admission fee payment required";
    case "PROOF_UPLOADED":
      return "Proof of payment received";
    case "UNDER_VERIFICATION":
      return "Payment verification in progress";
    case "VERIFIED":
      return "Payment verified";
    case "REJECTED":
      return "Proof of payment needs attention";
    case "WAIVED":
      return "Admission fee waived";
    default:
      return "Admission fee";
  }
}

/**
 * Show POP upload CTA only when backend allows and product UX should encourage it.
 * Pending verification: waiting state (no duplicate encouragement).
 * REJECTED / AWAITING_PAYMENT: deliberate upload/replace.
 */
export function shouldEncouragePopUpload(
  payment: ApplicantPaymentView,
  applicationStatus: string | null | undefined
): boolean {
  if (!payment.guidance?.canUploadProof) return false;
  const app = String(applicationStatus || "").toUpperCase();
  if (!POP_UPLOADABLE_APP_STATUSES.has(app)) return false;
  const ps = String(payment.paymentStatus || "").toUpperCase();
  if (ps === "VERIFIED" || ps === "WAIVED" || ps === "NOT_REQUIRED") return false;
  if (ps === "PROOF_UPLOADED" || ps === "UNDER_VERIFICATION") return false;
  return ps === "AWAITING_PAYMENT" || ps === "REJECTED" || Boolean(payment.guidance.shouldPay);
}

export function formatFeeDisplay(amount: string | null | undefined, currency: string | null | undefined): string {
  const cur = String(currency || "ZAR").trim() || "ZAR";
  const amt = String(amount || "").trim();
  if (!amt) return cur;
  return `${cur} ${amt}`;
}
