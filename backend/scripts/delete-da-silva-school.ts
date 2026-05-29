/**
 * HARD DELETE — removes Da Silva Academy school row and ALL related data.
 *
 * Does NOT touch other schools or global EduClear platform records (packages, permissions catalog, etc.).
 *
 * Resolves target by exact name "Da Silva Academy" and/or --schoolId (required when multiple matches).
 *
 * Usage:
 *   npx tsx scripts/delete-da-silva-school.ts
 *   npx tsx scripts/delete-da-silva-school.ts --schoolId <id>
 *   npx tsx scripts/delete-da-silva-school.ts --apply
 *   npx tsx scripts/delete-da-silva-school.ts --apply --schoolId <id>
 *   npx tsx scripts/delete-da-silva-school.ts --apply --purge-ledger
 *
 * After apply, runs empty-state assertions (DB + canonical JSON billing bucket).
 * Before Phase 1, run: npx tsx scripts/audit-da-silva-empty-state.ts
 */
import "dotenv/config";

import fs from "fs";
import path from "path";
import readline from "readline";

import { PrismaClient } from "@prisma/client";

import { listImportBatches } from "../src/services/migration/core/migrationImportBatchStore";
import { listPilots } from "../src/services/migration/core/migrationPilotStore";
import { listRunbooks } from "../src/services/migration/core/migrationRunbookStore";
import { listSignoffs } from "../src/services/migration/core/migrationSignoffStore";
import { deleteStage, listStages } from "../src/services/migration/staging/migrationStageStore";
import {
  DA_SILVA_ACADEMY_SCHOOL_ID,
} from "../src/services/activateDaSilvaSubscription";
import {
  assertDaSilvaEmptyState,
  auditDaSilvaEmptyState,
  buildDaSilvaPurgeScope,
  collectDaSilvaSchoolIds,
  purgeDaSilvaJsonStores,
} from "./lib/daSilvaEmptyState";
import {
  clearStagingForSchools,
  deleteSchoolRoles,
  deleteSchoolUsers,
  purgeImportedSchoolData,
} from "./school-data-cleanup";

const prisma = new PrismaClient();

const EXACT_SCHOOL_NAME = "Da Silva Academy";
const CONFIRMATION_PHRASE = "DELETE DA SILVA ACADEMY";
const PLATFORM_SCHOOL_NAME = "EduClear Platform";

function parseCli(): { apply: boolean; schoolId?: string; purgeLedger: boolean } {
  const argv = process.argv.slice(2);
  let schoolId: string | undefined;
  const purgeLedger = argv.includes("--purge-ledger");
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--schoolId") {
      schoolId = String(argv[i + 1] || "").trim() || undefined;
      if (!schoolId) {
        throw new Error("--schoolId requires a value");
      }
      i += 1;
      continue;
    }
    if (arg.startsWith("--schoolId=")) {
      schoolId = arg.slice("--schoolId=".length).trim() || undefined;
      if (!schoolId) {
        throw new Error("--schoolId requires a value");
      }
    }
  }
  return { apply: argv.includes("--apply"), schoolId, purgeLedger };
}

const { apply: APPLY, schoolId: CLI_SCHOOL_ID, purgeLedger: PURGE_LEDGER } = parseCli();

const TX_OPTIONS = { maxWait: 60_000, timeout: 300_000 };

const DATA_DIR = path.join(process.cwd(), "data");
const STAGING_UPLOAD_ROOT = path.join(process.cwd(), "uploads", "migration-staging");
const BATCHES_DIR = path.join(process.cwd(), "storage", "migration-import-batches");
const MIGRATION_STAGING_ROOT = path.join(process.cwd(), "storage", "migration-staging");

type CountMap = Record<string, number>;

type ScopeCounts = {
  targetSchool: { id: string; name: string };
  prisma: CountMap;
  json: CountMap;
  files: CountMap;
  otherSchools: CountMap;
};

type DatabaseConnectionInfo = {
  host: string;
  database: string;
  maskedUrl: string;
};

function maskDatabaseUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return "(not set)";
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "****";
    if (parsed.username) {
      parsed.username =
        parsed.username.length > 2 ? `${parsed.username.slice(0, 2)}***` : "***";
    }
    return parsed.toString();
  } catch {
    return url.replace(/:([^:@/]+)@/, ":****@");
  }
}

function getDatabaseConnectionInfo(): DatabaseConnectionInfo {
  const raw = String(process.env.DATABASE_URL || "").trim();
  if (!raw) {
    return { host: "(not set)", database: "(not set)", maskedUrl: "(not set)" };
  }
  try {
    const parsed = new URL(raw);
    return {
      host: parsed.hostname || "(unknown)",
      database: parsed.pathname.replace(/^\//, "") || "(unknown)",
      maskedUrl: maskDatabaseUrl(raw),
    };
  } catch {
    return {
      host: "(unparseable)",
      database: "(unparseable)",
      maskedUrl: maskDatabaseUrl(raw),
    };
  }
}

function isPlatformSchoolName(name: string): boolean {
  return name.trim().toLowerCase() === PLATFORM_SCHOOL_NAME.toLowerCase();
}

async function resolveTargetSchool(suppliedSchoolId?: string): Promise<{ id: string; name: string }> {
  const platform = await prisma.school.findFirst({
    where: { name: { equals: PLATFORM_SCHOOL_NAME, mode: "insensitive" } },
    select: { id: true, name: true },
  });

  const refusePlatform = (school: { id: string; name: string }): void => {
    if (platform?.id === school.id) {
      throw new Error(`Refusing: target is the ${PLATFORM_SCHOOL_NAME} school (${school.id})`);
    }
    if (isPlatformSchoolName(school.name)) {
      throw new Error(`Refusing: school name is ${PLATFORM_SCHOOL_NAME}`);
    }
  };

  if (suppliedSchoolId) {
    const school = await prisma.school.findUnique({
      where: { id: suppliedSchoolId },
      select: { id: true, name: true },
    });
    if (!school) {
      throw new Error(`School not found for --schoolId ${suppliedSchoolId}. Refusing — no global deletes.`);
    }
    if (school.name.trim() !== EXACT_SCHOOL_NAME) {
      throw new Error(
        `School name must be exactly "${EXACT_SCHOOL_NAME}", got "${school.name}". Refusing.`
      );
    }
    refusePlatform(school);
    return school;
  }

  const matches = await prisma.school.findMany({
    where: { name: EXACT_SCHOOL_NAME },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  if (!matches.length) {
    throw new Error(
      `No school found with exact name "${EXACT_SCHOOL_NAME}". Supply --schoolId if the row exists under another name.`
    );
  }

  if (matches.length > 1) {
    const ids = matches.map((m) => `  - ${m.id}`).join("\n");
    throw new Error(
      `Multiple schools named "${EXACT_SCHOOL_NAME}" (${matches.length}). Refusing without --schoolId.\n${ids}`
    );
  }

  const school = matches[0];
  refusePlatform(school);
  return school;
}

function bump(map: CountMap, key: string, n: number): void {
  if (n > 0) map[key] = (map[key] || 0) + n;
}

function countStagingFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    n += entry.isDirectory() ? countStagingFiles(full) : 1;
  }
  return n;
}

function removeStagingDir(dir: string): number {
  const files = countStagingFiles(dir);
  if (files && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return files;
}

function stageBelongsToSchool(stageId: string, schoolId: string): boolean {
  const stage = listStages().find((s) => s.stageId === stageId);
  if (!stage) return false;
  return stage.files.some((f) => String(f.path || "").includes(schoolId));
}

async function countJsonSchoolData(schoolIds: string[]): Promise<CountMap> {
  const counts: CountMap = {};
  const idSet = new Set(schoolIds);

  const ledgerPath = path.join(DATA_DIR, "billing-ledger.json");
  if (fs.existsSync(ledgerPath)) {
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as Record<string, unknown[]>;
    let n = 0;
    for (const key of Object.keys(ledger)) {
      if (!idSet.has(key)) continue;
      const rows = ledger[key];
      if (Array.isArray(rows)) n += rows.length;
    }
    if (n) counts.billingLedgerEntries = n;
  }

  const plansPath = path.join(DATA_DIR, "learner-billing-plans.json");
  if (fs.existsSync(plansPath)) {
    const plans = JSON.parse(fs.readFileSync(plansPath, "utf8")) as Record<
      string,
      Record<string, unknown>
    >;
    let n = 0;
    for (const key of Object.keys(plans)) {
      if (!idSet.has(key)) continue;
      n += Object.keys(plans[key] || {}).length;
    }
    if (n) counts.learnerBillingPlanLearners = n;
  }

  const historyPath = path.join(DATA_DIR, "kidesys-transaction-history.json");
  if (fs.existsSync(historyPath)) {
    const history = JSON.parse(fs.readFileSync(historyPath, "utf8")) as Record<string, unknown[]>;
    let n = 0;
    for (const key of Object.keys(history)) {
      if (!idSet.has(key)) continue;
      const rows = history[key];
      if (Array.isArray(rows)) n += rows.length;
    }
    if (n) counts.kidesysHistoryRows = n;
  }

  for (const schoolId of schoolIds) {
    const stagingDir = path.join(STAGING_UPLOAD_ROOT, schoolId);
    bump(counts, "migrationStagingUploadFiles", countStagingFiles(stagingDir));

    const batches = listImportBatches().filter((b) => b.targetSchoolId === schoolId);
    bump(counts, "migrationImportBatches", batches.length);

    const stageIds = new Set(batches.map((b) => String(b.stageId || "").trim()).filter(Boolean));
    for (const item of listStages()) {
      if (stageIds.has(item.stageId) || stageBelongsToSchool(item.stageId, schoolId)) {
        bump(counts, "migrationStages", 1);
      }
    }

    bump(counts, "migrationPilots", listPilots().filter((p) => p.schoolId === schoolId).length);
    bump(counts, "migrationRunbooks", listRunbooks().filter((r) => r.schoolId === schoolId).length);
    bump(counts, "migrationSignoffs", listSignoffs().filter((s) => s.schoolId === schoolId).length);
  }

  if (fs.existsSync(MIGRATION_STAGING_ROOT)) {
    let storageFiles = 0;
    for (const entry of fs.readdirSync(MIGRATION_STAGING_ROOT, { withFileTypes: true })) {
      const full = path.join(MIGRATION_STAGING_ROOT, entry.name);
      if (entry.isFile() && schoolIds.some((sid) => entry.name.includes(sid))) storageFiles += 1;
      if (entry.isDirectory()) storageFiles += countStagingFiles(full);
    }
    if (storageFiles) counts.migrationStorageStagingFiles = storageFiles;
  }

  if (schoolIds.includes(DA_SILVA_ACADEMY_SCHOOL_ID)) {
    counts.canonicalBillingSchoolId = 1;
  }

  return counts;
}

async function countTargetPrismaRows(schoolId: string): Promise<CountMap> {
  const counts: CountMap = {};
  const add = async (key: string, fn: () => Promise<number>) => {
    counts[key] = await fn();
  };

  await add("school", () => prisma.school.count({ where: { id: schoolId } }));
  await add("user", () => prisma.user.count({ where: { schoolId } }));
  await add("userPermissionOverride", () =>
    prisma.userPermissionOverride.count({ where: { user: { schoolId } } })
  );
  await add("schoolRole", () => prisma.schoolRole.count({ where: { schoolId } }));
  await add("rolePermission", () =>
    prisma.rolePermission.count({ where: { role: { schoolId } } })
  );
  await add("schoolSubscription", () => prisma.schoolSubscription.count({ where: { schoolId } }));
  await add("subscriptionInvoice", () =>
    prisma.subscriptionInvoice.count({ where: { schoolId } })
  );
  await add("subscriptionPaymentLog", () =>
    prisma.subscriptionPaymentLog.count({ where: { schoolId } })
  );
  await add("creditPurchaseInvoice", () =>
    prisma.creditPurchaseInvoice.count({ where: { schoolId } })
  );
  await add("creditPurchasePaymentLog", () =>
    prisma.creditPurchasePaymentLog.count({ where: { schoolId } })
  );
  await add("learner", () => prisma.learner.count({ where: { schoolId } }));
  await add("parent", () => prisma.parent.count({ where: { schoolId } }));
  await add("parentLearnerLink", () => prisma.parentLearnerLink.count({ where: { schoolId } }));
  await add("familyAccount", () => prisma.familyAccount.count({ where: { schoolId } }));
  await add("classroom", () => prisma.classroom.count({ where: { schoolId } }));
  await add("employee", () => prisma.employee.count({ where: { schoolId } }));
  await add("feeStructure", () => prisma.feeStructure.count({ where: { schoolId } }));
  await add("schoolFeeSetting", () => prisma.schoolFeeSetting.count({ where: { schoolId } }));
  await add("billingSettings", () => prisma.billingSettings.count({ where: { schoolId } }));
  await add("billingDeposit", () => prisma.billingDeposit.count({ where: { schoolId } }));
  await add("bankStatementImport", () => prisma.bankStatementImport.count({ where: { schoolId } }));
  await add("bankTransaction", () => prisma.bankTransaction.count({ where: { schoolId } }));
  await add("supplier", () => prisma.supplier.count({ where: { schoolId } }));
  await add("supplierInvoice", () => prisma.supplierInvoice.count({ where: { schoolId } }));
  await add("expenseCategory", () => prisma.expenseCategory.count({ where: { schoolId } }));
  await add("accountingJournal", () => prisma.accountingJournal.count({ where: { schoolId } }));
  await add("payrollRun", () => prisma.payrollRun.count({ where: { schoolId } }));
  await add("payrollSetting", () => prisma.payrollSetting.count({ where: { schoolId } }));
  await add("payslip", () => prisma.payslip.count({ where: { schoolId } }));
  await add("payrollEmailLog", () => prisma.payrollEmailLog.count({ where: { schoolId } }));
  await add("letter", () => prisma.letter.count({ where: { schoolId } }));
  await add("letterTemplate", () => prisma.letterTemplate.count({ where: { schoolId } }));
  await add("learnerIncident", () => prisma.learnerIncident.count({ where: { schoolId } }));
  await add("learnerResult", () => prisma.learnerResult.count({ where: { schoolId } }));
  await add("learnerReport", () => prisma.learnerReport.count({ where: { schoolId } }));
  await add("homeworkPost", () => prisma.homeworkPost.count({ where: { schoolId } }));
  await add("schoolNotice", () => prisma.schoolNotice.count({ where: { schoolId } }));
  await add("parentDocument", () => prisma.parentDocument.count({ where: { schoolId } }));
  await add("parentOnboarding", () => prisma.parentOnboarding.count({ where: { schoolId } }));
  await add("parentOutreachQueue", () => prisma.parentOutreachQueue.count({ where: { schoolId } }));
  await add("parentNotification", () => prisma.parentNotification.count({ where: { schoolId } }));
  await add("parentTeacherThread", () => prisma.parentTeacherThread.count({ where: { schoolId } }));
  await add("communicationMessage", () => prisma.communicationMessage.count({ where: { schoolId } }));
  await add("communicationCampaign", () => prisma.communicationCampaign.count({ where: { schoolId } }));
  await add("communicationTemplate", () =>
    prisma.communicationTemplate.count({ where: { schoolId } })
  );
  await add("communicationLog", () => prisma.communicationLog.count({ where: { schoolId } }));
  await add("pushSubscription", () => prisma.pushSubscription.count({ where: { schoolId } }));
  await add("schoolEmailSettings", () => prisma.schoolEmailSettings.count({ where: { schoolId } }));
  await add("schoolCommunicationProfile", () =>
    prisma.schoolCommunicationProfile.count({ where: { schoolId } })
  );
  await add("teacherPerformance", () => prisma.teacherPerformance.count({ where: { schoolId } }));

  return counts;
}

async function countOtherSchools(excludeSchoolId: string): Promise<CountMap> {
  return {
    schools: await prisma.school.count({ where: { id: { not: excludeSchoolId } } }),
    learners: await prisma.learner.count({ where: { schoolId: { not: excludeSchoolId } } }),
    users: await prisma.user.count({ where: { schoolId: { not: excludeSchoolId } } }),
  };
}

async function collectScope(schoolId: string): Promise<ScopeCounts> {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) throw new Error(`School missing: ${schoolId}`);

  const scopeSchoolIds = await collectDaSilvaSchoolIds(prisma, [schoolId]);
  const jsonCounts = await countJsonSchoolData(scopeSchoolIds);

  return {
    targetSchool: school,
    prisma: await countTargetPrismaRows(schoolId),
    json: jsonCounts,
    files: jsonCounts,
    otherSchools: await countOtherSchools(schoolId),
  };
}

async function purgeSubscriptionBilling(schoolId: string): Promise<CountMap> {
  const removed: CountMap = {};
  const run = async (key: string, fn: () => Promise<{ count: number }>) => {
    const r = await fn();
    bump(removed, key, r.count);
  };

  await run("subscriptionPaymentLog", () =>
    prisma.subscriptionPaymentLog.deleteMany({ where: { schoolId } })
  );
  await run("subscriptionInvoice", () =>
    prisma.subscriptionInvoice.deleteMany({ where: { schoolId } })
  );
  await run("schoolSubscription", () =>
    prisma.schoolSubscription.deleteMany({ where: { schoolId } })
  );
  await run("creditPurchasePaymentLog", () =>
    prisma.creditPurchasePaymentLog.deleteMany({ where: { schoolId } })
  );
  await run("creditPurchaseInvoice", () =>
    prisma.creditPurchaseInvoice.deleteMany({ where: { schoolId } })
  );

  return removed;
}

function purgeMigrationFileArtifacts(schoolIds: string[]): CountMap {
  const removed: CountMap = {};
  const idSet = new Set(schoolIds);

  const batches = listImportBatches().filter((b) => idSet.has(String(b.targetSchoolId || "")));
  const stageIds = new Set<string>();
  for (const batch of batches) {
    const batchPath = path.join(BATCHES_DIR, `${batch.batchId}.json`);
    if (fs.existsSync(batchPath)) {
      fs.unlinkSync(batchPath);
      bump(removed, "migrationImportBatches", 1);
    }
    const sid = String(batch.stageId || "").trim();
    if (sid) stageIds.add(sid);
  }

  for (const item of listStages()) {
    if (
      stageIds.has(item.stageId) ||
      schoolIds.some((sid) => stageBelongsToSchool(item.stageId, sid))
    ) {
      if (deleteStage(item.stageId)) bump(removed, "migrationStages", 1);
    }
  }

  for (const pilot of listPilots().filter((p) => idSet.has(String(p.schoolId || "")))) {
    const filePath = path.join(process.cwd(), "storage", "migration-pilots", `${pilot.pilotId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      bump(removed, "migrationPilots", 1);
    }
  }

  for (const runbook of listRunbooks().filter((r) => idSet.has(String(r.schoolId || "")))) {
    const filePath = path.join(
      process.cwd(),
      "storage",
      "migration-runbooks",
      `${runbook.runbookId}.json`
    );
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      bump(removed, "migrationRunbooks", 1);
    }
  }

  for (const pack of listSignoffs().filter((s) => idSet.has(String(s.schoolId || "")))) {
    const filePath = path.join(
      process.cwd(),
      "storage",
      "migration-signoffs",
      `${pack.signoffId}.json`
    );
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      bump(removed, "migrationSignoffs", 1);
    }
  }

  for (const schoolId of schoolIds) {
    bump(
      removed,
      "migrationStagingUploadFiles",
      removeStagingDir(path.join(STAGING_UPLOAD_ROOT, schoolId))
    );
  }

  if (fs.existsSync(MIGRATION_STAGING_ROOT)) {
    for (const entry of fs.readdirSync(MIGRATION_STAGING_ROOT, { withFileTypes: true })) {
      const full = path.join(MIGRATION_STAGING_ROOT, entry.name);
      if (
        entry.isFile() &&
        schoolIds.some((sid) => entry.name.includes(sid)) &&
        fs.existsSync(full)
      ) {
        fs.unlinkSync(full);
        bump(removed, "migrationStorageStagingFiles", 1);
      }
    }
  }

  return removed;
}

function printCounts(label: string, scope: ScopeCounts): void {
  console.log(`\n=== ${label} ===`);
  console.log(`Target: ${scope.targetSchool.name} (${scope.targetSchool.id})`);
  console.log("\nPrisma (target school):");
  for (const [k, v] of Object.entries(scope.prisma).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${k}: ${v}`);
  }
  console.log("\nJSON / file stores (target school):");
  for (const [k, v] of Object.entries(scope.json).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${k}: ${v}`);
  }
  console.log("\nOther schools (must stay unchanged):");
  for (const [k, v] of Object.entries(scope.otherSchools).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${k}: ${v}`);
  }
}

