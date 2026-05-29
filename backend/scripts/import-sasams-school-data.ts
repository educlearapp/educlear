/**
 * SA-SAMS-only school import: learners, classrooms, parents (no Kid-e-Sys billing).
 *
 * Usage:
 *   cd backend
 *   npx tsc
 *   npx tsx scripts/import-sasams-school-data.ts --schoolId <id> --source "/path/to/sasams"
 *   npx tsx scripts/import-sasams-school-data.ts --schoolId <id> --source "/path/to/sasams" --apply
 */
import "dotenv/config";

import { prisma } from "../src/prisma";
import {
  dryRunSasamsSchoolImport,
  importSasamsSchoolData,
  resolveSasamsIngestPaths,
} from "../src/services/sasamsImport/importSasamsSchoolData";

function arg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  return v ? String(v).trim() : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function printDryRunSummary(dryRun: ReturnType<typeof dryRunSasamsSchoolImport>): void {
  console.log("\n=== SA-SAMS dry-run validation ===");
  console.log(`Class list files: ${dryRun.classListFiles}`);
  console.log(`Learners detected: ${dryRun.learnersDetected}`);
  console.log(`Classrooms detected: ${dryRun.classroomsDetected}`);
  console.log(`Parents detected: ${dryRun.parentsDetected}`);
  console.log(`Parent links detected: ${dryRun.parentLinksDetected}`);
  console.log(`Missing learner ID: ${dryRun.missingLearnerId}`);
  console.log(`Missing DOB: ${dryRun.missingDob}`);
  console.log(`Missing gender: ${dryRun.missingGender}`);
  console.log(`Unmatched parent links: ${dryRun.unmatchedParentLinks}`);
  console.log(`Duplicate parent matches: ${dryRun.duplicateParentMatches}`);
  console.log(`Validation: ${dryRun.passed ? "PASS" : "FAIL"}`);
  if (dryRun.errors.length) {
    console.log("Errors:");
    for (const err of dryRun.errors) console.log(`  - ${err}`);
  }
}

function printFinalReport(result: Awaited<ReturnType<typeof importSasamsSchoolData>>): void {
  console.log(`Learners imported: ${result.learnersImported}`);
  console.log(`Classrooms imported: ${result.classroomsImported}`);
  console.log(`Parents imported: ${result.parentsImported}`);
  console.log(`Parent links imported: ${result.parentLinksImported}`);
  console.log(`DOB written: ${result.dobWritten}`);
  console.log(`Gender written: ${result.genderWritten}`);
  console.log(`ID numbers written: ${result.idNumbersWritten}`);
  console.log(`Home language written: ${result.homeLanguageWritten}`);
  console.log(`Citizenship written: ${result.citizenshipWritten}`);
  console.log(`Missing learner ID: ${result.missingLearnerId}`);
  console.log(`Missing DOB: ${result.missingDob}`);
  console.log(`Missing gender: ${result.missingGender}`);
  console.log(`Profiles populated: ${result.profilesPopulated ? "yes" : "no"}`);
  console.log(`Parents populated: ${result.parentsPopulated ? "yes" : "no"}`);
  console.log(`Audit ${result.auditPass ? "PASS" : "FAIL"}`);
}

async function main(): Promise<void> {
  const schoolId = arg("schoolId");
  const source = arg("source");
  const apply = hasFlag("apply");

  if (!schoolId || !source) {
    console.error(
      "Usage: npx tsx scripts/import-sasams-school-data.ts --schoolId <id> --source <sasamsFolder> [--apply]"
    );
    process.exit(1);
  }

  const paths = resolveSasamsIngestPaths(source);
  const dryRun = dryRunSasamsSchoolImport(paths);
  printDryRunSummary(dryRun);

  if (!apply) {
    if (!dryRun.passed) process.exit(1);
    console.log("\nDry-run only. Re-run with --apply to import into the database.");
    process.exit(0);
  }

  if (!dryRun.passed) {
    console.error("\nImport blocked: fix validation errors first.");
    process.exit(1);
  }

  const result = await importSasamsSchoolData({
    schoolId,
    paths,
    dryRunOnly: false,
    allowExistingLearners: hasFlag("allowExisting"),
  });

  console.log("\n=== SA-SAMS import complete ===");
  printFinalReport(result);

  if (!result.auditPass) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
