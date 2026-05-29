/**
 * One-time Da Silva Academy gender backfill.
 * Primary: staged SA-SAMS import source when a manifest exists.
 * Fallback: live DB active learners + SA ID gender inference (no staging required).
 * Never overwrites an existing valid Male/Female gender.
 *
 * Usage:
 *   npx tsx scripts/repair-da-silva-learner-gender.ts
 *   npx tsx scripts/repair-da-silva-learner-gender.ts --apply
 *   npx tsx scripts/repair-da-silva-learner-gender.ts --apply [schoolId] [projectId]
 */
import "dotenv/config";

import fs from "fs";
import path from "path";

import { DA_SILVA_ACADEMY_SCHOOL_ID } from "../src/services/activateDaSilvaSubscription";
import {
  repairDaSilvaLearnerGender,
  repairDaSilvaLearnerGenderFromLiveDb,
  tryResolveLatestDaSilvaStagingProject,
} from "../src/services/daSilvaMigration/daSilvaCurrentDbRepair";
import { prisma } from "../src/prisma";

const apply = process.argv.includes("--apply");
const args = process.argv.slice(2).filter((a) => a !== "--apply");
const schoolId = args[0] || DA_SILVA_ACADEMY_SCHOOL_ID;
const projectIdArg = args[1] || "";

function maskSaId(idNumber: string): string {
  const digits = String(idNumber || "").replace(/\D/g, "");
  if (digits.length < 4) return idNumber;
  return `${digits.slice(0, 6)}****${digits.slice(-3)}`;
}

async function main(): Promise<void> {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) throw new Error(`School not found: ${schoolId}`);

  const staging = projectIdArg ? null : tryResolveLatestDaSilvaStagingProject(school.id);
  const useStaging = Boolean(projectIdArg || staging);

  console.log(`=== Da Silva learner gender repair (${apply ? "APPLY" : "dry-run"}) ===`);
  console.log(`School: ${school.name} (${school.id})`);

  const report = useStaging
    ? await repairDaSilvaLearnerGender({
        schoolId: school.id,
        projectId: projectIdArg || staging!.projectId,
        apply,
      })
    : await repairDaSilvaLearnerGenderFromLiveDb({
        schoolId: school.id,
        apply,
      });

  console.log(
    `Mode: ${report.mode === "staging" ? "staging manifest" : "live-database fallback (no staging manifest)"}`
  );
  if (report.mode === "staging") {
    console.log(`Project: ${projectIdArg || staging!.projectId}`);
  }

  if (!apply && report.previewUpdates.length) {
    console.log(`\nPreview updates (${report.previewUpdates.length}):`);
    for (const update of report.previewUpdates) {
      console.log(
        `  - ${update.fullName} -> ${update.gender} (SA ID: ${maskSaId(update.idNumber)})`
      );
    }
  }

  const outPath = path.join(process.cwd(), "repair-da-silva-learner-gender.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`\nSource rows: ${report.sourceRows}`);
  console.log(`Matched learners: ${report.matched}`);
  console.log(`Gender backfilled: ${report.genderBackfilled}`);
  console.log(`Skipped (existing gender): ${report.skippedExistingGender}`);
  console.log(`Skipped (no source gender): ${report.skippedNoSourceGender}`);
  console.log(`Unmatched: ${report.unmatched.length}`);
  console.log(
    `\nActive learners: ${report.audit.totalActive} | boys: ${report.audit.boys} | girls: ${report.audit.girls} | missing gender: ${report.audit.missingGender}`
  );
  console.log(
    `Boys + girls: ${report.audit.boys + report.audit.girls} (expected 396 when complete)`
  );
  console.log(`Updated count: ${report.genderBackfilled}`);
  console.log(`\nReport: ${outPath}`);

  if (!apply) {
    console.log("\nDry run only — re-run with --apply to persist.");
  }
}

main()
  .catch((e) => {
    if (e instanceof Error) {
      console.error(e.message);
      if (e.stack) console.error(e.stack);
    } else {
      console.error(e);
    }
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
