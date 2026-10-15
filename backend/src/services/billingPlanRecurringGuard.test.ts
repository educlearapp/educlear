/**
 * Once-off / annual / termly fees must never be newly added to monthly billing plans (all save paths).
 * Run: npx tsx src/services/billingPlanRecurringGuard.test.ts
 */
import fs from "fs";
import path from "path";

import {
  ONCE_OFF_FEE_GUIDANCE,
  findNewlyAddedNonRecurringPlanLine,
  isNonRecurringPlanFeeType,
  nonRecurringPlanFeeMessage,
  resolveFeeStructureType,
  type PlanFeeCatalogueEntry,
} from "./billingPlanRecurringGuard";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

const meta = (uiType: string) => `FEES_META:${JSON.stringify({ category: "SCHOOL_CHARGE", uiType, notes: null })}`;

const CATALOGUE: PlanFeeCatalogueEntry[] = [
  { name: "PRE-PRIMARY 2026 CRECHE AND GRADE R HALF DAY", amount: 2800, type: resolveFeeStructureType({ grade: meta("MONTHLY"), frequency: "MONTHLY" }) },
  { name: "Grade R Graduation", amount: 400, type: resolveFeeStructureType({ grade: meta("ONCE_OFF"), frequency: "ONCE_OFF" }) },
  { name: "JAMF Fee", amount: 450, type: resolveFeeStructureType({ grade: meta("ANNUALLY"), frequency: "YEARLY" }) },
  { name: "Aftercare", amount: 550, type: resolveFeeStructureType({ grade: null, frequency: "MONTHLY" }) },
  { name: "Camp", amount: 900, type: resolveFeeStructureType({ grade: meta("TERMLY"), frequency: "YEARLY" }) },
  { name: "Old Levy", amount: 100, type: resolveFeeStructureType({ grade: null, frequency: "YEARLY" }) },
];

const tuition = { feeDescription: "PRE-PRIMARY 2026 CRECHE AND GRADE R HALF DAY", amount: 2800 };
const grad = { feeDescription: "Grade R Graduation", amount: 400 };
const jamf = { feeDescription: "JAMF Fee", amount: 450 };
const aftercare = { feeDescription: "Aftercare", amount: 550 };

function testTypeResolution() {
  assert(resolveFeeStructureType({ grade: meta("TERMLY"), frequency: "YEARLY" }) === "TERMLY", "FEES_META uiType wins");
  assert(resolveFeeStructureType({ grade: null, frequency: "ONCE_OFF" }) === "ONCE_OFF", "legacy frequency fallback");
  assert(resolveFeeStructureType({ grade: "FEES_META:{bad json", frequency: "MONTHLY" }) === "MONTHLY", "bad meta falls back");
  for (const t of ["ONCE_OFF", "once-off", "Once Off", "ONCEOFF", "ANNUALLY", "YEARLY", "TERMLY"]) {
    assert(isNonRecurringPlanFeeType(t), `${t} is non-recurring`);
  }
  for (const t of ["MONTHLY", "MONTHLY_EXCL_DEC", "MONTHLY_EXCL_NOV_DEC", "", "Fee", "Optional"]) {
    assert(!isNonRecurringPlanFeeType(t), `${t} is recurring`);
  }
  console.log("✓ fee type resolution matches the Fees API; once-off/annual/yearly/termly detected");
}

function testBlocksNewNonRecurringLines() {
  const blocked = findNewlyAddedNonRecurringPlanLine([tuition], [tuition, grad], CATALOGUE);
  assert(blocked && blocked.feeDescription === "Grade R Graduation" && blocked.type === "ONCE_OFF", "adding graduation blocked");
  assert(
    nonRecurringPlanFeeMessage(blocked) ===
      `"Grade R Graduation" is a ONCE_OFF fee and cannot be added to billing plans. ${ONCE_OFF_FEE_GUIDANCE}`,
    "same message text as bulk add"
  );
  assert(findNewlyAddedNonRecurringPlanLine([], [jamf], CATALOGUE)?.type === "ANNUALLY", "annual JAMF blocked");
  assert(findNewlyAddedNonRecurringPlanLine([], [{ feeDescription: "Camp", amount: 900 }], CATALOGUE)?.type === "TERMLY", "termly blocked");
  assert(findNewlyAddedNonRecurringPlanLine([], [{ feeDescription: "Old Levy", amount: 100 }], CATALOGUE)?.type === "YEARLY", "legacy YEARLY blocked");
  assert(
    findNewlyAddedNonRecurringPlanLine([], [{ feeDescription: "  grade r   GRADUATION ", amount: 400 }], CATALOGUE),
    "case/whitespace variants blocked"
  );
  assert(
    findNewlyAddedNonRecurringPlanLine([], [{ feeDescription: "Grade R Graduation", amount: 350 }], CATALOGUE),
    "edited amount still blocked by name"
  );
  assert(findNewlyAddedNonRecurringPlanLine([grad], [grad, grad], CATALOGUE), "second copy of an existing once-off line blocked");
  console.log("✓ newly added once-off, annual, yearly and termly lines blocked (incl. name variants, edited amount, duplicate copy)");
}

