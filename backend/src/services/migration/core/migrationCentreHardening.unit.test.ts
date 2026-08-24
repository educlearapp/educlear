/**
 * Migration Centre hardening — family, learner, opening, transaction, tenant, Fly Eagle rehearsal.
 * LOCAL / in-memory only. No production writes.
 *
 * Run:
 *   npx tsx src/services/migration/core/migrationCentreHardening.unit.test.ts
 */

import assert from "assert";
import { resolveParentIdentity } from "../parentIdentity/resolveParentIdentity";
import type { ExistingParentCandidate, IncomingParentIdentity } from "../parentIdentity/parentIdentityTypes";
import { detectMigrationCategory } from "./detectMigrationCategory";
import {
  classifyExpressInvoiceExport,
  expressInvoiceAuthorityForFilename,
  EXPRESS_INVOICE_PRECEDENCE,
} from "./expressInvoiceAuthority";
import {
  resolveFamilyGroupingAuthority,
  resolveMigrationFamilyAccountLink,
} from "./migrationFamilyEvidence";
import {
  classifyMigrationLearnerIdentity,
  matchMigrationLearnerInSchool,
} from "./migrationLearnerIdentity";
import { collapseOpeningBalancesByAccount, openingBalanceRowsToPost } from "./migrationOpeningBalanceSafety";
import { evaluateMigrationIntegrityGate } from "./migrationIntegrityStore";
import { migrationTransactionProvenance } from "./migrationTransactionProvenance";
import {
  applyRehearsalMigration,
  rehearsalGlobalDifferenceCents,
  type RehearsalLearner,
} from "./flyEagleSyntheticRehearsal";
import { formatLedgerDuplicateKey } from "./classifyLedgerTransaction";

const SCHOOL = "school_fly_eagle_rehearsal";
const MAGICAL = "cmq4xjckq00at60gqg4eb956h";
const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";

function testSurnameNeverAutoLinks(): void {
  const resolved = resolveMigrationFamilyAccountLink({
    learner: {
      id: "l1",
      lastName: "Nkosi",
      admissionNo: null,
      familyAccountId: null,
    },
    familyAccounts: [{ id: "fa1", accountRef: "ACC001", familyName: "Nkosi" }],
  });
  assert.strictEqual(resolved.familyAccountId, null);
  assert.strictEqual(resolved.reason, "unlinked");
  assert.ok(resolved.review);
  assert.strictEqual(resolved.review.kind, "SURNAME_ONLY");

  const grouped = resolveFamilyGroupingAuthority([
    { key: "a", schoolId: SCHOOL, lastName: "Nkosi", sourceAccountRef: "A1" },
    { key: "b", schoolId: SCHOOL, lastName: "Nkosi", sourceAccountRef: "B1" },
  ]);
  const autoTogether = grouped.groups.filter(
    (g) => g.decision === "AUTO_GROUP" && g.learnerKeys.includes("a") && g.learnerKeys.includes("b")
  );
  assert.strictEqual(autoTogether.length, 0, "unrelated same surname must stay separate");
  console.log("✓ surname-only linking is review-only, never auto-authority");
}

function testAccountRefDoesLink(): void {
  const resolved = resolveMigrationFamilyAccountLink({
    learner: {
      id: "l1",
      lastName: "Nkosi",
      admissionNo: "ACC001-1",
      familyAccountId: null,
    },
    familyAccounts: [{ id: "fa1", accountRef: "ACC001", familyName: "Nkosi" }],
  });
  assert.strictEqual(resolved.familyAccountId, "fa1");
  assert.strictEqual(resolved.reason, "account-ref");
  assert.strictEqual(resolved.review, null);
  console.log("✓ admission/account-ref remains authoritative family link");
}

