/**
 * MONTHLY_EXCL_DEC / MONTHLY_EXCL_NOV_DEC must omit charges for the invoice-period month.
 * Run: npx tsx src/services/invoiceFeeFrequencyExclusion.test.ts
 */
import {
  DA_SILVA_FEE_EXCLUSION_ALIASES,
  DA_SILVA_PROD_CATALOGUE_NAMES,
  applyFeeFrequencyExclusionGuard,
  findFeeExclusionAlias,
  invoicePeriodCalendarMonth,
  isFeeTypeExcludedForInvoicePeriod,
  matchFeeFrequencyCatalogueEntry,
  resolveAliasCatalogueFees,
  type FeeFrequencyCatalogueEntry,
} from "./invoiceFeeFrequencyExclusion";
import {
  buildInvoiceRunPlanForTest,
  evaluateLearnerEligibility,
} from "./invoiceRunExecuteService";
import { buildInvoiceChargeLines } from "./invoiceChargeLines";
import type { StoredBillingPlanItem } from "../utils/learnerBillingPlanStore";
import { DA_SILVA_BILLING_DATA_SCHOOL_ID } from "./daSilvaSchoolResolve";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

const CATALOGUE: FeeFrequencyCatalogueEntry[] = [
  { id: "fee-tuition", name: "Tuition", amount: 2800, type: "MONTHLY" },
  { id: "fee-aftercare", name: "Aftercare", amount: 550, type: "MONTHLY_EXCL_DEC" },
  { id: "fee-transport", name: "Transport", amount: 700, type: "MONTHLY_EXCL_DEC" },
  { id: "fee-bus", name: "Bus", amount: 400, type: "MONTHLY_EXCL_NOV_DEC" },
  { id: "fee-camp", name: "Camp", amount: 900, type: "ONCE_OFF" },
];

/**
 * Live Da Silva Academy catalogue shape (read-only verify 2026-11-16).
 * Transport remains MONTHLY until a separate approved catalogue change.
 */
const DA_SILVA_LIVE_CATALOGUE: FeeFrequencyCatalogueEntry[] = [
  { id: "fee-tuition", name: "PRIMARY 2026", amount: 2800, type: "MONTHLY" },
  {
    id: "fee-aftercare-primary",
    name: DA_SILVA_PROD_CATALOGUE_NAMES.aftercarePrimary,
    amount: 550,
    type: "MONTHLY_EXCL_DEC",
  },
  {
    id: "fee-aftercare-hs",
    name: DA_SILVA_PROD_CATALOGUE_NAMES.aftercareHighSchool,
    amount: 600,
    type: "MONTHLY_EXCL_DEC",
  },
  {
    id: "fee-transport",
    name: DA_SILVA_PROD_CATALOGUE_NAMES.transport,
    amount: 800,
    type: "MONTHLY",
  },
  {
    id: "fee-intervention",
    name: DA_SILVA_PROD_CATALOGUE_NAMES.intervention,
    amount: 550,
    type: "MONTHLY_EXCL_DEC",
  },
];

/** Same as live, after the approved Transport → MONTHLY_EXCL_DEC catalogue fix. */
const DA_SILVA_AFTER_TRANSPORT_FIX: FeeFrequencyCatalogueEntry[] = DA_SILVA_LIVE_CATALOGUE.map(
  (fee) =>
    fee.name === DA_SILVA_PROD_CATALOGUE_NAMES.transport
      ? { ...fee, type: "MONTHLY_EXCL_DEC" }
      : fee
);

const DA_SILVA = DA_SILVA_BILLING_DATA_SCHOOL_ID;

/**
 * Verified production plan descriptions (counts + sums from read-only verify).
 * INTERVENTION is not uniform (33 lines sum to R18,050, not 33×R550).
 */
type ProdPlanRow = {
  feeDescription: string;
  amount: number;
  count: number;
  verifiedSum: number;
  expectedDecExcludeLive: boolean;
};

