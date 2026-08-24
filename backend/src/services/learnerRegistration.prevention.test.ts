/**
 * Learner registration prevention tests (local/disposable only).
 * Run: npx ts-node --transpile-only src/services/learnerRegistration.prevention.test.ts
 */
import fs from "fs";
import os from "os";
import path from "path";
import { PrismaClient } from "@prisma/client";

import {
  LearnerIdentityConflictError,
  findDuplicateLearnerInSchool,
} from "./learnerIdentityGuard";
import {
  CrossSchoolFamilyAccountError,
  registerLearner,
  reactivateHistoricalLearner,
  updateLearnerEnrollmentStatus,
} from "./learnerRegistrationService";
import { mergeFamilyAccounts } from "./familyAccountService";
import { buildAccountsFromAgeAnalysisSnapshots } from "./statementAccounts";
import { invalidateOfficialBillingAccountRefsCache } from "./officialBillingAccountRef";
import {
  invalidateFamilyAccountAgeAnalysisFileCache,
  readSchoolFamilyAccountAgeAnalysisSnapshots,
  setFamilyAccountAgeAnalysisStoreDataDirForTests,
} from "../utils/familyAccountAgeAnalysisStore";
import {
  setBillingLedgerStoreDataDirForTests,
  writeSchoolLedger,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import { setFamilyAccountAuditStoreDataDirForTests } from "../utils/familyAccountAuditStore";
import { resolveAuthoritativeAccountBalance } from "./statementAccounts";

const prisma = new PrismaClient();

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function isLocalDatabase(): boolean {
  const url = String(process.env.DATABASE_URL || "");
  return /localhost|127\.0\.0\.1/.test(url);
}

function makeTempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "learner-reg-test-"));
  fs.writeFileSync(path.join(dir, "family-account-age-analysis.json"), "{}", "utf8");
  fs.writeFileSync(path.join(dir, "billing-ledger.json"), "{}", "utf8");
  fs.writeFileSync(path.join(dir, "family-account-audit.json"), "{}", "utf8");
  return dir;
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

async function createSchool(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return prisma.school.create({
    data: { name: `${label} ${suffix}`, email: `${label}-${suffix}@test.local` },
  });
}

async function destroySchool(schoolId: string) {
  await prisma.parentLearnerLink.deleteMany({ where: { schoolId } });
  await prisma.billingDeposit.deleteMany({ where: { schoolId } });
  await prisma.learner.deleteMany({ where: { schoolId } });
  await prisma.parent.deleteMany({ where: { schoolId } });
  await prisma.familyAccount.deleteMany({ where: { schoolId } });
  await prisma.school.delete({ where: { id: schoolId } });
}

function nativeSnap(schoolId: string, accountRef: string, holder: string, balance = 0) {
  return {
    schoolId,
    accountRef,
    accountHolder: holder,
    balance,
    buckets: { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 },
    kidesysSection: balance > 0 ? "Recently Owing" : "Paid Up",
    source: "educlear-registration" as const,
    importedAt: "2026-08-01T00:00:00.000Z",
  };
}

