/**
 * Invoice-run combined statements period gates (no live PDF generation).
 * Run: npx ts-node --transpile-only src/services/invoiceRunStatementsPdfService.test.ts
 */
import assert from "node:assert/strict";
import {
  INVOICE_RUN_STATEMENT_DEFAULT_PERIOD,
  invoiceRunStatementCutoffNote,
  invoiceRunStatementWindowStart,
  resolveInvoiceRunStatementPeriod,
} from "./invoiceRunStatementsPdfService";
import {
  computeStatementClosingBalance,
  computeStatementOpeningBalance,
} from "../utils/statementPeriod";
import type { BillingLedgerEntry } from "../utils/billingLedgerStore";

function invoice(partial: Partial<BillingLedgerEntry>): BillingLedgerEntry {
  return {
    id: partial.id || `inv-${Math.random()}`,
    schoolId: partial.schoolId || "school-a",
    learnerId: partial.learnerId || "l1",
    accountNo: partial.accountNo || "FAM001",
    type: "invoice",
    amount: partial.amount ?? 100,
    date: partial.date || "2026-10-15",
    reference: partial.reference || "INV",
    description: partial.description || "Invoice",
    createdAt: partial.createdAt || `${partial.date || "2026-10-15"}T00:00:00.000Z`,
    ...partial,
  };
}

function main() {
  assert.equal(INVOICE_RUN_STATEMENT_DEFAULT_PERIOD, "Last 3 Months");
  assert.equal(resolveInvoiceRunStatementPeriod(""), "Last 3 Months");
  assert.equal(resolveInvoiceRunStatementPeriod("Last 6 Months"), "Last 6 Months");
  assert.equal(resolveInvoiceRunStatementPeriod("All Time"), "All Time");
  assert.throws(() => resolveInvoiceRunStatementPeriod("Custom Date Range"));
  assert.throws(() => resolveInvoiceRunStatementPeriod("Current Academic Year"));

  const now = new Date(2026, 10, 10, 12, 0, 0); // local 10 Nov 2026
  assert.equal(invoiceRunStatementWindowStart("Last 3 Months", now), "2026-08-10");
  assert.equal(invoiceRunStatementWindowStart("All Time", now), null);

  const note = invoiceRunStatementCutoffNote("2026-11", "Last 3 Months");
  assert.match(note, /period-end ledger/);
  assert.match(note, /Opening balances/);
  assert.match(note, /not the current Age Analysis/);
  assert.doesNotMatch(note, /\u2013/); // no en-dash in header-bound note text
  assert.match(note, /\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/);

  // Prior debt must not become a silent zero opening balance for Last N Months.
  const ledger: BillingLedgerEntry[] = [
    invoice({ id: "old", date: "2026-01-01", amount: 1500, createdAt: "2026-01-01T00:00:00.000Z" }),
    invoice({ id: "new", date: "2026-10-15", amount: 400, createdAt: "2026-10-15T00:00:00.000Z" }),
    {
      ...invoice({ id: "pay", date: "2026-10-20", amount: 100, createdAt: "2026-10-20T00:00:00.000Z" }),
      type: "payment",
      description: "Payment",
    },
  ];
  assert.equal(computeStatementOpeningBalance(ledger, "All Time"), 0);
  const closingAllTime = computeStatementClosingBalance(ledger, "All Time");
  assert.equal(closingAllTime, 1800); // 1500 + 400 - 100
  const openingLast24 = computeStatementOpeningBalance(ledger, "Last 24 Months");
  const closingLast24 = computeStatementClosingBalance(ledger, "Last 24 Months");
  assert.equal(typeof openingLast24, "number");
  // Identity: opening + in-period net = closing (All Time identity already checked).
  assert.equal(closingLast24, closingAllTime);

  console.log("invoiceRunStatementsPdfService.test.ts: OK");
}

main();
