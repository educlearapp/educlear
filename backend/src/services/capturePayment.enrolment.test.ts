/**
 * Automatic enrolment + Capture Payment recognition (local/disposable Prisma only).
 * Run: npx tsx src/services/capturePayment.enrolment.test.ts
 *
 * Skips when DATABASE_URL is not localhost — never writes to production.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { PrismaClient } from "@prisma/client";

import { registerLearner } from "./learnerRegistrationService";
import {
  captureManualPayment,
  CapturePaymentError,
  setCapturePaymentFamilyResolverForTests,
} from "./capturePaymentService";
import { resolveCapturePaymentFamilyAccount } from "./resolveCapturePaymentFamilyAccount";
import { invalidateOfficialBillingAccountRefsCache } from "./officialBillingAccountRef";
import {
  invalidateFamilyAccountAgeAnalysisFileCache,
  readSchoolFamilyAccountAgeAnalysisSnapshots,
  setFamilyAccountAgeAnalysisStoreDataDirForTests,
} from "../utils/familyAccountAgeAnalysisStore";
import {
  readSchoolLedger,
  setBillingLedgerStoreDataDirForTests,
  writeSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import { setFamilyAccountAuditStoreDataDirForTests } from "../utils/familyAccountAuditStore";
import { setPaymentAllocationStoreDataDirForTests } from "../utils/paymentAllocationStore";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capture-enrol-"));
  fs.writeFileSync(path.join(dir, "family-account-age-analysis.json"), "{}", "utf8");
  fs.writeFileSync(path.join(dir, "billing-ledger.json"), "{}", "utf8");
  fs.writeFileSync(path.join(dir, "family-account-audit.json"), "{}", "utf8");
  fs.writeFileSync(path.join(dir, "payment-allocations.json"), "{}", "utf8");
  return dir;
}

async function withTempStores<T>(fn: () => Promise<T>): Promise<T> {
  const tempDir = makeTempDataDir();
  setFamilyAccountAgeAnalysisStoreDataDirForTests(tempDir);
  setBillingLedgerStoreDataDirForTests(tempDir);
  setFamilyAccountAuditStoreDataDirForTests(tempDir);
  setPaymentAllocationStoreDataDirForTests(tempDir);
  setCapturePaymentFamilyResolverForTests(null);
  invalidateFamilyAccountAgeAnalysisFileCache();
  invalidateOfficialBillingAccountRefsCache();
  try {
    return await fn();
  } finally {
    setFamilyAccountAgeAnalysisStoreDataDirForTests(null);
    setBillingLedgerStoreDataDirForTests(null);
    setFamilyAccountAuditStoreDataDirForTests(null);
    setPaymentAllocationStoreDataDirForTests(null);
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
  await prisma.parentLearnerLink.deleteMany({ where: { schoolId } }).catch(() => undefined);
  await prisma.billingDeposit.deleteMany({ where: { schoolId } }).catch(() => undefined);
  await prisma.learner.deleteMany({ where: { schoolId } });
  await prisma.parent.deleteMany({ where: { schoolId } }).catch(() => undefined);
  await prisma.familyAccount.deleteMany({ where: { schoolId } });
  await prisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
}

function invoice(schoolId: string, learnerId: string, accountNo: string, amount: number, id: string): BillingLedgerEntry {
  const createdAt = new Date().toISOString();
  return {
    id,
    schoolId,
    learnerId,
    accountNo,
    type: "invoice",
    amount,
    date: createdAt.slice(0, 10),
    reference: `INV-${id}`,
    description: "Fees",
    source: "manual",
    createdAt,
  };
}

async function testANewFamily() {
  const school = await createSchool("new-fam");
  try {
    await withTempStores(async () => {
      const created = await registerLearner({
        schoolId: school.id,
        learner: { firstName: "Nova", lastName: "Family", grade: "1" },
      });
      assert(Boolean(created.learner.id), "learner created");
      assert(Boolean(created.familyAccount.id), "FamilyAccount.id generated");
      assert(Boolean(created.accountNo), "human-readable account number generated");
      assert(created.learner.familyAccountId === created.familyAccount.id, "learner linked");
      assert(created.createdNewFamilyAccount === true, "new family created account");

      const resolved = await resolveCapturePaymentFamilyAccount({
        familyAccountId: created.familyAccount.id,
        authorizedSchoolId: school.id,
      });
      assert(resolved.ok, "Capture Payment recognizes the new account");

      const snaps = readSchoolFamilyAccountAgeAnalysisSnapshots(school.id);
      assert(Boolean(snaps[created.familyAccount.accountRef]), "statement snapshot exists");

      writeSchoolLedger(school.id, [
        invoice(school.id, created.learner.id, created.familyAccount.accountRef, 500, "inv-new"),
      ]);
      const pay = await captureManualPayment({
        authorizedSchoolId: school.id,
        familyAccountId: created.familyAccount.id,
        amount: 500,
        date: "2026-08-30",
        method: "EFT",
        description: "Enrol test",
        idempotencyKey: "enrol-a",
        capturedByUserId: "u1",
        capturedByEmail: "finance@test.local",
        capturedByName: "Finance",
      });
      assert(pay.balance === 0, "invoice/balance path works after enrolment");
    });
  } finally {
    await destroySchool(school.id);
  }
  console.log("✓ TEST A new family auto-creates account + Capture Payment recognizes it");
}

async function testBSibling() {
  const school = await createSchool("sib-fam");
  try {
    await withTempStores(async () => {
      const first = await registerLearner({
        schoolId: school.id,
        learner: { firstName: "Ann", lastName: "Sibling", grade: "1" },
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
          lastName: "Sibling",
          grade: "2",
          idNumber: `${Date.now()}`.slice(-13).padStart(13, "1"),
          birthDate: "2017-10-26",
        },
        existingFamilyAccountId: first.familyAccount.id,
      });
      assert(sibling.createdNewFamilyAccount === false, "sibling does not create a second family");
      assert(sibling.learner.familyAccountId === first.familyAccount.id, "linked to surviving FA");
      const count = await prisma.familyAccount.count({ where: { schoolId: school.id } });
      assert(count === 1, "no obsolete second FamilyAccount");

      const after = await resolveAuthoritativeAccountBalance(
        school.id,
        first.familyAccount.accountRef
      );
      assert(after === before, "enrolment does not change existing family balance");

      const pay = await captureManualPayment({
        authorizedSchoolId: school.id,
        familyAccountId: first.familyAccount.id,
        amount: 100,
        date: "2026-08-30",
        method: "Cash",
        description: "Sibling family",
        idempotencyKey: "enrol-b",
        capturedByUserId: "u1",
        capturedByEmail: "finance@test.local",
        capturedByName: "Finance",
      });
      assert(pay.familyAccountId === first.familyAccount.id, "Capture Payment uses surviving FA");
      assert(pay.balance === 14500, "one family account received the payment");
    });
  } finally {
    await destroySchool(school.id);
  }
  console.log("✓ TEST B sibling links to existing family; no duplicate account; balance unchanged by enrolment");
}

async function testCCrossSchoolSimilarNames() {
  const schoolA = await createSchool("smith-a");
  const schoolB = await createSchool("smith-b");
  try {
    await withTempStores(async () => {
      const a = await registerLearner({
        schoolId: schoolA.id,
        learner: { firstName: "Sam", lastName: "Smith", grade: "1" },
      });
      const b = await registerLearner({
        schoolId: schoolB.id,
        learner: { firstName: "Sam", lastName: "Smith", grade: "1" },
      });
      try {
        await captureManualPayment({
          authorizedSchoolId: schoolA.id,
          familyAccountId: b.familyAccount.id,
          amount: 10,
          date: "2026-08-30",
          method: "EFT",
          description: "cross",
          idempotencyKey: "enrol-c",
          capturedByUserId: "u1",
          capturedByEmail: "finance@test.local",
          capturedByName: "Finance",
        });
        throw new Error("expected cross-school reject");
      } catch (error) {
        assert(error instanceof CapturePaymentError && error.status === 403, "similar name other school rejected");
      }
      assert(readSchoolLedger(schoolA.id).filter((e) => e.type === "payment").length === 0, "no payment on A");
      assert(readSchoolLedger(schoolB.id).filter((e) => e.type === "payment").length === 0, "no payment on B");
      assert(a.familyAccount.id !== b.familyAccount.id, "separate FamilyAccount.id per school");
    });
  } finally {
    await destroySchool(schoolA.id);
    await destroySchool(schoolB.id);
  }
  console.log("✓ TEST C similar names at different schools remain isolated");
}

async function main() {
  if (!isLocalDatabase()) {
    console.log("SKIP capturePayment.enrolment.test.ts — DATABASE_URL is not local");
    return;
  }
  try {
    await testANewFamily();
    await testBSibling();
    await testCCrossSchoolSimilarNames();
    console.log("\nAll capturePayment.enrolment tests passed.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
