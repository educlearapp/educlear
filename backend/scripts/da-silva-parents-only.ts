/**
 * Da Silva migration — phase 3: SA-SAMS parents + parent-learner links.
 *
 * Usage:
 *   npx ts-node scripts/da-silva-parents-only.ts [desktopRoot] [projectId]
 *
 * Requires phases 1–2. Does NOT import Kid-e-Sys billing or family accounts (phase 4).
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

import { prisma } from "../src/prisma";
import {
  commitDaSilvaParentsOnly,
} from "../src/services/daSilvaMigration/daSilvaMigrationService";
import { DA_SILVA_FINAL_IMPORT_EXPECTED } from "../src/services/daSilvaMigration/daSilvaFinalImportGate";
import { resolveDaSilvaSasamsPaths } from "../src/services/daSilvaMigration/daSilvaMigrationStrategy";
import { readSchoolBillingPlans } from "../src/utils/learnerBillingPlanStore";
import { readSchoolLedger } from "../src/utils/billingLedgerStore";

const desktopRoot = process.argv[2] || path.join(process.env.HOME || "", "Desktop");
const projectIdArg = process.argv[3] || "";
const sasamsPaths = resolveDaSilvaSasamsPaths(desktopRoot);
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
  if (!manifests.length) throw new Error("No manifest — run phase 1 first.");
  return manifests[0].file.replace(/^dasilva-/, "").replace(/\.manifest\.json$/, "");
}

async function main(): Promise<void> {
  if (!fs.existsSync(sasamsPaths.parentRegister)) {
    console.error(`SA-SAMS parent register not found: ${sasamsPaths.parentRegister}`);
    process.exit(1);
  }

  const schoolId = await resolveSchoolId();
  const projectId = await resolveProjectId(schoolId);

  console.log("=== Da Silva migration — SA-SAMS parents (phase 3) ===");
  console.log(`Parent register: ${sasamsPaths.parentRegister}`);

  const result = await commitDaSilvaParentsOnly({
    schoolId,
    projectId,
    paths: {
      parentRegister: sasamsPaths.parentRegister,
      parentLearnerLinks: sasamsPaths.parentRegister.replace(
        /parent_register\.xls$/i,
        "parent_learner_links.xls"
      ),
    },
  });

  console.log(`Parents: ${result.imported.parents}, links: ${result.imported.links}`);
  console.log(`Unmatched parents (staging): ${result.stagingValidation.unmatchedParents}`);
  console.log(`Family accounts (must be 0): ${result.imported.familyAccounts}`);

  const ledger = readSchoolLedger(schoolId).length;
  const plans = Object.keys(readSchoolBillingPlans(schoolId)).length;
  if (ledger > 0 || plans > 0) {
    throw new Error("Phase 3 violation: billing data must not exist yet");
  }

  if (!result.success) process.exit(1);
  console.log("\nSTOPPED after parents — ready for phase 4 (billing match).");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
