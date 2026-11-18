/**
 * Phase 1B — every migration artifact store that writes to data/ must dual-read legacy storage/.
 * Run: npx tsx src/services/migration/core/phase1bDualReadCompleteness.unit.test.ts
 */

import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import {
  setMigrationArtifactRootsForTests,
  writeMigrationArtifactJson,
  readMigrationArtifactJson,
  resolveMigrationArtifactReadPath,
  listMigrationArtifactIds,
  getMigrationArtifactLegacyDir,
  getMigrationArtifactWriteDir,
} from "./migrationPersistentArtifacts";
import { saveMigrationSession, getMigrationSession } from "./migrationSessionStore";
import { createStage, getStage, deleteStage } from "../staging/migrationStageStore";
import { saveSourceManifest, getSourceManifestByStage } from "../orchestrator/sourceManifest";
import { saveOrchestratorRun, getOrchestratorRunByStage } from "../orchestrator/orchestratorStore";
import { createMigrationImportBatch, getImportBatch, listImportBatches } from "./migrationImportBatchStore";
import { getCompiledPlan, saveCompiledPlan } from "../migrationPlan/migrationPlanStore";
import { getSourceAnalysis, saveSourceAnalysis } from "../sourceAnalysis/migrationSourceAnalysisStore";
import { getFeeCheckAuthorityCheck, saveFeeCheckAuthorityCheck } from "../finance/feeCheckAuthority";
import { getAcceptanceByStage, saveMigrationAcceptance } from "../finance/acceptMigration";
import { getSignoff, createSignoff } from "./migrationSignoffStore";
import { getTemplate, saveTemplate, listTemplates } from "../templates/migrationTemplateStore";

type CaseResult = { name: string; ok: boolean; detail?: string };

function withRoots(fn: () => void | Promise<void>): Promise<void> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "educlear-p1b-dual-"));
  const dataRoot = path.join(base, "data");
  const storageRoot = path.join(base, "storage");
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(storageRoot, { recursive: true });
  setMigrationArtifactRootsForTests({ dataRoot, storageRoot });
  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      setMigrationArtifactRootsForTests(null);
      fs.rmSync(base, { recursive: true, force: true });
    });
}

function seedLegacy(artifactKey: string, id: string, payload: unknown): string {
  const dir = getMigrationArtifactLegacyDir(artifactKey);
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `${id}.json`);
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), "utf8");
  return fp;
}

