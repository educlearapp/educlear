/**
 * Phase 1M unit tests (no DB for most cases).
 * npx tsx src/services/migration/orchestrator/phase1m.unit.test.ts
 */

import assert from "assert";
import fs from "fs";
import path from "path";
import {
  contentFingerprint,
  computeSourceSetFingerprint,
  domainsStaleFromFileDomains,
  SOURCE_CHANGE_STALE_MATRIX,
  type SourceManifestFile,
} from "./sourceManifest";
import {
  withMigrationCompleteLock,
  forceReleaseMigrationCompleteLock,
  peekMigrationCompleteLock,
  getMigrationCompleteLockDir,
} from "./migrationCompleteLock";
import { createStage } from "../staging/migrationStageStore";
import { computeUniversalMigrationReadiness } from "./computeUniversalMigrationReadiness";
import { saveOrchestratorRun } from "./orchestratorStore";
import type { MigrationStage } from "../types/MigrationStage";
import type { OrchestratorRunRecord } from "./OrchestratorTypes";

function baseStage(
  partial: Partial<MigrationStage> & { stageId: string; targetSchoolId: string }
): MigrationStage {
  return {
    migrationRunId: partial.stageId,
    createdAt: new Date().toISOString(),
    sourceSystem: "UNKNOWN",
    targetSchoolName: "Phase1M School",
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

function makeFile(
  partial: Partial<SourceManifestFile> & { filename: string; contentFingerprint: string }
): SourceManifestFile {
  return {
    fileId: partial.fileId || `f_${partial.filename}`,
    filename: partial.filename,
    category: partial.category || "learners",
    contentFingerprint: partial.contentFingerprint,
    headerFingerprint: partial.headerFingerprint || "hdr",
    detectedDomains: partial.detectedDomains || ["CORE"],
    rowCount: partial.rowCount ?? 10,
    size: partial.size ?? 100,
    status: partial.status || "ACTIVE",
    addedAt: partial.addedAt || new Date().toISOString(),
    updatedAt: partial.updatedAt || new Date().toISOString(),
  };
}

function testFingerprintsStable() {
  const a = contentFingerprint({
    filename: "Learners.csv",
    columns: ["Learner ID", "First Name"],
    sampleRows: [{ "Learner ID": "1", "First Name": "Ann" }],
    rowCount: 1,
    size: 40,
  });
  const b = contentFingerprint({
    filename: "learners.csv",
    columns: ["Learner ID", "First Name"],
    sampleRows: [{ "Learner ID": "1", "First Name": "Ann" }],
    rowCount: 1,
    size: 40,
  });
  assert.strictEqual(a, b, "filename case should not change fingerprint");
  const c = contentFingerprint({
    filename: "learners.csv",
    columns: ["Learner ID", "First Name"],
    sampleRows: [{ "Learner ID": "1", "First Name": "Bob" }],
    rowCount: 1,
    size: 40,
  });
  assert.notStrictEqual(a, c, "sample content change must change fingerprint");

  const files1 = [
    makeFile({ filename: "a.csv", contentFingerprint: "aaa" }),
    makeFile({ filename: "b.csv", contentFingerprint: "bbb" }),
  ];
  const files2 = [
    makeFile({ filename: "b.csv", contentFingerprint: "bbb" }),
    makeFile({ filename: "a.csv", contentFingerprint: "aaa" }),
  ];
  assert.strictEqual(
    computeSourceSetFingerprint(files1),
    computeSourceSetFingerprint(files2),
    "source-set fingerprint order-independent"
  );
  const files3 = [
    ...files1,
    makeFile({ filename: "c.csv", contentFingerprint: "ccc", status: "REMOVED" }),
  ];
  assert.strictEqual(
    computeSourceSetFingerprint(files1),
    computeSourceSetFingerprint(files3),
    "REMOVED files excluded from source-set fingerprint"
  );
  console.log("✓ source fingerprints stable / deterministic");
}

function testLockRootOnDataMount() {
  const dir = getMigrationCompleteLockDir();
  assert.ok(
    dir.includes(`${path.sep}data${path.sep}`) || /\/data\//.test(dir) || dir.endsWith(`${path.sep}data${path.sep}migration-orchestrator${path.sep}locks`),
    `lock dir must be under data/ for Render persistent disk, got ${dir}`
  );
  assert.ok(dir.includes("migration-orchestrator"), dir);
  console.log("✓ completion lock root is under data/ (persistent disk)");
}

function testDependencyMatrix() {
  assert.deepStrictEqual(SOURCE_CHANGE_STALE_MATRIX.PARENTS_FAMILIES, ["PARENTS_FAMILIES"]);
  assert.deepStrictEqual(SOURCE_CHANGE_STALE_MATRIX.ACADEMIC, ["ACADEMIC"]);
  assert.deepStrictEqual(SOURCE_CHANGE_STALE_MATRIX.FINANCE, [
    "FINANCE",
    "STATEMENTS",
    "FEE_CHECK",
  ]);
  const parentOnly = domainsStaleFromFileDomains(["PARENTS_FAMILIES"]);
  assert.ok(parentOnly.includes("PARENTS_FAMILIES"));
  assert.ok(!parentOnly.includes("FINANCE"));
  const finance = domainsStaleFromFileDomains(["FINANCE"]);
  assert.ok(finance.includes("STATEMENTS") && finance.includes("FEE_CHECK"));
  assert.ok(!finance.includes("ACADEMIC"));
  const academic = domainsStaleFromFileDomains(["ACADEMIC"]);
  assert.ok(!academic.includes("FINANCE"));
  console.log("✓ SOURCE_CHANGE_STALE_MATRIX dependency rules");
}

async function testDistributedLockConcurrency() {
  const stageId = `lock_1m_${Date.now()}`;
  forceReleaseMigrationCompleteLock(stageId);
  let firstDone = false;
  let secondBlocked = false;
  const p1 = withMigrationCompleteLock({
    stageId,
    schoolId: "school_a",
    fn: async () => {
      await new Promise((r) => setTimeout(r, 200));
      firstDone = true;
      return "ok";
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  try {
    await withMigrationCompleteLock({
      stageId,
      schoolId: "school_a",
      fn: async () => "should-not-run",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/already being completed/i.test(msg)) secondBlocked = true;
  }
  await p1;
  assert.ok(firstDone);
  assert.ok(secondBlocked, "second complete must be blocked while lock held");
  assert.strictEqual(peekMigrationCompleteLock(stageId), null);
  console.log("✓ double-complete lock — one authoritative, other blocked");
}

async function testCrashedLockRecovery() {
  const stageId = `lock_stale_1m_${Date.now()}`;
  forceReleaseMigrationCompleteLock(stageId);
  const { getMigrationCompleteLockDir } = await import("./migrationCompleteLock");
  const lockDir = getMigrationCompleteLockDir();
  fs.mkdirSync(lockDir, { recursive: true });
  const lp = path.join(lockDir, `complete_${stageId}.lock`);
  fs.writeFileSync(lp, JSON.stringify({ pid: 1, stageId, schoolId: "s", acquiredAt: "old" }));
  // Make mtime stale (>120s)
  const past = new Date(Date.now() - 180_000);
  fs.utimesSync(lp, past, past);
  let acquired = false;
  await withMigrationCompleteLock({
    stageId,
    schoolId: "s",
    fn: async () => {
      acquired = true;
      return true;
    },
  });
  assert.ok(acquired, "stale lock must be recoverable");
  console.log("✓ crashed-lock recovery (stale >120s)");
}

async function testDifferentSchoolsDoNotBlock() {
  const a = `lock_a_${Date.now()}`;
  const b = `lock_b_${Date.now()}`;
  forceReleaseMigrationCompleteLock(a);
  forceReleaseMigrationCompleteLock(b);
  let both = 0;
  await Promise.all([
    withMigrationCompleteLock({
      stageId: a,
      schoolId: "school_a",
      fn: async () => {
        both += 1;
        await new Promise((r) => setTimeout(r, 50));
      },
    }),
    withMigrationCompleteLock({
      stageId: b,
      schoolId: "school_b",
      fn: async () => {
        both += 1;
        await new Promise((r) => setTimeout(r, 50));
      },
    }),
  ]);
  assert.strictEqual(both, 2);
  console.log("✓ different schools complete concurrently");
}

function testTerminalSuppliedDataReadiness() {
  const stageId = `stage_1m_term_${Date.now()}`;
  const schoolId = "school_1m_term";
  createStage(baseStage({ stageId, targetSchoolId: schoolId }));
  const run: OrchestratorRunRecord = {
    runId: `run_${stageId}`,
    version: "1M.1",
    targetSchoolId: schoolId,
    stageId,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status: "COMPLETE_SUPPLIED_DATA",
    currentStep: "COMPLETE",
    stepsCompleted: ["PREPARING_LEARNERS"],
    domainsApplied: ["CORE"],
    domainsSkipped: ["FINANCE", "STATEMENTS", "FEE_CHECK"],
    domainsFailed: [],
    replayProtected: true,
    idempotentReplay: false,
    acceptanceId: null,
    terminalKind: "COMPLETE_SUPPLIED_DATA",
    summary: { warnings: ["Finance was not supplied"] },
    audit: [],
  };
  saveOrchestratorRun(run);
  const r = computeUniversalMigrationReadiness({ stageId, targetSchoolId: schoolId });
  assert.strictEqual(r.overallStatus, "COMPLETE_SUPPLIED_DATA");
  assert.strictEqual(r.readyToComplete, false);
  assert.ok(/finance was not supplied/i.test(r.plainLanguageOverall));
  console.log("✓ COMPLETE_SUPPLIED_DATA terminal readiness");
}

async function main() {
  testFingerprintsStable();
  testLockRootOnDataMount();
  testDependencyMatrix();
  await testDistributedLockConcurrency();
  await testCrashedLockRecovery();
  await testDifferentSchoolsDoNotBlock();
  testTerminalSuppliedDataReadiness();
  console.log("\nPhase 1M unit tests PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
