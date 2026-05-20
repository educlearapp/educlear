/**
 * Smoke check: merge/unmerge statement row scoping (no ledger deletes).
 * Run: npx ts-node --transpile-only src/utils/billingLedgerFamilyScope.test.ts
 */
import {
  calculateBalanceFromEntries,
  collectFamilyAccountEntries,
  entryMatchesFamilyAccountScope,
  type BillingLedgerEntry,
} from "./billingLedgerStore";

const SCHOOL = "test-school-family-scope";
const ANTHONY = "learner-anthony";
const ADRIEN = "learner-adrien";
const SIL001 = "SIL001";
const ADR002 = "ADR002";

function invoice(
  id: string,
  learnerId: string,
  accountNo: string,
  amount: number
): BillingLedgerEntry {
  return {
    id,
    schoolId: SCHOOL,
    learnerId,
    accountNo,
    type: "invoice",
    amount,
    date: "2026-01-15",
    reference: id,
    description: "Fees",
    createdAt: "2026-01-15T10:00:00.000Z",
  };
}

function familyPayment(accountNo: string, amount: number): BillingLedgerEntry {
  return {
    id: `pay-family-${accountNo}`,
    schoolId: SCHOOL,
    learnerId: "",
    accountNo,
    type: "payment",
    amount,
    date: "2026-02-01",
    reference: "EFT",
    description: "Family payment",
    createdAt: "2026-02-01T10:00:00.000Z",
  };
}

const ledger: BillingLedgerEntry[] = [
  invoice("inv-anthony-1", ANTHONY, SIL001, 5000),
  invoice("inv-adrien-1", ADRIEN, SIL001, 4500),
  familyPayment(SIL001, 2000),
];

let failed = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    failed += 1;
    console.error(`FAIL: ${message}`);
  }
}

// Merged: both learners on SIL001
const mergedScope = { accountRef: SIL001, learnerIds: [ANTHONY, ADRIEN] };
const mergedRows = collectFamilyAccountEntries(ledger, mergedScope);
assert(mergedRows.length === 3, "merged family should include both invoices and shared payment");
assert(
  mergedRows.some((e) => e.id === "inv-adrien-1"),
  "merged family should include Adrien invoice"
);

// After unmerge: Adrien invoice still on SIL001 in ledger (historical accountNo), membership split
const anthonyOnly = collectFamilyAccountEntries(ledger, {
  accountRef: SIL001,
  learnerIds: [ANTHONY],
});
const adrienOnly = collectFamilyAccountEntries(ledger, {
  accountRef: ADR002,
  learnerIds: [ADRIEN],
});

assert(
  !anthonyOnly.some((e) => e.id === "inv-adrien-1"),
  "Anthony account must not show Adrien learner-tagged invoice after unmerge"
);
assert(
  anthonyOnly.some((e) => e.id === "inv-anthony-1"),
  "Anthony account must still show Anthony invoice"
);
assert(
  anthonyOnly.some((e) => e.id === "pay-family-SIL001"),
  "Anthony account must show SIL001 family-level payment"
);
assert(
  adrienOnly.some((e) => e.id === "inv-adrien-1"),
  "Adrien account must show Adrien learner-tagged invoice"
);
assert(
  !adrienOnly.some((e) => e.id === "inv-anthony-1"),
  "Adrien account must not show Anthony invoice"
);
assert(
  !adrienOnly.some((e) => e.id === "pay-family-SIL001"),
  "Adrien account must not show SIL001 family-level payment"
);

// No duplicate Adrien invoice on Anthony view
const adrienOnAnthony = anthonyOnly.filter((e) => e.learnerId === ADRIEN);
assert(adrienOnAnthony.length === 0, "no Adrien learner rows on Anthony statement");

// School-wide balance unchanged
const schoolTotal = calculateBalanceFromEntries(ledger);
const anthonyBalance = calculateBalanceFromEntries(anthonyOnly);
const adrienBalance = calculateBalanceFromEntries(adrienOnly);
assert(
  Math.abs(schoolTotal - (anthonyBalance + adrienBalance)) < 0.02,
  `partition balances should sum to school total (${schoolTotal} vs ${anthonyBalance + adrienBalance})`
);

// entryMatchesFamilyAccountScope unit checks
assert(
  entryMatchesFamilyAccountScope(invoice("x", ADRIEN, SIL001, 1), {
    accountRef: SIL001,
    learnerIds: [ANTHONY],
  }) === false,
  "learner row excluded when learner not in family"
);
assert(
  entryMatchesFamilyAccountScope(familyPayment(SIL001, 1), {
    accountRef: SIL001,
    learnerIds: [ANTHONY],
  }) === true,
  "account-level row included when accountNo matches ref"
);
assert(
  entryMatchesFamilyAccountScope(familyPayment(SIL001, 1), {
    accountRef: ADR002,
    learnerIds: [ADRIEN],
  }) === false,
  "account-level row excluded when accountNo does not match ref"
);

if (failed > 0) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("All family billing scope checks passed.");