const PROD_PLAN_LINES: ProdPlanRow[] = [
  { feeDescription: "AFTERCARE", amount: 550, count: 75, verifiedSum: 41250, expectedDecExcludeLive: true },
  { feeDescription: "2026 Transport", amount: 800, count: 23, verifiedSum: 18400, expectedDecExcludeLive: false },
  { feeDescription: "INTERVENTION", amount: 550, count: 33, verifiedSum: 18050, expectedDecExcludeLive: true },
  { feeDescription: "Aftercare primary", amount: 550, count: 14, verifiedSum: 7700, expectedDecExcludeLive: true },
  { feeDescription: "Transport", amount: 800, count: 6, verifiedSum: 4800, expectedDecExcludeLive: false },
  { feeDescription: "AFTERCARE/INTERVENTION", amount: 550, count: 6, verifiedSum: 3300, expectedDecExcludeLive: true },
  { feeDescription: "Intervention", amount: 550, count: 3, verifiedSum: 1650, expectedDecExcludeLive: true },
  { feeDescription: "INTERVENTION/AFTERCARE BOTH", amount: 550, count: 1, verifiedSum: 550, expectedDecExcludeLive: true },
  { feeDescription: "AFTERCARE STARTING FEB", amount: 550, count: 1, verifiedSum: 550, expectedDecExcludeLive: true },
  { feeDescription: "INTERVENTION - COMPULSORY", amount: 550, count: 1, verifiedSum: 550, expectedDecExcludeLive: true },
  { feeDescription: "INTERVENTION/AFTERCARE", amount: 550, count: 1, verifiedSum: 550, expectedDecExcludeLive: true },
  { feeDescription: "AFTERCARE/ INTERVENTION", amount: 550, count: 1, verifiedSum: 550, expectedDecExcludeLive: true },
  {
    feeDescription: "INTERVENTION CONDITION FOR ALL SUBJECTS",
    amount: 550,
    count: 1,
    verifiedSum: 550,
    expectedDecExcludeLive: true,
  },
  { feeDescription: "INTERVENTION COMPULSORY", amount: 550, count: 1, verifiedSum: 550, expectedDecExcludeLive: true },
];

const VARIANT_LINES: StoredBillingPlanItem[] = [
  ...Array.from({ length: 6 }, () => ({ feeDescription: "AFTERCARE/INTERVENTION", amount: 550 })),
  { feeDescription: "INTERVENTION/AFTERCARE BOTH", amount: 550 },
  { feeDescription: "INTERVENTION COMPULSORY", amount: 550 },
  { feeDescription: "AFTERCARE STARTING FEB", amount: 550 },
  { feeDescription: "AFTERCARE/ INTERVENTION", amount: 550 },
  { feeDescription: "INTERVENTION/AFTERCARE", amount: 550 },
  { feeDescription: "INTERVENTION CONDITION FOR ALL SUBJECTS", amount: 550 },
  { feeDescription: "INTERVENTION - COMPULSORY", amount: 550 },
];
assert(VARIANT_LINES.length === 13, "fixture covers verified combined + compulsory + starting-feb variants");
assert(DA_SILVA_FEE_EXCLUSION_ALIASES.length === 10, "ten explicit alias descriptions (8 variants + AFTERCARE + 2026 Transport)");

const PLAN: StoredBillingPlanItem[] = [
  { feeDescription: "Tuition", amount: 2800 },
  { feeDescription: "Aftercare", amount: 550 },
  { feeDescription: "Transport", amount: 700 },
];

/** Expand verified rows into plan items, preserving non-uniform INTERVENTION totals. */
function expandProdPlanLines(): StoredBillingPlanItem[] {
  const out: StoredBillingPlanItem[] = [];
  for (const row of PROD_PLAN_LINES) {
    if (row.count === 1) {
      out.push({ feeDescription: row.feeDescription, amount: row.verifiedSum });
      continue;
    }
    const base = row.amount;
    const remainder = Math.round((row.verifiedSum - base * (row.count - 1)) * 100) / 100;
    for (let i = 0; i < row.count - 1; i += 1) {
      out.push({ feeDescription: row.feeDescription, amount: base });
    }
    out.push({ feeDescription: row.feeDescription, amount: remainder });
  }
  return out;
}

