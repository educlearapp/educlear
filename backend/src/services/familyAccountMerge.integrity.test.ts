/**
 * Family billing-account merge integrity tests (Tests A–J).
 * Run: npx ts-node --transpile-only src/services/familyAccountMerge.integrity.test.ts
 */
import fs from "fs";
import os from "os";
import path from "path";

import { PrismaClient } from "@prisma/client";

import { mergeFamilyAccounts } from "./familyAccountService";
import { scanFamilyAccountIntegrity } from "./familyAccountIntegrityScan";
import { buildAccountsFromAgeAnalysisSnapshots } from "./statementAccounts";
import { invalidateOfficialBillingAccountRefsCache } from "./officialBillingAccountRef";
import {
  insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent,
  invalidateFamilyAccountAgeAnalysisFileCache,
  readSchoolFamilyAccountAgeAnalysisSnapshots,
  retireAgeAnalysisSnapshot,
  setFamilyAccountAgeAnalysisStoreDataDirForTests,
  type FamilyAccountAgeAnalysisSnapshot,
} from "../utils/familyAccountAgeAnalysisStore";
import {
  setBillingLedgerStoreDataDirForTests,
  writeSchoolLedger,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import {
  listFamilyAccountAudit,
  setFamilyAccountAuditStoreDataDirForTests,
} from "../utils/familyAccountAuditStore";

const prisma = new PrismaClient();

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function isLocalDatabase(): boolean {
  const url = String(process.env.DATABASE_URL || "");
  return /localhost|127\.0\.0\.1/.test(url);
}

function makeTempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "family-merge-test-"));
  fs.writeFileSync(path.join(dir, "family-account-age-analysis.json"), "{}", "utf8");
  fs.writeFileSync(path.join(dir, "billing-ledger.json"), "{}", "utf8");
  fs.writeFileSync(path.join(dir, "family-account-audit.json"), "{}", "utf8");
  return dir;
}

function nativeSnapshot(
  schoolId: string,
  accountRef: string,
  holder: string,
  balance: number
): FamilyAccountAgeAnalysisSnapshot {
  return {
    schoolId,
    accountRef,
    accountHolder: holder,
    balance,
    buckets: { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 },
    kidesysSection: "Paid Up",
    source: "educlear-registration",
    importedAt: new Date().toISOString(),
  };
}

function snapshot(
  schoolId: string,
  accountRef: string,
  holder: string,
  balance: number
): FamilyAccountAgeAnalysisSnapshot {
  return {
    schoolId,
    accountRef,
    accountHolder: holder,
    balance,
    buckets: { current: balance > 0 ? balance : 0, d30: 0, d60: 0, d90: 0, d120: 0 },
    kidesysSection: balance > 10000 ? "Bad Debt" : balance < 0 ? "Over Paid" : "Recently Owing",
    source: "kideesys-age-analysis",
    importedAt: "2099-12-31T23:59:59.999Z",
  };
}

function ledgerEntry(
  schoolId: string,
  partial: Partial<BillingLedgerEntry> &
    Pick<BillingLedgerEntry, "id" | "learnerId" | "accountNo" | "type" | "amount" | "date">
): BillingLedgerEntry {
  return {
    schoolId,
    reference: partial.reference || partial.id,
    description: partial.description || partial.type,
    createdAt: partial.createdAt || "2026-07-01T00:00:00.000Z",
    ...partial,
  };
}

