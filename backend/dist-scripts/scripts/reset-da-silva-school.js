"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * SAFE FULL RESET — Da Silva Academy ONLY.
 *
 * Goal: delete Da Silva Academy completely so migration can run fresh.
 *
 * Finds target by:
 *  - school name containing "Da Silva Academy" (case-insensitive)
 *  - user email "dasilvaacademy@gmail.com"
 *  - optional --schoolId <id> (if supplied, must match Da Silva Academy name pattern)
 *
 * Before deleting:
 *  - prints a deletion plan (ids + counts)
 *  - writes a JSON backup of EVERYTHING to be deleted:
 *      backend/uploads/reset-backups/da-silva-reset-[timestamp].json
 *
 * Destructive mode requires:
 *  - --confirm
 *
 * Usage:
 *   npx tsx scripts/reset-da-silva-school.ts
 *   npx tsx scripts/reset-da-silva-school.ts --schoolId <id>
 *   npx tsx scripts/reset-da-silva-school.ts --confirm
 *   npx tsx scripts/reset-da-silva-school.ts --confirm --schoolId <id>
 */
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const migrationImportBatchStore_1 = require("../src/services/migration/core/migrationImportBatchStore");
const migrationPilotStore_1 = require("../src/services/migration/core/migrationPilotStore");
const migrationRunbookStore_1 = require("../src/services/migration/core/migrationRunbookStore");
const migrationSignoffStore_1 = require("../src/services/migration/core/migrationSignoffStore");
const migrationStageStore_1 = require("../src/services/migration/staging/migrationStageStore");
const billingLedgerStore_1 = require("../src/utils/billingLedgerStore");
const kidesysTransactionHistoryStore_1 = require("../src/utils/kidesysTransactionHistoryStore");
const learnerBillingPlanStore_1 = require("../src/utils/learnerBillingPlanStore");
const daSilvaEmptyState_1 = require("./lib/daSilvaEmptyState");
const school_data_cleanup_1 = require("./school-data-cleanup");
const prisma = new client_1.PrismaClient();
const OWNER_EMAIL = "dasilvaacademy@gmail.com";
const PLATFORM_SCHOOL_NAME = "EduClear Platform";
const SCHOOL_NAME_NEEDLE = "Da Silva Academy";
const STAGING_UPLOAD_ROOT = path_1.default.join(process.cwd(), "uploads", "migration-staging");
const BATCHES_DIR = path_1.default.join(process.cwd(), "storage", "migration-import-batches");
const MIGRATION_STAGING_ROOT = path_1.default.join(process.cwd(), "storage", "migration-staging");
const DATA_DIR = path_1.default.join(process.cwd(), "data");
function bump(map, key, n) {
    if (n > 0)
        map[key] = (map[key] || 0) + n;
}
function parseCli() {
    const argv = process.argv.slice(2);
    let schoolId;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--schoolId") {
            schoolId = String(argv[i + 1] || "").trim() || undefined;
            if (!schoolId)
                throw new Error("--schoolId requires a value");
            i += 1;
            continue;
        }
        if (arg.startsWith("--schoolId=")) {
            schoolId = arg.slice("--schoolId=".length).trim() || undefined;
            if (!schoolId)
                throw new Error("--schoolId requires a value");
        }
    }
    return { confirm: argv.includes("--confirm"), schoolId };
}
function isPlatformSchoolName(name) {
    return name.trim().toLowerCase() === PLATFORM_SCHOOL_NAME.toLowerCase();
}
function looksLikeDaSilvaAcademy(name) {
    return name.toLowerCase().includes(SCHOOL_NAME_NEEDLE.toLowerCase());
}
async function resolveCandidateSchools(cliSchoolId) {
    if (cliSchoolId) {
        const row = await prisma.school.findUnique({
            where: { id: cliSchoolId },
            select: { id: true, name: true, email: true, createdAt: true },
        });
        if (!row) {
            throw new Error(`School not found for --schoolId ${cliSchoolId}. Refusing — no global deletes.`);
        }
        if (isPlatformSchoolName(row.name)) {
            throw new Error(`Refusing: target is the ${PLATFORM_SCHOOL_NAME} school (${row.id})`);
        }
        if (!looksLikeDaSilvaAcademy(row.name)) {
            throw new Error(`School name must contain "${SCHOOL_NAME_NEEDLE}" for this reset, got "${row.name}". Refusing.`);
        }
        return [row];
    }
    const byName = await prisma.school.findMany({
        where: { name: { contains: SCHOOL_NAME_NEEDLE, mode: "insensitive" } },
        select: { id: true, name: true, email: true, createdAt: true },
        orderBy: { createdAt: "asc" },
    });
    const byEmail = await prisma.school.findMany({
        where: { email: { equals: OWNER_EMAIL, mode: "insensitive" } },
        select: { id: true, name: true, email: true, createdAt: true },
        orderBy: { createdAt: "asc" },
    });
    const merged = new Map();
    for (const s of [...byName, ...byEmail])
        merged.set(s.id, s);
    // Also include the school that owns the owner email (if user exists), even if the school email differs.
    const ownerUser = await prisma.user.findFirst({
        where: { email: { equals: OWNER_EMAIL, mode: "insensitive" } },
        select: { id: true, schoolId: true, school: { select: { id: true, name: true, email: true, createdAt: true } } },
    });
    if (ownerUser?.school)
        merged.set(ownerUser.school.id, ownerUser.school);
    const out = Array.from(merged.values()).filter((s) => !isPlatformSchoolName(s.name));
    return out;
}
async function resolveScopeSchools(candidates) {
    const platform = await prisma.school.findFirst({
        where: { name: { equals: PLATFORM_SCHOOL_NAME, mode: "insensitive" } },
        select: { id: true, name: true },
    });
    if (!candidates.length) {
        throw new Error(`No Da Silva Academy candidate schools found by name/email. Supply --schoolId if the row exists under another name.`);
    }
    for (const c of candidates) {
        if (platform?.id === c.id) {
            throw new Error(`Refusing: target is the ${PLATFORM_SCHOOL_NAME} school (${c.id})`);
        }
        if (!looksLikeDaSilvaAcademy(c.name) && String(c.email || "").toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
            throw new Error(`Refusing: candidate school "${c.name}" (${c.id}) does not look like Da Silva Academy.`);
        }
    }
    const primary = candidates[0];
    const scopeSchoolIds = await (0, daSilvaEmptyState_1.collectDaSilvaSchoolIds)(prisma, [primary.id]);
    const scopeSchoolRows = await prisma.school.findMany({
        where: { id: { in: scopeSchoolIds } },
        select: { id: true, name: true, email: true, createdAt: true },
        orderBy: { createdAt: "asc" },
    });
    for (const s of scopeSchoolRows) {
        if (platform?.id === s.id) {
            throw new Error(`Refusing: scope includes the ${PLATFORM_SCHOOL_NAME} school (${s.id})`);
        }
        if (isPlatformSchoolName(s.name)) {
            throw new Error(`Refusing: scope includes platform school by name (${s.id})`);
        }
    }
    return {
        platform: platform || null,
        matched: candidates,
        scopeSchoolIds,
        scopeSchoolRows,
        canonicalJsonSchoolIds: scopeSchoolIds,
    };
}
async function collectIdsForSchool(schoolId) {
    const pickIds = async (fn) => (await fn()).map((r) => r.id);
    const users = await prisma.user.findMany({
        where: { schoolId },
        select: { id: true, email: true },
        orderBy: { createdAt: "asc" },
    });
    const roles = await prisma.schoolRole.findMany({
        where: { schoolId },
        select: { id: true },
    });
    const roleIds = roles.map((r) => r.id);
    const [rolePermissions, userPermissionOverrides] = await Promise.all([
        prisma.rolePermission.findMany({ where: { roleId: { in: roleIds } }, select: { id: true } }),
        prisma.userPermissionOverride.findMany({
            where: { user: { schoolId } },
            select: { id: true },
        }),
    ]);
    const ids = {
        users: users.map((u) => ({ id: u.id, email: u.email })),
        roles: roleIds,
        rolePermissions: rolePermissions.map((r) => r.id),
        userPermissionOverrides: userPermissionOverrides.map((r) => r.id),
        learners: await pickIds(() => prisma.learner.findMany({ where: { schoolId }, select: { id: true } })),
        parents: await pickIds(() => prisma.parent.findMany({ where: { schoolId }, select: { id: true } })),
        parentLearnerLinks: await pickIds(() => prisma.parentLearnerLink.findMany({ where: { schoolId }, select: { id: true } })),
        familyAccounts: await pickIds(() => prisma.familyAccount.findMany({ where: { schoolId }, select: { id: true } })),
        classrooms: await pickIds(() => prisma.classroom.findMany({ where: { schoolId }, select: { id: true } })),
        billingDeposits: await pickIds(() => prisma.billingDeposit.findMany({ where: { schoolId }, select: { id: true } })),
        bankStatementImports: await pickIds(() => prisma.bankStatementImport.findMany({ where: { schoolId }, select: { id: true } })),
        bankTransactions: await pickIds(() => prisma.bankTransaction.findMany({ where: { schoolId }, select: { id: true } })),
        supplierInvoices: await pickIds(() => prisma.supplierInvoice.findMany({ where: { schoolId }, select: { id: true } })),
        supplierInvoicePayments: await pickIds(() => prisma.supplierInvoicePayment.findMany({
            where: { invoice: { schoolId } },
            select: { id: true },
        })),
        supplierInvoiceLines: await pickIds(() => prisma.supplierInvoiceLine.findMany({
            where: { invoice: { schoolId } },
            select: { id: true },
        })),
        suppliers: await pickIds(() => prisma.supplier.findMany({ where: { schoolId }, select: { id: true } })),
        expenseCategories: await pickIds(() => prisma.expenseCategory.findMany({ where: { schoolId }, select: { id: true } })),
        accountingJournals: await pickIds(() => prisma.accountingJournal.findMany({ where: { schoolId }, select: { id: true } })),
        accountingJournalLines: await pickIds(() => prisma.accountingJournalLine.findMany({
            where: { journal: { schoolId } },
            select: { id: true },
        })),
        payrollRuns: await pickIds(() => prisma.payrollRun.findMany({ where: { schoolId }, select: { id: true } })),
        payrollRunEmployees: await pickIds(() => prisma.payrollRunEmployee.findMany({
            where: { payrollRun: { schoolId } },
            select: { id: true },
        })),
        payrollItems: await pickIds(() => prisma.payrollItem.findMany({
            where: { payrollRunEmployee: { payrollRun: { schoolId } } },
            select: { id: true },
        })),
        payslips: await pickIds(() => prisma.payslip.findMany({ where: { schoolId }, select: { id: true } })),
        payrollSettings: await pickIds(() => prisma.payrollSetting.findMany({ where: { schoolId }, select: { id: true } })),
        payrollEmailLogs: await pickIds(() => prisma.payrollEmailLog.findMany({ where: { schoolId }, select: { id: true } })),
        letters: await pickIds(() => prisma.letter.findMany({ where: { schoolId }, select: { id: true } })),
        letterTemplates: await pickIds(() => prisma.letterTemplate.findMany({ where: { schoolId }, select: { id: true } })),
        learnerIncidents: await pickIds(() => prisma.learnerIncident.findMany({ where: { schoolId }, select: { id: true } })),
        learnerResults: await pickIds(() => prisma.learnerResult.findMany({ where: { schoolId }, select: { id: true } })),
        learnerReports: await pickIds(() => prisma.learnerReport.findMany({ where: { schoolId }, select: { id: true } })),
        homeworkPosts: await pickIds(() => prisma.homeworkPost.findMany({ where: { schoolId }, select: { id: true } })),
        schoolNotices: await pickIds(() => prisma.schoolNotice.findMany({ where: { schoolId }, select: { id: true } })),
        parentDocuments: await pickIds(() => prisma.parentDocument.findMany({ where: { schoolId }, select: { id: true } })),
        parentOnboardings: await pickIds(() => prisma.parentOnboarding.findMany({ where: { schoolId }, select: { id: true } })),
        parentOutreachQueue: await pickIds(() => prisma.parentOutreachQueue.findMany({ where: { schoolId }, select: { id: true } })),
        parentNotifications: await pickIds(() => prisma.parentNotification.findMany({ where: { schoolId }, select: { id: true } })),
        parentTeacherThreads: await pickIds(() => prisma.parentTeacherThread.findMany({ where: { schoolId }, select: { id: true } })),
        parentTeacherMessages: await pickIds(() => prisma.parentTeacherMessage.findMany({ where: { schoolId }, select: { id: true } })),
        communicationCampaigns: await pickIds(() => prisma.communicationCampaign.findMany({ where: { schoolId }, select: { id: true } })),
        communicationMessages: await pickIds(() => prisma.communicationMessage.findMany({ where: { schoolId }, select: { id: true } })),
        communicationRecipients: await pickIds(() => prisma.communicationRecipient.findMany({
            where: { message: { schoolId } },
            select: { id: true },
        })),
        communicationLogs: await pickIds(() => prisma.communicationLog.findMany({ where: { schoolId }, select: { id: true } })),
        communicationTemplates: await pickIds(() => prisma.communicationTemplate.findMany({ where: { schoolId }, select: { id: true } })),
        pushSubscriptions: await pickIds(() => prisma.pushSubscription.findMany({ where: { schoolId }, select: { id: true } })),
        schoolEmailSettings: await pickIds(() => prisma.schoolEmailSettings.findMany({ where: { schoolId }, select: { id: true } })),
        schoolCommunicationProfiles: await pickIds(() => prisma.schoolCommunicationProfile.findMany({ where: { schoolId }, select: { id: true } })),
        teacherPerformances: await pickIds(() => prisma.teacherPerformance.findMany({ where: { schoolId }, select: { id: true } })),
        schoolSubscriptions: await pickIds(() => prisma.schoolSubscription.findMany({ where: { schoolId }, select: { id: true } })),
        subscriptionInvoices: await pickIds(() => prisma.subscriptionInvoice.findMany({ where: { schoolId }, select: { id: true } })),
        subscriptionPaymentLogs: await pickIds(() => prisma.subscriptionPaymentLog.findMany({ where: { schoolId }, select: { id: true } })),
        creditPurchaseInvoices: await pickIds(() => prisma.creditPurchaseInvoice.findMany({ where: { schoolId }, select: { id: true } })),
        creditPurchasePaymentLogs: await pickIds(() => prisma.creditPurchasePaymentLog.findMany({ where: { schoolId }, select: { id: true } })),
        billingSettings: await pickIds(() => prisma.billingSettings.findMany({ where: { schoolId }, select: { id: true } })),
        feeStructures: await pickIds(() => prisma.feeStructure.findMany({ where: { schoolId }, select: { id: true } })),
        schoolFeeSettings: await pickIds(() => prisma.schoolFeeSetting.findMany({ where: { schoolId }, select: { id: true } })),
    };
    return ids;
}
async function purgeSubscriptionBilling(schoolId) {
    const removed = {};
    const run = async (key, fn) => {
        const r = await fn();
        bump(removed, key, r.count);
    };
    await run("subscriptionPaymentLog", () => prisma.subscriptionPaymentLog.deleteMany({ where: { schoolId } }));
    await run("subscriptionInvoice", () => prisma.subscriptionInvoice.deleteMany({ where: { schoolId } }));
    await run("schoolSubscription", () => prisma.schoolSubscription.deleteMany({ where: { schoolId } }));
    await run("creditPurchasePaymentLog", () => prisma.creditPurchasePaymentLog.deleteMany({ where: { schoolId } }));
    await run("creditPurchaseInvoice", () => prisma.creditPurchaseInvoice.deleteMany({ where: { schoolId } }));
    return removed;
}
function countStagingFiles(dir) {
    if (!fs_1.default.existsSync(dir))
        return 0;
    let n = 0;
    for (const entry of fs_1.default.readdirSync(dir, { withFileTypes: true })) {
        const full = path_1.default.join(dir, entry.name);
        n += entry.isDirectory() ? countStagingFiles(full) : 1;
    }
    return n;
}
function removeStagingDir(dir) {
    const files = countStagingFiles(dir);
    if (files && fs_1.default.existsSync(dir))
        fs_1.default.rmSync(dir, { recursive: true, force: true });
    return files;
}
function stageBelongsToSchool(stageId, schoolId) {
    const stage = (0, migrationStageStore_1.listStages)().find((s) => s.stageId === stageId);
    if (!stage)
        return false;
    return stage.files.some((f) => String(f.path || "").includes(schoolId));
}
function purgeMigrationFileArtifacts(scopeSchoolIds) {
    const removed = {};
    const idSet = new Set(scopeSchoolIds);
    const batches = (0, migrationImportBatchStore_1.listImportBatches)().filter((b) => idSet.has(String(b.targetSchoolId || "")));
    const stageIds = new Set();
    for (const batch of batches) {
        const batchPath = path_1.default.join(BATCHES_DIR, `${batch.batchId}.json`);
        if (fs_1.default.existsSync(batchPath)) {
            fs_1.default.unlinkSync(batchPath);
            bump(removed, "migrationImportBatches", 1);
        }
        const sid = String(batch.stageId || "").trim();
        if (sid)
            stageIds.add(sid);
    }
    for (const item of (0, migrationStageStore_1.listStages)()) {
        if (stageIds.has(item.stageId) || scopeSchoolIds.some((sid) => stageBelongsToSchool(item.stageId, sid))) {
            if ((0, migrationStageStore_1.deleteStage)(item.stageId))
                bump(removed, "migrationStages", 1);
        }
    }
    for (const pilot of (0, migrationPilotStore_1.listPilots)().filter((p) => idSet.has(String(p.schoolId || "")))) {
        const filePath = path_1.default.join(process.cwd(), "storage", "migration-pilots", `${pilot.pilotId}.json`);
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
            bump(removed, "migrationPilots", 1);
        }
    }
    for (const runbook of (0, migrationRunbookStore_1.listRunbooks)().filter((r) => idSet.has(String(r.schoolId || "")))) {
        const filePath = path_1.default.join(process.cwd(), "storage", "migration-runbooks", `${runbook.runbookId}.json`);
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
            bump(removed, "migrationRunbooks", 1);
        }
    }
    for (const pack of (0, migrationSignoffStore_1.listSignoffs)().filter((s) => idSet.has(String(s.schoolId || "")))) {
        const filePath = path_1.default.join(process.cwd(), "storage", "migration-signoffs", `${pack.signoffId}.json`);
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
            bump(removed, "migrationSignoffs", 1);
        }
    }
    for (const schoolId of scopeSchoolIds) {
        bump(removed, "migrationStagingUploadFiles", removeStagingDir(path_1.default.join(STAGING_UPLOAD_ROOT, schoolId)));
    }
    if (fs_1.default.existsSync(MIGRATION_STAGING_ROOT)) {
        for (const entry of fs_1.default.readdirSync(MIGRATION_STAGING_ROOT, { withFileTypes: true })) {
            const full = path_1.default.join(MIGRATION_STAGING_ROOT, entry.name);
            if (entry.isFile() && scopeSchoolIds.some((sid) => entry.name.includes(sid)) && fs_1.default.existsSync(full)) {
                fs_1.default.unlinkSync(full);
                bump(removed, "migrationStorageStagingFiles", 1);
            }
        }
    }
    return removed;
}
function formatPlan(plan) {
    const lines = [];
    lines.push("=== Da Silva Academy — SAFE FULL RESET ===");
    lines.push(`Mode: ${plan.confirm ? "CONFIRM (will delete)" : "DRY RUN (plan only)"}`);
    lines.push(`Generated: ${plan.generatedAt}`);
    if (plan.resolved.platformSchool) {
        lines.push(`Platform school (protected): ${plan.resolved.platformSchool.name} (${plan.resolved.platformSchool.id})`);
    }
    else {
        lines.push("Platform school (protected): (not found)");
    }
    lines.push("");
    lines.push("=== TARGET / SCOPE ===");
    lines.push(`Owner email: ${plan.resolved.ownerEmail}`);
    lines.push("Matched schools (initial resolution):");
    for (const s of plan.resolved.matchedSchools) {
        lines.push(`  - ${s.name} (${s.id}) email=${s.email ?? "(null)"} createdAt=${s.createdAt}`);
    }
    lines.push("Scope school rows to DELETE (all will be removed):");
    for (const s of plan.resolved.scopeSchoolRows) {
        lines.push(`  - ${s.name} (${s.id}) email=${s.email ?? "(null)"} createdAt=${s.createdAt}`);
    }
    lines.push("");
    lines.push("=== DELETION PLAN (what will be deleted) ===");
    lines.push("Prisma rows (by schoolId scope): users, roles, permissions, learners, parents, links, classrooms, accounts");
    lines.push("Billing / finance: deposits, banking imports/tx, suppliers/invoices/payments, accounting journals");
    lines.push("Parent portal + comms: threads/messages, notifications, onboarding/outreach, communication engine rows");
    lines.push("Payroll: employees, runs/items/payslips/settings/email logs");
    lines.push("School subscription billing: subscriptions, invoices, payment logs, credit purchase invoices/payments");
    lines.push("JSON stores: billing ledger, billing plans, Kid-e-Sys history, user-access, related audit/history stores");
    lines.push("Migration artifacts: batches/stages/pilots/runbooks/signoffs + uploads/staging files");
    lines.push("");
    lines.push("=== COUNTS (to be deleted) ===");
    lines.push(`Schools to delete: ${plan.counts.schoolsToDelete}`);
    lines.push("");
    lines.push("Prisma:");
    for (const [k, v] of Object.entries(plan.counts.prisma).sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`  ${k}: ${v}`);
    }
    lines.push("");
    lines.push("JSON stores:");
    for (const [k, v] of Object.entries(plan.counts.jsonStores).sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`  ${k}: ${v}`);
    }
    lines.push("");
    lines.push("JSON IDs (will be deleted):");
    lines.push(`  billing ledger entry ids: ${plan.json.ledgerEntryIds.length}`);
    lines.push(`  Kid-e-Sys history row ids: ${plan.json.kidesysHistoryRowIds.length}`);
    lines.push(`  billing plan learner ids: ${plan.json.billingPlanLearnerIds.length}`);
    lines.push(`  user-access user ids: ${plan.json.userAccessUserIds.length}`);
    lines.push("");
    lines.push("Migration artifacts:");
    for (const [k, v] of Object.entries(plan.counts.migrationArtifacts).sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`  ${k}: ${v}`);
    }
    lines.push("");
    lines.push("=== REQUIRED ===");
    lines.push("Re-run with --confirm to execute deletions.");
    return lines.join("\n");
}
async function buildPlan(cli) {
    const candidates = await resolveCandidateSchools(cli.schoolId);
    const scope = await resolveScopeSchools(candidates);
    const purgeScope = await (0, daSilvaEmptyState_1.buildDaSilvaPurgeScope)(prisma, scope.scopeSchoolRows[0]?.id || candidates[0].id);
    const prismaCounts = {};
    const allIds = {
        users: [],
        roles: [],
        rolePermissions: [],
        userPermissionOverrides: [],
        learners: [],
        parents: [],
        parentLearnerLinks: [],
        familyAccounts: [],
        classrooms: [],
        billingDeposits: [],
        bankStatementImports: [],
        bankTransactions: [],
        supplierInvoices: [],
        supplierInvoicePayments: [],
        supplierInvoiceLines: [],
        suppliers: [],
        expenseCategories: [],
        accountingJournals: [],
        accountingJournalLines: [],
        payrollRuns: [],
        payrollRunEmployees: [],
        payrollItems: [],
        payslips: [],
        payrollSettings: [],
        payrollEmailLogs: [],
        letters: [],
        letterTemplates: [],
        learnerIncidents: [],
        learnerResults: [],
        learnerReports: [],
        homeworkPosts: [],
        schoolNotices: [],
        parentDocuments: [],
        parentOnboardings: [],
        parentOutreachQueue: [],
        parentNotifications: [],
        parentTeacherThreads: [],
        parentTeacherMessages: [],
        communicationCampaigns: [],
        communicationMessages: [],
        communicationRecipients: [],
        communicationLogs: [],
        communicationTemplates: [],
        pushSubscriptions: [],
        schoolEmailSettings: [],
        schoolCommunicationProfiles: [],
        teacherPerformances: [],
        schoolSubscriptions: [],
        subscriptionInvoices: [],
        subscriptionPaymentLogs: [],
        creditPurchaseInvoices: [],
        creditPurchasePaymentLogs: [],
        billingSettings: [],
        feeStructures: [],
        schoolFeeSettings: [],
    };
    for (const s of scope.scopeSchoolRows) {
        const ids = await collectIdsForSchool(s.id);
        allIds.users.push(...ids.users);
        for (const key of Object.keys(allIds)) {
            if (key === "users")
                continue;
            // @ts-expect-error index
            allIds[key].push(...ids[key]);
        }
    }
    const countKey = (key, n) => {
        prismaCounts[key] = (prismaCounts[key] || 0) + n;
    };
    countKey("users", allIds.users.length);
    countKey("roles", allIds.roles.length);
    countKey("rolePermissions", allIds.rolePermissions.length);
    countKey("userPermissionOverrides", allIds.userPermissionOverrides.length);
    countKey("learners", allIds.learners.length);
    countKey("parents", allIds.parents.length);
    countKey("parentLearnerLinks", allIds.parentLearnerLinks.length);
    countKey("familyAccounts", allIds.familyAccounts.length);
    countKey("classrooms", allIds.classrooms.length);
    countKey("billingDeposits", allIds.billingDeposits.length);
    countKey("bankStatementImports", allIds.bankStatementImports.length);
    countKey("bankTransactions", allIds.bankTransactions.length);
    countKey("supplierInvoices", allIds.supplierInvoices.length);
    countKey("supplierInvoicePayments", allIds.supplierInvoicePayments.length);
    countKey("supplierInvoiceLines", allIds.supplierInvoiceLines.length);
    countKey("suppliers", allIds.suppliers.length);
    countKey("expenseCategories", allIds.expenseCategories.length);
    countKey("accountingJournals", allIds.accountingJournals.length);
    countKey("accountingJournalLines", allIds.accountingJournalLines.length);
    countKey("payrollRuns", allIds.payrollRuns.length);
    countKey("payrollRunEmployees", allIds.payrollRunEmployees.length);
    countKey("payrollItems", allIds.payrollItems.length);
    countKey("payslips", allIds.payslips.length);
    countKey("payrollSettings", allIds.payrollSettings.length);
    countKey("payrollEmailLogs", allIds.payrollEmailLogs.length);
    countKey("letters", allIds.letters.length);
    countKey("letterTemplates", allIds.letterTemplates.length);
    countKey("learnerIncidents", allIds.learnerIncidents.length);
    countKey("learnerResults", allIds.learnerResults.length);
    countKey("learnerReports", allIds.learnerReports.length);
    countKey("homeworkPosts", allIds.homeworkPosts.length);
    countKey("schoolNotices", allIds.schoolNotices.length);
    countKey("parentDocuments", allIds.parentDocuments.length);
    countKey("parentOnboardings", allIds.parentOnboardings.length);
    countKey("parentOutreachQueue", allIds.parentOutreachQueue.length);
    countKey("parentNotifications", allIds.parentNotifications.length);
    countKey("parentTeacherThreads", allIds.parentTeacherThreads.length);
    countKey("parentTeacherMessages", allIds.parentTeacherMessages.length);
    countKey("communicationCampaigns", allIds.communicationCampaigns.length);
    countKey("communicationMessages", allIds.communicationMessages.length);
    countKey("communicationRecipients", allIds.communicationRecipients.length);
    countKey("communicationLogs", allIds.communicationLogs.length);
    countKey("communicationTemplates", allIds.communicationTemplates.length);
    countKey("pushSubscriptions", allIds.pushSubscriptions.length);
    countKey("schoolEmailSettings", allIds.schoolEmailSettings.length);
    countKey("schoolCommunicationProfiles", allIds.schoolCommunicationProfiles.length);
    countKey("teacherPerformances", allIds.teacherPerformances.length);
    countKey("schoolSubscriptions", allIds.schoolSubscriptions.length);
    countKey("subscriptionInvoices", allIds.subscriptionInvoices.length);
    countKey("subscriptionPaymentLogs", allIds.subscriptionPaymentLogs.length);
    countKey("creditPurchaseInvoices", allIds.creditPurchaseInvoices.length);
    countKey("creditPurchasePaymentLogs", allIds.creditPurchasePaymentLogs.length);
    countKey("billingSettings", allIds.billingSettings.length);
    countKey("feeStructures", allIds.feeStructures.length);
    countKey("schoolFeeSettings", allIds.schoolFeeSettings.length);
    const migrationCounts = {};
    bump(migrationCounts, "migrationImportBatches", (0, migrationImportBatchStore_1.listImportBatches)().filter((b) => scope.scopeSchoolIds.includes(String(b.targetSchoolId || ""))).length);
    bump(migrationCounts, "migrationStages", (0, migrationStageStore_1.listStages)().filter((s) => scope.scopeSchoolIds.some((sid) => stageBelongsToSchool(s.stageId, sid))).length);
    bump(migrationCounts, "migrationPilots", (0, migrationPilotStore_1.listPilots)().filter((p) => scope.scopeSchoolIds.includes(String(p.schoolId || ""))).length);
    bump(migrationCounts, "migrationRunbooks", (0, migrationRunbookStore_1.listRunbooks)().filter((r) => scope.scopeSchoolIds.includes(String(r.schoolId || ""))).length);
    bump(migrationCounts, "migrationSignoffs", (0, migrationSignoffStore_1.listSignoffs)().filter((s) => scope.scopeSchoolIds.includes(String(s.schoolId || ""))).length);
    for (const sid of scope.scopeSchoolIds) {
        bump(migrationCounts, "migrationStagingUploadFiles", countStagingFiles(path_1.default.join(STAGING_UPLOAD_ROOT, sid)));
    }
    const jsonCounts = {};
    const ledgerEntryIds = [];
    const kidesysHistoryRowIds = [];
    const billingPlanLearnerIds = [];
    for (const sid of purgeScope.schoolIds) {
        for (const entry of (0, billingLedgerStore_1.readSchoolLedger)(sid)) {
            const id = String(entry.id || "").trim();
            if (id)
                ledgerEntryIds.push(id);
        }
        for (const row of (0, kidesysTransactionHistoryStore_1.readSchoolKidesysHistory)(sid)) {
            const id = String(row.id || "").trim();
            if (id)
                kidesysHistoryRowIds.push(id);
        }
        for (const learnerId of Object.keys((0, learnerBillingPlanStore_1.readSchoolBillingPlans)(sid))) {
            billingPlanLearnerIds.push(learnerId);
        }
    }
    // user-access.json stores a userId -> { schoolId } map (not necessarily Prisma User rows)
    const userAccessUserIds = [];
    const userAccessPath = path_1.default.join(DATA_DIR, "user-access.json");
    if (fs_1.default.existsSync(userAccessPath)) {
        const parsed = JSON.parse(fs_1.default.readFileSync(userAccessPath, "utf8"));
        const users = parsed.users || {};
        const schoolIdSet = new Set(purgeScope.schoolIds);
        for (const [uid, meta] of Object.entries(users)) {
            if (schoolIdSet.has(String(meta.schoolId || "").trim()))
                userAccessUserIds.push(uid);
        }
    }
    bump(jsonCounts, "billingLedgerEntries", ledgerEntryIds.length);
    bump(jsonCounts, "kidesysHistoryRows", kidesysHistoryRowIds.length);
    bump(jsonCounts, "learnerBillingPlanLearners", billingPlanLearnerIds.length);
    bump(jsonCounts, "userAccessRecords", userAccessUserIds.length);
    const generatedAt = new Date().toISOString();
    const plan = {
        generatedAt,
        confirm: cli.confirm,
        resolved: {
            platformSchool: scope.platform,
            ownerEmail: OWNER_EMAIL,
            matchedSchools: scope.matched.map((s) => ({
                id: s.id,
                name: s.name,
                email: s.email,
                createdAt: s.createdAt.toISOString(),
            })),
            scopeSchoolIds: scope.scopeSchoolIds,
            scopeSchoolRows: scope.scopeSchoolRows.map((s) => ({
                id: s.id,
                name: s.name,
                email: s.email,
                createdAt: s.createdAt.toISOString(),
            })),
            canonicalJsonSchoolIds: scope.canonicalJsonSchoolIds,
        },
        json: {
            ledgerEntryIds,
            kidesysHistoryRowIds,
            billingPlanLearnerIds,
            userAccessUserIds,
        },
        ids: allIds,
        counts: {
            schoolsToDelete: scope.scopeSchoolRows.length,
            prisma: prismaCounts,
            jsonStores: jsonCounts,
            migrationArtifacts: migrationCounts,
        },
    };
    const dir = path_1.default.join(process.cwd(), "uploads", "reset-backups");
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
    const ts = generatedAt.replace(/[:.]/g, "-");
    const backupPath = path_1.default.join(dir, `da-silva-reset-${ts}.json`);
    fs_1.default.writeFileSync(backupPath, JSON.stringify(plan, null, 2), "utf8");
    return { plan, backupPath };
}
async function verifyAfter(scopeSchoolRowIds) {
    const issues = [];
    const platform = await prisma.school.findFirst({
        where: { name: { equals: PLATFORM_SCHOOL_NAME, mode: "insensitive" } },
        select: { id: true, name: true },
    });
    if (!platform)
        issues.push(`EduClear Platform school missing (${PLATFORM_SCHOOL_NAME})`);
    const daSilvaSchools = await prisma.school.findMany({
        where: {
            OR: [
                { name: { contains: "Da Silva", mode: "insensitive" } },
                { email: { equals: OWNER_EMAIL, mode: "insensitive" } },
            ],
        },
        select: { id: true, name: true },
    });
    if (daSilvaSchools.length) {
        issues.push(`Da Silva school rows still exist: ${daSilvaSchools.map((s) => `${s.name} (${s.id})`).join(", ")}`);
    }
    const ownerUser = await prisma.user.findFirst({
        where: { email: { equals: OWNER_EMAIL, mode: "insensitive" } },
        select: { id: true, schoolId: true },
    });
    if (ownerUser)
        issues.push(`Owner user still exists: ${OWNER_EMAIL} (${ownerUser.id})`);
    // Ensure no rows remain for deleted school ids.
    const checkCount = async (label, n) => {
        if (n !== 0)
            issues.push(`${label} remaining for deleted school(s): ${n}`);
    };
    await checkCount("learners", await prisma.learner.count({ where: { schoolId: { in: scopeSchoolRowIds } } }));
    await checkCount("parents", await prisma.parent.count({ where: { schoolId: { in: scopeSchoolRowIds } } }));
    await checkCount("family accounts", await prisma.familyAccount.count({ where: { schoolId: { in: scopeSchoolRowIds } } }));
    await checkCount("classrooms", await prisma.classroom.count({ where: { schoolId: { in: scopeSchoolRowIds } } }));
    return { passed: issues.length === 0, issues };
}
async function main() {
    const cli = parseCli();
    const { plan, backupPath } = await buildPlan(cli);
    console.log(formatPlan(plan));
    console.log(`\nBackup path: ${backupPath}`);
    if (!cli.confirm) {
        console.log("\nNo --confirm flag provided. Plan only — nothing deleted.");
        return;
    }
    // Re-resolve scope (do not trust plan-only state)
    const candidates = await resolveCandidateSchools(cli.schoolId);
    const scope = await resolveScopeSchools(candidates);
    const scopeSchoolRowIds = scope.scopeSchoolRows.map((s) => s.id);
    // Safety: ensure owner email isn't attached to some other school outside scope (avoid global delete).
    const ownerUsers = await prisma.user.findMany({
        where: { email: { equals: OWNER_EMAIL, mode: "insensitive" } },
        select: { id: true, schoolId: true, school: { select: { name: true } } },
    });
    const outOfScope = ownerUsers.filter((u) => !scopeSchoolRowIds.includes(u.schoolId));
    if (outOfScope.length) {
        throw new Error(`Refusing: ${OWNER_EMAIL} exists under a different school outside scope: ${outOfScope
            .map((u) => `${u.schoolId} (${u.school?.name || "unknown"})`)
            .join(", ")}`);
    }
    console.log("\n=== EXECUTING DELETE (confirm) ===");
    const removed = { prisma: {}, subscription: {}, migration: {}, json: {} };
    const purgeScope = await (0, daSilvaEmptyState_1.buildDaSilvaPurgeScope)(prisma, scopeSchoolRowIds[0]);
    for (const school of scope.scopeSchoolRows) {
        console.log(`\nDeleting school: ${school.name} (${school.id})`);
        const subscriptionRemoved = await purgeSubscriptionBilling(school.id);
        for (const [k, v] of Object.entries(subscriptionRemoved))
            bump(removed.subscription, k, v);
        // Purge school-scoped Prisma data (includes learners/parents/classrooms/accounts/journals/etc.)
        const purged = await (0, school_data_cleanup_1.purgeImportedSchoolData)(school.id);
        for (const [k, v] of Object.entries(purged))
            bump(removed.prisma, k, v);
        const usersDeleted = await (0, school_data_cleanup_1.deleteSchoolUsers)(school.id);
        bump(removed.prisma, "user", usersDeleted);
        const rolesDeleted = await (0, school_data_cleanup_1.deleteSchoolRoles)(school.id);
        bump(removed.prisma, "schoolRole", rolesDeleted);
        try {
            await prisma.school.delete({ where: { id: school.id } });
            bump(removed.prisma, "school", 1);
        }
        catch (e) {
            throw new Error(`Failed to delete school row ${school.id} (${school.name}). ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    const migrationRemoved = purgeMigrationFileArtifacts(scope.scopeSchoolIds);
    for (const [k, v] of Object.entries(migrationRemoved))
        bump(removed.migration, k, v);
    const jsonRemoved = (0, daSilvaEmptyState_1.purgeDaSilvaJsonStores)(purgeScope);
    for (const [k, v] of Object.entries(jsonRemoved))
        bump(removed.json, k, v);
    const verification = await verifyAfter(scopeSchoolRowIds);
    console.log("\n=== RESULT ===");
    console.log(`Backup path: ${backupPath}`);
    console.log(`Deleted school rows: ${scopeSchoolRowIds.join(", ")}`);
    console.log(`Deleted user email: ${OWNER_EMAIL} (${ownerUsers.map((u) => u.id).join(", ") || "none"})`);
    console.log(`Deleted learners: ${removed.prisma.learner || 0}`);
    console.log(`Deleted parents: ${removed.prisma.parent || 0}`);
    console.log(`Deleted accounts: ${removed.prisma.familyAccount || 0}`);
    console.log(`Deleted billing/history (JSON): ledger=${removed.json.billingLedgerEntries || 0}, plans=${removed.json.learnerBillingPlanLearners || 0}, history=${removed.json.kidesysHistoryRows || 0}`);
    console.log(`Verification: ${verification.passed ? "PASS" : "FAIL"}`);
    if (!verification.passed) {
        for (const issue of verification.issues)
            console.log(`  - ${issue}`);
        process.exit(2);
    }
}
main()
    .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
