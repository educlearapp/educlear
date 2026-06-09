/**
 * Read-only pre-import validation for 191 missing Kid-e-Sys payments.
 *
 * Usage:
 *   npx ts-node scripts/missing-payment-import-validation.ts [schoolId]
 *
 * Outputs:
 *   backend/storage/missing-payment-import-validation.csv
 *   backend/storage/missing-payment-import-validation-summary.txt
 *
 * DO NOT import payments.
 * DO NOT modify billing data.
 */
import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { prisma } from "../src/prisma";
import { resolveBillingAccountRef } from "../src/services/resolveBillingAccountRef";
import {
  buildAccountsFromAgeAnalysisSnapshots,
  roundStatementMoney,
} from "../src/services/statementAccounts";
import { readSchoolFamilyAccountAgeAnalysisSnapshots } from "../src/utils/familyAccountAgeAnalysisStore";
import {
  normaliseAmount,
  paymentDuplicateFingerprint,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../src/utils/billingLedgerStore";
import { normaliseIsoDate } from "../src/utils/billingSettingsEngine";

const DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";

type BatchStatus = "Ready" | "Duplicate" | "Warning" | "Error";

type MissingPayment = {
  accountNo: string;
  date: string;
  amount: number;
  reference: string;
  sourceLine: string;
};

type ValidatedRow = MissingPayment & {
  status: BatchStatus;
  reasons: string[];
  accountResolved: boolean;
  inAgeAnalysis: boolean;
  proposedEntryId: string;
};

function csvEscape(value: string | number): string {
  const raw = String(value ?? "");
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

function parseCsvFile(filePath: string): { headers: string[]; rows: string[][] } {
  const raw = fs.readFileSync(filePath, "utf8");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      continue;
    }
    if (ch !== "\r") cell += ch;
  }
  row.push(cell);
  rows.push(row);

  const headers = (rows.shift() || []).map((h) => String(h || "").trim());
  return { headers, rows };
}

function loadMissingFromDiff(diffPath: string): MissingPayment[] {
  const { headers, rows } = parseCsvFile(diffPath);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

  return rows
    .filter((r) => r[idx.Issue] === "KIDE_MISSING_IN_EDU")
    .map((r) => ({
      accountNo: String(r[idx["Account Number"]] || "").trim().toUpperCase(),
      date: String(r[idx["Payment Date"]] || "").trim(),
      amount: roundStatementMoney(Number(r[idx.Amount] || 0)),
      reference: String(r[idx["Reference / Receipt Number"]] || "").trim(),
      sourceLine: String(r[idx["Source Line"]] || "").trim(),
    }));
}

function normalizeReceipt(value: string): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function paymentNumberFromRef(reference: string): string {
  const m = String(reference || "").match(/(\d+)/);
  return m ? m[1] : "";
}

function topupFingerprint(input: {
  accountNo: string;
  receiptNo: string;
  transactionDate: string;
  amount: number;
}): string {
  const accountNo = String(input.accountNo || "").trim();
  const receiptNo = normalizeReceipt(input.receiptNo).replace(/\s+/g, "");
  const date = normaliseIsoDate(input.transactionDate) || input.transactionDate;
  const amount = Math.round(normaliseAmount(input.amount) * 100) / 100;
  const key = [accountNo, receiptNo, date, amount.toFixed(2), "PAYMENT"].join("|");
  return crypto.createHash("sha1").update(key).digest("hex");
}

function topupEntryId(fingerprint: string): string {
  return `kidesys-topup-payment-${String(fingerprint || "").slice(0, 40)}`;
}

function ledgerHasPaymentMatch(
  ledger: BillingLedgerEntry[],
  payment: MissingPayment
): BillingLedgerEntry | null {
  const accountNo = payment.accountNo;
  const receipt = normalizeReceipt(payment.reference);
  const receiptCompact = receipt.replace(/\s+/g, "");
  const payNum = paymentNumberFromRef(payment.reference);
  const date = normaliseIsoDate(payment.date) || payment.date;
  const amount = roundStatementMoney(payment.amount);

  for (const entry of ledger) {
    if (entry.type !== "payment") continue;
    if (String(entry.accountNo || "").trim().toUpperCase() !== accountNo) continue;

    const eAmount = roundStatementMoney(entry.amount);
    const eDate = normaliseIsoDate(entry.date) || String(entry.date || "").slice(0, 10);
    const eRef = normalizeReceipt(entry.reference || "");
    const eRefCompact = eRef.replace(/\s+/g, "");
    const ePayNum = paymentNumberFromRef(entry.reference || "");

    if (receipt && eRef && eRef === receipt) return entry;
    if (receiptCompact && eRefCompact && eRefCompact === receiptCompact) return entry;
    if (payNum && ePayNum && payNum === ePayNum) return entry;
    if (Math.abs(eAmount - amount) < 0.01 && eDate === date && receipt && eRef === receipt) {
      return entry;
    }
  }
  return null;
}

