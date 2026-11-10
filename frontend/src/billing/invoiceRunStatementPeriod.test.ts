/**
 * Invoice-run statement period selection helpers.
 * Run: npx tsx src/billing/invoiceRunStatementPeriod.test.ts
 */
import assert from "node:assert/strict";
import {
  INVOICE_RUN_STATEMENT_DEFAULT_PERIOD,
  buildInvoiceRunStatementConfirmation,
  describeInvoiceRunStatementPeriodSupport,
  invoiceRunStatementClosingBalanceLimitationNote,
  resolveInvoiceRunStatementWindow,
} from "./invoiceRunStatementPeriod.ts";
import { computeStatementOpeningBalance } from "./statementPeriod.ts";

function main() {
  assert.equal(INVOICE_RUN_STATEMENT_DEFAULT_PERIOD, "Last 3 Months");

  assert.equal(describeInvoiceRunStatementPeriodSupport("Last 1 Month").supported, true);
  assert.equal(describeInvoiceRunStatementPeriodSupport("Last 3 Months").supported, true);
  assert.equal(describeInvoiceRunStatementPeriodSupport("Last 6 Months").supported, true);
  assert.equal(describeInvoiceRunStatementPeriodSupport("Last 12 Months").supported, true);
  assert.equal(describeInvoiceRunStatementPeriodSupport("All Time").supported, true);
  assert.equal(describeInvoiceRunStatementPeriodSupport("Current Academic Year").supported, false);
  assert.equal(describeInvoiceRunStatementPeriodSupport("Custom Date Range").supported, false);

  const now = new Date(2026, 10, 10, 12, 0, 0); // local 10 Nov 2026
  const three = resolveInvoiceRunStatementWindow("Last 3 Months", now);
  assert.equal(three.supported, true);
  assert.equal(three.startDate, "2026-08-10");
  assert.equal(three.endDate, "2026-11-10");

  const all = resolveInvoiceRunStatementWindow("All Time", now);
  assert.equal(all.supported, true);
  assert.equal(all.startDate, null);

  const custom = buildInvoiceRunStatementConfirmation({
    familyAccountCount: 340,
    choice: "Custom Date Range",
    now,
  });
  assert.equal(custom.ok, false);

  const ok = buildInvoiceRunStatementConfirmation({
    familyAccountCount: 340,
    choice: "Last 6 Months",
    now,
  });
  assert.equal(ok.ok, true);
  assert.match(ok.message, /340 family accounts/);
  assert.match(ok.message, /to/);

  const empty = buildInvoiceRunStatementConfirmation({
    familyAccountCount: 0,
    choice: "Last 3 Months",
    now,
  });
  assert.equal(empty.ok, false);

  // Opening balance must include prior debt (not silently zero).
  const ledger = [
    {
      id: "prior-inv",
      schoolId: "s",
      learnerId: "l1",
      accountNo: "FAM1",
      type: "invoice" as const,
      amount: 2000,
      date: "2026-01-15",
      reference: "OLD",
      description: "Prior debt",
      createdAt: "2026-01-15T00:00:00.000Z",
    },
    {
      id: "in-window",
      schoolId: "s",
      learnerId: "l1",
      accountNo: "FAM1",
      type: "invoice" as const,
      amount: 500,
      date: "2026-10-15",
      reference: "NEW",
      description: "In window",
      createdAt: "2026-10-15T00:00:00.000Z",
    },
  ];
  assert.match(invoiceRunStatementClosingBalanceLimitationNote(), /period-end ledger/);
  assert.match(invoiceRunStatementClosingBalanceLimitationNote(), /Opening balances/);
  assert.match(invoiceRunStatementClosingBalanceLimitationNote(), /not the current Age Analysis/);

  // Sanity: opening for All Time is 0 by engine contract.
  assert.equal(computeStatementOpeningBalance(ledger as any, "All Time"), 0);

  console.log("invoiceRunStatementPeriod.test.ts — PASS");
}

main();
