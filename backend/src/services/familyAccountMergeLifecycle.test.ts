/**
 * Family account merge-retirement lifecycle tests.
 * Run: npx ts-node --transpile-only src/services/familyAccountMergeLifecycle.test.ts
 *
 * Local DATABASE_URL only. Never production. MOT682 is not created or mutated.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { PrismaClient } from "@prisma/client";

import { mergeFamilyAccounts } from "./familyAccountService";
import {
  FAMILY_ACCOUNT_MERGED_ERROR_CODE,
  FamilyAccountMergedError,
  assertFamilyAccountAcceptsNewBillingWrites,
  isFamilyAccountActive,
  listActiveFamilyAccountsForSchool,
  listRetiredFamilyAccountsForSchool,
} from "./familyAccountLifecycle";
import { planFamilyAccountMergeLifecycleBackfill } from "./familyAccountMergeLifecycleBackfill";
import { matchLearnersToAccountHolder } from "./familyAccountMembers";
import { resolveInvoiceAccountNo } from "./invoiceEntryBuilder";
import { resolveLearnerAccountForRun } from "./invoiceRunExecuteService";
import { buildAccountsFromAgeAnalysisSnapshots } from "./statementAccounts";
import { invalidateOfficialBillingAccountRefsCache } from "./officialBillingAccountRef";
import {
  insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent,
  invalidateFamilyAccountAgeAnalysisFileCache,
  readSchoolFamilyAccountAgeAnalysisSnapshots,
  setFamilyAccountAgeAnalysisStoreDataDirForTests,
  type FamilyAccountAgeAnalysisSnapshot,
} from "../utils/familyAccountAgeAnalysisStore";
import {
  appendSchoolEntry,
  listInvoices,
  listPayments,
  readSchoolLedger,
  setBillingLedgerStoreDataDirForTests,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import { setFamilyAccountAuditStoreDataDirForTests } from "../utils/familyAccountAuditStore";

const prisma = new PrismaClient();

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function isLocalDatabase(): boolean {
  const url = String(process.env.DATABASE_URL || "");
  return /localhost|127\.0\.0\.1/.test(url);
}

async function lifecycleColumnsExist(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'FamilyAccount'
      AND column_name IN ('retiredAt', 'mergedIntoFamilyAccountId')
  `;
  return rows.length === 2;
}

function makeTempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fa-lifecycle-test-"));
  fs.writeFileSync(path.join(dir, "family-account-age-analysis.json"), "{}", "utf8");
  fs.writeFileSync(path.join(dir, "billing-ledger.json"), "{}", "utf8");
  fs.writeFileSync(path.join(dir, "family-account-audit.json"), "{}", "utf8");
  return dir;
}

function snapshot(
  schoolId: string,
  accountRef: string,
  balance: number,
  extra: Partial<FamilyAccountAgeAnalysisSnapshot> = {}
): FamilyAccountAgeAnalysisSnapshot {
  return {
    schoolId,
    accountRef,
    accountHolder: extra.accountHolder || `${accountRef} Holder`,
    balance,
    buckets: { current: balance, d30: 0, d60: 0, d90: 0, d120: 0 },
    kidesysSection: extra.kidesysSection || "Recently Owing",
    source: extra.source || "kideesys-age-analysis",
    importedAt: extra.importedAt || "2026-05-28T08:00:00.000Z",
  };
}

function ledgerTotals(schoolId: string) {
  const ledger = readSchoolLedger(schoolId);
  const invoices = listInvoices(schoolId);
  const payments = listPayments(schoolId);
  const credits = ledger.filter((e) => e.type === "credit");
  const sum = (rows: BillingLedgerEntry[]) =>
    Math.round(rows.reduce((acc, row) => acc + (Number(row.amount) || 0), 0) * 100) / 100;
  const debitTypes = new Set(["invoice", "penalty"]);
  const creditTypes = new Set(["payment", "credit"]);
  return {
    ledgerRows: ledger.length,
    invoiceCount: invoices.length,
    invoiceGross: sum(invoices),
    paymentRows: payments.length,
    paymentGross: sum(payments),
    creditRows: credits.length,
    debitTotal: sum(ledger.filter((e) => debitTypes.has(e.type))),
    creditTotal: sum(ledger.filter((e) => creditTypes.has(e.type))),
  };
}

async function withTempStores<T>(fn: () => Promise<T>): Promise<T> {
  const tempDir = makeTempDataDir();
  setFamilyAccountAgeAnalysisStoreDataDirForTests(tempDir);
  setBillingLedgerStoreDataDirForTests(tempDir);
  setFamilyAccountAuditStoreDataDirForTests(tempDir);
  invalidateFamilyAccountAgeAnalysisFileCache();
  invalidateOfficialBillingAccountRefsCache();
  try {
    return await fn();
  } finally {
    setFamilyAccountAgeAnalysisStoreDataDirForTests(null);
    setBillingLedgerStoreDataDirForTests(null);
    setFamilyAccountAuditStoreDataDirForTests(null);
    invalidateFamilyAccountAgeAnalysisFileCache();
    invalidateOfficialBillingAccountRefsCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function createTestSchool(name: string, email: string): Promise<{ id: string }> {
  const id = `fa_lc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await prisma.$executeRaw`
    INSERT INTO "School" (id, name, email, "createdAt")
    VALUES (${id}, ${name}, ${email}, NOW())
  `;
  return { id };
}

async function cleanupSchool(schoolId: string) {
  await prisma.billingDeposit.deleteMany({ where: { schoolId } });
  await prisma.learner.deleteMany({ where: { schoolId } });
  await prisma.parent.deleteMany({ where: { schoolId } });
  await prisma.familyAccount.updateMany({
    where: { schoolId },
    data: { mergedIntoFamilyAccountId: null, retiredAt: null },
  });
  await prisma.familyAccount.deleteMany({ where: { schoolId } });
  await prisma.$executeRaw`DELETE FROM "School" WHERE id = ${schoolId}`;
}

function addLedgerEntry(
  schoolId: string,
  partial: Partial<BillingLedgerEntry> & Pick<BillingLedgerEntry, "accountNo" | "type" | "amount">
) {
  appendSchoolEntry(schoolId, {
    id: partial.id || `${partial.type}-${partial.accountNo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    schoolId,
    learnerId: partial.learnerId || "",
    accountNo: partial.accountNo,
    type: partial.type,
    amount: partial.amount,
    date: partial.date || "2026-06-01",
    reference: partial.reference || `${partial.type}-ref`,
    description: partial.description || partial.type,
    createdAt: partial.createdAt || "2026-01-01T00:00:00.000Z",
  });
}

function testMatchLearnersPrefersCanonicalFamily() {
  const lek = "fa-lek003";
  const mor = "fa-mor013";
  const paballo = {
    id: "learner-paballo",
    firstName: "Paballo",
    lastName: "Moruledi",
    familyAccountId: lek,
  };
  const unmatched = {
    id: "learner-unlinked",
    firstName: "Paballo",
    lastName: "Moruledi",
    familyAccountId: null,
  };

  const ontoMor = matchLearnersToAccountHolder([paballo], "Paballo Moruledi", {
    familyAccountId: mor,
  });
  assert(ontoMor.length === 0, "Paballo linked to LEK003 must not name-match onto MOR013");

  const ontoLek = matchLearnersToAccountHolder([paballo], "Paballo Moruledi", {
    familyAccountId: lek,
  });
  assert(ontoLek.length === 1 && ontoLek[0].id === paballo.id, "Paballo still matches own LEK003 holder");

  const imported = matchLearnersToAccountHolder([unmatched], "Paballo Moruledi", {
    familyAccountId: mor,
  });
  assert(imported.length === 1, "unlinked imported learner may still name-match");
  console.log("✓ matchLearnersToAccountHolder prefers canonical familyAccountId");
}

function testBackfillResolvesReversalNotBlindSources() {
  const lek = {
    id: "id-lek003",
    schoolId: "school-a",
    accountRef: "LEK003",
    retiredAt: null,
    mergedIntoFamilyAccountId: null,
    learnerCount: 2,
  };
  const mor = {
    id: "id-mor013",
    schoolId: "school-a",
    accountRef: "MOR013",
    retiredAt: null,
    mergedIntoFamilyAccountId: null,
    learnerCount: 0,
  };
  const plan = planFamilyAccountMergeLifecycleBackfill({
    schoolId: "school-a",
    familyAccounts: [lek, mor],
    audits: [
      {
        schoolId: "school-a",
        action: "merge",
        createdAt: "2026-07-22T10:11:00.000Z",
        sourceFamilyAccountId: lek.id,
        targetFamilyAccountId: mor.id,
        sourceAccountRef: "LEK003",
        targetAccountRef: "MOR013",
      },
      {
        schoolId: "school-a",
        action: "merge",
        createdAt: "2026-07-22T10:19:00.000Z",
        sourceFamilyAccountId: mor.id,
        targetFamilyAccountId: lek.id,
        sourceAccountRef: "MOR013",
        targetAccountRef: "LEK003",
      },
    ],
  });
  assert(plan.financialChanges === 0, "backfill proposes zero financial changes");
  assert(plan.reversalsDetected === 1, "LEK003→MOR013 then MOR013→LEK003 is a reversal");
  assert(plan.proposals.length === 1, "only the final predecessor is proposed");
  assert(plan.proposals[0].accountRef === "MOR013", "canonical source is MOR013");
  assert(plan.proposals[0].mergedIntoAccountRef === "LEK003", "canonical survivor is LEK003");
  assert(
    !plan.proposals.some((row) => row.accountRef === "LEK003"),
    "must not retire LEK003 from the reversed first merge"
  );
  console.log("✓ backfill dry-run resolves MOR013 → LEK003 after reversal");
}

function testBackfillSkipsMot682() {
  const plan = planFamilyAccountMergeLifecycleBackfill({
    schoolId: "school-a",
    familyAccounts: [
      {
        id: "id-mot682",
        schoolId: "school-a",
        accountRef: "MOT682",
        retiredAt: null,
        mergedIntoFamilyAccountId: null,
        learnerCount: 0,
      },
      {
        id: "id-other",
        schoolId: "school-a",
        accountRef: "OTH001",
        retiredAt: null,
        mergedIntoFamilyAccountId: null,
        learnerCount: 1,
      },
    ],
    audits: [
      {
        schoolId: "school-a",
        action: "merge",
        createdAt: "2026-08-01T00:00:00.000Z",
        sourceFamilyAccountId: "id-mot682",
        targetFamilyAccountId: "id-other",
        sourceAccountRef: "MOT682",
        targetAccountRef: "OTH001",
      },
    ],
  });
  assert(plan.proposals.length === 0, "MOT682 must not be proposed for retirement");
  assert(
    plan.skipped.some((row) => /MOT682/.test(row.reason)),
    "MOT682 skip reason recorded"
  );
  console.log("✓ backfill dry-run leaves MOT682 out of scope");
}

function testNullableLifecycleIsActive() {
  assert(isFamilyAccountActive({ retiredAt: null, mergedIntoFamilyAccountId: null }), "null/null is active");
  assert(!isFamilyAccountActive({ retiredAt: new Date(), mergedIntoFamilyAccountId: null }), "retiredAt hides");
  assert(
    !isFamilyAccountActive({ retiredAt: null, mergedIntoFamilyAccountId: "fa-surviving" }),
    "mergedInto hides"
  );
  console.log("✓ existing FamilyAccounts stay active when lifecycle fields are null");
}

async function testFixtureAMor013Lek003() {
  if (!isLocalDatabase()) {
    console.log("⊘ Fixture A skipped (non-local DATABASE_URL)");
    return;
  }
  if (!(await lifecycleColumnsExist())) {
    throw new Error(
      "FamilyAccount lifecycle columns are not on local PostgreSQL. Apply only prisma/migrations/20260901120000_family_account_merge_lifecycle (do not prisma migrate deploy unrelated pending migrations)."
    );
  }

  const suffix = Date.now();
  const school = await createTestSchool(`FA Lifecycle A ${suffix}`, `fa-a-${suffix}@test.local`);

  await withTempStores(async () => {
    const lek = await prisma.familyAccount.create({
      data: { schoolId: school.id, accountRef: "LEK003", familyName: "Lekalakala" },
    });
    const mor = await prisma.familyAccount.create({
      data: { schoolId: school.id, accountRef: "MOR013", familyName: "Moruledi" },
    });
    const paballo = await prisma.learner.create({
      data: {
        schoolId: school.id,
        familyAccountId: lek.id,
        firstName: "Paballo",
        lastName: "Moruledi",
        grade: "8",
        admissionNo: "MOR013",
        enrollmentStatus: "ACTIVE",
      },
    });
    const phetogo = await prisma.learner.create({
      data: {
        schoolId: school.id,
        familyAccountId: lek.id,
        firstName: "Phetogo",
        lastName: "Lekalakala",
        grade: "5",
        admissionNo: "LEK003",
        enrollmentStatus: "ACTIVE",
      },
    });
    await prisma.billingDeposit.create({
      data: {
        schoolId: school.id,
        depositNumber: `DEP-A-${suffix}`,
        familyAccountId: lek.id,
        learnerId: paballo.id,
        amount: 500,
        remainingBalance: 500,
        depositDate: new Date("2026-06-01"),
      },
    });

    insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
      school.id,
      "LEK003",
      snapshot(school.id, "LEK003", 8100, { accountHolder: "Phetogo Lekalakala / Paballo Moruledi" })
    );
    insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
      school.id,
      "MOR013",
      snapshot(school.id, "MOR013", 10670, { accountHolder: "Paballo Moruledi" })
    );
    invalidateOfficialBillingAccountRefsCache(school.id);

    addLedgerEntry(school.id, {
      id: `inv-lek-${suffix}`,
      accountNo: "LEK003",
      learnerId: paballo.id,
      type: "invoice",
      amount: 2000,
    });
    addLedgerEntry(school.id, {
      id: `pay-lek-${suffix}`,
      accountNo: "LEK003",
      learnerId: paballo.id,
      type: "payment",
      amount: 500,
    });
    addLedgerEntry(school.id, {
      id: `crd-lek-${suffix}`,
      accountNo: "LEK003",
      learnerId: paballo.id,
      type: "credit",
      amount: 100,
    });

    const beforeAccounts = await buildAccountsFromAgeAnalysisSnapshots(school.id);
    const beforeMor = beforeAccounts.find((row) => row.accountNo === "MOR013");
    const beforeLek = beforeAccounts.find((row) => row.accountNo === "LEK003");
    assert(Boolean(beforeMor), "before: MOR013 listed while still active");
    assert(beforeLek?.balance === 8100, `before: LEK003 balance 8100, got ${beforeLek?.balance}`);
    assert(
      !beforeMor?.memberLearnerIds.includes(paballo.id),
      "canonical familyAccountId prevents Paballo attaching to MOR013 by name"
    );
    assert(
      Boolean(beforeLek?.memberLearnerIds.includes(paballo.id)),
      "Paballo is a member of LEK003 before retirement"
    );
    const beforeFinance = ledgerTotals(school.id);
    const beforeDeposits = await prisma.billingDeposit.count({ where: { schoolId: school.id } });
    const beforeOutstanding = beforeAccounts.reduce((sum, row) => sum + row.balance, 0);

    await prisma.familyAccount.update({
      where: { id: mor.id },
      data: { retiredAt: new Date("2026-07-22T10:19:00.000Z"), mergedIntoFamilyAccountId: lek.id },
    });

    const afterAccounts = await buildAccountsFromAgeAnalysisSnapshots(school.id);
    const afterMor = afterAccounts.find((row) => row.accountNo === "MOR013");
    const afterLek = afterAccounts.find((row) => row.accountNo === "LEK003");
    const afterOutstanding = afterAccounts.reduce((sum, row) => sum + row.balance, 0);
    const afterFinance = ledgerTotals(school.id);
    const afterDeposits = await prisma.billingDeposit.count({ where: { schoolId: school.id } });

    assert(!afterMor, "after: MOR013 is not an active statement account");
    assert(afterLek?.balance === 8100, "after: LEK003 balance remains R8,100");
    assert(
      afterLek?.memberLearnerIds.includes(paballo.id) && afterLek.memberLearnerIds.includes(phetogo.id),
      "siblings remain on LEK003"
    );
    assert(
      afterAccounts.filter((row) => row.memberLearnerIds.includes(paballo.id)).length === 1,
      "Paballo appears only under LEK003"
    );
    assert(
      Math.abs(beforeOutstanding - afterOutstanding - 10670) < 0.001,
      `presentation drop must be exactly MOR013 R10,670 (before ${beforeOutstanding} after ${afterOutstanding})`
    );
    assert(afterFinance.ledgerRows === beforeFinance.ledgerRows, "ledger rows unchanged");
    assert(afterFinance.invoiceCount === beforeFinance.invoiceCount, "invoice count unchanged");
    assert(afterFinance.invoiceGross === beforeFinance.invoiceGross, "invoice gross unchanged");
    assert(afterFinance.paymentRows === beforeFinance.paymentRows, "payment rows unchanged");
    assert(afterFinance.debitTotal === beforeFinance.debitTotal, "debit totals unchanged");
    assert(afterFinance.creditTotal === beforeFinance.creditTotal, "credit totals unchanged");
    assert(afterDeposits === beforeDeposits, "deposits unchanged");

    const snapshots = readSchoolFamilyAccountAgeAnalysisSnapshots(school.id);
    assert(snapshots.MOR013?.balance === 10670, "MOR013 snapshot retained for audit");

    const retired = await listRetiredFamilyAccountsForSchool(school.id);
    assert(retired.some((row) => row.accountRef === "MOR013"), "MOR013 queryable as retired/audit");
    const active = await listActiveFamilyAccountsForSchool(school.id);
    assert(!active.some((row) => row.accountRef === "MOR013"), "MOR013 absent from active billing list");
    assert(active.some((row) => row.accountRef === "LEK003"), "LEK003 remains active");

    let invoiceBlocked = false;
    try {
      await assertFamilyAccountAcceptsNewBillingWrites({
        schoolId: school.id,
        accountRef: "MOR013",
        familyAccountId: mor.id,
      });
    } catch (error) {
      invoiceBlocked = error instanceof FamilyAccountMergedError;
      assert(
        error instanceof FamilyAccountMergedError && error.errorCode === FAMILY_ACCOUNT_MERGED_ERROR_CODE,
        "merged error code"
      );
      assert(error.survivingAccountRef === "LEK003", "error identifies surviving account");
    }
    assert(invoiceBlocked, "MOR013 cannot receive new invoices/payments");

    const built = await resolveInvoiceAccountNo(school.id, { accountNo: "MOR013" });
    assert(built.errorCode === FAMILY_ACCOUNT_MERGED_ERROR_CODE, "invoice builder rejects retired MOR013");

    const paymentBlocked = await assertFamilyAccountAcceptsNewBillingWrites({
      schoolId: school.id,
      accountRef: "LEK003",
    })
      .then(() => false)
      .catch(() => true);
    assert(!paymentBlocked, "survivor LEK003 remains writable");

    const runAccount = await resolveLearnerAccountForRun(school.id, {
      id: paballo.id,
      firstName: "Paballo",
      lastName: "Moruledi",
      enrollmentStatus: "ACTIVE",
      admissionNo: "MOR013",
      idNumber: null,
      familyAccountId: lek.id,
      familyAccount: { accountRef: "LEK003" },
    });
    assert(runAccount.accountNo === "LEK003", "invoice run posts to survivor");
  });

  await cleanupSchool(school.id);
  console.log("✓ Fixture A MOR013 → LEK003 retirement presentation + write guard");
}

async function testFixtureBMot683Mot684() {
  if (!isLocalDatabase()) {
    console.log("⊘ Fixture B skipped (non-local DATABASE_URL)");
    return;
  }

  const suffix = Date.now();
  const school = await createTestSchool(`FA Lifecycle B ${suffix}`, `fa-b-${suffix}@test.local`);

  await withTempStores(async () => {
    const mot683 = await prisma.familyAccount.create({
      data: { schoolId: school.id, accountRef: "MOT683", familyName: "Motsilanyane 683" },
    });
    const mot684 = await prisma.familyAccount.create({
      data: { schoolId: school.id, accountRef: "MOT684", familyName: "Motsilanyane 684" },
    });
    const learner = await prisma.learner.create({
      data: {
        schoolId: school.id,
        familyAccountId: mot683.id,
        firstName: "Leano",
        lastName: "Motsilanyane",
        grade: "R",
        admissionNo: "MOT683",
        enrollmentStatus: "ACTIVE",
      },
    });

    insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
      school.id,
      "MOT683",
      snapshot(school.id, "MOT683", 0, {
        source: "educlear-registration",
        accountHolder: "Leano Motsilanyane",
      })
    );
    insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
      school.id,
      "MOT684",
      snapshot(school.id, "MOT684", 14600, { accountHolder: "Leano Motsilanyane" })
    );
    invalidateOfficialBillingAccountRefsCache(school.id);

    addLedgerEntry(school.id, {
      id: `inv-mot684-${suffix}`,
      accountNo: "MOT684",
      learnerId: learner.id,
      type: "invoice",
      amount: 14600,
    });
    const beforeFinance = ledgerTotals(school.id);

    const first = await mergeFamilyAccounts({
      schoolId: school.id,
      sourceFamilyAccountId: mot683.id,
      targetFamilyAccountId: mot684.id,
    });
    assert(first.success, "merge succeeds");

    const source = await prisma.familyAccount.findUnique({ where: { id: mot683.id } });
    const target = await prisma.familyAccount.findUnique({ where: { id: mot684.id } });
    assert(Boolean(source?.retiredAt), "MOT683 retiredAt set");
    assert(source?.mergedIntoFamilyAccountId === mot684.id, "MOT683 merged into MOT684");
    assert(!target?.retiredAt && !target?.mergedIntoFamilyAccountId, "MOT684 remains active");

    const moved = await prisma.learner.findUnique({ where: { id: learner.id } });
    assert(moved?.familyAccountId === mot684.id, "learner moved to MOT684");

    const accounts = await buildAccountsFromAgeAnalysisSnapshots(school.id);
    assert(!accounts.some((row) => row.accountNo === "MOT683"), "MOT683 absent from active billing lists");
    const survivor = accounts.find((row) => row.accountNo === "MOT684");
    assert(survivor?.balance === 14600, `MOT684 remains R14,600, got ${survivor?.balance}`);

    const afterFinance = ledgerTotals(school.id);
    assert(afterFinance.invoiceGross === beforeFinance.invoiceGross, "no financial totals change");
    assert(afterFinance.ledgerRows === beforeFinance.ledgerRows, "ledger row count unchanged");

    const second = await mergeFamilyAccounts({
      schoolId: school.id,
      sourceFamilyAccountId: mot683.id,
      targetFamilyAccountId: mot684.id,
    });
    assert(second.alreadyMerged === true, "repeated merge is idempotent");
    const sourceAgain = await prisma.familyAccount.findUnique({ where: { id: mot683.id } });
    assert(sourceAgain?.mergedIntoFamilyAccountId === mot684.id, "repeat cannot retarget");

    let writeBlocked = false;
    try {
      await assertFamilyAccountAcceptsNewBillingWrites({ schoolId: school.id, accountRef: "MOT683" });
    } catch (error) {
      writeBlocked = error instanceof FamilyAccountMergedError;
    }
    assert(writeBlocked, "MOT683 cannot receive new payments");
  });

  await cleanupSchool(school.id);
  console.log("✓ Fixture B MOT683 → MOT684 live merge retirement");
}

async function testFixtureCFlyEagleUnmatchedSnapshot() {
  if (!isLocalDatabase()) {
    console.log("⊘ Fixture C skipped (non-local DATABASE_URL)");
    return;
  }

  const suffix = Date.now();
  const school = await createTestSchool(`FA Lifecycle C ${suffix}`, `fa-c-${suffix}@test.local`);

  await withTempStores(async () => {
    const emptyFa = await prisma.familyAccount.create({
      data: { schoolId: school.id, accountRef: "FLE002", familyName: "Empty Migration Shell" },
    });
    insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
      school.id,
      "FLE001",
      snapshot(school.id, "FLE001", 3200, {
        source: "kideesys-age-analysis",
        importedAt: "2026-01-15T00:00:00.000Z",
        accountHolder: "Unmatched Migration Family",
      })
    );
    insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
      school.id,
      "FLE002",
      snapshot(school.id, "FLE002", 150, {
        source: "kideesys-age-analysis",
        accountHolder: "Zero Learner Migration Shell",
      })
    );
    invalidateOfficialBillingAccountRefsCache(school.id);

    const accounts = await buildAccountsFromAgeAnalysisSnapshots(school.id);
    const unmatched = accounts.find((row) => row.accountNo === "FLE001");
    const emptyShell = accounts.find((row) => row.accountNo === "FLE002");
    assert(Boolean(unmatched), "Fly Eagle unmatched snapshot remains visible");
    assert((unmatched?.memberLearnerIds || []).length === 0, "zero matched learners");
    assert(unmatched?.lifecycleStatus === "active", "not retired");
    assert(unmatched?.balance === 3200, "balance unchanged");
    assert(Boolean(emptyShell), "zero-learner non-merged FamilyAccount remains visible");
    assert(emptyShell?.familyAccountId === emptyFa.id, "empty shell still listed");
    assert(emptyShell?.lifecycleStatus === "active", "empty shell is not retired");
  });

  await cleanupSchool(school.id);
  console.log("✓ Fixture C unmatched non-merged snapshot remains visible");
}

async function testFixtureDMagicalOrdinaryAccount() {
  if (!isLocalDatabase()) {
    console.log("⊘ Fixture D skipped (non-local DATABASE_URL)");
    return;
  }

  const suffix = Date.now();
  const school = await createTestSchool(`FA Lifecycle D ${suffix}`, `fa-d-${suffix}@test.local`);

  await withTempStores(async () => {
    const fa = await prisma.familyAccount.create({
      data: { schoolId: school.id, accountRef: "MAG010", familyName: "Magical Family" },
    });
    await prisma.learner.create({
      data: {
        schoolId: school.id,
        familyAccountId: fa.id,
        firstName: "Normal",
        lastName: "Learner",
        grade: "3",
        admissionNo: "MAG010",
        enrollmentStatus: "ACTIVE",
      },
    });
    insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
      school.id,
      "MAG010",
      snapshot(school.id, "MAG010", 450, { accountHolder: "Normal Learner" })
    );
    invalidateOfficialBillingAccountRefsCache(school.id);

    const accounts = await buildAccountsFromAgeAnalysisSnapshots(school.id);
    const row = accounts.find((a) => a.accountNo === "MAG010");
    assert(Boolean(row), "Magical ordinary account still listed");
    assert(row?.lifecycleStatus === "active", "no merge state");
    assert(row?.balance === 450, "balance unchanged");
    await assertFamilyAccountAcceptsNewBillingWrites({ schoolId: school.id, accountRef: "MAG010" });
  });

  await cleanupSchool(school.id);
  console.log("✓ Fixture D Magical ordinary account unchanged");
}

async function testFixtureECrossTenantMerge() {
  if (!isLocalDatabase()) {
    console.log("⊘ Fixture E skipped (non-local DATABASE_URL)");
    return;
  }

  const suffix = Date.now();
  const schoolA = await createTestSchool(`FA Lifecycle E-A ${suffix}`, `fa-ea-${suffix}@test.local`);
  const schoolB = await createTestSchool(`FA Lifecycle E-B ${suffix}`, `fa-eb-${suffix}@test.local`);

  await withTempStores(async () => {
    const source = await prisma.familyAccount.create({
      data: { schoolId: schoolA.id, accountRef: "SRC001", familyName: "School A Source" },
    });
    const target = await prisma.familyAccount.create({
      data: { schoolId: schoolB.id, accountRef: "TGT001", familyName: "School B Target" },
    });
    const learner = await prisma.learner.create({
      data: {
        schoolId: schoolA.id,
        familyAccountId: source.id,
        firstName: "Cross",
        lastName: "Tenant",
        grade: "1",
        admissionNo: "SRC001",
        enrollmentStatus: "ACTIVE",
      },
    });
    insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
      schoolA.id,
      "SRC001",
      snapshot(schoolA.id, "SRC001", 99)
    );
    addLedgerEntry(schoolA.id, { accountNo: "SRC001", type: "invoice", amount: 99, learnerId: learner.id });
    const beforeFinance = ledgerTotals(schoolA.id);
    const beforeLearner = await prisma.learner.findUnique({ where: { id: learner.id } });
    const beforeSource = await prisma.familyAccount.findUnique({ where: { id: source.id } });
    const beforeTarget = await prisma.familyAccount.findUnique({ where: { id: target.id } });

    let threw = "";
    try {
      await mergeFamilyAccounts({
        schoolId: schoolA.id,
        sourceFamilyAccountId: source.id,
        targetFamilyAccountId: target.id,
      });
    } catch (error) {
      threw = error instanceof Error ? error.message : "error";
    }
    assert(/across schools/i.test(threw), `cross-school merge must hard reject, got: ${threw}`);

    const afterLearner = await prisma.learner.findUnique({ where: { id: learner.id } });
    const afterSource = await prisma.familyAccount.findUnique({ where: { id: source.id } });
    const afterTarget = await prisma.familyAccount.findUnique({ where: { id: target.id } });
    const afterFinance = ledgerTotals(schoolA.id);
    assert(afterLearner?.familyAccountId === beforeLearner?.familyAccountId, "no learner mutation");
    assert(!afterSource?.retiredAt && !afterSource?.mergedIntoFamilyAccountId, "no source lifecycle mutation");
    assert(!afterTarget?.retiredAt && !afterTarget?.mergedIntoFamilyAccountId, "no target lifecycle mutation");
    assert(afterSource?.familyName === beforeSource?.familyName, "source row otherwise unchanged");
    assert(afterTarget?.familyName === beforeTarget?.familyName, "target row otherwise unchanged");
    assert(afterFinance.ledgerRows === beforeFinance.ledgerRows, "no ledger mutation");
    const snaps = readSchoolFamilyAccountAgeAnalysisSnapshots(schoolA.id);
    assert(snaps.SRC001?.balance === 99, "no snapshot mutation");
  });

  await cleanupSchool(schoolA.id);
  await cleanupSchool(schoolB.id);
  console.log("✓ Fixture E cross-tenant merge hard reject with zero writes");
}

async function testMergeFailureDoesNotRetire() {
  if (!isLocalDatabase()) {
    console.log("⊘ merge failure rollback skipped (non-local DATABASE_URL)");
    return;
  }

  const suffix = Date.now();
  const school = await createTestSchool(`FA Lifecycle Fail ${suffix}`, `fa-fail-${suffix}@test.local`);

  await withTempStores(async () => {
    const emptySource = await prisma.familyAccount.create({
      data: { schoolId: school.id, accountRef: "EMP001", familyName: "Empty" },
    });
    const target = await prisma.familyAccount.create({
      data: { schoolId: school.id, accountRef: "TGT002", familyName: "Target" },
    });
    await prisma.learner.create({
      data: {
        schoolId: school.id,
        familyAccountId: target.id,
        firstName: "Keep",
        lastName: "Here",
        grade: "2",
        admissionNo: "TGT002",
        enrollmentStatus: "ACTIVE",
      },
    });

    let threw = false;
    try {
      await mergeFamilyAccounts({
        schoolId: school.id,
        sourceFamilyAccountId: emptySource.id,
        targetFamilyAccountId: target.id,
      });
    } catch {
      threw = true;
    }
    assert(threw, "empty source merge fails");
    const source = await prisma.familyAccount.findUnique({ where: { id: emptySource.id } });
    assert(!source?.retiredAt && !source?.mergedIntoFamilyAccountId, "failed merge does not retire source");
  });

  await cleanupSchool(school.id);
  console.log("✓ merge failure does not apply lifecycle mutation");
}

async function main() {
  if (isLocalDatabase() && !(await lifecycleColumnsExist())) {
    throw new Error(
      "FamilyAccount lifecycle columns are not on local PostgreSQL. Apply only prisma/migrations/20260901120000_family_account_merge_lifecycle against localhost educlear. Do not prisma migrate deploy unrelated pending migrations, and do not apply this to production."
    );
  }
  let passed = 0;
  let failed = 0;
  const run = async (fn: () => Promise<void> | void) => {
    try {
      await fn();
      passed += 1;
    } catch (error) {
      failed += 1;
      console.error("✗", error instanceof Error ? error.stack || error.message : error);
    }
  };

  await run(async () => testMatchLearnersPrefersCanonicalFamily());
  await run(async () => testBackfillResolvesReversalNotBlindSources());
  await run(async () => testBackfillSkipsMot682());
  await run(async () => testNullableLifecycleIsActive());
  await run(testFixtureAMor013Lek003);
  await run(testFixtureBMot683Mot684);
  await run(testFixtureCFlyEagleUnmatchedSnapshot);
  await run(testFixtureDMagicalOrdinaryAccount);
  await run(testFixtureECrossTenantMerge);
  await run(testMergeFailureDoesNotRetire);

  console.log(`\nfamilyAccountMergeLifecycle.test.ts: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
