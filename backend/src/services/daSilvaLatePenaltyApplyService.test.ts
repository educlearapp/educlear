/**
 * Da Silva late penalty apply tests — in-memory ledger only (no billing-ledger.json writes).
 * Run: npx ts-node --transpile-only src/services/daSilvaLatePenaltyApplyService.test.ts
 */
import { DA_SILVA_ACADEMY_SCHOOL_ID } from "./activateDaSilvaSubscription";
import {
  evaluateDaSilvaPenaltyAccount,
  type DaSilvaBillingPlanFee,
  type DaSilvaPenaltyAccountInput,
  type DaSilvaPenaltyLearner,
} from "./daSilvaLatePenaltyEngine";
import {
  applySelectedDaSilvaPenaltyRows,
  buildDaSilvaPenaltyLedgerEntry,
  penaltyMonthToLedgerDate,
  resolveAnchorLearnerId,
  type DaSilvaPenaltyApplyAppendFn,
} from "./daSilvaLatePenaltyApplyService";
import type { BillingLedgerEntry } from "../utils/billingLedgerStore";

const MBB_SCHOOL_ID = "cmq4xjckq00at60gqg4eb956h";
const PENALTY_MONTH = "2026-07";
const OTHER_MONTH = "2026-08";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function monthlyFee(amount: number): DaSilvaBillingPlanFee {
  return {
    feeDescription: "School Fee",
    amount,
    type: "Monthly Fee",
    frequency: "MONTHLY",
  };
}

function learner(id: string, fees: DaSilvaBillingPlanFee[]): DaSilvaPenaltyLearner {
  return { id, enrollmentStatus: "ACTIVE", planFees: fees };
}

function account(
  accountRef: string,
  outstandingBalance: number,
  learners: DaSilvaPenaltyLearner[]
): DaSilvaPenaltyAccountInput {
  return { accountRef, outstandingBalance, learners };
}

function buildRow(
  accountRef: string,
  outstanding: number,
  fee: number,
  opts: { penaltyMonth?: string; appliedKeys?: string[]; schoolId?: string } = {}
) {
  return evaluateDaSilvaPenaltyAccount({
    schoolId: opts.schoolId || DA_SILVA_ACADEMY_SCHOOL_ID,
    penaltyMonth: opts.penaltyMonth || PENALTY_MONTH,
    appliedIdempotencyKeys: opts.appliedKeys,
    account: account(accountRef, outstanding, [learner("l1", [monthlyFee(fee)])]),
  });
}

function memoryAppend(initial: BillingLedgerEntry[] = []): {
  ledger: BillingLedgerEntry[];
  append: DaSilvaPenaltyApplyAppendFn;
} {
  const ledger = [...initial];
  const append: DaSilvaPenaltyApplyAppendFn = (entry) => {
    const existing = ledger.find((row) => row.id === entry.id);
    if (existing) {
      return { entry: existing, created: false, duplicateReason: "id" };
    }
    ledger.push(entry);
    return { entry, created: true };
  };
  return { ledger, append };
}

function runApply(
  selected: string[],
  rows: ReturnType<typeof buildRow>[],
  accounts: DaSilvaPenaltyAccountInput[],
  append: DaSilvaPenaltyApplyAppendFn,
  schoolId = DA_SILVA_ACADEMY_SCHOOL_ID,
  penaltyMonth = PENALTY_MONTH
) {
  const authoritativeRowsByRef = new Map(rows.map((row) => [row.accountRef, row]));
  const anchorLearnerByRef = new Map(
    accounts.map((acct) => [acct.accountRef, resolveAnchorLearnerId(acct)])
  );
  return applySelectedDaSilvaPenaltyRows({
    schoolId,
    penaltyMonth,
    selectedAccountRefs: selected,
    authoritativeRowsByRef,
    anchorLearnerByRef,
    appendEntry: append,
  });
}

function testSelectedAccountPostsOnce() {
  const acc = account("SEL001", 7200, [learner("l1", [monthlyFee(3000)])]);
  const row = buildRow("SEL001", 7200, 3000);
  const { ledger, append } = memoryAppend();

  const result = runApply(["SEL001"], [row], [acc], append);
  assert(result.postedCount === 1, "one posted");
  assert(result.totalPostedAmount === 720, "posted R720");
  assert(ledger.length === 1, "one ledger row");
  assert(ledger[0].amount === 720, "authoritative amount on ledger");
  assert(ledger[0].type === "penalty", "penalty type");
  console.log("✓ selected account posts once");
}

