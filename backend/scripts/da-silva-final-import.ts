/**
 * Da Silva Academy — protected final import (no rollback).
 * Requires CONFIRM_DA_SILVA_FINAL_IMPORT=true.
 *
 * Usage:
 *   CONFIRM_DA_SILVA_FINAL_IMPORT=true npx ts-node scripts/da-silva-final-import.ts [desktopRoot]
 */
import path from "path";
import { prisma } from "../src/prisma";
import {
  buildDaSilvaBundleFromDesktopLayout,
  commitDaSilvaMigration,
  createDaSilvaProjectId,
  saveDaSilvaStaging,
} from "../src/services/daSilvaMigration/daSilvaMigrationService";
import {
  approvedOpeningBalanceAdjustments,
  buildDaSilvaFinalImportSnapshot,
  DA_SILVA_FINAL_IMPORT_EXPECTED,
  DA_SILVA_OPENING_BALANCE_EXCLUDED_ACCOUNTS,
  isDaSilvaFinalImportEnvConfirmed,
} from "../src/services/daSilvaMigration/daSilvaFinalImportGate";

const SCHOOL_NAME = DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName;
const desktopRoot = process.argv[2] || path.join(process.env.HOME || "", "Desktop");

async function resolveSchoolId(): Promise<string> {
  const existing = await prisma.school.findFirst({
    where: { name: SCHOOL_NAME },
    select: { id: true, name: true },
  });
  if (existing) return existing.id;

  const created = await prisma.school.create({
    data: { name: SCHOOL_NAME },
    select: { id: true, name: true },
  });
  console.log(`Created school record: ${created.name} (${created.id})`);
  return created.id;
}

async function main(): Promise<void> {
  if (!isDaSilvaFinalImportEnvConfirmed()) {
    console.error(
      "BLOCKED: set CONFIRM_DA_SILVA_FINAL_IMPORT=true before running final import."
    );
    process.exit(1);
  }

  const startedAt = Date.now();
  const schoolId = await resolveSchoolId();
  const projectId = createDaSilvaProjectId();

  console.log(`Building bundle from: ${desktopRoot}`);
  const bundle = buildDaSilvaBundleFromDesktopLayout(schoolId, projectId, desktopRoot);
  await saveDaSilvaStaging(bundle);

  const openingBalanceCount = approvedOpeningBalanceAdjustments(bundle).length;
  const transactionCount = bundle.transactions.length;

  const result = await commitDaSilvaMigration({
    schoolId,
    projectId,
    confirmToken: bundle.confirmToken,
  });

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { name: true },
  });
  const dbLearners = await prisma.learner.count({ where: { schoolId } });
  const dbParents = await prisma.parent.count({ where: { schoolId } });
  const dbClassrooms = await prisma.classroom.count({ where: { schoolId } });
  const billingAccountsImported = new Set(
    bundle.learners.map((l) => String(l.accountNo || "").trim()).filter(Boolean)
  ).size;

  const postSnapshot = buildDaSilvaFinalImportSnapshot(bundle, school?.name || "");
  const dbChecks = [
    school?.name === DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName,
    dbLearners === DA_SILVA_FINAL_IMPORT_EXPECTED.learners,
    dbParents === DA_SILVA_FINAL_IMPORT_EXPECTED.parents,
    dbClassrooms === DA_SILVA_FINAL_IMPORT_EXPECTED.classes,
    billingAccountsImported === DA_SILVA_FINAL_IMPORT_EXPECTED.billingAccounts,
    result.imported.learners === DA_SILVA_FINAL_IMPORT_EXPECTED.learners,
    result.imported.ledgerEntries === transactionCount + openingBalanceCount,
    postSnapshot.openingBalanceAdjustments ===
      DA_SILVA_FINAL_IMPORT_EXPECTED.openingBalanceAdjustments,
    postSnapshot.ageAnalysisRemainingVariance === 0,
    postSnapshot.mergedFamilyLedgerGaps === 0,
  ];
  const finalDbStatus = dbChecks.every(Boolean) ? "PASS" : "FAIL";

  const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log("");
  console.log("IMPORT COMPLETE SUMMARY");
  console.log(`- School: ${school?.name || SCHOOL_NAME}`);
  console.log(`- Learners imported: ${result.imported.learners}`);
  console.log(`- Parents imported: ${result.imported.parents}`);
  console.log(`- Classes imported: ${result.imported.classrooms}`);
  console.log(`- Billing accounts imported: ${billingAccountsImported}`);
  console.log(`- Transactions imported: ${transactionCount}`);
  console.log(`- Opening balances imported: ${openingBalanceCount}`);
  console.log(
    `- MAR005 excluded confirmation: ${DA_SILVA_OPENING_BALANCE_EXCLUDED_ACCOUNTS.join(", ")} excluded (${openingBalanceCount} opening balances, not 112)`
  );
  console.log(`- Import duration: ${durationSec}s`);
  console.log(`- Final DB status: ${finalDbStatus}`);

  if (finalDbStatus === "FAIL") {
    console.error("Post-import DB verification failed:");
    if (school?.name !== DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName) {
      console.error(`  school name: expected ${DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName}, got ${school?.name}`);
    }
    if (dbLearners !== DA_SILVA_FINAL_IMPORT_EXPECTED.learners) {
      console.error(`  learners: expected ${DA_SILVA_FINAL_IMPORT_EXPECTED.learners}, got ${dbLearners}`);
    }
    if (dbParents !== DA_SILVA_FINAL_IMPORT_EXPECTED.parents) {
      console.error(`  parents: expected ${DA_SILVA_FINAL_IMPORT_EXPECTED.parents}, got ${dbParents}`);
    }
    if (dbClassrooms !== DA_SILVA_FINAL_IMPORT_EXPECTED.classes) {
      console.error(`  classrooms: expected ${DA_SILVA_FINAL_IMPORT_EXPECTED.classes}, got ${dbClassrooms}`);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