async function withTempStores<T>(fn: (tempDir: string) => Promise<T>): Promise<T> {
  const tempDir = makeTempDataDir();
  setFamilyAccountAgeAnalysisStoreDataDirForTests(tempDir);
  setBillingLedgerStoreDataDirForTests(tempDir);
  setFamilyAccountAuditStoreDataDirForTests(tempDir);
  invalidateFamilyAccountAgeAnalysisFileCache();
  invalidateOfficialBillingAccountRefsCache();
  try {
    return await fn(tempDir);
  } finally {
    setFamilyAccountAgeAnalysisStoreDataDirForTests(null);
    setBillingLedgerStoreDataDirForTests(null);
    setFamilyAccountAuditStoreDataDirForTests(null);
    invalidateFamilyAccountAgeAnalysisFileCache();
    invalidateOfficialBillingAccountRefsCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function createSchoolFixture(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const school = await prisma.school.create({
    data: { name: `${label} ${suffix}`, email: `${label}-${suffix}@test.local` },
  });
  const sourceFa = await prisma.familyAccount.create({
    data: { schoolId: school.id, accountRef: "SRC001", familyName: "Source Sibling" },
  });
  const targetFa = await prisma.familyAccount.create({
    data: { schoolId: school.id, accountRef: "TGT001", familyName: "Target Sibling" },
  });
  const sourceLearner = await prisma.learner.create({
    data: {
      schoolId: school.id,
      familyAccountId: sourceFa.id,
      firstName: "Source",
      lastName: "Sibling",
      grade: "1",
      admissionNo: "SRC001",
      enrollmentStatus: "ACTIVE",
    },
  });
  const targetLearner = await prisma.learner.create({
    data: {
      schoolId: school.id,
      familyAccountId: targetFa.id,
      firstName: "Target",
      lastName: "Sibling",
      grade: "1",
      admissionNo: "TGT001",
      enrollmentStatus: "ACTIVE",
    },
  });
  return { school, sourceFa, targetFa, sourceLearner, targetLearner };
}

async function destroySchoolFixture(schoolId: string) {
  await prisma.parentLearnerLink.deleteMany({ where: { schoolId } });
  await prisma.billingDeposit.deleteMany({ where: { schoolId } });
  await prisma.learner.deleteMany({ where: { schoolId } });
  await prisma.parent.deleteMany({ where: { schoolId } });
  await prisma.familyAccount.deleteMany({ where: { schoolId } });
  await prisma.school.delete({ where: { id: schoolId } });
}

async function seedFinance(
  schoolId: string,
  sourceBalance: number,
  targetBalance: number,
  ledger: BillingLedgerEntry[] = []
) {
  insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
    schoolId,
    "SRC001",
    snapshot(schoolId, "SRC001", "Source Sibling", sourceBalance)
  );
  insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
    schoolId,
    "TGT001",
    snapshot(schoolId, "TGT001", "Target Sibling", targetBalance)
  );
  writeSchoolLedger(schoolId, ledger);
  invalidateOfficialBillingAccountRefsCache(schoolId);
}

async function testA_simpleSiblings() {
  const fx = await createSchoolFixture("merge-A");
  try {
    await withTempStores(async () => {
      await seedFinance(fx.school.id, 5000, 3000);
      const result = await mergeFamilyAccounts({
        schoolId: fx.school.id,
        sourceFamilyAccountId: fx.sourceFa.id,
        targetFamilyAccountId: fx.targetFa.id,
      });
      assert(result.balanceAfter.combined === 8000, `expected 8000 got ${result.balanceAfter.combined}`);
      const statements = await buildAccountsFromAgeAnalysisSnapshots(fx.school.id);
      const active = statements.filter((row) => row.accountNo === "TGT001" || row.accountNo === "SRC001");
      assert(active.length === 1, "one active statement account");
      assert(active[0].accountNo === "TGT001", "canonical is TGT001");
      assert(active[0].balance === 8000, "canonical balance 8000");
    });
  } finally {
    await destroySchoolFixture(fx.school.id);
  }
  console.log("✓ Test A simple siblings 5000+3000=8000");
}

async function testB_payments() {
  const fx = await createSchoolFixture("merge-B");
  try {
    await withTempStores(async () => {
      await seedFinance(fx.school.id, 0, 0, [
        ledgerEntry(fx.school.id, {
          id: "inv-a",
          learnerId: fx.sourceLearner.id,
          accountNo: "SRC001",
          type: "invoice",
          amount: 10000,
          date: "2026-06-01",
          createdAt: "2026-06-01T00:00:00.000Z",
        }),
        ledgerEntry(fx.school.id, {
          id: "pay-a",
          learnerId: fx.sourceLearner.id,
          accountNo: "SRC001",
          type: "payment",
          amount: 4000,
          date: "2026-06-10",
          source: "manual",
          createdAt: "2026-06-10T00:00:00.000Z",
        }),
        ledgerEntry(fx.school.id, {
          id: "inv-b",
          learnerId: fx.targetLearner.id,
          accountNo: "TGT001",
          type: "invoice",
          amount: 5000,
          date: "2026-06-01",
          createdAt: "2026-06-01T00:00:00.000Z",
        }),
        ledgerEntry(fx.school.id, {
          id: "pay-b",
          learnerId: fx.targetLearner.id,
          accountNo: "TGT001",
          type: "payment",
          amount: 1000,
          date: "2026-06-12",
          source: "manual",
          createdAt: "2026-06-12T00:00:00.000Z",
        }),
      ]);
      const result = await mergeFamilyAccounts({
        schoolId: fx.school.id,
        sourceFamilyAccountId: fx.sourceFa.id,
        targetFamilyAccountId: fx.targetFa.id,
      });
      assert(result.balanceAfter.combined === 10000, `expected 10000 got ${result.balanceAfter.combined}`);
      const ledger = readSchoolLedger(fx.school.id);
      assert(
        ledger.every((row) => row.accountNo === "TGT001"),
        "all live ledger rows moved to canonical"
      );
    });
  } finally {
    await destroySchoolFixture(fx.school.id);
  }
  console.log("✓ Test B payments merge to 10000");
}

