/**
 * Invoice run execute service tests (pure logic + isolated ledger write check).
 * Run: npx ts-node --transpile-only src/services/invoiceRunExecute.test.ts
 */
import fs from "fs";
import os from "os";
import path from "path";

import {
  buildInvoiceRunPlanForTest,
  evaluateLearnerEligibility,
  findReviewedPreviewDrift,
  sumBillingPlanAmount,
  validateIntegrityGate,
} from "./invoiceRunExecuteService";
import {
  applyFeeFrequencyExclusionGuard,
  feeExclusionAliasesForSchool,
} from "./invoiceFeeFrequencyExclusion";
import {
  appendSchoolEntriesSafe,
  buildInvoiceRunEntryId,
  learnerHasInvoiceForPeriod,
  normalizeInvoicePeriod,
  readSchoolLedger,
  setBillingLedgerStoreDataDirForTests,
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


/**
 * Fly Eagle Dec-2026 failure shape: scoped execute of N invoiced learners while other
 * eligible single-learner families remain active school-wide. Those out-of-scope families
 * must not trip sibling validation — but Create Invoices preview-lock must still catch
 * omissions before writes.
 */
function testScopedRunIgnoresUnrelatedEligibleFamiliesOutsideScope() {
  const inScope = learner("scope-1", "In", "Scope", "fam-scope", "SCOPE001");
  const maja = learner("cmt7tnqzi00vuilml0k7sua16", "Amogelang", "MAJA", "fam-maja", "MAJA AMOGELANG CONNY CAIRO");
  const smith = learner("cmt7to88o0186ilmlo5akd4tv", "Avuzwa", "SMITH", "fam-smith", "SMITH AVUZWA");
  const keagile = learner(
    "cmt7tnx1u0106ilml809sxanv",
    "Leballa",
    "KEAGILE",
    "fam-keagile",
    "KEAGILE LEBALLA OTSHEPENG"
  );
  const { accounts, integrity, learnerRows } = buildInvoiceRunPlanForTest({
    allActiveLearners: [inScope, maja, smith, keagile],
    processedLearners: [inScope],
    plansByLearnerId: {
      "scope-1": plan(1800),
      [maja.id]: plan(1400),
      [smith.id]: plan(1450),
      [keagile.id]: plan(1400),
    },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: {
      "scope-1": "SCOPE001",
      [maja.id]: "MAJA AMOGELANG CONNY CAIRO",
      [smith.id]: "SMITH AVUZWA",
      [keagile.id]: "KEAGILE LEBALLA OTSHEPENG",
    },
    existingLedger: [],
    invoicePeriod: "2026-12",
  });

  assert(learnerRows.length === 1 && learnerRows[0].status === "invoiced", "scoped row invoiced");
  assert(integrity.passed, "out-of-scope eligible families must not fail scoped integrity");
  assert(integrity.eligibleCount === 1, "integrity counts only scoped rows");
  assert(
    accounts.every((account) => account.siblingValidationPassed),
    "no sibling issues for untouched families"
  );
  assert(
    !accounts.some((account) =>
      (account.issues || []).some((issue) => /missing from run scope/i.test(issue))
    ),
    "reported Fly Eagle missing-from-scope false positive is gone"
  );
  console.log("✓ scoped run ignores unrelated eligible families outside scope");
}

/**
 * Fly Eagle Dec-2026: full reviewed preview must include Maja R1,400, Smith R1,450,
 * Leballa Keagile R1,400. Fly Eagle has no December plan-description alias allowlist.
 */
function testFullDecemberPreviewIncludesFlyEagleFlaggedLearners() {
  const other = learner("other-1", "Other", "Learner", "fam-other", "OTHER001");
  const maja = learner("cmt7tnqzi00vuilml0k7sua16", "Amogelang", "MAJA", "fam-maja", "MAJA AMOGELANG CONNY CAIRO");
  const smith = learner("cmt7to88o0186ilmlo5akd4tv", "Avuzwa", "SMITH", "fam-smith", "SMITH AVUZWA");
  const keagile = learner(
    "cmt7tnx1u0106ilml809sxanv",
    "Leballa",
    "KEAGILE",
    "fam-keagile",
    "KEAGILE LEBALLA OTSHEPENG"
  );
  const all = [other, maja, smith, keagile];
  const MAJA_DEC = 1400;
  const SMITH_DEC = 1450;
  const KEAGILE_DEC = 1400;
  const fixturePlans = {
    "other-1": plan(1800),
    [maja.id]: plan(MAJA_DEC),
    [smith.id]: plan(SMITH_DEC),
    [keagile.id]: plan(KEAGILE_DEC),
  };
  const { learnerRows, integrity } = buildInvoiceRunPlanForTest({
    allActiveLearners: all,
    processedLearners: all,
    plansByLearnerId: fixturePlans,
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: {
      "other-1": "OTHER001",
      [maja.id]: "MAJA AMOGELANG CONNY CAIRO",
      [smith.id]: "SMITH AVUZWA",
      [keagile.id]: "KEAGILE LEBALLA OTSHEPENG",
    },
    existingLedger: [],
    invoicePeriod: "2026-12",
  });

  assert(integrity.passed, "full December preview integrity passes");
  for (const flagged of [maja, smith, keagile]) {
    const row = learnerRows.find((item) => item.learnerId === flagged.id);
    assert(Boolean(row), `${flagged.firstName} reaches preview learner rows`);
    assert(row?.status === "invoiced", `${flagged.firstName} selected for December`);
    assert(
      row?.amount === fixturePlans[flagged.id][0].amount,
      `${flagged.firstName} fixture amount follows billing plan`
    );
  }
  assert(integrity.invoiceLineCount === 4, "all four billable learners invoiced");

  const flyEagle = "cmt1e8bjp0jo8lcjeketlynhl";
  assert(
    feeExclusionAliasesForSchool(flyEagle).length === 0,
    "Fly Eagle has no December plan-description alias allowlist"
  );
  const decGuard = applyFeeFrequencyExclusionGuard({
    planItems: [
      { feeDescription: "Tuition", amount: MAJA_DEC },
      { feeDescription: "School fees", amount: SMITH_DEC },
      { feeDescription: "Fees", amount: KEAGILE_DEC },
    ],
    catalogue: [
      { id: "fee-aftercare", name: "Aftercare", amount: 550, type: "MONTHLY_EXCL_DEC" },
      { id: "fee-tuition", name: "Tuition", amount: MAJA_DEC, type: "MONTHLY" },
    ],
    invoicePeriod: "2026-12",
    schoolId: flyEagle,
  });
  assert(decGuard.planItems.length === 3, "December keeps all three screenshot plan amounts");
  assert(
    sumBillingPlanAmount(decGuard.planItems) === MAJA_DEC + SMITH_DEC + KEAGILE_DEC,
    "December applicable total is R1,400 + R1,450 + R1,400"
  );
  assert(
    MAJA_DEC + SMITH_DEC + KEAGILE_DEC === 4250,
    "combined December charge for the three learners is R4,250"
  );
  const threeTotal = [maja, smith, keagile]
    .map((flagged) => learnerRows.find((row) => row.learnerId === flagged.id)?.amount || 0)
    .reduce((sum, amount) => sum + amount, 0);
  assert(threeTotal === 4250, "preview learner rows combine to R4,250");
  console.log("✓ full December preview includes Fly Eagle flagged learners");
}


/**
 * Reproduces the live Fly Eagle Dec-2026 Create Invoices failure path:
 * reviewed preview / execute learnerIds omitted Maja/Smith/Keagile (428 scoped,
 * three missing), while school-wide eligibility still sees them as billable.
 * Sibling-only scoping would pass and silently omit them; preview-lock must
 * refuse writes until a fresh complete preview is reviewed.
 */
function testPreviewToExecuteOmitsFlyEagleLearnersRequiresFreshPreview() {
  const inScopeA = learner("scope-a", "In", "A", "fam-a", "A001");
  const inScopeB = learner("scope-b", "In", "B", "fam-b", "B001");
  const maja = learner("cmt7tnqzi00vuilml0k7sua16", "Amogelang", "MAJA", "fam-maja", "MAJA AMOGELANG CONNY CAIRO");
  const smith = learner("cmt7to88o0186ilmlo5akd4tv", "Avuzwa", "SMITH", "fam-smith", "SMITH AVUZWA");
  const keagile = learner(
    "cmt7tnx1u0106ilml809sxanv",
    "Leballa",
    "KEAGILE",
    "fam-keagile",
    "KEAGILE LEBALLA OTSHEPENG"
  );
  const all = [inScopeA, inScopeB, maja, smith, keagile];
  const plans = {
    "scope-a": plan(1800),
    "scope-b": plan(1800),
    [maja.id]: plan(1400),
    [smith.id]: plan(1450),
    [keagile.id]: plan(1400),
  };
  const accounts = {
    "scope-a": "A001",
    "scope-b": "B001",
    [maja.id]: "MAJA AMOGELANG CONNY CAIRO",
    [smith.id]: "SMITH AVUZWA",
    [keagile.id]: "KEAGILE LEBALLA OTSHEPENG",
  };

  // 1) Fresh full-school preview (no learnerIds narrowing) includes the three.
  const preview = buildInvoiceRunPlanForTest({
    allActiveLearners: all,
    processedLearners: all,
    plansByLearnerId: plans,
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: accounts,
    existingLedger: [],
    invoicePeriod: "2026-12",
  });
  assert(preview.integrity.passed, "fresh preview integrity passes");
  const previewInvoiced = preview.learnerRows.filter((row) => row.status === "invoiced");
  const previewIds = previewInvoiced.map((row) => row.learnerId);
  for (const flagged of [maja, smith, keagile]) {
    assert(previewIds.includes(flagged.id), `fresh preview includes ${flagged.firstName}`);
  }
  const expectedAmounts = Object.fromEntries(
    previewInvoiced.map((row) => [row.learnerId, Number(row.amount) || 0])
  );
  assert(
    expectedAmounts[maja.id] + expectedAmounts[smith.id] + expectedAmounts[keagile.id] === 4250,
    "fresh preview locks R4,250 for the three learners"
  );

  // 2) Live failure shape: execute scoped to incomplete preview (missing the three).
  const incompleteScope = previewIds.filter(
    (id) => id !== maja.id && id !== smith.id && id !== keagile.id
  );
  const incompletePlan = buildInvoiceRunPlanForTest({
    allActiveLearners: all,
    processedLearners: all.filter((learner) => incompleteScope.includes(learner.id)),
    plansByLearnerId: plans,
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: accounts,
    existingLedger: [],
    invoicePeriod: "2026-12",
  });
  assert(incompletePlan.integrity.passed, "sibling-scope alone would pass incomplete execute");
  assert(
    !incompletePlan.learnerRows.some((row) =>
      [maja.id, smith.id, keagile.id].includes(row.learnerId)
    ),
    "incomplete execute rows omit the three — the live dropout"
  );

  const eligibilityByLearnerId = new Map(
    all.map((learner) => {
      const row = preview.learnerRows.find((item) => item.learnerId === learner.id)!;
      return [
        learner.id,
        {
          billableEligible: row.status === "invoiced",
          status: row.status,
          amount: row.amount || 0,
          skipReason: row.skipReason,
        },
      ] as const;
    })
  );
  const drift = findReviewedPreviewDrift({
    allActiveLearners: all,
    eligibilityByLearnerId: eligibilityByLearnerId as any,
    scopedLearnerIds: incompleteScope,
    excludedLearnerIds: new Set(),
    expectedAmountsByLearnerId: Object.fromEntries(
      incompleteScope.map((id) => [id, expectedAmounts[id]])
    ),
  });
  assert(
    drift.missingEligibleLearnerIds.includes(maja.id) &&
      drift.missingEligibleLearnerIds.includes(smith.id) &&
      drift.missingEligibleLearnerIds.includes(keagile.id),
    "preview-lock catches the three omitted billable learners before writes"
  );

  // 3) Complete reviewed preview lock matches execute scope and amounts.
  const completeDrift = findReviewedPreviewDrift({
    allActiveLearners: all,
    eligibilityByLearnerId: eligibilityByLearnerId as any,
    scopedLearnerIds: previewIds,
    excludedLearnerIds: new Set(),
    expectedAmountsByLearnerId: expectedAmounts,
  });
  assert(completeDrift.missingEligibleLearnerIds.length === 0, "complete lock has no omissions");
  assert(completeDrift.amountMismatchLearnerIds.length === 0, "complete lock has no amount drift");
  assert(
    completeDrift.unexpectedScopedLearnerIds.length === 0,
    "complete lock has no unexpected extras"
  );
  console.log("✓ preview-to-execute omission requires fresh preview (Fly Eagle Dec path)");
}

function testReviewedPreviewDriftCatchesOmissionsAndAmountChanges() {
  const a = learner("a1", "A", "One", "fam-a", "A001");
  const b = learner("b1", "B", "Two", "fam-b", "B001");
  const c = learner("c1", "C", "Three", "fam-c", "C001");
  const eligibilityByLearnerId = new Map([
    [a.id, { billableEligible: true, status: "invoiced" as const, amount: 1400 }],
    [b.id, { billableEligible: true, status: "invoiced" as const, amount: 1450 }],
    [c.id, { billableEligible: true, status: "invoiced" as const, amount: 1400 }],
  ]);

  const incomplete = findReviewedPreviewDrift({
    allActiveLearners: [a, b, c],
    eligibilityByLearnerId,
    scopedLearnerIds: [a.id, b.id],
    excludedLearnerIds: new Set(),
    expectedAmountsByLearnerId: { [a.id]: 1400, [b.id]: 1450 },
  });
  assert(
    incomplete.missingEligibleLearnerIds.includes(c.id),
    "stale preview missing Keagile-shaped learner is caught"
  );

  const amountDrift = findReviewedPreviewDrift({
    allActiveLearners: [a, b, c],
    eligibilityByLearnerId,
    scopedLearnerIds: [a.id, b.id, c.id],
    excludedLearnerIds: new Set(),
    expectedAmountsByLearnerId: { [a.id]: 1400, [b.id]: 999, [c.id]: 1400 },
  });
  assert(
    amountDrift.amountMismatchLearnerIds.includes(b.id),
    "amount change vs reviewed preview is caught"
  );

  const withExclusion = findReviewedPreviewDrift({
    allActiveLearners: [a, b, c],
    eligibilityByLearnerId,
    scopedLearnerIds: [a.id, b.id],
    excludedLearnerIds: new Set([c.id]),
    expectedAmountsByLearnerId: { [a.id]: 1400, [b.id]: 1450 },
  });
  assert(
    withExclusion.missingEligibleLearnerIds.length === 0,
    "intentional exclusion is not treated as stale omission"
  );
  console.log("✓ reviewed preview drift catches omissions and amount changes");
}

function testOperatorExclusionRespectedInSiblingGroup() {
  const fam = "fam-excl";
  const l1 = learner("ex1", "Keep", "One", fam, "EX001");
  const l2 = learner("ex2", "Drop", "Two", fam, "EX001");
  const excludedRows = [
    {
      learnerId: l1.id,
      learnerName: "Keep One",
      accountNo: "EX001",
      status: "invoiced" as const,
      amount: 1000,
      billingGroupKey: `family:${fam}`,
    },
    {
      learnerId: l2.id,
      learnerName: "Drop Two",
      accountNo: "EX001",
      status: "skipped" as const,
      amount: 0,
      skipReason: "EXCLUDED_BY_OPERATOR" as const,
      billingGroupKey: `family:${fam}`,
    },
  ];
  const gate = validateIntegrityGate(excludedRows, [
    {
      accountNo: "EX001",
      billingGroupKey: `family:${fam}`,
      activeCount: 2,
      eligibleCount: 1,
      invoicedCount: 1,
      skippedCount: 1,
      expectedTotal: 1000,
      actualTotal: 1000,
      siblingValidationPassed: true,
    },
  ]);
  assert(gate.passed, "operator exclusion keeps integrity when sibling skipped explicitly");
  console.log("✓ operator exclusion respected in sibling group");
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
    normalizeInvoicePeriod("November 2026", "2026-10-19") === "2026-11",
    "normalize November 2026"
  );
  assert(normalizeInvoicePeriod("December 2026") === "2026-12", "normalize December 2026");
  assert(normalizeInvoicePeriod("January 2027") === "2027-01", "year boundary January 2027");
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

function testSiblingDuplicateAfterAnchorRelink() {
  const fam = "fam-sibling-dup";
  const anchor = "anchor1";
  const sibling = "sibling2";
  const l1 = learner(anchor, "Anchor", "Child", fam, "FAM100");
  const l2 = learner(sibling, "Sibling", "Child", fam, "FAM100");
  const existing: BillingLedgerEntry[] = [
    {
      id: "inv-sibling-posted",
      schoolId: TEST_SCHOOL,
      learnerId: anchor,
      billedLearnerId: sibling,
      lineKey: sibling,
      accountNo: "FAM100",
      type: "invoice",
      amount: 1200,
      date: "2026-06-01",
      reference: "INV-SIB",
      description: "Invoice Run June 2026",
      invoicePeriod: PERIOD,
      runId: "RUN-SIB-TEST",
      createdAt: new Date().toISOString(),
    },
  ];

  assert(
    learnerHasInvoiceForPeriod(existing, sibling, PERIOD),
    "sibling duplicate: billedLearnerId match after anchor posting"
  );
  assert(
    !learnerHasInvoiceForPeriod(existing, anchor, PERIOD),
    "sibling duplicate: anchor not duplicate unless billed"
  );

  const { learnerRows, integrity } = buildInvoiceRunPlanForTest({
    allActiveLearners: [l1, l2],
    processedLearners: [l1, l2],
    plansByLearnerId: { anchor1: plan(1000), sibling2: plan(1200) },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { anchor1: "FAM100", sibling2: "FAM100" },
    existingLedger: existing,
    invoicePeriod: PERIOD,
  });

  const siblingRow = learnerRows.find((row) => row.learnerId === sibling);
  assert(siblingRow?.skipReason === "DUPLICATE_INVOICE", "sibling duplicate: skip sibling");
  assert(integrity.invoiceLineCount === 1, "sibling duplicate: only anchor invoices");
  assert(integrity.passed, "sibling duplicate: integrity pass");
  console.log("✓ sibling duplicate after anchor relink (billedLearnerId)");
}

function testSiblingThreeDuplicateAfterExecute() {
  const fam = "fam-three-dup";
  const ids = ["t3a", "t3b", "t3c"];
  const learners3 = ids.map((id, i) => learner(id, `Child${i}`, "Three", fam, "FAM300"));
  const existing: BillingLedgerEntry[] = ids.map((id, i) => ({
    id: `inv-${id}`,
    schoolId: TEST_SCHOOL,
    learnerId: ids[0],
    billedLearnerId: id,
    lineKey: id,
    accountNo: "FAM300",
    type: "invoice" as const,
    amount: 1000 + i * 100,
    date: "2026-06-01",
    reference: `INV-${i}`,
    description: "Invoice Run June 2026",
    invoicePeriod: PERIOD,
    runId: "RUN-THREE",
    createdAt: new Date().toISOString(),
  }));

  const { learnerRows, integrity } = buildInvoiceRunPlanForTest({
    allActiveLearners: learners3,
    processedLearners: learners3,
    plansByLearnerId: Object.fromEntries(ids.map((id) => [id, plan(1000)])),
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: Object.fromEntries(ids.map((id) => [id, "FAM300"])),
    existingLedger: existing,
    invoicePeriod: PERIOD,
  });

  assert(
    learnerRows.every((row) => row.status === "skipped" && row.skipReason === "DUPLICATE_INVOICE"),
    "three siblings: all duplicate after execute"
  );
  assert(integrity.invoiceLineCount === 0, "three siblings: zero new lines");
  assert(integrity.eligibleCount === 3, "three siblings: all eligible bucket");
  assert(integrity.passed, "three siblings: integrity pass");
  console.log("✓ three siblings all duplicate after execute");
}

function testInactiveLearnerExcludedFromDuplicateRerun() {
  const l1 = learner("inactive1", "Inactive", "Learner", null, "TST099", "HISTORICAL");
  const { learnerRows, integrity } = buildInvoiceRunPlanForTest({
    allActiveLearners: [l1],
    processedLearners: [l1],
    plansByLearnerId: { inactive1: plan(1000) },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { inactive1: "TST099" },
    existingLedger: [],
    invoicePeriod: PERIOD,
  });
  assert(learnerRows[0].skipReason === "INACTIVE_LEARNER", "inactive excluded");
  assert(integrity.invoiceLineCount === 0, "inactive: no invoice lines");
  console.log("✓ inactive learner exclusion");
}

function testUnrelatedAccountUnaffectedBySiblingDuplicate() {
  const fam = "fam-unrelated";
  const l1 = learner("sibA", "Sib", "A", fam, "FAM400");
  const l2 = learner("sibB", "Sib", "B", fam, "FAM400");
  const other = learner("other1", "Other", "Account", null, "OTH001");
  const existing: BillingLedgerEntry[] = [
    {
      id: "inv-sibA",
      schoolId: TEST_SCHOOL,
      learnerId: "sibA",
      billedLearnerId: "sibA",
      lineKey: "sibA",
      accountNo: "FAM400",
      type: "invoice",
      amount: 1000,
      date: "2026-06-01",
      reference: "INV-A",
      description: "June",
      invoicePeriod: PERIOD,
      createdAt: new Date().toISOString(),
    },
  ];

  const { learnerRows } = buildInvoiceRunPlanForTest({
    allActiveLearners: [l1, l2, other],
    processedLearners: [l1, l2, other],
    plansByLearnerId: { sibA: plan(1000), sibB: plan(1000), other1: plan(800) },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { sibA: "FAM400", sibB: "FAM400", other1: "OTH001" },
    existingLedger: existing,
    invoicePeriod: PERIOD,
  });

  assert(
    learnerRows.find((row) => row.learnerId === "sibA")?.skipReason === "DUPLICATE_INVOICE",
    "unrelated: sibling A duplicate"
  );
  assert(
    learnerRows.find((row) => row.learnerId === "sibB")?.status === "invoiced",
    "unrelated: sibling B still invoices"
  );
  assert(
    learnerRows.find((row) => row.learnerId === "other1")?.status === "invoiced",
    "unrelated: other account invoices"
  );
  console.log("✓ unrelated account unaffected by sibling duplicate");
}

function testFlyEagleExpressNameEligibilityExcludesUnlinked() {
  const linked = learner(
    "fe-linked",
    "Happy",
    "Wolde",
    "fa-wolde",
    "WOLDE HAPPY BLESSING"
  );
  const unlinked = learner("fe-unlinked", "Sydney", "Mhondiwa", null, null);
  const { learnerRows, integrity } = buildInvoiceRunPlanForTest({
    allActiveLearners: [linked, unlinked],
    processedLearners: [linked, unlinked],
    plansByLearnerId: { "fe-linked": plan(1400), "fe-unlinked": plan(1400) },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { "fe-linked": "WOLDE HAPPY BLESSING", "fe-unlinked": "" },
    existingLedger: [],
    invoicePeriod: "2026-08",
  });

  const linkedRow = learnerRows.find((row) => row.learnerId === "fe-linked");
  const unlinkedRow = learnerRows.find((row) => row.learnerId === "fe-unlinked");
  assert(linkedRow?.status === "invoiced", "linked Express family account is eligible");
  assert(linkedRow?.accountNo === "WOLDE HAPPY BLESSING", "Express accountRef posted");
  assert(unlinkedRow?.status === "skipped", "unlinked learner skipped");
  assert(unlinkedRow?.skipReason === "ACCOUNT_NOT_FOUND", "unlinked skip reason");
  assert(
    !learnerRows.some((row) => row.accountNo === "OLD FAMILY"),
    "historical-only account is not invoiced — it is not an active learner"
  );
  assert(integrity.passed, "express eligibility integrity");
  console.log("✓ Fly Eagle Express name eligible; unlinked/historical excluded");
}

function testDuplicatePeriodOnExpressHistory() {
  const linked = learner("fe-dup", "Happy", "Wolde", "fa-wolde", "WOLDE HAPPY BLESSING");
  const existing: BillingLedgerEntry[] = [
    {
      id: "fe-inv-july",
      schoolId: TEST_SCHOOL,
      learnerId: "fe-dup",
      accountNo: "WOLDE HAPPY BLESSING",
      type: "invoice",
      amount: 1400,
      date: "2026-07-15",
      reference: "0220534",
      description: "Express invoice 0220534",
      createdAt: "2026-08-24T22:45:16.463Z",
      source: "universal_migration_phase14",
    },
  ];
  const july = buildInvoiceRunPlanForTest({
    allActiveLearners: [linked],
    processedLearners: [linked],
    plansByLearnerId: { "fe-dup": plan(1400) },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { "fe-dup": "WOLDE HAPPY BLESSING" },
    existingLedger: existing,
    invoicePeriod: "2026-07",
  });
  assert(
    july.learnerRows[0]?.skipReason === "DUPLICATE_INVOICE",
    "July Express history blocks another July invoice run"
  );

  const august = buildInvoiceRunPlanForTest({
    allActiveLearners: [linked],
    processedLearners: [linked],
    plansByLearnerId: { "fe-dup": plan(1400) },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { "fe-dup": "WOLDE HAPPY BLESSING" },
    existingLedger: existing,
    invoicePeriod: "2026-08",
  });
  assert(august.learnerRows[0]?.status === "invoiced", "August run is not a July duplicate");
  console.log("✓ duplicate protection keeps Express period history");
}

function testPreviewRouteStaysReadOnly() {
  const route = fs.readFileSync(path.join(process.cwd(), "src/routes/invoiceRuns.ts"), "utf8");
  assert(route.includes('router.post("/preview", requireInvoiceRunPreviewAuth'), "preview uses preview auth");
  assert(
    route.includes("handleExecute(req, res, true)"),
    "preview forces dryRun and cannot follow a client dryRun flag"
  );
  console.log("✓ preview route is forced read-only");
}

function testIsolatedRetryDoesNotDuplicateOrTouchPayments() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "educlear-invoice-run-"));
  setBillingLedgerStoreDataDirForTests(dir);
  try {
    for (const schoolId of ["isolated-fly-eagle", "isolated-da-silva"]) {
      const entry: BillingLedgerEntry = {
        id: buildInvoiceRunEntryId("run-nov-2026", "learner-1", "FAM001", "learner-1"),
        schoolId,
        learnerId: "learner-1",
        accountNo: "FAM001",
        type: "invoice",
        amount: 1800,
        date: "2026-11-01",
        dueDate: "2026-11-03",
        reference: "INV-NOV",
        description: "Tuition",
        runId: "run-nov-2026",
        invoicePeriod: "2026-11",
        lineKey: "learner-1",
        billedLearnerId: "learner-1",
        createdAt: "2026-11-01T00:00:00.000Z",
      };
      const first = appendSchoolEntriesSafe(schoolId, [entry]);
      const retry = appendSchoolEntriesSafe(schoolId, [entry]);
      const rows = readSchoolLedger(schoolId);
      assert(first.createdCount === 1 && first.duplicateCount === 0, `${schoolId} first post creates one invoice`);
      assert(retry.createdCount === 0 && retry.duplicateCount === 1, `${schoolId} retry is a duplicate`);
      assert(rows.filter((row) => row.type === "invoice").length === 1, `${schoolId} still has one invoice`);
      assert(rows.every((row) => row.type !== "payment"), `${schoolId} created no payments`);
    }
    console.log("✓ isolated Fly Eagle and Da Silva retries do not duplicate invoices or create payments");
  } finally {
    setBillingLedgerStoreDataDirForTests(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testNovemberPreviewPlanDoesNotMutateLedger() {
  const before = fs.existsSync(LEDGER_FILE) ? fs.readFileSync(LEDGER_FILE) : Buffer.alloc(0);
  const period = normalizeInvoicePeriod("November 2026", "2026-10-19");
  const linked = learner("fe-nov", "November", "Learner", "fa-nov", "FAMILY NAME");
  const preview = buildInvoiceRunPlanForTest({
    allActiveLearners: [linked],
    processedLearners: [linked],
    plansByLearnerId: { "fe-nov": plan(1800) },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { "fe-nov": "FAMILY NAME" },
    existingLedger: [],
    invoicePeriod: period,
  });
  assert(preview.learnerRows[0]?.status === "invoiced", "November preview invoices the learner");
  assert(preview.integrity.passed, "November preview integrity passes");
  assert(preview.learnerRows[0]?.amount === 1800, "November preview amount");

  const already: BillingLedgerEntry[] = [
    {
      id: "fe-inv-nov",
      schoolId: TEST_SCHOOL,
      learnerId: "fe-nov",
      accountNo: "FAMILY NAME",
      type: "invoice",
      amount: 1800,
      date: "2026-11-01",
      invoicePeriod: "2026-11",
      reference: "NOV",
      description: "November",
      createdAt: "2026-11-01T00:00:00.000Z",
    },
  ];
  const duplicate = buildInvoiceRunPlanForTest({
    allActiveLearners: [linked],
    processedLearners: [linked],
    plansByLearnerId: { "fe-nov": plan(1800) },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { "fe-nov": "FAMILY NAME" },
    existingLedger: already,
    invoicePeriod: period,
  });
  assert(duplicate.learnerRows[0]?.skipReason === "DUPLICATE_INVOICE", "November duplicate stays protected");

  const after = fs.existsSync(LEDGER_FILE) ? fs.readFileSync(LEDGER_FILE) : Buffer.alloc(0);
  assert(before.equals(after), "November preview plan does not change billing-ledger.json");
  console.log("✓ November preview plans without creating invoices or payments");
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
  testSiblingDuplicateAfterAnchorRelink();
  testSiblingThreeDuplicateAfterExecute();
  testInactiveLearnerExcludedFromDuplicateRerun();
  testUnrelatedAccountUnaffectedBySiblingDuplicate();
  testFlyEagleExpressNameEligibilityExcludesUnlinked();
  testDuplicatePeriodOnExpressHistory();
  testNovemberPreviewPlanDoesNotMutateLedger();
  testPreviewRouteStaysReadOnly();
  testIsolatedRetryDoesNotDuplicateOrTouchPayments();
  testFailedIntegrityGateSiblingMissed();
  testScopedRunIgnoresUnrelatedEligibleFamiliesOutsideScope();
  testFullDecemberPreviewIncludesFlyEagleFlaggedLearners();
  testPreviewToExecuteOmitsFlyEagleLearnersRequiresFreshPreview();
  testReviewedPreviewDriftCatchesOmissionsAndAmountChanges();
  testOperatorExclusionRespectedInSiblingGroup();
  await testIntegrityFailureWritesNothing();
  console.log("invoiceRunExecute.test.ts: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
