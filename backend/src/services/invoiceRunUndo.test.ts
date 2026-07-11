/**
 * Invoice run undo service tests.
 * Run: npx tsx src/services/invoiceRunUndo.test.ts
 */
import fs from "fs";
import path from "path";

import {
  assertInvoiceRunUndoEnvironmentAllowed,
  undoInvoiceRun,
} from "./invoiceRunUndoService";
import {
  readSchoolLedger,
  writeSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";

const TEST_SCHOOL = "test-school-invoice-run-undo";
const LEDGER_FILE = path.join(process.cwd(), "data", "billing-ledger.json");
const RUN_ID = "RUN-UNDO-TEST";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function backupLedger(): string {
  if (!fs.existsSync(LEDGER_FILE)) return "";
  return fs.readFileSync(LEDGER_FILE, "utf8");
}

function restoreLedger(raw: string) {
  if (!raw) {
    if (fs.existsSync(LEDGER_FILE)) fs.unlinkSync(LEDGER_FILE);
    return;
  }
  fs.writeFileSync(LEDGER_FILE, raw, "utf8");
}

function seedRun(entries: BillingLedgerEntry[]) {
  writeSchoolLedger(TEST_SCHOOL, entries);
}

function invoice(partial: Partial<BillingLedgerEntry>): BillingLedgerEntry {
  return {
    id: partial.id || "inv-1",
    schoolId: TEST_SCHOOL,
    learnerId: partial.learnerId || "l1",
    accountNo: partial.accountNo || "TST001",
    type: "invoice",
    amount: partial.amount ?? 1000,
    date: partial.date || "2026-08-15",
    reference: partial.reference || "INV-1",
    description: partial.description || "Test",
    runId: partial.runId || RUN_ID,
    invoicePeriod: partial.invoicePeriod || "2026-08",
    billedLearnerId: partial.billedLearnerId,
    lineKey: partial.lineKey,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

function testUndoRemovesRunScopedInvoices() {
  seedRun([
    invoice({ id: "inv-a", amount: 1000 }),
    invoice({ id: "inv-b", amount: 500, billedLearnerId: "l2", lineKey: "l2" }),
    invoice({ id: "inv-other", runId: "RUN-OTHER", amount: 200 }),
    {
      id: "pay-1",
      schoolId: TEST_SCHOOL,
      learnerId: "l1",
      accountNo: "TST001",
      type: "payment",
      amount: 100,
      date: "2026-08-01",
      reference: "PAY-1",
      description: "Payment",
      createdAt: new Date().toISOString(),
    },
  ]);

  const result = undoInvoiceRun({ schoolId: TEST_SCHOOL, runId: RUN_ID });
  assert(result.success, "undo success");
  assert(result.removedCount === 2, "removed two invoices");
  assert(result.totalAmount === 1500, "total amount");

  const after = readSchoolLedger(TEST_SCHOOL);
  assert(after.length === 2, "payment and other run remain");
  assert(after.some((e) => e.id === "pay-1"), "payment unchanged");
  assert(after.some((e) => e.id === "inv-other"), "other run unchanged");
  console.log("✓ undo removes run-scoped invoices only");
}

function testSecondUndoIsIdempotent() {
  seedRun([invoice({ id: "inv-only" })]);
  const first = undoInvoiceRun({ schoolId: TEST_SCHOOL, runId: RUN_ID });
  assert(first.success && first.removedCount === 1, "first undo");
  const second = undoInvoiceRun({ schoolId: TEST_SCHOOL, runId: RUN_ID });
  assert(second.success === true && second.alreadyUndone === true, "second undo idempotent");
  assert(second.removedCount === 0, "second undo removes nothing");
  console.log("✓ second undo is idempotent");
}

function testUndoRejectsNonInvoiceRunRows() {
  seedRun([
    invoice({ id: "inv-x" }),
    {
      id: "credit-x",
      schoolId: TEST_SCHOOL,
      learnerId: "l1",
      accountNo: "TST001",
      type: "credit",
      amount: 50,
      date: "2026-08-01",
      reference: "CR-1",
      description: "Credit",
      runId: RUN_ID,
      createdAt: new Date().toISOString(),
    },
  ]);
  const result = undoInvoiceRun({ schoolId: TEST_SCHOOL, runId: RUN_ID });
  assert(!result.success && result.errorCode === "AMBIGUOUS_RUN", "ambiguous run rejected");
  assert(readSchoolLedger(TEST_SCHOOL).length === 2, "ledger unchanged on reject");
  console.log("✓ undo rejects ambiguous non-invoice run rows");
}

function testLocalUndoAllowed() {
  assertInvoiceRunUndoEnvironmentAllowed();
  console.log("✓ local undo environment allowed");
}

async function main() {
  const backup = backupLedger();
  try {
    testLocalUndoAllowed();
    testUndoRemovesRunScopedInvoices();
    testSecondUndoIsIdempotent();
    testUndoRejectsNonInvoiceRunRows();
    console.log("invoiceRunUndo.test.ts: OK");
  } finally {
    restoreLedger(backup);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