async function testC_creditBalance() {
  const fx = await createSchoolFixture("merge-C");
  try {
    await withTempStores(async () => {
      await seedFinance(fx.school.id, 5000, -2000);
      const result = await mergeFamilyAccounts({
        schoolId: fx.school.id,
        sourceFamilyAccountId: fx.sourceFa.id,
        targetFamilyAccountId: fx.targetFa.id,
      });
      assert(result.balanceAfter.combined === 3000, `expected 3000 got ${result.balanceAfter.combined}`);
    });
  } finally {
    await destroySchoolFixture(fx.school.id);
  }
  console.log("✓ Test C credit balance 5000-2000=3000");
}

async function testD_openingBalances() {
  const fx = await createSchoolFixture("merge-D");
  try {
    await withTempStores(async () => {
      await seedFinance(fx.school.id, 4000, 2500, [
        ledgerEntry(fx.school.id, {
          id: "kidesys-opening-src",
          learnerId: fx.sourceLearner.id,
          accountNo: "SRC001",
          type: "invoice",
          amount: 4000,
          date: "2026-01-01",
          source: "kidesys_migration_opening_balance",
          description: "Kid-e-Sys opening balance",
          createdAt: "2026-05-28T00:00:00.000Z",
        }),
        ledgerEntry(fx.school.id, {
          id: "kidesys-opening-tgt",
          learnerId: fx.targetLearner.id,
          accountNo: "TGT001",
          type: "invoice",
          amount: 2500,
          date: "2026-01-01",
          source: "kidesys_migration_opening_balance",
          description: "Kid-e-Sys opening balance",
          createdAt: "2026-05-28T00:00:00.000Z",
        }),
      ]);
      const result = await mergeFamilyAccounts({
        schoolId: fx.school.id,
        sourceFamilyAccountId: fx.sourceFa.id,
        targetFamilyAccountId: fx.targetFa.id,
      });
      assert(result.balanceAfter.combined === 6500, `expected 6500 got ${result.balanceAfter.combined}`);
      const snaps = readSchoolFamilyAccountAgeAnalysisSnapshots(fx.school.id);
      assert(snaps.TGT001.balance === 6500, "canonical snapshot is the combined opening");
      assert(snaps.SRC001.mergedIntoAccountRef === "TGT001", "source snapshot retired");
      const openingRows = readSchoolLedger(fx.school.id).filter((row) =>
        String(row.source || "").includes("opening")
      );
      assert(openingRows.length === 2, "opening ledger rows preserved, not duplicated");
      assert(
        new Set(openingRows.map((row) => row.id)).size === 2,
        "opening row ids remain unique"
      );
    });
  } finally {
    await destroySchoolFixture(fx.school.id);
  }
  console.log("✓ Test D opening balances not duplicated");
}

