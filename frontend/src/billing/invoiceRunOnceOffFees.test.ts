/**
 * Once-off fees (per-learner run extras) + bulk plan guard + supplementary run ids.
 * Run: npx tsx src/billing/invoiceRunOnceOffFees.test.ts
 */
import assert from "node:assert/strict";
import {
  applyBulkAddFees,
  isNonRecurringPlanFeeType,
  validateBulkAddSelection,
  type BulkAddFee,
  type BulkAddLearner,
} from "./billingPlansBulkAddFees.ts";
import {
  addOnceOffFeeToLearners,
  beginInvoiceRunWizard,
  buildInvoiceRunExtraFeesByLearnerId,
  nextAvailableInvoiceRunDraftId,
  removeOnceOffFeeFromAllLearners,
  summariseOnceOffFees,
  toThinInvoiceRunDraft,
  validateOnceOffFee,
  type InvoiceRunExtraFee,
  type InvoiceRunListRow,
} from "./invoiceRunList.ts";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const jamf = { feeDescription: "JAMF Fee", amount: 450 };

await check("fee types: once-off/annual/termly are non-recurring; monthly/daily/unknown are not", () => {
  for (const t of ["ONCE_OFF", "Once-off", "once off", "ANNUALLY", "YEARLY", "TERMLY"]) {
    assert.equal(isNonRecurringPlanFeeType(t), true, t);
  }
  for (const t of ["MONTHLY", "MONTHLY_EXCL_DEC", "MONTHLY_EXCL_NOV_DEC", "DAILY", "Monthly", "Optional", "", undefined]) {
    assert.equal(isNonRecurringPlanFeeType(t), false, String(t));
  }
});

const learner: BulkAddLearner = { id: "L1", name: "A", surname: "B", classroom: "Gr 1", billingPlan: [] };
const onceOff: BulkAddFee = { id: "f1", description: "JAMF Fee", type: "ONCE_OFF", amount: 450 };
const monthly: BulkAddFee = { id: "f2", description: "Tuition", type: "MONTHLY", amount: 3000 };

await check("bulk plan add rejects once-off fee with guidance", () => {
  const v = validateBulkAddSelection(["L1"], [monthly, onceOff]);
  assert.equal(v.ok, false);
  assert.match((v as { error: string }).error, /Add Once-off Fee To Selected Learners/);
  assert.equal(validateBulkAddSelection(["L1"], [monthly]).ok, true);
});

await check("applyBulkAddFees never saves a plan when a once-off fee is selected", async () => {
  let saves = 0;
  const summary = await applyBulkAddFees({
    selectedLearnerIds: ["L1"],
    learnersById: new Map([["L1", learner]]),
    selectedFees: [onceOff],
    savePlan: async () => {
      saves += 1;
    },
  } as unknown as Parameters<typeof applyBulkAddFees>[0]);
  assert.equal(saves, 0);
  assert.equal(summary.outcome, "EMPTY");
});

await check("validateOnceOffFee", () => {
  assert.equal(validateOnceOffFee("", 450).ok, false);
  assert.equal(validateOnceOffFee("JAMF Fee", 0).ok, false);
  assert.equal(validateOnceOffFee("JAMF Fee", "abc").ok, false);
  const v = validateOnceOffFee("  JAMF Fee ", "450.005");
  assert.deepEqual(v, { ok: true, fee: { feeDescription: "JAMF Fee", amount: 450.01 } });
});

await check("add once-off fee to selected learners only, dedupe on repeat", () => {
  const first = addOnceOffFeeToLearners({}, ["L1", "L2", "L2"], jamf);
  assert.deepEqual(first.added, ["L1", "L2"]);
  assert.deepEqual(Object.keys(first.extraFeesByLearnerId).sort(), ["L1", "L2"]);
  const again = addOnceOffFeeToLearners(first.extraFeesByLearnerId, ["L1", "L3"], {
    feeDescription: "jamf fee",
    amount: 450,
  });
  assert.deepEqual(again.added, ["L3"]);
  assert.deepEqual(again.skippedDuplicate, ["L1"]);
  assert.equal(again.extraFeesByLearnerId.L1.length, 1);
  const other = addOnceOffFeeToLearners(again.extraFeesByLearnerId, ["L1"], { feeDescription: "JAMF Fee", amount: 350 });
  assert.equal(other.extraFeesByLearnerId.L1.length, 2, "different amount is a different fee");
  assert.deepEqual(first.extraFeesByLearnerId.L1.length, 1, "input not mutated");
});

