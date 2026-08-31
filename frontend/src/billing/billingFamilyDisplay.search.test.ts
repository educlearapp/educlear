/**
 * Statements search: dedicated accountNo, accountRef / family name, learner name.
 * Fly Eagle dual identity + Da Silva / MBB regression.
 * Run: npx tsx src/billing/billingFamilyDisplay.search.test.ts
 */
import { buildBillingRowSearchText } from "./billingFamilyDisplay";
import { mapApiStatementRowToBillingAccountRow } from "./billingLedger";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function search(row: unknown, query: string): boolean {
  return buildBillingRowSearchText(row).includes(String(query || "").toLowerCase().trim());
}

function testFlyEagleSearchIncludesDualIdentityAndLearnerName() {
  const row = mapApiStatementRowToBillingAccountRow({
    accountNo: "ABAYE TUMO ASHANAFY",
    eduClearAccountNo: "ABA001",
    sourceAccountRef: "ABAYE TUMO ASHANAFY",
    familyName: "ABAYE TUMO ASHANAFY",
    familyAccountId: "fa-abay",
    name: "Ashanafy",
    surname: "Abaye",
    memberNames: ["Ashanafy Abaye"],
    accountHolder: "ABAYE TUMO ASHANAFY",
    balance: 1500,
    status: "Recently Owing",
  });
  assert(row.accountNo === "ABAYE TUMO ASHANAFY", "join key on the row remains Express accountRef");
  assert(row.eduClearAccountNo === "ABA001", "mapper keeps dedicated accountNo");
  assert(search(row, "aba001"), "search by dedicated accountNo");
  assert(search(row, "abaye tumo ashanafy"), "search by accountRef / family name");
  assert(search(row, "ashanafy"), "search by learner name");
  assert(search(row, "abaye"), "search by learner surname / family");
  console.log("✓ Fly Eagle statements search: accountNo, Express name, learner name");
}

function testDaSilvaSearchUnchanged() {
  const row = mapApiStatementRowToBillingAccountRow({
    accountNo: "ALI002",
    eduClearAccountNo: "ALI002",
    sourceAccountRef: "ALI002",
    familyAccountId: "fa-ali",
    name: "Ali",
    surname: "Learner",
    memberNames: ["Ali Learner"],
    balance: 4000,
    status: "Recently Owing",
  });
  assert(search(row, "ali002"), "Da Silva still searchable by Kid-e-Sys number");
  assert(search(row, "ali"), "Da Silva still searchable by learner name");
  assert(row.accountNo === "ALI002", "Da Silva accountNo unchanged");
  console.log("✓ Da Silva statements search regression");
}

function testMbbSearchUnchanged() {
  const row = mapApiStatementRowToBillingAccountRow({
    accountNo: "MBB001",
    eduClearAccountNo: "MBB001",
    sourceAccountRef: "MBB001",
    familyAccountId: "fa-mbb",
    name: "Magical",
    surname: "Child",
    memberNames: ["Magical Child"],
    balance: 2100,
    status: "Recently Owing",
  });
  assert(search(row, "mbb001"), "MBB still searchable by Kid-e-Sys number");
  assert(search(row, "magical"), "MBB still searchable by learner name");
  assert(row.accountNo === "MBB001", "MBB accountNo unchanged");
  console.log("✓ Magical Bright Beginnings statements search regression");
}

function testCapturePaymentDestinationUnchangedOnStatementRow() {
  const row = mapApiStatementRowToBillingAccountRow({
    accountNo: "ABAYE TUMO ASHANAFY",
    eduClearAccountNo: "ABA001",
    familyAccountId: "fa-abay",
    name: "Ashanafy",
    surname: "Abaye",
  });
  assert(row.familyAccountId === "fa-abay", "Capture Payment destination remains FamilyAccount.id");
  console.log("✓ statement row still carries FamilyAccount.id for Capture Payment");
}

function run() {
  testFlyEagleSearchIncludesDualIdentityAndLearnerName();
  testDaSilvaSearchUnchanged();
  testMbbSearchUnchanged();
  testCapturePaymentDestinationUnchangedOnStatementRow();
  console.log("\nAll billingFamilyDisplay.search tests passed.");
}

run();