async function testE_idempotency() {
  const fx = await createSchoolFixture("merge-E");
  try {
    await withTempStores(async () => {
      await seedFinance(fx.school.id, 1200, 800, [
        ledgerEntry(fx.school.id, {
          id: "inv-src",
          learnerId: fx.sourceLearner.id,
          accountNo: "SRC001",
          type: "invoice",
          amount: 300,
          date: "2026-07-01",
          createdAt: "2026-07-01T00:00:00.000Z",
        }),
      ]);
      const first = await mergeFamilyAccounts({
        schoolId: fx.school.id,
        sourceFamilyAccountId: fx.sourceFa.id,
        targetFamilyAccountId: fx.targetFa.id,
      });
      const invoiceCountAfterFirst = readSchoolLedger(fx.school.id).filter((row) => row.type === "invoice")
        .length;
      const second = await mergeFamilyAccounts({
        schoolId: fx.school.id,
        sourceFamilyAccountId: fx.sourceFa.id,
        targetFamilyAccountId: fx.targetFa.id,
      });
      assert(second.alreadyMerged === true, "second merge is idempotent");
      assert(second.balanceAfter.combined === first.balanceAfter.combined, "balance unchanged");
      const invoiceCountAfterSecond = readSchoolLedger(fx.school.id).filter((row) => row.type === "invoice")
        .length;
      assert(invoiceCountAfterFirst === invoiceCountAfterSecond, "invoices not duplicated");
      const snaps = readSchoolFamilyAccountAgeAnalysisSnapshots(fx.school.id);
      assert(snaps.TGT001.balance === 2000, "opening combined once");
    });
  } finally {
    await destroySchoolFixture(fx.school.id);
  }
  console.log("✓ Test E repeated merge idempotent");
}

async function testF_failureRollback() {
  const fx = await createSchoolFixture("merge-F");
  try {
    await withTempStores(async () => {
      await seedFinance(fx.school.id, 1500, 500, [
        ledgerEntry(fx.school.id, {
          id: "inv-keep",
          learnerId: fx.sourceLearner.id,
          accountNo: "SRC001",
          type: "invoice",
          amount: 100,
          date: "2026-07-01",
          createdAt: "2026-07-01T00:00:00.000Z",
        }),
      ]);
      const ledgerBefore = JSON.stringify(readSchoolLedger(fx.school.id));
      const snapsBefore = JSON.stringify(readSchoolFamilyAccountAgeAnalysisSnapshots(fx.school.id));
      let threw = false;
      try {
        await mergeFamilyAccounts({
          schoolId: fx.school.id,
          sourceFamilyAccountId: fx.sourceFa.id,
          targetFamilyAccountId: fx.targetFa.id,
          forceReconcileFailure: true,
        });
      } catch (error) {
        threw = String((error as Error).message || "").includes("Forced merge reconciliation failure");
      }
      assert(threw, "forced failure threw");
      assert(JSON.stringify(readSchoolLedger(fx.school.id)) === ledgerBefore, "ledger restored");
      assert(
        JSON.stringify(readSchoolFamilyAccountAgeAnalysisSnapshots(fx.school.id)) === snapsBefore,
        "snapshots restored"
      );
      const sourceLearner = await prisma.learner.findUnique({ where: { id: fx.sourceLearner.id } });
      assert(sourceLearner?.familyAccountId === fx.sourceFa.id, "source learner still on source account");
      const targetLearner = await prisma.learner.findUnique({ where: { id: fx.targetLearner.id } });
      assert(targetLearner?.familyAccountId === fx.targetFa.id, "target learner unchanged");
    });
  } finally {
    await destroySchoolFixture(fx.school.id);
  }
  console.log("✓ Test F failure rollback");
}

async function testG_statementsHideRetired() {
  const fx = await createSchoolFixture("merge-G");
  try {
    await withTempStores(async () => {
      await seedFinance(fx.school.id, 900, 100);
      await mergeFamilyAccounts({
        schoolId: fx.school.id,
        sourceFamilyAccountId: fx.sourceFa.id,
        targetFamilyAccountId: fx.targetFa.id,
      });
      const statements = await buildAccountsFromAgeAnalysisSnapshots(fx.school.id);
      assert(!statements.some((row) => row.accountNo === "SRC001"), "retired account hidden from statements");
      const owing = statements.filter((row) => row.balance > 0);
      assert(owing.every((row) => row.accountNo !== "SRC001"), "retired account not separately owing");
    });
  } finally {
    await destroySchoolFixture(fx.school.id);
  }
  console.log("✓ Test G statements hide retired account");
}

async function testH_siblingLinks() {
  const fx = await createSchoolFixture("merge-H");
  try {
    await withTempStores(async () => {
      await seedFinance(fx.school.id, 10, 20);
      await mergeFamilyAccounts({
        schoolId: fx.school.id,
        sourceFamilyAccountId: fx.sourceFa.id,
        targetFamilyAccountId: fx.targetFa.id,
      });
      const learners = await prisma.learner.findMany({
        where: { schoolId: fx.school.id },
        select: { id: true, familyAccountId: true },
      });
      assert(
        learners.every((row) => row.familyAccountId === fx.targetFa.id),
        "all intended siblings on canonical family account"
      );
    });
  } finally {
    await destroySchoolFixture(fx.school.id);
  }
  console.log("✓ Test H sibling links on canonical account");
}

