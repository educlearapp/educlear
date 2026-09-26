/**
 * Invoice charge-line snapshot tests (isolated — no production ledger).
 * Run: npx ts-node --transpile-only src/services/invoiceChargeLines.test.ts
 */
import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";

import {
  buildInvoiceChargeLines,
  formatInvoiceChargeDescription,
  formatInvoiceChargeLinesBreakdown,
  invoiceMoneyEqual,
  validateChargeLinesMatchAmount,
} from "./invoiceChargeLines";
import { buildStatementManageTransactions, buildStatementTransactions } from "./statementTransactionBuilder";
import {
  appendSchoolEntriesSafe,
  readSchoolLedger,
  setBillingLedgerStoreDataDirForTests,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import { buildInvoiceRunPlanForTest } from "./invoiceRunExecuteService";

const SCHOOL = "test-school-charge-lines";

function learner(
  id: string,
  firstName: string,
  lastName: string,
  familyAccountId: string | null,
  accountRef: string | null
) {
  return {
    id,
    firstName,
    lastName,
    enrollmentStatus: "ACTIVE",
    admissionNo: null,
    idNumber: null,
    familyAccountId,
    familyAccount: accountRef ? { accountRef } : null,
  };
}

function moneyFmt(n: number) {
  return `R ${n.toFixed(2)}`;
}

function testSingleBillingPlanFee() {
  const built = buildInvoiceChargeLines([{ feeDescription: "PRIMARY 2026", amount: 2500, id: "line-primary" }]);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.total, 2500);
  assert.equal(built.lines.length, 1);
  assert.equal(built.lines[0].description, "PRIMARY 2026");
  assert.equal(built.lines[0].amount, 2500);
  assert.equal(built.lines[0].lineKey, "line-primary");
  assert.equal(formatInvoiceChargeDescription(built.lines), "PRIMARY 2026");
  console.log("✓ TEST 1 — single billing-plan fee");
}

function testMultipleBillingPlanFees() {
  const built = buildInvoiceChargeLines([
    { id: "p1", feeDescription: "PRIMARY 2026", amount: 2500 },
    { id: "p2", feeDescription: "Transport", amount: 750 },
  ]);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.total, 3250);
  assert.equal(built.lines.length, 2);
  assert.deepEqual(
    built.lines.map((l) => l.description),
    ["PRIMARY 2026", "Transport"]
  );
  console.log("✓ TEST 2 — multiple billing-plan fees");
}

function testPlanPlusGraduationExtra() {
  const built = buildInvoiceChargeLines(
    [{ id: "p1", feeDescription: "PRIMARY 2026", amount: 2500 }],
    [{ feeDescription: "Graduation Fee", amount: 500 }]
  );
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.total, 3000);
  assert.equal(built.lines.length, 2);
  assert.equal(built.lines[1].description, "Graduation Fee");
  assert.equal(built.lines[1].amount, 500);
  assert.ok(built.lines[1].lineKey.startsWith("extra:"));
  assert.equal(formatInvoiceChargeDescription(built.lines), "PRIMARY 2026; Graduation Fee");
  console.log("✓ TEST 3 — billing plan + Graduation Fee extra");
}

function testSeveralCharges() {
  const built = buildInvoiceChargeLines(
    [
      { feeDescription: "School Fees", amount: 2500 },
      { feeDescription: "Transport", amount: 750 },
      { feeDescription: "Aftercare", amount: 400 },
    ],
    [{ feeDescription: "Graduation Fee", amount: 500 }]
  );
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.total, 4150);
  assert.equal(built.lines.length, 4);
  console.log("✓ TEST 4 — several charges");
}

function testSnapshotImmutability() {
  const first = buildInvoiceChargeLines([{ id: "same-id", feeDescription: "PRIMARY 2026", amount: 2500 }]);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const snapshotted = first.lines.map((l) => ({ ...l }));

  const renamed = buildInvoiceChargeLines([{ id: "same-id", feeDescription: "PRIMARY 2027", amount: 2500 }]);
  assert.equal(renamed.ok, true);
  if (!renamed.ok) return;

  assert.equal(snapshotted[0].description, "PRIMARY 2026");
  assert.equal(renamed.lines[0].description, "PRIMARY 2027");
  console.log("✓ TEST 5 — snapshot immutability");
}

