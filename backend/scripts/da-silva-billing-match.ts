/**
 * Da Silva migration — phase 4: match Kid-e-Sys billing accounts to SA-SAMS learners.
 *
 * Usage:
 *   npx ts-node scripts/da-silva-billing-match.ts [desktopRoot] [projectId]
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

import { prisma } from "../src/prisma";
import {
  commitDaSilvaBillingMatchOnly,
  DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT,
} from "../src/services/daSilvaMigration/daSilvaMigrationService";
import { DA_SILVA_FINAL_IMPORT_EXPECTED } from "../src/services/daSilvaMigration/daSilvaFinalImportGate";
import {
  resolveDaSilvaKideesysBillingPaths,
  resolveDaSilvaSasamsPaths,
} from "../src/services/daSilvaMigration/daSilvaMigrationStrategy";

const desktopRoot = process.argv[2] || path.join(process.env.HOME || "", "Desktop");
const projectIdArg = process.argv[3] || "";
const SCHOOL_NAME = DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName;

async function resolveSchoolId(): Promise<string> {
  const existing = await prisma.school.findFirst({
    where: { name: SCHOOL_NAME },
    select: { id: true },
  });
  if (!existing) throw new Error(`School not found: ${SCHOOL_NAME}`);
  return existing.id;
}

async function resolveProjectId(schoolId: string): Promise<string> {
  if (projectIdArg) return projectIdArg;
  const stagingRoot = path.join(process.cwd(), "uploads", "migration-staging", schoolId);
  const manifests = fs
    .readdirSync(stagingRoot)
    .filter((f) => f.endsWith(".manifest.json"))
    .map((f) => ({ file: f, mtime: fs.statSync(path.join(stagingRoot, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!manifests.length) throw new Error("No manifest — run phases 1–3 first.");
  return manifests[0].file.replace(/^dasilva-/, "").replace(/\.manifest\.json$/, "");
}

async function main(): Promise<void> {
  const sasams = resolveDaSilvaSasamsPaths(desktopRoot);
  const kideesys = resolveDaSilvaKideesysBillingPaths(desktopRoot);
  const schoolId = await resolveSchoolId();
  const projectId = await resolveProjectId(schoolId);

  console.log("=== Da Silva migration — billing match (phase 4) ===");
  console.log(`SA-SAMS class lists: ${sasams.classListDir}`);
  console.log(`Kid-e-Sys age analysis: ${kideesys.ageAnalysis}`);

  const result = await commitDaSilvaBillingMatchOnly({
    schoolId,
    projectId,
    paths: {
      classListDir: sasams.classListDir,
      ageAnalysis: kideesys.ageAnalysis,
    },
  });

  console.log(`Matched ${result.matched}/${result.totalAccounts} billing accounts`);
  console.log(`Expected ≈ ${DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT} family accounts after apply`);
  console.log(`Audit: ${result.auditPath}`);

  if (!result.success) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