async function testI_unrelatedSameSurname() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const school = await prisma.school.create({
    data: { name: `merge-I ${suffix}`, email: `merge-i-${suffix}@test.local` },
  });
  const familyA = await prisma.familyAccount.create({
    data: { schoolId: school.id, accountRef: "MOR001", familyName: "Moruledi" },
  });
  const familyB = await prisma.familyAccount.create({
    data: { schoolId: school.id, accountRef: "MOR002", familyName: "Moruledi" },
  });
  await prisma.learner.create({
    data: {
      schoolId: school.id,
      familyAccountId: familyA.id,
      firstName: "Ada",
      lastName: "Moruledi",
      grade: "1",
      admissionNo: "MOR001",
      enrollmentStatus: "ACTIVE",
    },
  });
  await prisma.learner.create({
    data: {
      schoolId: school.id,
      familyAccountId: familyB.id,
      firstName: "Ben",
      lastName: "Moruledi",
      grade: "1",
      admissionNo: "MOR002",
      enrollmentStatus: "ACTIVE",
    },
  });
  try {
    await withTempStores(async () => {
      insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
        school.id,
        "MOR001",
        snapshot(school.id, "MOR001", "Ada Moruledi", 100)
      );
      insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
        school.id,
        "MOR002",
        snapshot(school.id, "MOR002", "Ben Moruledi", 200)
      );
      invalidateOfficialBillingAccountRefsCache(school.id);
      const before = await buildAccountsFromAgeAnalysisSnapshots(school.id);
      assert(before.some((row) => row.accountNo === "MOR001"), "family A present");
      assert(before.some((row) => row.accountNo === "MOR002"), "family B present");
      assert(before.length === 2, "unrelated same-surname families stay separate until explicit merge");
    });
  } finally {
    await destroySchoolFixture(school.id);
  }
  console.log("✓ Test I unrelated same surname not merged");
}

async function testJ_historicalLedger() {
  const fx = await createSchoolFixture("merge-J");
  try {
    await withTempStores(async () => {
      await seedFinance(fx.school.id, 0, 0, [
        ledgerEntry(fx.school.id, {
          id: "hist-inv-src",
          learnerId: fx.sourceLearner.id,
          accountNo: "SRC001",
          type: "invoice",
          amount: 1750,
          date: "2025-03-15",
          reference: "INVOICE 99901",
          createdAt: "2026-05-28T08:00:00.000Z",
        }),
        ledgerEntry(fx.school.id, {
          id: "hist-inv-tgt",
          learnerId: fx.targetLearner.id,
          accountNo: "TGT001",
          type: "invoice",
          amount: 800,
          date: "2025-04-15",
          reference: "INVOICE 99902",
          createdAt: "2026-05-28T08:00:00.000Z",
        }),
      ]);
      await mergeFamilyAccounts({
        schoolId: fx.school.id,
        sourceFamilyAccountId: fx.sourceFa.id,
        targetFamilyAccountId: fx.targetFa.id,
      });
      const ledger = readSchoolLedger(fx.school.id);
      const srcHist = ledger.find((row) => row.id === "hist-inv-src");
      const tgtHist = ledger.find((row) => row.id === "hist-inv-tgt");
      assert(srcHist?.amount === 1750, "source historical amount intact");
      assert(srcHist?.date === "2025-03-15", "source historical date intact");
      assert(srcHist?.reference === "INVOICE 99901", "source historical reference intact");
      assert(srcHist?.accountNo === "TGT001", "historical row now on canonical account");
      assert(tgtHist?.id === "hist-inv-tgt", "target historical row not replaced");
      assert(ledger.filter((row) => row.id === "hist-inv-src").length === 1, "historical row not duplicated");
    });
  } finally {
    await destroySchoolFixture(fx.school.id);
  }
  console.log("✓ Test J historical ledger preserved");
}