function testHistoricalCompatibility() {
  const historical: BillingLedgerEntry = {
    id: "inv-legacy",
    schoolId: SCHOOL,
    learnerId: "l1",
    accountNo: "ACC001",
    type: "invoice",
    amount: 2500,
    date: "2026-06-01",
    reference: "INV-LEGACY",
    description: "Invoice Run For June 2026",
    createdAt: new Date().toISOString(),
  };
  assert.equal(historical.chargeLines, undefined);

  const manageRows = buildStatementManageTransactions({
    schoolId: SCHOOL,
    accountRef: "ACC001",
    ledgerEntries: [historical],
    periodFilteredEntries: [historical],
    period: "All Time",
    nameByLearnerId: new Map([["l1", "Test Learner"]]),
  });
  assert.equal(manageRows.length, 1);
  assert.equal(manageRows[0].description, "Invoice Run For June 2026");
  assert.equal(manageRows[0].chargeLines, undefined);
  assert.equal(manageRows[0].amountIn, 2500);

  const pdfRows = buildStatementTransactions({
    schoolId: SCHOOL,
    accountRef: "ACC001",
    ledgerEntries: [historical],
    period: "All Time",
    nameByLearnerId: new Map([["l1", "Test Learner"]]),
  });
  assert.equal(pdfRows[0].description, "Invoice Run For June 2026");
  assert.equal(pdfRows[0].chargeLines, undefined);
  console.log("✓ TEST 6 — historical ledger compatibility");
}

function testTotalMismatchFailSafe() {
  const built = buildInvoiceChargeLines([{ feeDescription: "PRIMARY 2026", amount: 2500 }]);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const mismatch = validateChargeLinesMatchAmount(built.lines, 3000);
  assert.equal(mismatch.ok, false);
  if (mismatch.ok) return;
  assert.ok(/does not match/i.test(mismatch.error));
  console.log("✓ TEST 7 — total mismatch fail-safe");
}

function testStatementApiAndPdfExposeChargeLines() {
  const entry: BillingLedgerEntry = {
    id: "inv-new",
    schoolId: SCHOOL,
    learnerId: "l1",
    accountNo: "ACC001",
    type: "invoice",
    amount: 3000,
    date: "2026-09-01",
    reference: "INV-3000",
    description: "PRIMARY 2026; Graduation Fee",
    chargeLines: [
      { lineKey: "p1", description: "PRIMARY 2026", amount: 2500 },
      { lineKey: "extra:0:Graduation Fee:500.00", description: "Graduation Fee", amount: 500 },
    ],
    createdAt: new Date().toISOString(),
  };

  const manageRows = buildStatementManageTransactions({
    schoolId: SCHOOL,
    accountRef: "ACC001",
    ledgerEntries: [entry],
    periodFilteredEntries: [entry],
    period: "All Time",
    nameByLearnerId: new Map([["l1", "Test Learner"]]),
  });
  assert.equal(manageRows[0].chargeLines?.length, 2);
  assert.equal(manageRows[0].description, "PRIMARY 2026; Graduation Fee");
  assert.equal(manageRows[0].amountIn, 3000);

  const pdfRows = buildStatementTransactions({
    schoolId: SCHOOL,
    accountRef: "ACC001",
    ledgerEntries: [entry],
    period: "All Time",
    nameByLearnerId: new Map([["l1", "Test Learner"]]),
  });
  assert.equal(pdfRows[0].chargeLines?.length, 2);
  assert.ok(pdfRows[0].description.includes("PRIMARY 2026"));
  assert.ok(pdfRows[0].description.includes("Graduation Fee"));
  assert.ok(/2[\s,]?500/.test(pdfRows[0].description), `pdf amount formatting: ${pdfRows[0].description}`);
  assert.equal(pdfRows[0].amountIn, 3000);
  console.log("✓ TEST 8/9 — statement API + PDF expose chargeLines");
}

function testParentPortalShapeExposure() {
  const entry: BillingLedgerEntry = {
    id: "inv-parent",
    schoolId: SCHOOL,
    learnerId: "l1",
    accountNo: "ACC001",
    type: "invoice",
    amount: 3000,
    date: "2026-09-01",
    reference: "INV-P",
    description: "PRIMARY 2026; Graduation Fee",
    chargeLines: [
      { lineKey: "p1", description: "PRIMARY 2026", amount: 2500 },
      { lineKey: "e1", description: "Graduation Fee", amount: 500 },
    ],
    createdAt: new Date().toISOString(),
  };
  const payload = {
    ...entry,
    ...(Array.isArray(entry.chargeLines) && entry.chargeLines.length
      ? {
          chargeLines: entry.chargeLines.map((line) => ({
            lineKey: String(line.lineKey || "").trim(),
            description: String(line.description || "").trim(),
            amount: Number(line.amount) || 0,
          })),
        }
      : {}),
  };
  assert.equal(payload.chargeLines?.length, 2);
  assert.equal(payload.chargeLines?.[1].description, "Graduation Fee");
  console.log("✓ TEST 10 — parent portal chargeLines exposure shape");
}

