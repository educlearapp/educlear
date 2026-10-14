import type { StaffApplicationDetail } from "./staffAdmissionsTypes";

/** Owner-approved wording; must match the backend PAYMENT_PENDING_ACCEPTANCE_WARNING. */
export const PAYMENT_PENDING_ACCEPTANCE_WARNING =
  "Payment verification pending. Proof of payment has been uploaded, but receipt of funds has not yet been verified. Accepting this application does not confirm payment.";

/** Accept needs explicit acknowledgement only when proof is uploaded but not yet verified. */
export function acceptanceNeedsPaymentAcknowledgement(
  detail: Pick<StaffApplicationDetail, "payment" | "feeRequired">
): boolean {
  const required = Boolean(detail.payment?.required ?? detail.feeRequired);
  return required && detail.payment?.paymentStatus === "PROOF_UPLOADED";
}

/** True when the latest acceptance was recorded with payment verification pending. */
export function wasAcceptedWithPaymentPending(
  detail: Pick<StaffApplicationDetail, "status" | "auditTimeline">
): boolean {
  if (detail.status !== "ACCEPTED") return false;
  const events = (detail.auditTimeline || []).filter((e) => e.eventType === "APPLICATION_ACCEPTED");
  const last = events[events.length - 1];
  const meta = last?.metadataJson;
  return Boolean(meta && typeof meta === "object" && (meta as Record<string, unknown>).paymentVerificationPending === true);
}

export type PaymentVerificationState = "not_required" | "verified" | "waived" | "pending" | "rejected" | "not_paid";

export function paymentVerificationState(
  detail: Pick<StaffApplicationDetail, "payment" | "feeRequired">
): PaymentVerificationState {
  const required = Boolean(detail.payment?.required ?? detail.feeRequired);
  if (!required) return "not_required";
  switch (detail.payment?.paymentStatus) {
    case "VERIFIED":
      return "verified";
    case "WAIVED":
      return "waived";
    case "PROOF_UPLOADED":
    case "UNDER_VERIFICATION":
      return "pending";
    case "REJECTED":
      return "rejected";
    default:
      return "not_paid";
  }
}

export const PAYMENT_VERIFICATION_LABELS: Record<PaymentVerificationState, string> = {
  not_required: "Not required",
  verified: "Verified — funds received",
  waived: "Waived (not a payment)",
  pending: "Not verified — proof uploaded",
  rejected: "Proof rejected — fee outstanding",
  not_paid: "Not paid",
};

export function documentTypeDisplay(documentType: string): string {
  if (documentType === "proof_of_payment") return "Proof of payment";
  const s = String(documentType || "").replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Document";
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** File name from a Content-Disposition header; falls back to a safe default. */
export function fileNameFromContentDisposition(header: string | null, fallback: string): string {
  const raw = String(header || "");
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(raw);
  const plain = /filename="?([^";]+)"?/i.exec(raw);
  let name = "";
  try {
    name = star ? decodeURIComponent(star[1].trim().replace(/^"|"$/g, "")) : plain ? plain[1].trim() : "";
  } catch {
    name = plain ? plain[1].trim() : "";
  }
  name = name.replace(/[\\/:*?"<>|]+/g, "_").replace(/^\.+/, "");
  return name || fallback;
}

/** Staff-facing error text for a failed download. */
export function downloadErrorMessage(status: number, serverMessage: string | null): string {
  if (status === 401) return "Your session has expired. Sign in again, then retry.";
  if (status === 403) {
    return serverMessage || "You do not have permission to download this. Ask an administrator for admissions edit access.";
  }
  if (status === 404) return "This file is no longer available. Refresh the application and try again.";
  if (status === 0) return "Could not reach EduClear. Check your connection and try again.";
  return serverMessage || "The download could not be prepared. Please try again.";
}