async function testMot683_newSiblingShell() {
  const fx = await createSchoolFixture("merge-MOT683");
  try {
    await withTempStores(async () => {
      insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
        fx.school.id,
        "TGT001",
        snapshot(fx.school.id, "TGT001", "Existing Family", 14600)
      );
      insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
        fx.school.id,
        "SRC001",
        nativeSnapshot(fx.school.id, "SRC001", "New Sibling", 0)
      );
      writeSchoolLedger(fx.school.id, []);
      invalidateOfficialBillingAccountRefsCache(fx.school.id);

      const result = await mergeFamilyAccounts({
        schoolId: fx.school.id,
        sourceFamilyAccountId: fx.sourceFa.id,
        targetFamilyAccountId: fx.targetFa.id,
      });
      assert(result.balanceMode === "retire_without_adding", "new-learner shell is Case B");
      assert(result.balanceAfter.combined === 14600, `canonical must stay 14600, got ${result.balanceAfter.combined}`);
      assert(result.balanceAfter.combined !== 14600 + 0 || result.balanceAfter.target === 14600, "canonical unchanged");

      const sourceLearner = await prisma.learner.findUnique({ where: { id: fx.sourceLearner.id } });
      assert(sourceLearner?.familyAccountId === fx.targetFa.id, "new sibling linked to canonical");

      const statements = await buildAccountsFromAgeAnalysisSnapshots(fx.school.id);
      assert(!statements.some((row) => row.accountNo === "SRC001"), "temporary SRC001 hidden");
      const canonical = statements.find((row) => row.accountNo === "TGT001");
      assert(canonical?.balance === 14600, "canonical balance unchanged");
      assert(canonical?.balance !== 18770, "must not invent debt");

      const snaps = readSchoolFamilyAccountAgeAnalysisSnapshots(fx.school.id);
      assert(snaps.TGT001.balance === 14600, "canonical snapshot not increased");
      assert(snaps.SRC001.mergedIntoAccountRef === "TGT001", "shell snapshot retired");
    });
  } finally {
    await destroySchoolFixture(fx.school.id);
  }
  console.log("✓ Test MOT683 new sibling shell: canonical unchanged, source hidden");
}

async function testMor013_stalePredecessorMustNotBecome18770() {
  const fx = await createSchoolFixture("merge-MOR013");
  try {
    await withTempStores(async () => {
      await prisma.learner.update({
        where: { id: fx.sourceLearner.id },
        data: { familyAccountId: fx.targetFa.id },
      });

      insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
        fx.school.id,
        "TGT001",
        snapshot(fx.school.id, "TGT001", "Phetogo Lekgetho Moruledi", 8100)
      );
      insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
        fx.school.id,
        "SRC001",
        snapshot(fx.school.id, "SRC001", "Paballo Moruledi", 10670)
      );
      writeSchoolLedger(fx.school.id, []);
      invalidateOfficialBillingAccountRefsCache(fx.school.id);

      const beforeCanonical = await buildAccountsFromAgeAnalysisSnapshots(fx.school.id);
      const beforeTarget = beforeCanonical.find((row) => row.accountNo === "TGT001");
      assert(beforeTarget?.balance === 8100, "canonical before is 8100");

      const result = await mergeFamilyAccounts({
        schoolId: fx.school.id,
        sourceFamilyAccountId: fx.sourceFa.id,
        targetFamilyAccountId: fx.targetFa.id,
      });

      assert(result.balanceMode === "retire_without_adding", "stale predecessor is Case B");
      assert(result.balanceAfter.combined === 8100, `CANONICAL REMAINS R8,100 got ${result.balanceAfter.combined}`);
      assert(result.balanceAfter.combined !== 18770, "STALE SOURCE R10,670 + CANONICAL R8,100 DOES NOT BECOME R18,770");

      const statements = await buildAccountsFromAgeAnalysisSnapshots(fx.school.id);
      assert(!statements.some((row) => row.accountNo === "SRC001"), "stale predecessor hidden");
      const canonical = statements.find((row) => row.accountNo === "TGT001");
      assert(canonical?.balance === 8100, "displayed canonical remains 8100");
      assert(canonical?.balance !== 18770, "must not become 18770");

      const snaps = readSchoolFamilyAccountAgeAnalysisSnapshots(fx.school.id);
      assert(snaps.TGT001.balance === 8100, "canonical snapshot unchanged");
      assert(snaps.SRC001.mergedIntoAccountRef === "TGT001", "predecessor snapshot retired");
    });
  } finally {
    await destroySchoolFixture(fx.school.id);
  }
  console.log("✓ Test MOR013 stale snapshot: R8,100 stays R8,100, not R18,770");
}

