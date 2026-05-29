/**
 * Da Silva migration — phase 2: SA-SAMS learners only.
 *
 * Usage:
 *   npx ts-node scripts/da-silva-learners-only.ts [desktopRoot] [projectId]
 *
 * Requires phase 1 (classrooms) manifest from da-silva-classrooms-only.ts.
 * Imports learners from SA-SAMS class lists (primary) + learner register (enrichment).
 * Does NOT import parents, billing, employees, or ledger entries.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

import { prisma } from "../src/prisma";
import {
  commitDaSilvaLearnersOnly,
  DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT,
  validateDaSilvaLearnersFromKidESys,
} from "../src/services/daSilvaMigration/daSilvaMigrationService";
import { DA_SILVA_FINAL_IMPORT_EXPECTED } from "../src/services/daSilvaMigration/daSilvaFinalImportGate";
import { resolveDaSilvaSasamsPaths } from "../src/services/daSilvaMigration/daSilvaMigrationStrategy";
import { readSchoolBillingPlans } from "../src/utils/learnerBillingPlanStore";
import { readSchoolLedger } from "../src/utils/billingLedgerStore";

const desktopRoot = process.argv[2] || path.join(process.env.HOME || "", "Desktop");
const projectIdArg = process.argv[3] || "";
const sasamsPaths = resolveDaSilvaSasamsPaths(desktopRoot);
const SCHOOL_NAME = DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName;

function printValidation(label: string, v: Awaited<ReturnType<typeof validateDaSilvaLearnersFromKidESys>>): void {
  console.log(`\n=== ${label} ===`);
  console.log(`Status: ${v.passed ? "PASS" : "FAIL"}`);
  console.log(`Expected total learners: ${v.expectedTotal}`);
  console.log(`Actual total learners: ${v.actualTotal}`);
  console.log(`Orphan learners: ${v.orphanCount} (must be 0)`);
  if (v.errors.length) {
    console.log("Errors:");
    for (const err of v.errors) console.log(`  - ${err}`);
  }
  console.log("\nPer-classroom learner counts:");
  for (const row of v.classroomCounts) {
    const mark = row.match ? "OK" : "MISMATCH";
    console.log(`  ${row.classroomName}: ${row.actual} (expected: ${row.expected}) ${mark}`);
  }
  if (v.orphans.length) {
    console.log("\nOrphan learners:");
    for (const o of v.orphans) {
      console.log(`  ${o.firstName} ${o.lastName} — className: ${o.className ?? "(null)"}`);
    }
  }
}

async function resolveSchoolId(): Promise<string> {
  const existing = await prisma.school.findFirst({
    where: { name: SCHOOL_NAME },
    select: { id: true, name: true },
  });
  if (existing) return existing.id;

  throw new Error(`School not found: ${SCHOOL_NAME}. Run da-silva-classrooms-only.ts first.`);
}

async function resolveProjectId(schoolId: string): Promise<string> {
  if (projectIdArg) return projectIdArg;

  const stagingRoot = path.join(process.cwd(), "uploads", "migration-staging", schoolId);
  if (!fs.existsSync(stagingRoot)) {
    throw new Error("No migration staging folder — run da-silva-classrooms-only.ts first.");
  }

  const manifests = fs
    .readdirSync(stagingRoot)
    .filter((f) => f.endsWith(".manifest.json"))
    .map((f) => ({
      file: f,
      mtime: fs.statSync(path.join(stagingRoot, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (!manifests.length) {
    throw new Error("No manifest found — run da-silva-classrooms-only.ts first.");
  }

  const latest = manifests[0].file.replace(/^dasilva-/, "").replace(/\.manifest\.json$/, "");
  console.log(`Using latest manifest project: ${latest}`);
  return latest;
}

async function main(): Promise<void> {
  if (!fs.existsSync(sasamsPaths.classListDir)) {
    console.error(`SA-SAMS class list folder not found: ${sasamsPaths.classListDir}`);
    process.exit(1);
  }
  if (!fs.existsSync(sasamsPaths.learnerRegister)) {
    console.error(`SA-SAMS learner register not found: ${sasamsPaths.learnerRegister}`);
    process.exit(1);
  }

  const schoolId = await resolveSchoolId();
  const projectId = await resolveProjectId(schoolId);

  console.log("=== Da Silva migration — learners only (phase 2) ===");
  console.log(`School: ${SCHOOL_NAME} (${schoolId})`);
  console.log(`Project: ${projectId}`);
  console.log(`SA-SAMS class lists: ${sasamsPaths.classListDir}`);
  console.log(`SA-SAMS learner register (enrichment): ${sasamsPaths.learnerRegister}`);
  console.log(`Required SA-SAMS learner count: ${DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT}`);
  console.log("Source priority: class_lists (primary) → learner_register (missing fields only)");

  const preDbLearners = await prisma.learner.count({ where: { schoolId } });
  const preDbParents = await prisma.parent.count({ where: { schoolId } });
  const preDbFamilyAccounts = await prisma.familyAccount.count({ where: { schoolId } });
  const preDbLinks = await prisma.parentLearnerLink.count({ where: { schoolId } });
  const preDbClassrooms = await prisma.classroom.count({ where: { schoolId } });
  const preLedgerEntries = readSchoolLedger(schoolId).length;
  const preBillingPlans = Object.keys(readSchoolBillingPlans(schoolId)).length;
  console.log(
    `\nDatabase before import: ${preDbClassrooms} classroom(s), ${preDbLearners} learner(s), ${preDbParents} parent(s)`
  );
  console.log(`Billing ledger entries: ${preLedgerEntries} (must be 0)`);
  console.log(`Billing plans (learners): ${preBillingPlans} (must be 0)`);
  console.log(`Family accounts: ${preDbFamilyAccounts} (must be 0)`);
  console.log(`Parent-learner links: ${preDbLinks} (must be 0)`);

  if (preDbParents > 0) {
    console.error("BLOCKED: school already has parents. Learners-only import must not run after parents.");
    process.exit(1);
  }
  if (preDbFamilyAccounts > 0) {
    console.error(
      "BLOCKED: school already has family accounts. Learners-only import must not run after parents-only."
    );
    process.exit(1);
  }
  if (preDbLinks > 0) {
    console.error(
      "BLOCKED: school already has parent-learner links. Learners-only import must not run after parents-only."
    );
    process.exit(1);
  }
  if (preLedgerEntries > 0) {
    console.error("BLOCKED: billing ledger already has entries. Learners-only import must not run after billing-only.");
    process.exit(1);
  }
  if (preBillingPlans > 0) {
    console.error("BLOCKED: billing plans already exist. Learners-only import must not run after billing-only.");
    process.exit(1);
  }

  const preValidation = await validateDaSilvaLearnersFromKidESys(sasamsPaths);
  printValidation("Pre-import SA-SAMS validation", preValidation);
  if (!preValidation.passed) {
    process.exit(1);
  }

  const result = await commitDaSilvaLearnersOnly({ schoolId, projectId, sasamsPaths });

  console.log("\n=== Phase 2 learner parse audit ===");
  console.log(`Learners parsed from class lists: ${result.audit.parse.classListParsed}`);
  console.log(`Learners after merge (class-list primary): ${result.audit.parse.mergedTotal}`);
  console.log(`Learner register rows parsed: ${result.audit.parse.registerParsed}`);
  console.log(`Register-only rows skipped (not imported): ${result.audit.parse.registerOnlySkipped}`);
  console.log(`Learners enriched from learner_register: ${result.audit.parse.enrichedFromRegister}`);
  console.log(`Missing DOB after merge: ${result.audit.parse.missingDob}`);
  console.log(`Missing gender after merge: ${result.audit.parse.missingGender}`);
  console.log(`Missing ID number after merge: ${result.audit.parse.missingId}`);
  console.log("\nPer-classroom counts (from class lists):");
  for (const row of result.audit.parse.perClassroomCounts) {
    console.log(`  ${row.classroomName}: ${row.count}`);
  }

  console.log("\n=== Phase 2 database write audit ===");
  console.log(`Learners created: ${result.audit.learnersCreated}`);
  console.log(`Learners updated: ${result.audit.learnersUpdated}`);
  console.log(`Enrollment status: ACTIVE (enrolled on class lists)`);

  printValidation("Post-import validation", result.postImportValidation);

  const dbLearners = await prisma.learner.count({ where: { schoolId } });
  const dbParents = await prisma.parent.count({ where: { schoolId } });
  const dbFamilyAccounts = await prisma.familyAccount.count({ where: { schoolId } });
  const dbLinks = await prisma.parentLearnerLink.count({ where: { schoolId } });
  const dbLedgerEntries = readSchoolLedger(schoolId).length;
  const dbBillingPlans = Object.keys(readSchoolBillingPlans(schoolId)).length;
  const dbEmployees = await prisma.employee.count({ where: { schoolId } });

  console.log("\n=== Import result ===");
  console.log(`Learners imported: ${result.imported.learners}`);
  console.log(`Failed learners: ${result.failed.length}`);
  console.log(`Skipped learners: ${result.skipped.length}`);
  console.log(`Database learners: ${dbLearners}`);
  console.log(`Database parents: ${dbParents} (must stay 0)`);
  console.log(`Database family accounts: ${dbFamilyAccounts} (must stay 0)`);
  console.log(`Database parent-learner links: ${dbLinks} (must stay 0)`);
  console.log(`Billing ledger entries: ${dbLedgerEntries} (must stay 0)`);
  console.log(`Billing plans (learners): ${dbBillingPlans} (must stay 0)`);
  console.log(`Database employees: ${dbEmployees} (must stay 0)`);
  console.log(`Manifest: uploads/migration-staging/${schoolId}/dasilva-${projectId}.manifest.json`);

  if (result.failed.length) {
    console.log("\nFailed learner details:");
    for (const row of result.failed) {
      console.log(`  ${row.fullName} (${row.matchKey}): ${row.reason}`);
    }
  }
  if (result.skipped.length) {
    console.log("\nSkipped learner details:");
    for (const row of result.skipped) {
      console.log(`  ${row.fullName} (${row.matchKey}): ${row.reason}`);
    }
  }

  if (!result.success) {
    console.error("\nSTOPPED: post-import validation failed.");
    process.exit(1);
  }

  if (
    dbParents !== 0 ||
    dbFamilyAccounts !== 0 ||
    dbLinks !== 0 ||
    dbLedgerEntries !== 0 ||
    dbBillingPlans !== 0
  ) {
    throw new Error(
      [
        "LEARNERS-ONLY PHASE VIOLATION:",
        `parents=${dbParents}`,
        `familyAccounts=${dbFamilyAccounts}`,
        `parentLearnerLinks=${dbLinks}`,
        `ledgerEntries=${dbLedgerEntries}`,
        `billingPlans=${dbBillingPlans}`,
      ].join(" ")
    );
  }

  console.log("\nSTOPPED after learners only — ready for phase 3 (parents) when approved.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
