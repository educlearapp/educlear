/**
 * New-payment eligibility — orphan FAs excluded; linked FAs kept.
 * Run: npx tsx src/services/paymentAccountEligibility.test.ts
 */
import {
  filterAccountsEligibleForNewPayment,
  isFamilyAccountIdEligibleForNewPayment,
} from "./paymentAccountEligibility";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function testOrphansExcludedLinkedKept() {
  const linked = new Set(["fa-linked", "fa-beyamo"]);
  const rows = [
    {
      familyAccountId: "fa-add001",
      accountNo: "GROOM ADEBO",
      eduClearAccountNo: "ADD001",
      memberLearnerIds: [] as string[],
    },
    {
      familyAccountId: "fa-kay001",
      accountNo: "KAYODE KATLEGO",
      eduClearAccountNo: "KAY001",
      memberLearnerIds: [] as string[],
    },
    {
      familyAccountId: "fa-hir002",
      accountNo: "HIRBORO ANTEFAZA",
      eduClearAccountNo: "HIR002",
      memberLearnerIds: [] as string[],
    },
    {
      familyAccountId: "fa-beyamo",
      accountNo: "BEYAMO DEGAFECHY",
      memberLearnerIds: ["learner-1"],
    },
    {
      familyAccountId: null,
      accountNo: "ORPHAN-NO-FA",
      memberLearnerIds: ["ghost"],
    },
  ];

  assert(!isFamilyAccountIdEligibleForNewPayment("fa-add001", linked), "ADD001 not eligible");
  assert(!isFamilyAccountIdEligibleForNewPayment("fa-kay001", linked), "KAY001 not eligible");
  assert(!isFamilyAccountIdEligibleForNewPayment("fa-hir002", linked), "HIR002 not eligible");
  assert(isFamilyAccountIdEligibleForNewPayment("fa-beyamo", linked), "linked FA eligible");

  const filtered = filterAccountsEligibleForNewPayment(rows, linked);
  assert(filtered.length === 1, "only linked FA remains");
  assert(filtered[0].familyAccountId === "fa-beyamo", "BEYAMO kept");
  assert(
    !filtered.some((r) => ["ADD001", "KAY001", "HIR002"].includes(String(r.eduClearAccountNo || ""))),
    "named orphans absent from payment targets"
  );
  console.log("✓ ADD001/KAY001/HIR002 excluded; linked Fly Eagle account kept");
}

function testEmptyLinkedSetYieldsEmptyPicker() {
  const filtered = filterAccountsEligibleForNewPayment(
    [{ familyAccountId: "fa-x", accountNo: "X" }],
    new Set()
  );
  assert(filtered.length === 0, "no linked FAs → empty payment list");
  console.log("✓ empty linked set yields empty payment account list");
}

testOrphansExcludedLinkedKept();
testEmptyLinkedSetYieldsEmptyPicker();
console.log("\npaymentAccountEligibility.test.ts — PASS");
