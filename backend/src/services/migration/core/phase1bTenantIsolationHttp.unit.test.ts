/**
 * Phase 1B — tenant isolation + production guards via HTTP-shaped handlers.
 * Uses Express route handlers with synthetic schools (no production writes).
 *
 * Run: npx tsx src/services/migration/core/phase1bTenantIsolationHttp.unit.test.ts
 */

import assert from "assert";
import express from "express";
import type { AddressInfo } from "net";
import {
  PROTECTED_DA_SILVA_SCHOOL_ID,
  PROTECTED_FLY_EAGLE_SCHOOL_ID,
  CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV,
  ALLOW_PROTECTED_SCHOOL_MIGRATION_ENV,
  assertMigrationWriteAllowed,
} from "./migrationProductionExecutionGuard";
import { completeUniversalMigration } from "../orchestrator/completeUniversalMigration";
import { createStage, deleteStage, getStage } from "../staging/migrationStageStore";
import type { MigrationStage } from "../types/MigrationStage";

function makeStage(schoolId: string, stageId: string): MigrationStage {
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
      rowsChecked: 0,
      totalIssues: 0,
      errors: 0,
      warnings: 0,
      info: 0,
      canProceed: true,
      issuesShown: 0,
    },
    stagedCounts: {
      learners: 0,
      parents: 0,
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
  };
}

async function withServer(
  mount: (app: express.Express) => void,
  fn: (base: string) => Promise<void>
): Promise<void> {
  const app = express();
  app.use(express.json());
  mount(app);
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

async function main(): Promise<void> {
  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean, detail?: string) => {
    if (ok) {
      pass += 1;
      console.log(`✓ ${name}`);
    } else {
      fail += 1;
      console.log(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
    }
  };

  // Direct API-shaped complete endpoint (no UI confirmation flag)
  await withServer(
    (app) => {
      app.post("/api/migration/orchestrator/complete", async (req, res) => {
        try {
          const stageId = String(req.body?.stageId || "").trim();
          const targetSchoolId = String(req.body?.targetSchoolId || "").trim();
          const confirmation = Boolean(req.body?.confirmation);
          if (!confirmation) {
            return res.status(400).json({
              success: false,
              error: "Please confirm before completing the migration.",
              code: "APPROVAL_REQUIRED",
            });
          }
          const result = await completeUniversalMigration({
            stageId,
            targetSchoolId,
            confirmation,
          });
          return res.json({ success: true, run: result.run });
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : "failed";
          return res.status(400).json({ success: false, error: message });
        }
      });
    },
    async (base) => {
      const schoolA = `synth_a_${Date.now()}`;
      const schoolB = `synth_b_${Date.now()}`;
      const stageId = `stage_iso_${Date.now()}`;
      try {
        createStage(makeStage(schoolA, stageId));

        // Missing confirmation — UI approval cannot be bypassed
        {
          const res = await fetch(`${base}/api/migration/orchestrator/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stageId, targetSchoolId: schoolA, confirmation: false }),
          });
          const body = (await res.json()) as { success: boolean; code?: string };
          check(
            "http_complete_without_confirmation_rejected",
            res.status === 400 && body.success === false
          );
        }

        // Wrong school — School A stage cannot write to School B
        {
          const res = await fetch(`${base}/api/migration/orchestrator/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stageId, targetSchoolId: schoolB, confirmation: true }),
          });
          const body = (await res.json()) as { success: boolean; error?: string };
          check(
            "http_school_a_stage_cannot_write_school_b",
            res.status === 400 && String(body.error || "").includes("MIGRATION_SCHOOL_MISMATCH")
          );
        }

        // Stage still bound to A
        const stage = getStage(stageId);
        check("stage_remains_bound_to_school_a", stage?.targetSchoolId === schoolA);
      } finally {
        deleteStage(stageId);
      }
    }
  );

  // Protected schools
  {
    const da = assertMigrationWriteAllowed({
      targetSchoolId: PROTECTED_DA_SILVA_SCHOOL_ID,
      operation: "Complete Migration",
    });
    const fe = assertMigrationWriteAllowed({
      targetSchoolId: PROTECTED_FLY_EAGLE_SCHOOL_ID,
      operation: "Complete Migration",
    });
    check("da_silva_protected", !da.ok);
    check("fly_eagle_protected", !fe.ok);
  }

  // Production guard
  {
    const prevNode = process.env.NODE_ENV;
    const prevConfirm = process.env[CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV];
    process.env.NODE_ENV = "production";
    delete process.env[CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV];
    const blocked = assertMigrationWriteAllowed({
      targetSchoolId: "synthetic_ok",
      operation: "Complete Migration",
    });
    check("production_write_guard_blocks_without_confirm", !blocked.ok);
    process.env[CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV] = "true";
    const allowed = assertMigrationWriteAllowed({
      targetSchoolId: "synthetic_ok",
      operation: "Complete Migration",
    });
    check("production_write_guard_allows_with_confirm", allowed.ok);
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    if (prevConfirm === undefined) delete process.env[CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV];
    else process.env[CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV] = prevConfirm;
  }

  // Invoice run not initiated by migration guard module (static evidence)
  check(
    "no_invoice_run_in_production_guard_module",
    !String(assertMigrationWriteAllowed).includes("invoiceRun") &&
      !ALLOW_PROTECTED_SCHOOL_MIGRATION_ENV.includes("INVOICE")
  );

  console.log(`\nTenant isolation HTTP: ${pass} passed, ${fail} failed`);
  assert.strictEqual(fail, 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
