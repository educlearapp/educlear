/**
 * One-time production-safe Da Silva registration/profile/parent/billing-plan heal.
 *
 * Does NOT touch FamilyAccount, accountRef, billing ledger, Kid-e-Sys history, or Age Analysis JSON.
 *
 * Usage:
 *   npx tsx scripts/da-silva-production-registration-heal.ts
 *   CONFIRM_DA_SILVA_PRODUCTION_HEAL=true PRODUCTION_DATABASE_URL="postgresql://..." \
 *     SOURCE_DATABASE_URL="postgresql://localhost..." \
 *     npx tsx scripts/da-silva-production-registration-heal.ts --apply
 *
 * Env (--apply on production target):
 *   CONFIRM_DA_SILVA_PRODUCTION_HEAL=true
 *   PRODUCTION_DATABASE_URL — target (live) PostgreSQL (required for --apply)
 *   SOURCE_DATABASE_URL — correct localhost DB (defaults to DATABASE_URL from .env)
 *   EDUCLEAR_DATA_ROOT — backend root containing data/ (default: cwd)
 */
import "dotenv/config";

import fs from "fs";
import path from "path";

const APPLY = process.argv.includes("--apply");
const args = process.argv.slice(2).filter((a) => a !== "--apply");
const sourceDirArg = args.find((_, i) => args[i - 1] === "--source-dir") || "";
const sourceDbArg = args.find((_, i) => args[i - 1] === "--source-database-url") || "";
const dataRootArg = args.find((_, i) => args[i - 1] === "--data-root") || "";
const allowLocalTarget = process.argv.includes("--allow-local-target");

const CONFIRM_ENV = "CONFIRM_DA_SILVA_PRODUCTION_HEAL";

function resolveDbHost(url: string): string {
  const m = String(url || "").match(/@([^/?]+)/);
  return m ? m[1] : "unknown";
}

function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  return h.includes("localhost") || h.includes("127.0.0.1");
}

async function main(): Promise<void> {
  const {
    DA_SILVA_ACADEMY_SCHOOL_ID,
    getDaSilvaResolvedSchoolId,
    setDaSilvaResolvedSchoolId,
  } = await import("../src/services/activateDaSilvaSubscription");

  const sourceDir = path.resolve(sourceDirArg || process.cwd());
  const dataRoot = path.resolve(dataRootArg || sourceDir);

  const localUrl = String(process.env.DATABASE_URL || "").trim();
  const targetUrl = String(
    process.env.PRODUCTION_DATABASE_URL || process.env.TARGET_DATABASE_URL || ""
  ).trim();
  const sourceUrl = String(sourceDbArg || process.env.SOURCE_DATABASE_URL || localUrl).trim();

  if (!targetUrl && APPLY && !allowLocalTarget) {
    throw new Error(
      "PRODUCTION_DATABASE_URL (or TARGET_DATABASE_URL) is required for --apply against live DB"
    );
  }

  const activeUrl = APPLY ? targetUrl || (allowLocalTarget ? localUrl : "") : targetUrl || localUrl;
  if (APPLY && !activeUrl) {
    throw new Error("No target database URL configured for --apply");
  }
  if (!activeUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const targetHost = resolveDbHost(activeUrl);
  if (APPLY && isLocalHost(targetHost) && !allowLocalTarget) {
    throw new Error(
      `Refusing --apply against local target (${targetHost}). Set PRODUCTION_DATABASE_URL or pass --allow-local-target.`
    );
  }

  if (APPLY && String(process.env[CONFIRM_ENV] || "").trim().toLowerCase() !== "true") {
    throw new Error(`Set ${CONFIRM_ENV}=true to apply`);
  }

  process.env.DATABASE_URL = activeUrl;
  if (dataRoot !== process.cwd()) {
    process.chdir(dataRoot);
  }

  setDaSilvaResolvedSchoolId(DA_SILVA_ACADEMY_SCHOOL_ID);
  let schoolId = DA_SILVA_ACADEMY_SCHOOL_ID;
  try {
    schoolId = await getDaSilvaResolvedSchoolId();
  } catch {
    /* use canonical id */
  }

  const { runDaSilvaProductionRegistrationHeal } = await import(
    "../src/services/daSilvaMigration/daSilvaProductionRegistrationHeal"
  );
  const { prisma } = await import("../src/prisma");

  console.log(`Mode: ${APPLY ? "APPLY" : "dry-run"}`);
  console.log(`School: ${schoolId}`);
  console.log(`Target DB: ${targetHost}`);
  console.log(`Source dir: ${sourceDir}`);
  if (sourceUrl && sourceUrl !== activeUrl) {
    console.log(`Source DB: ${resolveDbHost(sourceUrl)}`);
  }
  console.log("");

  const useSourceDb = Boolean(sourceUrl && sourceUrl !== activeUrl);

  const report = await runDaSilvaProductionRegistrationHeal({
    schoolId,
    sourceDir,
    dataRoot,
    apply: APPLY,
    sourceDatabaseUrl: useSourceDb ? sourceUrl : undefined,
    sourceSchoolId: schoolId,
  });

  const jsonPath = path.join(process.cwd(), "da-silva-production-registration-heal.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  printReport(report);
  console.log("");
  console.log(`Wrote ${jsonPath}`);

  await prisma.$disconnect();

  if (!report.auditPass) {
    process.exit(1);
  }
}

function printReport(r: import("../src/services/daSilvaMigration/daSilvaProductionRegistrationHeal").ProductionRegistrationHealResult): void {
  const b = r.dryRunBefore;
  console.log("Dry-run before:");
  console.log(`learners missing gender: ${b.learnersMissingGender}`);
  console.log(`learners missing idNumber: ${b.learnersMissingIdNumber}`);
  console.log(`parents missing idNumber: ${b.parentsMissingIdNumber}`);
  console.log(`learners Pre-School Creche: ${b.preSchoolCreche}`);
  console.log(`billing plans count: ${b.billingPlansCount}`);
  console.log(`statements accounts: ${b.statementAccounts}`);
  console.log("");
  console.log("Applied:");
  console.log(r.applied.join("\n") || "(none)");
  console.log("");
  console.log(`Children: ${r.after.children}`);
  console.log(`Boys: ${r.after.boys}`);
  console.log(`Girls: ${r.after.girls}`);
  console.log(`Parents: ${r.after.parents}`);
  console.log(`Parents with IDs: ${r.after.parentsWithId}`);
  console.log(`Billing plans: ${r.after.learnersWithBillingPlans}`);
  console.log(`Statements accounts: ${r.after.statementAccounts}`);
  console.log(`Billing untouched: ${r.billingUntouched ? "yes" : "no"}`);
  console.log(`Audit PASS/FAIL: ${r.auditPass ? "PASS" : "FAIL"}`);
  if (!r.auditPass && r.auditNotes.length) {
    console.log(`Audit notes: ${r.auditNotes.join("; ")}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
