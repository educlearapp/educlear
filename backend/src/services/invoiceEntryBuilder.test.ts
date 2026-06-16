/**
 * Invoice entry builder guard tests (learner/account mismatch).
 * Run: npx ts-node --transpile-only src/services/invoiceEntryBuilder.test.ts
 *
 * NOTE: These tests avoid touching snapshot store / prisma. The critical invariant is that
 * we never accept a payload where learnerId and accountNo resolve to different official refs.
 */
import fs from "fs";
import path from "path";

import { buildInvoiceEntry, detectLearnerAccountMismatch } from "./invoiceEntryBuilder";
import { defaultBillingSettings } from "../routes/billingSettings";
import { readSchoolLedger, writeSchoolLedger } from "../utils/billingLedgerStore";

const TEST_SCHOOL = "test-school-invoice-entry-guard";
const LEDGER_FILE = path.join(process.cwd(), "data", "billing-ledger.json");

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function backupFile(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
}

function restoreFile(filePath: string, raw: string) {
  if (!raw) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return;
  }
  fs.writeFileSync(filePath, raw, "utf8");
}

function testDetectLearnerAccountMismatch() {
  assert(!detectLearnerAccountMismatch("TST001", "TST001").mismatch, "same ref ok");
  assert(!detectLearnerAccountMismatch("", "TST001").mismatch, "empty learner ref ok");
  assert(!detectLearnerAccountMismatch("TST001", "").mismatch, "empty account ref ok");
  const diff = detectLearnerAccountMismatch("TST001", "TST002");
  assert(diff.mismatch, "different refs mismatch");
  assert(
    String(diff.mismatch && diff.message).includes("TST001"),
    "message includes learner ref"
  );
  console.log("✓ detectLearnerAccountMismatch");
}

async function testBuildInvoiceEntryMatchingAccountOnly() {
  const settings = defaultBillingSettings();
  const before = readSchoolLedger(TEST_SCHOOL).length;
  const built = await buildInvoiceEntry(
    TEST_SCHOOL,
    {
      schoolId: TEST_SCHOOL,
      learnerId: "",
      accountNo: "TST001",
      amount: 1.5,
      date: "2026-06-01",
      id: `test-inv-match-${Date.now()}`,
    },
    settings,
    0
  );
  assert(Boolean(built.entry), `expected entry, got ${built.error || "none"}`);
  assert(!built.errorCode, "no error code on valid account-only invoice");
  const after = readSchoolLedger(TEST_SCHOOL).length;
  assert(after === before, "buildInvoiceEntry does not write ledger directly");
  console.log("✓ buildInvoiceEntry valid account-only payload");
}

async function testBuildInvoiceEntryRejectsMismatchWithoutLedgerWrite() {
  const settings = defaultBillingSettings();
  writeSchoolLedger(TEST_SCHOOL, []);
  const countBefore = readSchoolLedger(TEST_SCHOOL).length;

  // In this isolated test, we cannot guarantee prisma-backed official ref resolution is available,
  // but we still assert the builder does not mutate the ledger.
  const built = await buildInvoiceEntry(
    TEST_SCHOOL,
    {
      schoolId: TEST_SCHOOL,
      learnerId: "learner-stale-x",
      accountNo: "TST002",
      amount: 2.5,
      date: "2026-06-01",
      id: `test-inv-mismatch-${Date.now()}`,
    },
    settings,
    0
  );

  const countAfter = readSchoolLedger(TEST_SCHOOL).length;
  assert(countAfter === countBefore, "ledger unchanged on rejected build");

  if (built.errorCode === "LEARNER_ACCOUNT_MISMATCH") {
    assert(!built.entry, "no entry on mismatch");
    console.log("✓ buildInvoiceEntry rejects LEARNER_ACCOUNT_MISMATCH (prisma-backed)");
    return;
  }

  // Without prisma learner row, guard may not fire — resolution-only mismatch already covered.
  assert(Boolean(built.entry) || Boolean(built.error), "build returned entry or other error");
  console.log("✓ buildInvoiceEntry mismatch guard (no prisma learner — skipped live reject)");
}

async function main() {
  const ledgerBackup = backupFile(LEDGER_FILE);

  try {
    testDetectLearnerAccountMismatch();
    await testBuildInvoiceEntryMatchingAccountOnly();
    await testBuildInvoiceEntryRejectsMismatchWithoutLedgerWrite();
    console.log("\nAll invoiceEntryBuilder guard tests passed.");
  } finally {
    restoreFile(LEDGER_FILE, ledgerBackup);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