function printRemoved(summary: Record<string, CountMap>): void {
  console.log("\n=== REMOVED ===");
  for (const [section, map] of Object.entries(summary)) {
    const entries = Object.entries(map).filter(([, n]) => n > 0);
    if (!entries.length) continue;
    console.log(`\n${section}:`);
    for (const [k, v] of entries.sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  ${k}: ${v}`);
    }
  }
}

async function promptConfirmation(): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`\nType the confirmation phrase exactly (${CONFIRMATION_PHRASE}): `, (line) => {
      rl.close();
      resolve(line);
    });
  });
  return answer.trim() === CONFIRMATION_PHRASE;
}

async function executeHardDelete(
  schoolId: string,
  options: { purgeLedger: boolean }
): Promise<Record<string, CountMap>> {
  const scopeSchoolIds = await collectDaSilvaSchoolIds(prisma, [schoolId]);
  const purgeScope = await buildDaSilvaPurgeScope(prisma, schoolId);

  const prismaRemoved: CountMap = {};

  for (const sid of scopeSchoolIds) {
    if (sid === schoolId) continue;
    const extra = await purgeImportedSchoolData(sid);
    for (const [k, v] of Object.entries(extra)) bump(prismaRemoved, `${k}_orphanSchool`, v);
    await deleteSchoolUsers(sid).catch(() => 0);
    try {
      await prisma.school.delete({ where: { id: sid } });
      bump(prismaRemoved, "school_orphan", 1);
    } catch {
      /* row may already be gone */
    }
  }

  const subscriptionRemoved = await purgeSubscriptionBilling(schoolId);
  Object.assign(prismaRemoved, subscriptionRemoved);

  const importedRemoved = await purgeImportedSchoolData(schoolId);
  Object.assign(prismaRemoved, importedRemoved);

  const usersDeleted = await deleteSchoolUsers(schoolId);
  bump(prismaRemoved, "user", usersDeleted);

  const rolesDeleted = await deleteSchoolRoles(schoolId);
  bump(prismaRemoved, "schoolRole", rolesDeleted);

  const schoolDeleted = await prisma.school.delete({ where: { id: schoolId } });
  bump(prismaRemoved, "school", schoolDeleted ? 1 : 0);

  const jsonRemoved: CountMap = {};
  if (options.purgeLedger) {
    Object.assign(jsonRemoved, purgeDaSilvaJsonStores(purgeScope));
  }

  const filesRemoved: CountMap = {};
  for (const s of clearStagingForSchools(scopeSchoolIds)) {
    bump(filesRemoved, "migrationStagingUploadDir", s.files);
  }
  Object.assign(filesRemoved, purgeMigrationFileArtifacts(scopeSchoolIds));

  return { prisma: prismaRemoved, json: jsonRemoved, files: filesRemoved };
}

async function main(): Promise<void> {
  console.log("=== Da Silva Academy — FULL HARD DELETE ===");
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(
    `Purge JSON billing (--purge-ledger): ${!APPLY ? "on apply (default)" : PURGE_LEDGER ? "explicit flag" : "default on apply"}`
  );

  const school = await resolveTargetSchool(CLI_SCHOOL_ID);
  const schoolId = school.id;

  const db = getDatabaseConnectionInfo();
  console.log("\n=== TARGET ===");
  console.log(`Resolved schoolId: ${school.id}`);
  console.log(`School name: ${school.name}`);
  console.log(`Database host: ${db.host}`);
  console.log(`Database name: ${db.database}`);
  console.log(`DATABASE_URL (masked): ${db.maskedUrl}`);

  const before = await collectScope(schoolId);
  printCounts("BEFORE", before);

  console.log("\n=== DELETION PLAN (target school only) ===");
  console.log("  • School record (Da Silva Academy row)");
  console.log("  • All users, roles, and permission overrides for this school");
  console.log("  • Learners, parents, parent links, family accounts");
  console.log("  • Classrooms, groups-related posts, incidents, homework, notices");
  console.log("  • Employees, payroll runs/items/payslips/settings/email logs");
  console.log("  • Fee structures, billing settings, deposits, bank imports/transactions");
  console.log("  • Suppliers, expenses, accounting journals");
  console.log("  • Letters, communication engine data, parent portal artifacts");
  console.log("  • School subscription, subscription invoices/payments, credit purchases");
  console.log("  • JSON: billing ledger (incl. canonical bucket), learner billing plans, Kid-e-Sys history, user-access, etc.");
  console.log(`  • Canonical billing school id: ${DA_SILVA_ACADEMY_SCHOOL_ID}`);
  console.log("  • Migration import batches, stages, pilots, runbooks, signoffs, staging uploads");
  console.log("\nNOT deleted:");
  console.log("  • Other schools and their data");
  console.log("  • Global EduClear packages, permissions catalog, platform school");

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to execute hard delete.");
    return;
  }

  const confirmed = await promptConfirmation();
  if (!confirmed) {
    console.error("\nAborted: confirmation phrase did not match.");
    process.exit(1);
  }

  console.log("\nExecuting hard delete…");
  const removed = await executeHardDelete(schoolId, { purgeLedger: true });

  const afterOtherSchools = await countOtherSchools(schoolId);
  const emptyState = await auditDaSilvaEmptyState(prisma);

  console.log("\n=== AFTER ===");
  console.log("\nEmpty-state counts (must all be 0):");
  for (const [k, v] of Object.entries(emptyState.counts).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${k}: ${v}`);
  }
  console.log("\nOther schools (must stay unchanged):");
  for (const [k, v] of Object.entries(afterOtherSchools).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${k}: ${v}`);
  }
  printRemoved(removed);

  const blockers = [...emptyState.blockers];
  if (afterOtherSchools.schools !== before.otherSchools.schools) {
    blockers.push("other school count changed (unexpected)");
  }

  if (blockers.length) {
    console.error("\nHARD DELETE INCOMPLETE — empty-state assertion failed:");
    for (const b of blockers) console.error(`  - ${b}`);
    console.error("\nRe-run purge or inspect JSON under data/billing-ledger.json");
    console.error("Then verify: npx tsx scripts/audit-da-silva-empty-state.ts");
    process.exit(2);
  }

  await assertDaSilvaEmptyState(prisma, "post-delete");

  console.log("\nDa Silva Academy hard delete complete.");
  console.log("Safe to start Phase 1 after: npx tsx scripts/audit-da-silva-empty-state.ts");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
