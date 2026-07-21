/**
 * Finance account registration + allocation tests.
 * Run: npx ts-node --transpile-only src/services/financeAccountRegistration.test.ts
 */
import fs from "fs";
import os from "os";
import path from "path";

import { PrismaClient } from "@prisma/client";

import {
  collectOccupiedAccountRefsForPrefix,
  computeNextAvailableAccountRef,
  parseAccountRefSuffix,
} from "./allocateFamilyAccountRef";
import {
  backfillFinanceAccountBaselines,
  ensureFinanceAccountBaseline,
  findMissingFinanceAccountBaselines,
  registerFinanceAccountForLearner,
  FinanceAccountBaselineError,
} from "./financeAccountBaseline";
import { resolveOfficialBillingAccountRef } from "./officialBillingAccountRef";
import { buildAccountsFromAgeAnalysisSnapshots } from "./statementAccounts";
import {
  insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent,
  invalidateFamilyAccountAgeAnalysisFileCache,
  readSchoolFamilyAccountAgeAnalysisSnapshots,
  setFamilyAccountAgeAnalysisStoreDataDirForTests,
  type FamilyAccountAgeAnalysisSnapshot,
} from "../utils/familyAccountAgeAnalysisStore";
import { setBillingLedgerStoreDataDirForTests } from "../utils/billingLedgerStore";
import { invalidateOfficialBillingAccountRefsCache } from "./officialBillingAccountRef";

const prisma = new PrismaClient();

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function makeTempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "finance-reg-test-"));
  fs.writeFileSync(path.join(dir, "family-account-age-analysis.json"), "{}", "utf8");
  fs.writeFileSync(path.join(dir, "billing-ledger.json"), "{}", "utf8");
  return dir;
}

function importedSnapshot(
  schoolId: string,
  accountRef: string,
  balance: number
): FamilyAccountAgeAnalysisSnapshot {
  return {
    schoolId,
    accountRef,
    accountHolder: `${accountRef} Holder`,
    balance,
    buckets: { current: balance, d30: 0, d60: 0, d90: 0, d120: 0 },
    kidesysSection: "Recently Owing",
    source: "kideesys-age-analysis",
    importedAt: "2026-05-28T08:00:00.000Z",
  };
}

