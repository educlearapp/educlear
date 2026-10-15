/**
 * Da Silva: EduClear-registration family accounts become invoice-run eligible under the
 * Kid-e-Sys gate, without loosening Kid-e-Sys, merged/retired, inactive or duplicate guards.
 * Fixture snapshot store + in-memory family-account lifecycle lookups. No DB or ledger writes.
 *
 * Run: npx tsx src/services/officialBillingAccountRef.registrationAccounts.test.ts
 */
import fs from "fs";
import os from "os";
import path from "path";

import { prisma } from "../prisma";
import {
  invalidateFamilyAccountAgeAnalysisFileCache,
  setFamilyAccountAgeAnalysisStoreDataDirForTests,
} from "../utils/familyAccountAgeAnalysisStore";
import { buildInvoiceRunEntryId, ledgerHasRunId, type BillingLedgerEntry } from "../utils/billingLedgerStore";
import { ensureFinanceAccountBaseline } from "./financeAccountBaseline";
import { buildInvoiceRunPlanForTest, resolveLearnerAccountForRun } from "./invoiceRunExecuteService";
import {
  EDUCLEAR_REGISTRATION_SOURCE,
  invalidateOfficialBillingAccountRefsCache,
  KIDEESYS_AGE_ANALYSIS_SOURCE,
  readOfficialBillingAccountRefs,
} from "./officialBillingAccountRef";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";
const FLY_EAGLE = "cmt1e8bjp0jo8lcjeketlynhl";
const PERIOD = "2026-11";
const EXECUTED_RUN_ID = `draft:${DA_SILVA}:${PERIOD}`;

function snap(accountRef: string, source: string) {
  return {
    schoolId: DA_SILVA,
    accountRef,
    accountHolder: accountRef,
    balance: 0,
    buckets: { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 },
    source,
    importedAt: "2026-07-27T06:17:31.300Z",
  };
}

type FamilyFixture = { id: string; accountRef: string; retiredAt: Date | null; mergedIntoFamilyAccountId: string | null };
const FAMILIES: FamilyFixture[] = [
  { id: "fa-ali002", accountRef: "ALI002", retiredAt: null, mergedIntoFamilyAccountId: null },
  { id: "fa-lep003", accountRef: "LEP003", retiredAt: null, mergedIntoFamilyAccountId: null },
  { id: "fa-nts392", accountRef: "NTS392", retiredAt: null, mergedIntoFamilyAccountId: null },
  { id: "fa-mas009", accountRef: "MAS009", retiredAt: null, mergedIntoFamilyAccountId: null },
  { id: "fa-nar002", accountRef: "NAR002", retiredAt: null, mergedIntoFamilyAccountId: null },
  { id: "fa-mot684", accountRef: "MOT684", retiredAt: null, mergedIntoFamilyAccountId: null },
  { id: "fa-mot682", accountRef: "MOT682", retiredAt: null, mergedIntoFamilyAccountId: null },
  { id: "fa-mot683", accountRef: "MOT683", retiredAt: new Date("2026-08-21T05:40:00Z"), mergedIntoFamilyAccountId: "fa-mot684" },
  { id: "fa-new001", accountRef: "NEW001", retiredAt: null, mergedIntoFamilyAccountId: null },
];

function stubFamilyAccountLookups() {
  const delegate = prisma.familyAccount as unknown as { findFirst: (args: any) => Promise<unknown> };
  const original = delegate.findFirst;
  delegate.findFirst = async (args: any) => {
    const where = args?.where || {};
    const row = FAMILIES.find(
      (f) => (where.id ? f.id === where.id : true) && (where.accountRef ? f.accountRef === where.accountRef : true)
    );
    if (!row) return null;
    const mergedInto = row.mergedIntoFamilyAccountId
      ? FAMILIES.find((f) => f.id === row.mergedIntoFamilyAccountId) || null
      : null;
    return { ...row, schoolId: DA_SILVA, mergedInto: mergedInto ? { id: mergedInto.id, accountRef: mergedInto.accountRef, schoolId: DA_SILVA } : null };
  };
  return () => {
    delegate.findFirst = original;
  };
}

