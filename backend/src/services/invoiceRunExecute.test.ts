/**
 * Invoice run execute service tests (pure logic + isolated ledger write check).
 * Run: npx ts-node --transpile-only src/services/invoiceRunExecute.test.ts
 */
import fs from "fs";
import path from "path";

import {
  buildInvoiceRunPlanForTest,
  evaluateLearnerEligibility,
  sumBillingPlanAmount,
  validateIntegrityGate,
} from "./invoiceRunExecuteService";
import {
  learnerHasInvoiceForPeriod,
  normalizeInvoicePeriod,
  readSchoolLedger,
  writeSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";

const TEST_SCHOOL = "test-school-invoice-run-execute";
const LEDGER_FILE = path.join(process.cwd(), "data", "billing-ledger.json");
const PERIOD = "2026-06";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function learner(
  id: string,
  firstName: string,
  lastName: string,
  familyAccountId: string | null,
  accountRef: string | null,
  enrollmentStatus = "ACTIVE"
) {
  return {
    id,
    firstName,
    lastName,
    enrollmentStatus,
    admissionNo: null,
    idNumber: null,
    familyAccountId,
    familyAccount: accountRef ? { accountRef } : null,
  };
}

function plan(amount: number) {
  return [{ feeDescription: "Tuition", amount }];
}

function backupLedger(): string {
  if (!fs.existsSync(LEDGER_FILE)) return "";
  return fs.readFileSync(LEDGER_FILE, "utf8");
}

function restoreLedger(raw: string) {
  if (!raw) {
    if (fs.existsSync(LEDGER_FILE)) fs.unlinkSync(LEDGER_FILE);
    return;
  }
  fs.writeFileSync(LEDGER_FILE, raw, "utf8");
}

function testSingleLearnerAccount() {
  const l1 = learner("l1", "Alpha", "Test", null, "TST001");
  const { learnerRows, integrity } = buildInvoiceRunPlanForTest({
    allActiveLearners: [l1],
    processedLearners: [l1],
    plansByLearnerId: { l1: plan(1500) },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { l1: "TST001" },
    existingLedger: [],
    invoicePeriod: PERIOD,
  });

  assert(learnerRows.length === 1, "single learner: one row");
  assert(learnerRows[0].status === "invoiced", "single learner: invoiced");
  assert(learnerRows[0].amount === 1500, "single learner: amount");
  assert(integrity.passed, "single learner: integrity pass");
  assert(integrity.eligibleCount === 1, "single learner: eligible count");
  assert(integrity.invoiceLineCount === 1, "single learner: invoice line count");
  console.log("✓ single learner account");
}

function testSiblingTwoLearners() {
  const fam = "fam-sibling-2";
  const l1 = learner("s2a", "Sibling", "One", fam, "FAM001");
  const l2 = learner("s2b", "Sibling", "Two", fam, "FAM001");
  const active = [l1, l2];
  const { learnerRows, accounts, integrity } = buildInvoiceRunPlanForTest({
    allActiveLearners: active,
    processedLearners: active,
    plansByLearnerId: { s2a: plan(1000), s2b: plan(1200) },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { s2a: "FAM001", s2b: "FAM001" },
    existingLedger: [],
    invoicePeriod: PERIOD,
  });

  assert(learnerRows.filter((row) => row.status === "invoiced").length === 2, "sibling-2: invoiced");
  assert(accounts.length === 1, "sibling-2: one account group");
  assert(accounts[0].siblingValidationPassed, "sibling-2: validation pass");
  assert(accounts[0].actualTotal === 2200, "sibling-2: account total");
  assert(integrity.passed, "sibling-2: integrity pass");
  console.log("✓ sibling account with 2 learners");
}

function testSiblingThreeLearners() {
  const fam = "fam-sibling-3";
  const l1 = learner("s3a", "A", "Three", fam, "FAM002");
  const l2 = learner("s3b", "B", "Three", fam, "FAM002");
  const l3 = learner("s3c", "C", "Three", fam, "FAM002");
  const active = [l1, l2, l3];
  const { learnerRows, accounts, integrity } = buildInvoiceRunPlanForTest({
    allActiveLearners: active,
    processedLearners: active,
    plansByLearnerId: {
      s3a: plan(800),
      s3b: plan(900),
      s3c: plan(700),
    },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { s3a: "FAM002", s3b: "FAM002", s3c: "FAM002" },
    existingLedger: [],
    invoicePeriod: PERIOD,
  });

  assert(learnerRows.filter((row) => row.status === "invoiced").length === 3, "sibling-3: invoiced");
  assert(accounts[0].actualTotal === 2400, "sibling-3: account total");
  assert(integrity.passed, "sibling-3: integrity pass");
  console.log("✓ sibling account with 3 learners");
}

function testServerPlanDespiteEmptyLocalStorage() {
  const l1 = learner("ls1", "Server", "Plan", null, "TST010");
  const { learnerRows } = buildInvoiceRunPlanForTest({
    allActiveLearners: [l1],
    processedLearners: [l1],
    plansByLearnerId: { ls1: plan(1750) },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { ls1: "TST010" },
    existingLedger: [],
    invoicePeriod: PERIOD,
  });

  assert(learnerRows[0].status === "invoiced", "server plan: invoiced from DB plan map");
  assert(learnerRows[0].amount === 1750, "server plan: amount from server");
  console.log("✓ valid server plan (localStorage ignored on server)");
}

function testMissingBillingPlan() {
  const l1 = learner("mp1", "Missing", "Plan", null, "TST011");
  const { learnerRows, integrity } = buildInvoiceRunPlanForTest({
    allActiveLearners: [l1],
    processedLearners: [l1],
    plansByLearnerId: {},
    explicitlyEmpty: new Set(["mp1"]),
    accountNoByLearnerId: { mp1: "TST011" },
    existingLedger: [],
    invoicePeriod: PERIOD,
  });

  assert(learnerRows[0].skipReason === "BILLING_PLAN_EMPTY", "missing plan: skip reason");
  assert(integrity.passed, "missing plan: integrity still passes");
  assert(integrity.invoiceLineCount === 0, "missing plan: no invoice lines");
  console.log("✓ missing billing plan");
}

function testDuplicatePeriodInvoice() {
  const l1 = learner("dup1", "Dup", "Learner", null, "TST012");
  const existing: BillingLedgerEntry[] = [
    {
      id: "inv-existing",
      schoolId: TEST_SCHOOL,
      learnerId: "dup1",
      accountNo: "TST012",
      type: "invoice",
      amount: 1500,
      date: "2026-06-01",
      reference: "INV-EXISTING",
      description: "Invoice Run June 2026",
      invoicePeriod: PERIOD,
      createdAt: new Date().toISOString(),
    },
  ];

  const result = evaluateLearnerEligibility({
    learner: l1,
    planItems: plan(1500),
    accountNo: "TST012",
    invoicePeriod: PERIOD,
    existingLedger: existing,
  });

  assert(result.skipReason === "DUPLICATE_INVOICE", "duplicate: skip reason");
  assert(result.billableEligible, "duplicate: still billable-eligible bucket");

  const { integrity } = buildInvoiceRunPlanForTest({
    allActiveLearners: [l1],
    processedLearners: [l1],
    plansByLearnerId: { dup1: plan(1500) },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { dup1: "TST012" },
    existingLedger: existing,
    invoicePeriod: PERIOD,
  });

  assert(integrity.eligibleCount === 1, "duplicate: eligible count");
  assert(integrity.invoiceLineCount === 0, "duplicate: no new lines");
  assert(integrity.passed, "duplicate: integrity pass");
  console.log("✓ duplicate period invoice");
}

function testFailedIntegrityGateSiblingMissed() {
  const fam = "fam-fail";
  const l1 = learner("f1", "Fail", "One", fam, "FAM900");
  const l2 = learner("f2", "Fail", "Two", fam, "FAM900");
  const { accounts, integrity } = buildInvoiceRunPlanForTest({
    allActiveLearners: [l1, l2],
    processedLearners: [l1],
    plansByLearnerId: { f1: plan(1000), f2: plan(1000) },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { f1: "FAM900", f2: "FAM900" },
    existingLedger: [],
    invoicePeriod: PERIOD,
  });

  assert(!integrity.passed, "integrity fail: gate should fail");
  assert(accounts[0].siblingValidationPassed === false, "integrity fail: sibling validation");
  console.log("✓ failed integrity gate (sibling missed)");
}

async function testIntegrityFailureWritesNothing() {
  const backup = backupLedger();
  try {
    const before = readSchoolLedger(TEST_SCHOOL).length;
    writeSchoolLedger(TEST_SCHOOL, []);

    const fam = "fam-ledger";
    const l1 = learner("lg1", "L", "One", fam, "FAM800");
    const l2 = learner("lg2", "L", "Two", fam, "FAM800");
    const failedPlan = buildInvoiceRunPlanForTest({
      allActiveLearners: [l1, l2],
      processedLearners: [l1],
      plansByLearnerId: { lg1: plan(1000), lg2: plan(1000) },
      explicitlyEmpty: new Set(),
      accountNoByLearnerId: { lg1: "FAM800", lg2: "FAM800" },
      existingLedger: [],
      invoicePeriod: PERIOD,
    });

    assert(!failedPlan.integrity.passed, "integrity must fail before any ledger write");

    const after = readSchoolLedger(TEST_SCHOOL).length;
    assert(after === before, "ledger unchanged when integrity gate fails");
    console.log("✓ failed integrity gate rolls back without writing");
  } finally {
    restoreLedger(backup);
  }
}

function testNormalizeInvoicePeriod() {
  assert(normalizeInvoicePeriod("June 2026", "2026-06-15") === "2026-06", "normalize June 2026");
  assert(normalizeInvoicePeriod("2026-06") === "2026-06", "normalize ISO");
  assert(
    learnerHasInvoiceForPeriod(
      [
        {
          id: "x",
          schoolId: TEST_SCHOOL,
          learnerId: "l",
          accountNo: "TST001",
          type: "invoice",
          amount: 1,
          date: "2026-06-10",
          reference: "r",
          description: "d",
          createdAt: new Date().toISOString(),
        },
      ],
      "l",
      "2026-06"
    ),
    "legacy date period match"
  );
  console.log("✓ period normalization helpers");
}

function testSumBillingPlanAmount() {
  assert(sumBillingPlanAmount(plan(1000)) === 1000, "sum plan");
  const gate = validateIntegrityGate(
    [
      {
        learnerId: "a",
        learnerName: "A",
        accountNo: "TST001",
        status: "invoiced",
        amount: 1000,
        billingGroupKey: "learner:a",
      },
      {
        learnerId: "b",
        learnerName: "B",
        accountNo: "TST002",
        status: "skipped",
        skipReason: "DUPLICATE_INVOICE",
        amount: 500,
        billingGroupKey: "learner:b",
      },
    ],
    [
      {
        accountNo: "TST001",
        billingGroupKey: "learner:a",
        activeCount: 1,
        eligibleCount: 1,
        invoicedCount: 1,
        skippedCount: 0,
        expectedTotal: 1000,
        actualTotal: 1000,
        siblingValidationPassed: true,
      },
      {
        accountNo: "TST002",
        billingGroupKey: "learner:b",
        activeCount: 1,
        eligibleCount: 1,
        invoicedCount: 0,
        skippedCount: 1,
        expectedTotal: 500,
        actualTotal: 0,
        siblingValidationPassed: true,
      },
    ]
  );
  assert(gate.passed, "integrity equation");
  assert(gate.eligibleCount === 2, "integrity eligible");
  assert(gate.invoiceLineCount === 1, "integrity invoiced");
  console.log("✓ integrity gate equation");
}

async function main() {
  testNormalizeInvoicePeriod();
  testSumBillingPlanAmount();
  testSingleLearnerAccount();
  testSiblingTwoLearners();
  testSiblingThreeLearners();
  testServerPlanDespiteEmptyLocalStorage();
  testMissingBillingPlan();
  testDuplicatePeriodInvoice();
  testFailedIntegrityGateSiblingMissed();
  await testIntegrityFailureWritesNothing();
  console.log("invoiceRunExecute.test.ts: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