async function testTripleAccountAbandonedSnapshotNotAutoRetired() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const school = await prisma.school.create({
    data: { name: `merge-triple ${suffix}`, email: `merge-triple-${suffix}@test.local` },
  });
  const tmp001 = await prisma.familyAccount.create({
    data: { schoolId: school.id, accountRef: "TMP001", familyName: "Abandoned First" },
  });
  const tmp002 = await prisma.familyAccount.create({
    data: { schoolId: school.id, accountRef: "TMP002", familyName: "Second Registration" },
  });
  const fam003 = await prisma.familyAccount.create({
    data: { schoolId: school.id, accountRef: "FAM003", familyName: "Canonical Family" },
  });
  const abandoned = await prisma.learner.create({
    data: {
      schoolId: school.id,
      familyAccountId: tmp001.id,
      firstName: "Ann",
      lastName: "Learner",
      grade: "1",
      admissionNo: "TMP001",
      idNumber: "2014010500000",
      birthDate: new Date("2014-05-01T00:00:00.000Z"),
      enrollmentStatus: "HISTORICAL",
    },
  });
  const reRegistered = await prisma.learner.create({
    data: {
      schoolId: school.id,
      familyAccountId: tmp002.id,
      firstName: "Ann",
      lastName: "Learner",
      grade: "1",
      admissionNo: "TMP002",
      idNumber: "2014010500000",
      birthDate: new Date("2014-05-01T00:00:00.000Z"),
      enrollmentStatus: "ACTIVE",
    },
  });
  const sibling = await prisma.learner.create({
    data: {
      schoolId: school.id,
      familyAccountId: fam003.id,
      firstName: "Ben",
      lastName: "Learner",
      grade: "1",
      admissionNo: "FAM003",
      enrollmentStatus: "ACTIVE",
    },
  });

  try {
    await withTempStores(async () => {
      insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
        school.id,
        "TMP001",
        nativeSnapshot(school.id, "TMP001", "Ann Learner", 0)
      );
      insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
        school.id,
        "TMP002",
        nativeSnapshot(school.id, "TMP002", "Ann Learner", 0)
      );
      insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
        school.id,
        "FAM003",
        {
          ...nativeSnapshot(school.id, "FAM003", "Canonical Family", 0),
          importedAt: "2026-08-21T05:35:01.025Z",
        }
      );
      writeSchoolLedger(school.id, [
        ledgerEntry(school.id, {
          id: "fam-admin",
          learnerId: sibling.id,
          accountNo: "FAM003",
          type: "invoice",
          amount: 1600,
          date: "2026-08-21",
          description: "Administration Fee",
          createdAt: "2026-08-21T05:41:07.363Z",
        }),
        ledgerEntry(school.id, {
          id: "fam-rest",
          learnerId: sibling.id,
          accountNo: "FAM003",
          type: "invoice",
          amount: 13000,
          date: "2026-08-21",
          description: "Remaining fees",
          createdAt: "2026-08-21T05:41:08.000Z",
        }),
      ]);
      invalidateOfficialBillingAccountRefsCache(school.id);

      const before = await buildAccountsFromAgeAnalysisSnapshots(school.id);
      const beforeFam = before.find((row) => row.accountNo === "FAM003");
      assert(beforeFam?.balance === 14600, "FAM003 before merge is R14,600");
      assert(before.some((row) => row.accountNo === "TMP001"), "TMP001 visible before merge");
      assert(before.some((row) => row.accountNo === "TMP002"), "TMP002 visible before merge");

      const result = await mergeFamilyAccounts({
        schoolId: school.id,
        sourceFamilyAccountId: tmp002.id,
        targetFamilyAccountId: fam003.id,
      });
      assert(result.balanceMode === "retire_without_adding", "TMP002 shell is Case B");
      assert(result.balanceAfter.combined === 14600, `FAM003 must stay 14600, got ${result.balanceAfter.combined}`);

      const afterMerge = await buildAccountsFromAgeAnalysisSnapshots(school.id);
      assert(!afterMerge.some((row) => row.accountNo === "TMP002"), "explicit merge source TMP002 hidden");
      assert(afterMerge.some((row) => row.accountNo === "TMP001"), "abandoned TMP001 is NOT auto-retired by merge");
      const canonical = afterMerge.find((row) => row.accountNo === "FAM003");
      assert(canonical?.balance === 14600, "canonical remains R14,600 after TMP002 merge");

      const moved = await prisma.learner.findUnique({ where: { id: reRegistered.id } });
      const stillAbandoned = await prisma.learner.findUnique({ where: { id: abandoned.id } });
      const siblingAfter = await prisma.learner.findUnique({ where: { id: sibling.id } });
      assert(moved?.familyAccountId === fam003.id, "re-registered learner moved to FAM003");
      assert(stillAbandoned?.familyAccountId === tmp001.id, "historical abandoned learner stays on TMP001");
      assert(siblingAfter?.familyAccountId === fam003.id, "sibling remains on FAM003");

      const snaps = readSchoolFamilyAccountAgeAnalysisSnapshots(school.id);
      assert(snaps.TMP002.mergedIntoAccountRef === "FAM003", "TMP002 retired by explicit merge");
      assert(!snaps.TMP001.mergedIntoAccountRef, "TMP001 not retired by merge");
      assert(snaps.FAM003.balance === 0, "canonical opening unchanged");

      const familyAccounts = await prisma.familyAccount.findMany({ where: { schoolId: school.id } });
      const learners = await prisma.learner.findMany({ where: { schoolId: school.id } });
      const scan = scanFamilyAccountIntegrity({
        snapshots: snaps,
        familyAccounts,
        learners: learners.map((row) => ({
          id: row.id,
          familyAccountId: row.familyAccountId,
          firstName: row.firstName,
          lastName: row.lastName,
          admissionNo: row.admissionNo,
          idNumber: row.idNumber,
          birthDate: row.birthDate ? row.birthDate.toISOString() : null,
          enrollmentStatus: row.enrollmentStatus,
        })),
        ledger: readSchoolLedger(school.id),
        audit: listFamilyAccountAudit(school.id, 50),
      });
      const tmp001Scan = scan.statementRows.find((row) => row.accountRef === "TMP001");
      const famScan = scan.statementRows.find((row) => row.accountRef === "FAM003");
      assert(
        tmp001Scan?.classification === "CONFIRMED_STALE_PREDECESSOR",
        "scanner flags TMP001 without relying on it being a merge source"
      );
      assert(famScan?.classification === "ACTIVE_CANONICAL", "FAM003 remains canonical in scan");
      assert(!snaps.TMP001.mergedIntoAccountRef, "scanner must not retire TMP001");

      retireAgeAnalysisSnapshot(school.id, "TMP001", "FAM003", {
        retiredReason: "explicit-historical-repair",
      });
      invalidateFamilyAccountAgeAnalysisFileCache();
      const afterExplicit = await buildAccountsFromAgeAnalysisSnapshots(school.id);
      assert(!afterExplicit.some((row) => row.accountNo === "TMP001"), "explicit repair hides TMP001");
      assert(!afterExplicit.some((row) => row.accountNo === "TMP002"), "TMP002 stays hidden");
      const afterFam = afterExplicit.find((row) => row.accountNo === "FAM003");
      assert(afterFam?.balance === 14600, "explicit TMP001 retirement leaves FAM003 at R14,600");
      assert(afterFam?.balance !== 18770, "must not invent debt");
    });
  } finally {
    await destroySchoolFixture(school.id);
  }
  console.log("✓ Test triple-account: merge retires TMP002 only; scanner flags TMP001; FAM003 stays R14,600");
}

async function main() {
  if (!isLocalDatabase()) {
    console.log("⊘ family merge integrity tests skipped (DATABASE_URL is not localhost)");
    return;
  }
  await testA_simpleSiblings();
  await testB_payments();
  await testC_creditBalance();
  await testD_openingBalances();
  await testE_idempotency();
  await testF_failureRollback();
  await testG_statementsHideRetired();
  await testH_siblingLinks();
  await testI_unrelatedSameSurname();
  await testJ_historicalLedger();
  await testMot683_newSiblingShell();
  await testMor013_stalePredecessorMustNotBecome18770();
  await testTripleAccountAbandonedSnapshotNotAutoRetired();
  console.log("\nAll family-account merge integrity tests passed.");
  console.log("STALE SOURCE R10,670 + CANONICAL R8,100 DOES NOT BECOME R18,770");
  console.log("CANONICAL REMAINS R8,100");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
