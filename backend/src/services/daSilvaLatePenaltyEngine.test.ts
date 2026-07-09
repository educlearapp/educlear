/**
 * Da Silva late penalty engine tests (pure calculation only).
 * Run: npx ts-node --transpile-only src/services/daSilvaLatePenaltyEngine.test.ts
 */
import { DA_SILVA_ACADEMY_SCHOOL_ID } from "./activateDaSilvaSubscription";
import {
  buildDaSilvaPenaltyIdempotencyKey,
  buildDaSilvaPenaltyPreview,
  calculateDaSilvaPenaltyAmount,
  computePenaltyMonthsBehind,
  evaluateDaSilvaPenaltyAccount,
  isDaSilvaLatePenaltySchoolAllowed,
  isOutstandingEligibleForPenalty,
  sumAccountMonthlyRecurringFees,
  verifyDaSilvaPenaltyPreviewRow,
  type DaSilvaBillingPlanFee,
  type DaSilvaPenaltyAccountInput,
  type DaSilvaPenaltyLearner,
} from "./daSilvaLatePenaltyEngine";

const MBB_SCHOOL_ID = "cmq4xjckq00at60gqg4eb956h";
const PENALTY_MONTH = "2026-07";
const OTHER_MONTH = "2026-08";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function monthlyFee(amount: number, description = "School Fee"): DaSilvaBillingPlanFee {
  return {
    feeDescription: description,
    amount,
    type: "Monthly Fee",
    frequency: "MONTHLY",
  };
}

function learner(id: string, fees: DaSilvaBillingPlanFee[], name?: string): DaSilvaPenaltyLearner {
  return {
    id,
    enrollmentStatus: "ACTIVE",
    learnerName: name,
    planFees: fees,
  };
}

function account(
  accountRef: string,
  outstandingBalance: number,
  learners: DaSilvaPenaltyLearner[],
  extra: Partial<DaSilvaPenaltyAccountInput> = {}
): DaSilvaPenaltyAccountInput {
  return {
    accountRef,
    outstandingBalance,
    learners,
    ...extra,
  };
}

function testPenaltyAmountExamples() {
  assert(calculateDaSilvaPenaltyAmount(7200) === 720, "R7,200 → R720");
  assert(calculateDaSilvaPenaltyAmount(23000) === 2300, "R23,000 → R2,300");
  assert(calculateDaSilvaPenaltyAmount(0) === 0, "zero outstanding → no penalty amount");
  assert(calculateDaSilvaPenaltyAmount(-100) === 0, "negative outstanding → no penalty amount");
  console.log("✓ penalty amount examples");
}

function testEligibilityThresholdRules() {
  assert(!isOutstandingEligibleForPenalty(0, 3000), "zero outstanding not eligible");
  assert(!isOutstandingEligibleForPenalty(-50, 3000), "negative outstanding not eligible");
  assert(!isOutstandingEligibleForPenalty(3000, 3000), "equal to threshold not eligible");
  assert(isOutstandingEligibleForPenalty(3000.01, 3000), "just above threshold eligible");
  assert(isOutstandingEligibleForPenalty(7200, 3000), "well above threshold eligible");
  console.log("✓ threshold eligibility rules");
}

function testSiblingThresholdSum() {
  const learners = [
    learner("l1", [monthlyFee(4560, "Primary")], "Sibling A"),
    learner("l2", [monthlyFee(4560, "Primary")], "Sibling B"),
  ];
  assert(sumAccountMonthlyRecurringFees(learners) === 9120, "sibling monthly fees sum to R9,120");

  const row = evaluateDaSilvaPenaltyAccount({
    schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
    penaltyMonth: PENALTY_MONTH,
    account: account("MAK020", 10000, learners, {
      accountHolder: "Makamu Family",
      learnerNames: ["Sibling A", "Sibling B"],
    }),
  });

  assert(row.monthlyFeeThreshold === 9120, "preview row uses combined sibling threshold");
  assert(row.eligible, "combined account above sibling threshold is eligible");
  assert(row.penaltyAmount === 1000, "10% of R10,000 = R1,000");
  console.log("✓ sibling threshold sums learners' monthly fees");
}

function testEligibleAccountPreview() {
  const row = evaluateDaSilvaPenaltyAccount({
    schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
    penaltyMonth: PENALTY_MONTH,
    account: account("ALI002", 7200, [learner("l1", [monthlyFee(3000)])], {
      accountHolder: "Ali Family",
    }),
  });

  assert(row.eligible, "outstanding greater than threshold is eligible");
  assert(row.reason === "eligible", "eligible reason");
  assert(row.penaltyAmount === 720, "eligible account penalty is 10%");
  assert(row.apply, "eligible account can apply");
  assert(!row.alreadyApplied, "not already applied");
  console.log("✓ eligible account preview");
}

function testNotEligibleEqualThreshold() {
  const row = evaluateDaSilvaPenaltyAccount({
    schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
    penaltyMonth: PENALTY_MONTH,
    account: account("TST001", 3000, [learner("l1", [monthlyFee(3000)])]),
  });

  assert(!row.eligible, "equal to threshold is not eligible");
  assert(row.reason === "balance_not_above_threshold", "balance_not_above_threshold reason");
  assert(row.penaltyAmount === 0, "no penalty when not eligible");
  assert(!row.apply, "apply is false");
  console.log("✓ equal threshold not eligible");
}

function testIdempotencyKey() {
  const key = buildDaSilvaPenaltyIdempotencyKey(
    DA_SILVA_ACADEMY_SCHOOL_ID,
    "mak020",
    PENALTY_MONTH
  );
  assert(
    key === `penalty-${DA_SILVA_ACADEMY_SCHOOL_ID}-MAK020-${PENALTY_MONTH}`,
    "accountRef + penaltyMonth idempotency key"
  );
  console.log("✓ idempotency key format");
}