function sumExcluded(
  rows: ProdPlanRow[],
  predicate: (row: ProdPlanRow) => boolean
): number {
  return rows.reduce((sum, row) => (predicate(row) ? sum + row.verifiedSum : sum), 0);
}

function learner(id = "l-dec") {
  return {
    id,
    firstName: "Dec",
    lastName: "Test",
    enrollmentStatus: "ACTIVE",
    admissionNo: null,
    idNumber: null,
    familyAccountId: null,
    familyAccount: { accountRef: "DEC001" },
  };
}

function testPeriodMonthHelpers() {
  assert(invoicePeriodCalendarMonth("2026-12") === 12, "YYYY-MM December");
  assert(invoicePeriodCalendarMonth("2027-01") === 1, "YYYY-MM January");
  assert(invoicePeriodCalendarMonth("December 2026") === 12, "label December 2026");
  assert(invoicePeriodCalendarMonth("January 2027") === 1, "label January 2027");
  assert(invoicePeriodCalendarMonth("2025-12") === 12, "prior-year December still month 12");
  assert(invoicePeriodCalendarMonth("") === 0, "blank period");

  assert(isFeeTypeExcludedForInvoicePeriod("MONTHLY_EXCL_DEC", "2026-12"), "excl-dec in Dec");
  assert(!isFeeTypeExcludedForInvoicePeriod("MONTHLY_EXCL_DEC", "2026-11"), "excl-dec not Nov");
  assert(!isFeeTypeExcludedForInvoicePeriod("MONTHLY_EXCL_DEC", "2027-01"), "excl-dec not Jan");
  assert(isFeeTypeExcludedForInvoicePeriod("MONTHLY_EXCL_NOV_DEC", "2026-11"), "excl-nov-dec in Nov");
  assert(isFeeTypeExcludedForInvoicePeriod("MONTHLY_EXCL_NOV_DEC", "2026-12"), "excl-nov-dec in Dec");
  assert(!isFeeTypeExcludedForInvoicePeriod("MONTHLY_EXCL_NOV_DEC", "2027-01"), "excl-nov-dec not Jan");
  assert(!isFeeTypeExcludedForInvoicePeriod("MONTHLY", "2026-12"), "plain monthly stays in Dec");
  assert(!isFeeTypeExcludedForInvoicePeriod("monthly excl dec", "2026-11"), "normalised type, wrong month");
  assert(isFeeTypeExcludedForInvoicePeriod("Monthly Excl Dec", "2026-12"), "label-style type normalised");
  console.log("✓ period month + fee-type exclusion helpers");
}

function testCatalogueMatching() {
  const byName = matchFeeFrequencyCatalogueEntry(
    { feeDescription: "Aftercare", amount: 550 },
    CATALOGUE
  );
  assert(byName?.id === "fee-aftercare", "match Aftercare by name");
  const byId = matchFeeFrequencyCatalogueEntry(
    { feeDescription: "Wrong", amount: 1, feeStructureId: "fee-transport" },
    CATALOGUE
  );
  assert(byId?.id === "fee-transport", "feeStructureId wins over description");
  assert(
    matchFeeFrequencyCatalogueEntry({ feeDescription: "Custom line", amount: 75 }, CATALOGUE) === null,
    "uncatalogued line unmatched"
  );
  console.log("✓ catalogue matching by id and name");
}

