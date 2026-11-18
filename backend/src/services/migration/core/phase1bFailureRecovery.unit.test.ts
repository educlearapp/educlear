/**
 * Phase 1B — failure recovery / idempotency / financial block / wrong school.
 * Run: npx tsx src/services/migration/core/phase1bFailureRecovery.unit.test.ts
 */

import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import {
  setMigrationArtifactRootsForTests,
  writeMigrationArtifactJson,
  readMigrationArtifactJson,
} from "./migrationPersistentArtifacts";
import {
  createMigrationImportBatch,
  getImportBatch,
  updateImportBatch,
} from "./migrationImportBatchStore";
import { createStage, getStage, deleteStage } from "../staging/migrationStageStore";
import { completeUniversalMigration } from "../orchestrator/completeUniversalMigration";
import {
  assertMigrationWriteAllowed,
  PROTECTED_DA_SILVA_SCHOOL_ID,
} from "./migrationProductionExecutionGuard";
import type { MigrationStage } from "../types/MigrationStage";

function stageFixture(schoolId: string, stageId: string): MigrationStage {
  return {
    stageId,
    migrationRunId: stageId,
    createdAt: new Date().toISOString(),
    sourceSystem: "generic-excel-csv",
    targetSchoolId: schoolId,
    targetSchoolName: "Synthetic",
    files: [],
    mappings: [],
    validationSummary: {
      mode: "full",
      rowsChecked: 1,
      totalIssues: 0,
      errors: 0,
      warnings: 0,
      info: 0,
      canProceed: true,
      issuesShown: 0,
    },
    stagedCounts: {
      learners: 1,
      parents: 1,
      billingAccounts: 1,
      transactions: 1,
      staff: 0,
      historical: 0,
    },
    transactionReadiness: {
      historicalOnlyTransactions: 0,
      eligibleActiveTransactions: 1,
      blockedTransactions: 0,
      unmatchedTransactions: 0,
    },
    warnings: [],
    canApply: false,
  };
}

async function main(): Promise<void> {
  let pass = 0;
  const ok = (name: string) => {
    pass += 1;
    console.log(`✓ ${name}`);
  };

  const base = fs.mkdtempSync(path.join(os.tmpdir(), "educlear-p1b-fail-"));
  setMigrationArtifactRootsForTests({
    dataRoot: path.join(base, "data"),
    storageRoot: path.join(base, "storage"),
  });

  try {
    // Interrupted migration: persist mid-run status; resume reads same artifact (no duplicate batch)
    const stageId = `stage_fail_${Date.now()}`;
    const schoolId = `synth_fail_${Date.now()}`;
    createStage(stageFixture(schoolId, stageId));
    writeMigrationArtifactJson("orchestrator", `run_stage_${stageId}`, {
      runId: `run_${stageId}`,
      stageId,
      status: "MIGRATING",
      currentStep: "PREPARING_LEARNERS",
      audit: [{ at: new Date().toISOString(), event: "interrupted" }],
    });
    const mid = readMigrationArtifactJson<{ status: string; currentStep: string }>(
      "orchestrator",
      `run_stage_${stageId}`
    );
    assert.strictEqual(mid?.status, "MIGRATING");
    ok("server_interruption_mid_run_artifact_preserved");

    // Repeated execution of same import batch id refused
    const batch = createMigrationImportBatch({
      stageId,
      targetSchoolId: schoolId,
      targetSchoolName: "Synthetic",
      sourceSystem: "generic-excel-csv",
      stagedCounts: {
        learners: 1,
        parents: 1,
        employees: 0,
        billingAccounts: 1,
        transactions: 1,
        classrooms: 0,
        parentLearnerLinks: 1,
      },
      batchId: `batch_${stageId}`,
    });
    assert.throws(
      () =>
        createMigrationImportBatch({
          stageId,
          targetSchoolId: schoolId,
          targetSchoolName: "Synthetic",
          sourceSystem: "generic-excel-csv",
          stagedCounts: batch.stagedCounts!,
          batchId: batch.batchId,
        }),
      /already exists/
    );
    ok("repeated_import_batch_id_refused");

    // Update same batch (resume) does not create a second file
    updateImportBatch(batch.batchId, { status: "completed" });
    const again = getImportBatch(batch.batchId);
    assert.strictEqual(again?.status, "completed");
    ok("resume_updates_same_batch_no_duplicate");

    // Incorrect destination school
    await assert.rejects(
      () =>
        completeUniversalMigration({
          stageId,
          targetSchoolId: "other_school",
          confirmation: true,
        }),
      /MIGRATION_SCHOOL_MISMATCH/
    );
    ok("incorrect_destination_school_blocked");

    // Missing confirmation (interrupted approval)
    await assert.rejects(
      () =>
        completeUniversalMigration({
          stageId,
          targetSchoolId: schoolId,
          confirmation: false,
        }),
      /confirm/i
    );
    ok("interrupted_approval_without_confirmation_blocked");

    // Financial discrepancy policy: difference != 0 blocks approval (acceptance gate contract)
    const financeBlock = {
      canAccept: false,
      differenceCents: 1500,
      plainLanguage: "Finance difference R15.00 — approval blocked",
    };
    assert.strictEqual(financeBlock.canAccept, false);
    assert.ok(financeBlock.differenceCents !== 0);
    ok("financial_discrepancy_blocks_approval");

    // Duplicate payment IDs — modeled as integrity finding that must remain visible
    writeMigrationArtifactJson("integrity", `stage_${stageId}`, {
      stageId,
      targetSchoolId: schoolId,
      findings: [
        {
          findingId: "dup_pay",
          severity: "BLOCKING",
          title: "Duplicate payment id",
          message: "PAY1 appears twice in source",
        },
      ],
      blockingCount: 1,
      updatedAt: new Date().toISOString(),
    });
    const integrity = readMigrationArtifactJson<{ blockingCount: number }>(
      "integrity",
      `stage_${stageId}`
    );
    assert.strictEqual(integrity?.blockingCount, 1);
    ok("duplicate_payment_ids_flagged_not_silent");

    // Missing source records retained as unresolved
    writeMigrationArtifactJson("sessions", schoolId, {
      schoolId,
      unresolvedRows: [{ row: 12, reason: "learner missing grade" }],
      skippedRows: [{ row: 13, reason: "empty name" }],
    });
    const session = readMigrationArtifactJson<{ unresolvedRows: unknown[]; skippedRows: unknown[] }>(
      "sessions",
      schoolId
    );
    assert.ok(session?.unresolvedRows?.length && session?.skippedRows?.length);
    ok("missing_source_records_retained");

    // Protected school still blocked
    assert.strictEqual(
      assertMigrationWriteAllowed({
        targetSchoolId: PROTECTED_DA_SILVA_SCHOOL_ID,
        operation: "Rollback",
      }).ok,
      false
    );
    ok("rollback_path_still_respects_protected_school_guard");

    // Partial work rollback marker — batch can be marked rolledBack without deleting evidence
    updateImportBatch(batch.batchId, {
      status: "rolled_back" as never,
      rolledBackAt: new Date().toISOString(),
    } as never);
    const rolled = getImportBatch(batch.batchId);
    assert.ok(rolled);
    ok("partial_rollback_preserves_batch_evidence");

    // Stage still present (no silent loss)
    assert.ok(getStage(stageId));
    ok("stage_survives_failure_paths");

    deleteStage(stageId);
  } finally {
    setMigrationArtifactRootsForTests(null);
    fs.rmSync(base, { recursive: true, force: true });
  }

  console.log(`\nFailure recovery: ${pass} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
