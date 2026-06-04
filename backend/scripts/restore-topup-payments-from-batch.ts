/**
 * Restore missing kidesys_topup ledger rows from Postgres MigrationTopupPaymentRow.
 *
 * Default: dry-run only (no writes).
 * Apply: CONFIRM_TOPUP_LEDGER_RESTORE=true node dist/scripts/restore-topup-payments-from-batch.js --apply
 *
 * Run dry-run:
 *   cd backend && npx ts-node --transpile-only scripts/restore-topup-payments-from-batch.ts
 *
 * Optional env:
 *   BATCH_ID=cmpzmiq970029wh6arh0iq3lj
 *   SCHOOL_ID=cmpideqeq0000108xb6ouv9zi
 *   LEDGER_FILE=/path/to/billing-ledger.json
 *   API_BASE=https://educlear-backend.onrender.com  (cross-check live ledger via API)
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";

import { finalizeSchoolBillingLedgerAfterPaymentWrites } from "../src/services/billingPaymentPostService";
import {
  readSchoolLedger,
  upsertSchoolEntries,
  type BillingLedgerEntry,
} from "../src/utils/billingLedgerStore";

const prisma = new PrismaClient();

const DEFAULT_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const DEFAULT_BATCH_ID = "cmpzmiq970029wh6arh0iq3lj";
const SAMPLE_ACCOUNTS = ["DUP001", "ALI002", "ADA004"] as const;

function ledgerEntryIdFromFingerprint(fingerprint: string): string {
  return `kidesys-topup-payment-${String(fingerprint || "").slice(0, 40)}`;
}

function buildEntryFromRow(input: {
  schoolId: string;
  accountNo: string;
  fingerprint: string;
  receiptNo: string;
  transactionDate: string;
  amount: number;
  paymentType: string;
  ledgerEntryId: string;
  createdAt: string;
}): BillingLedgerEntry {
  const receiptNo = String(input.receiptNo || "").trim();
  const paymentType = String(input.paymentType || "").trim() || "EFT";
  return {
    id: input.ledgerEntryId || ledgerEntryIdFromFingerprint(input.fingerprint),
    schoolId: input.schoolId,
    learnerId: "",
    accountNo: String(input.accountNo || "").trim().toUpperCase(),
    type: "payment",
    amount: Math.round(Number(input.amount) * 100) / 100,
    date: String(input.transactionDate || "").trim().slice(0, 10),
    reference: receiptNo || paymentType,
    description: "Kid-e-Sys top-up payment",
    method: paymentType || undefined,
    source: "kidesys_topup",
    createdAt: input.createdAt,
  };
}

function backupLedgerFile(ledgerFile: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${ledgerFile}.bak-topup-restore-${stamp}`;
  fs.copyFileSync(ledgerFile, backup);
  return backup;
}

async function fetchLiveLedgerIdsViaApi(apiBase: string, schoolId: string): Promise<Set<string>> {
  const url = `${apiBase.replace(/\/$/, "")}/api/payments?schoolId=${encodeURIComponent(schoolId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${url} ${res.status}`);
  const data = (await res.json()) as { payments?: Array<{ id?: string; source?: string }> };
  const ids = new Set<string>();
  for (const p of data.payments || []) {
    const id = String(p.id || "").trim();
    if (!id) continue;
    if (String(p.source || "").toLowerCase() === "kidesys_topup" || id.startsWith("kidesys-topup-payment-")) {
      ids.add(id);
    }
  }
  return ids;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply;
  const schoolId = String(process.env.SCHOOL_ID || DEFAULT_SCHOOL_ID).trim();
  const batchId = String(process.env.BATCH_ID || DEFAULT_BATCH_ID).trim();
  const apiBase = String(process.env.API_BASE || "").trim();
  const ledgerFile = path.resolve(
    process.env.LEDGER_FILE || path.join(process.cwd(), "data", "billing-ledger.json")
  );

  if (apply && process.env.CONFIRM_TOPUP_LEDGER_RESTORE !== "true") {
    console.error("Refusing --apply without CONFIRM_TOPUP_LEDGER_RESTORE=true");
    process.exit(1);
  }

  const batch = await prisma.migrationTopupPaymentBatch.findFirst({
    where: { id: batchId, schoolId },
    include: {
      rows: {
        where: { status: "imported" },
        orderBy: { transactionDate: "asc" },
      },
    },
  });

  if (!batch) {
    console.error(`Batch not found: ${batchId} for school ${schoolId}`);
    process.exit(1);
  }

  const uploadedAt = batch.uploadedAt.toISOString();
  const postgresRows = batch.rows;
  const postgresImported = postgresRows.filter((r) => r.status === "imported");

  const ledger = readSchoolLedger(schoolId);
  const ledgerById = new Map(ledger.map((e) => [e.id, e]));
  const ledgerTopup = ledger.filter((e) => String(e.source || "").toLowerCase() === "kidesys_topup");

  let apiTopupIds: Set<string> | null = null;
  if (apiBase) {
    apiTopupIds = await fetchLiveLedgerIdsViaApi(apiBase, schoolId);
  }

  const toRestore: BillingLedgerEntry[] = [];
  const alreadyInLedger: Array<{ id: string; accountNo: string; amount: number; date: string }> = [];

  for (const row of postgresImported) {
    const entryId =
      String(row.ledgerEntryId || "").trim() || ledgerEntryIdFromFingerprint(row.fingerprint);
    const existing = ledgerById.get(entryId);
    if (existing) {
      alreadyInLedger.push({
        id: entryId,
        accountNo: String(existing.accountNo || row.accountNo),
        amount: Number(existing.amount),
        date: String(existing.date || row.transactionDate),
      });
      continue;
    }
    if (apiTopupIds && apiTopupIds.has(entryId)) {
      alreadyInLedger.push({
        id: entryId,
        accountNo: row.accountNo,
        amount: row.amount,
        date: row.transactionDate,
      });
      continue;
    }
    toRestore.push(
      buildEntryFromRow({
        schoolId,
        accountNo: row.accountNo,
        fingerprint: row.fingerprint,
        receiptNo: row.receiptNo,
        transactionDate: row.transactionDate,
        amount: row.amount,
        paymentType: row.paymentType,
        ledgerEntryId: entryId,
        createdAt: uploadedAt,
      })
    );
  }

  const totalRestoreAmount = toRestore.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  const sampleReport: Record<string, unknown> = {};
  for (const acct of SAMPLE_ACCOUNTS) {
    const pg = postgresImported.filter(
      (r) => String(r.accountNo || "").trim().toUpperCase() === acct
    );
    const restore = toRestore.filter((e) => String(e.accountNo).toUpperCase() === acct);
    const present = ledgerTopup.filter((e) => String(e.accountNo).toUpperCase() === acct);
    sampleReport[acct] = {
      postgresRows: pg.map((r) => ({
        receiptNo: r.receiptNo,
        amount: r.amount,
        transactionDate: r.transactionDate,
        fingerprint: r.fingerprint,
        ledgerEntryId: r.ledgerEntryId || ledgerEntryIdFromFingerprint(r.fingerprint),
        status: r.status,
      })),
      inLocalLedgerTopup: present.map((e) => ({
        id: e.id,
        amount: e.amount,
        date: e.date,
        reference: e.reference,
      })),
      wouldRestore: restore.map((e) => ({
        id: e.id,
        amount: e.amount,
        date: e.date,
        reference: e.reference,
      })),
    };
  }

  const report = {
    mode: dryRun ? "dry-run" : "apply",
    schoolId,
    batchId,
    batch: {
      uploadedAt,
      uploadedBy: batch.uploadedBy,
      sourceFilename: batch.sourceFilename,
      rowsImported: batch.rowsImported,
      rowsSkipped: batch.rowsSkipped,
      totalAmount: batch.totalAmount,
      rolledBackAt: batch.rolledBackAt,
    },
    ledgerFile,
    ledgerFileExists: fs.existsSync(ledgerFile),
    postgres: {
      importedRowCount: postgresImported.length,
      allRowCount: postgresRows.length,
    },
    localLedger: {
      totalEntries: ledger.length,
      kidesysTopupCount: ledgerTopup.length,
    },
    liveApi: apiBase
      ? { apiBase, kidesysTopupCount: apiTopupIds?.size ?? 0 }
      : { skipped: "set API_BASE to cross-check production ledger" },
    restorePlan: {
      alreadyInLedger: alreadyInLedger.length,
      toRestore: toRestore.length,
      totalAmountToRestore: Math.round(totalRestoreAmount * 100) / 100,
    },
    samples: sampleReport,
  };

  console.log(JSON.stringify(report, null, 2));

  if (dryRun) {
    console.log("\n[dry-run] No files modified. Approve then run with --apply and CONFIRM_TOPUP_LEDGER_RESTORE=true");
    return;
  }

  if (batch.rolledBackAt) {
    throw new Error("Batch was rolled back — refusing restore");
  }
  if (!toRestore.length) {
    console.log("[apply] Nothing to restore — ledger already complete");
    return;
  }

  if (!fs.existsSync(ledgerFile)) {
    throw new Error(`Ledger file missing: ${ledgerFile}`);
  }

  const backupPath = backupLedgerFile(ledgerFile);
  console.log(`[apply] Backup written: ${backupPath}`);

  upsertSchoolEntries(schoolId, toRestore);
  await finalizeSchoolBillingLedgerAfterPaymentWrites(schoolId);

  const after = readSchoolLedger(schoolId).filter(
    (e) => String(e.source || "").toLowerCase() === "kidesys_topup"
  );
  console.log(
    JSON.stringify(
      {
        applied: true,
        restoredCount: toRestore.length,
        kidesysTopupAfter: after.length,
        backupPath,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
