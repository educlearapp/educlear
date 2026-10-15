/**
 * Single-learner billing-plan editors use the same once-off rule as bulk add.
 * Run: npx tsx src/billing/billingPlansSingleAddOnceOff.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findNonRecurringPlanFee,
  nonRecurringPlanFeeMessage,
  validateBulkAddSelection,
} from "./billingPlansBulkAddFees.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tuition = { id: "f1", description: "PRE-PRIMARY 2026 CRECHE AND GRADE R HALF DAY", type: "MONTHLY", amount: 2800 };
const graduation = { id: "f2", description: "Grade R Graduation", type: "ONCE_OFF", amount: 400 };
const jamf = { id: "f3", description: "JAMF Fee", type: "ANNUALLY", amount: 450 };

function testSharedRule() {
  assert.equal(findNonRecurringPlanFee([tuition]), undefined);
  assert.equal(findNonRecurringPlanFee([tuition, graduation])?.id, "f2");
  assert.equal(findNonRecurringPlanFee([jamf])?.id, "f3");
  for (const type of ["once-off", "Once Off", "YEARLY", "Termly"]) {
    assert.ok(findNonRecurringPlanFee([{ ...tuition, type }]), `${type} blocked`);
  }
  const bulk = validateBulkAddSelection(["l1"], [tuition, graduation]);
  assert.equal(bulk.ok, false);
  assert.equal(bulk.ok === false && bulk.error, nonRecurringPlanFeeMessage(graduation), "bulk and single messages identical");
  console.log("✓ single-add uses the bulk-add rule and message");
}

function assertGuardBeforeSave(file: string, saveCall: string) {
  const src = fs.readFileSync(path.join(__dirname, file), "utf8");
  const guard = src.indexOf("findNonRecurringPlanFee(selectedFees)");
  assert.ok(guard > 0, `${file}: guard present`);
  const save = src.indexOf(saveCall, guard);
  assert.ok(save > guard, `${file}: guard runs before ${saveCall}`);
  const between = src.slice(guard, save);
  assert.ok(/return;/.test(between), `${file}: blocked selection returns before saving`);
}

function testEditorsGuardBeforeSave() {
  assertGuardBeforeSave("BillingPlans.tsx", "void savePlan(activePlanLearner, nextPlan)");
  assertGuardBeforeSave("../learner/LearnerBillingPlanTab.tsx", "await savePlan([...plan, ...toAdd])");
  console.log("✓ Billing Plans picker and learner Billing Plan tab block once-off fees before saving");
}

testSharedRule();
testEditorsGuardBeforeSave();
console.log("billingPlansSingleAddOnceOff.test.ts: OK");