function testAlreadyAppliedSameMonth() {
  const key = buildDaSilvaPenaltyIdempotencyKey(
    DA_SILVA_ACADEMY_SCHOOL_ID,
    "DUP001",
    PENALTY_MONTH
  );

  const row = evaluateDaSilvaPenaltyAccount({
    schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
    penaltyMonth: PENALTY_MONTH,
    appliedIdempotencyKeys: [key],
    account: account("DUP001", 12200, [learner("l1", [monthlyFee(3000)])]),
  });

  assert(row.alreadyApplied, "already applied flag set");
  assert(row.reason === "already_applied", "already_applied reason");
  assert(!row.apply, "cannot apply again same month");
  assert(row.penaltyAmount === 0, "no new penalty amount when already applied");
  console.log("✓ already applied for same accountRef + month");
}

function testDifferentMonthStillAllowed() {
  const julyKey = buildDaSilvaPenaltyIdempotencyKey(
    DA_SILVA_ACADEMY_SCHOOL_ID,
    "DUP001",
    PENALTY_MONTH
  );

  const augustRow = evaluateDaSilvaPenaltyAccount({
    schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
    penaltyMonth: OTHER_MONTH,
    appliedIdempotencyKeys: [julyKey],
    account: account("DUP001", 12200, [learner("l1", [monthlyFee(3000)])]),
  });

  assert(!augustRow.alreadyApplied, "different month is not blocked by July key");
  assert(augustRow.eligible, "August run still eligible");
  assert(augustRow.apply, "August run can apply");
  assert(augustRow.penaltyAmount === 1220, "August penalty still calculated");
  console.log("✓ different month still allowed");
}

function testSchoolNotAllowed() {
  assert(!isDaSilvaLatePenaltySchoolAllowed(MBB_SCHOOL_ID), "MBB school not allowed");
  assert(!isDaSilvaLatePenaltySchoolAllowed("cmpbdigd00001vuzmxnwkbgiu"), "demo school not allowed");
  assert(isDaSilvaLatePenaltySchoolAllowed(DA_SILVA_ACADEMY_SCHOOL_ID), "Da Silva allowed");

  const mbbRow = evaluateDaSilvaPenaltyAccount({
    schoolId: MBB_SCHOOL_ID,
    penaltyMonth: PENALTY_MONTH,
    account: account("MBB001", 10000, [learner("l1", [monthlyFee(2000)])]),
  });
  assert(mbbRow.reason === "school_not_allowed", "MBB preview blocked");
  assert(!mbbRow.apply, "MBB cannot apply");

  const preview = buildDaSilvaPenaltyPreview({
    schoolId: MBB_SCHOOL_ID,
    penaltyMonth: PENALTY_MONTH,
    accounts: [account("MBB001", 10000, [learner("l1", [monthlyFee(2000)])])],
  });
  assert(!preview.schoolAllowed, "MBB preview schoolAllowed false");
  console.log("✓ non-Da Silva / MBB school not allowed");
}

function testOneRowPerAccountInPreview() {
  const preview = buildDaSilvaPenaltyPreview({
    schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
    penaltyMonth: PENALTY_MONTH,
    accounts: [
      account("ACC001", 5000, [learner("l1", [monthlyFee(2000)])]),
      account("ACC002", 8000, [learner("l2", [monthlyFee(2500)])]),
    ],
  });

  assert(preview.rows.length === 2, "one preview row per billing account");
  assert(preview.schoolAllowed, "Da Silva preview allowed");
  console.log("✓ one row per billing account in preview");
}

function testExplanationFields() {
  const row = evaluateDaSilvaPenaltyAccount({
    schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
    penaltyMonth: PENALTY_MONTH,
    account: account("EXP001", 7200, [learner("l1", [monthlyFee(3000)])]),
  });
  assert(row.monthsBehind === 2.4, `monthsBehind = 7200/3000 (got ${row.monthsBehind})`);
  assert(row.penaltyAmount === 720, "penalty 10%");
  assert(row.eligibilityReason.includes("Eligible"), "eligibilityReason is operator-facing");
  assert(row.eligibilityReason.includes("R720"), "eligibilityReason mentions penalty");
  const verification = verifyDaSilvaPenaltyPreviewRow(row);
  assert(verification.matches, `rule verification: ${verification.checks.join("; ")}`);
  console.log("✓ explanation fields and rule verification");
}

function testMonthsBehindEqualThreshold() {
  const row = evaluateDaSilvaPenaltyAccount({
    schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
    penaltyMonth: PENALTY_MONTH,
    account: account("EQ001", 3000, [learner("l1", [monthlyFee(3000)])]),
  });
  assert(row.monthsBehind === 1, "exactly one month behind");
  assert(!row.eligible, "one month exactly is not eligible");
  assert(verifyDaSilvaPenaltyPreviewRow(row).matches, "rule verification for equal threshold");
  console.log("✓ exactly one month fees explanation");
}

function run() {
  testPenaltyAmountExamples();
  testEligibilityThresholdRules();
  testSiblingThresholdSum();
  testEligibleAccountPreview();
  testNotEligibleEqualThreshold();
  testIdempotencyKey();
  testAlreadyAppliedSameMonth();
  testDifferentMonthStillAllowed();
  testSchoolNotAllowed();
  testOneRowPerAccountInPreview();
  testExplanationFields();
  testMonthsBehindEqualThreshold();
  console.log("\ndaSilvaLatePenaltyEngine.test.ts: all passed");
}

run();
