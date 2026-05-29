/**
 * Safe production cleanup for leftover school registration email.
 *
 * Target (hard-coded): dasilvaacademy@gmail.com
 *
 * Default: dry-run only. Deletes nothing without --apply and confirmation phrase.
 *
 * Usage:
 *   npx tsx scripts/delete-registration-email.ts
 *   npx tsx scripts/delete-registration-email.ts --apply
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
import { deleteUserAccessMeta } from "../src/utils/userAccessStore";
import {
  clearJsonStoresForSchools,
  clearStagingForSchools,
  deleteSchoolRoles,
  deleteSchoolUsers,
  purgeImportedSchoolData,
} from "./school-data-cleanup";

const prisma = new PrismaClient();

/** Must match exactly — script refuses any other target. */
const TARGET_EMAIL = "dasilvaacademy@gmail.com";
const CONFIRMATION_PHRASE = "DELETE DASILVA EMAIL";
const PLATFORM_SCHOOL_NAME = "EduClear Platform";
const DA_SILVA_SCHOOL_NAME = "Da Silva Academy";

const APPLY = process.argv.includes("--apply");

const STAGING_UPLOAD_ROOT = path.join(process.cwd(), "uploads", "migration-staging");
const BATCHES_DIR = path.join(process.cwd(), "storage", "migration-import-batches");
const MIGRATION_STAGING_ROOT = path.join(process.cwd(), "storage", "migration-staging");
const USER_ACCESS_FILE = path.join(process.cwd(), "data", "user-access.json");

type IdRow = { id: string; schoolId?: string; schoolName?: string; detail?: string };

