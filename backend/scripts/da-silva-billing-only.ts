/**
 * Da Silva migration — phase 5: Kid-e-Sys billing plans + opening balances only.
 *
 * Usage:
 *   npx ts-node scripts/da-silva-billing-only.ts [desktopRoot] [projectId]
 *
 * Requires phases 1–4 (SA-SAMS base + billing account match).
 * Imports from Kid-e-Sys:
 *   - 03_billing_plan_summary_by_child (billing plans + fee structures)
 *   - 02_account_list_age_analysis (opening balances)
 *
 * Does NOT import transactions, payments, invoices, employees, or bank data.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

import { prisma } from "../src/prisma";
import {
  commitDaSilvaBillingOnly,
  DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT,
  validateDaSilvaBillingInDatabase,
  validateDaSilvaBillingStaging,
} from "../src/services/daSilvaMigration/daSilvaMigrationService";
import {
  DA_SILVA_FINAL_IMPORT_EXPECTED,
  DA_SILVA_OPENING_BALANCE_EXCLUDED_ACCOUNTS,
} from "../src/services/daSilvaMigration/daSilvaFinalImportGate";
import {
  resolveDaSilvaKideesysBillingPaths,
  resolveDaSilvaSasamsPaths,
} from "../src/services/daSilvaMigration/daSilvaMigrationStrategy";
import { readSchoolBillingPlans } from "../src/utils/learnerBillingPlanStore";
import { readSchoolLedger } from "../src/utils/billingLedgerStore";

const desktopRoot = process.argv[2] || path.join(process.env.HOME || "", "Desktop");
const projectIdArg = process.argv[3] || "";
const SCHOOL_NAME = DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName;
const sasamsPaths = resolveDaSilvaSasamsPaths(desktopRoot);
const kideesysPaths = resolveDaSilvaKideesysBillingPaths(desktopRoot);

const paths = {
  classListDir: sasamsPaths.classListDir,
  billingPlan: kideesysPaths.billingPlan,
  ageAnalysis: kideesysPaths.ageAnalysis,
};

function printStagingValidation(
  label: string,
  v: ReturnType<typeof validateDaSilvaBillingStaging>
): void {
  console.log(`\n=== ${label} ===`);
  console.log(`Status: ${v.passed ? "PASS" : "FAIL"}`);
  console.log(
    `Billing accounts (age analysis): ${v.actualBillingAccounts} (expected ≈ ${v.expectedBillingAccounts})`
  );
  console.log(`Learners with billing plan: ${v.learnersWithBillingPlan}`);
  console.log(`Unique fee descriptions: ${v.uniqueFeeDescriptions}`);
  console.log(`Kid-e-Sys age analysis total outstanding: R${v.ageAnalysisTotalOutstanding.toFixed(2)}`);
  if (v.errors.length) {
    console.log("Errors:");
    for (const err of v.errors) console.log(`  - ${err}`);
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
  for (const [label, filePath] of Object.entries({
    classListDir: paths.classListDir,
    billingPlan: paths.billingPlan,
    ageAnalysis: paths.ageAnalysis,
  })) {
    if (!fs.existsSync(filePath)) {
      console.error(`Missing ${label}: ${filePath}`);
      process.exit(1);
    }
  }

  const schoolId = await resolveSchoolId();
  const projectId = await resolveProjectId(schoolId);

  console.log("=== Da Silva migration — billing + opening balances only (phase 4) ===");
  console.log(`School: ${SCHOOL_NAME} (${schoolId})`);
  console.log(`Project: ${projectId}`);
  console.log(`Kid-e-Sys root: ${desktopRoot}`);
  console.log(`Expected billing accounts: ${DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT}`);

  const preLedger = readSchoolLedger(schoolId);
  const preBillingPlans = Object.keys(readSchoolBillingPlans(schoolId)).length;
  const preFees = await prisma.feeStructure.count({ where: { schoolId } });
  const preEmployees = await prisma.employee.count({ where: { schoolId } });
  const preFamilyAccounts = await prisma.familyAccount.count({ where: { schoolId } });

  console.log("\nDatabase before import:");
  console.log(`  Family accounts: ${preFamilyAccounts}`);
  console.log(`  Billing plans (learners): ${preBillingPlans} (must be 0 before first run)`);
  console.log(`  Fee structures: ${preFees} (must be 0 before first run)`);
  console.log(`  Ledger entries: ${preLedger.length} (must be 0 — no transaction history)`);
  console.log(`  Employees: ${preEmployees} (must stay 0)`);

  const preStaging = validateDaSilvaBillingStaging(paths);
  printStagingValidation("Pre-import Kid-e-Sys validation", preStaging);
  if (!preStaging.passed) {
    process.exit(1);
  }

  let result: Awaited<ReturnType<typeof commitDaSilvaBillingOnly>> | null = null;
  try {
    result = await commitDaSilvaBillingOnly({ schoolId, projectId, paths });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      !message.includes('phase "billing_accounts" already completed') &&
      !message.includes('phase "opening_balances" already completed')
    ) {
      throw err;
    }
    console.log("\nBilling phase already completed — running validation only.");
  }

  const manifestPath = `uploads/migration-staging/${schoolId}/dasilva-${projectId}.manifest.json`;
  const manifestRaw = JSON.parse(fs.readFileSync(path.join(process.cwd(), manifestPath), "utf8"));
  const postImportValidation = await validateDaSilvaBillingInDatabase(
    schoolId,
    paths,
    manifestRaw.accountToLearnerId || {}
  );

  const postLedger = readSchoolLedger(schoolId);
  const postTransactionLike = postLedger.filter(
    (e) => e.source !== "kidesys_migration_opening_balance"
  );
  const postEmployees = await prisma.employee.count({ where: { schoolId } });

  console.log("\n=== Import result ===");
  if (result) {
    console.log(`Billing plans imported (learners): ${result.imported.billingPlans}`);
    console.log(
      `Fee structures: ${result.imported.feeStructuresCreated} created, ${result.imported.feeStructuresExisting} already existed`
    );
    console.log(`Learner fee totals updated: ${result.imported.learnersFeeUpdated}`);
    console.log(`Opening balances imported: ${result.imported.openingBalances}`);
    console.log(`Parent outstanding amounts updated: ${result.imported.parentsOutstandingUpdated}`);
  }
  console.log(`Manifest: ${manifestPath}`);

  console.log("\n=== Phase 4 report ===");
  console.log(`Billing plans imported: ${postImportValidation.billingPlansImported}`);
  console.log(`Fee structures in database: ${postImportValidation.feeStructuresImported}`);
  console.log(`Family billing accounts: ${postImportValidation.familyAccounts}`);
  console.log(`Opening balances imported: ${postImportValidation.openingBalancesImported}`);
  console.log(`Total outstanding imported: R${postImportValidation.totalOutstandingImported.toFixed(2)}`);
  console.log(
    `Kid-e-Sys age analysis total: R${postImportValidation.kidesysAgeAnalysisTotal.toFixed(2)}`
  );
  console.log(
    `Zero-balance accounts (Kid-e-Sys has debt): ${postImportValidation.zeroBalanceAccountsWithKidesysDebt.length}`
  );
  console.log(`Orphan billing refs: ${postImportValidation.orphanBillingAccountRefs.length}`);
  console.log(
    `Duplicate opening balance refs: ${postImportValidation.duplicateOpeningBalanceRefs.length}`
  );
  console.log(
    `Age analysis validation — per-account variance sum: R${postImportValidation.ageAnalysisVarianceTotal.toFixed(2)}`
  );
  console.log(
    `Manual opening exclusions: ${DA_SILVA_OPENING_BALANCE_EXCLUDED_ACCOUNTS.join(", ")}`
  );

  console.log("\n=== Post-import validation ===");
  console.log(`Status: ${postImportValidation.passed ? "PASS" : "FAIL"}`);
  if (postImportValidation.orphanBillingAccountRefs.length) {
    console.log(
      "Orphan refs:",
      postImportValidation.orphanBillingAccountRefs.slice(0, 20).join(", ")
    );
  }
  if (postImportValidation.zeroBalanceAccountsWithKidesysDebt.length) {
    console.log(
      "Zero ledger but Kid-e-Sys balance:",
      postImportValidation.zeroBalanceAccountsWithKidesysDebt.slice(0, 20).join(", ")
    );
  }
  if (postImportValidation.errors.length) {
    console.log("Errors:");
    for (const err of postImportValidation.errors) console.log(`  - ${err}`);
  }

  console.log("\n=== Transaction guard (must not change) ===");
  console.log(`Non-opening ledger rows: ${postTransactionLike.length}`);
  console.log(`Employees: ${postEmployees}`);

  if (!postImportValidation.passed || postTransactionLike.length > 0 || postEmployees > 0) {
    console.error("\nSTOPPED: post-import validation failed or forbidden data was imported.");
    process.exit(1);
  }

  console.log("\nSTOPPED after billing setup + opening balances only — no invoices or payments imported.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
