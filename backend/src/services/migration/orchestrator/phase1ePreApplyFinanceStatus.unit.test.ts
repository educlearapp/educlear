/**
 * Pre-apply finance must be projected — never VERIFIED / "accounts match" before recon.
 * Run: npx tsx src/services/migration/orchestrator/phase1ePreApplyFinanceStatus.unit.test.ts
 */
import assert from "assert";
import { createStage } from "../staging/migrationStageStore";
import { computeUniversalMigrationReadiness } from "./computeUniversalMigrationReadiness";
import type { MigrationStage } from "../types/MigrationStage";

function baseStage(
  partial: Partial<MigrationStage> & { stageId: string; targetSchoolId: string }
): MigrationStage {
  return {
    migrationRunId: partial.stageId,
    createdAt: new Date().toISOString(),
    sourceSystem: "generic-excel-csv",
    targetSchoolName: "Phase1E PreApply",
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
      learners: 4,
      parents: 0,
      billingAccounts: 3,
      transactions: 6,
      staff: 0,
      historical: 0,
    },
    transactionReadiness: {
      historicalOnlyTransactions: 1,
      eligibleActiveTransactions: 5,
      blockedTransactions: 0,
      unmatchedTransactions: 0,
    },
    warnings: [],
    canApply: true,
    cutoverDate: "2026-06-05",
    ...partial,
  };
}

function main(): void {
  const stageId = `stage_1e_pre_${Date.now()}`;
  createStage(
    baseStage({
      stageId,
      targetSchoolId: "school_1e_pre",
    })
  );

  const r = computeUniversalMigrationReadiness({
    stageId,
    targetSchoolId: "school_1e_pre",
  });
  const fin = r.domains.find((d) => d.domainId === "FINANCE");
  const stmt = r.domains.find((d) => d.domainId === "STATEMENTS");
  const fee = r.domains.find((d) => d.domainId === "FEE_CHECK");

  assert.ok(fin?.applicable);
  assert.strictEqual(fin?.status, "READY", "pre-apply must not BLOCKED for missing recon");
  assert.notStrictEqual(fin?.status, "VERIFIED");
  assert.strictEqual(fin?.metrics?.reconciliationPhase, "projected");
  assert.strictEqual(fin?.metrics?.differenceCents, null);
  assert.ok(
    /projected|after import/i.test(String(fin?.plainLanguage || "")),
    `expected projected language, got: ${fin?.plainLanguage}`
  );
  assert.ok(
    !/^School accounts match\.?$/i.test(String(fin?.plainLanguage || "")),
    "must not claim bare match success before import"
  );
  assert.strictEqual(stmt?.status, "READY");
  assert.strictEqual(fee?.status, "READY");
  assert.ok(/projected|after import/i.test(String(stmt?.plainLanguage || "")));
  assert.ok(r.readyToComplete, "projected finance must still allow approve when otherwise ready");
  assert.strictEqual(r.blockingIssueCount, 0);
  assert.ok(
    /after import|projected/i.test(r.plainLanguageOverall),
    `overall should mention post-import verify: ${r.plainLanguageOverall}`
  );

  console.log("✓ pre-apply finance is projected, not verified success");
  console.log("Phase 1E pre-apply finance status: all passed");
}

main();