type EmailFindings = {
  targetEmail: string;
  normalizedEmail: string;
  database: { host: string; database: string; maskedUrl: string };
  schoolsByEmail: IdRow[];
  schoolsByDaSilvaName: IdRow[];
  users: IdRow[];
  parents: IdRow[];
  employees: IdRow[];
  subscriptionPaymentLogs: IdRow[];
  payslipsEmailedTo: IdRow[];
  schoolEmailSettings: IdRow[];
  parentOutreachRecipients: IdRow[];
  communicationRecipients: IdRow[];
  userAccessEntries: Array<{ userId: string; schoolId: string }>;
  fullDeleteSchoolIds: string[];
  blockedReason: string;
  registrationFix: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertTargetEmailConstant(): void {
  if (normalizeEmail(TARGET_EMAIL) !== "dasilvaacademy@gmail.com") {
    throw new Error(`Refusing: TARGET_EMAIL constant must be dasilvaacademy@gmail.com`);
  }
}

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

function getDatabaseConnectionInfo(): { host: string; database: string; maskedUrl: string } {
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

function emailEqualsFilter(normalized: string) {
  return { equals: normalized, mode: "insensitive" as const };
}

async function discoverFindings(): Promise<EmailFindings> {
  assertTargetEmailConstant();
  const normalizedEmail = normalizeEmail(TARGET_EMAIL);

  const schoolsByEmail = await prisma.school.findMany({
    where: { email: emailEqualsFilter(normalizedEmail) },
    select: { id: true, name: true, email: true },
    orderBy: { createdAt: "asc" },
  });

  const schoolsByDaSilvaName = await prisma.school.findMany({
    where: { name: DA_SILVA_SCHOOL_NAME },
    select: { id: true, name: true, email: true },
    orderBy: { createdAt: "asc" },
  });

  const users = await prisma.user.findMany({
    where: { email: emailEqualsFilter(normalizedEmail) },
    select: { id: true, email: true, schoolId: true, fullName: true, isActive: true },
    orderBy: { createdAt: "asc" },
  });

  const parents = await prisma.parent.findMany({
    where: { email: emailEqualsFilter(normalizedEmail) },
    select: { id: true, schoolId: true, firstName: true, surname: true, email: true },
    orderBy: { createdAt: "asc" },
  });

  const employees = await prisma.employee.findMany({
    where: { email: emailEqualsFilter(normalizedEmail) },
    select: { id: true, schoolId: true, firstName: true, lastName: true, email: true },
    orderBy: { createdAt: "asc" },
  });

  const subscriptionPaymentLogs = await prisma.subscriptionPaymentLog.findMany({
    where: { payerEmail: emailEqualsFilter(normalizedEmail) },
    select: { id: true, schoolId: true, payerEmail: true },
    orderBy: { createdAt: "asc" },
  });

  const payslipsEmailedTo = await prisma.payslip.findMany({
    where: { emailedTo: emailEqualsFilter(normalizedEmail) },
    select: { id: true, schoolId: true, emailedTo: true },
    orderBy: { createdAt: "asc" },
  });

  const schoolEmailSettings = await prisma.schoolEmailSettings.findMany({
    where: {
      OR: [
        { fromEmail: emailEqualsFilter(normalizedEmail) },
        { smtpUser: emailEqualsFilter(normalizedEmail) },
        { replyTo: emailEqualsFilter(normalizedEmail) },
      ],
    },
    select: { id: true, schoolId: true, fromEmail: true, smtpUser: true },
    orderBy: { createdAt: "asc" },
  });

  const parentOutreachRecipients = await prisma.parentOutreachQueue.findMany({
    where: { recipient: emailEqualsFilter(normalizedEmail) },
    select: { id: true, schoolId: true, recipient: true },
    orderBy: { createdAt: "asc" },
  });

  const communicationRecipients = await prisma.communicationRecipient.findMany({
    where: { address: emailEqualsFilter(normalizedEmail) },
    select: { id: true, messageId: true, address: true },
    orderBy: { id: "asc" },
  });

  const userAccessEntries: Array<{ userId: string; schoolId: string }> = [];
  if (fs.existsSync(USER_ACCESS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(USER_ACCESS_FILE, "utf8")) as {
        users?: Record<string, { schoolId?: string }>;
      };
      const userIds = new Set(users.map((u) => u.id));
      for (const [userId, meta] of Object.entries(parsed.users || {})) {
        if (userIds.has(userId)) {
          userAccessEntries.push({
            userId,
            schoolId: String(meta.schoolId || ""),
          });
        }
      }
    } catch {
      /* ignore malformed store in dry-run */
    }
  }

  const fullDeleteSchoolIdSet = new Set<string>();
  for (const s of schoolsByEmail) {
    if (isPlatformSchoolName(s.name)) {
      throw new Error(
        `Refusing: ${PLATFORM_SCHOOL_NAME} has registration email ${TARGET_EMAIL} (${s.id})`
      );
    }
    fullDeleteSchoolIdSet.add(s.id);
  }
  for (const s of schoolsByDaSilvaName) {
    if (isPlatformSchoolName(s.name)) {
      throw new Error(`Refusing: ${PLATFORM_SCHOOL_NAME} is named ${DA_SILVA_SCHOOL_NAME}`);
    }
    fullDeleteSchoolIdSet.add(s.id);
  }

  const blockedReason =
    schoolsByEmail.length > 0
      ? `POST /auth/register-school checks School.email (unique). ${schoolsByEmail.length} school row(s) still use ${TARGET_EMAIL}.`
      : users.length > 0
        ? `No school email row, but ${users.length} User row(s) still use ${TARGET_EMAIL} (blocks alternate registration paths).`
        : "No Prisma rows found for this email — registration blocker may be elsewhere.";

  const registrationFix =
    fullDeleteSchoolIdSet.size > 0
      ? `Hard-delete school scope (${[...fullDeleteSchoolIdSet].join(", ")}) and all users with ${TARGET_EMAIL}, then clear JSON user-access.`
      : users.length > 0
        ? `Delete orphan User row(s) and user-access.json entries for ${TARGET_EMAIL}.`
        : "No action required in database for this email.";

  const schoolNameById = new Map<string, string>();
  for (const s of [...schoolsByEmail, ...schoolsByDaSilvaName]) {
    schoolNameById.set(s.id, s.name);
  }
  for (const u of users) {
    if (!schoolNameById.has(u.schoolId)) {
      const school = await prisma.school.findUnique({
        where: { id: u.schoolId },
        select: { name: true },
      });
      if (school) schoolNameById.set(u.schoolId, school.name);
    }
  }

  return {
    targetEmail: TARGET_EMAIL,
    normalizedEmail,
    database: getDatabaseConnectionInfo(),
    schoolsByEmail: schoolsByEmail.map((s) => ({
      id: s.id,
      detail: `name=${s.name} email=${s.email || "null"}`,
    })),
    schoolsByDaSilvaName: schoolsByDaSilvaName.map((s) => ({
      id: s.id,
      detail: `name=${s.name} email=${s.email || "null"}`,
    })),
    users: users.map((u) => ({
      id: u.id,
      schoolId: u.schoolId,
      schoolName: schoolNameById.get(u.schoolId),
      detail: `fullName=${u.fullName || ""} isActive=${u.isActive}`,
    })),
    parents: parents.map((p) => ({
      id: p.id,
      schoolId: p.schoolId,
      detail: `${p.firstName} ${p.surname}`,
    })),
    employees: employees.map((e) => ({
      id: e.id,
      schoolId: e.schoolId,
      detail: `${e.firstName || ""} ${e.lastName || ""}`.trim(),
    })),
    subscriptionPaymentLogs: subscriptionPaymentLogs.map((r) => ({
      id: r.id,
      schoolId: r.schoolId,
      detail: r.payerEmail || "",
    })),
    payslipsEmailedTo: payslipsEmailedTo.map((p) => ({
      id: p.id,
      schoolId: p.schoolId,
      detail: p.emailedTo || "",
    })),
    schoolEmailSettings: schoolEmailSettings.map((s) => ({
      id: s.id,
      schoolId: s.schoolId,
      detail: `from=${s.fromEmail} smtpUser=${s.smtpUser}`,
    })),
    parentOutreachRecipients: parentOutreachRecipients.map((r) => ({
      id: r.id,
      schoolId: r.schoolId,
      detail: r.recipient,
    })),
    communicationRecipients: communicationRecipients.map((r) => ({
      id: r.id,
      detail: `messageId=${r.messageId} address=${r.address}`,
    })),
    userAccessEntries,
    fullDeleteSchoolIds: [...fullDeleteSchoolIdSet],
    blockedReason,
    registrationFix,
  };
}

function printSection(title: string, rows: IdRow[], countLabel: string): void {
  console.log(`\n--- ${title} ---`);
  console.log(`${countLabel}: ${rows.length}`);
  if (!rows.length) {
    console.log("  (none)");
    return;
  }
  for (const row of rows) {
    const parts = [`  id=${row.id}`];
    if (row.schoolId) parts.push(`schoolId=${row.schoolId}`);
    if (row.schoolName) parts.push(`school=${row.schoolName}`);
    if (row.detail) parts.push(row.detail);
    console.log(parts.join(" "));
  }
}

function printBefore(findings: EmailFindings): void {
  console.log("=== Registration email cleanup — BEFORE ===");
  console.log(`Target email: ${findings.targetEmail}`);
  console.log(`Normalized:   ${findings.normalizedEmail}`);
  console.log(`Mode:         ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`Database host: ${findings.database.host}`);
  console.log(`Database name: ${findings.database.database}`);
  console.log(`DATABASE_URL (masked): ${findings.database.maskedUrl}`);

  console.log("\n=== ROOT CAUSE ===");
  console.log(findings.blockedReason);

  console.log("\n=== EXACT FIX (when --apply) ===");
  console.log(findings.registrationFix);

  printSection("School (email match — blocks registration)", findings.schoolsByEmail, "count");
  printSection(`School (name "${DA_SILVA_SCHOOL_NAME}")`, findings.schoolsByDaSilvaName, "count");
  printSection("User", findings.users, "count");
  printSection("Parent", findings.parents, "count");
  printSection("Employee", findings.employees, "count");
  printSection("SubscriptionPaymentLog (payerEmail)", findings.subscriptionPaymentLogs, "count");
  printSection("Payslip (emailedTo)", findings.payslipsEmailedTo, "count");
  printSection("SchoolEmailSettings", findings.schoolEmailSettings, "count");
  printSection("ParentOutreachQueue (recipient)", findings.parentOutreachRecipients, "count");
  printSection("CommunicationRecipient (address)", findings.communicationRecipients, "count");

  console.log("\n--- user-access.json (by owner user id) ---");
  console.log(`count: ${findings.userAccessEntries.length}`);
  if (!findings.userAccessEntries.length) {
    console.log("  (none)");
  } else {
    for (const e of findings.userAccessEntries) {
      console.log(`  userId=${e.userId} schoolId=${e.schoolId}`);
    }
  }

  console.log("\n--- Schools scheduled for full hard-delete ---");
  console.log(`count: ${findings.fullDeleteSchoolIds.length}`);
  if (!findings.fullDeleteSchoolIds.length) {
    console.log("  (none — orphan email rows only)");
  } else {
    for (const id of findings.fullDeleteSchoolIds) {
      console.log(`  ${id}`);
    }
  }

  const otherSchoolUsers = findings.users.filter(
    (u) => u.schoolId && !findings.fullDeleteSchoolIds.includes(u.schoolId)
  );
  if (otherSchoolUsers.length) {
    console.log("\n--- Users at OTHER schools (email-only delete, school preserved) ---");
    for (const u of otherSchoolUsers) {
      console.log(`  id=${u.id} schoolId=${u.schoolId} school=${u.schoolName || "?"}`);
    }
  }
}

function bump(map: Record<string, number>, key: string, n: number): void {
  if (n > 0) map[key] = (map[key] || 0) + n;
}

function stageBelongsToSchool(stageId: string, schoolId: string): boolean {
  const stage = listStages().find((s) => s.stageId === stageId);
  if (!stage) return false;
  return stage.files.some((f) => String(f.path || "").includes(schoolId));
}

async function purgeSubscriptionBilling(schoolId: string): Promise<Record<string, number>> {
  const removed: Record<string, number> = {};
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

function removeStagingDir(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  const walk = (d: string): number => {
    let n = 0;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      n += entry.isDirectory() ? walk(full) : 1;
    }
    return n;
  };
  const files = walk(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  return files;
}

function purgeMigrationFileArtifacts(schoolId: string): Record<string, number> {
  const removed: Record<string, number> = {};

  const batches = listImportBatches().filter((b) => b.targetSchoolId === schoolId);
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
    if (stageIds.has(item.stageId) || stageBelongsToSchool(item.stageId, schoolId)) {
      if (deleteStage(item.stageId)) bump(removed, "migrationStages", 1);
    }
  }

  for (const pilot of listPilots().filter((p) => p.schoolId === schoolId)) {
    const filePath = path.join(process.cwd(), "storage", "migration-pilots", `${pilot.pilotId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      bump(removed, "migrationPilots", 1);
    }
  }

  for (const runbook of listRunbooks().filter((r) => r.schoolId === schoolId)) {
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

  for (const pack of listSignoffs().filter((s) => s.schoolId === schoolId)) {
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

  bump(removed, "migrationStagingUploadFiles", removeStagingDir(path.join(STAGING_UPLOAD_ROOT, schoolId)));

  if (fs.existsSync(MIGRATION_STAGING_ROOT)) {
    for (const entry of fs.readdirSync(MIGRATION_STAGING_ROOT, { withFileTypes: true })) {
      const full = path.join(MIGRATION_STAGING_ROOT, entry.name);
      if (entry.isFile() && entry.name.includes(schoolId) && fs.existsSync(full)) {
        fs.unlinkSync(full);
        bump(removed, "migrationStorageStagingFiles", 1);
      }
    }
  }

  return removed;
}

async function hardDeleteSchool(schoolId: string): Promise<Record<string, number>> {
  const removed: Record<string, number> = {};

  Object.assign(removed, await purgeSubscriptionBilling(schoolId));
  Object.assign(removed, await purgeImportedSchoolData(schoolId));
  bump(removed, "user", await deleteSchoolUsers(schoolId));
  bump(removed, "schoolRole", await deleteSchoolRoles(schoolId));

  await prisma.school.delete({ where: { id: schoolId } });
  bump(removed, "school", 1);

  for (const impact of clearJsonStoresForSchools([schoolId])) {
    bump(removed, `json:${impact.file}`, 1);
  }
  for (const s of clearStagingForSchools([schoolId])) {
    bump(removed, "migrationStagingUploadDir", s.files);
  }
  Object.assign(removed, purgeMigrationFileArtifacts(schoolId));

  return removed;
}

async function deleteOrphanUsersByEmail(
  userIds: string[],
  fullDeleteSchoolIds: string[]
): Promise<number> {
  const skipSchools = new Set(fullDeleteSchoolIds);
  let deleted = 0;

  for (const userId of userIds) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, schoolId: true, email: true },
    });
    if (!user) continue;
    if (normalizeEmail(user.email) !== normalizeEmail(TARGET_EMAIL)) continue;
    if (skipSchools.has(user.schoolId)) continue;

    const school = await prisma.school.findUnique({
      where: { id: user.schoolId },
      select: { name: true },
    });
    if (school && isPlatformSchoolName(school.name)) {
      throw new Error(`Refusing to delete user ${userId} on ${PLATFORM_SCHOOL_NAME}`);
    }

    await prisma.userPermissionOverride.deleteMany({ where: { userId } });
    deleteUserAccessMeta(userId);
    await prisma.user.delete({ where: { id: userId } });
    deleted += 1;
  }

  return deleted;
}