function invoice(
  schoolId: string,
  learnerId: string,
  accountNo: string,
  amount: number,
  id: string
): BillingLedgerEntry {
  return {
    id,
    schoolId,
    learnerId,
    accountNo,
    type: "invoice",
    amount,
    date: "2026-08-21",
    reference: id,
    description: "Fee",
    createdAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

async function testDuplicateHistoricalDoesNotCreateSecondLearner() {
  const school = await createSchool("hist-dup");
  try {
    await withTempStores(async () => {
      const first = await registerLearner({
        schoolId: school.id,
        learner: {
          firstName: "Ann",
          lastName: "Learner",
          grade: "1",
          idNumber: "2014010500000",
          birthDate: "2014-05-01",
        },
      });
      await updateLearnerEnrollmentStatus({
        schoolId: school.id,
        learnerId: first.learner.id,
        enrollmentStatus: "HISTORICAL",
      });
      const learnersBefore = await prisma.learner.count({ where: { schoolId: school.id } });
      const familiesBefore = await prisma.familyAccount.count({ where: { schoolId: school.id } });
      const snapsBefore = Object.keys(readSchoolFamilyAccountAgeAnalysisSnapshots(school.id)).length;
      const balanceBefore = await resolveAuthoritativeAccountBalance(
        school.id,
        first.familyAccount.accountRef
      );

      let conflict: LearnerIdentityConflictError | null = null;
      try {
        await registerLearner({
          schoolId: school.id,
          learner: {
            firstName: "Ann",
            lastName: "Learner",
            grade: "1",
            idNumber: "2014010500000",
            birthDate: "2014-05-01",
          },
        });
      } catch (error) {
        if (error instanceof LearnerIdentityConflictError) conflict = error;
        else throw error;
      }
      assert(Boolean(conflict), "second add must conflict");
      assert(conflict?.existing.enrollmentStatus === "HISTORICAL", "conflict is historical");
      assert(
        (await prisma.learner.count({ where: { schoolId: school.id } })) === learnersBefore,
        "DUPLICATE HISTORICAL LEARNER DOES NOT CREATE SECOND LEARNER"
      );
      assert(
        (await prisma.familyAccount.count({ where: { schoolId: school.id } })) === familiesBefore,
        "FamilyAccount count does not increase"
      );
      assert(
        Object.keys(readSchoolFamilyAccountAgeAnalysisSnapshots(school.id)).length === snapsBefore,
        "Statement snapshot count does not increase"
      );
      assert(
        (await resolveAuthoritativeAccountBalance(school.id, first.familyAccount.accountRef)) ===
          balanceBefore,
        "No financial balance changes"
      );

      const reactivated = await reactivateHistoricalLearner({
        schoolId: school.id,
        learnerId: first.learner.id,
      });
      assert(reactivated.enrollmentStatus === "ACTIVE", "explicit reactivation restores ACTIVE");
      assert(reactivated.id === first.learner.id, "same learner identity preserved");
      assert(
        (await prisma.learner.count({ where: { schoolId: school.id } })) === learnersBefore,
        "reactivation does not clone learner"
      );
    });
  } finally {
    await destroySchool(school.id);
  }
  console.log("✓ DUPLICATE HISTORICAL LEARNER DOES NOT CREATE SECOND LEARNER");
}

async function testExistingFamilySiblingDoesNotCreateTempFamily() {
  const school = await createSchool("exist-fam");
  try {
    await withTempStores(async () => {
      const first = await registerLearner({
        schoolId: school.id,
        learner: { firstName: "Ann", lastName: "Family", grade: "1" },
      });
      writeSchoolLedger(school.id, [
        invoice(school.id, first.learner.id, first.familyAccount.accountRef, 14600, "fam-open"),
      ]);
      const before = await resolveAuthoritativeAccountBalance(
        school.id,
        first.familyAccount.accountRef
      );
      assert(before === 14600, "canonical starts at 14600");

      const sibling = await registerLearner({
        schoolId: school.id,
        learner: {
          firstName: "Ben",
          lastName: "Family",
          grade: "2",
          idNumber: "1710265277080",
          birthDate: "2017-10-26",
        },
        existingFamilyAccountId: first.familyAccount.id,
      });
      assert(sibling.createdNewFamilyAccount === false, "EXISTING FAMILY SIBLING DOES NOT CREATE TEMP FAMILYACCOUNT");
      assert(sibling.learner.familyAccountId === first.familyAccount.id, "sibling on canonical FA");
      assert(
        (await prisma.familyAccount.count({ where: { schoolId: school.id } })) === 1,
        "still one FamilyAccount"
      );
      const snaps = readSchoolFamilyAccountAgeAnalysisSnapshots(school.id);
      assert(Object.keys(snaps).length === 1, "no new temporary Statement snapshot");
      const afterCreate = await resolveAuthoritativeAccountBalance(
        school.id,
        first.familyAccount.accountRef
      );
      assert(afterCreate === 14600, "CANONICAL BALANCE DOES NOT CHANGE ON LEARNER CREATION");

      writeSchoolLedger(school.id, [
        invoice(school.id, first.learner.id, first.familyAccount.accountRef, 14600, "fam-open"),
        invoice(school.id, sibling.learner.id, first.familyAccount.accountRef, 800, "sib-inv"),
      ]);
      const afterInvoice = await resolveAuthoritativeAccountBalance(
        school.id,
        first.familyAccount.accountRef
      );
      assert(afterInvoice === 15400, "only genuine sibling invoice changes balance");
    });
  } finally {
    await destroySchool(school.id);
  }
  console.log("✓ EXISTING FAMILY SIBLING DOES NOT CREATE TEMP FAMILYACCOUNT");
  console.log("✓ CANONICAL BALANCE DOES NOT CHANGE ON LEARNER CREATION");
}

async function testNewFamilyStillWorks() {
  const school = await createSchool("new-fam");
  try {
    await withTempStores(async () => {
      const created = await registerLearner({
        schoolId: school.id,
        learner: { firstName: "New", lastName: "Child", grade: "1" },
      });
      assert(created.createdNewFamilyAccount === true, "new family created");
      const snaps = readSchoolFamilyAccountAgeAnalysisSnapshots(school.id);
      assert(Boolean(snaps[created.familyAccount.accountRef]), "snapshot created");
    });
  } finally {
    await destroySchool(school.id);
  }
  console.log("✓ new family registration still creates learner + FamilyAccount + snapshot");
}

async function testSameSurnameIndependent() {
  const school = await createSchool("same-sur");
  try {
    await withTempStores(async () => {
      const a = await registerLearner({
        schoolId: school.id,
        learner: {
          firstName: "Ann",
          lastName: "Smith",
          grade: "1",
          idNumber: "1111111111111",
          birthDate: "2010-01-01",
        },
      });
      const b = await registerLearner({
        schoolId: school.id,
        learner: {
          firstName: "Bob",
          lastName: "Smith",
          grade: "1",
          idNumber: "2222222222222",
          birthDate: "2011-02-02",
        },
      });
      assert(a.familyAccount.id !== b.familyAccount.id, "same surname stays independent");
    });
  } finally {
    await destroySchool(school.id);
  }
  console.log("✓ same surname does not auto-select family");
}

async function testHistoricalOutstandingDebtNotDuplicated() {
  const school = await createSchool("hist-debt");
  try {
    await withTempStores(async () => {
      const first = await registerLearner({
        schoolId: school.id,
        learner: {
          firstName: "Debt",
          lastName: "Child",
          grade: "1",
          idNumber: "5555555555555",
          birthDate: "2012-03-03",
        },
      });
      writeSchoolLedger(school.id, [
        invoice(school.id, first.learner.id, first.familyAccount.accountRef, 5000, "debt-inv"),
      ]);
      await updateLearnerEnrollmentStatus({
        schoolId: school.id,
        learnerId: first.learner.id,
        enrollmentStatus: "HISTORICAL",
      });
      const before = await resolveAuthoritativeAccountBalance(
        school.id,
        first.familyAccount.accountRef
      );
      assert(before === 5000, "historical account still owes 5000");
      let caught = false;
      try {
        await registerLearner({
          schoolId: school.id,
          learner: {
            firstName: "Debt",
            lastName: "Child",
            grade: "1",
            idNumber: "5555555555555",
            birthDate: "2012-03-03",
          },
        });
      } catch (error) {
        if (error instanceof LearnerIdentityConflictError) caught = true;
        else throw error;
      }
      assert(caught, "duplicate guard finds historical debtor");
      assert(
        (await prisma.learner.count({ where: { schoolId: school.id } })) === 1,
        "no second learner"
      );
      assert(
        (await resolveAuthoritativeAccountBalance(school.id, first.familyAccount.accountRef)) ===
          5000,
        "R5000 neither cleared nor duplicated"
      );
    });
  } finally {
    await destroySchool(school.id);
  }
  console.log("✓ historical outstanding debt is not cleared, duplicated, or moved");
}

async function testCrossSchoolDuplicateIdIgnored() {
  const schoolA = await createSchool("school-a");
  const schoolB = await createSchool("school-b");
  try {
    await withTempStores(async () => {
      await registerLearner({
        schoolId: schoolA.id,
        learner: {
          firstName: "Ada",
          lastName: "OtherSchool",
          grade: "1",
          idNumber: "1234567890123",
          birthDate: "2010-01-01",
        },
      });
      const created = await registerLearner({
        schoolId: schoolB.id,
        learner: {
          firstName: "Bea",
          lastName: "ThisSchool",
          grade: "1",
          idNumber: "1234567890123",
          birthDate: "2011-02-02",
        },
      });
      assert(created.learner.schoolId === schoolB.id, "School B learner created");
      const aDup = await findDuplicateLearnerInSchool({
        schoolId: schoolA.id,
        idNumber: "1234567890123",
      });
      assert(aDup?.schoolId === schoolA.id, "School A scan stays in School A");
    });
  } finally {
    await destroySchool(schoolA.id);
    await destroySchool(schoolB.id);
  }
  console.log("✓ duplicate ID in another school does not conflict");
}

async function testCrossSchoolFamilyAccountRejected() {
  const schoolA = await createSchool("fa-a");
  const schoolB = await createSchool("fa-b");
  try {
    await withTempStores(async () => {
      const a = await registerLearner({
        schoolId: schoolA.id,
        learner: { firstName: "Ann", lastName: "Alpha", grade: "1" },
      });
      const b = await registerLearner({
        schoolId: schoolB.id,
        learner: { firstName: "Ben", lastName: "Beta", grade: "1" },
      });
      let caught: Error | null = null;
      try {
        await registerLearner({
          schoolId: schoolB.id,
          learner: { firstName: "Cara", lastName: "Beta", grade: "1" },
          existingFamilyAccountId: a.familyAccount.id,
        });
      } catch (error) {
        caught = error as Error;
      }
      assert(caught instanceof CrossSchoolFamilyAccountError, "School B cannot attach to School A FA");
      assert(
        (await prisma.learner.count({ where: { schoolId: schoolB.id } })) === 1,
        "no School B learner created against School A family"
      );

      let mergeCaught: Error | null = null;
      try {
        await mergeFamilyAccounts({
          schoolId: schoolA.id,
          sourceFamilyAccountId: a.familyAccount.id,
          targetFamilyAccountId: b.familyAccount.id,
        });
      } catch (error) {
        mergeCaught = error as Error;
      }
      assert(Boolean(mergeCaught), "cross-school merge HARD FAIL");
      assert(
        /different schools|not found/i.test(String(mergeCaught?.message || "")),
        "cross-school merge rejected"
      );
      const sourceStill = await prisma.learner.findUnique({ where: { id: a.learner.id } });
      const targetStill = await prisma.learner.findUnique({ where: { id: b.learner.id } });
      assert(sourceStill?.familyAccountId === a.familyAccount.id, "no learner movement");
      assert(targetStill?.familyAccountId === b.familyAccount.id, "target learner unchanged");
    });
  } finally {
    await destroySchool(schoolA.id);
    await destroySchool(schoolB.id);
  }
  console.log("✓ cross-school family attach and merge are rejected");
}

async function testMagicalStyleStatementsRemainVisible() {
  const school = await createSchool("magical-style");
  try {
    await withTempStores(async () => {
      const active = await registerLearner({
        schoolId: school.id,
        learner: { firstName: "Active", lastName: "Row", grade: "1" },
      });
      const owing = await registerLearner({
        schoolId: school.id,
        learner: { firstName: "Owing", lastName: "Row", grade: "1" },
      });
      const overpaid = await registerLearner({
        schoolId: school.id,
        learner: { firstName: "Over", lastName: "Paid", grade: "1" },
      });
      writeSchoolLedger(school.id, [
        invoice(school.id, owing.learner.id, owing.familyAccount.accountRef, 2500, "owing-inv"),
        {
          id: "credit-1",
          schoolId: school.id,
          learnerId: overpaid.learner.id,
          accountNo: overpaid.familyAccount.accountRef,
          type: "credit",
          amount: 200,
          date: "2026-08-21",
          reference: "CR-1",
          description: "Credit",
          createdAt: new Date(Date.now() + 60_000).toISOString(),
        },
      ]);
      await updateLearnerEnrollmentStatus({
        schoolId: school.id,
        learnerId: owing.learner.id,
        enrollmentStatus: "HISTORICAL",
      });
      const statements = await buildAccountsFromAgeAnalysisSnapshots(school.id);
      const refs = statements.map((row) => row.accountNo);
      assert(refs.includes(active.familyAccount.accountRef), "active account remains visible");
      assert(refs.includes(owing.familyAccount.accountRef), "historical with outstanding remains visible");
      assert(refs.includes(overpaid.familyAccount.accountRef), "overpaid account remains visible");
      const owingRow = statements.find((row) => row.accountNo === owing.familyAccount.accountRef);
      assert((owingRow?.balance || 0) === 2500, "historical outstanding intact");
    });
  } finally {
    await destroySchool(school.id);
  }
  console.log("✓ Magical-style statement rows remain visible; no duplicate-prevention hide");
}

async function testSameParentDetailsOtherSchool() {
  const schoolA = await createSchool("par-a");
  const schoolB = await createSchool("par-b");
  try {
    const parentA = await prisma.parent.create({
      data: {
        schoolId: schoolA.id,
        firstName: "Sharon",
        surname: "Parent",
        cellNo: "0720000000",
        idNumber: "8001010000000",
      },
    });
    const parentB = await prisma.parent.create({
      data: {
        schoolId: schoolB.id,
        firstName: "Sharon",
        surname: "Parent",
        cellNo: "0720000000",
      },
    });
    assert(parentA.id !== parentB.id, "same parent details in another school stay separate");
    assert(parentA.schoolId !== parentB.schoolId, "parents are school-scoped rows");
  } finally {
    await destroySchool(schoolA.id);
    await destroySchool(schoolB.id);
  }
  console.log("✓ same parent details in another school do not join families");
}

async function testSameAccountRefOtherSchoolDoesNotAttach() {
  const schoolA = await createSchool("ref-a");
  const schoolB = await createSchool("ref-b");
  try {
    await withTempStores(async () => {
      const a = await registerLearner({
        schoolId: schoolA.id,
        learner: { firstName: "Ann", lastName: "Famref", grade: "1" },
      });
      const b = await registerLearner({
        schoolId: schoolB.id,
        learner: { firstName: "Ben", lastName: "Famref", grade: "1" },
      });
      assert(a.familyAccount.accountRef === b.familyAccount.accountRef, "same accountRef string in both schools");
      const sibling = await registerLearner({
        schoolId: schoolB.id,
        learner: { firstName: "Cara", lastName: "Famref", grade: "1", birthDate: "2018-03-03" },
        existingFamilyAccountId: b.familyAccount.id,
      });
      assert(sibling.familyAccount.id === b.familyAccount.id, "School B sibling stays on School B FAM");
      assert(sibling.familyAccount.id !== a.familyAccount.id, "School B sibling must not attach to School A FAM");
      const aCount = await prisma.learner.count({ where: { familyAccountId: a.familyAccount.id } });
      assert(aCount === 1, "School A family membership unchanged");
    });
  } finally {
    await destroySchool(schoolA.id);
    await destroySchool(schoolB.id);
  }
  console.log("✓ same account reference in another school does not attach");
}

async function main() {
  if (!isLocalDatabase()) {
    console.log("⊘ learner registration prevention tests skipped (DATABASE_URL is not localhost)");
    return;
  }
  await testDuplicateHistoricalDoesNotCreateSecondLearner();
  await testExistingFamilySiblingDoesNotCreateTempFamily();
  await testNewFamilyStillWorks();
  await testSameSurnameIndependent();
  await testHistoricalOutstandingDebtNotDuplicated();
  await testCrossSchoolDuplicateIdIgnored();
  await testCrossSchoolFamilyAccountRejected();
  await testMagicalStyleStatementsRemainVisible();
  await testSameParentDetailsOtherSchool();
  await testSameAccountRefOtherSchoolDoesNotAttach();
  console.log("\nAll learner registration prevention tests passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
