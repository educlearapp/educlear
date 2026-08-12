/**
 * Phase 1L orchestrator unit tests (no DB).
 * npx tsx src/services/migration/orchestrator/phase1l.unit.test.ts
 */

import assert from "assert";
import { createStage } from "../staging/migrationStageStore";
import { saveParentFamilyPlan } from "../parentFamily/parentFamilyPlanStore";
import { saveAcademicPlan } from "../academic/academicPlanStore";
import { computeUniversalMigrationReadiness } from "./computeUniversalMigrationReadiness";
import type { ParentFamilyMigrationPlan } from "../parentFamily/ParentFamilyMigrationTypes";
import type { AcademicMigrationPlan } from "../academic/AcademicMigrationTypes";
import type { MigrationStage } from "../types/MigrationStage";

function baseStage(partial: Partial<MigrationStage> & { stageId: string; targetSchoolId: string }): MigrationStage {
  return {
    migrationRunId: partial.stageId,
    createdAt: new Date().toISOString(),
    sourceSystem: "UNKNOWN",
    targetSchoolName: "Test School",
    files: [],
    mappings: [],
    validationSummary: {
      mode: "full",
      rowsChecked: 10,
      totalIssues: 0,
      errors: 0,
      warnings: 0,
      info: 0,
      canProceed: true,
      issuesShown: 0,
    },
    stagedCounts: {
      learners: 100,
      parents: 50,
      billingAccounts: 0,
      transactions: 0,
      staff: 0,
      historical: 0,
    },
    transactionReadiness: {
      historicalOnlyTransactions: 0,
      eligibleActiveTransactions: 0,
      blockedTransactions: 0,
      unmatchedTransactions: 0,
    },
    warnings: [],
    canApply: false,
    ...partial,
  };
}

function testCleanReadyNoPlans() {
  const stageId = `stage_1l_clean_${Date.now()}`;
  createStage(
    baseStage({
      stageId,
      targetSchoolId: "school_1l_a",
      stagedCounts: {
        learners: 120,
        parents: 0,
        billingAccounts: 0,
        transactions: 0,
        staff: 0,
        historical: 0,
      },
    })
  );
  const r = computeUniversalMigrationReadiness({
    stageId,
    targetSchoolId: "school_1l_a",
  });
  assert.strictEqual(r.overallStatus, "READY_TO_MIGRATE");
  assert.strictEqual(r.readyToComplete, true);
  assert.strictEqual(r.blockingIssueCount, 0);
  assert.strictEqual(r.operatorEffort.manualMappingActionsRequired, 0);
  assert.strictEqual(r.operatorEffort.operatorReviewDecisionsRequired, 0);
  const fin = r.domains.find((d) => d.domainId === "FINANCE");
  assert.strictEqual(fin?.status, "NOT_DETECTED");
  console.log("✓ clean school path — READY_TO_MIGRATE, finance NOT_DETECTED, 0 reviews");
}