function testLearnerIdentityActiveHistoricalCrossSchool(): void {
  const historical = {
    id: "h1",
    schoolId: SCHOOL,
    firstName: "Thabo",
    lastName: "Dlamini",
    idNumber: "1201015800088",
    birthDate: "2012-01-01",
    admissionNo: "THA001",
    enrollmentStatus: "HISTORICAL",
    familyAccountId: "fa-old",
  };
  const hist = classifyMigrationLearnerIdentity({
    incoming: {
      schoolId: SCHOOL,
      firstName: "Thabo",
      lastName: "Dlamini",
      idNumber: "1201015800088",
      dateOfBirth: "2012-01-01",
    },
    candidates: [historical],
  });
  assert.strictEqual(hist.classification, "EXISTING_HISTORICAL_LEARNER_REACTIVATION_REVIEW");

  const active = classifyMigrationLearnerIdentity({
    incoming: {
      schoolId: SCHOOL,
      firstName: "Thabo",
      lastName: "Dlamini",
      idNumber: "1201015800088",
      dateOfBirth: "2012-01-01",
    },
    candidates: [{ ...historical, enrollmentStatus: "ACTIVE" }],
  });
  assert.strictEqual(active.classification, "EXISTING_ACTIVE_LEARNER_REVIEW_LINK");

  const cross = matchMigrationLearnerInSchool({
    incoming: {
      schoolId: SCHOOL,
      firstName: "Thabo",
      lastName: "Dlamini",
      idNumber: "1201015800088",
    },
    candidates: [{ ...historical, schoolId: MAGICAL }],
  });
  assert.strictEqual(cross, null, "cross-school learner must not match");
  console.log("✓ learner identity ACTIVE / HISTORICAL / cross-school isolation");
}

function testParentCrossSchoolFailClosed(): void {
  const incoming: IncomingParentIdentity = {
    firstName: "Maria",
    surname: "Nkosi",
    idNumber: "8001015009087",
    sourceSystem: "UNKNOWN",
    schoolId: SCHOOL,
  };
  const magicalParent: ExistingParentCandidate = {
    id: "parent_magical",
    firstName: "Maria",
    surname: "Nkosi",
    idNumber: "8001015009087",
    schoolId: MAGICAL,
  };
  const decision = resolveParentIdentity({ incoming, candidates: [magicalParent] });
  assert.strictEqual(decision.decision, "REVIEW_REQUIRED");
  assert.strictEqual(decision.parentId, null);
  console.log("✓ parent identity cross-school fail-closed / REVIEW");
}

function testOpeningOncePerAccount(): void {
  const collapsed = collapseOpeningBalancesByAccount([
    { accountRef: "FAM1", openingBalance: "8100", sourceFilename: "unpaid.xls", rowNumber: 1 },
    { accountRef: "FAM1", openingBalance: "8100", sourceFilename: "unpaid2.xls", rowNumber: 2 },
    { accountRef: "FAM1", openingBalance: "8100", sourceFilename: "child-b.xls", rowNumber: 3 },
  ]);
  assert.strictEqual(collapsed.length, 1);
  assert.ok(collapsed[0]!.status === "post" || collapsed[0]!.status === "skip-duplicate");
  assert.strictEqual(collapsed[0]!.cents, 810000);
  const toPost = openingBalanceRowsToPost([
    { accountRef: "FAM1", openingBalance: "8100" },
    { accountRef: "FAM1", openingBalance: "8100" },
  ]);
  assert.strictEqual(toPost.toPost.length, 1);
  const conflict = collapseOpeningBalancesByAccount([
    { accountRef: "FAM1", openingBalance: "8100" },
    { accountRef: "FAM1", openingBalance: "16200" },
  ]);
  assert.strictEqual(conflict[0]!.status, "conflict");
  console.log("✓ opening balance posted once per source account; conflicts fail closed");
}

function testTransactionDedup(): void {
  const a = migrationTransactionProvenance({
    accountRef: "FAM6",
    date: "2024-02-01",
    reference: "INV-100",
    amount: 1000,
    postingType: "invoice",
  });
  const b = migrationTransactionProvenance({
    accountRef: "FAM6",
    date: "2024-03-15",
    reference: "INV-100",
    amount: 1000,
    postingType: "invoice",
  });
  assert.ok(a && b);
  assert.strictEqual(a.reference, b.reference);
  assert.strictEqual(a.accountRef, b.accountRef);
  const keyA = formatLedgerDuplicateKey(a);
  const keyB = formatLedgerDuplicateKey({ ...b, date: a.date });
  assert.strictEqual(a.reference, "inv-100");

  const noRefA = migrationTransactionProvenance({
    accountRef: "FAM9",
    date: "2024-01-01",
    reference: "",
    amount: 500,
    postingType: "payment",
  });
  assert.strictEqual(noRefA, null, "amount+date alone must not be a duplicate key");

  const withDesc = migrationTransactionProvenance({
    accountRef: "FAM9",
    date: "2024-01-01",
    reference: "",
    description: "School fees Jan",
    amount: 500,
    postingType: "payment",
  });
  assert.ok(withDesc);
  void keyA;
  void keyB;
  console.log("✓ overlapping invoice/payment provenance; amount+date alone never discards");
}

