/**
 * OA-06F — public admissions post-submit payment + POP (source/contract unit tests).
 * Run: npx tsx src/publicAdmissions/publicAdmissions.oa06f.unit.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatFeeDisplay,
  isPaymentEligibleApplicationStatus,
  parentFacingPaymentStatusTitle,
  POP_UPLOADABLE_APP_STATUSES,
  shouldEncouragePopUpload,
} from "./paymentStatus";
import type { ApplicantPaymentView } from "./publicAdmissionsTypes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(srcRoot, rel), "utf8");
}

function basePayment(over: Partial<ApplicantPaymentView> = {}): ApplicantPaymentView {
  return {
    applicationNumber: "APP-2027-000001",
    paymentReference: "APP-2027-000001",
    feeRequired: true,
    feeAmount: "1600.00",
    currency: "ZAR",
    paymentStatus: "AWAITING_PAYMENT",
    paymentInstructionsAvailable: true,
    bankConfigurationIncomplete: false,
    bank: {
      bankName: "Test Bank",
      accountHolder: "School Trust",
      accountNumber: "1234567890",
      branchCode: "250655",
      accountType: "Current",
      paymentInstructions: "Use the payment reference exactly.",
    },
    proofOfPayment: { uploaded: false, document: null },
    guidance: {
      code: "AWAITING_PAYMENT",
      message: "Please pay and upload proof.",
      shouldPay: true,
      canUploadProof: true,
    },
    ...over,
  };
}

assert.equal(isPaymentEligibleApplicationStatus("DRAFT"), false, "2. DRAFT not payment-eligible");
assert.equal(isPaymentEligibleApplicationStatus("SUBMITTED"), true, "34. SUBMITTED");
assert.equal(isPaymentEligibleApplicationStatus("UNDER_REVIEW"), true, "35");
assert.equal(isPaymentEligibleApplicationStatus("INFO_REQUESTED"), true, "36");
assert.equal(isPaymentEligibleApplicationStatus("ACCEPTED"), true, "37. ACCEPTED may GET payment");
assert.equal(isPaymentEligibleApplicationStatus("DECLINED"), true, "38");
assert.ok(POP_UPLOADABLE_APP_STATUSES.has("SUBMITTED"));
assert.ok(!POP_UPLOADABLE_APP_STATUSES.has("ACCEPTED"), "ACCEPTED not POP-uploadable");
assert.ok(!POP_UPLOADABLE_APP_STATUSES.has("DECLINED"));

assert.equal(parentFacingPaymentStatusTitle("NOT_REQUIRED"), "No admission fee required", "5/10");
assert.equal(parentFacingPaymentStatusTitle("AWAITING_PAYMENT"), "Admission fee payment required", "10");
assert.equal(parentFacingPaymentStatusTitle("PROOF_UPLOADED"), "Proof of payment received", "11");
assert.equal(parentFacingPaymentStatusTitle("UNDER_VERIFICATION"), "Payment verification in progress", "12");
assert.equal(parentFacingPaymentStatusTitle("VERIFIED"), "Payment verified", "13");
assert.equal(parentFacingPaymentStatusTitle("REJECTED"), "Proof of payment needs attention", "14");
assert.equal(parentFacingPaymentStatusTitle("WAIVED"), "Admission fee waived", "15");
assert.ok(!/Paid/i.test(parentFacingPaymentStatusTitle("PROOF_UPLOADED")), "16. no false Paid");
assert.ok(!/Paid/i.test(parentFacingPaymentStatusTitle("UNDER_VERIFICATION")), "16");

assert.equal(formatFeeDisplay("1600.00", "ZAR"), "ZAR 1600.00", "6. fee from server values");

const awaiting = basePayment();
assert.equal(shouldEncouragePopUpload(awaiting, "SUBMITTED"), true, "17/25 awaiting");
assert.equal(shouldEncouragePopUpload(awaiting, "DRAFT"), false);
assert.equal(shouldEncouragePopUpload(awaiting, "ACCEPTED"), false, "37. no upload when ACCEPTED");
assert.equal(shouldEncouragePopUpload(awaiting, "DECLINED"), false, "38");

const pending = basePayment({
  paymentStatus: "PROOF_UPLOADED",
  guidance: {
    code: "PROOF_UPLOADED",
    message: "Received",
    shouldPay: false,
    canUploadProof: true,
  },
});
assert.equal(shouldEncouragePopUpload(pending, "SUBMITTED"), false, "26. no duplicate encourage");

const under = basePayment({
  paymentStatus: "UNDER_VERIFICATION",
  guidance: {
    code: "UNDER_VERIFICATION",
    message: "Verifying",
    shouldPay: false,
    canUploadProof: true,
  },
});
assert.equal(shouldEncouragePopUpload(under, "UNDER_REVIEW"), false, "26");

const rejected = basePayment({
  paymentStatus: "REJECTED",
  guidance: {
    code: "REJECTED",
    message: "Please upload a new proof.",
    shouldPay: true,
    canUploadProof: true,
  },
});
assert.equal(shouldEncouragePopUpload(rejected, "SUBMITTED"), true, "25. replace when REJECTED");

const verified = basePayment({
  paymentStatus: "VERIFIED",
  guidance: {
    code: "VERIFIED",
    message: "Verified",
    shouldPay: false,
    canUploadProof: false,
  },
});
assert.equal(shouldEncouragePopUpload(verified, "SUBMITTED"), false);

const paySrc = read("publicAdmissions/PublicAdmissionsPaymentSection.tsx");
const statusSrc = read("publicAdmissions/PublicAdmissionsStatusView.tsx");
const applySrc = read("publicAdmissions/PublicAdmissionsApplyPage.tsx");
const apiSrc = read("publicAdmissions/publicAdmissionsApi.ts");
const reviewSrc = read("publicAdmissions/PublicAdmissionsReviewStep.tsx");
const docsSrc = read("publicAdmissions/PublicAdmissionsDocumentsStep.tsx");

assert.ok(/fetchPublicApplicantPayment/.test(apiSrc), "1. payment GET helper");
assert.ok(/\/payment`/.test(apiSrc) || /\/payment"/.test(apiSrc) || /\$\{[^}]+\}`\/payment/.test(apiSrc) || /\/payment/.test(apiSrc));
assert.ok(/applicationsBase\(slug, accessId\)\}\/payment/.test(apiSrc), "1. GET .../payment");
assert.ok(/uploadPublicPaymentProof/.test(apiSrc), "18. POP helper");
assert.ok(/payment-proof/.test(apiSrc), "18. POST payment-proof");
assert.ok(/form\.append\("file"/.test(apiSrc), "18. multipart file field");
assert.ok(/X-Admissions-Access-Token/.test(apiSrc), "3/19. applicant token");
assert.ok(!/\bstaffAuthHeaders\s*\(/.test(apiSrc), "4/32. no staff auth");
assert.ok(!/schoolId/.test(paySrc), "no client schoolId authority");

assert.ok(/isPaymentEligibleApplicationStatus/.test(paySrc), "1. eligibility gate");
assert.ok(/fetchPublicApplicantPayment/.test(paySrc));
assert.ok(!/fetchPublicApplicantPayment/.test(reviewSrc), "2. review does not load payment");
assert.ok(!/fetchPublicApplicantPayment/.test(docsSrc), "2. docs step does not load payment");
assert.ok(!/uploadPublicPaymentProof/.test(reviewSrc));

assert.ok(/pa-fee-not-required|NOT_REQUIRED/.test(paySrc), "5");
assert.ok(/feeAmount|formatFeeDisplay/.test(paySrc), "6");
assert.ok(/payment\.bank|pa-bank-details/.test(paySrc), "7");
assert.ok(!/FNB|Standard Bank|Absa|Nedbank/.test(paySrc), "8. no hardcoded banks");
assert.ok(/paymentReference/.test(paySrc), "9");
assert.ok(!/Paid/.test(parentFacingPaymentStatusTitle("PROOF_UPLOADED")));
assert.ok(/pa-pop-upload|Choose proof|Choose replacement/.test(paySrc), "17");
assert.ok(/validateAdmissionsFileClient/.test(paySrc), "20/21/22 client file rules");
assert.ok(/ADMISSIONS_MAX_UPLOAD_BYTES|8/.test(paySrc), "22");
assert.ok(/loadPayment\(/.test(paySrc) && /uploadPublicPaymentProof/.test(paySrc), "23 refresh after success");
assert.ok(/PROOF_UPLOADED|paymentStatus/.test(paySrc));
assert.ok(!/setPayment\(\s*\{[\s\S]*paymentStatus:\s*"PROOF_UPLOADED"/.test(paySrc), "24 no fake status");
assert.ok(/REJECTED/.test(paySrc) && /replacement|new proof/i.test(paySrc), "25");
assert.ok(/pa-payment-waiting|verifies your proof/.test(paySrc), "26 waiting");
assert.ok(/pa-proof-meta|originalFileName/.test(paySrc), "proof metadata");
assert.ok(/downloadPublicApplicantDocumentBlob/.test(paySrc), "download via authenticated blob");
assert.ok(!/storageKey|absolutePath|\/uploads\//.test(paySrc), "29/30 no storage path");
assert.ok(!/\{accessToken\}/.test(paySrc), "27/28 token not in JSX");
assert.ok(!/searchParams|URLSearchParams|accessToken=/.test(paySrc), "27");
assert.ok(!/\/api\/admissions\//.test(paySrc), "32");
assert.ok(!/FamilyAccount|ledger|invoice|billing-plan/.test(paySrc), "33");
assert.ok(/PublicAdmissionsPaymentSection/.test(statusSrc), "status integration");
assert.ok(/publicSlug|publicAccessId|accessToken/.test(statusSrc));
assert.ok(!/createPublicDraftApplication/.test(paySrc));
assert.ok(/applicantSession|publicSlug/.test(applySrc));

console.log("✓ OA-06F public admissions payment/POP unit tests passed");
