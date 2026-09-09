/**
 * Frontend filter helpers for Outstanding Accounts.
 * Run: npx tsx --tsconfig tsconfig.json src/billing/outstandingAccountsFilters.test.ts
 * (or node with ts-node / vitest if configured)
 */
import assert from "assert";
import {
  filterOutstandingAccounts,
  matchesBalanceRange,
  matchesDaysOverdue,
  summarizeFilteredOutstanding,
} from "./outstandingAccountsFilters";

function row(partial: Partial<Parameters<typeof filterOutstandingAccounts>[0][number]> = {}) {
  return {
    accountNumber: "FAM001",
    accountRef: "FAM001",
    learnerNames: ["John Smith"],
    grades: ["Grade 3"],
    classes: ["3A"],
    outstandingBalance: 2500,
    parentGuardianName: "Parent One",
    primaryCellphone: "0821111111",
    alternateContact: null,
    email: "a@b.com",
    daysOverdue: 45,
    memberLearnerIds: ["L1"],
    ...partial,
  };
}

assert.equal(matchesBalanceRange(500, "0.01-1000"), true);
assert.equal(matchesBalanceRange(1000.01, "0.01-1000"), false);
assert.equal(matchesBalanceRange(10001, "above-10000"), true);
assert.equal(matchesDaysOverdue(null, "unknown"), true);
assert.equal(matchesDaysOverdue(45, "31-60"), true);
assert.equal(matchesDaysOverdue(45, "1-30"), false);

const filtered = filterOutstandingAccounts(
  [
    row({ accountRef: "A", outstandingBalance: 500, daysOverdue: 10 }),
    row({
      accountRef: "B",
      outstandingBalance: 2500,
      learnerNames: ["Mary"],
      parentGuardianName: "Guardian",
      primaryCellphone: "083",
      daysOverdue: null,
    }),
  ],
  {
    search: "mary",
    grade: "all",
    className: "all",
    balanceRange: "all",
    daysOverdue: "unknown",
  }
);
assert.equal(filtered.length, 1);
assert.equal(filtered[0].accountRef, "B");

const summary = summarizeFilteredOutstanding([
  row({ outstandingBalance: 100, memberLearnerIds: ["L1", "L2"] }),
  row({ outstandingBalance: 200.5, memberLearnerIds: ["L2", "L3"] }),
]);
assert.equal(summary.outstandingAccountCount, 2);
assert.equal(summary.learnersAffected, 3);
assert.equal(summary.totalOutstanding, 300.5);

console.log("✓ outstandingAccountsFilters tests passed");
