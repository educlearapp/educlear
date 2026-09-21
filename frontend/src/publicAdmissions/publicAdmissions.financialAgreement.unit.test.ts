/**
 * Financial agreement review readiness + signature/submit wiring.
 * Run: npx tsx src/publicAdmissions/publicAdmissions.financialAgreement.unit.test.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import type { ApplicantApplicationView, PublicAdmissionsConfig } from "./publicAdmissionsTypes";
import {
  deriveSubmitReadiness,
  financialAgreementMatchesCurrentDocuments,
} from "./reviewReadiness";

function config(financialDocuments?: PublicAdmissionsConfig["financialDocuments"]): PublicAdmissionsConfig {
  return {
    publicSlug: "test-school",
    schoolDisplayName: "Test School",
    branding: { logoUrl: null, primaryColor: null },
    enabled: true,
    acceptingApplications: true,
    applicationsOpenAt: null,
    applicationsCloseAt: null,
    intakeYear: 2027,
    acceptedGrades: ["Grade 1"],
    admissionFeeRequired: false,
    admissionFeeAmount: null,
    currency: "ZAR",
    proofOfPaymentRequired: false,
    paymentVerificationRequired: false,
    requirePaymentVerifiedBeforeAccept: false,
    admissionContactEmail: null,
    admissionContactPhone: null,
    requiredDocuments: [
      { key: "birth_certificate", label: "Birth certificate", required: true },
    ],
    applicationQuestions: [],
    privacyNoticeVersion: "v1",
    declarationText: "I confirm.",
    financialDocuments,
  };
}

function app(overrides: Partial<ApplicantApplicationView> = {}): ApplicantApplicationView {
  return {
    publicAccessId: "acc",
    status: "DRAFT",
    statusReason: null,
    intakeYear: 2027,
    requestedGrade: "Grade 1",
    applicationNumber: null,
    feeRequired: false,
    feeAmount: null,
    feeCurrency: "ZAR",
    feeSnapshotAt: null,
    declaredExistingSibling: false,
    declaredSiblingLearnerName: null,
    declaredSiblingAdmissionNo: null,
    declaredExistingFamily: false,
    privacyAcceptedAt: "2026-01-01T00:00:00.000Z",
    declarationsAcceptedAt: "2026-01-01T00:00:00.000Z",
    privacyNoticeVersion: "v1",
    submittedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    learner: {
      firstName: "Anele",
      lastName: "Dlamini",
      nickname: null,
      birthDate: "2018-01-01",
      gender: null,
      idNumber: null,
      homeLanguage: null,
      citizenship: null,
      homeAddress: null,
      allergies: null,
      medicalAlert: null,
      previousSchoolName: null,
      notes: null,
    },
    guardians: [
      {
        id: "g1",
        title: null,
        firstName: "Mary",
        surname: "Jane",
        relationship: null,
        idNumber: null,
        cellNo: "082",
        email: null,
        homeAddress: null,
        employer: null,
        isPrimary: true,
        isPayingPerson: true,
        sortOrder: 0,
      },
    ],
    answers: [],
    feeRecord: null,
    ...overrides,
  };
}

const documents = [
  {
    id: "p1",
    kind: "FINANCIAL_POLICY" as const,
    title: "Policy",
    version: "2027.1",
    contentSha256: "policy-hash",
    body: "Policy text",
  },
  {
    id: "d1",
    kind: "FINANCIAL_DECLARATION" as const,
    title: "Declaration",
    version: "2027.1",
    contentSha256: "declaration-hash",
    body: "Declaration text",
  },
];

const signedAcceptances = {
  signed: true as const,
  signerFullName: "Mary Jane",
  acceptances: [
    { kind: "FINANCIAL_POLICY" as const, contentSha256: "policy-hash" },
    { kind: "FINANCIAL_DECLARATION" as const, contentSha256: "declaration-hash" },
  ],
};

const withoutDocuments = deriveSubmitReadiness({
  application: app(),
  config: config(),
  privacyAccepted: true,
  declarationsAccepted: true,
  answerValues: {},
});
assert.strictEqual(
  withoutDocuments.issues.some((issue) => issue.field.startsWith("financialAgreement")),
  false
);
assert.strictEqual(withoutDocuments.canAttemptSubmit, true);

const unsigned = deriveSubmitReadiness({
  application: app(),
  config: config(documents),
  privacyAccepted: true,
  declarationsAccepted: true,
  answerValues: {},
});
assert.ok(unsigned.issues.some((issue) => issue.field === "financialAgreement.signature"));
assert.strictEqual(unsigned.canAttemptSubmit, false, "unsigned Financial Agreement disables Submit");
assert.strictEqual(financialAgreementMatchesCurrentDocuments(app(), config(documents)), false);

const stale = app({
  financialAgreement: {
    signed: true,
    signerFullName: "Mary Jane",
    acceptances: [
      { kind: "FINANCIAL_POLICY", contentSha256: "old" },
      { kind: "FINANCIAL_DECLARATION", contentSha256: "declaration-hash" },
    ],
  },
});
assert.strictEqual(financialAgreementMatchesCurrentDocuments(stale, config(documents)), false);

const current = app({ financialAgreement: signedAcceptances });
const signed = deriveSubmitReadiness({
  application: current,
  config: config(documents),
  privacyAccepted: true,
  declarationsAccepted: true,
  answerValues: {},
});
assert.strictEqual(
  signed.canAttemptSubmit,
  true,
  "signed current FA + privacy + declarations + complete application enables Submit"
);

const privacyUnchecked = deriveSubmitReadiness({
  application: app({
    privacyAcceptedAt: null,
    financialAgreement: signedAcceptances,
  }),
  config: config(documents),
  privacyAccepted: false,
  declarationsAccepted: true,
  answerValues: {},
});
assert.ok(privacyUnchecked.issues.some((issue) => issue.field === "privacyAccepted"));
assert.strictEqual(privacyUnchecked.canAttemptSubmit, false, "privacy unchecked disables Submit");

const declarationsUnchecked = deriveSubmitReadiness({
  application: app({
    declarationsAcceptedAt: null,
    financialAgreement: signedAcceptances,
  }),
  config: config(documents),
  privacyAccepted: true,
  declarationsAccepted: false,
  answerValues: {},
});
assert.ok(declarationsUnchecked.issues.some((issue) => issue.field === "declarationsAccepted"));
assert.strictEqual(
  declarationsUnchecked.canAttemptSubmit,
  false,
  "declarations unchecked disables Submit"
);

const missingDocsOnly = deriveSubmitReadiness({
  application: current,
  config: config(documents),
  privacyAccepted: true,
  declarationsAccepted: true,
  answerValues: {},
});
assert.strictEqual(
  missingDocsOnly.canAttemptSubmit,
  true,
  "missing supporting documents alone do not disable Submit"
);
assert.ok(
  Array.isArray(config(documents).requiredDocuments) &&
    (config(documents).requiredDocuments as unknown[]).length > 0,
  "config still lists required supporting documents"
);

const twoPayers = app({
  guardians: [
    {
      id: "g1",
      title: null,
      firstName: "Mary",
      surname: "Jane",
      relationship: null,
      idNumber: null,
      cellNo: "082",
      email: null,
      homeAddress: null,
      employer: null,
      isPrimary: true,
      isPayingPerson: true,
      sortOrder: 0,
    },
    {
      id: "g2",
      title: null,
      firstName: "John",
      surname: "Jane",
      relationship: null,
      idNumber: null,
      cellNo: "083",
      email: null,
      homeAddress: null,
      employer: null,
      isPrimary: false,
      isPayingPerson: true,
      sortOrder: 1,
    },
  ],
});
const multiple = deriveSubmitReadiness({
  application: twoPayers,
  config: config(documents),
  privacyAccepted: true,
  declarationsAccepted: true,
  answerValues: {},
});
assert.ok(multiple.issues.some((issue) => issue.message.includes("Exactly one")));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const review = fs.readFileSync(
  path.join(__dirname, "PublicAdmissionsReviewStep.tsx"),
  "utf8"
);
const agreement = fs.readFileSync(
  path.join(__dirname, "PublicAdmissionsFinancialAgreement.tsx"),
  "utf8"
);

assert.match(review, /PublicAdmissionsFinancialAgreement/);
assert.match(
  review,
  /disabled=\{submitting \|\| !readiness\.canAttemptSubmit\}/,
  "Submit button uses full readiness gate"
);
assert.match(
  review,
  /if \(!readiness\.canAttemptSubmit\) \{\s*return;\s*\}/,
  "handleSubmit returns when readiness fails"
);
assert.doesNotMatch(
  review,
  /if \(!financialAgreementMatchesCurrentDocuments/,
  "FA-only early return removed as redundant"
);

assert.match(agreement, /type="checkbox"/);
assert.match(agreement, /pa-financial-signature/);
assert.match(agreement, /Clear signature/);
assert.match(agreement, /strokeCount < 1/);
assert.match(agreement, /A checkbox is not a signature/);
assert.match(agreement, /policyDocumentId/);
assert.match(agreement, /declarationDocumentId/);
assert.match(
  agreement,
  /}, \[policyDocumentId, declarationDocumentId\]\);/,
  "canvas init depends on stable document ids only"
);
assert.doesNotMatch(
  agreement,
  /}, \[documents\]\);/,
  "canvas init must not depend on fresh documents array reference"
);
assert.doesNotMatch(
  agreement,
  /}, \[strokeCount/,
  "canvas init must not re-run for strokeCount"
);
assert.doesNotMatch(
  agreement,
  /}, \[policyAccepted/,
  "canvas init must not re-run for checkbox state"
);
assert.doesNotMatch(
  agreement,
  /}, \[typedName/,
  "canvas init must not re-run for typed-name state"
);
assert.match(
  agreement,
  /onSigned\(updated\);\s*clearSignature\(\);/,
  "successful signing still intentionally clears the pad"
);
assert.match(
  agreement,
  /function clearSignature\(\)[\s\S]*setStrokeCount\(0\)/,
  "Clear still removes ink path and resets stroke count"
);

const settings = fs.readFileSync(
  path.join(__dirname, "../schoolSettings/components/AdmissionsSettingsTab.tsx"),
  "utf8"
);
assert.match(settings, /Publish new version/);
assert.match(settings, /No financial policy or declaration is published/);
const detail = fs.readFileSync(path.join(__dirname, "../admissions/AdmissionsDetailPage.tsx"), "utf8");
assert.match(detail, /Financial agreement was not required when this application was submitted/);

console.log("financial agreement frontend tests passed");
