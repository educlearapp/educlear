/**
 * Repair Da Silva learner ↔ family account ↔ ledger links without re-importing.
 *
 * Usage:
 *   npx tsc && node dist/scripts/repair-da-silva-migration-links.js           # dry-run
 *   npx tsc && node dist/scripts/repair-da-silva-migration-links.js --apply
 *   node dist/scripts/repair-da-silva-migration-links.js [schoolId] [--apply]
 */
import "dotenv/config";

import fs from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";

import {
  DA_SILVA_OWNER_EMAIL,
  DA_SILVA_SCHOOL_NAME,
  getDaSilvaResolvedSchoolId,
  setDaSilvaResolvedSchoolId,
} from "../src/services/activateDaSilvaSubscription";
import { loadDaSilvaStaging } from "../src/services/daSilvaMigration/daSilvaMigrationService";
import {
  findLatestDaSilvaStagingBundle,
  relinkDaSilvaLearnerBillingFromBundle,
  relinkSchoolLearnersToFamilyAccountsByDb,
} from "../src/services/daSilvaMigration/relinkDaSilvaLearnerBilling";
import { readSchoolLedger } from "../src/utils/billingLedgerStore";
import { getDaSilvaLearnerSchemaCaps } from "./lib/daSilvaSchemaSafe";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const schoolIdArg = process.argv.slice(2).find((a) => a !== "--apply");

async function resolveSchoolId(): Promise<{ id: string; name: string }> {
  const hint = String(schoolIdArg || getDaSilvaResolvedSchoolId() || "").trim();
  const school =
    (hint
      ? await prisma.school.findUnique({ where: { id: hint }, select: { id: true, name: true } })
      : null) ||
    (await prisma.school.findFirst({
      where: { email: DA_SILVA_OWNER_EMAIL },
      select: { id: true, name: true },
    })) ||
    (await prisma.school.findFirst({
      where: { name: DA_SILVA_SCHOOL_NAME },
      select: { id: true, name: true },
    }));
  if (!school) throw new Error("Da Silva Academy school not found");
  setDaSilvaResolvedSchoolId(school.id);
  return school;
}

async function snapshotCounts(schoolId: string) {
  const [learnersWithFamilyAccountId, learnersWithAdmissionNo, ledgerMissingLearnerId] =
    await Promise.all([
      prisma.learner.count({ where: { schoolId, familyAccountId: { not: null } } }),
      prisma.learner.count({ where: { schoolId, admissionNo: { not: null } } }),
      Promise.resolve(
        readSchoolLedger(schoolId).filter((e) => !String(e.learnerId || "").trim()).length
      ),
    ]);
  return { learnersWithFamilyAccountId, learnersWithAdmissionNo, ledgerMissingLearnerId };
}

async function main(): Promise<void> {
  const school = await resolveSchoolId();
  const schoolId = school.id;
  const schemaCaps = await getDaSilvaLearnerSchemaCaps(prisma);
  const before = await snapshotCounts(schoolId);

  const latest = findLatestDaSilvaStagingBundle(schoolId);
  const projectId = latest?.projectId || "";
  const bundle = latest?.bundle || loadDaSilvaStaging(schoolId, projectId);

  const plan: Record<string, unknown> = {
    mode: apply ? "apply" : "dry-run",
    schoolId,
    schoolName: school.name,
    schemaNotes: schemaCaps.notes,
    omitEnrollmentStatus: !schemaCaps.enrollmentStatus,
    stagingProjectId: projectId || null,
    hasStagingBundle: Boolean(bundle),
    before,
    actions: [] as string[],
  };

  if (!schemaCaps.enrollmentStatus) {
    plan.actions.push(
      "Learner.enrollmentStatus not available in schema — display status defaults to Enrolled; writes skipped"
    );
  }

  if (!apply) {
    plan.actions.push(
      bundle
        ? "Would relink learners from latest Kid-e-Sys staging bundle"
        : "Would relink learners using database name/admission matching (no staging bundle)"
    );
    plan.actions.push("Would backfill ledger learnerId from accountToLearnerId map");
    const afterEstimate = { ...before };
    if (bundle) {
      afterEstimate.learnersWithFamilyAccountId = bundle.learners.filter((r) =>
        String(r.accountNo || "").trim()
      ).length;
    }
    plan.afterEstimate = afterEstimate;
  } else if (bundle) {
    const matchKeyToLearnerId = new Map<string, string>();
    const accountToLearnerId = new Map<string, string>();
    const manifest = {
      projectId: bundle.projectId,
      schoolId: bundle.schoolId,
      importedAt: new Date().toISOString(),
      learnerIds: [],
      parentIds: [],
      linkIds: [],
      classroomIds: [],
      employeeIds: [],
      ledgerEntryIds: [],
      matchKeyToLearnerId: {} as Record<string, string>,
      accountToLearnerId: {} as Record<string, string>,
    };
    const result = await relinkDaSilvaLearnerBillingFromBundle({
      schoolId,
      bundle,
      manifest,
      matchKeyToLearnerId,
      accountToLearnerId,
      omitEnrollmentStatus: !schemaCaps.enrollmentStatus,
    });
    plan.bundleRelink = result;
  } else {
    plan.dbRelink = await relinkSchoolLearnersToFamilyAccountsByDb(schoolId);
  }

  const after = apply ? await snapshotCounts(schoolId) : before;
  plan.after = after;

  const jsonPath = path.join(process.cwd(), "repair-da-silva-migration-links.json");
  fs.writeFileSync(jsonPath, JSON.stringify(plan, null, 2));

  console.log(JSON.stringify(plan, null, 2));
  console.log(`\nWrote ${jsonPath}`);
  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to persist repairs.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
