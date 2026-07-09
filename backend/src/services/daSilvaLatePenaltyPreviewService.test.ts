/**
 * Da Silva late penalty preview service tests (read-only assembly).
 * Run: npx ts-node --transpile-only src/services/daSilvaLatePenaltyPreviewService.test.ts
 */
import { DA_SILVA_ACADEMY_SCHOOL_ID } from "./activateDaSilvaSubscription";
import {
  assembleDaSilvaPenaltyAccountInputs,
  buildDaSilvaLatePenaltyPreviewFromSnapshot,
  collectAppliedDaSilvaPenaltyKeys,
  toPreviewOnlyRows,
} from "./daSilvaLatePenaltyPreviewService";
import { buildDaSilvaPenaltyIdempotencyKey } from "./daSilvaLatePenaltyEngine";

const MBB_SCHOOL_ID = "cmq4xjckq00at60gqg4eb956h";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function testCollectAppliedKeys() {
  const month = "2026-07";
  const key = buildDaSilvaPenaltyIdempotencyKey(DA_SILVA_ACADEMY_SCHOOL_ID, "ALI002", month);
  const keys = collectAppliedDaSilvaPenaltyKeys(DA_SILVA_ACADEMY_SCHOOL_ID, [
    {
      id: key,
      schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
      learnerId: "l1",
      accountNo: "ALI002",
      type: "penalty",
      amount: 720,
      date: "2026-07-06",
      reference: "PEN-2026-07",
      description: "Late payment penalty",
      createdAt: "2026-07-06T10:00:00.000Z",
    },
    {
      id: "penalty-legacy-date-slug",
      schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
      learnerId: "l2",
      accountNo: "TST001",
      type: "penalty",
      amount: 300,
      date: "2026-07-06",
      reference: "PEN-2026-07-06",
      description: "Late payment penalty",
      createdAt: "2026-07-06T10:00:00.000Z",
    },
  ]);
  assert(keys.size === 1 && keys.has(key), "only month-based idempotency keys collected");
  console.log("✓ collect applied penalty keys");
}

function testPreviewOnlyRowsNeverApply() {
  const rows = toPreviewOnlyRows([
    {
      accountRef: "ALI002",
      accountHolder: "Ali",
      learnerNames: ["Learner"],
      linkedLearnerCount: 1,
      outstandingBalance: 7200,
      monthlyFeeThreshold: 3000,
      monthsBehind: 2.4,
      penaltyAmount: 720,
      eligible: true,
      reason: "eligible",
      eligibilityReason: "Eligible",
      alreadyApplied: false,
      apply: true,
      idempotencyKey: "x",
      penaltyMonth: "2026-07",
    },
  ]);
  assert(rows[0].apply === false, "preview rows force apply false");
  console.log("✓ preview-only rows block apply");
}

function testSnapshotPreviewMath() {
  const preview = buildDaSilvaLatePenaltyPreviewFromSnapshot({
    schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
    penaltyMonth: "2026-07",
    statementAccounts: [
      {
        accountNo: "ACC7200",
        balance: 7200,
        accountHolder: "Holder A",
        memberLearnerIds: ["l1"],
        memberNames: ["Learner A"],
      },
      {
        accountNo: "ACC23000",
        balance: 23000,
        accountHolder: "Holder B",
        memberLearnerIds: ["l2"],
        memberNames: ["Learner B"],
      },
      {
        accountNo: "ACC3000",
        balance: 3000,
        accountHolder: "Holder C",
        memberLearnerIds: ["l3"],
        memberNames: ["Learner C"],
      },
      {
        accountNo: "OVERPAID",
        balance: -500,
        accountHolder: "Holder D",
        memberLearnerIds: ["l4"],
        memberNames: ["Learner D"],
      },
    ],
    learners: [
      {
        id: "l1",
        enrollmentStatus: "ACTIVE",
        billingPlan: [{ feeDescription: "School Fee", amount: 3000, type: "Monthly Fee", frequency: "MONTHLY" }],
      },
      {
        id: "l2",
        enrollmentStatus: "ACTIVE",
        billingPlan: [{ feeDescription: "School Fee", amount: 4560, type: "Monthly Fee", frequency: "MONTHLY" }],
      },
      {
        id: "l3",
        enrollmentStatus: "ACTIVE",
        billingPlan: [{ feeDescription: "School Fee", amount: 3000, type: "Monthly Fee", frequency: "MONTHLY" }],
      },
      {
        id: "l4",
        enrollmentStatus: "ACTIVE",
        billingPlan: [{ feeDescription: "School Fee", amount: 3000, type: "Monthly Fee", frequency: "MONTHLY" }],
      },
    ],
    ledgerEntries: [],
  });

  const byRef = new Map(preview.rows.map((row) => [row.accountRef, row]));
  assert(byRef.get("ACC7200")?.penaltyAmount === 720, "R7,200 → R720");
  assert(byRef.get("ACC23000")?.penaltyAmount === 2300, "R23,000 → R2,300");
  assert(byRef.get("ACC3000")?.eligible === false, "equal to threshold not eligible");
  assert(byRef.get("OVERPAID")?.reason === "zero_or_negative_balance", "overpaid not eligible");
  assert(preview.applyBlocked && preview.previewOnly, "preview metadata");
  assert(preview.rows.every((row) => row.apply === false), "all rows apply blocked");
  console.log("✓ snapshot preview math and eligibility");
}