function testUntickedAccountNotPosted() {
  const accA = account("A001", 7200, [learner("l1", [monthlyFee(3000)])]);
  const accB = account("B001", 5000, [learner("l2", [monthlyFee(2000)])]);
  const rowA = buildRow("A001", 7200, 3000);
  const rowB = buildRow("B001", 5000, 2000);
  const { ledger, append } = memoryAppend();

  const result = runApply(["A001"], [rowA, rowB], [accA, accB], append);
  assert(result.postedCount === 1, "only selected posted");
  assert(ledger.length === 1, "one ledger entry");
  assert(ledger[0].accountNo === "A001", "only A001 posted");
  console.log("✓ unticked account is not posted");
}

function testAlreadyAppliedSkipped() {
  const row = buildRow("DUP001", 12200, 3000);
  const acc = account("DUP001", 12200, [learner("l1", [monthlyFee(3000)])]);
  const existing = buildDaSilvaPenaltyLedgerEntry({
    schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
    row,
    anchorLearnerId: "l1",
    penaltyAmount: row.penaltyAmount,
  });
  const { ledger, append } = memoryAppend([existing]);

  const authoritative = evaluateDaSilvaPenaltyAccount({
    schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
    penaltyMonth: PENALTY_MONTH,
    appliedIdempotencyKeys: [row.idempotencyKey],
    account: acc,
  });

  const result = runApply(["DUP001"], [authoritative], [acc], append);
  assert(result.postedCount === 0, "nothing new posted");
  assert(result.skippedCount === 1, "skipped already applied");
  assert(result.rows[0].reason === "already_applied", "already_applied reason");
  assert(ledger.length === 1, "ledger unchanged count");
  console.log("✓ already-applied account skipped");
}

function testSecondApplySameMonthNoDuplicate() {
  const acc = account("IDM001", 7200, [learner("l1", [monthlyFee(3000)])]);
  const row = buildRow("IDM001", 7200, 3000);
  const { ledger, append } = memoryAppend();

  const first = runApply(["IDM001"], [row], [acc], append);
  assert(first.postedCount === 1, "first apply posts");

  const second = runApply(["IDM001"], [row], [acc], append);
  assert(second.postedCount === 0, "second apply posts nothing");
  assert(second.skippedCount === 1, "second apply skipped");
  assert(second.rows[0].reason === "already_applied", "duplicate id treated as already applied");
  assert(ledger.length === 1, "still one ledger row");
  console.log("✓ second apply same month creates no duplicate");
}

function testDifferentMonthAllowed() {
  const acc = account("MON001", 7200, [learner("l1", [monthlyFee(3000)])]);
  const julyRow = buildRow("MON001", 7200, 3000, { penaltyMonth: PENALTY_MONTH });
  const augustRow = buildRow("MON001", 7200, 3000, { penaltyMonth: OTHER_MONTH });
  const { ledger, append } = memoryAppend();

  const july = runApply(["MON001"], [julyRow], [acc], append, DA_SILVA_ACADEMY_SCHOOL_ID, PENALTY_MONTH);
  assert(july.postedCount === 1, "July posted");

  const august = runApply(
    ["MON001"],
    [augustRow],
    [acc],
    append,
    DA_SILVA_ACADEMY_SCHOOL_ID,
    OTHER_MONTH
  );
  assert(august.postedCount === 1, "August posted");
  assert(ledger.length === 2, "two month keys on ledger");
  console.log("✓ different month allowed");
}

function testIneligibleBetweenPreviewAndApplySkipped() {
  const acc = account("CHG001", 7200, [learner("l1", [monthlyFee(3000)])]);
  const staleEligible = buildRow("CHG001", 7200, 3000);
  const authoritativeIneligible = evaluateDaSilvaPenaltyAccount({
    schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
    penaltyMonth: PENALTY_MONTH,
    account: account("CHG001", 3000, [learner("l1", [monthlyFee(3000)])]),
  });
  assert(!authoritativeIneligible.eligible, "now ineligible");
  const { append } = memoryAppend();

  const result = runApply(["CHG001"], [authoritativeIneligible], [acc], append);
  assert(result.postedCount === 0, "not posted");
  assert(result.rows[0].reason === "balance_not_above_threshold", "skipped ineligible");
  assert(staleEligible.penaltyAmount === 720, "stale preview would have been R720");
  console.log("✓ account ineligible at apply time is skipped");
}