function testDecemberDropsExclFeesJanuaryResumes() {
  const december = applyFeeFrequencyExclusionGuard({
    planItems: PLAN,
    extraFees: [{ feeDescription: "Bus", amount: 400 }],
    catalogue: CATALOGUE,
    invoicePeriod: "2026-12",
  });
  assert(december.planItems.length === 1, "December keeps tuition only");
  assert(december.planItems[0].feeDescription === "Tuition", "December tuition remains");
  assert(december.extraFees.length === 0, "December drops MONTHLY_EXCL_NOV_DEC bus");

  const january = applyFeeFrequencyExclusionGuard({
    planItems: PLAN,
    extraFees: [{ feeDescription: "Bus", amount: 400 }],
    catalogue: CATALOGUE,
    invoicePeriod: "2027-01",
  });
  assert(january.planItems.length === 3, "January restores Aftercare + Transport");
  assert(january.extraFees.length === 1, "January restores Bus");
  assert(
    january.planItems.map((i) => i.feeDescription).join("|") === "Tuition|Aftercare|Transport",
    "January plan order preserved"
  );

  const november = applyFeeFrequencyExclusionGuard({
    planItems: [...PLAN, { feeDescription: "Bus", amount: 400 }],
    catalogue: CATALOGUE,
    invoicePeriod: "2026-11",
  });
  assert(
    november.planItems.map((i) => i.feeDescription).join("|") === "Tuition|Aftercare|Transport",
    "November keeps MONTHLY_EXCL_DEC fees"
  );
  assert(!november.planItems.some((i) => i.feeDescription === "Bus"), "November drops Bus");
  console.log("✓ December exclusion + January resumption + November partial exclusion");
}

function testCrossYearAndExecutionDateIndependence() {
  const priorDec = applyFeeFrequencyExclusionGuard({
    planItems: PLAN,
    catalogue: CATALOGUE,
    invoicePeriod: "2025-12",
  });
  assert(priorDec.planItems.length === 1, "2025-12 still excludes Aftercare/Transport");

  const lateRunForJan = applyFeeFrequencyExclusionGuard({
    planItems: PLAN,
    catalogue: CATALOGUE,
    invoicePeriod: "2027-01",
  });
  assert(lateRunForJan.planItems.length === 3, "January period billable even if run date is later");

  const earlyRunForDec = applyFeeFrequencyExclusionGuard({
    planItems: PLAN,
    catalogue: CATALOGUE,
    invoicePeriod: "December 2026",
  });
  assert(earlyRunForDec.planItems.length === 1, "label period December 2026 excludes");
  console.log("✓ cross-year periods; exclusion uses billing period not run date");
}

function testEligibilityAndChargeLinesStayInSync() {
  const l1 = learner();
  const decEligibility = evaluateLearnerEligibility({
    learner: l1,
    planItems: PLAN,
    accountNo: "DEC001",
    invoicePeriod: "2026-12",
    existingLedger: [],
    feeFrequencyCatalogue: CATALOGUE,
  });
  assert(decEligibility.status === "invoiced", "December still invoices tuition");
  assert(decEligibility.amount === 2800, "December amount is tuition only");

  const decCharges = applyFeeFrequencyExclusionGuard({
    planItems: PLAN,
    catalogue: CATALOGUE,
    invoicePeriod: "2026-12",
  });
  const snapshot = buildInvoiceChargeLines(decCharges.planItems, decCharges.extraFees);
  assert(snapshot.ok, "December charge lines ok");
  assert(snapshot.total === 2800, "charge line total matches eligibility");
  assert(snapshot.lines.length === 1 && snapshot.lines[0].description === "Tuition", "one tuition line");

  const aftercareOnly = evaluateLearnerEligibility({
    learner: l1,
    planItems: [{ feeDescription: "Aftercare", amount: 550 }],
    accountNo: "DEC001",
    invoicePeriod: "2026-12",
    existingLedger: [],
    feeFrequencyCatalogue: CATALOGUE,
  });
  assert(aftercareOnly.status === "skipped", "Aftercare-only December skipped");
  assert(aftercareOnly.skipReason === "FEE_EXCLUDED_FOR_PERIOD", "period exclusion skip reason");
  assert(aftercareOnly.amount === 0, "no December Aftercare amount");

  const jan = evaluateLearnerEligibility({
    learner: l1,
    planItems: PLAN,
    accountNo: "DEC001",
    invoicePeriod: "2027-01",
    existingLedger: [],
    feeFrequencyCatalogue: CATALOGUE,
  });
  assert(jan.status === "invoiced" && jan.amount === 4050, "January resumes full plan");
  console.log("✓ eligibility amounts match charge lines; Aftercare-only Dec skipped");
}

