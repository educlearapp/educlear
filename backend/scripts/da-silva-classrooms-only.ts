/**
 * Da Silva migration — phase 1: SA-SAMS class lists → classrooms only.
 *
 * Usage:
 *   npx ts-node scripts/da-silva-classrooms-only.ts [desktopRoot]
 *
 * Validates SA-SAMS class list exports (20 SA-SAMS classes, no duplicates, no ghosts),
 * imports classrooms to Da Silva Academy, then stops. Does not import learners or billing.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

import { prisma } from "../src/prisma";
import {
  commitDaSilvaClassroomsOnly,
  createDaSilvaProjectId,
  DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT,
  validateDaSilvaClassroomsFromKidESys,
} from "../src/services/daSilvaMigration/daSilvaMigrationService";
import { DA_SILVA_FINAL_IMPORT_EXPECTED } from "../src/services/daSilvaMigration/daSilvaFinalImportGate";
import { resolveDaSilvaSasamsPaths } from "../src/services/daSilvaMigration/daSilvaMigrationStrategy";

const desktopRoot = process.argv[2] || path.join(process.env.HOME || "", "Desktop");
const sasamsPaths = resolveDaSilvaSasamsPaths(desktopRoot);
const classListDir = sasamsPaths.classListDir;
const SCHOOL_NAME = DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName;

function printValidation(label: string, v: ReturnType<typeof validateDaSilvaClassroomsFromKidESys>): void {
  console.log(`\n=== ${label} ===`);
  console.log(`Status: ${v.passed ? "PASS" : "FAIL"}`);
  console.log(`Source files: ${v.sourceFileCount} (required: ${v.expectedCount})`);
  console.log(`Unique classrooms: ${v.uniqueCanonicalCount} (required: ${v.expectedCount})`);
  console.log(`Unique match keys: ${v.uniqueMatchKeyCount} (required: ${v.expectedCount})`);
  console.log(`Total learners in class lists: ${v.totalLearners} (SA-SAMS; not imported yet)`);
  if (v.duplicates.length) {
    console.log("Duplicates:", JSON.stringify(v.duplicates, null, 2));
  }
  if (v.emptyClassFiles.length) {
    console.log("Empty class files:", v.emptyClassFiles.join(", "));
  }
  if (v.ghostClassNames.length) {
    console.log("Ghost classes:", v.ghostClassNames.join(", "));
  }
  if (v.errors.length) {
    console.log("Errors:");
    for (const err of v.errors) console.log(`  - ${err}`);
  }
  console.log("\nPer-class learner counts (Kid-e-Sys):");
  for (const row of v.classrooms) {
    console.log(`  ${row.canonicalName}: ${row.learnerCount} (${row.sourceFile})`);
  }
}

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
  console.log(`Created school: ${created.name} (${created.id})`);
  return created.id;
}

async function main(): Promise<void> {
  if (!fs.existsSync(classListDir)) {
    console.error(`Class list folder not found: ${classListDir}`);
    process.exit(1);
  }

  const schoolId = await resolveSchoolId();
  const projectId = createDaSilvaProjectId();

  console.log("=== Da Silva migration — classrooms only (phase 1) ===");
  console.log(`School: ${SCHOOL_NAME} (${schoolId})`);
  console.log(`Project: ${projectId}`);
  console.log(`SA-SAMS class lists: ${classListDir}`);
  console.log(`Required SA-SAMS classroom count: ${DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT}`);

  const preDb = await prisma.classroom.findMany({
    where: { schoolId },
    select: { name: true },
  });
  const learners = await prisma.learner.count({ where: { schoolId } });
  const parents = await prisma.parent.count({ where: { schoolId } });
  console.log(`\nDatabase before import: ${preDb.length} classroom(s), ${learners} learner(s), ${parents} parent(s)`);

  if (learners > 0 || parents > 0) {
    console.error(
      "BLOCKED: school still has learners or parents. Run school-data-cleanup.ts --apply for a fresh start."
    );
    process.exit(1);
  }

  const preValidation = validateDaSilvaClassroomsFromKidESys(
    classListDir,
    preDb.map((c) => c.name)
  );
  printValidation("Pre-import SA-SAMS validation", preValidation);
  if (!preValidation.passed) {
    process.exit(1);
  }

  const result = await commitDaSilvaClassroomsOnly({ schoolId, projectId, classListDir });
  printValidation("Post-import validation", result.postImportValidation);

  const dbClassrooms = await prisma.classroom.findMany({
    where: { schoolId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const dbLearners = await prisma.learner.count({ where: { schoolId } });
  const dbParents = await prisma.parent.count({ where: { schoolId } });

  console.log("\n=== Import result ===");
  console.log(`Classrooms imported: ${result.imported.classrooms}`);
  console.log(`Manifest: uploads/migration-staging/${schoolId}/dasilva-${projectId}.manifest.json`);
  console.log(`Database classrooms: ${dbClassrooms.length}`);
  console.log(`Database learners: ${dbLearners} (must stay 0 until phase 2)`);
  console.log(`Database parents: ${dbParents} (must stay 0 until phase 2)`);

  if (!result.success) {
    console.error("\nSTOPPED: post-import validation failed.");
    process.exit(1);
  }

  console.log("\nSTOPPED after classrooms only — ready for phase 2 (learners) when approved.");
  console.log(`Next project id for resume: ${projectId}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