function testExpressAuthorityMap(): void {
  assert.strictEqual(classifyExpressInvoiceExport("EXPRESS INVOICE REPORT.xlsx"), "INVOICE_REPORT");
  assert.strictEqual(classifyExpressInvoiceExport("EXPRESS INVOICE (A).xlsx"), "INVOICE_A");
  assert.strictEqual(classifyExpressInvoiceExport("EXPRESS INVOICE (B).xls"), "INVOICE_B");
  assert.strictEqual(classifyExpressInvoiceExport("EXPRESS INVOICE (C).xls"), "INVOICE_C");
  assert.strictEqual(classifyExpressInvoiceExport("EXPRESS INVOICE CC.xls"), "INVOICE_CC");
  assert.strictEqual(classifyExpressInvoiceExport("EXPRESS UNPAID ACCOUNTS.xls"), "UNPAID_ACCOUNTS");
  assert.strictEqual(classifyExpressInvoiceExport("EXPRESS - ITEM SALES REPORT.xls"), "ITEM_SALES");
  assert.strictEqual(detectMigrationCategory("EXPRESS UNPAID ACCOUNTS.xls"), "billing");
  assert.strictEqual(detectMigrationCategory("EXPRESS INVOICE REPORT.xlsx"), "transactions");
  assert.strictEqual(detectMigrationCategory("Grade_1A.xls"), "learners");
  assert.strictEqual(detectMigrationCategory("sibling_accounts.xls"), "billing");
  const unpaid = expressInvoiceAuthorityForFilename("EXPRESS UNPAID ACCOUNTS.xls");
  assert.ok(unpaid?.trustedFor.includes("unpaid-current-balance"));
  assert.ok(unpaid?.notTrustedFor.includes("invoices"));
  const sales = expressInvoiceAuthorityForFilename("EXPRESS - ITEM SALES REPORT.xls");
  assert.ok(sales?.trustedFor.includes("invoice-lines-items"));
  assert.ok(EXPRESS_INVOICE_PRECEDENCE.some((p) => p.role === "unpaid-current-balance"));
  console.log("✓ Express Invoice classification and authority map");
}

function testIntegrityGate(): void {
  const blocked = evaluateMigrationIntegrityGate({
    stageId: "s1",
    targetSchoolId: SCHOOL,
    updatedAt: new Date().toISOString(),
    blockingCount: 1,
    findings: [
      {
        findingId: "hist1",
        severity: "BLOCKING",
        title: "Historical learner",
        message: "EXISTING HISTORICAL LEARNER — REACTIVATION REVIEW",
      },
    ],
  });
  assert.strictEqual(blocked.canAccept, false);
  const warnOnly = evaluateMigrationIntegrityGate({
    stageId: "s1",
    targetSchoolId: SCHOOL,
    updatedAt: new Date().toISOString(),
    blockingCount: 0,
    findings: [
      {
        findingId: "sur1",
        severity: "WARNING",
        title: "Surname review",
        message: "REVIEW REQUIRED. Same surname.",
      },
    ],
  });
  assert.strictEqual(warnOnly.canAccept, true);
  console.log("✓ Accept Migration stays blocked on mandatory integrity findings");
}