function testAllowsRecurringAndExistingLines() {
  assert(findNewlyAddedNonRecurringPlanLine([], [tuition, aftercare], CATALOGUE) === null, "monthly fees allowed");
  assert(findNewlyAddedNonRecurringPlanLine([], [{ feeDescription: "Custom line", amount: 75 }], CATALOGUE) === null, "uncatalogued line allowed");
  const existing = [tuition, grad, jamf];
  assert(findNewlyAddedNonRecurringPlanLine(existing, existing, CATALOGUE) === null, "saving an unchanged plan with old once-off lines allowed");
  assert(findNewlyAddedNonRecurringPlanLine(existing, [tuition, jamf], CATALOGUE) === null, "removing graduation allowed");
  assert(findNewlyAddedNonRecurringPlanLine(existing, [tuition, jamf, aftercare, grad], CATALOGUE) === null, "adding aftercare to a plan that still has old lines allowed");
  assert(findNewlyAddedNonRecurringPlanLine(existing, [], CATALOGUE) === null, "clearing plan allowed");
  console.log("✓ recurring fees, uncatalogued lines, unchanged/removed/reordered existing lines all allowed");
}

function testFrontendRuleParity() {
  const frontend = fs.readFileSync(
    path.resolve(__dirname, "../../../frontend/src/billing/billingPlansBulkAddFees.ts"),
    "utf8"
  );
  const backend = fs.readFileSync(path.resolve(__dirname, "billingPlanRecurringGuard.ts"), "utf8");
  const setOf = (src: string) => src.match(/NON_RECURRING_PLAN_FEE_TYPES = new Set\((\[[^\]]+\])\)/)?.[1];
  assert(setOf(frontend) && setOf(frontend) === setOf(backend), "backend and frontend non-recurring type lists identical");
  const guidance = (src: string) => src.match(/ONCE_OFF_FEE_GUIDANCE =\s*\n?\s*('[^']+')/)?.[1];
  assert(guidance(frontend) && guidance(frontend) === guidance(backend), "guidance text identical");
  console.log("✓ backend rule identical to frontend bulk-add rule");
}

function testRoutesGuardBeforeWrites() {
  const src = fs.readFileSync(path.resolve(__dirname, "../routes/learner.ts"), "utf8");
  const patchStart = src.indexOf('router.patch("/:id/billing-plan"');
  const patchGuard = src.indexOf("findBlockedNonRecurringPlanLine", patchStart);
  const patchWrite = src.indexOf("upsertLearnerBillingPlanToDb(", patchStart);
  assert(patchStart > 0 && patchGuard > patchStart && patchGuard < patchWrite, "PATCH billing-plan guards before any plan write");

  const putStart = src.indexOf('router.put("/:id"');
  const putGuard = src.indexOf("findBlockedNonRecurringPlanLine", putStart);
  const putLearnerWrite = src.indexOf("prisma.learner.update(", putStart);
  const putPlanWrite = src.indexOf("upsertLearnerBillingPlanToDb(", putStart);
  assert(putStart > 0 && putGuard > putStart && putGuard < putLearnerWrite && putGuard < putPlanWrite, "PUT learner guards before learner or plan write");
  assert((src.match(/upsertLearnerBillingPlanToDb\(/g) || []).length === 2, "no other plan write path in learner routes");
  console.log("✓ both staff plan-save routes reject before writing anything (422 NON_RECURRING_FEE_ON_BILLING_PLAN)");
}

function main() {
  testTypeResolution();
  testBlocksNewNonRecurringLines();
  testAllowsRecurringAndExistingLines();
  testFrontendRuleParity();
  testRoutesGuardBeforeWrites();
  console.log("billingPlanRecurringGuard.test.ts: OK");
}

main();
