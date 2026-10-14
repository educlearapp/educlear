/**
 * Acceptance with pending payment + application documents/printing frontend unit tests.
 * Run: npx tsx src/admissions/admissions.acceptancePrinting.unit.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PAYMENT_PENDING_ACCEPTANCE_WARNING,
  PAYMENT_VERIFICATION_LABELS,
  acceptanceNeedsPaymentAcknowledgement,
  documentTypeDisplay,
  downloadErrorMessage,
  fileNameFromContentDisposition,
  formatFileSize,
  paymentVerificationState,
  wasAcceptedWithPaymentPending,
} from "./admissionsDocumentActions";
import type { StaffApplicationDetail } from "./staffAdmissionsTypes";

const here = dirname(fileURLToPath(import.meta.url));
const src = (file: string) => readFileSync(join(here, file), "utf8");

type PaymentDetail = Pick<StaffApplicationDetail, "payment" | "feeRequired">;

function paymentDetail(paymentStatus: string | null, required = true): PaymentDetail {
  return {
    feeRequired: required,
    payment:
      paymentStatus === null
        ? null
        : ({ required, paymentStatus } as unknown as StaffApplicationDetail["payment"]),
  } as PaymentDetail;
}

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

test("warning text matches owner wording exactly", () => {
  assert.equal(
    PAYMENT_PENDING_ACCEPTANCE_WARNING,
    "Payment verification pending. Proof of payment has been uploaded, but receipt of funds has not yet been verified. Accepting this application does not confirm payment."
  );
});

test("acknowledgement only for PROOF_UPLOADED with a required fee", () => {
  assert.equal(acceptanceNeedsPaymentAcknowledgement(paymentDetail("PROOF_UPLOADED")), true);
  for (const s of ["AWAITING_PAYMENT", "UNDER_VERIFICATION", "VERIFIED", "REJECTED", "WAIVED", "NOT_REQUIRED"]) {
    assert.equal(acceptanceNeedsPaymentAcknowledgement(paymentDetail(s)), false, s);
  }
  assert.equal(acceptanceNeedsPaymentAcknowledgement(paymentDetail("PROOF_UPLOADED", false)), false);
  assert.equal(acceptanceNeedsPaymentAcknowledgement(paymentDetail(null)), false);
});

test("payment verification state never reports pending proof as paid", () => {
  assert.equal(paymentVerificationState(paymentDetail("PROOF_UPLOADED")), "pending");
  assert.equal(paymentVerificationState(paymentDetail("UNDER_VERIFICATION")), "pending");
  assert.equal(paymentVerificationState(paymentDetail("VERIFIED")), "verified");
  assert.equal(paymentVerificationState(paymentDetail("WAIVED")), "waived");
  assert.equal(paymentVerificationState(paymentDetail("REJECTED")), "rejected");
  assert.equal(paymentVerificationState(paymentDetail("AWAITING_PAYMENT")), "not_paid");
  assert.equal(paymentVerificationState(paymentDetail("PROOF_UPLOADED", false)), "not_required");
  assert.match(PAYMENT_VERIFICATION_LABELS.pending, /Not verified/);
  assert.doesNotMatch(PAYMENT_VERIFICATION_LABELS.waived, /paid/i);
});

test("accepted-with-pending flag comes from the latest acceptance audit", () => {
  const timeline = (pending: boolean) =>
    [
      { eventType: "APPLICATION_SUBMITTED", metadataJson: null },
      { eventType: "APPLICATION_ACCEPTED", metadataJson: { paymentVerificationPending: pending } },
    ] as unknown as StaffApplicationDetail["auditTimeline"];
  assert.equal(wasAcceptedWithPaymentPending({ status: "ACCEPTED", auditTimeline: timeline(true) }), true);
  assert.equal(wasAcceptedWithPaymentPending({ status: "ACCEPTED", auditTimeline: timeline(false) }), false);
  assert.equal(wasAcceptedWithPaymentPending({ status: "DECLINED", auditTimeline: timeline(true) }), false);
  assert.equal(
    wasAcceptedWithPaymentPending({ status: "ACCEPTED", auditTimeline: [] as StaffApplicationDetail["auditTimeline"] }),
    false
  );
});

test("file name parsing is safe and falls back", () => {
  assert.equal(
    fileNameFromContentDisposition('attachment; filename="APP-2027-000001_application.pdf"', "x.pdf"),
    "APP-2027-000001_application.pdf"
  );
  assert.equal(
    fileNameFromContentDisposition("attachment; filename*=UTF-8''APP-1_pack%20v1.zip", "x.zip"),
    "APP-1_pack v1.zip"
  );
  assert.equal(fileNameFromContentDisposition('attachment; filename="../../etc/passwd"', "x"), "_.._etc_passwd");
  assert.equal(fileNameFromContentDisposition(null, "fallback.pdf"), "fallback.pdf");
  assert.equal(fileNameFromContentDisposition("attachment; filename*=UTF-8''%E0%A4%A", "fb"), "fb");
});

test("download errors are actionable", () => {
  assert.match(downloadErrorMessage(401, null), /Sign in again/);
  assert.match(downloadErrorMessage(403, null), /permission/);
  assert.equal(downloadErrorMessage(403, "Forbidden here"), "Forbidden here");
  assert.match(downloadErrorMessage(404, null), /no longer available/);
  assert.match(downloadErrorMessage(0, null), /connection/);
  assert.match(downloadErrorMessage(500, null), /try again/);
});

test("display helpers", () => {
  assert.equal(documentTypeDisplay("proof_of_payment"), "Proof of payment");
  assert.equal(documentTypeDisplay("birth_certificate"), "Birth certificate");
  assert.equal(documentTypeDisplay(""), "Document");
  assert.equal(formatFileSize(512), "512 B");
  assert.equal(formatFileSize(2048), "2.0 KB");
  assert.equal(formatFileSize(3 * 1024 * 1024), "3.0 MB");
});

test("API sends acknowledgement only when explicitly true and fetches files with auth headers", () => {
  const api = src("staffAdmissionsApi.ts");
  assert.match(api, /options\.acknowledgePaymentPending === true \? \{ acknowledgePaymentPending: true \} : undefined/);
  assert.match(api, /headers: staffAuthHeaders\(\), cache: "no-store"/);
  for (const path of ["application.pdf", "application-combined.pdf", "documents.zip", "application-pack.zip"]) {
    assert.ok(api.includes(`/${path}`), path);
  }
  assert.match(api, /disposition=inline/);
});

test("detail page gates accept behind the modal and never marks payment paid", () => {
  const page = src("AdmissionsDetailPage.tsx");
  assert.match(page, /acceptanceNeedsPaymentAcknowledgement\(detail\)/);
  assert.match(page, /PAYMENT_PENDING_ACKNOWLEDGEMENT_REQUIRED/);
  assert.match(page, /<AcceptPaymentPendingModal/);
  assert.match(page, /<ApplicationDocumentsSection/);
  assert.match(page, /admissions-accepted-proof-rejected/);
  assert.doesNotMatch(page, /verifyPayment|markPaid|PAID"/);
});

test("modal requires explicit confirmation and shows the exact warning", () => {
  const modal = src("AcceptPaymentPendingModal.tsx");
  assert.match(modal, /\{PAYMENT_PENDING_ACCEPTANCE_WARNING\}/);
  assert.match(modal, /disabled=\{busy \|\| !understood\}/);
  assert.match(modal, /type="checkbox"/);
  assert.match(modal, /aria-modal="true"/);
});

test("documents section gates full-application actions and revokes object URLs", () => {
  const section = src("ApplicationDocumentsSection.tsx");
  assert.match(section, /canDownloadFullApplication \?/);
  assert.match(section, /URL\.revokeObjectURL/);
  assert.match(section, /never change the application or payment status/);
  for (const label of [
    "Print application",
    "Print with attachments",
    "Download all documents",
    "Download complete application pack",
    ">View<|\"View\"",
  ]) {
    assert.match(section, new RegExp(label), label);
  }
  assert.doesNotMatch(section, /localStorage|sessionStorage/);
});

test("permissions: full application requires edit or manage", () => {
  const perms = src("admissionsPermissions.ts");
  assert.match(
    perms,
    /canDownloadFullAdmissionApplication[\s\S]*hasPermission\(user, "admissions", "edit"\) \|\| hasPermission\(user, "admissions", "manage"\)/
  );
});

console.log(`\nadmissions.acceptancePrinting.unit: ${passed} passed`);