function referenceExistsAnywhere(
  ledger: BillingLedgerEntry[],
  reference: string
): BillingLedgerEntry | null {
  const receipt = normalizeReceipt(reference);
  const receiptCompact = receipt.replace(/\s+/g, "");
  const payNum = paymentNumberFromRef(reference);
  if (!receipt && !payNum) return null;

  for (const entry of ledger) {
    if (entry.type !== "payment") continue;
    const eRef = normalizeReceipt(entry.reference || "");
    const eRefCompact = eRef.replace(/\s+/g, "");
    const ePayNum = paymentNumberFromRef(entry.reference || "");
    if (receipt && eRef === receipt) return entry;
    if (receiptCompact && eRefCompact === receiptCompact) return entry;
    if (payNum && ePayNum === payNum) return entry;
  }
  return null;
}

function batchFingerprint(payment: MissingPayment): string {
  return [
    payment.accountNo,
    payment.date,
    payment.amount.toFixed(2),
    normalizeReceipt(payment.reference),
  ].join("|");
}

async function main() {
  const schoolId = process.argv[2]?.trim() || DA_SILVA_SCHOOL_ID;
  const storageDir = path.join(process.cwd(), "storage");
  const diffPath = path.join(storageDir, "payment-reconciliation-diff.csv");

  if (!fs.existsSync(diffPath)) {
    throw new Error(`Diff CSV not found: ${diffPath}`);
  }

  const missing = loadMissingFromDiff(diffPath);
  const ledger = readSchoolLedger(schoolId);
  const paymentLedger = ledger.filter((e) => e.type === "payment");
  const snapshots = readSchoolFamilyAccountAgeAnalysisSnapshots(schoolId);
  const statementAccounts = await buildAccountsFromAgeAnalysisSnapshots(schoolId);
  const statementRefs = new Set(statementAccounts.map((a) => a.accountNo.toUpperCase()));

  const batchCounts = new Map<string, number>();
  for (const p of missing) {
    const fp = batchFingerprint(p);
    batchCounts.set(fp, (batchCounts.get(fp) || 0) + 1);
  }

  const validated: ValidatedRow[] = [];

  for (const payment of missing) {
    const reasons: string[] = [];
    let status: BatchStatus = "Ready";

    const resolved = await resolveBillingAccountRef(schoolId, payment.accountNo);
    const accountResolved = Boolean(resolved?.accountRef);
    const inAgeAnalysis = Boolean(snapshots[payment.accountNo]);
    const inStatements = statementRefs.has(payment.accountNo);

    const fp = topupFingerprint({
      accountNo: payment.accountNo,
      receiptNo: payment.reference,
      transactionDate: payment.date,
      amount: payment.amount,
    });
    const proposedEntryId = topupEntryId(fp);

    const existingById = ledger.find((e) => e.id === proposedEntryId);
    const existingByAccount = ledgerHasPaymentMatch(paymentLedger, payment);
    const existingByRefAnywhere = referenceExistsAnywhere(paymentLedger, payment.reference);
    const batchDup = (batchCounts.get(batchFingerprint(payment)) || 0) > 1;

    if (!payment.accountNo || !payment.date || !payment.amount) {
      status = "Error";
      reasons.push("Missing required account, date, or amount");
    }

    if (!accountResolved) {
      status = "Error";
      reasons.push("EduClear billing account could not be resolved");
    } else if (!inAgeAnalysis && !inStatements) {
      if (status !== "Error") status = "Warning";
      reasons.push("Account exists but is absent from age-analysis statement accounts");
    }

    if (existingById) {
      status = "Duplicate";
      reasons.push(`Proposed entry id already exists: ${existingById.id}`);
    }
    if (existingByAccount) {
      status = "Duplicate";
      reasons.push(
        `Matching payment already on ledger: ${existingByAccount.reference} (${existingByAccount.date})`
      );
    }
    if (existingByRefAnywhere && !existingByAccount) {
      status = "Duplicate";
      reasons.push(
        `Payment reference already exists on another account: ${existingByRefAnywhere.accountNo}`
      );
    }
    if (batchDup) {
      status = "Duplicate";
      reasons.push("Duplicate row within import batch");
    }

    const eduClearFingerprint = paymentDuplicateFingerprint(schoolId, {
      accountNo: payment.accountNo,
      amount: payment.amount,
      date: payment.date,
      method: "Kid-e-Sys",
      reference: payment.reference,
    });
    const fingerprintCollision = paymentLedger.find(
      (e) =>
        paymentDuplicateFingerprint(e.schoolId, {
          accountNo: e.accountNo,
          amount: e.amount,
          date: e.date,
          method: e.method,
          reference: e.reference,
        }) === eduClearFingerprint
    );
    if (fingerprintCollision && status !== "Duplicate") {
      status = "Duplicate";
      reasons.push(`EduClear payment fingerprint collision: ${fingerprintCollision.id}`);
    }

    if (status === "Ready" && reasons.length === 0) {
      reasons.push("No ledger duplicate; account resolvable; safe to import");
    }

    validated.push({
      ...payment,
      status,
      reasons,
      accountResolved,
      inAgeAnalysis,
      proposedEntryId,
    });
  }

  validated.sort((a, b) => {
    const statusOrder = { Error: 0, Duplicate: 1, Warning: 2, Ready: 3 };
    const s = statusOrder[a.status] - statusOrder[b.status];
    if (s) return s;
    return a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference);
  });

  const byStatus = {
    Ready: validated.filter((r) => r.status === "Ready"),
    Duplicate: validated.filter((r) => r.status === "Duplicate"),
    Warning: validated.filter((r) => r.status === "Warning"),
    Error: validated.filter((r) => r.status === "Error"),
  };

  const totalValue = roundStatementMoney(missing.reduce((s, p) => s + p.amount, 0));
  const refsInLedger = validated.filter(
    (r) =>
      referenceExistsAnywhere(paymentLedger, r.reference) ||
      ledger.some((e) => e.id === r.proposedEntryId)
  );

  const headers = [
    "Batch Status",
    "Account Number",
    "Payment Date",
    "Amount",
    "Reference Number",
    "Proposed Entry ID",
    "Account Resolved",
    "In Age Analysis",
    "Reasons",
  ];

  const lines = [
    headers.join(","),
    ...validated.map((r) =>
      [
        csvEscape(r.status),
        csvEscape(r.accountNo),
        csvEscape(r.date),
        csvEscape(r.amount.toFixed(2)),
        csvEscape(r.reference),
        csvEscape(r.proposedEntryId),
        csvEscape(r.accountResolved ? "Yes" : "No"),
        csvEscape(r.inAgeAnalysis ? "Yes" : "No"),
        csvEscape(r.reasons.join("; ")),
      ].join(",")
    ),
  ];

  const csvPath = path.join(storageDir, "missing-payment-import-validation.csv");
  const summaryPath = path.join(storageDir, "missing-payment-import-validation-summary.txt");
  fs.mkdirSync(storageDir, { recursive: true });
  fs.writeFileSync(csvPath, lines.join("\n"), "utf8");

  const summaryLines = [
    "=== Missing payment import validation (read-only) ===",
    `Generated: ${new Date().toISOString()}`,
    `School: ${schoolId}`,
    "",
    "BATCH TOTALS",
    `  Payment count: ${missing.length}`,
    `  Total value:   R${totalValue.toFixed(2)}`,
    `  Expected count: 191`,
    `  Expected value: R708,165.00`,
    `  Count match:   ${missing.length === 191 ? "YES" : "NO"}`,
    `  Value match:   ${Math.abs(totalValue - 708165) < 0.01 ? "YES" : "NO"}`,
    "",
    "LEDGER REFERENCE CHECK",
    `  Payment references already in billing-ledger.json: ${refsInLedger.length}`,
    `  Proposed imports with no ledger reference conflict: ${validated.length - refsInLedger.length}`,
    "",
    "IMPORT BATCH PREVIEW",
    `  Ready:      ${byStatus.Ready.length} · R${roundStatementMoney(byStatus.Ready.reduce((s, r) => s + r.amount, 0)).toFixed(2)}`,
    `  Warning:    ${byStatus.Warning.length} · R${roundStatementMoney(byStatus.Warning.reduce((s, r) => s + r.amount, 0)).toFixed(2)}`,
    `  Duplicate:  ${byStatus.Duplicate.length} · R${roundStatementMoney(byStatus.Duplicate.reduce((s, r) => s + r.amount, 0)).toFixed(2)}`,
    `  Error:      ${byStatus.Error.length} · R${roundStatementMoney(byStatus.Error.reduce((s, r) => s + r.amount, 0)).toFixed(2)}`,
    "",
    "READY TO IMPORT (includes warnings flagged separately above)",
    `  Strict Ready only: ${byStatus.Ready.length}`,
    `  Ready + Warning:   ${byStatus.Ready.length + byStatus.Warning.length}`,
    "",
    "OUTPUTS",
    `  Validation CSV: ${csvPath}`,
    `  Summary TXT:  ${summaryPath}`,
  ];

  if (byStatus.Warning.length) {
    summaryLines.push("", "WARNINGS");
    for (const row of byStatus.Warning) {
      summaryLines.push(`  ${row.accountNo} ${row.reference} ${row.date} R${row.amount.toFixed(2)} — ${row.reasons.join("; ")}`);
    }
  }
  if (byStatus.Duplicate.length) {
    summaryLines.push("", "DUPLICATES");
    for (const row of byStatus.Duplicate) {
      summaryLines.push(`  ${row.accountNo} ${row.reference} ${row.date} R${row.amount.toFixed(2)} — ${row.reasons.join("; ")}`);
    }
  }
  if (byStatus.Error.length) {
    summaryLines.push("", "ERRORS");
    for (const row of byStatus.Error) {
      summaryLines.push(`  ${row.accountNo} ${row.reference} ${row.date} R${row.amount.toFixed(2)} — ${row.reasons.join("; ")}`);
    }
  }

  fs.writeFileSync(summaryPath, summaryLines.join("\n"), "utf8");
  console.log(summaryLines.join("\n"));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
