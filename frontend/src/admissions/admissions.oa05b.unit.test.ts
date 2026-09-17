/**
 * OA-05B frontend reactivation decision unit tests.
 * Run: npx tsx src/admissions/admissions.oa05b.unit.test.ts
 */
import assert from "node:assert/strict";
import {
  buildReactivationDecisionDto,
  describeReactivationBlocker,
  initialReactivationFamilyDecision,
  validateReactivationUiState,
  type ReactivationUiState,
} from "./reactivationDecision";
import type { ReactivationPreflight } from "./staffAdmissionsTypes";

function basePreflight(overrides: Partial<ReactivationPreflight> = {}): ReactivationPreflight {
  return {
    application: {
      id: "app1",
      applicationNumber: "APP-1",
      status: "ACCEPTED",
      alreadyEnrolled: false,
      promotedLearnerId: null,
      promotedFamilyAccountId: null,
      intakeYear: 2027,
      requestedGrade: "Grade 2",
    },
    historicalLearner: {
      id: "L1",
      firstName: "A",
      lastName: "B",
      admissionNo: "ADM1",
      birthDate: "2017-01-01",
      historicalGrade: "Grade 1",
      historicalClassName: "1A",
      enrollmentStatus: "HISTORICAL",
    },
    match: { strength: "STRONG", matchReason: "idNumber", caution: "EXACT_ID" },
    currentFamily: {
      familyAccountId: "FA1",
      accountRef: "FA1",
      accountNo: "FA1",
      familyName: "Family",
    },
    finance: {
      balanceRand: 0,
      balanceStatus: "ZERO",
      warningCode: null,
      warningMessage: null,
    },
    billingPlan: {
      lineCount: 1,
      summary: ["Legacy: 100"],
      warningCode: "STALE_BILLING_PLAN_REVIEW_REQUIRED",
      warningMessage: "Review plan",
      requiresAcknowledgeExistingBillingPlan: true,
    },
    existingParentLinks: [],
    preserveExistingParentLinksWarning: {
      code: "EXISTING_GUARDIAN_LINKS_PRESERVED",
      message: "Existing guardian links will be preserved.",
    },
    guardians: [
      {
        admissionGuardianId: "g1",
        firstName: "G",
        surname: "One",
        relationship: "Mother",
        hasIdNumber: false,
        hasEmail: true,
        hasCellNo: true,
        isPrimary: true,
        isPayingPerson: true,
        identityDecision: "CREATE_ALLOWED",
        matchStrength: "NONE",
        candidates: [],
        suggestedMode: null,
        suggestedExistingParentId: null,
        alreadyLinkedToLearner: false,
      },
    ],
    family: {
      defaultMode: "KEEP_EXISTING",
      allowedModes: ["KEEP_EXISTING", "USE_EXISTING"],
      createNewSupported: false,
      candidates: [
        {
          familyAccountId: "FA1",
          accountRef: "FA1",
          familyName: "Family",
          reason: "learner_current_family",
          strength: "STRONG",
          isCurrent: true,
        },
      ],
      requiresAcknowledgeHistoricalFamilyChange: true,
    },
    placement: {
      historicalGrade: "Grade 1",
      historicalClassName: "1A",
      requestedGrade: "Grade 2",
      proposedGrade: "Grade 2",
      classNameRequired: false,
      mustConfirmGrade: true,
    },
    identityWarnings: [],
    blockers: [],
    warnings: [],
    canReactivate: true,
    ...overrides,
  };
}

function main() {
  const pf = basePreflight();
  assert.strictEqual(initialReactivationFamilyDecision(pf).mode, "KEEP_EXISTING");

  const incomplete: ReactivationUiState = {
    guardians: { g1: { mode: "" } },
    family: { mode: "KEEP_EXISTING" },
    grade: "Grade 2",
    className: "",
    acknowledgeExistingBillingPlan: false,
  };
  assert.equal(validateReactivationUiState(pf, incomplete).ok, false);

  const withBillingAck: ReactivationUiState = {
    guardians: { g1: { mode: "CREATE_NEW" } },
    family: { mode: "KEEP_EXISTING" },
    grade: "Grade 2",
    className: "2A",
    acknowledgeExistingBillingPlan: true,
  };
  assert.equal(validateReactivationUiState(pf, withBillingAck).ok, true);

  const dto = buildReactivationDecisionDto(pf, withBillingAck);
  assert.strictEqual(dto.learnerId, "L1");
  assert.strictEqual(dto.family.mode, "KEEP_EXISTING");
  assert.strictEqual(dto.placement.grade, "Grade 2");
  assert.strictEqual(dto.acknowledgeExistingBillingPlan, true);

  assert.match(
    describeReactivationBlocker("AMBIGUOUS_HISTORICAL_LEARNER_MATCH"),
    /Multiple possible historical/
  );

  console.log("OA-05B frontend unit tests passed");
}

main();