function testPreviewPlanUsesSameExclusion() {
  const l1 = learner();
  const december = buildInvoiceRunPlanForTest({
    allActiveLearners: [l1],
    processedLearners: [l1],
    plansByLearnerId: { [l1.id]: PLAN },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { [l1.id]: "DEC001" },
    existingLedger: [],
    invoicePeriod: "2026-12",
    feeFrequencyCatalogue: CATALOGUE,
  });
  assert(december.learnerRows[0]?.status === "invoiced", "December preview invoices");
  assert(december.learnerRows[0]?.amount === 2800, "December preview excludes Aftercare+Transport");
  assert(december.integrity.passed, "December preview integrity");

  const january = buildInvoiceRunPlanForTest({
    allActiveLearners: [l1],
    processedLearners: [l1],
    plansByLearnerId: { [l1.id]: PLAN },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { [l1.id]: "DEC001" },
    existingLedger: [],
    invoicePeriod: "2027-01",
    feeFrequencyCatalogue: CATALOGUE,
  });
  assert(january.learnerRows[0]?.amount === 4050, "January preview restores full amount");
  console.log("✓ invoice-run preview plan shares exclusion logic");
}

function testEmptyCatalogueLeavesPlanUntouched() {
  const result = applyFeeFrequencyExclusionGuard({
    planItems: PLAN,
    catalogue: [],
    invoicePeriod: "2026-12",
  });
  assert(result.planItems.length === 3, "no catalogue → no filtering (safe no-op)");
  console.log("✓ empty catalogue is a no-op");
}

function testExtraChargePathCannotBypassDecemberExclusion() {
  const viaExtraOnly = applyFeeFrequencyExclusionGuard({
    planItems: [{ feeDescription: "Tuition", amount: 2800 }],
    extraFees: [
      { feeDescription: "Aftercare", amount: 550 },
      { feeDescription: "Transport", amount: 700 },
    ],
    catalogue: CATALOGUE,
    invoicePeriod: "2026-12",
  });
  assert(viaExtraOnly.planItems.length === 1, "tuition plan line kept");
  assert(viaExtraOnly.extraFees.length === 0, "December extra Aftercare/Transport dropped");

  const l1 = learner("l-extra");
  const eligibility = evaluateLearnerEligibility({
    learner: l1,
    planItems: [{ feeDescription: "Tuition", amount: 2800 }],
    extraFees: [
      { feeDescription: "Aftercare", amount: 550 },
      { feeDescription: "Transport", amount: 700 },
    ],
    accountNo: "DEC001",
    invoicePeriod: "2026-12",
    existingLedger: [],
    feeFrequencyCatalogue: CATALOGUE,
  });
  assert(eligibility.status === "invoiced" && eligibility.amount === 2800, "extra path cannot inflate Dec total");
  console.log("✓ extra-charge path respects December exclusion");
}

function testTenantCataloguesDoNotLeakAcrossSchools() {
  const schoolA: FeeFrequencyCatalogueEntry[] = [
    { id: "a-aftercare", name: "Aftercare", amount: 550, type: "MONTHLY_EXCL_DEC" },
  ];
  const schoolB: FeeFrequencyCatalogueEntry[] = [
    { id: "b-aftercare", name: "Aftercare", amount: 550, type: "MONTHLY" },
  ];
  const line = [{ feeDescription: "Aftercare", amount: 550 }];
  const forA = applyFeeFrequencyExclusionGuard({
    planItems: line,
    catalogue: schoolA,
    invoicePeriod: "2026-12",
  });
  const forB = applyFeeFrequencyExclusionGuard({
    planItems: line,
    catalogue: schoolB,
    invoicePeriod: "2026-12",
  });
  assert(forA.planItems.length === 0, "school A Excl-Dec catalogue drops Aftercare");
  assert(forB.planItems.length === 1, "school B MONTHLY catalogue keeps Aftercare");
  console.log("✓ exclusion follows the calling school's catalogue only (tenant-safe)");
}

