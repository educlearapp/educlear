/**
 * OA-06E — review / submit / status unit + source guards.
 * Run: npx --yes tsx src/publicAdmissions/publicAdmissions.oa06e.unit.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  deriveSubmitReadiness,
  documentReviewSummary,
  isEditableDraftStatus,
  isPostSubmitStatus,
  parseApplicationQuestions,
  parentFacingStatusTitle,
  sectionForValidationField,
} from "./reviewReadiness";
import type {
  ApplicantApplicationView,
  PublicAdmissionsConfig,
} from "./publicAdmissionsTypes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function baseConfig(overrides: Partial<PublicAdmissionsConfig> = {}): PublicAdmissionsConfig {
  return {
    publicSlug: "demo-school",
    schoolDisplayName: "Demo Academy",
    branding: { logoUrl: null, primaryColor: null },
    enabled: true,
    acceptingApplications: true,
    applicationsOpenAt: null,
    applicationsCloseAt: null,
    intakeYear: 2027,
    acceptedGrades: ["Grade 1"],
    admissionFeeRequired: true,
    admissionFeeAmount: "350.00",
    currency: "ZAR",
    proofOfPaymentRequired: true,
    paymentVerificationRequired: false,
    requirePaymentVerifiedBeforeAccept: false,
    admissionContactEmail: null,
    admissionContactPhone: null,
    requiredDocuments: [
      { key: "birth_certificate", label: "Birth certificate", required: true },
    ],
    applicationQuestions: [{ key: "why", label: "Why apply?", required: true }],
    privacyNoticeVersion: "v1",
    declarationText: "I confirm the information is true.",
    ...overrides,
  };
}

function baseApp(overrides: Partial<ApplicantApplicationView> = {}): ApplicantApplicationView {
  return {
    publicAccessId: "acc1",
    status: "DRAFT",
    statusReason: null,
    intakeYear: 2027,
    requestedGrade: "Grade 1",
    applicationNumber: null,
    feeRequired: true,
    feeAmount: null,
    feeCurrency: "ZAR",
    feeSnapshotAt: null,
    declaredExistingSibling: false,
    declaredSiblingLearnerName: null,
    declaredSiblingAdmissionNo: null,
    declaredExistingFamily: false,
    privacyAcceptedAt: null,
    declarationsAcceptedAt: null,
    privacyNoticeVersion: null,
    submittedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    learner: {
      firstName: "Anele",
      lastName: "Dlamini",
      nickname: null,
      birthDate: "2018-01-01",
      gender: "Female",
      idNumber: "x",
      homeLanguage: "isiZulu",
      citizenship: "SA",
      homeAddress: "12 Oak",
      allergies: null,
      medicalAlert: null,
      previousSchoolName: "Sunshine",
      notes: null,
    },
    guardians: [
      {
        id: "g1",
        title: null,
        firstName: "Thandi",
        surname: "Dlamini",
        relationship: "Mother",
        idNumber: null,
        cellNo: "0821",
        email: "t@example.com",
        homeAddress: "12 Oak",
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

// Readiness mirrors backend submit gates (docs are NOT blockers)
const incomplete = deriveSubmitReadiness({
  application: baseApp(),
  config: baseConfig(),
  privacyAccepted: false,
  declarationsAccepted: false,
  answerValues: {},
});
assert.ok(incomplete.issues.some((i) => i.field === "privacyAccepted"), "8. privacy required");
assert.ok(
  incomplete.issues.some((i) => i.field === "declarationsAccepted"),
  "9. declarations required"
);
assert.ok(incomplete.issues.some((i) => i.field === "answers.why"), "11/12. required answer");

const ready = deriveSubmitReadiness({
  application: baseApp({
    privacyAcceptedAt: "2026-01-01T00:00:00.000Z",
    declarationsAcceptedAt: "2026-01-01T00:00:00.000Z",
    answers: [{ questionKey: "why", questionLabelSnapshot: "Why", valueJson: "Because" }],
  }),
  config: baseConfig(),
  privacyAccepted: true,
  declarationsAccepted: true,
  answerValues: { why: "Because" },
});
assert.equal(ready.canAttemptSubmit, true);

const docsSummary = documentReviewSummary({
  config: baseConfig(),
  documents: [],
  listRequiredDocumentTypes: ["birth_certificate"],
});
assert.equal(docsSummary.requiredUploaded, 0);
assert.ok(docsSummary.missingLabels.includes("Birth certificate"), "4. doc completeness");

assert.equal(isEditableDraftStatus("DRAFT"), true);
assert.equal(isPostSubmitStatus("SUBMITTED"), true);
assert.equal(isPostSubmitStatus("DRAFT"), false);
assert.equal(parentFacingStatusTitle("UNDER_REVIEW"), "Application under review");
assert.equal(parentFacingStatusTitle("INFO_REQUESTED"), "Additional information requested");
assert.equal(parentFacingStatusTitle("ACCEPTED"), "Application accepted");
assert.equal(parentFacingStatusTitle("DECLINED"), "Application declined");
assert.equal(sectionForValidationField("learner.firstName"), "details");
assert.equal(sectionForValidationField("privacyAccepted"), "review");

const qs = parseApplicationQuestions(baseConfig().applicationQuestions);
assert.equal(qs[0]?.key, "why");
assert.equal(qs[0]?.required, true);

const reviewSrc = read("publicAdmissions/PublicAdmissionsReviewStep.tsx");
const statusSrc = read("publicAdmissions/PublicAdmissionsStatusView.tsx");
const applySrc = read("publicAdmissions/PublicAdmissionsApplyPage.tsx");
const apiSrc = read("publicAdmissions/publicAdmissionsApi.ts");
const readySrc = read("publicAdmissions/reviewReadiness.ts");

assert.ok(/Anele|learner\?\.firstName|Learner/.test(reviewSrc), "1. learner review");
assert.ok(/guardians|Parents \/ guardians/.test(reviewSrc), "2. guardians");
assert.ok(/Primary|Responsible for fees|isPrimary|isPayingPerson/.test(reviewSrc), "3. primary/payer");
assert.ok(/pa-review-docs-summary|Missing required supporting document/.test(reviewSrc), "4. docs");
assert.ok(/onEditDetails/.test(reviewSrc), "5. edit details");
assert.ok(/onEditDocuments/.test(reviewSrc), "6. edit documents");
assert.ok(!/createPublicDraftApplication/.test(reviewSrc), "7. no draft create on review");

assert.ok(/pa-privacy-accept/.test(reviewSrc), "8. privacy checkbox");
assert.ok(/pa-declarations-accept/.test(reviewSrc), "9. declarations checkbox");
assert.ok(
  /checked=\{privacyAccepted\}/.test(reviewSrc) &&
    /Boolean\(application\.privacyAcceptedAt\)/.test(reviewSrc),
  "10. no hard-coded pre-checked true"
);
assert.ok(
  /configuredDeclarationText/.test(reviewSrc) &&
    /pa-declaration-text/.test(reviewSrc) &&
    /pa-declaration-neutral/.test(reviewSrc),
  "1/3/4. configured declarationText rendered when present; neutral when absent"
);
assert.ok(
  !/true and complete to the best of my knowledge/.test(reviewSrc) &&
    !/indemnit|disciplinary|financial undertaking/i.test(reviewSrc),
  "3. no fabricated school-specific/legal declaration when text absent"
);
assert.ok(
  /I confirm privacy notice acceptance/.test(reviewSrc) &&
    !/I have read and accept/.test(reviewSrc),
  "6. no invented privacy body / no false 'I have read' claim"
);
assert.ok(/applicationQuestions|Application questions/.test(reviewSrc), "11. custom questions");
assert.ok(/required unanswered|Required answer|answers\./.test(readySrc) || /Required/.test(reviewSrc), "12. required answers");

assert.ok(/pa-submit-application/.test(reviewSrc), "13. explicit submit");
assert.ok(/submitPublicApplication/.test(reviewSrc), "14. submit helper");
assert.ok(
  /\/submit`/.test(apiSrc) && /method:\s*"POST"/.test(apiSrc),
  "14. submit endpoint"
);
assert.ok(/X-Admissions-Access-Token/.test(apiSrc), "15. applicant token");
assert.ok(!/\bstaffAuthHeaders\s*\(/.test(apiSrc), "16. no staff auth");
assert.ok(!/schoolId/.test(reviewSrc), "17. no schoolId authority");
assert.ok(/if \(submitting\) return/.test(reviewSrc), "18. in-flight guard");
assert.ok(/onSubmitted/.test(reviewSrc), "19. success leaves draft editing");
assert.ok(/applicationNumber/.test(statusSrc), "20. application number from server");
assert.ok(/writeApplicantSession|clearApplicantSession/.test(applySrc));
assert.ok(
  !/clearApplicantSession\(slug\);\s*[\s\S]{0,40}onSubmitted|onSubmitted[\s\S]{0,80}clearApplicantSession/.test(
    applySrc
  ),
  "21. session retained after submit (no clear on submit)"
);

assert.ok(/VALIDATION_FAILED/.test(reviewSrc), "22. validation failure handled");
assert.ok(/pa-submit-issues/.test(reviewSrc), "23. guidance shown");
assert.ok(
  /setSubmitting\(false\)/.test(reviewSrc) && !/status:\s*"SUBMITTED"/.test(reviewSrc),
  "24. no fake SUBMITTED state"
);

assert.ok(/isPostSubmitStatus/.test(applySrc), "26. post-submit resume branch");
assert.ok(/PublicAdmissionsStatusView/.test(applySrc), "26. status surface");
assert.ok(
  /showPostSubmit/.test(applySrc) && /pa-draft-form/.test(applySrc),
  "27. status replaces editable draft when submitted"
);
assert.ok(!/useEffect[\s\S]*submitPublicApplication/.test(applySrc), "28. no auto submit");
assert.ok(/UNDER_REVIEW/.test(readySrc), "29");
assert.ok(/INFO_REQUESTED/.test(statusSrc), "30. info requested placeholder");
assert.ok(/ACCEPTED/.test(readySrc), "31");
assert.ok(/DECLINED/.test(readySrc), "32");

assert.ok(!/\/payment["'`]|payment-proof/.test(reviewSrc), "33/34. review has no payment/POP");
assert.ok(/PublicAdmissionsPaymentSection/.test(statusSrc), "status hosts payment section (OA-06F)");
assert.ok(!/bankName|accountNumber|branchCode/.test(reviewSrc), "35. review no bank details");
assert.ok(!/FamilyAccount|ledger|invoice/.test(reviewSrc), "36");
assert.ok(!/\/api\/admissions\//.test(reviewSrc), "40");
assert.ok(!/\{accessToken\}/.test(reviewSrc), "37/38 token not JSX text");
assert.ok(!/promotedLearnerId|staffNotes/.test(statusSrc), "41. no internal IDs");

assert.ok(/pa-step-review/.test(applySrc), "review step unlocked");
assert.ok(/Submit Application/.test(reviewSrc));

console.log("✓ OA-06E public admissions review/submit unit tests passed");
