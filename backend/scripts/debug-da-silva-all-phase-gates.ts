/**
 * Dry-run all Da Silva migration phase gates (Phase 1–5) without writing data.
 *
 * Usage:
 *   npx tsx scripts/debug-da-silva-all-phase-gates.ts [schoolId] [projectId]
 */
import "dotenv/config";

import fs from "fs";
import path from "path";

import { prisma } from "../src/prisma";
import { isAllowedDaSilvaSupplementClassroom } from "../src/services/daSilvaMigration/daSilvaConstants";
import { DA_SILVA_FINAL_IMPORT_EXPECTED } from "../src/services/daSilvaMigration/daSilvaFinalImportGate";
import {
  evaluateAllDaSilvaPhaseGates,
  type DaSilvaPhaseGateResult,
  type DaSilvaPhaseGateSnapshot,
} from "../src/services/daSilvaMigration/daSilvaPhaseGates";
import {
  loadDaSilvaManifest,
  validateDaSilvaClassroomsFromKidESys,
} from "../src/services/daSilvaMigration/daSilvaMigrationService";
import {
  assertDaSilvaMigrationManifestReady,
  loadStagingUploadManifest,
  pathsFromStagingUploadManifest,
} from "../src/services/daSilvaMigration/daSilvaUploadManifest";
import { parseAgeAnalysisFile } from "../src/services/daSilvaMigration/parsers";

const STAGING_ROOT = path.join(process.cwd(), "uploads", "migration-staging");

function findLatestProjectId(schoolId: string): string | null {
  const schoolDir = path.join(STAGING_ROOT, schoolId);
  if (!fs.existsSync(schoolDir)) return null;

  const manifestFiles = fs
    .readdirSync(schoolDir)
    .filter((f) => f.startsWith("dasilva-") && f.endsWith(".manifest.json"))
    .map((f) => ({
      file: f,
      mtime: fs.statSync(path.join(schoolDir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (manifestFiles.length) {
    return manifestFiles[0].file.replace(/^dasilva-/, "").replace(/\.manifest\.json$/, "");
  }

  const projectDirs = fs
    .readdirSync(schoolDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("dasilva-"))
    .map((d) => d.name)
    .sort()
    .reverse();
  return projectDirs[0] || null;
}

async function resolveSchoolId(arg: string): Promise<string> {
  if (arg) return arg;
  const school = await prisma.school.findFirst({
    where: { name: DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName },
    select: { id: true },
  });
  if (!school) throw new Error(`School not found: ${DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName}`);
  return school.id;
}

function printGate(result: DaSilvaPhaseGateResult): void {
  console.log(`\n=== ${result.label} ===`);
  console.log(`Status: ${result.passed ? "PASS" : "FAIL"}`);
  console.log("Expected:", JSON.stringify(result.expected, null, 2));
  console.log("Actual:", JSON.stringify(result.actual, null, 2));
  if (result.blocker) {
    console.log(`Blocker: ${result.blocker}`);
  }
}

async function main(): Promise<void> {
  let schoolId = (process.argv[2] || "").trim();
  let projectId = (process.argv[3] || "").trim();

  schoolId = await resolveSchoolId(schoolId);
  if (!projectId) {
    projectId = findLatestProjectId(schoolId) || "";
  }

  console.log("=== Da Silva migration — all phase gates (dry run) ===");
  console.log(`School ID: ${schoolId}`);
  console.log(`Project ID: ${projectId || "(none)"}`);

  const importManifest = projectId ? loadDaSilvaManifest(schoolId, projectId) : null;
  const phasesCompleted = importManifest?.phasesCompleted || [];

  let manifestReady = false;
  let sasamsClassListFileCount: number | undefined;
  let sasamsClassListLearnerCount: number | undefined;
  let sasamsValidationPassed: boolean | undefined;
  let billingTotal = 0;
  let billingMatched = 0;

  if (projectId) {
    try {
      const stagingManifest = loadStagingUploadManifest(schoolId, projectId);
      const gate = assertDaSilvaMigrationManifestReady(stagingManifest);
      manifestReady = gate.ready;

      const staged = pathsFromStagingUploadManifest(stagingManifest);
      if (fs.existsSync(staged.classListDir)) {
        const validation = validateDaSilvaClassroomsFromKidESys(staged.classListDir);
        sasamsValidationPassed = validation.passed;
        sasamsClassListFileCount = validation.sourceFileCount;
        sasamsClassListLearnerCount = validation.totalLearners;
      }

      if (fs.existsSync(staged.ageAnalysis)) {
        const accounts = parseAgeAnalysisFile(staged.ageAnalysis);
        billingTotal = accounts.length;
      }
    } catch (e) {
      console.log(`Staging manifest: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const classroomRows = await prisma.classroom.findMany({
    where: { schoolId },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  const classroomNames = classroomRows.map((c) => c.name);

  const learners = await prisma.learner.findMany({
    where: { schoolId },
    select: { className: true },
  });
  const crecheLearnerCount = learners.filter((l) =>
    isAllowedDaSilvaSupplementClassroom(String(l.className || ""))
  ).length;

  const parentLinkCount = await prisma.parentLearnerLink.count({ where: { schoolId } });
  const learnersWithFamilyAccount = await prisma.learner.count({
    where: { schoolId, familyAccountId: { not: null } },
  });

  if (importManifest?.accountToLearnerId) {
    billingMatched = Object.keys(importManifest.accountToLearnerId).length;
  } else if (learnersWithFamilyAccount > 0) {
    billingMatched = learnersWithFamilyAccount;
  }

  const snapshot: DaSilvaPhaseGateSnapshot = {
    classroomNames,
    learnerCount: learners.length,
    crecheLearnerCount,
    parentLinkCount,
    billingMatched,
    billingTotal,
    phasesCompleted,
    manifestReady,
    sasamsClassListFileCount,
    sasamsClassListLearnerCount,
    sasamsValidationPassed,
  };

  console.log("\nDatabase snapshot:");
  console.log(`  Classrooms: ${classroomNames.length} (${classroomNames.join(", ") || "—"})`);
  console.log(`  Learners: ${learners.length} (Crèche: ${crecheLearnerCount})`);
  console.log(`  Parent links: ${parentLinkCount}`);
  console.log(`  Billing matched: ${billingMatched}/${billingTotal || "?"}`);
  console.log(`  Phases completed: ${phasesCompleted.join(", ") || "(none)"}`);

  const results = evaluateAllDaSilvaPhaseGates(snapshot);
  for (const result of results) {
    printGate(result);
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n=== Summary ===`);
  console.log(`Passed: ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    console.log("Failed phases:");
    for (const result of failed) {
      console.log(`  - ${result.label}: ${result.blocker}`);
    }
    process.exitCode = 1;
  } else {
    console.log("All phase gates passed.");
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
