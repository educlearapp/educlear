/**
 * Invoice-run period duplicate detection ignores undo correction journals (isolated temp ledger only).
 * A payment undo posts an "invoice"-typed correction carrying the payment's learnerId; it must not make the
 * learner look already invoiced for that month.
 * Run: npx tsx src/utils/billingLedgerStore.periodIndexCorrections.test.ts
 */
import fs from "fs";
import os from "os";
import path from "path";

import { undoBillingTransaction } from "../services/billingTransactionUndo";
import {
  buildLearnerInvoicePeriodIndex,
  calculateBalanceFromEntries,
  learnerHasInvoiceForPeriod,
  readSchoolLedger,
  setBillingLedgerStoreDataDirForTests,
  writeSchoolLedger,
  type BillingLedgerEntry,
} from "./billingLedgerStore";
import { setPaymentAllocationStoreDataDirForTests } from "./paymentAllocationStore";

const SCHOOL = "test-school-period-index-corrections";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

const entry = (id: string, type: BillingLedgerEntry["type"], learnerId: string, date: string, extra: Partial<BillingLedgerEntry> = {}): BillingLedgerEntry => ({
  id, schoolId: SCHOOL, learnerId, accountNo: "PIX001", type, amount: 1000, date, reference: id.toUpperCase(),
  description: type, source: "manual", createdAt: `${date}T08:00:00.000Z`, ...extra,
});
const has = (rows: BillingLedgerEntry[], learnerId: string, period: string) => {
  const viaIndex = learnerHasInvoiceForPeriod(rows, learnerId, period, buildLearnerInvoicePeriodIndex(rows));
  const viaScan = learnerHasInvoiceForPeriod(rows, learnerId, period);
  assert(viaIndex === viaScan, `index and scan agree for ${learnerId} ${period}`);
  return viaIndex;
};

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "period-index-corr-"));
  fs.writeFileSync(path.join(dir, "billing-ledger.json"), "{}", "utf8");
  setBillingLedgerStoreDataDirForTests(dir);
  setPaymentAllocationStoreDataDirForTests(dir);
  try {
    writeSchoolLedger(SCHOOL, [
      entry("inv-l1-nov", "invoice", "learner-1", "2026-10-15", { invoicePeriod: "2026-11", billedLearnerId: "learner-1" }),
      entry("pay-l2-dec", "payment", "learner-2", "2026-12-03"),
      entry("cr-l3", "credit", "learner-3", "2026-12-04", { undoneAt: "2026-12-05T08:00:00.000Z", statementHidden: true }),
      entry("undo-corr-cr-l3", "invoice", "learner-3", "2026-12-04", { correctsEntryId: "cr-l3", statementHidden: true, source: "educlear_undo_correction" }),
      entry("inv-l4-dec", "invoice", "learner-4", "2026-11-15", { invoicePeriod: "2026-12", billedLearnerId: "learner-4" }),
    ]);
    const balanceBefore = calculateBalanceFromEntries(readSchoolLedger(SCHOOL));

    await undoBillingTransaction({
      schoolId: SCHOOL, transactionId: "pay-l2-dec", accountNo: "PIX001", confirm: true, expectedAmount: 1000,
      reason: "Payment captured on the wrong account", actor: { userId: "user-finance-fixture", appRole: "Finance" },
    });
    await undoBillingTransaction({ schoolId: SCHOOL, transactionId: "inv-l4-dec", accountNo: "PIX001" });
    const rows = readSchoolLedger(SCHOOL);

    const payCorr = rows.find((e) => e.correctsEntryId === "pay-l2-dec");
    assert(payCorr && payCorr.type === "invoice" && payCorr.learnerId === "learner-2", "payment undo correction is invoice-typed with the learnerId");
    assert(!has(rows, "learner-2", "2026-12"), "payment undo correction does not block the December run for learner-2");
    console.log("  ok - payment undo correction (invoice-typed, with learnerId) does not count as a December invoice");

    const crCorr = rows.find((e) => e.correctsEntryId === "cr-l3");
    assert(crCorr && crCorr.type === "invoice", "credit undo correction is invoice-typed");
    assert(!has(rows, "learner-3", "2026-12"), "credit undo correction does not block learner-3");
    console.log("  ok - credit undo correction (existing ledger shape) does not count as an invoice");

    assert(!has(rows, "learner-4", "2026-12"), "undone December invoice no longer blocks a re-run");
    console.log("  ok - undone invoice still excluded (re-run allowed)");

    assert(has(rows, "learner-1", "2026-11"), "real November invoice still detected (by invoicePeriod)");
    assert(has(rows, "learner-1", "2026-10"), "real invoice still detected by its date month");
    assert(!has(rows, "learner-1", "2026-12"), "no false December hit for learner-1");
    console.log("  ok - real invoices still detected by period and by date month");

    assert(buildLearnerInvoicePeriodIndex(rows.filter((e) => e.correctsEntryId)).size === 0, "no correction row enters the index");
    assert(Math.abs(calculateBalanceFromEntries(rows) - (balanceBefore + 1000 - 1000)) < 0.01, "balances follow the undo journals");
    console.log("  ok - no correction row enters the period index; balances unchanged by the detection fix");

    console.log("billingLedgerStore.periodIndexCorrections.test.ts: OK");
  } finally {
    setBillingLedgerStoreDataDirForTests(null);
    setPaymentAllocationStoreDataDirForTests(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
