/**
 * Bulk Add Fees To Multiple logic tests.
 * Run: npx tsx src/billing/billingPlansBulkAddFees.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendFeesToPlan,
  applyBulkAddFees,
  clearFilteredLearnerIds,
  filterLearnersForBulkAdd,
  formatBulkAddSummaryMessage,
  selectAllFilteredLearnerIds,
  validateBulkAddSelection,
  type BulkAddFee,
  type BulkAddLearner,
} from "./billingPlansBulkAddFees.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const feeA: BulkAddFee = {
  id: "fee-a",
  description: "Tuition",
  type: "Monthly",
  amount: 1000,
};
const feeB: BulkAddFee = {
  id: "fee-b",
  description: "Transport",
  type: "Optional",
  amount: 250,
};

function learner(
  id: string,
  name: string,
  surname: string,
  classroom: string,
  plan: BulkAddFee[] = []
): BulkAddLearner {
  return { id, name, surname, classroom, billingPlan: plan };
}

function testValidateRequiresLearnersAndFees() {
  assert.equal(validateBulkAddSelection([], [feeA]).ok, false);
  assert.equal(validateBulkAddSelection(["l1"], []).ok, false);
  assert.equal(validateBulkAddSelection(["l1"], [feeA]).ok, true);
  console.log("✓ validate: no request with zero learners or zero fees");
}

function testAppendMatchesSingleAddNoDedupe() {
  const next = appendFeesToPlan([feeA], [feeA, feeB]);
  assert.equal(next.length, 3);
  assert.equal(next.filter((f) => f.id === "fee-a").length, 2);
  console.log("✓ append: preserves single-add duplicate-permitted behaviour");
}

function testFilterAndSelectAllFilteredOnly() {
  const learners = [
    learner("1", "Ann", "Alpha", "Grade 1"),
    learner("2", "Bob", "Beta", "Grade 2"),
    learner("3", "Ann", "Gamma", "Grade 1"),
  ];
  const filtered = filterLearnersForBulkAdd(learners, "ann", "Grade 1");
  assert.deepEqual(
    filtered.map((l) => l.id),
    ["1", "3"]
  );

  const selected = selectAllFilteredLearnerIds(filtered, new Set(["2"]));
  assert.equal(selected.has("1"), true);
  assert.equal(selected.has("3"), true);
  assert.equal(selected.has("2"), true);

  const clearedFiltered = clearFilteredLearnerIds(filtered, selected);
  assert.equal(clearedFiltered.has("1"), false);
  assert.equal(clearedFiltered.has("3"), false);
  assert.equal(clearedFiltered.has("2"), true);
  console.log("✓ selection: filtered Select All / Clear filtered scoped correctly");
}

async function testApplyPartialFailureSurfaced() {
  const learners = [
    learner("ok", "Ok", "One", "A", []),
    learner("bad", "Bad", "Two", "A", []),
  ];
  const byId = new Map(learners.map((l) => [l.id, l]));
  const summary = await applyBulkAddFees({
    selectedLearnerIds: ["ok", "bad", "missing"],
    learnersById: byId,
    selectedFees: [feeA],
    savePlan: async (learner) => {
      if (String(learner.id) === "bad") {
        return { ok: false, error: "Save failed (401)" };
      }
      return { ok: true };
    },
  });

  assert.equal(summary.successCount, 1);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.skippedCount, 1);
  assert.equal(summary.outcome, "PARTIAL");
  assert.ok(
    summary.results.some((r) => r.learnerId === "bad" && r.reason?.includes("401"))
  );
  assert.ok(formatBulkAddSummaryMessage(summary).includes("partially completed"));
  console.log("✓ apply: partial failure surfaced with counts and reasons");
}

async function testApplyUsesSavePlanWithAppendedFees() {
  const existing = [feeB];
  const learners = [learner("l1", "Lee", "Ner", "B", existing)];
  const byId = new Map(learners.map((l) => [l.id, { ...l, raw: { id: "l1", schoolId: "s1" } }]));
  let savedPlan: BulkAddFee[] | null = null;
  let savedLearnerId = "";

  const summary = await applyBulkAddFees({
    selectedLearnerIds: ["l1"],
    learnersById: byId,
    selectedFees: [feeA],
    savePlan: async (learner, plan) => {
      savedLearnerId = String(learner.id);
      savedPlan = plan;
      return { ok: true };
    },
  });

  assert.equal(summary.outcome, "COMPLETE");
  assert.equal(savedLearnerId, "l1");
  assert.ok(savedPlan);
  assert.equal(savedPlan!.length, 2);
  assert.equal(savedPlan![0].id, "fee-b");
  assert.equal(savedPlan![1].id, "fee-a");
  console.log("✓ apply: uses canonical savePlan with appended fee catalogue lines");
}

async function testEmptySelectionDoesNotCallSave() {
  let called = 0;
  const summary = await applyBulkAddFees({
    selectedLearnerIds: [],
    learnersById: new Map(),
    selectedFees: [feeA],
    savePlan: async () => {
      called += 1;
      return { ok: true };
    },
  });
  assert.equal(called, 0);
  assert.equal(summary.outcome, "EMPTY");
  console.log("✓ apply: no save when zero learners");
}

function testListViewWiresBulkModal() {
  const plansSrc = fs.readFileSync(path.join(__dirname, "BillingPlans.tsx"), "utf8");
  assert.ok(
    /BillingPlansBulkAddFeesModal/.test(plansSrc),
    "BillingPlans imports/renders bulk modal"
  );
  assert.ok(
    /openBulkAddFeesModal/.test(plansSrc),
    "list toolbar uses openBulkAddFeesModal"
  );
  assert.ok(
    /showBulkAddModal/.test(plansSrc),
    "list view owns showBulkAddModal state"
  );
  assert.ok(
    /staffAuthHeaders\(\)/.test(plansSrc) &&
      /billing-plan[\s\S]*staffAuthHeaders\(\)/.test(plansSrc),
    "canonical savePlan PATCH sends staffAuthHeaders"
  );
  console.log("✓ source: list view opens bulk modal; savePlan authenticated");
}

async function main() {
  testValidateRequiresLearnersAndFees();
  testAppendMatchesSingleAddNoDedupe();
  testFilterAndSelectAllFilteredOnly();
  await testApplyPartialFailureSurfaced();
  await testApplyUsesSavePlanWithAppendedFees();
  await testEmptySelectionDoesNotCallSave();
  testListViewWiresBulkModal();
  console.log("\nAll billingPlansBulkAddFees tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