function testNeedsAttentionParent() {
  const stageId = `stage_1l_attn_${Date.now()}`;
  createStage(
    baseStage({
      stageId,
      targetSchoolId: "school_1l_b",
    })
  );
  const plan: ParentFamilyMigrationPlan = {
    planId: `pfplan_${Date.now()}`,
    version: "1K.1",
    generatedAt: new Date().toISOString(),
    targetSchoolId: "school_1l_b",
    stageId,
    sourceAnalysisId: null,
    fingerprint: "abc",
    discoveryId: "d1",
    people: [
      {
        proposalId: "pp1",
        displayName: "Maria Mother",
        firstName: "Maria",
        surname: "Mother",
        idNumber: null,
        identityKind: "NONE",
        cellNo: "0820000001",
        email: "a@x.com",
        relationship: "Mother",
        matchState: "REVIEW_REQUIRED",
        severity: "CRITICAL",
        confidence: "LOW",
        reasons: ["AMBIGUOUS"],
        warnings: [],
        evidence: [],
        matchedExistingParentId: null,
        candidateSummaries: [
          { label: "A", cellphone: "082…", email: "a@x.com", linkedLearners: [], parentId: "p1" },
          { label: "B", cellphone: "082…", email: "a@x.com", linkedLearners: [], parentId: "p2" },
        ],
        learnerKeys: ["adm:L1"],
        isShellOrJunk: false,
        operatorMessage: "We found two possible matches for Maria’s mother.",
      },
    ],
    links: [],
    warnings: [],
    reviewItems: [
      {
        proposalId: "pp1",
        kind: "person",
        message: "We found two possible matches for Maria’s mother.",
        severity: "CRITICAL",
      },
    ],
    criticalUnresolvedCount: 1,
    nonCriticalUnresolvedCount: 0,
    metrics: {
      sourceParentRecords: 1,
      automaticallyResolved: 0,
      proposedNew: 0,
      reviewRequired: 1,
      blockingReview: 1,
      ignored: 0,
      manualMappingActionsRequired: 0,
    },
    stale: false,
  };
  saveParentFamilyPlan(plan);
  const r = computeUniversalMigrationReadiness({
    stageId,
    targetSchoolId: "school_1l_b",
  });
  assert.strictEqual(r.overallStatus, "NEEDS_ATTENTION");
  assert.strictEqual(r.readyToComplete, false);
  assert.ok(r.blockingIssueCount >= 1);
  assert.ok(r.attentionItems.some((a) => /Maria/i.test(a.message)));
  console.log("✓ exception path — NEEDS_ATTENTION with combined inbox item");
}

function testAcademicAttention() {
  const stageId = `stage_1l_ac_${Date.now()}`;
  createStage(baseStage({ stageId, targetSchoolId: "school_1l_c" }));
  const plan = {
    planId: `acplan_${Date.now()}`,
    version: "1J.1",
    generatedAt: new Date().toISOString(),
    targetSchoolId: "school_1l_c",
    stageId,
    sourceAnalysisId: null,
    compiledPlanId: null,
    fingerprint: "x",
    discoveryId: "d",
    academicYear: null,
    grades: [],
    classes: [],
    subjects: [
      {
        proposalId: "sub1",
        sourceValue: "English",
        proposedName: "English",
        normalizeKey: "english",
        confidence: "LOW",
        matchState: "REVIEW_REQUIRED",
        learnerCount: 10,
        warnings: ["HL vs FAL unclear"],
        evidence: [],
      },
    ],
    groups: [],
    learnerPlacements: [],
    teacherAssignments: [],
    warnings: [],
    reviewItems: [
      {
        kind: "subject",
        proposalId: "sub1",
        message: 'The source says “English” but we cannot safely determine HL or FAL.',
        severity: "CRITICAL",
      },
    ],
    criticalUnresolvedCount: 1,
    nonCriticalUnresolvedCount: 0,
    stale: false,
  } as AcademicMigrationPlan;
  saveAcademicPlan(plan);
  const r = computeUniversalMigrationReadiness({
    stageId,
    targetSchoolId: "school_1l_c",
  });
  assert.strictEqual(r.overallStatus, "NEEDS_ATTENTION");
  assert.ok(r.attentionItems.some((a) => a.domainId === "ACADEMIC"));
  console.log("✓ academic exception surfaces in Needs Attention");
}

function testSchoolIsolation() {
  const stageId = `stage_1l_iso_${Date.now()}`;
  createStage(baseStage({ stageId, targetSchoolId: "school_a" }));
  const r = computeUniversalMigrationReadiness({
    stageId,
    targetSchoolId: "school_b",
  });
  assert.strictEqual(r.overallStatus, "BLOCKED");
  console.log("✓ school isolation — wrong school blocked");
}

function main() {
  testCleanReadyNoPlans();
  testNeedsAttentionParent();
  testAcademicAttention();
  testSchoolIsolation();
  console.log("\nPhase 1L unit tests passed.");
}

main();
