/**
 * Smoke check: EduClear undo posts correction journal (no ledger delete).
 * Run: npx ts-node --transpile-only src/services/billingTransactionUndo.test.ts
 */
import fs from "fs";
import path from "path";

import {
  correctionReversalType,
  undoBillingTransaction,
  undoCorrectionEntryId,
} from "./billingTransactionUndo";
import { calculateBalanceFromEntries } from "../utils/billingLedgerStore";

const SCHOOL = "test-school-undo-corr";
const LEDGER_FILE = path.join(process.cwd(), "data", "billing-ledger.json");

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

async function main() {
  assert(correctionReversalType("invoice") === "credit", "invoice undo -> credit");
  assert(correctionReversalType("payment") === "invoice", "payment undo -> invoice");
  assert(undoCorrectionEntryId("pay-abc") === "undo-corr-pay-abc", "stable correction id");

  const backup = backupLedger();
  try {
    const invoiceId = `inv-test-${Date.now()}`;
    const entry = {
      id: invoiceId,
      schoolId: SCHOOL,
      learnerId: "learner-1",
      accountNo: "TST001",
      type: "invoice" as const,
      amount: 500,
      date: "2026-06-01",
      reference: "INV-TEST",
      description: "Test invoice",
      source: "manual",
      createdAt: new Date().toISOString(),
    };

    const { readSchoolLedger: readLedger, writeSchoolLedger } = await import("../utils/billingLedgerStore");
    writeSchoolLedger(SCHOOL, [entry]);

    const before = calculateBalanceFromEntries(readLedger(SCHOOL));
    assert(before === 500, `balance before undo should be 500, got ${before}`);

    const result = await undoBillingTransaction({
      schoolId: SCHOOL,
      transactionId: invoiceId,
      accountNo: "TST001",
    });

    assert(!result.alreadyUndone, "first undo should create correction");
    assert(result.original.statementHidden === true, "original hidden from statement");
    assert(result.correction.statementHidden === true, "correction hidden from statement");
    assert(result.correction.correctsEntryId === invoiceId, "correction links to original");

    const after = calculateBalanceFromEntries(readLedger(SCHOOL));
    assert(Math.abs(after) < 0.01, `balance after undo should be 0, got ${after}`);

    const again = await undoBillingTransaction({
      schoolId: SCHOOL,
      transactionId: invoiceId,
      accountNo: "TST001",
    });
    assert(again.alreadyUndone, "second undo should be idempotent");

    console.log("billingTransactionUndo.test.ts: OK");
  } finally {
    restoreLedger(backup);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
