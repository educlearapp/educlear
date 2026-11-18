/**
 * Phase 1E — disposable proof that migration payments post with R0.00 recon.
 *
 * ALLOW_DISPOSABLE_MIGRATION_E2E=true npx tsx \
 *   src/services/migration/orchestrator/harness/disposablePhase1ePaymentFixE2E.ts
 *
 * NO production / Da Silva writes.
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
import type { MigrationFile } from "../../types/MigrationFile";

const PROD_SCHOOL = "cmpideqeq0000108xb6ouv9zi";
const CUTOVER = "2026-06-05";
const FIXTURE_DIR = path.resolve(
  process.cwd(),
  "../docs/verification/universal-migration-phase1e/fixtures"
);

function refuseProduction(): void {
  const url = String(process.env.DATABASE_URL || "");
  if (url.includes(PROD_SCHOOL)) throw new Error("REFUSED: production school id");
  if (process.env.ALLOW_DISPOSABLE_MIGRATION_E2E !== "true") {
    throw new Error("Set ALLOW_DISPOSABLE_MIGRATION_E2E=true");
  }
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

function writeCsv(filePath: string, rows: Record<string, string>[]): void {
  const cols = Object.keys(rows[0] || {});
  const lines = [cols.join(",")];
  for (const r of rows) {
    lines.push(cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","));
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function loadFixtureRows(name: string): Record<string, string>[] {
  const raw = fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8").trim();
  const lines = raw.split(/\r?\n/);
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

async function main(): Promise<void> {
  refuseProduction();
  const stamp = Date.now();
  const tmpRoot = path.join(process.cwd(), "uploads", "migration-e2e-phase1e", String(stamp));
  const ledgerDir = path.join(tmpRoot, "ledger");
  const ageDir = path.join(tmpRoot, "age");
  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.mkdirSync(ageDir, { recursive: true });
  setBillingLedgerStoreDataDirForTests(ledgerDir);
  setFamilyAccountAgeAnalysisStoreDataDirForTests(ageDir);

  const school = await prisma.school.create({
    data: {
      name: `Phase1E Payments ${stamp}`,
      email: `phase1e-pay-${stamp}@educlear.test`,
      isDemoTenant: true,
    } as any,
  });
  assert.ok(school.id !== PROD_SCHOOL);

  // Must live under allowed migration-staging roots (see resolveSafeMigrationReadPath).
  const uploadDir = path.join(
    process.cwd(),
    "uploads",
    "migration-staging",
    school.id,
    "phase1e",
    "uploads"
  );
  fs.mkdirSync(uploadDir, { recursive: true });
  const learners = path.join(uploadDir, "learners.csv");
  const accounts = path.join(uploadDir, "accounts.csv");
  const payments = path.join(uploadDir, "payments.csv");
  writeCsv(learners, loadFixtureRows("learners.csv"));
  writeCsv(accounts, loadFixtureRows("accounts.csv"));
  writeCsv(payments, loadFixtureRows("payments.csv"));

  saveMigrationSession(school.id, {
    uploadedFiles: [
      asUploaded(`p1e_l_${stamp}`, "learners.csv", learners, "learners"),
      asUploaded(`p1e_a_${stamp}`, "accounts.csv", accounts, "billing"),
      asUploaded(`p1e_p_${stamp}`, "payments.csv", payments, "transactions"),
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
  const stageId = prepared.stageId;
  console.log(
    "prepared",
    stageId,
    "overall",
    prepared.analysis?.readiness?.overallStatus,
    "domains",
    prepared.analysis?.readiness?.domains?.map((d: any) => ({
      id: d.domainId,
      status: d.status,
      applicable: d.applicable,
    }))
  );

  const { run, readiness } = await completeUniversalMigration({
    stageId,
    targetSchoolId: school.id,
    confirmation: true,
  });

  const recons = listFinanceReconciliationsForStage(stageId);
  const recon = recons[0];
  const batchId = (run.summary as any)?.importBatchId || run.audit?.find((a) => a.event === "core_applied");
  // Find latest import batch for school via report rows if available
  const ledger = readSchoolLedger(school.id);
  const paymentsPosted = (ledger || []).filter(
    (e) => e.type === "payment" || e.type === "credit"
  );
  const openingsPosted = (ledger || []).filter(
    (e) =>
      String(e.source || "").includes("migration") &&
      (e.type === "invoice" || e.type === "credit") &&
      String(e.description || "").toLowerCase().includes("opening")
  );

  console.log(
    JSON.stringify(
      {
        runStatus: run.status,
        terminalKind: run.terminalKind,
        domainsFailed: run.domainsFailed,
        domainsApplied: run.domainsApplied,
        readinessOverall: readiness.overallStatus,
        differenceCents: recon?.differenceCents ?? null,
        canAccept: recon?.canAccept ?? null,
        sourceTotals: recon?.sourceTotals ?? null,
        migratedTotals: recon?.migratedTotals ?? null,
        ledgerEntries: (ledger || []).length,
        paymentOrCreditEntries: paymentsPosted.length,
        samplePayments: paymentsPosted.slice(0, 8).map((e) => ({
          type: e.type,
          amount: e.amount,
          accountNo: e.accountNo,
          reference: e.reference,
          date: e.date,
        })),
        openingsHint: openingsPosted.length,
        auditTail: (run.audit || []).slice(-8),
      },
      null,
      2
    )
  );

  assert.strictEqual(run.status, "COMPLETE_ACCEPTED", "must complete with finance");
  assert.ok(recon, "recon required");
  assert.strictEqual(recon.differenceCents, 0, "R0.00 required");
  assert.strictEqual(recon.canAccept, true);
  assert.ok(
    paymentsPosted.length >= 5,
    `expected >=5 posted payment/credit ledger rows, got ${paymentsPosted.length}`
  );
  // Pre-cutover HIST-01 must not appear as a posted payment
  assert.ok(
    !paymentsPosted.some((e) => String(e.reference || "").includes("HIST-01")),
    "pre-cutover must not post"
  );

  console.log("\nPhase 1E disposable payment fix E2E: PASS");
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