function testDuplicateProtectionUnchanged() {
  const l1 = learner("dup1", "Dup", "Learner", null, "TST012");
  const existing: BillingLedgerEntry[] = [
    {
      id: "inv-existing",
      schoolId: SCHOOL,
      learnerId: "dup1",
      accountNo: "TST012",
      type: "invoice",
      amount: 2500,
      date: "2026-06-01",
      reference: "INV-EXISTING",
      description: "PRIMARY 2026",
      invoicePeriod: "2026-06",
      chargeLines: [{ lineKey: "p1", description: "PRIMARY 2026", amount: 2500 }],
      createdAt: new Date().toISOString(),
    },
  ];

  const { integrity, learnerRows } = buildInvoiceRunPlanForTest({
    allActiveLearners: [l1],
    processedLearners: [l1],
    plansByLearnerId: { dup1: [{ feeDescription: "PRIMARY 2026", amount: 2500 }] },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { dup1: "TST012" },
    existingLedger: existing,
    invoicePeriod: "2026-06",
  });

  assert.equal(learnerRows[0].skipReason, "DUPLICATE_INVOICE");
  assert.equal(integrity.invoiceLineCount, 0);
  assert.equal(integrity.passed, true);
  console.log("✓ TEST 11 — duplicate protection unchanged with chargeLines present");
}

function testAccountingRegressionSingleInvoiceTotals() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "educlear-charge-lines-"));
  setBillingLedgerStoreDataDirForTests(dataDir);
  try {
    const plan = [
      { id: "p1", feeDescription: "PRIMARY 2026", amount: 2500 },
      { feeDescription: "Graduation Fee", amount: 500 },
    ];
    const snapshot = buildInvoiceChargeLines([plan[0]], [plan[1]]);
    assert.equal(snapshot.ok, true);
    if (!snapshot.ok) return;

    const entry: BillingLedgerEntry = {
      id: "invoice-run-charge-1",
      schoolId: SCHOOL,
      learnerId: "l1",
      accountNo: "ACC001",
      type: "invoice",
      amount: snapshot.total,
      date: "2026-09-01",
      reference: "65001",
      description: formatInvoiceChargeDescription(snapshot.lines),
      runId: "RUN-CHARGE-1",
      invoicePeriod: "2026-09",
      lineKey: "l1",
      billedLearnerId: "l1",
      chargeLines: snapshot.lines,
      createdAt: new Date().toISOString(),
    };

    const before = readSchoolLedger(SCHOOL);
    assert.equal(before.length, 0);

    const batch = appendSchoolEntriesSafe(SCHOOL, [entry]);
    assert.equal(batch.createdCount, 1);
    assert.equal(batch.duplicateCount, 0);

    const after = readSchoolLedger(SCHOOL);
    assert.equal(after.length, 1);
    assert.equal(after[0].amount, 3000);
    assert.equal(after[0].chargeLines?.length, 2);
    assert.equal(after[0].description, "PRIMARY 2026; Graduation Fee");

    // Retry same id — duplicate protection, no second financial invoice
    const retry = appendSchoolEntriesSafe(SCHOOL, [entry]);
    assert.equal(retry.createdCount, 0);
    assert.equal(retry.duplicateCount, 1);
    assert.equal(readSchoolLedger(SCHOOL).length, 1);

    const invoices = after.filter((e) => e.type === "invoice");
    const payments = after.filter((e) => e.type === "payment");
    const credits = after.filter((e) => e.type === "credit");
    assert.equal(invoices.length, 1);
    assert.equal(
      invoices.reduce((s, e) => s + e.amount, 0),
      3000
    );
    assert.equal(payments.length, 0);
    assert.equal(credits.length, 0);
    assert.ok(invoiceMoneyEqual(snapshot.total, entry.amount));
    console.log("✓ TEST 12 — accounting regression (count/total/duplicate)");
  } finally {
    setBillingLedgerStoreDataDirForTests(null);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

function testBreakdownFormatting() {
  const built = buildInvoiceChargeLines(
    [{ feeDescription: "School Fees", amount: 2500 }],
    [{ feeDescription: "Graduation Fee", amount: 500 }]
  );
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const text = formatInvoiceChargeLinesBreakdown(built.lines, moneyFmt);
  assert.ok(text.includes("School Fees — R 2500.00"));
  assert.ok(text.includes("Graduation Fee — R 500.00"));
  console.log("✓ breakdown formatting helper");
}

function main() {
  testSingleBillingPlanFee();
  testMultipleBillingPlanFees();
  testPlanPlusGraduationExtra();
  testSeveralCharges();
  testSnapshotImmutability();
  testHistoricalCompatibility();
  testTotalMismatchFailSafe();
  testStatementApiAndPdfExposeChargeLines();
  testParentPortalShapeExposure();
  testDuplicateProtectionUnchanged();
  testAccountingRegressionSingleInvoiceTotals();
  testBreakdownFormatting();
  console.log("\nAll invoiceChargeLines tests passed.");
}

main();
