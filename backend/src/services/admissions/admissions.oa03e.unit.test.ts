/**
 * OA-03E unit tests — payment guidance + bank completeness (no DB).
 * Run: npx ts-node --transpile-only src/services/admissions/admissions.oa03e.unit.test.ts
 */
import assert from "assert";
import { Prisma } from "@prisma/client";

import { buildPublicAdmissionsConfig } from "./publicAdmissionsConfig";
import {
  buildApplicantPaymentGuidance,
  isAdmissionsBankConfigComplete,
} from "./paymentInstructionsService";

function settingsStub(overrides: Record<string, unknown> = {}) {
  return {
    id: "set1",
    schoolId: "school-a",
    enabled: true,
    publicSlug: "demo-school",
    applicationsOpenAt: null,
    applicationsCloseAt: null,
    intakeYear: 2027,
    acceptedGrades: ["Grade 1"],
    admissionFeeRequired: true,
    defaultAdmissionFeeAmount: new Prisma.Decimal("1600.00"),
    currency: "ZAR",
    proofOfPaymentRequired: true,
    paymentVerificationRequired: true,
    requirePaymentVerifiedBeforeAccept: true,
    bankName: "SECRET BANK",
    accountHolder: "SECRET",
    accountNumber: "123456",
    branchCode: "000000",
    accountType: "Cheque",
    paymentInstructions: "secret pay me",
    admissionContactEmail: "admissions@example.com",
    admissionContactPhone: "0100000000",
    requiredDocuments: [],
    applicationQuestions: [],
    notificationRecipientUserIds: [],
    privacyNoticeVersion: "v1",
    declarationText: "I agree",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as any;
}

function main() {
  assert.strictEqual(
    isAdmissionsBankConfigComplete({
      bankName: "A",
      accountHolder: "B",
      accountNumber: "C",
      branchCode: "D",
    }),
    true
  );
  assert.strictEqual(
    isAdmissionsBankConfigComplete({
      bankName: "A",
      accountHolder: "B",
      accountNumber: "C",
      branchCode: "",
    }),
    false
  );
  assert.strictEqual(
    isAdmissionsBankConfigComplete({
      bankName: null,
      accountHolder: "B",
      accountNumber: "C",
      branchCode: "D",
    } as any),
    false
  );

  const awaiting = buildApplicantPaymentGuidance({
    paymentStatus: "AWAITING_PAYMENT",
    feeRequired: true,
    bankConfigurationIncomplete: false,
    proofUploaded: false,
  });
  assert.strictEqual(awaiting.code, "AWAITING_PAYMENT");
  assert.strictEqual(awaiting.shouldPay, true);
  assert.strictEqual(awaiting.canUploadProof, true);

  const pop = buildApplicantPaymentGuidance({
    paymentStatus: "PROOF_UPLOADED",
    feeRequired: true,
    bankConfigurationIncomplete: false,
    proofUploaded: true,
  });
  assert.strictEqual(pop.code, "PROOF_UPLOADED");
  assert.strictEqual(pop.shouldPay, false);
  assert.strictEqual(pop.canUploadProof, true);
  assert.ok(!/pay again/i.test(pop.message) || /unless/i.test(pop.message));

  const verified = buildApplicantPaymentGuidance({
    paymentStatus: "VERIFIED",
    feeRequired: true,
    bankConfigurationIncomplete: false,
    proofUploaded: true,
  });
  assert.strictEqual(verified.code, "VERIFIED");
  assert.strictEqual(verified.shouldPay, false);
  assert.strictEqual(verified.canUploadProof, false);
  assert.ok(/verified/i.test(verified.message));
  assert.ok(/do not need to pay again/i.test(verified.message));

  const rejected = buildApplicantPaymentGuidance({
    paymentStatus: "REJECTED",
    feeRequired: true,
    bankConfigurationIncomplete: false,
    proofUploaded: false,
  });
  assert.strictEqual(rejected.code, "REJECTED");
  assert.strictEqual(rejected.shouldPay, true);
  assert.strictEqual(rejected.canUploadProof, true);
  assert.ok(/not accepted/i.test(rejected.message));

  const notRequired = buildApplicantPaymentGuidance({
    paymentStatus: "NOT_REQUIRED",
    feeRequired: false,
    bankConfigurationIncomplete: false,
    proofUploaded: false,
  });
  assert.strictEqual(notRequired.code, "NOT_REQUIRED");
  assert.strictEqual(notRequired.shouldPay, false);
  assert.strictEqual(notRequired.canUploadProof, false);

  const incomplete = buildApplicantPaymentGuidance({
    paymentStatus: "AWAITING_PAYMENT",
    feeRequired: true,
    bankConfigurationIncomplete: true,
    proofUploaded: false,
  });
  assert.strictEqual(incomplete.code, "BANK_CONFIGURATION_INCOMPLETE");
  assert.strictEqual(incomplete.shouldPay, false);

  const under = buildApplicantPaymentGuidance({
    paymentStatus: "UNDER_VERIFICATION",
    feeRequired: true,
    bankConfigurationIncomplete: false,
    proofUploaded: true,
  });
  assert.strictEqual(under.code, "UNDER_VERIFICATION");
  assert.strictEqual(under.shouldPay, false);

  const waived = buildApplicantPaymentGuidance({
    paymentStatus: "WAIVED",
    feeRequired: true,
    bankConfigurationIncomplete: false,
    proofUploaded: false,
  });
  assert.strictEqual(waived.code, "WAIVED");
  assert.strictEqual(waived.shouldPay, false);

  // Public config must still omit bank fields
  const cfg = buildPublicAdmissionsConfig({
    publicSlug: "demo-school",
    schoolName: "Demo",
    logoUrl: null,
    primaryColor: null,
    settings: settingsStub(),
  });
  assert.ok(!("bankName" in cfg));
  assert.ok(!("accountNumber" in cfg));
  assert.ok(!("accountHolder" in cfg));
  assert.ok(!("branchCode" in cfg));
  assert.ok(!("paymentInstructions" in cfg));
  assert.ok(!("accountType" in cfg));

  console.log("OA-03E unit tests passed");
}

main();