function testSiblingThresholdInSnapshot() {
  const preview = buildDaSilvaLatePenaltyPreviewFromSnapshot({
    schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
    penaltyMonth: "2026-07",
    statementAccounts: [
      {
        accountNo: "MAK020",
        balance: 10000,
        accountHolder: "Makamu",
        memberLearnerIds: ["s1", "s2"],
        memberNames: ["Sibling A", "Sibling B"],
      },
    ],
    learners: [
      {
        id: "s1",
        enrollmentStatus: "ACTIVE",
        billingPlan: [{ feeDescription: "Primary", amount: 4560, frequency: "MONTHLY" }],
      },
      {
        id: "s2",
        enrollmentStatus: "ACTIVE",
        billingPlan: [{ feeDescription: "Primary", amount: 4560, frequency: "MONTHLY" }],
      },
    ],
    ledgerEntries: [],
  });

  assert(preview.rows[0].monthlyFeeThreshold === 9120, "sibling threshold combined");
  assert(preview.rows[0].eligible, "above combined threshold");
  console.log("✓ sibling threshold in snapshot preview");
}

function testMbbBlockedInSnapshot() {
  const preview = buildDaSilvaLatePenaltyPreviewFromSnapshot({
    schoolId: MBB_SCHOOL_ID,
    penaltyMonth: "2026-07",
    statementAccounts: [
      {
        accountNo: "MBB001",
        balance: 10000,
        memberLearnerIds: ["m1"],
      },
    ],
    learners: [
      {
        id: "m1",
        enrollmentStatus: "ACTIVE",
        billingPlan: [{ feeDescription: "Fee", amount: 2000, frequency: "MONTHLY" }],
      },
    ],
    ledgerEntries: [],
  });
  assert(!preview.schoolAllowed, "MBB school not allowed");
  assert(preview.rows[0].reason === "school_not_allowed", "MBB row blocked");
  console.log("✓ MBB blocked in snapshot preview");
}

function testAssembleAccountInputs() {
  const inputs = assembleDaSilvaPenaltyAccountInputs({
    statementAccounts: [{ accountNo: "TST001", balance: 5000, memberLearnerIds: ["l1"] }],
    learnersById: new Map([
      [
        "l1",
        {
          id: "l1",
          enrollmentStatus: "ACTIVE",
          firstName: "Test",
          lastName: "Learner",
          billingPlan: [{ feeDescription: "School Fee", amount: 2000 }],
        },
      ],
    ]),
  });
  assert(inputs.length === 1 && inputs[0].accountRef === "TST001", "assemble account input");
  assert(inputs[0].learners[0].planFees[0].amount === 2000, "plan fees mapped");
  console.log("✓ assemble account inputs");
}

function run() {
  testCollectAppliedKeys();
  testPreviewOnlyRowsNeverApply();
  testSnapshotPreviewMath();
  testSiblingThresholdInSnapshot();
  testMbbBlockedInSnapshot();
  testAssembleAccountInputs();
  console.log("\ndaSilvaLatePenaltyPreviewService.test.ts: all passed");
}

run();