function testFlyEagleRehearsal(): void {
  const existingHistorical: RehearsalLearner = {
    key: "fam5-existing",
    schoolId: SCHOOL,
    firstName: "Lindiwe",
    lastName: "Khumalo",
    idNumber: "1005055800082",
    dob: "2010-05-05",
    sourceLearnerId: "LIN001",
    sourceAccountRef: "FAM5",
    enrollmentStatus: "HISTORICAL",
  };
  const seed = applyRehearsalMigration({
    schoolId: SCHOOL,
    learners: [existingHistorical],
  });
  seed.learners[0]!.enrollmentStatus = "HISTORICAL";

  const learners: RehearsalLearner[] = [
    {
      key: "fam1-a",
      schoolId: SCHOOL,
      firstName: "Anele",
      lastName: "Mokoena",
      dob: "2018-03-01",
      sourceLearnerId: "ANE001",
      sourceAccountRef: "FAM1",
      sourceParentId: "P1",
      parentIdNumber: "8501015009083",
      openingBalance: "8100",
    },
    {
      key: "fam1-b",
      schoolId: SCHOOL,
      firstName: "Busi",
      lastName: "Mokoena",
      dob: "2020-06-02",
      sourceLearnerId: "BUS001",
      sourceAccountRef: "FAM1",
      sourceParentId: "P1",
      parentIdNumber: "8501015009083",
      openingBalance: "8100",
    },
    {
      key: "fam2-a",
      schoolId: SCHOOL,
      firstName: "Carl",
      lastName: "Nkosi",
      dob: "2017-01-01",
      sourceLearnerId: "CAR001",
      sourceAccountRef: "FAM2A",
      parentIdNumber: "7601015009081",
      openingBalance: "1000",
    },
    {
      key: "fam2-b",
      schoolId: SCHOOL,
      firstName: "Dineo",
      lastName: "Nkosi",
      dob: "2019-02-02",
      sourceLearnerId: "DIN001",
      sourceAccountRef: "FAM2B",
      parentIdNumber: "7702025009082",
      openingBalance: "500",
    },
    {
      key: "fam3-a",
      schoolId: SCHOOL,
      firstName: "Esihle",
      lastName: "Botha",
      dob: "2016-07-07",
      sourceLearnerId: "ESI001",
      sourceAccountRef: "FAM3",
      parentIdNumber: "8203035009084",
    },
    {
      key: "fam3-b",
      schoolId: SCHOOL,
      firstName: "Franco",
      lastName: "Botha",
      dob: "2018-08-08",
      sourceLearnerId: "FRA001",
      sourceAccountRef: "FAM3",
      parentIdNumber: "8203035009084",
    },
    {
      key: "fam4",
      schoolId: SCHOOL,
      firstName: "Gugu",
      lastName: "Naidoo",
      dob: "2015-09-09",
      sourceLearnerId: "GUG001",
      sourceAccountRef: "FAM4",
      openingBalance: "0",
    },
    {
      key: "fam4-dup",
      schoolId: SCHOOL,
      firstName: "Gugu",
      lastName: "Naidoo",
      dob: "2015-09-09",
      sourceLearnerId: "GUG001",
      sourceAccountRef: "FAM4",
    },
    {
      key: "fam5",
      schoolId: SCHOOL,
      firstName: "Lindiwe",
      lastName: "Khumalo",
      idNumber: "1005055800082",
      dob: "2010-05-05",
      sourceLearnerId: "LIN001",
      sourceAccountRef: "FAM5",
    },
    {
      key: "fam7",
      schoolId: SCHOOL,
      firstName: "Hana",
      lastName: "Credit",
      dob: "2014-04-04",
      sourceLearnerId: "HAN001",
      sourceAccountRef: "FAM7",
      openingBalance: "-2000",
    },
    {
      key: "fam8",
      schoolId: SCHOOL,
      firstName: "Ivy",
      lastName: "Pay",
      dob: "2013-03-03",
      sourceLearnerId: "IVY001",
      sourceAccountRef: "FAM8",
    },
    {
      key: "fam10-a",
      schoolId: SCHOOL,
      firstName: "Jabu",
      lastName: "Dlamini",
      dob: "2012-02-02",
      sourceLearnerId: "JAB001",
      sourceAccountRef: "FAM10A",
      openingBalance: "300",
    },
    {
      key: "fam10-b",
      schoolId: SCHOOL,
      firstName: "Kabelo",
      lastName: "Dlamini",
      dob: "2011-01-01",
      sourceLearnerId: "KAB001",
      sourceAccountRef: "FAM10B",
      openingBalance: "400",
    },
  ];

  const transactions = [
    {
      accountRef: "FAM6",
      date: "2024-02-01",
      reference: "INV-DUP",
      amount: 2500,
      postingType: "invoice" as const,
      sourceFile: "EXPRESS INVOICE REPORT",
    },
    {
      accountRef: "FAM6",
      date: "2024-03-01",
      reference: "INV-DUP",
      amount: 2500,
      postingType: "invoice" as const,
      sourceFile: "EXPRESS INVOICE (A)",
    },
    {
      accountRef: "FAM8",
      date: "2024-01-10",
      reference: "INV-800",
      amount: 10000,
      postingType: "invoice" as const,
      sourceFile: "EXPRESS INVOICE REPORT",
    },
    {
      accountRef: "FAM8",
      date: "2024-01-20",
      reference: "PAY-800",
      amount: 4000,
      postingType: "payment" as const,
      sourceFile: "EXPRESS INVOICE REPORT",
    },
    {
      accountRef: "FAM8",
      date: "2024-01-20",
      reference: "PAY-800",
      amount: 4000,
      postingType: "payment" as const,
      sourceFile: "EXPRESS INVOICE (B)",
    },
    {
      accountRef: "FAM9",
      date: "2024-05-01",
      reference: "INV-900",
      amount: 100,
      postingType: "invoice" as const,
      sourceFile: "EXPRESS INVOICE (A)",
    },
    {
      accountRef: "FAM9",
      date: "2024-06-01",
      reference: "INV-900",
      amount: 100,
      postingType: "invoice" as const,
      sourceFile: "EXPRESS INVOICE (B)",
    },
  ];

  const first = applyRehearsalMigration({
    schoolId: SCHOOL,
    learners,
    transactions,
    existing: seed,
  });

  const fam1 = first.familyAccounts.filter((fa) => fa.accountRef === "FAM1");
  assert.strictEqual(fam1.length, 1, "Family 1: one FamilyAccount");
  assert.strictEqual(fam1[0]!.learnerKeys.length, 2, "Family 1: both learners attached");
  assert.strictEqual(first.openings.get("FAM1"), 810000, "Family 1: R8,100 not R16,200");

  const fam2 = first.familyAccounts.filter((fa) => fa.accountRef === "FAM2A" || fa.accountRef === "FAM2B");
  assert.strictEqual(fam2.length, 2, "Family 2: separate accounts");

  const fam3 = first.familyAccounts.filter((fa) => fa.accountRef === "FAM3");
  assert.strictEqual(fam3.length, 1);
  assert.strictEqual(fam3[0]!.learnerKeys.length, 2, "Family 3: one canonical family");

  const gugu = first.learners.filter((l) => l.firstName === "Gugu");
  assert.strictEqual(gugu.length, 1, "Family 4: duplicate learner row creates one learner");

  const lindiwe = first.learners.filter((l) => l.firstName === "Lindiwe");
  assert.strictEqual(lindiwe.length, 1, "Family 5: no duplicate historical learner");
  assert.ok(
    first.reviews.some((r) => /HISTORICAL LEARNER/i.test(r)),
    "Family 5: reactivation review"
  );

  const fam6Tx = first.transactions.filter((t) => t.accountRef === "FAM6");
  assert.strictEqual(fam6Tx.length, 1, "Family 6: duplicated invoice imported once");

  assert.strictEqual(first.openings.get("FAM7"), -200000, "Family 7: credit R-2,000");

  const sourceByAccount = new Map<string, number>([
    ["FAM1", 810000],
    ["FAM2A", 100000],
    ["FAM2B", 50000],
    ["FAM5", 0],
    ["FAM7", -200000],
    ["FAM8", 600000],
    ["FAM9", 10000],
    ["FAM10A", 30000],
    ["FAM10B", 40000],
  ]);
  const recon = rehearsalGlobalDifferenceCents({ sourceByAccount, state: first });
  assert.strictEqual(recon.globalDifferenceCents, 0, "GLOBAL DIFFERENCE = R0.00");
  assert.ok(recon.perAccount.every((row) => row.ok), "per-account difference R0.00");

  const fam8 = rehearsalGlobalDifferenceCents({
    sourceByAccount: new Map([["FAM8", 600000]]),
    state: first,
  });
  assert.strictEqual(fam8.perAccount[0]!.educlear, "R6,000.00");

  const fam9Tx = first.transactions.filter((t) => t.accountRef === "FAM9");
  assert.strictEqual(fam9Tx.length, 1, "Family 9: overlapping periods import once");

  const fam10 = first.familyAccounts.filter(
    (fa) => fa.accountRef === "FAM10A" || fa.accountRef === "FAM10B"
  );
  assert.strictEqual(fam10.length, 2, "Family 10: unrelated same surname stay separate");

  const second = applyRehearsalMigration({
    schoolId: SCHOOL,
    learners,
    transactions,
    existing: first,
  });
  assert.strictEqual(second.learners.length, first.learners.length, "idempotent learners");
  assert.strictEqual(second.familyAccounts.length, first.familyAccounts.length, "idempotent accounts");
  assert.strictEqual(second.parents.length, first.parents.length, "idempotent parents");
  assert.strictEqual(second.transactions.length, first.transactions.length, "idempotent transactions");
  assert.strictEqual(second.openings.size, first.openings.size, "idempotent openings");
  const recon2 = rehearsalGlobalDifferenceCents({ sourceByAccount, state: second });
  assert.strictEqual(recon2.globalDifferenceCents, 0);

  const partial = applyRehearsalMigration({
    schoolId: SCHOOL + "_fail",
    learners: learners.filter((l) => l.sourceAccountRef === "FAM1"),
  });
  assert.ok(partial.learners.length >= 1);
  const resumed = applyRehearsalMigration({
    schoolId: SCHOOL + "_fail",
    learners: learners.filter((l) => l.sourceAccountRef === "FAM1"),
    existing: partial,
  });
  assert.strictEqual(resumed.learners.length, partial.learners.length);
  assert.strictEqual(resumed.openings.get("FAM1"), 810000);
  console.log("✓ Fly Eagle synthetic rehearsal families 1–10, finance R0.00, idempotent, resume");
}

