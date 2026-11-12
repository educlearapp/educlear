/**
 * Clarified B1 local tests — historical running reconstructed; BBF = age; live from BBF.
 * Run: ../frontend/node_modules/.bin/tsx src/services/statementAgeBaseline.b1.test.ts
 */
import assert from "assert";
import {
  computeAgeBaselineStatementClosing,
  computeAgeBaselineStatementOpening,
  partitionLedgerByAgeBaseline,
} from "./statementAgeBaseline";
import { buildStatementManageTransactions } from "./statementTransactionBuilder";
import { resolveAuthoritativeAccountBalanceFromSnapshot } from "./statementAccounts";
import type { BillingLedgerEntry } from "../utils/billingLedgerStore";
import type { FamilyAccountAgeAnalysisSnapshot } from "../utils/familyAccountAgeAnalysisStore";

const SCHOOL = "b1-test-school";
const SENTINEL = "2099-12-31T23:59:59.999Z";

function entry(
  partial: Partial<BillingLedgerEntry> &
    Pick<BillingLedgerEntry, "id" | "type" | "amount" | "date" | "source">
): BillingLedgerEntry {
  return {
    schoolId: SCHOOL,
    learnerId: "learner-1",
    accountNo: "ACC001",
    reference: partial.reference || partial.id,
    description: partial.description || partial.type,
    createdAt: partial.createdAt || `${partial.date}T12:00:00.000Z`,
    ...partial,
  } as BillingLedgerEntry;
}

const snap = {
  accountRef: "ACC001",
  balance: 1000,
  importedAt: SENTINEL,
  source: "kideesys-age-analysis",
} as FamilyAccountAgeAnalysisSnapshot;

const ledger: BillingLedgerEntry[] = [
  entry({
    id: "hist-inv",
    type: "invoice",
    amount: 5000,
    date: "2024-01-01",
    source: "kideesys-transaction",
    reference: "INVOICE 1",
  }),
  entry({
    id: "hist-pay",
    type: "payment",
    amount: 4200,
    date: "2024-02-01",
    source: "kideesys-transaction",
    reference: "PAYMENT 1",
  }),
  entry({
    id: "topup",
    type: "payment",
    amount: 800,
    date: "2024-06-01",
    source: "kidesys_topup",
    reference: "TOPUP 1",
  }),
  entry({
    id: "live-inv",
    type: "invoice",
    amount: 300,
    date: "2024-07-01",
    source: "manual",
    reference: "INV-LIVE-1",
    createdAt: "2024-07-01T10:00:00.000Z",
  }),
  entry({
    id: "live-pay",
    type: "payment",
    amount: 100,
    date: "2024-08-01",
    source: "manual",
    reference: "PAY-LIVE-1",
    createdAt: "2024-08-01T10:00:00.000Z",
  }),
];

function main() {
  const { baselineIncluded, livePosting } = partitionLedgerByAgeBaseline(ledger, SENTINEL);
  assert.equal(baselineIncluded.length, 3, "history+topup in baseline");
  assert.equal(livePosting.length, 2, "two live postings");

  const openingAll = computeAgeBaselineStatementOpening(
    { balance: snap.balance, importedAt: SENTINEL },
    ledger,
    "All Time"
  );
  assert.equal(openingAll, 1000, "All Time BBF is age baseline");

  const closingAll = computeAgeBaselineStatementClosing(
    { balance: snap.balance, importedAt: SENTINEL },
    ledger,
    "All Time"
  );
  const auth = resolveAuthoritativeAccountBalanceFromSnapshot(snap, ledger);
  assert.equal(closingAll, auth, "closing matches authoritative");
  assert.equal(auth, 1200, "1000 + 300 - 100");

  const txs = buildStatementManageTransactions({
    schoolId: SCHOOL,
    accountRef: "ACC001",
    ledgerEntries: ledger,
    periodFilteredEntries: ledger,
    period: "All Time",
    nameByLearnerId: new Map([["learner-1", "Test Learner"]]),
    ageAnalysisBaseline: { balance: snap.balance, importedAt: SENTINEL },
  });

  const historical = txs.filter((t) => t.isImportedHistory);
  const bf = txs.filter((t) => t.isMigrationBroughtForward);
  const active = txs.filter((t) => !t.isImportedHistory && !t.isMigrationBroughtForward);
  assert.ok(historical.length >= 3, "historical section present");
  assert.ok(
    historical.every((t) => t.balance !== null && t.balance !== undefined),
    "historical keeps reconstructed running balances"
  );
  // Display is newest-first; assert chronologically for running continuity.
  const histChrono = [...historical].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  assert.equal(histChrono[0].balance, 5000, "first hist invoice running");
  assert.equal(histChrono[histChrono.length - 1].balance, 0, "end of imported history running");
  assert.equal(bf.length, 1);
  assert.equal(bf[0].balance, 1000);
  assert.match(String(bf[0].description), /Age Analysis/i);
  assert.equal(active.length, 2);
  const liveChrono = [...active].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  assert.equal(liveChrono[liveChrono.length - 1].balance, 1200, "last live running = closing");

  console.log("PASS statementAgeBaseline.b1.test.ts (clarified)");
}

main();
