/**
 * Reset Da Silva top-up payment batches (Postgres + production ledger via API rollback).
 *
 * Dry-run plan + backup (default):
 *   cd backend && npx ts-node --transpile-only scripts/reset-da-silva-topup-batches.ts
 *
 * Apply reset (production):
 *   CONFIRM_DA_SILVA_TOPUP_BATCH_RESET=true \
 *   DATABASE_URL="postgresql://..." \
 *   SUPER_ADMIN_EMAIL=info@educlear.co.za \
 *   SUPER_ADMIN_PASSWORD="..." \
 *   npx ts-node --transpile-only scripts/reset-da-silva-topup-batches.ts --apply
 *
 * Env:
 *   API_BASE — default https://educlear-backend.onrender.com
 *   KIDE_TRANSACTION_LIST — path to Kid-e-Sys Transaction List export for post-reset preview
 */
import { config as loadDotenv } from "dotenv";
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";

import { previewMigrationTopupPaymentsImport } from "../src/services/migrationCentre/topupPaymentsImportService";

loadDotenv();

const prisma = new PrismaClient();

const SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const BATCH_IDS = [
  "cmpwhftui0007z28ytto580dw", // batch 1 — transaction_list.xls · 247 · R923,465
  "cmpzmiq970029wh6arh0iq3lj", // batch 2 — transaction_list_topup.xlsx · 92 · R304,660
] as const;

const API_BASE = String(process.env.API_BASE || "https://educlear-backend.onrender.com").replace(
  /\/$/,
  ""
);
const CONFIRM_ENV = "CONFIRM_DA_SILVA_TOPUP_BATCH_RESET";
const KIDE_FILE = path.resolve(
  process.env.KIDE_TRANSACTION_LIST ||
    path.join(process.cwd(), "storage", "kideesys-payments-from-2026-06-01.xlsx")
);