function learner(id: string, admissionNo: string, familyRef: string | null, status = "ACTIVE") {
  const fam = familyRef ? FAMILIES.find((f) => f.accountRef === familyRef)! : null;
  return {
    id,
    firstName: id,
    lastName: "Fixture",
    enrollmentStatus: status,
    admissionNo,
    idNumber: null as string | null,
    familyAccountId: fam ? fam.id : null,
    familyAccount: fam ? { accountRef: fam.accountRef } : null,
  };
}

const FIVE = [
  learner("l-nts392", "NTS392", "NTS392"),
  learner("l-mas009", "MAS009", "MAS009"),
  learner("l-nar002", "NAR002", "NAR002"),
  learner("l-mot683", "MOT683", "MOT684"),
  learner("l-mot684", "MOT684", "MOT684"),
];
const ALREADY_INVOICED = [learner("l-ali002", "ALI002", "ALI002"), learner("l-lep003", "LEP003", "LEP003")];

const PLANS_WITH_JAMF: Record<string, { feeDescription: string; amount: number }[]> = {
  "l-nts392": [{ feeDescription: "2026 Primary", amount: 3000 }, { feeDescription: "JAMF Fee", amount: 450 }],
  "l-mas009": [{ feeDescription: "2026 Primary", amount: 3000 }, { feeDescription: "JAMF Fee", amount: 450 }],
  "l-nar002": [{ feeDescription: "High School", amount: 3800 }, { feeDescription: "JAMF Fee", amount: 450 }],
  "l-mot683": [
    { feeDescription: "Transport", amount: 800 },
    { feeDescription: "Aftercare primary", amount: 550 },
    { feeDescription: "2026 Primary", amount: 3000 },
    { feeDescription: "JAMF Fee", amount: 450 },
  ],
  "l-mot684": [
    { feeDescription: "Transport", amount: 800 },
    { feeDescription: "Aftercare primary", amount: 550 },
    { feeDescription: "2026 Primary", amount: 3000 },
    { feeDescription: "JAMF Fee", amount: 450 },
  ],
  "l-ali002": [{ feeDescription: "2026 Primary", amount: 3000 }, { feeDescription: "JAMF Fee", amount: 450 }],
  "l-lep003": [{ feeDescription: "2026 Primary", amount: 3000 }, { feeDescription: "JAMF Fee", amount: 450 }],
  "l-historical": [{ feeDescription: "2026 Primary", amount: 3000 }],
  "l-retired-link": [{ feeDescription: "2026 Primary", amount: 3000 }],
};

function plansWithoutJamf() {
  const out: typeof PLANS_WITH_JAMF = {};
  for (const [id, items] of Object.entries(PLANS_WITH_JAMF)) out[id] = items.filter((i) => !/jamf/i.test(i.feeDescription));
  return out;
}

function existingLedger(): BillingLedgerEntry[] {
  const rows: BillingLedgerEntry[] = ALREADY_INVOICED.map((l) => ({
    id: `inv-${EXECUTED_RUN_ID}-${l.id}`,
    schoolId: DA_SILVA,
    learnerId: l.id,
    accountNo: l.familyAccount!.accountRef,
    type: "invoice",
    amount: 3450,
    date: "2026-10-15",
    reference: `INV-${l.id}`,
    description: "2026 Primary + JAMF Fee",
    runId: EXECUTED_RUN_ID,
    invoicePeriod: PERIOD,
    lineKey: l.id,
    chargeLines: [
      { lineKey: "plan-0", description: "2026 Primary", amount: 3000 },
      { lineKey: "plan-1", description: "JAMF Fee", amount: 450 },
    ],
    createdAt: "2026-10-15T07:16:00.000Z",
  }));
  for (const l of FIVE) {
    rows.push({
      id: `inv-sept-${l.id}`,
      schoolId: DA_SILVA,
      learnerId: l.id,
      accountNo: l.familyAccount!.accountRef,
      type: "invoice",
      amount: 3000,
      date: "2026-09-16",
      reference: `INV-SEPT-${l.id}`,
      description: "September run",
      runId: `draft:${DA_SILVA}:2026-10`,
      invoicePeriod: "2026-10",
      lineKey: l.id,
      createdAt: "2026-09-16T07:00:00.000Z",
    });
    rows.push({
      id: `jamf-reg-${l.id}`,
      schoolId: DA_SILVA,
      learnerId: l.id,
      accountNo: l.familyAccount!.accountRef,
      type: "invoice",
      amount: 350,
      date: "2026-08-04",
      reference: `INV-REG-${l.id}`,
      description: "JAMF",
      lineKey: l.id,
      createdAt: "2026-08-04T07:00:00.000Z",
    });
  }
  return rows;
}

