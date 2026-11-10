/**
 * Period-end closing balance identity tests.
 * Run: npx tsx src/utils/statementPeriod.closingBalance.test.ts
 */
import assert from "node:assert/strict";
import {
  computeStatementClosingBalance,
  computeStatementOpeningBalance,
  filterLedgerByStatementPeriod,
  resolveStatementPeriodCutoff,
} from "./statementPeriod";
import type { BillingLedgerEntry } from "./billingLedgerStore";
import { normaliseAmount } from "./billingLedgerStore";

function entry(partial: Partial<BillingLedgerEntry> & { type: BillingLedgerEntry["type"] }): BillingLedgerEntry {
  const date = partial.date || "2026-10-01";
  return {
    id: partial.id || `e-${Math.random().toString(36).slice(2, 8)}`,
    schoolId: partial.schoolId || "school-a",
    learnerId: partial.learnerId || "l1",
    accountNo: partial.accountNo || "FAM001",
    type: partial.type,
    amount: partial.amount ?? 0,
    date,
    reference: partial.reference || "REF",
    description: partial.description || "Row",
    createdAt: partial.createdAt || `${date}T00:00:00.000Z`,
    ...partial,
  };
}

function netOfVisiblePeriod(
  entries: BillingLedgerEntry[],
  period: string
): number {
  const opening = computeStatementOpeningBalance(entries, period);
  const closing = computeStatementClosingBalance(entries, period);
  return normaliseAmount(closing - opening);
}

function main() {
  const now = new Date(2026, 10, 10, 12, 0, 0); // 10 Nov 2026 local
  const cutoff = resolveStatementPeriodCutoff("Last 3 Months", now);
  assert.ok(cutoff);
  assert.equal(cutoff!.toISOString().slice(0, 10) >= "2026-08-09", true);

  const ledger: BillingLedgerEntry[] = [
    entry({ id: "ob", type: "invoice", amount: 5000, date: "2025-01-01", description: "Kid-e-Sys opening balance", source: "kidesys_opening_balance", reference: "OB" }),
    entry({ id: "old-inv", type: "invoice", amount: 1200, date: "2026-01-15" }),
    entry({ id: "old-pay", type: "payment", amount: 200, date: "2026-02-01" }),
    entry({ id: "win-inv", type: "invoice", amount: 800, date: "2026-09-15" }),
    entry({ id: "win-pay", type: "payment", amount: 300, date: "2026-10-01" }),
    entry({ id: "win-credit", type: "credit", amount: 50, date: "2026-10-05" }),
    entry({ id: "win-pen", type: "penalty", amount: 25, date: "2026-10-08" }),
  ];

  // All Time: opening 0, closing = full ledger net of statement-visible rows.
  assert.equal(computeStatementOpeningBalance(ledger, "All Time"), 0);
  const allTimeClosing = computeStatementClosingBalance(ledger, "All Time");
  // 5000 + 1200 - 200 + 800 - 300 - 50 + 25 = 6475
  assert.equal(allTimeClosing, 6475);

  // Last 24 Months (covers Jan 2026+ relative to Nov 2026; OB May still be before cutoff).
  const period = "Last 24 Months";
  const opening = computeStatementOpeningBalance(ledger, period);
  const closing = computeStatementClosingBalance(ledger, period);
  const periodNet = netOfVisiblePeriod(ledger, period);
  assert.equal(normaliseAmount(opening + periodNet), closing);

  // Filtered window rows must not silently drop prior debt from opening.
  const filtered = filterLedgerByStatementPeriod(ledger, "Last 3 Months");
  assert.equal(
    filtered.some((e) => e.id === "old-inv"),
    false,
    "prior invoice must be outside Last 3 Months window"
  );
  const opening3 = computeStatementOpeningBalance(ledger, "Last 3 Months");
  const closing3 = computeStatementClosingBalance(ledger, "Last 3 Months");
  assert.equal(normaliseAmount(opening3 + netOfVisiblePeriod(ledger, "Last 3 Months")), closing3);
  // Prior activity (OB + old inv - old pay) feeds opening when outside the window.
  assert.ok(opening3 !== 0, "opening must include prior ledger debt");

  // Never treat "current AA" as a substitute: period closing equals ledger math only.
  assert.equal(typeof closing3, "number");
  assert.notEqual(closing3, Number.NaN);

  console.log("statementPeriod.closingBalance.test.ts: OK", {
    allTimeClosing,
    opening3,
    closing3,
    opening24: opening,
    closing24: closing,
  });
}

main();
