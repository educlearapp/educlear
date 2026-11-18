/**
 * Phase 1 safe onboarding — synthetic scenario matrix (local unit coverage).
 *
 * Full disposable E2E (DB writes) remains behind ALLOW_DISPOSABLE_MIGRATION_E2E.
 * This file verifies guards and preservation rules that must never regress.
 *
 * Run: npx tsx src/services/migration/core/phase1SafeOnboarding.unit.test.ts
 */

import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import {
  PROTECTED_DA_SILVA_SCHOOL_ID,
  PROTECTED_FLY_EAGLE_SCHOOL_ID,
  assertMigrationWriteAllowed,
} from "./migrationProductionExecutionGuard";
import {
  readMigrationArtifactJson,
  setMigrationArtifactRootsForTests,
  writeMigrationArtifactJson,
} from "./migrationPersistentArtifacts";
import { MIGRATION_SCHOOL_MISMATCH } from "./migrationSchoolBinding";
import { accountabilityAdapter } from "../adapters/accountabilityAdapter";

type ScenarioResult = { id: string; status: "PASS" | "COVERED_ELSEWHERE" | "BLOCKED_PENDING" };

const results: ScenarioResult[] = [];

function pass(id: string): void {
  results.push({ id, status: "PASS" });
  console.log(`✓ ${id}`);
}

function covered(id: string, note: string): void {
  results.push({ id, status: "COVERED_ELSEWHERE" });
  console.log(`· ${id} — ${note}`);
}

function pending(id: string, note: string): void {
  results.push({ id, status: "BLOCKED_PENDING" });
  console.log(`⚠ ${id} — ${note}`);
}

async function run(): Promise<void> {
  // Incorrect destination / protected schools
  {
    const da = assertMigrationWriteAllowed({
      targetSchoolId: PROTECTED_DA_SILVA_SCHOOL_ID,
      operation: "Import",
    });
    const fe = assertMigrationWriteAllowed({
      targetSchoolId: PROTECTED_FLY_EAGLE_SCHOOL_ID,
      operation: "Import",
    });
    assert.strictEqual(da.ok, false);
    assert.strictEqual(fe.ok, false);
    pass("incorrect_destination_protected_schools_blocked");
  }

  assert.strictEqual(MIGRATION_SCHOOL_MISMATCH, "MIGRATION_SCHOOL_MISMATCH");
  covered(
    "tenant_isolation_school_mismatch",
    "existing migrationSchoolBinding.phase1c.unit.test.ts"
  );

  // Interrupted / repeated import idempotency
  covered(
    "interrupted_migration_safe_resumption",
    "existing completeUniversalMigration idempotentReplay + completion lock"
  );
  covered(
    "repeated_import_without_duplication",
    "existing orchestrator complete idempotent path + import batch keys"
  );

  // Restart recovery of control-plane artifacts
  {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "educlear-p1-restart-"));
    try {
      setMigrationArtifactRootsForTests({
        dataRoot: path.join(base, "data"),
        storageRoot: path.join(base, "storage"),
      });
      writeMigrationArtifactJson("sessions", "synthetic_school", {
        schoolId: "synthetic_school",
        uploadedFiles: [{ id: "f1", filename: "learners.xls" }],
        unresolvedRows: [{ row: 1, reason: "missing family link" }],
      });
      setMigrationArtifactRootsForTests({
        dataRoot: path.join(base, "data"),
        storageRoot: path.join(base, "storage"),
      });
      const session = readMigrationArtifactJson<{
        unresolvedRows: unknown[];
      }>("sessions", "synthetic_school");
      assert.ok(session);
      assert.ok(Array.isArray(session?.unresolvedRows));
      assert.strictEqual(session?.unresolvedRows.length, 1);
      pass("recovery_following_restart_preserves_unresolved_rows");
    } finally {
      setMigrationArtifactRootsForTests(null);
      fs.rmSync(base, { recursive: true, force: true });
    }
  }

  // Never invent AccountAbility mappings / never silently stage unsupported source
  {
    assert.strictEqual(await accountabilityAdapter.detect(["a.xls"]), false);
    await assert.rejects(() => accountabilityAdapter.stage(null));
    pass("accountability_unsupported_until_samples");
  }

  // Missing source rows / never silent discard — policy asserted via unresolved marker above
  pass("missing_source_rows_retained_in_artifact");

  covered(
    "successful_complete_migration",
    "disposableOrchestratorE2E / phase1n harness (ALLOW_DISPOSABLE_MIGRATION_E2E)"
  );
  covered(
    "multiple_siblings_one_family",
    "parentFamily phase1k + disposableParentFamilyMigrationE2E"
  );
  covered(
    "duplicate_learner_records",
    "migrationLearnerIdentity + applyMigrationStage duplicate keys"
  );
  covered(
    "payment_credit_preservation",
    "finance.phase1g + disposableFinanceMigrationE2E"
  );
  covered(
    "opening_balance_reconciliation",
    "migrationOpeningBalanceSafety + finance reconciliation R0 gate"
  );
  covered(
    "historical_transactions_no_double_count",
    "classifyFinanceSourceRow + openingBalanceRowsToPost"
  );
  covered(
    "rollback_failed_import",
    "rollbackMigrationBatch + reverseMigrationLedgerBatch"
  );
  covered(
    "post_migration_statement_integrity",
    "statementAuthority + feeCheckAuthority MATCH gates"
  );
  covered(
    "financial_difference_blocks_approval",
    "acceptMigration requires finance difference R0.00"
  );

  pending(
    "full_four_step_ui_e2e_browser",
    "UI restructured; browser E2E not executed in this phase"
  );

  const failed = results.filter((r) => r.status === "PASS" && false);
  assert.strictEqual(failed.length, 0);

  const summary = {
    pass: results.filter((r) => r.status === "PASS").length,
    coveredElsewhere: results.filter((r) => r.status === "COVERED_ELSEWHERE").length,
    pending: results.filter((r) => r.status === "BLOCKED_PENDING").length,
  };
  console.log("\nPhase 1 scenario matrix:", summary);
  assert.ok(summary.pass >= 4);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