function testFrontendTamperedAmountIgnored() {
  const acc = account("TAM001", 7200, [learner("l1", [monthlyFee(3000)])]);
  const row = buildRow("TAM001", 7200, 3000);
  const tampered = { ...row, penaltyAmount: 99999 };
  const { ledger, append } = memoryAppend();

  const result = runApply(["TAM001"], [tampered], [acc], append);
  assert(result.postedCount === 1, "posted");
  assert(ledger[0].amount === 720, "ledger uses recalculated 10%, not tampered frontend amount");
  console.log("✓ frontend-tampered amount ignored");
}

function testSiblingAccountPostsOnePenaltyOnly() {
  const learners = [learner("l1", [monthlyFee(4560)]), learner("l2", [monthlyFee(4560)])];
  const acc = account("MAK020", 10000, learners);
  const row = evaluateDaSilvaPenaltyAccount({
    schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
    penaltyMonth: PENALTY_MONTH,
    account: acc,
  });
  const { ledger, append } = memoryAppend();

  const result = runApply(["MAK020"], [row], [acc], append);
  assert(result.postedCount === 1, "one penalty for sibling account");
  assert(ledger.length === 1, "one ledger entry");
  assert(ledger[0].amount === 1000, "10% of R10,000");
  console.log("✓ sibling account posts one penalty only");
}

function testMbbBlocked() {
  const acc = account("MBB001", 7200, [learner("l1", [monthlyFee(3000)])]);
  const row = buildRow("MBB001", 7200, 3000, { schoolId: MBB_SCHOOL_ID });
  const { append } = memoryAppend();

  const result = runApply(["MBB001"], [row], [acc], append, MBB_SCHOOL_ID);
  assert(!result.schoolAllowed, "MBB not allowed");
  assert(result.postedCount === 0, "nothing posted");
  assert(result.rows[0].reason === "school_not_allowed", "school_not_allowed");
  console.log("✓ MBB/non-Da Silva blocked");
}

function testMixedBatchCounts() {
  const accEligible = account("OK001", 7200, [learner("l1", [monthlyFee(3000)])]);
  const accIneligible = account("NO001", 3000, [learner("l2", [monthlyFee(3000)])]);
  const accInvalid = account("ZZ999", 7200, [learner("l3", [monthlyFee(3000)])]);
  const rowOk = buildRow("OK001", 7200, 3000);
  const rowNo = buildRow("NO001", 3000, 3000);
  const { append } = memoryAppend();

  const result = runApply(
    ["OK001", "NO001", "MISSING"],
    [rowOk, rowNo],
    [accEligible, accIneligible, accInvalid],
    append
  );
  assert(result.postedCount === 1, "one posted");
  assert(result.skippedCount === 2, "two skipped");
  assert(result.errorCount === 0, "no errors");
  console.log("✓ mixed batch returns posted/skipped counts");
}

function testLedgerUnchangedWhenAllSkipped() {
  const acc = account("NO001", 3000, [learner("l1", [monthlyFee(3000)])]);
  const row = buildRow("NO001", 3000, 3000);
  const { ledger, append } = memoryAppend();

  const result = runApply(["NO001"], [row], [acc], append);
  assert(result.postedCount === 0, "none posted");
  assert(ledger.length === 0, "ledger empty");
  console.log("✓ ledger unchanged when all rows skipped");
}

function testPenaltyMonthLedgerDate() {
  assert(penaltyMonthToLedgerDate("2026-07") === "2026-07-31", "July last day");
  assert(penaltyMonthToLedgerDate("2026-02") === "2026-02-28", "Feb 2026");
  console.log("✓ penalty month ledger date");
}

function run() {
  testSelectedAccountPostsOnce();
  testUntickedAccountNotPosted();
  testAlreadyAppliedSkipped();
  testSecondApplySameMonthNoDuplicate();
  testDifferentMonthAllowed();
  testIneligibleBetweenPreviewAndApplySkipped();
  testFrontendTamperedAmountIgnored();
  testSiblingAccountPostsOnePenaltyOnly();
  testMbbBlocked();
  testMixedBatchCounts();
  testLedgerUnchangedWhenAllSkipped();
  testPenaltyMonthLedgerDate();
  console.log("\ndaSilvaLatePenaltyApplyService.test.ts: all passed");
}

run();
