/**
 * Phase 1C — Migration Center immutable school-binding security tests.
 * LOCAL only — no production, no deploy. Uses in-memory fixtures + disk stage/batch stores
 * under the local process cwd (cleaned up after).
 *
 * Run:
 *   npx ts-node --transpile-only src/services/migration/core/migrationSchoolBinding.phase1c.unit.test.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  assertRequestedSchoolMatchesBatch,
  assertStagePathsBelongToSchoolSession,
  getStageBoundSchoolId,
  MigrationSchoolBindingError,
  MIGRATION_SCHOOL_MISMATCH,
  MIGRATION_STAGE_UNBOUND,
  MIGRATION_UPLOAD_SCHOOL_MISMATCH,
  resolveBoundTargetSchoolId,
} from "./migrationSchoolBinding";
import { buildMigrationStage } from "../staging/buildMigrationStage";
import {
  createStage,
  deleteStage,
  getStage,
  listStages,
} from "../staging/migrationStageStore";
import {
  createMigrationImportBatch,
  getImportBatch,
  updateImportBatch,
} from "./migrationImportBatchStore";
import { rollbackMigrationBatch, MigrationRollbackError } from "./rollbackMigrationBatch";
import {
  reconcileMigrationBatch,
  MigrationReconciliationError,
} from "./reconcileMigrationBatch";
import type { MigrationStage } from "../types/MigrationStage";
import type { PersistentMigrationSession } from "./migrationSessionStore";
import { applyMigrationStage, MigrationApplyError } from "./applyMigrationStage";

const SCHOOL_A = "schoolA_phase1c_test";
const SCHOOL_B = "schoolB_phase1c_test";
const SCHOOL_A_NAME = "Fly Eagle School";
const SCHOOL_B_NAME = "Other Academy";

function baseValidationSummary() {
  return {
    mode: "full" as const,
    rowsChecked: 1,
    totalIssues: 0,
    errors: 0,
    warnings: 0,
    info: 0,
    canProceed: true,
    issuesShown: 0,
  };
}

function makeBoundStage(overrides?: Partial<MigrationStage>): MigrationStage {
  const stageId = overrides?.stageId || `stage_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  return {
    stageId,
    migrationRunId: overrides?.migrationRunId || stageId,
    createdAt: overrides?.createdAt || new Date().toISOString(),
    sourceSystem: overrides?.sourceSystem || "generic-excel-csv",
    targetSchoolId: overrides?.targetSchoolId ?? SCHOOL_A,
    targetSchoolName: overrides?.targetSchoolName ?? SCHOOL_A_NAME,
    files: overrides?.files || [
      {
        fileId: "f1",
        filename: "learners.csv",
        category: "learners",
        rowCount: 1,
        path: "/tmp/educlear-phase1c-learners.csv",
      },
    ],
    mappings: overrides?.mappings || [
      {
        fileId: "f1",
        mappings: [{ sourceColumn: "Name", targetField: "firstName" }],
      },
    ],
    validationSummary: overrides?.validationSummary || baseValidationSummary(),
    stagedCounts: overrides?.stagedCounts || {
      learners: 1,
      parents: 0,
      billingAccounts: 0,
      transactions: 0,
      staff: 0,
      historical: 0,
    },
    transactionReadiness: overrides?.transactionReadiness || {
      historicalOnlyTransactions: 0,
      eligibleActiveTransactions: 0,
      blockedTransactions: 0,
      unmatchedTransactions: 0,
    },
    warnings: overrides?.warnings || [],
    canApply: overrides?.canApply ?? true,
  };
}

function makeSession(schoolId: string, filePath: string, fileId = "f1"): PersistentMigrationSession {
  const now = new Date().toISOString();
  return {
    schoolId,
    createdAt: now,
    updatedAt: now,
    sourceSystem: "generic-excel-csv",
    uploadedFiles: [
      {
        id: fileId,
        filename: "learners.csv",
        mimeType: "text/csv",
        size: 10,
        uploadedAt: new Date(),
        category: "learners",
        path: filePath,
      },
    ],
    previews: [
      {
        fileId,
        filename: "learners.csv",
        category: "learners",
        columns: ["Name"],
        sampleRows: [],
        rowCount: 1,
        warnings: [],
        path: filePath,
      },
    ],
    mappingSuggestions: [],
    mappingOverrides: {},
    validationSummary: baseValidationSummary(),
    validationIssues: [],
    validationMode: "full",
    cutoverDate: "",
    dryRunStage: null,
  };
}

async function run() {
  console.log("Phase 1C school-binding tests…");

  // --- Binding helpers ---
  {
    const stage = makeBoundStage();
    assert.strictEqual(getStageBoundSchoolId(stage), SCHOOL_A);
    assert.strictEqual(resolveBoundTargetSchoolId({ stage }), SCHOOL_A);
    assert.strictEqual(
      resolveBoundTargetSchoolId({ stage, requestedTargetSchoolId: SCHOOL_A }),
      SCHOOL_A
    );
  }

  // Test A — apply/preflight school mismatch rejected before writes
  {
    const stage = makeBoundStage();
    let threw = false;
    try {
      resolveBoundTargetSchoolId({ stage, requestedTargetSchoolId: SCHOOL_B });
    } catch (e) {
      threw = true;
      assert.ok(e instanceof MigrationSchoolBindingError);
      assert.strictEqual(e.code, MIGRATION_SCHOOL_MISMATCH);
      assert.ok(String(e.message).includes("MIGRATION_SCHOOL_MISMATCH"));
    }
    assert.ok(threw, "Test A: mismatch must throw");

    // Persist stage and call apply with School B — must fail before DB writes
    createStage(stage);
    try {
      await applyMigrationStage({
        stageId: stage.stageId,
        targetSchoolId: SCHOOL_B,
        confirmationText: SCHOOL_B_NAME,
        mode: "FULL_MIGRATION_PREFLIGHT",
      });
      assert.fail("Test A: apply/preflight with School B must not succeed");
    } catch (e) {
      assert.ok(e instanceof MigrationApplyError);
      assert.ok(String(e.message).includes("MIGRATION_SCHOOL_MISMATCH"));
    } finally {
      deleteStage(stage.stageId);
    }
    console.log("  ✓ Test A — apply/preflight mismatch rejected");
  }

  // Test B — School A upload cannot stage as School B
  {
    const pathA = `/tmp/educlear-phase1c-${randomUUID()}.csv`;
    const sessionA = makeSession(SCHOOL_A, pathA);
    let threw = false;
    try {
      assertStagePathsBelongToSchoolSession({
        targetSchoolId: SCHOOL_B,
        session: null, // School B has no session
        previews: [{ fileId: "f1", path: pathA }],
      });
    } catch (e) {
      threw = true;
      assert.ok(e instanceof MigrationSchoolBindingError);
      assert.strictEqual(e.code, MIGRATION_UPLOAD_SCHOOL_MISMATCH);
    }
    assert.ok(threw, "Test B: staging School A path onto School B must reject");

    // Even if attacker fabricates a School B session without that path:
    threw = false;
    try {
      assertStagePathsBelongToSchoolSession({
        targetSchoolId: SCHOOL_B,
        session: makeSession(SCHOOL_B, `/tmp/other-${randomUUID()}.csv`, "other"),
        previews: [{ fileId: "f1", path: pathA }],
      });
    } catch (e) {
      threw = true;
      assert.ok(e instanceof MigrationSchoolBindingError);
      assert.strictEqual(e.code, MIGRATION_UPLOAD_SCHOOL_MISMATCH);
    }
    assert.ok(threw, "Test B: path not in School B session must reject");

    // Happy: School A session accepts School A path
    assertStagePathsBelongToSchoolSession({
      targetSchoolId: SCHOOL_A,
      session: sessionA,
      previews: [{ fileId: "f1", path: pathA }],
    });
    console.log("  ✓ Test B — upload/session cannot create wrong-school stage");
  }

  // Test C — preflight uses same binding as apply (covered by resolveBoundTargetSchoolId)
  {
    const stage = makeBoundStage();
    createStage(stage);
    try {
      await applyMigrationStage({
        stageId: stage.stageId,
        targetSchoolId: SCHOOL_B,
        confirmationText: SCHOOL_A_NAME,
        fullMigrationPreflight: true,
      });
      assert.fail("Test C: preflight mismatch must fail");
    } catch (e) {
      assert.ok(e instanceof MigrationApplyError);
      assert.ok(String(e.message).includes("MIGRATION_SCHOOL_MISMATCH"));
    } finally {
      deleteStage(stage.stageId);
    }
    console.log("  ✓ Test C — preflight mismatch rejected");
  }

  // Test D — reconciliation against another school rejected
  {
    const stage = makeBoundStage();
    createStage(stage);
    const batch = createMigrationImportBatch({
      stageId: stage.stageId,
      targetSchoolId: SCHOOL_A,
      targetSchoolName: SCHOOL_A_NAME,
      sourceSystem: "generic-excel-csv",
      status: "completed",
      stagedCounts: stage.stagedCounts,
    });
    try {
      await reconcileMigrationBatch({
        batchId: batch.batchId,
        targetSchoolId: SCHOOL_B,
      });
      assert.fail("Test D: reconcile mismatch must fail");
    } catch (e) {
      assert.ok(e instanceof MigrationReconciliationError);
      assert.ok(String(e.message).includes("MIGRATION_SCHOOL_MISMATCH"));
    } finally {
      const batchPath = path.join(
        process.cwd(),
        "storage",
        "migration-import-batches",
        `${batch.batchId}.json`
      );
      if (fs.existsSync(batchPath)) fs.unlinkSync(batchPath);
      deleteStage(stage.stageId);
    }
    console.log("  ✓ Test D — reconciliation mismatch rejected");
  }

  // Test E — rollback with another school ID rejected, zero writes
  {
    const stage = makeBoundStage();
    createStage(stage);
    const batch = createMigrationImportBatch({
      stageId: stage.stageId,
      targetSchoolId: SCHOOL_A,
      targetSchoolName: SCHOOL_A_NAME,
      sourceSystem: "generic-excel-csv",
      status: "completed",
      stagedCounts: stage.stagedCounts,
      reportRows: [],
    });
    try {
      await rollbackMigrationBatch({
        batchId: batch.batchId,
        targetSchoolId: SCHOOL_B,
        confirmationText: SCHOOL_B_NAME,
      });
      assert.fail("Test E: rollback mismatch must fail");
    } catch (e) {
      assert.ok(e instanceof MigrationRollbackError);
      assert.ok(String(e.message).includes("MIGRATION_SCHOOL_MISMATCH"));
    } finally {
      const batchPath = path.join(
        process.cwd(),
        "storage",
        "migration-import-batches",
        `${batch.batchId}.json`
      );
      if (fs.existsSync(batchPath)) fs.unlinkSync(batchPath);
      deleteStage(stage.stageId);
    }

    assertRequestedSchoolMatchesBatch({
      batchTargetSchoolId: SCHOOL_A,
      requestedTargetSchoolId: SCHOOL_A,
      action: "rollback",
    });
    let threw = false;
    try {
      assertRequestedSchoolMatchesBatch({
        batchTargetSchoolId: SCHOOL_A,
        requestedTargetSchoolId: SCHOOL_B,
        action: "rollback",
      });
    } catch (e) {
      threw = true;
      assert.ok(e instanceof MigrationSchoolBindingError);
      assert.strictEqual(e.code, MIGRATION_SCHOOL_MISMATCH);
    }
    assert.ok(threw);
    console.log("  ✓ Test E — rollback mismatch rejected");
  }

  // Happy path — stage stamps immutable school; list filter; unbound rejected
  {
    const built = buildMigrationStage({
      sourceSystem: "generic-excel-csv",
      targetSchoolId: SCHOOL_A,
      targetSchoolName: SCHOOL_A_NAME,
      previews: [
        {
          fileId: "f1",
          filename: "learners.csv",
          category: "learners",
          columns: ["Name"],
          sampleRows: [{ Name: "Ada" }],
          rowCount: 1,
          warnings: [],
          path: "/tmp/happy-learners.csv",
        },
      ],
      mappings: [
        {
          fileId: "f1",
          mappings: [{ sourceColumn: "Name", targetField: "firstName" }],
        },
      ],
      validationSummary: baseValidationSummary(),
    });
    assert.strictEqual(built.targetSchoolId, SCHOOL_A);
    assert.strictEqual(built.targetSchoolName, SCHOOL_A_NAME);
    assert.strictEqual(built.migrationRunId, built.stageId);

    createStage(built);
    const listedA = listStages({ targetSchoolId: SCHOOL_A });
    assert.ok(listedA.some((s) => s.stageId === built.stageId));
    const listedB = listStages({ targetSchoolId: SCHOOL_B });
    assert.ok(!listedB.some((s) => s.stageId === built.stageId));

    const loaded = getStage(built.stageId);
    assert.ok(loaded);
    assert.strictEqual(loaded!.targetSchoolId, SCHOOL_A);

    // Unbound stage rejected
    let threw = false;
    try {
      resolveBoundTargetSchoolId({
        stage: { ...built, targetSchoolId: "" },
      });
    } catch (e) {
      threw = true;
      assert.ok(e instanceof MigrationSchoolBindingError);
      assert.strictEqual(e.code, MIGRATION_STAGE_UNBOUND);
    }
    assert.ok(threw);

    // buildMigrationStage requires school
    threw = false;
    try {
      buildMigrationStage({
        sourceSystem: "generic-excel-csv",
        targetSchoolId: "",
        targetSchoolName: "",
        previews: [
          {
            fileId: "f1",
            filename: "learners.csv",
            category: "learners",
            columns: ["Name"],
            sampleRows: [],
            rowCount: 0,
            warnings: [],
          },
        ],
        mappings: [{ fileId: "f1", mappings: [] }],
        validationSummary: baseValidationSummary(),
      });
    } catch {
      threw = true;
    }
    assert.ok(threw, "Happy: build without school must fail");

    deleteStage(built.stageId);
    console.log("  ✓ Happy path — stage bound to School A end-to-end (create/list/load)");
  }

  // Concurrency isolation — two school stages coexist without shared school id
  {
    const stageA = makeBoundStage({
      stageId: `stageA_${randomUUID().replace(/-/g, "").slice(0, 8)}`,
      targetSchoolId: SCHOOL_A,
      targetSchoolName: SCHOOL_A_NAME,
    });
    const stageB = makeBoundStage({
      stageId: `stageB_${randomUUID().replace(/-/g, "").slice(0, 8)}`,
      targetSchoolId: SCHOOL_B,
      targetSchoolName: SCHOOL_B_NAME,
    });
    createStage(stageA);
    createStage(stageB);
    assert.strictEqual(getStage(stageA.stageId)?.targetSchoolId, SCHOOL_A);
    assert.strictEqual(getStage(stageB.stageId)?.targetSchoolId, SCHOOL_B);
    assert.notStrictEqual(stageA.stageId, stageB.stageId);
    deleteStage(stageA.stageId);
    deleteStage(stageB.stageId);
    console.log("  ✓ Concurrency — distinct school stages isolated by id + binding");
  }

  // School missing after stage: apply reports clear error (not silent redirect)
  {
    const stage = makeBoundStage({
      targetSchoolId: "school_does_not_exist_phase1c",
      targetSchoolName: "Gone School",
    });
    createStage(stage);
    try {
      await applyMigrationStage({
        stageId: stage.stageId,
        confirmationText: "Gone School",
        mode: "FULL_MIGRATION_PREFLIGHT",
      });
      assert.fail("missing school must fail");
    } catch (e) {
      assert.ok(e instanceof MigrationApplyError);
      assert.ok(
        String(e.message).includes("not found") ||
          String(e.message).includes("Target school"),
        e instanceof Error ? e.message : String(e)
      );
      assert.ok(!String(e.message).includes(SCHOOL_B));
    } finally {
      deleteStage(stage.stageId);
    }
    console.log("  ✓ Edge — deleted/missing school fails clearly (no retarget)");
  }

  // Silence unused import warning for updateImportBatch in some TS configs
  void updateImportBatch;
  void getImportBatch;

  console.log("\nPhase 1C school-binding: ALL TESTS PASSED");
}

run().catch((err) => {
  console.error("Phase 1C school-binding FAILED", err);
  process.exit(1);
});