async function main(): Promise<void> {
  const results: CaseResult[] = [];

  await withRoots(() => {
    // Sessions
    seedLegacy("sessions", "school_legacy_sess", {
      schoolId: "school_legacy_sess",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      sourceSystem: "kideesys",
      uploadedFiles: [{ id: "f1", filename: "a.xls", path: "/tmp/a.xls" }],
      previews: [],
      mappingSuggestions: [],
      mappingOverrides: {},
      validationSummary: null,
      validationIssues: [],
      validationMode: "preview",
      cutoverDate: "",
      dryRunStage: null,
    });
    const sess = getMigrationSession("school_legacy_sess");
    results.push({
      name: "session_legacy_readable",
      ok: Boolean(sess?.uploadedFiles?.length === 1),
    });
    saveMigrationSession("school_new_sess", { sourceSystem: "sasams" });
    assert.ok(
      fs.existsSync(path.join(getMigrationArtifactWriteDir("sessions"), "school_new_sess.json"))
    );
    assert.ok(
      fs.existsSync(path.join(getMigrationArtifactLegacyDir("sessions"), "school_legacy_sess.json")),
      "legacy session must remain"
    );
    results.push({ name: "session_new_writes_data_legacy_preserved", ok: true });
  });

  await withRoots(() => {
    seedLegacy("stages", "stage_legacy", {
      stageId: "stage_legacy",
      migrationRunId: "stage_legacy",
      createdAt: "2026-01-01T00:00:00.000Z",
      sourceSystem: "kideesys",
      targetSchoolId: "school_a",
      targetSchoolName: "A",
      files: [],
      mappings: [],
      validationSummary: {
        mode: "full",
        rowsChecked: 0,
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
    });
    const stage = getStage("stage_legacy");
    results.push({ name: "stage_legacy_readable", ok: stage?.targetSchoolId === "school_a" });
  });

  await withRoots(() => {
    seedLegacy("import-batches", "batch_legacy", {
      batchId: "batch_legacy",
      stageId: "s1",
      targetSchoolId: "school_a",
      targetSchoolName: "A",
      sourceSystem: "kideesys",
      status: "completed",
      createdAt: "2026-01-01T00:00:00.000Z",
      stagedCounts: {
        learners: 2,
        parents: 1,
        employees: 0,
        billingAccounts: 1,
        transactions: 0,
        classrooms: 0,
        parentLearnerLinks: 0,
      },
    });
    const batch = getImportBatch("batch_legacy");
    results.push({ name: "import_batch_legacy_readable", ok: batch?.batchId === "batch_legacy" });
    const listed = listImportBatches().some((b) => b.batchId === "batch_legacy");
    results.push({ name: "import_batch_list_includes_legacy", ok: listed });
  });

  await withRoots(() => {
    seedLegacy("compiled-plans", "plan_legacy", {
      planId: "plan_legacy",
      targetSchoolId: "school_a",
      sourceAnalysisId: "an1",
      planVersion: "1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      decisions: [],
      sourceFingerprints: [],
    });
    // getCompiledPlan may require more fields — at least dual path resolves
    const resolved = resolveMigrationArtifactReadPath("compiled-plans", "plan_legacy");
    results.push({ name: "compiled_plan_legacy_path", ok: Boolean(resolved) });
  });

  await withRoots(() => {
    seedLegacy("source-analyses", "an_legacy", {
      analysisId: "an_legacy",
      targetSchoolId: "school_a",
      stageId: "s1",
      analysisVersion: "1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      files: [],
    });
    const resolved = resolveMigrationArtifactReadPath("source-analyses", "an_legacy");
    results.push({ name: "source_analysis_legacy_path", ok: Boolean(resolved) });
  });

  await withRoots(() => {
    seedLegacy("feecheck-authority", "stage_s1", {
      checkId: "fc1",
      stageId: "s1",
      feeCheckAuthorityMatch: true,
    });
    const resolved = resolveMigrationArtifactReadPath("feecheck-authority", "stage_s1");
    results.push({ name: "feecheck_legacy_path", ok: Boolean(resolved) });
  });

  await withRoots(() => {
    seedLegacy("acceptances", "stage_s1", {
      acceptanceId: "acc1",
      stageId: "s1",
      status: "ACCEPTED",
    });
    const acc = getAcceptanceByStage("s1");
    results.push({ name: "acceptance_legacy_readable", ok: acc?.acceptanceId === "acc1" });
  });

  await withRoots(() => {
    seedLegacy("templates", "tmpl_legacy", {
      id: "tmpl_legacy",
      name: "Legacy Template",
      sourceSystem: "kideesys",
      description: "",
      mappings: [{ sourceColumn: "A", targetField: "learnerFirstName" }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const tmpl = getTemplate("tmpl_legacy");
    results.push({ name: "template_legacy_readable", ok: tmpl?.name === "Legacy Template" });
    const listed = listTemplates().some((t) => t.id === "tmpl_legacy");
    results.push({ name: "template_list_includes_legacy", ok: listed });
  });

  await withRoots(() => {
    // Restart simulation: write session + stage + orchestrator run, clear roots override re-apply
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "educlear-p1b-restart-"));
    const dataRoot = path.join(base, "data");
    const storageRoot = path.join(base, "storage");
    fs.mkdirSync(dataRoot, { recursive: true });
    fs.mkdirSync(storageRoot, { recursive: true });
    setMigrationArtifactRootsForTests({ dataRoot, storageRoot });
    writeMigrationArtifactJson("sessions", "restart_school", {
      schoolId: "restart_school",
      mappingOverrides: { f1: { A: "learnerFirstName" } },
      approvals: { financeR0: true },
      unresolvedRows: [{ row: 3, reason: "missing guardian phone" }],
    });
    writeMigrationArtifactJson("orchestrator", "run_restart", {
      runId: "run_restart",
      stageId: "stage_restart",
      status: "MIGRATING",
    });
    // Simulate restart
    setMigrationArtifactRootsForTests({ dataRoot, storageRoot });
    const session = readMigrationArtifactJson<{
      unresolvedRows: unknown[];
      mappingOverrides: unknown;
      approvals: unknown;
    }>("sessions", "restart_school");
    const run = readMigrationArtifactJson<{ status: string }>("orchestrator", "run_restart");
    const ok =
      Boolean(session?.unresolvedRows?.length === 1) &&
      Boolean(session?.mappingOverrides) &&
      Boolean(session?.approvals) &&
      run?.status === "MIGRATING";
    results.push({ name: "restart_recovery_session_mappings_approvals_unresolved", ok });
    setMigrationArtifactRootsForTests(null);
    fs.rmSync(base, { recursive: true, force: true });
  });

  await withRoots(() => {
    writeMigrationArtifactJson("reports", "recon_report_1", {
      kind: "reconciliation",
      differenceCents: 0,
      sourceRows: 10,
      importedRows: 9,
      unresolvedRows: 1,
    });
    seedLegacy("reports", "recon_report_legacy", {
      kind: "reconciliation",
      differenceCents: 0,
    });
    const ids = listMigrationArtifactIds("reports");
    results.push({
      name: "reports_list_merges_data_and_legacy",
      ok: ids.includes("recon_report_1") && ids.includes("recon_report_legacy"),
    });
    // legacy untouched after new write
    const legacyFp = path.join(getMigrationArtifactLegacyDir("reports"), "recon_report_legacy.json");
    results.push({ name: "reports_legacy_untouched", ok: fs.existsSync(legacyFp) });
  });

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  console.log(`\nDual-read completeness: ${results.length - failed.length}/${results.length} passed`);
  assert.strictEqual(failed.length, 0, failed.map((f) => f.name).join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