function testLiveCatalogueDoesNotSilentlyOverrideTransportMonthly() {
  const transportLines = [
    { feeDescription: "Transport", amount: 800 },
    { feeDescription: "2026 Transport", amount: 800 },
  ];
  const december = applyFeeFrequencyExclusionGuard({
    planItems: transportLines,
    catalogue: DA_SILVA_LIVE_CATALOGUE,
    invoicePeriod: "2026-12",
    schoolId: DA_SILVA,
  });
  assert(december.planItems.length === 2, "live MONTHLY Transport stays billable in December");
  assert(
    !isFeeTypeExcludedForInvoicePeriod("MONTHLY", "2026-12"),
    "engine must not treat MONTHLY as MONTHLY_EXCL_DEC"
  );

  const afterFix = applyFeeFrequencyExclusionGuard({
    planItems: transportLines,
    catalogue: DA_SILVA_AFTER_TRANSPORT_FIX,
    invoicePeriod: "2026-12",
    schoolId: DA_SILVA,
  });
  assert(afterFix.planItems.length === 0, "Transport excludes only after catalogue type is EXCL_DEC");
  console.log("✓ Transport MONTHLY is not silently overridden; EXCL_DEC catalogue change required");
}

function testProdShapedDecemberExclusionsAndJanuaryResume() {
  const allLines = expandProdPlanLines();
  assert(allLines.length === 167, "verified production related line count (75+23+33+14+6+9+3+4)");

  const december = applyFeeFrequencyExclusionGuard({
    planItems: allLines,
    catalogue: DA_SILVA_LIVE_CATALOGUE,
    invoicePeriod: "2026-12",
    schoolId: DA_SILVA,
  });
  const keptAmount = december.planItems.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const expectedKept = sumExcluded(PROD_PLAN_LINES, (r) => !r.expectedDecExcludeLive);
  const expectedExcluded = sumExcluded(PROD_PLAN_LINES, (r) => r.expectedDecExcludeLive);
  assert(expectedExcluded === 75800, "live-config Dec exclusion total is R75,800");
  assert(expectedKept === 23200, "live-config Transport still billed is R23,200");
  assert(keptAmount === expectedKept, `December kept amount ${keptAmount} === ${expectedKept}`);
  assert(
    december.planItems.every(
      (i) => i.feeDescription === "Transport" || i.feeDescription === "2026 Transport"
    ),
    "only Transport lines remain under live MONTHLY catalogue"
  );

  const january = applyFeeFrequencyExclusionGuard({
    planItems: allLines,
    catalogue: DA_SILVA_LIVE_CATALOGUE,
    invoicePeriod: "2027-01",
    schoolId: DA_SILVA,
  });
  assert(january.planItems.length === allLines.length, "January 2027 resumes every related line");
  const janTotal = january.planItems.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  assert(janTotal === expectedExcluded + expectedKept, "January resumes full R99,000 related total");
  console.log("✓ prod-shaped Dec exclusions (R75,800) + January 2027 full resume");
}

function testAfterTransportCatalogueFixFullExclusion() {
  const allLines = expandProdPlanLines();
  const december = applyFeeFrequencyExclusionGuard({
    planItems: allLines,
    catalogue: DA_SILVA_AFTER_TRANSPORT_FIX,
    invoicePeriod: "2026-12",
    schoolId: DA_SILVA,
  });
  assert(december.planItems.length === 0, "with Transport EXCL_DEC, all 167 related lines drop");
  const expectedFull = sumExcluded(PROD_PLAN_LINES, () => true);
  assert(expectedFull === 99000, "full intended December exclusion is R99,000");
  console.log("✓ after Transport MONTHLY_EXCL_DEC catalogue fix, full R99,000 excludes");
}

function testAftercareAliasResolvesWithoutRenamingPlans() {
  const december = applyFeeFrequencyExclusionGuard({
    planItems: Array.from({ length: 75 }, () => ({ feeDescription: "AFTERCARE", amount: 550 })),
    catalogue: DA_SILVA_LIVE_CATALOGUE,
    invoicePeriod: "2026-12",
    schoolId: DA_SILVA,
  });
  assert(december.planItems.length === 0, "75 AFTERCARE plan lines exclude via Aftercare primary alias");

  const alias = findFeeExclusionAlias(DA_SILVA, "AFTERCARE");
  assert(alias?.canonicalNames[0] === "Aftercare primary", "AFTERCARE maps to Aftercare primary");
  assert(alias?.mode === "single", "AFTERCARE is a single-fee alias");
  console.log("✓ AFTERCARE resolves to Aftercare primary without renaming plans");
}