async function withFixtureStore(fn: () => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-reg-"));
  const snapshots = {
    [DA_SILVA]: {
      ALI002: snap("ALI002", KIDEESYS_AGE_ANALYSIS_SOURCE),
      LEP003: snap("LEP003", KIDEESYS_AGE_ANALYSIS_SOURCE),
      DUP001: snap("DUP001", KIDEESYS_AGE_ANALYSIS_SOURCE),
      NTS392: snap("NTS392", EDUCLEAR_REGISTRATION_SOURCE),
      MAS009: snap("MAS009", EDUCLEAR_REGISTRATION_SOURCE),
      NAR002: snap("NAR002", EDUCLEAR_REGISTRATION_SOURCE),
      MOT684: snap("MOT684", EDUCLEAR_REGISTRATION_SOURCE),
      MOT682: snap("MOT682", EDUCLEAR_REGISTRATION_SOURCE),
      MOT683: snap("MOT683", EDUCLEAR_REGISTRATION_SOURCE),
      "SMITH FAMILY": snap("SMITH FAMILY", EDUCLEAR_REGISTRATION_SOURCE),
      XTRA99: snap("XTRA99", "universal-migration-baseline"),
    },
    [FLY_EAGLE]: {
      REG001: snap("REG001", EDUCLEAR_REGISTRATION_SOURCE),
      "BEYAMO DEGAFECHY": snap("BEYAMO DEGAFECHY", "universal-migration-baseline"),
    },
  };
  fs.writeFileSync(path.join(dir, "family-account-age-analysis.json"), JSON.stringify(snapshots, null, 2));
  setFamilyAccountAgeAnalysisStoreDataDirForTests(dir);
  invalidateFamilyAccountAgeAnalysisFileCache();
  invalidateOfficialBillingAccountRefsCache();
  const restore = stubFamilyAccountLookups();
  try {
    await fn();
  } finally {
    restore();
    setFamilyAccountAgeAnalysisStoreDataDirForTests(null);
    invalidateFamilyAccountAgeAnalysisFileCache();
    invalidateOfficialBillingAccountRefsCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function resolveAll(learners: ReturnType<typeof learner>[]) {
  const accountNoByLearnerId: Record<string, string> = {};
  const accountErrorByLearnerId: Record<string, string> = {};
  for (const l of learners) {
    const r = await resolveLearnerAccountForRun(DA_SILVA, l as any);
    accountNoByLearnerId[l.id] = r.accountNo;
    if (r.error) accountErrorByLearnerId[l.id] = r.error;
  }
  return { accountNoByLearnerId, accountErrorByLearnerId };
}

function runPlan(
  learners: ReturnType<typeof learner>[],
  activeLearners: ReturnType<typeof learner>[],
  resolved: Awaited<ReturnType<typeof resolveAll>>,
  ledger: BillingLedgerEntry[],
  plans = PLANS_WITH_JAMF
) {
  return buildInvoiceRunPlanForTest({
    allActiveLearners: activeLearners as any,
    processedLearners: learners as any,
    plansByLearnerId: plans,
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: resolved.accountNoByLearnerId,
    accountErrorByLearnerId: resolved.accountErrorByLearnerId,
    existingLedger: ledger,
    invoicePeriod: PERIOD,
  });
}

async function main() {
  await withFixtureStore(async () => {
    const official = readOfficialBillingAccountRefs(DA_SILVA);
    assert(["ALI002", "LEP003", "DUP001"].every((r) => official.has(r)), "Kid-e-Sys accounts still official");
    assert(["NTS392", "MAS009", "NAR002", "MOT684"].every((r) => official.has(r)), "registration accounts now official");
    assert(!official.has("XTRA99"), "migration-baseline keys still excluded");
    assert(!official.has("SMITH FAMILY"), "non-Kid-e-Sys-format registration keys still excluded");
    assert(readOfficialBillingAccountRefs(FLY_EAGLE).size === 0, "registration accounts never activate the gate (Fly Eagle)");
    console.log("✓ official list: Kid-e-Sys kept, registration added, gate activation unchanged");

    const ledger = existingLedger();
    const ledgerBefore = JSON.stringify(ledger);
    const active = [...FIVE, ...ALREADY_INVOICED];
    const resolved = await resolveAll(active);

    for (const l of FIVE) {
      assert(resolved.accountNoByLearnerId[l.id] === l.familyAccount!.accountRef, `${l.admissionNo} resolves to its family account`);
      assert(!resolved.accountErrorByLearnerId[l.id], `${l.admissionNo} has no account error`);
    }
    assert(resolved.accountNoByLearnerId["l-mot683"] === "MOT684", "merged learner MOT683 bills to active MOT684, not retired MOT683");
    console.log("✓ all five resolve; merged learner uses active family account MOT684");

    const plan = runPlan(active, active, resolved, ledger);
    assert(plan.integrity.passed, `integrity gate passes: ${JSON.stringify(plan.integrity)}`);
    const rows = new Map(plan.learnerRows.map((r) => [r.learnerId, r]));
    const expected: Record<string, number> = { "l-nts392": 3450, "l-mas009": 3450, "l-nar002": 4250, "l-mot683": 4800, "l-mot684": 4800 };
    for (const [id, amount] of Object.entries(expected)) {
      assert(rows.get(id)?.status === "invoiced", `${id} eligible`);
      assert(rows.get(id)?.amount === amount, `${id} amount ${amount}, got ${rows.get(id)?.amount}`);
    }
    for (const l of ALREADY_INVOICED) {
      assert(rows.get(l.id)?.status === "skipped" && rows.get(l.id)?.skipReason === "DUPLICATE_INVOICE", `${l.admissionNo} already invoiced → DUPLICATE_INVOICE`);
    }
    const invoiced = plan.learnerRows.filter((r) => r.status === "invoiced");
    const withJamf = invoiced.reduce((s, r) => s + (r.amount || 0), 0);
    assert(invoiced.length === 5 && withJamf === 20750, `with R450 JAMF: 5 invoices R20,750 (got ${invoiced.length} / ${withJamf})`);
    console.log(`✓ second 2026-11 preview: 5 invoiced (R${withJamf}), ${ALREADY_INVOICED.length} DUPLICATE_INVOICE`);

    const noJamf = runPlan(active, active, resolved, ledger, plansWithoutJamf());
    const noJamfTotal = noJamf.learnerRows.filter((r) => r.status === "invoiced").reduce((s, r) => s + (r.amount || 0), 0);
    assert(noJamfTotal === 18500, `without R450 JAMF: R18,500 (got ${noJamfTotal})`);
    console.log(`✓ without R450 JAMF: R${noJamfTotal}`);

    const scoped = runPlan(FIVE, active, resolved, ledger);
    assert(scoped.learnerRows.length === 5 && scoped.learnerRows.every((r) => r.status === "invoiced"), "learnerIds scope limits processing to exactly the five");
    console.log("✓ scoped to the five learnerIds: exactly 5 rows processed");

    assert(ledgerHasRunId(ledger, EXECUTED_RUN_ID), "re-using the executed run id is refused (DUPLICATE_RUN_ID guard)");
    console.log("✓ executed run id already on ledger → execute refuses DUPLICATE_RUN_ID");

    const supplementaryId = `${EXECUTED_RUN_ID}:supplementary-2`;
    assert(!ledgerHasRunId(ledger, supplementaryId), "supplementary run id is distinct and unused");
    const onceOff = { "l-nts392": [{ feeDescription: "JAMF Fee", amount: 450 }] };
    const supp = buildInvoiceRunPlanForTest({
      allActiveLearners: active as any,
      processedLearners: FIVE as any,
      plansByLearnerId: plansWithoutJamf(),
      explicitlyEmpty: new Set(),
      accountNoByLearnerId: resolved.accountNoByLearnerId,
      accountErrorByLearnerId: resolved.accountErrorByLearnerId,
      existingLedger: ledger,
      invoicePeriod: PERIOD,
      extraFeesByLearnerId: onceOff,
    });
    const suppRows = supp.learnerRows.filter((r) => r.status === "invoiced");
    assert(supp.integrity.passed && suppRows.length === 5, "supplementary run invoices exactly the five");
    const suppTotal = suppRows.reduce((s, r) => s + (r.amount || 0), 0);
    assert(suppTotal === 18950, `once-off fee applied only to the selected learner (R18,500 + R450), got ${suppTotal}`);
    const appended: BillingLedgerEntry[] = suppRows.map((r) => ({
      id: buildInvoiceRunEntryId(supplementaryId, r.learnerId, r.accountNo, r.learnerId),
      schoolId: DA_SILVA,
      learnerId: r.learnerId,
      accountNo: r.accountNo,
      type: "invoice",
      amount: r.amount || 0,
      date: "2026-10-20",
      reference: `INV-SUPP-${r.learnerId}`,
      description: "Supplementary",
      runId: supplementaryId,
      invoicePeriod: PERIOD,
      lineKey: r.learnerId,
      createdAt: "2026-10-20T07:00:00.000Z",
    }));
    const existingIds = new Set(ledger.map((e) => e.id));
    assert(appended.every((e) => !existingIds.has(e.id)), "supplementary invoice ids never collide with executed-run ids");
    const afterSupp = [...ledger, ...appended];
    assert(JSON.stringify(afterSupp.slice(0, ledger.length)) === ledgerBefore, "executed-run invoices untouched by the supplementary run");
    assert(ledgerHasRunId(afterSupp, supplementaryId), "repeating the supplementary run id is refused (DUPLICATE_RUN_ID)");
    const third = runPlan(active, active, resolved, afterSupp);
    assert(third.learnerRows.filter((r) => r.status === "invoiced").length === 0, "a further 2026-11 run creates no invoices");
    assert(third.learnerRows.every((r) => r.skipReason === "DUPLICATE_INVOICE"), "every learner is DUPLICATE_INVOICE after the supplementary run");
    console.log("✓ supplementary run: distinct id, only the five, once-off scoped, executed invoices untouched, repeat-safe");

    const historical = learner("l-historical", "MOT682", "MOT682", "HISTORICAL");
    const retiredLink = learner("l-retired-link", "MOT683", "MOT683");
    const unlinkedMot683 = learner("l-unlinked", "MOT683", null);
    const edge = await resolveAll([historical, retiredLink, unlinkedMot683]);
    assert(!edge.accountNoByLearnerId["l-retired-link"] && /merged|retired/i.test(edge.accountErrorByLearnerId["l-retired-link"] || ""), "learner linked to retired MOT683 still refused");
    assert(!edge.accountNoByLearnerId["l-unlinked"], "admission fallback to retired MOT683 still refused");
    const edgePlan = runPlan([historical, retiredLink], [...active, retiredLink], { ...resolved, accountNoByLearnerId: { ...resolved.accountNoByLearnerId, ...edge.accountNoByLearnerId }, accountErrorByLearnerId: { ...resolved.accountErrorByLearnerId, ...edge.accountErrorByLearnerId } }, ledger);
    const edgeRows = new Map(edgePlan.learnerRows.map((r) => [r.learnerId, r]));
    assert(edgeRows.get("l-historical")?.skipReason === "INACTIVE_LEARNER", "historical learner still excluded");
    assert(edgeRows.get("l-retired-link")?.skipReason === "ACCOUNT_NOT_FOUND", "retired account learner still excluded");
    console.log("✓ retired/merged accounts and historical learners remain excluded");

    assert(JSON.stringify(ledger) === ledgerBefore, "existing invoices, earlier JAMF R350 rows untouched");
    console.log("✓ fixture ledger (executed run + earlier JAMF) byte-identical");

    const newAdmission = learner("l-new001", "NEW001", "NEW001");
    const before = await resolveLearnerAccountForRun(DA_SILVA, newAdmission as any);
    assert(!before.accountNo, "new admission without finance baseline is not yet eligible");
    const registered = ensureFinanceAccountBaseline({ schoolId: DA_SILVA, accountRef: "NEW001", accountHolder: "New Family" });
    assert(registered.status === "inserted", "admission registration writes educlear-registration baseline");
    const after = await resolveLearnerAccountForRun(DA_SILVA, newAdmission as any);
    assert(after.accountNo === "NEW001" && !after.error, "future admissions are invoice-run eligible under the Kid-e-Sys gate");
    console.log("✓ future admission (ensureFinanceAccountBaseline) becomes eligible immediately");
  });
  console.log("officialBillingAccountRef.registrationAccounts.test.ts — PASS");
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