await check("remove once-off fee and summary counts", () => {
  const base = addOnceOffFeeToLearners({ L9: [{ feeDescription: "Trip", amount: 100 }] }, ["L1", "L2", "L9"], jamf)
    .extraFeesByLearnerId;
  assert.deepEqual(
    summariseOnceOffFees(base).map((r) => [r.fee.feeDescription, r.learnerCount]),
    [["Trip", 1], ["JAMF Fee", 3]]
  );
  const removed = removeOnceOffFeeFromAllLearners(base, jamf);
  assert.equal(removed.removedFrom, 3);
  assert.deepEqual(removed.extraFeesByLearnerId, { L9: [{ feeDescription: "Trip", amount: 100 }] });
});

await check("once-off fees survive thin draft and reach only scoped learners in execute payload", () => {
  const byId = addOnceOffFeeToLearners({}, ["L1", "L2"], jamf).extraFeesByLearnerId;
  const thin = toThinInvoiceRunDraft({ id: "draft:s:2026-11", schoolId: "s", rows: [], extraFeesByLearnerId: byId });
  const payload = buildInvoiceRunExtraFeesByLearnerId(
    ["L1", "L3"],
    thin.extraFeesByLearnerId as Record<string, InvoiceRunExtraFee[]>,
    []
  );
  assert.deepEqual(payload, { L1: [jamf] });
});

await check("removal is not undone by stale fat rows when rows are cleared", () => {
  const stale = { id: "L1", fees: [{ id: "extra-L1-0", type: "EXTRA", description: "JAMF Fee", amount: 450 }] };
  const thin = toThinInvoiceRunDraft({ id: "r", schoolId: "s", rows: [], extraFeesByLearnerId: {} });
  assert.deepEqual(thin.extraFeesByLearnerId, {});
  const withStale = toThinInvoiceRunDraft({ id: "r", schoolId: "s", rows: [stale], extraFeesByLearnerId: {} });
  assert.ok(
    (withStale.extraFeesByLearnerId as Record<string, InvoiceRunExtraFee[]>).L1,
    "documents why the wizard clears rows on apply"
  );
});

await check("supplementary run id when period run id already used", () => {
  const base = "draft:s1:2026-11";
  assert.equal(nextAvailableInvoiceRunDraftId(base, []), base);
  assert.equal(nextAvailableInvoiceRunDraftId(base, [base]), `${base}:supplementary-2`);
  assert.equal(
    nextAvailableInvoiceRunDraftId(base, [base, `${base}:supplementary-2`]),
    `${base}:supplementary-3`
  );
  assert.equal(nextAvailableInvoiceRunDraftId(base, ["draft:s2:2026-11"]), base, "other school unaffected");
});

await check("wizard start: stable id without used ids, supplementary id after executed run", () => {
  const plain = beginInvoiceRunWizard({ drafts: [], schoolId: "s1", month: "November 2026" });
  const used = beginInvoiceRunWizard({
    drafts: [],
    schoolId: "s1",
    month: "November 2026",
    usedRunIds: [String(plain.selectedRun.id)],
  });
  assert.equal(used.selectedRun.id, `${plain.selectedRun.id}:supplementary-2`);
  assert.equal(used.selectedRun.invoicePeriod, plain.selectedRun.invoicePeriod, "same invoice period kept");
  const reused = beginInvoiceRunWizard({
    drafts: [{ ...plain.selectedRun, executed: false } as InvoiceRunListRow],
    schoolId: "s1",
    month: "November 2026",
    usedRunIds: [String(plain.selectedRun.id)],
  });
  assert.equal(reused.reused, true);
  assert.equal(reused.selectedRun.id, `${plain.selectedRun.id}:supplementary-2`);
});

console.log(`\n${passed} checks passed`);