async function deleteEmailScopedRows(findings: EmailFindings): Promise<Record<string, number>> {
  const normalized = findings.normalizedEmail;
  const removed: Record<string, number> = {};

  const parentIds = findings.parents
    .filter((p) => p.schoolId && !findings.fullDeleteSchoolIds.includes(p.schoolId))
    .map((p) => p.id);
  if (parentIds.length) {
    const r = await prisma.parent.deleteMany({ where: { id: { in: parentIds } } });
    bump(removed, "parent", r.count);
  }

  const employeeIds = findings.employees
    .filter((e) => e.schoolId && !findings.fullDeleteSchoolIds.includes(e.schoolId))
    .map((e) => e.id);
  if (employeeIds.length) {
    const r = await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
    bump(removed, "employee", r.count);
  }

  const subLogIds = findings.subscriptionPaymentLogs.map((r) => r.id);
  if (subLogIds.length) {
    const r = await prisma.subscriptionPaymentLog.deleteMany({ where: { id: { in: subLogIds } } });
    bump(removed, "subscriptionPaymentLog", r.count);
  }

  const payslipIds = findings.payslipsEmailedTo.map((p) => p.id);
  if (payslipIds.length) {
    const r = await prisma.payslip.deleteMany({ where: { id: { in: payslipIds } } });
    bump(removed, "payslip", r.count);
  }

  const settingsIds = findings.schoolEmailSettings.map((s) => s.id);
  if (settingsIds.length) {
    const r = await prisma.schoolEmailSettings.deleteMany({ where: { id: { in: settingsIds } } });
    bump(removed, "schoolEmailSettings", r.count);
  }

  const outreachIds = findings.parentOutreachRecipients.map((r) => r.id);
  if (outreachIds.length) {
    const r = await prisma.parentOutreachQueue.deleteMany({ where: { id: { in: outreachIds } } });
    bump(removed, "parentOutreachQueue", r.count);
  }

  const commIds = findings.communicationRecipients.map((r) => r.id);
  if (commIds.length) {
    const r = await prisma.communicationRecipient.deleteMany({ where: { id: { in: commIds } } });
    bump(removed, "communicationRecipient", r.count);
  }

  // Safety sweep: any remaining rows with this email outside deleted schools
  const notIn = findings.fullDeleteSchoolIds.length
    ? { notIn: findings.fullDeleteSchoolIds }
    : undefined;

  const parentSweep = await prisma.parent.deleteMany({
    where: {
      email: emailEqualsFilter(normalized),
      ...(notIn ? { schoolId: notIn } : {}),
    },
  });
  bump(removed, "parentSweep", parentSweep.count);

  const employeeSweep = await prisma.employee.deleteMany({
    where: {
      email: emailEqualsFilter(normalized),
      ...(notIn ? { schoolId: notIn } : {}),
    },
  });
  bump(removed, "employeeSweep", employeeSweep.count);

  const payerSweep = await prisma.subscriptionPaymentLog.deleteMany({
    where: {
      payerEmail: emailEqualsFilter(normalized),
      ...(notIn ? { schoolId: notIn } : {}),
    },
  });
  bump(removed, "subscriptionPaymentLogSweep", payerSweep.count);

  return removed;
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

async function verifyAfter(findings: EmailFindings): Promise<void> {
  const after = await discoverFindings();
  const blockers: string[] = [];

  if (after.schoolsByEmail.length) {
    blockers.push(`${after.schoolsByEmail.length} school(s) still have email ${TARGET_EMAIL}`);
  }
  if (after.users.length) {
    blockers.push(`${after.users.length} user(s) still have email ${TARGET_EMAIL}`);
  }
  if (after.schoolsByDaSilvaName.length) {
    blockers.push(`${after.schoolsByDaSilvaName.length} "${DA_SILVA_SCHOOL_NAME}" school row(s) remain`);
  }

  console.log("\n=== AFTER (verification) ===");
  console.log(`School by email: ${after.schoolsByEmail.length}`);
  console.log(`User by email:   ${after.users.length}`);
  console.log(`Da Silva name:   ${after.schoolsByDaSilvaName.length}`);

  if (blockers.length) {
    console.error("\nWARNING: cleanup incomplete:");
    for (const b of blockers) console.error(`  - ${b}`);
    process.exit(2);
  }

  console.log("\nRegistration email cleanup complete — email is free for new school registration.");
}

async function main(): Promise<void> {
  console.log("=== EduClear — registration email cleanup ===");
  assertTargetEmailConstant();

  const before = await discoverFindings();
  printBefore(before);

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply and confirmation phrase to execute.");
    return;
  }

  const confirmed = await promptConfirmation();
  if (!confirmed) {
    console.error("\nAborted: confirmation phrase did not match.");
    process.exit(1);
  }

  console.log("\n=== APPLY — executing deletions ===");

  for (const schoolId of before.fullDeleteSchoolIds) {
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true },
    });
    if (!school) continue;
    if (isPlatformSchoolName(school.name)) {
      throw new Error(`Refusing full delete on ${PLATFORM_SCHOOL_NAME}`);
    }
    console.log(`\nHard-deleting school ${school.name} (${schoolId})…`);
    const removed = await hardDeleteSchool(schoolId);
    for (const [k, v] of Object.entries(removed).sort(([a], [b]) => a.localeCompare(b))) {
      if (v > 0) console.log(`  ${k}: ${v}`);
    }
  }

  const orphanUserIds = before.users
    .filter((u) => u.schoolId && !before.fullDeleteSchoolIds.includes(u.schoolId))
    .map((u) => u.id);
  const orphanDeleted = await deleteOrphanUsersByEmail(orphanUserIds, before.fullDeleteSchoolIds);
  if (orphanDeleted) console.log(`\nOrphan users deleted: ${orphanDeleted}`);

  const scopedRemoved = await deleteEmailScopedRows(before);
  const scopedEntries = Object.entries(scopedRemoved).filter(([, n]) => n > 0);
  if (scopedEntries.length) {
    console.log("\nEmail-scoped row deletions:");
    for (const [k, v] of scopedEntries.sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  ${k}: ${v}`);
    }
  }

  await verifyAfter(before);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