function testCombinedAliasRequiresBothUnderlyingFeesExcluded() {
  const aftercareOnlyExcl: FeeFrequencyCatalogueEntry[] = [
    {
      id: "fee-aftercare-primary",
      name: DA_SILVA_PROD_CATALOGUE_NAMES.aftercarePrimary,
      amount: 550,
      type: "MONTHLY_EXCL_DEC",
    },
    {
      id: "fee-intervention",
      name: DA_SILVA_PROD_CATALOGUE_NAMES.intervention,
      amount: 550,
      type: "MONTHLY",
    },
  ];
  const kept = applyFeeFrequencyExclusionGuard({
    planItems: [{ feeDescription: "AFTERCARE/INTERVENTION", amount: 550 }],
    catalogue: aftercareOnlyExcl,
    invoicePeriod: "2026-12",
    schoolId: DA_SILVA,
  });
  assert(kept.planItems.length === 1, "combined line kept when Intervention is still MONTHLY");

  const bothExcl: FeeFrequencyCatalogueEntry[] = [
    {
      id: "fee-aftercare-primary",
      name: DA_SILVA_PROD_CATALOGUE_NAMES.aftercarePrimary,
      amount: 550,
      type: "MONTHLY_EXCL_DEC",
    },
    {
      id: "fee-intervention",
      name: DA_SILVA_PROD_CATALOGUE_NAMES.intervention,
      amount: 550,
      type: "MONTHLY_EXCL_DEC",
    },
  ];
  const dropped = applyFeeFrequencyExclusionGuard({
    planItems: [{ feeDescription: "AFTERCARE/INTERVENTION", amount: 550 }],
    catalogue: bothExcl,
    invoicePeriod: "2026-12",
    schoolId: DA_SILVA,
  });
  assert(dropped.planItems.length === 0, "combined line dropped only when both fees excl Dec");
  console.log("✓ combined Aftercare/Intervention requires both catalogue fees to exclude December");
}

function testAliasesDoNotApplyToOtherTenantsOrUnknownDescriptions() {
  const otherSchool = applyFeeFrequencyExclusionGuard({
    planItems: VARIANT_LINES,
    catalogue: DA_SILVA_LIVE_CATALOGUE,
    invoicePeriod: "2026-12",
    schoolId: "some-other-school-id",
  });
  assert(otherSchool.planItems.length === VARIANT_LINES.length, "aliases are Da Silva-scoped");

  const unknown = applyFeeFrequencyExclusionGuard({
    planItems: [
      { feeDescription: "AFTERCARE SPECIAL PROMOTION", amount: 550 },
      { feeDescription: "Robotics Aftercare Workshop", amount: 550 },
      { feeDescription: "PRIMARY 2026", amount: 2800 },
    ],
    catalogue: DA_SILVA_LIVE_CATALOGUE,
    invoicePeriod: "2026-12",
    schoolId: DA_SILVA,
  });
  assert(unknown.planItems.length === 3, "unknown / unrelated descriptions stay billable");
  assert(!findFeeExclusionAlias(DA_SILVA, "Robotics Aftercare Workshop"), "no broad keyword alias");
  console.log("✓ other tenants and unrelated descriptions are not keyword-suppressed");
}

function testAliasPrefersFeeStructureIdWhenProvided() {
  const rule = {
    description: "intervention compulsory",
    mode: "single" as const,
    feeStructureIds: ["fee-intervention"] as const,
    canonicalNames: ["WRONG_NAME_SHOULD_BE_IGNORED_WHEN_ID_HITS"] as const,
  };
  const resolved = resolveAliasCatalogueFees(rule, DA_SILVA_LIVE_CATALOGUE);
  assert(resolved?.[0]?.id === "fee-intervention", "feeStructureId wins over canonical name");
  console.log("✓ alias resolution prefers feeStructureId when present");
}

