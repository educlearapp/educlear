/**
 * OA-03C unit tests — allow-list + submit validation (no DB).
 * Run: npx ts-node --transpile-only src/services/admissions/admissions.oa03c.unit.test.ts
 */
import assert from "assert";

import {
  APPLICANT_DRAFT_ALLOWED_KEYS,
  APPLICANT_DRAFT_FORBIDDEN_KEYS,
} from "./draftApplicationService";
import { validateApplicationForSubmit } from "./submitApplicationService";

function settings(overrides: Record<string, unknown> = {}) {
  return {
    id: "s",
    schoolId: "sch",
    enabled: true,
    publicSlug: "demo",
    applicationsOpenAt: null,
    applicationsCloseAt: null,
    intakeYear: 2027,
    acceptedGrades: ["Grade 1"],
    admissionFeeRequired: false,
    defaultAdmissionFeeAmount: null,
    currency: "ZAR",
    proofOfPaymentRequired: false,
    paymentVerificationRequired: true,
    requirePaymentVerifiedBeforeAccept: true,
    bankName: null,
    accountHolder: null,
    accountNumber: null,
    branchCode: null,
    accountType: null,
    paymentInstructions: null,
    admissionContactEmail: null,
    admissionContactPhone: null,
    requiredDocuments: [],
    applicationQuestions: [{ key: "why", label: "Why", required: true }],
    notificationRecipientUserIds: [],
    privacyNoticeVersion: "v1",
    declarationText: "x",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as any;
}

function main() {
  assert.ok(APPLICANT_DRAFT_ALLOWED_KEYS.has("learner"));
  assert.ok(APPLICANT_DRAFT_ALLOWED_KEYS.has("guardians"));
  assert.ok(APPLICANT_DRAFT_ALLOWED_KEYS.has("answers"));
  assert.ok(APPLICANT_DRAFT_FORBIDDEN_KEYS.has("status"));
  assert.ok(APPLICANT_DRAFT_FORBIDDEN_KEYS.has("applicationNumber"));
  assert.ok(APPLICANT_DRAFT_FORBIDDEN_KEYS.has("schoolId"));
  assert.ok(APPLICANT_DRAFT_FORBIDDEN_KEYS.has("feeAmount"));

  const incomplete = validateApplicationForSubmit({
    app: {
      intakeYear: 2027,
      requestedGrade: null,
      privacyAcceptedAt: null,
      declarationsAcceptedAt: null,
      learnerCandidate: { firstName: "", lastName: "", birthDate: null },
      guardians: [],
      answers: [],
    },
    settings: settings(),
  });
  assert.ok(incomplete.some((e) => e.field === "learner.firstName"));
  assert.ok(incomplete.some((e) => e.field === "requestedGrade"));
  assert.ok(incomplete.some((e) => e.field === "guardians"));
  assert.ok(incomplete.some((e) => e.field === "privacyAccepted"));
  assert.ok(incomplete.some((e) => e.field === "answers.why"));

  const badGrade = validateApplicationForSubmit({
    app: {
      intakeYear: 2027,
      requestedGrade: "Grade 99",
      privacyAcceptedAt: new Date(),
      declarationsAcceptedAt: new Date(),
      learnerCandidate: {
        firstName: "A",
        lastName: "B",
        birthDate: new Date("2018-01-01"),
      },
      guardians: [
        {
          firstName: "P",
          surname: "Q",
          cellNo: "082",
          email: null,
          isPrimary: true,
          isPayingPerson: true,
        },
      ],
      answers: [{ questionKey: "why", valueJson: "because" }],
    },
    settings: settings(),
  });
  assert.ok(badGrade.some((e) => e.field === "requestedGrade"));

  const ok = validateApplicationForSubmit({
    app: {
      intakeYear: 2027,
      requestedGrade: "Grade 1",
      privacyAcceptedAt: new Date(),
      declarationsAcceptedAt: new Date(),
      learnerCandidate: {
        firstName: "A",
        lastName: "B",
        birthDate: new Date("2018-01-01"),
      },
      guardians: [
        {
          firstName: "P",
          surname: "Q",
          cellNo: "082",
          email: null,
          isPrimary: true,
          isPayingPerson: true,
        },
      ],
      answers: [{ questionKey: "why", valueJson: "because" }],
    },
    settings: settings(),
  });
  assert.strictEqual(ok.length, 0);

  console.log("✓ OA-03C admissions unit tests passed");
}

main();
