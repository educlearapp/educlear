/**
 * Capture Payment picker: FamilyAccount.id, Fly Eagle name refs, Da Silva codes, MBB.
 * Run: npx tsx src/billing/paymentCreateShared.test.ts
 */
import {
  accountsFromStatementRows,
  formatPaymentAccountLabel,
  paymentAccountMatchesQuery,
} from "./paymentCreateShared";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function testFlyEagleNameAccountsAppear() {
  const rows = [
    {
      accountNo: "ABAYE TUMO ASHANAFY",
      familyAccountId: "fa-abay",
      name: "Ashanafy",
      surname: "Abaye",
      parentName: "Tumo Abaye",
      memberNames: ["Ashanafy Abaye"],
      balance: 1500,
      learnerId: "learner-abay",
    },
  ];
  const learners = [
    {
      id: "learner-abay",
      firstName: "Ashanafy",
      lastName: "Abaye",
      familyAccountId: "fa-abay",
      familyAccount: { id: "fa-abay", accountRef: "ABAYE TUMO ASHANAFY" },
    },
  ];
  const accounts = accountsFromStatementRows(rows, learners);
  assert(accounts.length === 1, "Fly Eagle name account is not dropped");
  assert(accounts[0].familyAccountId === "fa-abay", "picker carries FamilyAccount.id");
  assert(accounts[0].id === "fa-abay", "picker id is FamilyAccount.id");
  assert(accounts[0].accountNo === "ABAYE TUMO ASHANAFY", "human-readable ref displayed");
  console.log("✓ Fly Eagle account without Kid-e-Sys code appears in picker");
}

function testDaSilvaKidESysStillSearchable() {
  const rows = [
    {
      accountNo: "SIL007",
      familyAccountId: "fa-sil007",
      name: "Lee",
      surname: "Silva",
      balance: 400,
      learnerId: "learner-sil",
    },
  ];
  const learners = [
    {
      id: "learner-sil",
      firstName: "Lee",
      lastName: "Silva",
      familyAccountId: "fa-sil007",
      familyAccount: { id: "fa-sil007", accountRef: "SIL007" },
    },
  ];
  const accounts = accountsFromStatementRows(rows, learners);
  assert(accounts.length === 1, "Da Silva Kid-e-Sys account still in picker");
  assert(accounts[0].accountNo === "SIL007", "existing account number displayed");
  assert(accounts[0].familyAccountId === "fa-sil007", "internally FamilyAccount.id");
  console.log("✓ Da Silva existing account number preserved in picker");
}

function testMbbWorks() {
  const rows = [
    {
      accountNo: "MBB012",
      familyAccountId: "fa-mbb",
      name: "Bright",
      surname: "Begin",
      balance: 80,
    },
  ];
  const learners = [
    {
      id: "learner-mbb",
      familyAccountId: "fa-mbb",
      familyAccount: { id: "fa-mbb", accountRef: "MBB012" },
    },
  ];
  const accounts = accountsFromStatementRows(rows, learners);
  assert(accounts.length === 1, "MBB account in picker");
  assert(accounts[0].familyAccountId === "fa-mbb", "MBB FamilyAccount.id");
  assert(accounts[0].accountNo === "MBB012", "MBB account number displayed");
  console.log("✓ Magical Bright Beginnings picker works");
}

function testDropsRowsWithoutFamilyAccountId() {
  const rows = [{ accountNo: "SIL007", name: "Orphan" }];
  const accounts = accountsFromStatementRows(rows, []);
  assert(accounts.length === 0, "cannot pay without canonical FamilyAccount.id");
  console.log("✓ rows without FamilyAccount.id are not selectable");
}

function testSiblingDedupesToOneFamily() {
  const rows = [
    {
      accountNo: "SIL007",
      familyAccountId: "fa-sil007",
      name: "Ann",
      surname: "Silva",
      learnerId: "l1",
    },
    {
      accountNo: "SIL007",
      familyAccountId: "fa-sil007",
      name: "Ben",
      surname: "Silva",
      learnerId: "l2",
    },
  ];
  const learners = [
    { id: "l1", familyAccountId: "fa-sil007", familyAccount: { id: "fa-sil007", accountRef: "SIL007" } },
    { id: "l2", familyAccountId: "fa-sil007", familyAccount: { id: "fa-sil007", accountRef: "SIL007" } },
  ];
  const accounts = accountsFromStatementRows(rows, learners);
  assert(accounts.length === 1, "siblings share one picker row");
  console.log("✓ sibling family is one Capture Payment account");
}

function testFlyEagleEduClearNumberIsSearchableWithoutReplacingJoinKey() {
  const rows = [
    {
      accountNo: "ABAYE TUMO ASHANAFY",
      sourceAccountRef: "ABAYE TUMO ASHANAFY",
      eduClearAccountNo: "ABA001",
      familyAccountId: "fa-abay",
      familyName: "ABAYE TUMO ASHANAFY",
      name: "Ashanafy",
      surname: "Abaye",
      memberNames: ["Ashanafy Abaye"],
      balance: 1500,
      learnerId: "learner-abay",
    },
  ];
  const learners = [
    {
      id: "learner-abay",
      firstName: "Ashanafy",
      lastName: "Abaye",
      familyAccountId: "fa-abay",
      familyAccount: { id: "fa-abay", accountRef: "ABAYE TUMO ASHANAFY", accountNo: "ABA001" },
    },
  ];
  const accounts = accountsFromStatementRows(rows, learners);
  assert(accounts[0].accountNo === "ABAYE TUMO ASHANAFY", "join key remains Express ref");
  assert(accounts[0].eduClearAccountNo === "ABA001", "picker carries EduClear number");
  assert(accounts[0].sourceAccountRef === "ABAYE TUMO ASHANAFY", "source Express ref preserved");
  assert(
    formatPaymentAccountLabel(accounts[0]).startsWith("ABA001"),
    "visible label starts with EduClear number"
  );
  assert(paymentAccountMatchesQuery(accounts[0], "aba001"), "search by EduClear number");
  assert(paymentAccountMatchesQuery(accounts[0], "abaye"), "search by Express/family name");
  assert(paymentAccountMatchesQuery(accounts[0], "ashanafy"), "search by learner name");
  console.log("✓ Fly Eagle picker searches EduClear number and Express name; join key unchanged");
}
testFlyEagleNameAccountsAppear();
testDaSilvaKidESysStillSearchable();
testMbbWorks();
testDropsRowsWithoutFamilyAccountId();
testSiblingDedupesToOneFamily();
testFlyEagleEduClearNumberIsSearchableWithoutReplacingJoinKey();
console.log("\nAll paymentCreateShared picker tests passed.");
