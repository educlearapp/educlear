/**
 * Invoice run performance + integrity acceptance (read-only preview).
 * Run: npx tsx src/services/invoiceRunPerformance.test.ts
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { executeInvoiceRun } from "./invoiceRunExecuteService";
import { invalidateOfficialBillingAccountRefsCache } from "./officialBillingAccountRef";
import {
  invalidateBillingLedgerFileCache,
  readSchoolLedger,
} from "../utils/billingLedgerStore";
import { invalidateFamilyAccountAgeAnalysisFileCache } from "../utils/familyAccountAgeAnalysisStore";

const DA_SILVA_ID = "cmpideqeq0000108xb6ouv9zi";
const MBB_ID = "cmq4xjckq00at60gqg4eb956h";
const PREVIEW_PERIOD = "2027-03";
const BASELINE_FILE = path.join(
  process.cwd(),
  "storage",
  "invoice-run-performance",
  "baseline-before-2026-07-13.json"
);

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function sha256(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stableLearnerChecksum(learners: Array<Record<string, unknown>>): string {
  const rows = learners
    .map((row) => ({
      learnerId: row.learnerId,
      learnerName: row.learnerName,
      accountNo: row.accountNo,
      status: row.status,
      amount: row.amount,
      skipReason: row.skipReason,
      billingGroupKey: row.billingGroupKey,
    }))
    .sort((a, b) => String(a.learnerId).localeCompare(String(b.learnerId)));
  return sha256(rows);
}

function stableInvoiceLineChecksum(invoices: Array<Record<string, unknown>> | undefined): string {
  const rows = (invoices || [])
    .map((entry) => ({
      learnerId: entry.learnerId,
      accountNo: entry.accountNo,
      amount: entry.amount,
      dueDate: entry.dueDate,
      invoicePeriod: entry.invoicePeriod,
      lineKey: entry.lineKey,
    }))
    .sort((a, b) => String(a.learnerId).localeCompare(String(b.learnerId)));
  return sha256(rows);
}

async function previewSchool(schoolId: string) {
  invalidateBillingLedgerFileCache();
  invalidateFamilyAccountAgeAnalysisFileCache();
  invalidateOfficialBillingAccountRefsCache(schoolId);

  const ledgerBefore = readSchoolLedger(schoolId);
  const ledgerHashBefore = sha256(ledgerBefore);

  const result = await executeInvoiceRun({
    schoolId,
    runId: `PERF-TEST-${schoolId.slice(0, 6)}-${Date.now()}`,
    invoicePeriod: PREVIEW_PERIOD,
    invoiceDate: `${PREVIEW_PERIOD}-01`,
    dryRun: true,
  });

  const ledgerAfter = readSchoolLedger(schoolId);
  assert(sha256(ledgerAfter) === ledgerHashBefore, `${schoolId}: ledger changed during preview`);

  const learners = result.learners || [];
  const invoiced = learners.filter((row) => row.status === "invoiced");
  return {
    eligibleLearnerCount: result.integrity?.eligibleCount ?? 0,
    skippedCount: result.integrity?.skippedCount ?? 0,
    totalInvoiceAmount: +invoiced.reduce((sum, row) => sum + (Number(row.amount) || 0), 0).toFixed(2),
    accountCount: (result.accounts || []).length,
    learnerResultChecksum: stableLearnerChecksum(learners as Array<Record<string, unknown>>),
    invoiceLineChecksum: stableInvoiceLineChecksum(
      result.invoices as Array<Record<string, unknown>> | undefined
    ),
    integrityPassed: result.integrity?.passed === true,
  };
}

async function main() {
  assert(fs.existsSync(BASELINE_FILE), `Missing baseline file: ${BASELINE_FILE}`);
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")) as {
    daSilva: { preview: { httpIntegrity: Record<string, unknown> } };
    mbb: { preview: { httpIntegrity: Record<string, unknown> } };
  };

  const daSilva = await previewSchool(DA_SILVA_ID);
  const mbb = await previewSchool(MBB_ID);

  const daBaseline = baseline.daSilva.preview.httpIntegrity;
  const mbbBaseline = baseline.mbb.preview.httpIntegrity;

  assert(daSilva.integrityPassed, "Da Silva integrity failed");
  assert(mbb.integrityPassed, "MBB integrity failed");

  assert(
    daSilva.learnerResultChecksum === daBaseline.learnerResultChecksum,
    "Da Silva learner checksum mismatch"
  );
  assert(
    daSilva.invoiceLineChecksum === daBaseline.invoiceLineChecksum,
    "Da Silva invoice line checksum mismatch"
  );
  assert(
    mbb.learnerResultChecksum === mbbBaseline.learnerResultChecksum,
    "MBB learner checksum mismatch"
  );
  assert(
    mbb.invoiceLineChecksum === mbbBaseline.invoiceLineChecksum,
    "MBB invoice line checksum mismatch"
  );

  console.log("invoiceRunPerformance.test.ts — PASS");
  console.log("Da Silva:", daSilva);
  console.log("MBB:", mbb);
}

main().catch((error) => {
  console.error("invoiceRunPerformance.test.ts — FAIL", error);
  process.exit(1);
});
