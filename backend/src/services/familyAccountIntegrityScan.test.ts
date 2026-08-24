/**
 * Read-only integrity scanner tests (no Prisma, no production I/O).
 * Run: npx ts-node --transpile-only src/services/familyAccountIntegrityScan.test.ts
 */
import { scanFamilyAccountIntegrity } from "./familyAccountIntegrityScan";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function testMot682DuplicateWithoutMergeAudit() {
  const result = scanFamilyAccountIntegrity({
    snapshots: {
      MOT682: {
        accountRef: "MOT682",
        accountHolder: "MOTSILANYANE",
        balance: 0,
        source: "educlear-registration",
      },
      MOT684: {
        accountRef: "MOT684",
        accountHolder: "MOTSILANYANE",
        balance: 0,
        source: "educlear-registration",
      },
    },
    familyAccounts: [
      { id: "fa-682", accountRef: "MOT682" },
      { id: "fa-684", accountRef: "MOT684" },
    ],
    learners: [
      {
        id: "reatlegile-historical",
        familyAccountId: "fa-682",
        firstName: "REATLEGILE",
        lastName: "MOTSILANYANE",
        admissionNo: "MOT682",
        idNumber: "20140105",
        birthDate: "2014-05-01T00:00:00.000Z",
        enrollmentStatus: "HISTORICAL",
      },
      {
        id: "reatlegile-active",
        familyAccountId: "fa-684",
        firstName: "REATLEGILE",
        lastName: "MOTSILANYANE",
        admissionNo: "MOT683",
        idNumber: "20140105",
        birthDate: "2014-05-01T00:00:00.000Z",
        enrollmentStatus: "ACTIVE",
      },
      {
        id: "leano",
        familyAccountId: "fa-684",
        firstName: "Leano",
        lastName: "MOTSILANYANE",
        admissionNo: "MOT684",
        idNumber: "1710265277080",
        birthDate: "2017-10-26T00:00:00.000Z",
        enrollmentStatus: "ACTIVE",
      },
    ],
    audit: [],
  });

  const mot682 = result.statementRows.find((row) => row.accountRef === "MOT682");
  const mot684 = result.statementRows.find((row) => row.accountRef === "MOT684");
  assert(mot682?.classification === "CONFIRMED_STALE_PREDECESSOR", "MOT682 detected without merge audit");
  assert(mot682?.supersededByAccountRef === "MOT684", "MOT682 superseded by MOT684");
  assert(mot684?.classification === "ACTIVE_CANONICAL", "MOT684 remains canonical");
  assert(result.counts.CONFIRMED_STALE_PREDECESSOR === 1, "only MOT682 is stale");
  console.log("✓ scanner detects MOT682-style abandoned snapshot without merge audit");
}

function testScannerDoesNotRetire() {
  const snapshots = {
    TMP001: {
      accountRef: "TMP001",
      accountHolder: "Abandoned",
      balance: 0,
      source: "educlear-registration",
    },
    FAM003: {
      accountRef: "FAM003",
      accountHolder: "Canonical",
      balance: 0,
      source: "educlear-registration",
    },
  };
  const result = scanFamilyAccountIntegrity({
    snapshots,
    familyAccounts: [
      { id: "fa-tmp", accountRef: "TMP001" },
      { id: "fa-fam", accountRef: "FAM003" },
    ],
    learners: [
      {
        id: "hist",
        familyAccountId: "fa-tmp",
        firstName: "Ann",
        lastName: "Learner",
        idNumber: "9001010000000",
        birthDate: "2014-05-01",
        enrollmentStatus: "HISTORICAL",
      },
      {
        id: "live",
        familyAccountId: "fa-fam",
        firstName: "Ann",
        lastName: "Learner",
        idNumber: "9001010000000",
        birthDate: "2014-05-01",
        enrollmentStatus: "ACTIVE",
      },
    ],
    audit: [],
  });
  assert(result.statementRows.length === 2, "scan does not drop snapshots");
  assert(!snapshots.TMP001.mergedIntoAccountRef, "scan must not write mergedIntoAccountRef");
  assert(snapshots.FAM003.balance === 0, "scan must not alter canonical snapshot");
  console.log("✓ scanner detects abandoned snapshot but does not retire or rewrite it");
}

