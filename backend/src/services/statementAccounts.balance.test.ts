/**
 * Run: npx ts-node --transpile-only src/services/statementAccounts.balance.test.ts
 */
import type { BillingLedgerEntry } from "../utils/billingLedgerStore";
import {
  filterPostImportBalanceEntries,
  isAgeBaselineSentinelImportedAt,
  resolveAuthoritativeAccountBalanceFromSnapshot,
} from "./statementAccounts";
import type { FamilyAccountAgeAnalysisSnapshot } from "../utils/familyAccountAgeAnalysisStore";

const SENTINEL_IMPORTED_AT = "2099-12-31T23:59:59.999Z";

function manualPayment(amount: number, createdAt: string): BillingLedgerEntry {
  return {
    id: `pay-${createdAt}`,
    schoolId: "cmpideqeq0000108xb6ouv9zi",
    learnerId: "",
    accountNo: "MAM004",
    type: "payment",
    amount,
    date: createdAt.slice(0, 10),
    reference: "EFT",
    description: "Payment",
    source: "manual",
    createdAt,
  };
}

function topupPayment(amount: number, createdAt: string): BillingLedgerEntry {
  return {
    ...manualPayment(amount, createdAt),
    id: `tp-${createdAt}`,
    source: "kidesys_topup",
    reference: "TOPUP",
  };
}

function kidesysImportedPayment(amount: number): BillingLedgerEntry {
  return {
    ...manualPayment(amount, "2026-05-28T08:38:50.489Z"),
    id: "kidesys-payment-test",
    source: "kideesys-transaction",
    reference: "PAYMENT 54124",
  };
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(isAgeBaselineSentinelImportedAt(SENTINEL_IMPORTED_AT), "2099 sentinel detected");

const mamSnapshot: FamilyAccountAgeAnalysisSnapshot = {
  schoolId: "cmpideqeq0000108xb6ouv9zi",
  accountRef: "MAM004",
  accountHolder: "Refentje Mampa",
  kidesysSection: "Bad Debt",
  balance: 4500,
  buckets: { current: 3000, d30: 200, d60: 300, d90: 1000, d120: 0 },
  source: "kideesys-age-analysis",
  importedAt: SENTINEL_IMPORTED_AT,
};

const livePayment = manualPayment(3000, "2026-06-06T10:15:00.000Z");

assert(
  filterPostImportBalanceEntries([livePayment], SENTINEL_IMPORTED_AT).length === 1,
  "manual payment counts under age-baseline sentinel"
);

assert(
  filterPostImportBalanceEntries([kidesysImportedPayment(3000)], SENTINEL_IMPORTED_AT).length === 0,
  "imported Kid-e-Sys ledger payment does not double-count"
);

assert(
  filterPostImportBalanceEntries([topupPayment(500, "2026-06-01T12:00:00.000Z")], SENTINEL_IMPORTED_AT)
    .length === 0,
  "top-up ledger payment does not double-count under sentinel"
);

const beforeBalance = resolveAuthoritativeAccountBalanceFromSnapshot(mamSnapshot, []);
assert(beforeBalance === 4500, `MAM004 before payment = R4,500 (got ${beforeBalance})`);

const afterBalance = resolveAuthoritativeAccountBalanceFromSnapshot(mamSnapshot, [livePayment]);
assert(afterBalance === 1500, `MAM004 after R3,000 payment = R1,500 (got ${afterBalance})`);

const realImportedAt = "2026-06-05T12:00:00.000Z";
assert(
  filterPostImportBalanceEntries([livePayment], realImportedAt).length === 1,
  "manual payment after real importedAt still counts"
);
assert(
  filterPostImportBalanceEntries(
    [manualPayment(100, "2026-06-04T12:00:00.000Z")],
    realImportedAt
  ).length === 0,
  "manual payment before real importedAt is excluded"
);

console.log("statementAccounts.balance.test.ts: ok");
