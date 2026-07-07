/**
 * Invoice run list service tests (read-only ledger grouping).
 * Run: npx ts-node --transpile-only src/services/invoiceRunListService.test.ts
 */
import {
  countInvoicesByPeriod,
  formatInvoicePeriodLabel,
  listInvoiceRunsFromLedger,
} from "./invoiceRunListService";
import type { BillingLedgerEntry } from "../utils/billingLedgerStore";

const SCHOOL = "test-school-invoice-run-list";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function invoice(partial: Partial<BillingLedgerEntry>): BillingLedgerEntry {
  return {
    id: partial.id || `inv-${Math.random()}`,
    schoolId: SCHOOL,
    learnerId: partial.learnerId || "learner-1",
    accountNo: partial.accountNo || "ALI001",
    type: "invoice",
    amount: partial.amount ?? 100,
    date: partial.date || "2026-06-15",
    reference: partial.reference || "INV-1",
    description: partial.description || "Invoice Run For July 2026",
    createdAt: partial.createdAt || "2026-06-15T10:00:00.000Z",
    ...partial,
  };
}

function runTests() {
  assert(formatInvoicePeriodLabel("2026-08") === "August 2026", "period label");

  const ledger: BillingLedgerEntry[] = [
    invoice({
      id: "a1",
      runId: "RUN-1781514127700",
      invoicePeriod: "2026-07",
      amount: 2000,
      learnerId: "l1",
    }),
    invoice({
      id: "a2",
      runId: "RUN-1781514127700",
      invoicePeriod: "2026-07",
      amount: 1500,
      learnerId: "l2",
    }),
    invoice({
      id: "b1",
      runId: "RUN-1783056354816",
      invoicePeriod: "2026-08",
      description: "Invoice Run For August 2026",
      date: "2026-07-03",
      amount: 3000,
      learnerId: "l3",
      undoneAt: "2026-07-03T08:00:00.000Z",
    }),
    invoice({
      id: "c1",
      runId: "",
      invoicePeriod: "2026-05",
      description: "Manual invoice",
      date: "2026-05-10",
      amount: 500,
      learnerId: "l4",
    }),
  ];

  const runs = listInvoiceRunsFromLedger(SCHOOL, { ledger });
  assert(runs.length === 2, `expected 2 runs, got ${runs.length}`);

  const julyRun = runs.find((run) => run.runId === "RUN-1781514127700");
  assert(!!julyRun, "july run present");
  assert(julyRun!.totalInvoices === 2, "july invoice count");
  assert(julyRun!.totalAmount === 3500, "july total amount");
  assert(julyRun!.source === "ledger", "ledger source");

  const augustRun = runs.find((run) => run.runId === "RUN-1783056354816");
  assert(!augustRun, "undone august run must not appear");

  const periodCounts = countInvoicesByPeriod(SCHOOL, { ledger });
  assert(periodCounts["2026-07"] === 2, "july period count");
  assert(!periodCounts["2026-08"], "august period count excludes undone");

  console.log("invoiceRunListService.test.ts: OK");
}

runTests();
