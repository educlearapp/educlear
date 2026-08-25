/**
 * Source-agnostic billing summary: Express Invoice names must count; Kid-e-Sys unchanged.
 * Run: npx tsx src/services/billingSummary.statementSource.unit.test.ts
 */
import assert from "assert";
import {
  buildBillingSummaryValidationReport,
  calculateBillingSummary,
  isSummaryEligibleBillingRow,
} from "./billingSummary";
import {
  isKidESysSourceAccountRef,
  isStatementBillingAccountRef,
} from "./daSilvaMigration/ageAnalysisParser";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function testIdentity() {
  assert.strictEqual(isKidESysSourceAccountRef("ALI002"), true);
  assert.strictEqual(isKidESysSourceAccountRef("ABAYE TUMO ASHANAFY"), false);
  assert.strictEqual(isStatementBillingAccountRef("ALI002"), true);
  assert.strictEqual(isStatementBillingAccountRef("MBB001"), true);
  assert.strictEqual(isStatementBillingAccountRef("ABAYE TUMO ASHANAFY"), true);
  assert.strictEqual(isStatementBillingAccountRef("1234567"), false);
  assert.strictEqual(isStatementBillingAccountRef("-"), false);
  assert.strictEqual(isStatementBillingAccountRef("KID-MISSING-1"), false);
  console.log("✓ statement identity helpers");
}

function testExpressSummary() {
  const rows = [
    { accountNo: "ABAYE TUMO ASHANAFY", balance: 233040, status: "Recently Owing" },
    { accountNo: "CREDIT FAMILY", balance: -46285.1, status: "Over Paid" },
    { accountNo: "ZERO FAMILY", balance: 0, status: "Paid Up" },
    { accountNo: "1234567", balance: 50, status: "Recently Owing" },
    { accountNo: "-", balance: 10, status: "Recently Owing" },
  ];
  assert.strictEqual(rows.filter(isSummaryEligibleBillingRow).length, 3);
  const summary = calculateBillingSummary(rows);
  assert.strictEqual(summary.accountsCount, 3);
  assert.strictEqual(round2(summary.totalOutstanding), 186754.9);
  assert.strictEqual(round2(summary.recentlyOwing), 233040);
  assert.strictEqual(round2(summary.overPaid), -46285.1);
  assert.strictEqual(round2(summary.badDebt), 0);
  const credit = rows.find((r) => r.accountNo === "CREDIT FAMILY");
  assert.ok(credit && credit.balance < 0, "negative credit preserved on source row");
  console.log("✓ Express Invoice names appear in summary with owing/credits/net");
}

function testKidESysRegression() {
  const daSilva = [
    { accountNo: "ALI002", balance: 4000, status: "Recently Owing" },
    { accountNo: "DUP001", balance: -12200, status: "Over Paid" },
  ];
  const magical = [
    { accountNo: "MBB001", balance: 2100, status: "Recently Owing" },
    { accountNo: "MBB002", balance: 0, status: "Paid Up" },
  ];
  const daSummary = calculateBillingSummary(daSilva);
  const magSummary = calculateBillingSummary(magical);
  assert.strictEqual(daSummary.accountsCount, 2);
  assert.strictEqual(round2(daSummary.overPaid), -12200);
  assert.strictEqual(magSummary.accountsCount, 2);
  assert.strictEqual(round2(magSummary.recentlyOwing), 2100);
  console.log("✓ Da Silva and Magical Kid-e-Sys summary unchanged");
}

function testValidationExcludedReason() {
  const report = buildBillingSummaryValidationReport("school-express-migrated", [
    { accountNo: "ABAYE TUMO ASHANAFY", balance: 100, status: "Recently Owing" },
    { accountNo: "1234567", balance: 50, status: "Recently Owing" },
  ]);
  assert.ok(report.includedAccounts.some((a) => a.accountNo === "ABAYE TUMO ASHANAFY"));
  const excluded = report.excludedAccounts.find((a) => a.accountNo === "1234567");
  assert.ok(excluded, "SA-SAMS numeric excluded");
  assert.strictEqual(excluded?.reason, "not a statement billing accountRef");
  console.log("✓ summary-validation includes Express and excludes SA-SAMS");
}

function testSchoolIsolationByRows() {
  const mixed = [
    { accountNo: "ALI002", balance: 1, status: "Recently Owing" },
    { accountNo: "ABAYE TUMO ASHANAFY", balance: 2, status: "Recently Owing" },
  ];
  const summary = calculateBillingSummary(mixed);
  assert.strictEqual(summary.accountsCount, 2, "both source systems count when present");
  assert.strictEqual(round2(summary.recentlyOwing), 3);
  console.log("✓ source-system independence: mixed refs both count");
}

function run() {
  testIdentity();
  testExpressSummary();
  testKidESysRegression();
  testValidationExcludedReason();
  testSchoolIsolationByRows();
  console.log("\nbillingSummary.statementSource.unit.test.ts: all passed");
}

run();