async function withTempStores<T>(fn: (tempDir: string) => Promise<T>): Promise<T> {
  const tempDir = makeTempDataDir();
  setFamilyAccountAgeAnalysisStoreDataDirForTests(tempDir);
  setBillingLedgerStoreDataDirForTests(tempDir);
  invalidateFamilyAccountAgeAnalysisFileCache();
  invalidateOfficialBillingAccountRefsCache();
  try {
    return await fn(tempDir);
  } finally {
    setFamilyAccountAgeAnalysisStoreDataDirForTests(null);
    setBillingLedgerStoreDataDirForTests(null);
    invalidateFamilyAccountAgeAnalysisFileCache();
    invalidateOfficialBillingAccountRefsCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function testParseAccountRefSuffix() {
  assert(parseAccountRefSuffix("MAS", "MAS001") === 1, "MAS001 suffix");
  assert(parseAccountRefSuffix("MAS", "MAS012") === 12, "MAS012 suffix");
  assert(parseAccountRefSuffix("MAS", "ALI002") === null, "wrong prefix");
  console.log("✓ parseAccountRefSuffix");
}

function testReferenceGenerationWithGaps() {
  const occupied = new Set(["MAS001", "MAS012", "MAS017"]);
  const next = computeNextAvailableAccountRef("MAS", occupied);
  assert(next === "MAS018", `expected MAS018 got ${next}`);
  assert(!occupied.has(next), "must not reuse occupied ref");
  console.log("✓ reference generation with gaps (max+1)");
}

function testReferenceExistsOnlyInSnapshot() {
  const occupied = new Set(["MAS001", "MAS012", "MAS020"]);
  const next = computeNextAvailableAccountRef("MAS", occupied);
  assert(next === "MAS021", `snapshot-only ref must block reuse, got ${next}`);
  console.log("✓ reference exists only in snapshot set");
}

function testReferenceExistsOnlyInPostgresSet() {
  const occupied = new Set(["MAS001", "MAS012", "MAS009"]);
  const next = computeNextAvailableAccountRef("MAS", occupied);
  assert(next === "MAS013", `postgres-only ref must block reuse, got ${next}`);
  console.log("✓ reference exists only in postgres set");
}

async function testEnsureBaselineNewAccount() {
  await withTempStores(async () => {
    const schoolId = "test-school-finance-baseline-new";
    const result = ensureFinanceAccountBaseline({
      schoolId,
      accountRef: "TST001",
      accountHolder: "Test Family",
      createdAt: "2026-07-21T08:00:00.000Z",
    });
    assert(result.status === "inserted", "baseline inserted");
    const snapshots = readSchoolFamilyAccountAgeAnalysisSnapshots(schoolId);
    assert(snapshots.TST001?.balance === 0, "zero balance");
    assert(snapshots.TST001?.source === "educlear-registration", "native source");
    assert(
      snapshots.TST001?.buckets.current === 0 && snapshots.TST001?.buckets.d120 === 0,
      "zero buckets"
    );

    const accounts = await buildAccountsFromAgeAnalysisSnapshots(schoolId);
    assert(accounts.some((row) => row.accountNo === "TST001"), "statements include account");

    const official = await resolveOfficialBillingAccountRef(schoolId, { accountNo: "TST001" });
    assert(official === "TST001", "official resolver returns accountRef");
  });
  console.log("✓ ensure baseline for new account");
}

async function testEnsureBaselineIdempotent() {
  await withTempStores(async () => {
    const schoolId = "test-school-finance-baseline-idempotent";
    const input = {
      schoolId,
      accountRef: "TST002",
      accountHolder: "Repeat Family",
    };
    const first = ensureFinanceAccountBaseline(input);
    const second = ensureFinanceAccountBaseline(input);
    assert(first.status === "inserted", "first insert");
    assert(second.status === "already_exists", "second skipped");
    const snapshots = readSchoolFamilyAccountAgeAnalysisSnapshots(schoolId);
    assert(Object.keys(snapshots).length === 1, "one snapshot only");
  });
  console.log("✓ ensure baseline idempotent");
}

async function testExistingImportedNeverReset() {
  await withTempStores(async () => {
    const schoolId = "test-school-finance-baseline-imported";
    insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
      schoolId,
      "IMP001",
      importedSnapshot(schoolId, "IMP001", 4500)
    );
    invalidateOfficialBillingAccountRefsCache(schoolId);

    const result = ensureFinanceAccountBaseline({
      schoolId,
      accountRef: "IMP001",
      accountHolder: "Should Not Overwrite",
    });
    assert(result.status === "already_exists", "imported snapshot preserved");
    const snapshots = readSchoolFamilyAccountAgeAnalysisSnapshots(schoolId);
    assert(snapshots.IMP001?.balance === 4500, "imported balance unchanged");
    assert(snapshots.IMP001?.source === "kideesys-age-analysis", "imported source unchanged");
  });
  console.log("✓ existing imported account never reset");
}

async function testSiblingNoDuplicateSnapshot() {
  await withTempStores(async () => {
    const schoolId = "test-school-finance-baseline-sibling";
    const first = ensureFinanceAccountBaseline({
      schoolId,
      accountRef: "FAM001",
      accountHolder: "Sibling Family",
    });
    const second = ensureFinanceAccountBaseline({
      schoolId,
      accountRef: "FAM001",
      accountHolder: "Sibling Family",
    });
    assert(first.status === "inserted", "first sibling baseline inserted");
    assert(second.status === "already_exists", "second sibling reused baseline");
    assert(
      readSchoolFamilyAccountAgeAnalysisSnapshots(schoolId).FAM001?.balance === 0,
      "balance unchanged"
    );
  });
  console.log("✓ sibling linked to existing family account — no duplicate snapshot");
}

async function testSnapshotWriteFailureSurfacesError() {
  await withTempStores(async (tempDir) => {
    const schoolId = "test-school-finance-baseline-failure";
    fs.chmodSync(path.join(tempDir, "family-account-age-analysis.json"), 0o444);

    let threw = false;
    try {
      registerFinanceAccountForLearner({
        schoolId,
        learnerId: "learner-fail-1",
        familyAccountId: "fa-fail-1",
        accountRef: "FAIL001",
        accountHolder: "Fail Family",
      });
    } catch (error) {
      threw = error instanceof FinanceAccountBaselineError;
    } finally {
      fs.chmodSync(path.join(tempDir, "family-account-age-analysis.json"), 0o644);
    }

    assert(threw, "snapshot write failure throws FinanceAccountBaselineError");
  });
  console.log("✓ snapshot write failure surfaces error");
}

async function testConcurrentPrefixAllocationDistinct() {
  await withTempStores(async () => {
    const schoolId = "test-school-finance-ref-concurrent";
    const occupied = await collectOccupiedAccountRefsForPrefix(schoolId, "MAS");
    occupied.add("MAS001");
    occupied.add("MAS012");
    occupied.add("MAS017");

    const first = computeNextAvailableAccountRef("MAS", occupied);
    occupied.add(first);
    const second = computeNextAvailableAccountRef("MAS", occupied);

    assert(first !== second, "concurrent-style allocation yields distinct refs");
    assert(first === "MAS018", `first ref expected MAS018 got ${first}`);
    assert(second === "MAS019", `second ref expected MAS019 got ${second}`);
  });
  console.log("✓ concurrent prefix allocation distinct refs");
}

function isLocalDatabase(): boolean {
  const url = String(process.env.DATABASE_URL || "");
  return /localhost|127\.0\.0\.1/.test(url);
}

async function testBackfillIncludesActiveExcludesOrphans() {
  if (!isLocalDatabase()) {
    console.log("⊘ backfill integration skipped (non-local DATABASE_URL)");
    return;
  }

  const suffix = Date.now();
  const school = await prisma.school.create({
    data: { name: `Finance Backfill ${suffix}`, email: `fb-${suffix}@test.local` },
  });

  const linkedFa = await prisma.familyAccount.create({
    data: { schoolId: school.id, accountRef: `FBK${String(suffix).slice(-3)}`, familyName: "Linked" },
  });
  const orphanFa = await prisma.familyAccount.create({
    data: { schoolId: school.id, accountRef: `ORP${String(suffix).slice(-3)}`, familyName: "Orphan" },
  });

  const learner = await prisma.learner.create({
    data: {
      schoolId: school.id,
      familyAccountId: linkedFa.id,
      firstName: "Active",
      lastName: "Learner",
      grade: "1",
      admissionNo: linkedFa.accountRef,
      enrollmentStatus: "ACTIVE",
    },
  });

  await withTempStores(async () => {
    const preview = await findMissingFinanceAccountBaselines(school.id);
    const candidateRefs = preview.candidates.map((row) => row.accountRef);
    const orphanRefs = preview.orphanShells.map((row) => row.accountRef);

    assert(candidateRefs.includes(linkedFa.accountRef), "active linked account is candidate");
    assert(!candidateRefs.includes(orphanFa.accountRef), "orphan shell excluded from candidates");
    assert(orphanRefs.includes(orphanFa.accountRef), "orphan shell reported separately");

    const dryRun = await backfillFinanceAccountBaselines(school.id, { dryRun: true });
    assert(
      dryRun.candidates.some((row) => row.accountRef === linkedFa.accountRef),
      "dry-run lists linked account"
    );

    const applied = await backfillFinanceAccountBaselines(school.id, { dryRun: false });
    assert(applied.inserted.includes(linkedFa.accountRef), "backfill inserts linked account");

    const official = await resolveOfficialBillingAccountRef(school.id, {
      learnerId: learner.id,
      learner: {
        familyAccount: { accountRef: linkedFa.accountRef },
        admissionNo: linkedFa.accountRef,
      },
    });
    assert(official === linkedFa.accountRef, "official resolver after backfill");
  });

  await prisma.learner.deleteMany({ where: { schoolId: school.id } });
  await prisma.familyAccount.deleteMany({ where: { schoolId: school.id } });
  await prisma.school.delete({ where: { id: school.id } });

  console.log("✓ backfill includes active linked account and excludes orphan shells");
}

async function testNewRegistrationEndToEndLocal() {
  if (!isLocalDatabase()) {
    console.log("⊘ registration end-to-end skipped (non-local DATABASE_URL)");
    return;
  }

  const suffix = Date.now();
  const school = await prisma.school.create({
    data: { name: `Finance Reg E2E ${suffix}`, email: `fre2e-${suffix}@test.local` },
  });

  await withTempStores(async () => {
    insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
      school.id,
      "MAS001",
      importedSnapshot(school.id, "MAS001", 1200)
    );
    insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
      school.id,
      "MAS012",
      importedSnapshot(school.id, "MAS012", 800)
    );
    invalidateOfficialBillingAccountRefsCache(school.id);

    const { allocateFamilyAccountRef } = await import("./allocateFamilyAccountRef");
    const accountRef = await allocateFamilyAccountRef(school.id, "Masina");
    assert(accountRef === "MAS013", `new Masina ref should be MAS013 not count-based, got ${accountRef}`);

    const familyAccount = await prisma.familyAccount.create({
      data: { schoolId: school.id, accountRef, familyName: "MASINA" },
    });
    const learner = await prisma.learner.create({
      data: {
        schoolId: school.id,
        familyAccountId: familyAccount.id,
        firstName: "New",
        lastName: "Masina",
        grade: "6",
        admissionNo: accountRef,
        enrollmentStatus: "ACTIVE",
      },
    });

    registerFinanceAccountForLearner({
      schoolId: school.id,
      learnerId: learner.id,
      familyAccountId: familyAccount.id,
      accountRef,
      accountHolder: familyAccount.familyName,
      createdAt: familyAccount.createdAt,
    });

    const statements = await buildAccountsFromAgeAnalysisSnapshots(school.id);
    assert(statements.some((row) => row.accountNo === accountRef), "statements include new account");
    assert(
      statements.find((row) => row.accountNo === "MAS001")?.balance === 1200,
      "imported MAS001 balance unchanged"
    );

    const payAccounts = await buildAccountsFromAgeAnalysisSnapshots(school.id);
    assert(payAccounts.some((row) => row.accountNo === accountRef), "payments account list includes new account");
  });

  await prisma.learner.deleteMany({ where: { schoolId: school.id } });
  await prisma.familyAccount.deleteMany({ where: { schoolId: school.id } });
  await prisma.school.delete({ where: { id: school.id } });

  console.log("✓ new learner registration end-to-end local");
}

async function main() {
  testParseAccountRefSuffix();
  testReferenceGenerationWithGaps();
  testReferenceExistsOnlyInSnapshot();
  testReferenceExistsOnlyInPostgresSet();
  await testEnsureBaselineNewAccount();
  await testEnsureBaselineIdempotent();
  await testExistingImportedNeverReset();
  await testSiblingNoDuplicateSnapshot();
  await testSnapshotWriteFailureSurfacesError();
  await testConcurrentPrefixAllocationDistinct();
  await testBackfillIncludesActiveExcludesOrphans();
  await testNewRegistrationEndToEndLocal();
  console.log("\nAll finance account registration tests passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