function databaseHost(): string {
  try {
    return (
      new URL(String(process.env.DATABASE_URL || "").replace(/^postgres(ql)?:\/\//i, "https://"))
        .hostname || "unknown"
    );
  } catch {
    return "invalid DATABASE_URL";
  }
}

function isProductionDb(): boolean {
  return databaseHost().includes("oregon-postgres.render.com");
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${url} ${res.status}: ${String(text).slice(0, 400)}`);
  }
  return data;
}

async function loginSuperAdmin(): Promise<string> {
  const email = String(process.env.SUPER_ADMIN_EMAIL || "info@educlear.co.za").trim();
  const password = String(process.env.SUPER_ADMIN_PASSWORD || "").trim();
  if (!password) {
    throw new Error("SUPER_ADMIN_PASSWORD required for production ledger rollback via API");
  }
  const data = (await fetchJson(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })) as { token?: string };
  const token = String(data.token || "").trim();
  if (!token) throw new Error("Login succeeded but no token returned");
  return token;
}

async function rollbackBatchViaApi(token: string, batchId: string) {
  return fetchJson(`${API_BASE}/api/migration/topup-payments/batches/${encodeURIComponent(batchId)}/rollback`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ schoolId: SCHOOL_ID }),
  });
}

async function fetchLiveMetrics() {
  const paymentsData = (await fetchJson(
    `${API_BASE}/api/payments?schoolId=${encodeURIComponent(SCHOOL_ID)}`
  )) as { payments?: Array<{ source?: string; id?: string; amount?: number }> };
  const payments = paymentsData.payments || [];
  const kidesysTopup = payments.filter(
    (p) => String(p.source || "").toLowerCase() === "kidesys_topup"
  );
  const manualPayments = payments.filter(
    (p) => String(p.source || "").toLowerCase() !== "kidesys_topup"
  );

  const ledgerData = (await fetchJson(
    `${API_BASE}/api/invoices/ledger?schoolId=${encodeURIComponent(SCHOOL_ID)}`
  )) as { entries?: unknown[] };
  const entries = ledgerData.entries || [];

  const accountsData = (await fetchJson(
    `${API_BASE}/api/statements/accounts?schoolId=${encodeURIComponent(SCHOOL_ID)}`
  )) as { accounts?: unknown[]; totalOutstandingBalance?: number };
  const accounts = accountsData.accounts || [];

  return {
    paymentCount: payments.length,
    kidesysTopupCount: kidesysTopup.length,
    kidesysTopupValue: kidesysTopup.reduce((s, p) => s + Number(p.amount || 0), 0),
    manualPaymentCount: manualPayments.length,
    ledgerEntryCount: entries.length,
    statementAccountsCount: accounts.length,
    totalOutstandingBalance: accountsData.totalOutstandingBalance ?? null,
    ledgerEntries: entries,
    payments,
  };
}

async function exportPostgresBackup() {
  const batches = await prisma.migrationTopupPaymentBatch.findMany({
    where: { schoolId: SCHOOL_ID },
    orderBy: { uploadedAt: "asc" },
  });
  const rows = await prisma.migrationTopupPaymentRow.findMany({
    where: { schoolId: SCHOOL_ID, batchId: { in: [...BATCH_IDS] } },
    orderBy: { transactionDate: "asc" },
  });
  return { batches, rows };
}

async function countFingerprintsForBatches(): Promise<number> {
  return prisma.migrationTopupPaymentRow.count({
    where: { schoolId: SCHOOL_ID, batchId: { in: [...BATCH_IDS] } },
  });
}

async function countImportedTopupRows(): Promise<number> {
  return prisma.migrationTopupPaymentRow.count({
    where: { schoolId: SCHOOL_ID, status: "imported" },
  });
}

async function runBackup(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  const metrics = await fetchLiveMetrics();
  const postgres = await exportPostgresBackup();

  fs.writeFileSync(
    path.join(dir, "billing-ledger-production.json"),
    JSON.stringify({ schoolId: SCHOOL_ID, entries: metrics.ledgerEntries }, null, 2)
  );
  fs.writeFileSync(path.join(dir, "payments-production.json"), JSON.stringify(metrics.payments, null, 2));
  fs.writeFileSync(path.join(dir, "postgres-topup-batches.json"), JSON.stringify(postgres.batches, null, 2));
  fs.writeFileSync(path.join(dir, "postgres-topup-rows.json"), JSON.stringify(postgres.rows, null, 2));
  fs.writeFileSync(
    path.join(dir, "pre-reset-metrics.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        apiBase: API_BASE,
        databaseHost: databaseHost(),
        schoolId: SCHOOL_ID,
        batchIds: BATCH_IDS,
        paymentCount: metrics.paymentCount,
        kidesysTopupCount: metrics.kidesysTopupCount,
        kidesysTopupValue: metrics.kidesysTopupValue,
        manualPaymentCount: metrics.manualPaymentCount,
        ledgerEntryCount: metrics.ledgerEntryCount,
        statementAccountsCount: metrics.statementAccountsCount,
        totalOutstandingBalance: metrics.totalOutstandingBalance,
        postgresBatchCount: postgres.batches.length,
        postgresRowCount: postgres.rows.length,
        postgresImportedRowCount: postgres.rows.filter((r) => r.status === "imported").length,
      },
      null,
      2
    )
  );

  return { metrics, postgres };
}

async function applyReset(token: string) {
  const rollbackResults: unknown[] = [];
  for (const batchId of BATCH_IDS) {
    rollbackResults.push(await rollbackBatchViaApi(token, batchId));
  }

  const deletedRows = await prisma.migrationTopupPaymentRow.deleteMany({
    where: { schoolId: SCHOOL_ID, batchId: { in: [...BATCH_IDS] } },
  });
  const deletedBatches = await prisma.migrationTopupPaymentBatch.deleteMany({
    where: { schoolId: SCHOOL_ID, id: { in: [...BATCH_IDS] } },
  });

  return { rollbackResults, deletedRows: deletedRows.count, deletedBatches: deletedBatches.count };
}

async function runPostResetPreview(ledgerEntries: unknown[]) {
  if (!fs.existsSync(KIDE_FILE)) {
    throw new Error(`Kid-e-Sys transaction list not found: ${KIDE_FILE}`);
  }

  const ledgerFile = path.join(process.cwd(), "data", "billing-ledger.json");
  const ledgerBackup = `${ledgerFile}.bak-topup-reset-preview-${stamp()}`;
  const hadLedger = fs.existsSync(ledgerFile);
  if (hadLedger) fs.copyFileSync(ledgerFile, ledgerBackup);

  const dataDir = path.dirname(ledgerFile);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    ledgerFile,
    JSON.stringify({ [SCHOOL_ID]: ledgerEntries }, null, 2),
    "utf8"
  );

  try {
    return await previewMigrationTopupPaymentsImport({
      schoolId: SCHOOL_ID,
      transactionFilePath: KIDE_FILE,
      originalFileName: path.basename(KIDE_FILE),
      uploadedBy: "reset-da-silva-topup-batches-dry-run",
    });
  } finally {
    if (hadLedger) {
      fs.copyFileSync(ledgerBackup, ledgerFile);
    } else if (fs.existsSync(ledgerFile)) {
      fs.unlinkSync(ledgerFile);
    }
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const backupDir = path.join(
    process.cwd(),
    "storage",
    `topup-reset-backup-${stamp()}`
  );

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "plan",
        schoolId: SCHOOL_ID,
        batchIds: BATCH_IDS,
        apiBase: API_BASE,
        databaseHost: databaseHost(),
        isProductionDb: isProductionDb(),
        kideTransactionList: KIDE_FILE,
      },
      null,
      2
    )
  );

  if (apply && String(process.env[CONFIRM_ENV] || "").trim().toLowerCase() !== "true") {
    console.error(`Refusing --apply without ${CONFIRM_ENV}=true`);
    process.exit(1);
  }
  if (apply && !isProductionDb()) {
    console.error("Refusing --apply against non-production DATABASE_URL");
    process.exit(1);
  }

  console.log("\n[1/4] Backup…");
  const { metrics: preMetrics, postgres: prePostgres } = await runBackup(backupDir);
  console.log(
    JSON.stringify(
      {
        backupDir,
        preReset: {
          kidesysTopupCount: preMetrics.kidesysTopupCount,
          manualPaymentCount: preMetrics.manualPaymentCount,
          statementAccountsCount: preMetrics.statementAccountsCount,
          postgresRows: prePostgres.rows.length,
          postgresBatches: prePostgres.batches.length,
        },
      },
      null,
      2
    )
  );

  let resetResult: unknown = { skipped: true, reason: "plan-only — pass --apply to reset" };
  if (apply) {
    console.log("\n[2/4] Reset (API ledger rollback + Postgres delete)…");
    const token = await loginSuperAdmin();
    resetResult = await applyReset(token);
    console.log(JSON.stringify({ resetResult }, null, 2));
  } else {
    console.log("\n[2/4] Reset skipped (plan-only). Re-run with --apply and confirmation env.");
  }

  console.log("\n[3/4] Post-reset verification…");
  const postMetrics = await fetchLiveMetrics();
  const fingerprintCount = isProductionDb() ? await countFingerprintsForBatches() : null;
  const importedTopupRows = isProductionDb() ? await countImportedTopupRows() : null;
  const remainingBatches = isProductionDb()
    ? await prisma.migrationTopupPaymentBatch.count({ where: { schoolId: SCHOOL_ID } })
    : null;

  const verification = {
    kidesysTopupCount: postMetrics.kidesysTopupCount,
    kidesysTopupExpected: apply ? 0 : "unchanged (no apply)",
    statementAccountsCount: postMetrics.statementAccountsCount,
    statementAccountsExpected: 344,
    manualPaymentCount: postMetrics.manualPaymentCount,
    manualPaymentPreserved:
      apply && preMetrics.manualPaymentCount === postMetrics.manualPaymentCount,
    postgresFingerprintRowsForTargetBatches: fingerprintCount,
    postgresImportedTopupRows: importedTopupRows,
    postgresRemainingBatchCount: remainingBatches,
    ledgerEntryCount: postMetrics.ledgerEntryCount,
  };
  console.log(JSON.stringify({ verification }, null, 2));

  let preview: unknown = { skipped: true, reason: "reset not applied — preview would reflect stale Postgres" };
  if (apply) {
    console.log("\n[4/4] Dry-run preview (Kid-e-Sys Transaction List)…");
    preview = await runPostResetPreview(postMetrics.ledgerEntries);
    const p = preview as {
      totals?: {
        totalRows?: number;
        newPayments?: number;
        duplicatesSkipped?: number;
        unmatchedRows?: number;
        totalPaymentAmount?: number;
      };
      canApply?: boolean;
    };
    console.log(
      JSON.stringify(
        {
          dryRunPreview: {
            fileName: path.basename(KIDE_FILE),
            canApply: p.canApply,
            totals: p.totals,
          },
        },
        null,
        2
      )
    );
    console.log("\n[dry-run] Import NOT applied. Review totals above before apply.");
  } else {
    console.log("\n[4/4] Dry-run preview skipped until --apply completes reset.");
  }

  const reportPath = path.join(backupDir, "reset-report.json");
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode: apply ? "apply" : "plan",
        backupDir,
        resetResult,
        verification,
        dryRunPreview: preview,
      },
      null,
      2
    )
  );
  console.log(`\nReport written: ${reportPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