function testExactNameMatchingStillWorksAlongsideAliases() {
  const result = applyFeeFrequencyExclusionGuard({
    planItems: [
      { feeDescription: "PRIMARY 2026", amount: 2800 },
      { feeDescription: "AFTERCARE", amount: 550 },
      { feeDescription: "INTERVENTION", amount: 550 },
      { feeDescription: "Aftercare primary", amount: 550 },
      { feeDescription: "AFTERCARE/INTERVENTION", amount: 550 },
    ],
    catalogue: DA_SILVA_LIVE_CATALOGUE,
    invoicePeriod: "2026-12",
    schoolId: DA_SILVA,
  });
  assert(result.planItems.length === 1, "tuition kept; exact + alias excl lines dropped");
  assert(result.planItems[0].feeDescription === "PRIMARY 2026", "only tuition remains");

  const jan = applyFeeFrequencyExclusionGuard({
    planItems: [
      { feeDescription: "PRIMARY 2026", amount: 2800 },
      { feeDescription: "AFTERCARE", amount: 550 },
      { feeDescription: "INTERVENTION", amount: 550 },
      { feeDescription: "Aftercare primary", amount: 550 },
      { feeDescription: "AFTERCARE/INTERVENTION", amount: 550 },
    ],
    catalogue: DA_SILVA_LIVE_CATALOGUE,
    invoicePeriod: "2027-01",
    schoolId: DA_SILVA,
  });
  assert(jan.planItems.length === 5, "January resumes exact + alias lines");
  console.log("✓ exact-name matching preserved alongside aliases; Jan resumes");
}

function testPreviewEligibilityUsesAliases() {
  const l1 = learner("l-alias");
  const preview = buildInvoiceRunPlanForTest({
    allActiveLearners: [l1],
    processedLearners: [l1],
    plansByLearnerId: {
      [l1.id]: [
        { feeDescription: "PRIMARY 2026", amount: 2800 },
        { feeDescription: "AFTERCARE", amount: 550 },
        { feeDescription: "AFTERCARE/INTERVENTION", amount: 550 },
        { feeDescription: "INTERVENTION COMPULSORY", amount: 550 },
        { feeDescription: "2026 Transport", amount: 800 },
      ],
    },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { [l1.id]: "DEC001" },
    existingLedger: [],
    invoicePeriod: "2026-12",
    feeFrequencyCatalogue: DA_SILVA_LIVE_CATALOGUE,
    schoolId: DA_SILVA,
  });
  // Tuition 2800 + Transport 800 (still MONTHLY) = 3600
  assert(preview.learnerRows[0]?.amount === 3600, "preview excludes Aftercare/Intervention aliases; keeps MONTHLY Transport");
  console.log("✓ invoice-run preview eligibility applies Da Silva aliases without Transport override");
}

function main() {
  testPeriodMonthHelpers();
  testCatalogueMatching();
  testDecemberDropsExclFeesJanuaryResumes();
  testCrossYearAndExecutionDateIndependence();
  testEligibilityAndChargeLinesStayInSync();
  testPreviewPlanUsesSameExclusion();
  testEmptyCatalogueLeavesPlanUntouched();
  testExtraChargePathCannotBypassDecemberExclusion();
  testTenantCataloguesDoNotLeakAcrossSchools();
  testLiveCatalogueDoesNotSilentlyOverrideTransportMonthly();
  testProdShapedDecemberExclusionsAndJanuaryResume();
  testAfterTransportCatalogueFixFullExclusion();
  testAftercareAliasResolvesWithoutRenamingPlans();
  testCombinedAliasRequiresBothUnderlyingFeesExcluded();
  testAliasesDoNotApplyToOtherTenantsOrUnknownDescriptions();
  testAliasPrefersFeeStructureIdWhenProvided();
  testExactNameMatchingStillWorksAlongsideAliases();
  testPreviewEligibilityUsesAliases();
  console.log("invoiceFeeFrequencyExclusion.test.ts: OK");
}

main();
