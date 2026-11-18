/**
 * Final acceptance: projected pre-apply finance + post-import R0.00 with payments.
 * ALLOW_DISPOSABLE_MIGRATION_E2E=true npx tsx \
 *   src/services/migration/orchestrator/harness/disposablePhase1FinalAcceptanceE2E.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { prisma } from "../../../../prisma";
import {
  setBillingLedgerStoreDataDirForTests,
  readSchoolLedger,
} from "../../../../utils/billingLedgerStore";
import { setFamilyAccountAgeAnalysisStoreDataDirForTests } from "../../../../utils/familyAccountAgeAnalysisStore";
import { saveMigrationSession } from "../../core/migrationSessionStore";
import { prepareMigrationFromSession } from "../prepareMigrationFromSession";
import { completeUniversalMigration } from "../completeUniversalMigration";
import { listFinanceReconciliationsForStage } from "../../finance/migrationFinanceReconciliationStore";
import { computeUniversalMigrationReadiness } from "../computeUniversalMigrationReadiness";
import type { MigrationFile } from "../../types/MigrationFile";

const PROD = "cmpideqeq0000108xb6ouv9zi";
const CUTOVER = "2026-06-05";
const FIXTURE_DIR = path.resolve(
  process.cwd(),
  "../docs/verification/universal-migration-phase1e/fixtures"
);

function writeCsv(filePath: string, rows: Record<string, string>[]): void {
  const cols = Object.keys(rows[0] || {});
  const lines = [cols.join(",")];
  for (const r of rows) {
    lines.push(cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","));
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function load(name: string): Record<string, string>[] {
  const raw = fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8").trim().split(/\r?\n/);
  const headers = raw[0].split(",");
  return raw.slice(1).map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

function asUploaded(
  id: string,
  filename: string,
  filePath: string,
  category: MigrationFile["category"]
): MigrationFile {
  return {
    id,
    filename,
    path: filePath,
    size: fs.statSync(filePath).size,
    mimeType: "text/csv",
    category,
    uploadedAt: new Date(),
  };
}

async function main(): Promise<void> {
  if (process.env.ALLOW_DISPOSABLE_MIGRATION_E2E !== "true") {
    throw new Error("Set ALLOW_DISPOSABLE_MIGRATION_E2E=true");
  }
  const stamp = Date.now();
  const tmp = path.join(process.cwd(), "uploads", "migration-e2e-final", String(stamp));
  fs.mkdirSync(path.join(tmp, "ledger"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "age"), { recursive: true });
  setBillingLedgerStoreDataDirForTests(path.join(tmp, "ledger"));
  setFamilyAccountAgeAnalysisStoreDataDirForTests(path.join(tmp, "age"));

  const school = await prisma.school.create({
    data: {
      name: `Phase1 Final Accept Harness ${stamp}`,
      email: `phase1-final-h-${stamp}@educlear.test`,
      isDemoTenant: true,
    } as any,
  });
  assert.ok(school.id !== PROD);

  const uploadDir = path.join(
    process.cwd(),
    "uploads",
    "migration-staging",
    school.id,
    "final",
    "uploads"
  );
  fs.mkdirSync(uploadDir, { recursive: true });
  for (const f of ["learners.csv", "accounts.csv", "payments.csv"] as const) {
    writeCsv(path.join(uploadDir, f), load(f));
  }

  saveMigrationSession(school.id, {
    uploadedFiles: [
      asUploaded("f_l", "learners.csv", path.join(uploadDir, "learners.csv"), "learners"),
      asUploaded("f_a", "accounts.csv", path.join(uploadDir, "accounts.csv"), "billing"),
      asUploaded("f_p", "payments.csv", path.join(uploadDir, "payments.csv"), "transactions"),
    ],
    cutoverDate: CUTOVER,
    dryRunStage: null,
    sourceSystem: "generic-excel-csv",
  } as any);

  const prepared = await prepareMigrationFromSession({
    targetSchoolId: school.id,
    cutoverDate: CUTOVER,
    sourceSystem: "generic-excel-csv",
  });

  const pre = computeUniversalMigrationReadiness({
    stageId: prepared.stageId,
    targetSchoolId: school.id,
  });
  const preFin = pre.domains.find((d) => d.domainId === "FINANCE");
  assert.strictEqual(preFin?.metrics?.reconciliationPhase, "projected");
  assert.strictEqual(preFin?.status, "READY");
  assert.notStrictEqual(preFin?.status, "VERIFIED");
  assert.ok(/projected|after import/i.test(String(preFin?.plainLanguage)));
  assert.ok(pre.readyToComplete);

  const { run, readiness } = await completeUniversalMigration({
    stageId: prepared.stageId,
    targetSchoolId: school.id,
    confirmation: true,
  });

  const post = computeUniversalMigrationReadiness({
    stageId: prepared.stageId,
    targetSchoolId: school.id,
  });
  const postFin = post.domains.find((d) => d.domainId === "FINANCE");
  const recon = listFinanceReconciliationsForStage(prepared.stageId)[0];
  const ledger = readSchoolLedger(school.id) || [];
  const pays = ledger.filter((e) => e.type === "payment");
  const refs = pays.map((e) => String(e.reference || ""));

  console.log(
    JSON.stringify(
      {
        schoolId: school.id,
        preApply: {
          overall: pre.overallStatus,
          financeStatus: preFin?.status,
          phase: preFin?.metrics?.reconciliationPhase,
          plain: preFin?.plainLanguage,
        },
        postImport: {
          runStatus: run.status,
          terminalKind: run.terminalKind,
          financeStatus: postFin?.status,
          phase: postFin?.metrics?.reconciliationPhase,
          plain: postFin?.plainLanguage,
          differenceCents: recon?.differenceCents,
          canAccept: recon?.canAccept,
          sourceTotals: recon?.sourceTotals,
          migratedTotals: recon?.migratedTotals,
          summary: run.summary,
          paymentRefs: refs,
        },
        readinessOverall: readiness.overallStatus,
      },
      null,
      2
    )
  );

  assert.strictEqual(run.status, "COMPLETE_ACCEPTED");
  assert.strictEqual(recon.differenceCents, 0);
  assert.strictEqual(postFin?.status, "VERIFIED");
  assert.strictEqual(postFin?.metrics?.reconciliationPhase, "verified");
  assert.ok(/verified|R0\.00/i.test(String(postFin?.plainLanguage)));
  assert.ok(pays.length >= 5);
  for (const r of ["PAY-A", "PAY-B", "PAY-OK", "PAY-EX"]) {
    assert.ok(refs.some((x) => x.includes(r)), `missing ${r}`);
  }
  assert.ok(!refs.some((r) => r.includes("HIST-01")), "pre-cutover must not post");

  console.log("\nPhase 1 final acceptance E2E: PASS");
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