function testLek003NotStaleDespiteEarlierWrongWayMerge() {
  const result = scanFamilyAccountIntegrity({
    snapshots: {
      LEK003: { accountRef: "LEK003", accountHolder: "Phetogo Lekgetho Moruledi", balance: 2200 },
      MOR013: { accountRef: "MOR013", accountHolder: "Paballo Moruledi", balance: 9700 },
    },
    familyAccounts: [
      { id: "fa-lek", accountRef: "LEK003" },
      { id: "fa-mor", accountRef: "MOR013" },
    ],
    learners: [
      {
        id: "paballo",
        familyAccountId: "fa-lek",
        firstName: "Paballo",
        lastName: "Moruledi",
        admissionNo: "MOR013",
        enrollmentStatus: "ACTIVE",
      },
      {
        id: "phetogo",
        familyAccountId: "fa-lek",
        firstName: "Phetogo Lekgetho",
        lastName: "Moruledi",
        admissionNo: "LEK003",
        enrollmentStatus: "ACTIVE",
      },
    ],
    audit: [
      {
        action: "merge",
        sourceAccountRef: "MOR013",
        targetAccountRef: "LEK003",
        createdAt: "2026-07-22T10:19:23.327Z",
      },
      {
        action: "merge",
        sourceAccountRef: "LEK003",
        targetAccountRef: "MOR013",
        createdAt: "2026-07-22T10:11:52.874Z",
      },
    ],
  });
  const lek = result.statementRows.find((row) => row.accountRef === "LEK003");
  const mor = result.statementRows.find((row) => row.accountRef === "MOR013");
  assert(lek?.classification === "ACTIVE_CANONICAL", "LEK003 stays canonical despite earlier source audit");
  assert(mor?.classification === "CONFIRMED_STALE_PREDECESSOR", "MOR013 is the stale predecessor");
  assert(result.expectedStatementCountAfterConfirmedRetirement === 1, "only LEK003 remains after MOR013 retirement");
  console.log("✓ scanner keeps LEK003 canonical; MOR013 stale; no extra Moruledi rows");
}

function testSurnameAloneIsNotEvidence() {
  const result = scanFamilyAccountIntegrity({
    snapshots: {
      AAA001: { accountRef: "AAA001", accountHolder: "SMITH", balance: 100 },
      AAA002: { accountRef: "AAA002", accountHolder: "SMITH", balance: 200 },
    },
    familyAccounts: [
      { id: "fa-a", accountRef: "AAA001" },
      { id: "fa-b", accountRef: "AAA002" },
    ],
    learners: [
      {
        id: "ann",
        familyAccountId: "fa-a",
        firstName: "Ann",
        lastName: "Smith",
        idNumber: "1111111111111",
        birthDate: "2010-01-01",
        enrollmentStatus: "ACTIVE",
      },
      {
        id: "bob",
        familyAccountId: "fa-b",
        firstName: "Bob",
        lastName: "Smith",
        idNumber: "2222222222222",
        birthDate: "2011-02-02",
        enrollmentStatus: "ACTIVE",
      },
    ],
    audit: [],
  });
  assert(
    result.statementRows.every((row) => row.classification === "ACTIVE_CANONICAL"),
    "same surname with distinct identities is not stale"
  );
  console.log("✓ scanner does not classify from surname alone");
}

function testHistoricalOnlyWithoutDuplicateIsReview() {
  const result = scanFamilyAccountIntegrity({
    snapshots: {
      MOE008: { accountRef: "MOE008", accountHolder: "Historical", balance: 0 },
    },
    familyAccounts: [{ id: "fa-moe", accountRef: "MOE008" }],
    learners: [
      {
        id: "hist-only",
        familyAccountId: "fa-moe",
        firstName: "Only",
        lastName: "Historical",
        idNumber: "8888888888888",
        birthDate: "2012-03-03",
        enrollmentStatus: "HISTORICAL",
      },
    ],
    ledger: Array.from({ length: 47 }, (_, i) => ({ accountNo: "MOE008", type: "invoice", amount: 0 })),
    audit: [],
  });
  const row = result.statementRows[0];
  assert(row.classification === "REVIEW_REQUIRED", "historical-only without duplicate is REVIEW, not auto-stale");
  console.log("✓ historical-only R0 account without duplicate identity is REVIEW_REQUIRED");
}

testMot682DuplicateWithoutMergeAudit();
testScannerDoesNotRetire();
testLek003NotStaleDespiteEarlierWrongWayMerge();
testSurnameAloneIsNotEvidence();
testHistoricalOnlyWithoutDuplicateIsReview();
console.log("\nAll family-account integrity scan tests passed.");
