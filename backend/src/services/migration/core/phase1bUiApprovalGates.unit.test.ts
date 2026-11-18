/**
 * Phase 1B — four-step UI approval gates (Approve/Import disabled with blockers).
 * Mirrors UniversalMigrationOrchestratorSection canApprove logic.
 *
 * Run: npx tsx src/services/migration/core/phase1bUiApprovalGates.unit.test.ts
 */

import assert from "assert";

type AttentionItem = { severity: "BLOCKING" | "WARNING"; title: string; message: string };

function canApprove(input: {
  readyToComplete: boolean;
  blocking: AttentionItem[];
  financeApplicable: boolean;
  financeDifferenceCents: number | null;
  overallStatus?: string;
  isComplete: boolean;
}): boolean {
  const financeDiffBlocking =
    input.financeApplicable &&
    typeof input.financeDifferenceCents === "number" &&
    input.financeDifferenceCents !== 0;
  const financeBlocking =
    financeDiffBlocking ||
    (input.financeApplicable &&
      input.blocking.some((b) =>
        /finance|balance|R0|reconcil|account/i.test(`${b.title} ${b.message}`)
      ));
  return (
    Boolean(input.readyToComplete) &&
    input.blocking.length === 0 &&
    !financeDiffBlocking &&
    !financeBlocking &&
    input.overallStatus !== "NEEDS_ATTENTION" &&
    !input.isComplete
  );
}

function main(): void {
  assert.strictEqual(
    canApprove({
      readyToComplete: true,
      blocking: [],
      financeApplicable: true,
      financeDifferenceCents: null,
      isComplete: false,
    }),
    true
  );
  console.log("✓ approve enabled when ready and no blockers");

  assert.strictEqual(
    canApprove({
      readyToComplete: true,
      blocking: [{ severity: "BLOCKING", title: "Finance", message: "Difference R15.00" }],
      financeApplicable: true,
      financeDifferenceCents: 1500,
      isComplete: false,
    }),
    false
  );
  console.log("✓ approve disabled when finance blocker exists");

  assert.strictEqual(
    canApprove({
      readyToComplete: true,
      blocking: [],
      financeApplicable: true,
      financeDifferenceCents: 99900,
      isComplete: false,
    }),
    false
  );
  console.log("✓ approve disabled when differenceCents is non-zero");

  assert.strictEqual(
    canApprove({
      readyToComplete: false,
      blocking: [],
      financeApplicable: false,
      financeDifferenceCents: null,
      isComplete: false,
    }),
    false
  );
  console.log("✓ import disabled without readiness/approval");

  assert.strictEqual(
    canApprove({
      readyToComplete: true,
      blocking: [],
      financeApplicable: true,
      financeDifferenceCents: 0,
      isComplete: true,
    }),
    false
  );
  console.log("✓ import disabled after complete");

  console.log("\nUI approval gates: all passed");
}

main();
