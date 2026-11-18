/**
 * Phase 1E — migration import posting vs new-billing ACTIVE rules.
 *
 * Run: npx tsx src/services/migration/core/phase1eMigrationImportPosting.unit.test.ts
 */

import assert from "assert";
import { classifyLedgerTransaction } from "./classifyLedgerTransaction";
import {
  isLearnerEligibleForNewBilling,
  classifyTransactionReadiness,
  shouldMigrationImportBeHistoricalOnly,
} from "./transactionEligibility";

const CUTOVER = "2026-06-05";

function baseMapped(overrides: Record<string, string> = {}) {
  return {
    accountNumber: "ACC-1",
    transactionDate: "2026-06-10",
    amount: "200.00",
    reference: "PAY-1",
    description: "Payment",
    transactionType: "Payment",
    ...overrides,
  };
}

function main(): void {
  // New billing rules unchanged
  assert.strictEqual(
    isLearnerEligibleForNewBilling({
      status: "UNKNOWN",
      grade: "1",
      classroom: "1A",
    }),
    false
  );
  assert.strictEqual(
    isLearnerEligibleForNewBilling({
      status: "ACTIVE",
      grade: "1",
      classroom: "1A",
    }),
    true
  );
  console.log("✓ new-billing ACTIVE rules unchanged");

  // Default classify still blocks UNKNOWN (new billing purpose)
  const blockedUnknown = classifyLedgerTransaction({
    mapped: baseMapped(),
    cutoverDate: CUTOVER,
    learnerEntry: { status: "UNKNOWN", grade: "1", classroom: "1A" },
    hasLearnerOrAccountMatch: true,
  });
  assert.strictEqual(blockedUnknown.canPost, false);
  assert.strictEqual(blockedUnknown.bucket, "blocked");
  assert.match(blockedUnknown.reason, /not ACTIVE \(UNKNOWN\)/);
  console.log("✓ default purpose still blocks UNKNOWN (billing rules preserved)");

  // Migration import posts UNKNOWN / missing status when matched
  for (const status of ["UNKNOWN", "HISTORICAL", "UNENROLLED"] as const) {
    const ok = classifyLedgerTransaction({
      mapped: baseMapped({ reference: `PAY-${status}` }),
      cutoverDate: CUTOVER,
      learnerEntry: { status, grade: "1", classroom: "1A" },
      hasLearnerOrAccountMatch: true,
      purpose: "migrationImportPosting",
    });
    assert.strictEqual(ok.canPost, true, status);
    assert.strictEqual(ok.bucket, "eligibleActive", status);
  }
  console.log("✓ migration import posts for UNKNOWN/HISTORICAL/UNENROLLED when matched");

  // Account-number-only match (no learner entry) allowed for migration import
  const acctOnly = classifyLedgerTransaction({
    mapped: baseMapped({ reference: "PAY-ACCT" }),
    cutoverDate: CUTOVER,
    learnerEntry: null,
    hasLearnerOrAccountMatch: false,
    purpose: "migrationImportPosting",
  });
  assert.strictEqual(acctOnly.canPost, true);
  console.log("✓ migration import allows account-number resolution path");

  // Pre-cutover remains historical-only (no double-count with openings)
  assert.strictEqual(
    shouldMigrationImportBeHistoricalOnly({
      transactionDate: "2026-06-01",
      cutoverDate: CUTOVER,
    }),
    true
  );
  const pre = classifyLedgerTransaction({
    mapped: baseMapped({
      transactionDate: "2026-06-01",
      reference: "HIST-1",
    }),
    cutoverDate: CUTOVER,
    learnerEntry: { status: "UNKNOWN", grade: "1", classroom: "1A" },
    hasLearnerOrAccountMatch: true,
    purpose: "migrationImportPosting",
  });
  assert.strictEqual(pre.canPost, false);
  assert.strictEqual(pre.historicalOnly, true);
  assert.strictEqual(pre.bucket, "historicalOnly");
  console.log("✓ pre-cutover stays historical-only (openings not double-counted)");

  // Unmatched without account still rejected
  const unmatched = classifyLedgerTransaction({
    mapped: baseMapped({ accountNumber: "", reference: "PAY-NONE" }),
    cutoverDate: CUTOVER,
    learnerEntry: null,
    hasLearnerOrAccountMatch: false,
    purpose: "migrationImportPosting",
  });
  assert.strictEqual(unmatched.canPost, false);
  assert.strictEqual(unmatched.bucket, "unmatched");
  console.log("✓ unmatched without account rejected");

  // Unknown type never silently posted
  const badType = classifyLedgerTransaction({
    mapped: baseMapped({ transactionType: "", reference: "PAY-TYPE" }),
    cutoverDate: CUTOVER,
    learnerEntry: { status: "ACTIVE", grade: "1", classroom: "1A" },
    hasLearnerOrAccountMatch: true,
    purpose: "migrationImportPosting",
  });
  assert.strictEqual(badType.canPost, false);
  assert.match(badType.reason, /Unknown transaction type/);
  console.log("✓ empty/unknown type rejected (no silent guess)");

  // Readiness helper mirrors import purpose
  assert.strictEqual(
    classifyTransactionReadiness({
      learnerStatus: "UNKNOWN",
      grade: "1",
      classroom: "1A",
      hasLearnerOrAccountMatch: true,
      amountValid: true,
      datePresent: true,
      transactionDate: "2026-06-10",
      cutoverDate: CUTOVER,
      purpose: "migrationImportPosting",
    }),
    "eligibleActive"
  );
  assert.strictEqual(
    classifyTransactionReadiness({
      learnerStatus: "UNKNOWN",
      grade: "1",
      classroom: "1A",
      hasLearnerOrAccountMatch: true,
      amountValid: true,
      datePresent: true,
      transactionDate: "2026-06-10",
      cutoverDate: CUTOVER,
      purpose: "newBillingEligibility",
    }),
    "blocked"
  );
  console.log("✓ readiness purpose split correct");

  console.log("\nPhase 1E migration import posting: all passed");
}

main();