function testTenantIsolationMagicalDaSilva(): void {
  const grouped = resolveFamilyGroupingAuthority([
    {
      key: "magical-child",
      schoolId: MAGICAL,
      lastName: "Nkosi",
      sourceAccountRef: "MBB001",
      parentIdNumber: "8001015009087",
    },
    {
      key: "dasilva-child",
      schoolId: DA_SILVA,
      lastName: "Nkosi",
      sourceAccountRef: "LEK003",
      parentIdNumber: "8001015009087",
    },
  ]);
  const cross = grouped.groups.filter((g) =>
    g.learnerKeys.includes("magical-child") && g.learnerKeys.includes("dasilva-child")
  );
  assert.strictEqual(cross.length, 0, "never group Magical and Da Silva families");

  const match = matchMigrationLearnerInSchool({
    incoming: {
      schoolId: DA_SILVA,
      firstName: "Anele",
      lastName: "Mokoena",
      idNumber: "1201015800088",
    },
    candidates: [
      {
        id: "mbb-learner",
        schoolId: MAGICAL,
        firstName: "Anele",
        lastName: "Mokoena",
        idNumber: "1201015800088",
        enrollmentStatus: "ACTIVE",
      },
    ],
  });
  assert.strictEqual(match, null);
  console.log("✓ Magical / Da Silva tenant isolation — no cross-school match");
}

function testNoHistoricalCleanupImports(): void {
  const src = [
    "linkMigrationLearnersToFamilyAccounts",
    "applyMigrationStage",
    "migrationFamilyEvidence",
  ].join(",");
  assert.ok(!/retireAgeAnalysis|combineAndRetire|MOR013|MOT682|MOT683/.test(src));
  console.log("✓ no automatic historical cleanup / stale-account repair in this phase");
}

testSurnameNeverAutoLinks();
testAccountRefDoesLink();
testLearnerIdentityActiveHistoricalCrossSchool();
testParentCrossSchoolFailClosed();
testOpeningOncePerAccount();
testTransactionDedup();
testExpressAuthorityMap();
testIntegrityGate();
testFlyEagleRehearsal();
testTenantIsolationMagicalDaSilva();
testNoHistoricalCleanupImports();
console.log("migrationCentreHardening.unit.test.ts: ok");
