"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * SAFE full reset — Da Silva Academy migration / import data only.
 *
 * Preserves: School row, users, roles/permissions, billing/fee settings, classrooms.
 * Removes: learners, parents, links, family accounts, migration ledger/history/plans,
 *          employees (migration), universal migration batches/stages/artifacts.
 *
 * Usage:
 *   npx tsx scripts/reset-da-silva-migration.ts           # dry-run (before counts + plan)
 *   npx tsx scripts/reset-da-silva-migration.ts --apply    # prompts for confirmation phrase
 */
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const readline_1 = __importDefault(require("readline"));
const client_1 = require("@prisma/client");
const activateDaSilvaSubscription_1 = require("../src/services/activateDaSilvaSubscription");
const migrationImportBatchStore_1 = require("../src/services/migration/core/migrationImportBatchStore");
const migrationPilotStore_1 = require("../src/services/migration/core/migrationPilotStore");
const migrationRunbookStore_1 = require("../src/services/migration/core/migrationRunbookStore");
const migrationSignoffStore_1 = require("../src/services/migration/core/migrationSignoffStore");
const migrationStageStore_1 = require("../src/services/migration/staging/migrationStageStore");
const billingDisplayRules_1 = require("../src/utils/billingDisplayRules");
const billingLedgerStore_1 = require("../src/utils/billingLedgerStore");
const kidesysTransactionHistoryStore_1 = require("../src/utils/kidesysTransactionHistoryStore");
const learnerBillingPlanStore_1 = require("../src/utils/learnerBillingPlanStore");
const prisma = new client_1.PrismaClient();
const TARGET_SCHOOL_ID = activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID;
const CONFIRMATION_PHRASE = activateDaSilvaSubscription_1.DA_SILVA_SCHOOL_NAME;
const PLATFORM_SCHOOL_NAME = "EduClear Platform";
const APPLY = process.argv.includes("--apply");
const UNIVERSAL_MIGRATION_LEDGER_SOURCES = new Set([
    "universal_migration_phase14",
    "universal_migration_reversal_phase15",
]);
const DATA_DIR = path_1.default.join(process.cwd(), "data");
const STAGING_UPLOAD_ROOT = path_1.default.join(process.cwd(), "uploads", "migration-staging");
const BATCHES_DIR = path_1.default.join(process.cwd(), "storage", "migration-import-batches");
const TX_OPTIONS = { maxWait: 60000, timeout: 300000 };
function bump(map, key, n) {
    if (n > 0)
        map[key] = (map[key] || 0) + n;
}
function isMigrationLedgerEntry(entry) {
    if ((0, billingDisplayRules_1.isImportedBillingLedgerEntry)(entry))
        return true;
    if ((0, billingDisplayRules_1.isKidesysOpeningBalanceEntry)(entry))
        return true;
    const source = String(entry.source || "").trim();
    if (UNIVERSAL_MIGRATION_LEDGER_SOURCES.has(source))
        return true;
    const id = String(entry.id || "").trim();
    if (id.startsWith("umig-tx-") || id.startsWith("umig-rev-"))
        return true;
    const ref = String(entry.reference || "").trim();
    if (ref.startsWith("KIDESYS-") || ref.startsWith("kidesys-opening-"))
        return true;
    return false;
}
function stageBelongsToSchool(stageId, schoolId) {
    const stage = (0, migrationStageStore_1.getStage)(stageId);
    if (!stage)
        return false;
    return stage.files.some((f) => String(f.path || "").includes(schoolId));
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
    if (files && fs_1.default.existsSync(dir)) {
        fs_1.default.rmSync(dir, { recursive: true, force: true });
    }
    return files;
}
function clearJsonSchoolKey(fileName, schoolId) {
    const filePath = path_1.default.join(DATA_DIR, fileName);
    if (!fs_1.default.existsSync(filePath))
        return 0;
    const parsed = JSON.parse(fs_1.default.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return 0;
    const obj = parsed;
    const keys = Object.keys(obj).filter((k) => k === schoolId);
    if (!keys.length)
        return 0;
    let removed = 0;
    for (const key of keys) {
        const value = obj[key];
        if (Array.isArray(value))
            removed += value.length;
        else if (value && typeof value === "object")
            removed += Object.keys(value).length;
        else
            removed += 1;
        delete obj[key];
    }
    fs_1.default.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
    return removed;
}
function filterBankingImportsForSchool(schoolId) {
    const filePath = path_1.default.join(DATA_DIR, "banking-imports.json");
    if (!fs_1.default.existsSync(filePath))
        return 0;
    const parsed = JSON.parse(fs_1.default.readFileSync(filePath, "utf8"));
    const imports = parsed.imports || [];
    const before = imports.length;
    parsed.imports = imports.filter((r) => String(r.schoolId || "") !== schoolId);
    const removed = before - parsed.imports.length;
    if (removed) {
        fs_1.default.writeFileSync(filePath, JSON.stringify(parsed, null, 2), "utf8");
    }
    return removed;
}
async function assertTargetSchool() {
    const school = await prisma.school.findUnique({
        where: { id: TARGET_SCHOOL_ID },
        select: { id: true, name: true },
    });
    if (!school) {
        throw new Error(`School not found at id ${TARGET_SCHOOL_ID}. Refusing — no global deletes.`);
    }
    if (!/da\s*silva\s*academy/i.test(school.name.trim())) {
        throw new Error(`School name "${school.name}" does not match ${CONFIRMATION_PHRASE}. Refusing.`);
    }
    const platform = await prisma.school.findFirst({
        where: { name: { equals: PLATFORM_SCHOOL_NAME, mode: "insensitive" } },
        select: { id: true },
    });
    if (platform?.id === school.id) {
        throw new Error(`Refusing: target id is the ${PLATFORM_SCHOOL_NAME} school`);
    }
    return school;
}
async function collectCounts(schoolId) {
    const school = await prisma.school.findUnique({
        where: { id: schoolId },
        select: { id: true, name: true },
    });
    if (!school)
        throw new Error(`School missing: ${schoolId}`);
    const prismaCounts = {};
    const add = async (key, fn) => {
        prismaCounts[key] = await fn();
    };
    await add("user", () => prisma.user.count({ where: { schoolId } }));
    await add("schoolRole", () => prisma.schoolRole.count({ where: { schoolId } }));
    await add("rolePermission", () => prisma.rolePermission.count({ where: { role: { schoolId } } }));
    await add("billingSettings", () => prisma.billingSettings.count({ where: { schoolId } }));
    await add("feeStructure", () => prisma.feeStructure.count({ where: { schoolId } }));
    await add("schoolFeeSetting", () => prisma.schoolFeeSetting.count({ where: { schoolId } }));
    await add("classroom", () => prisma.classroom.count({ where: { schoolId } }));
    await add("learner", () => prisma.learner.count({ where: { schoolId } }));
    await add("parent", () => prisma.parent.count({ where: { schoolId } }));
    await add("parentLearnerLink", () => prisma.parentLearnerLink.count({ where: { schoolId } }));
    await add("familyAccount", () => prisma.familyAccount.count({ where: { schoolId } }));
    await add("employee", () => prisma.employee.count({ where: { schoolId } }));
    await add("learnerHistorical", () => prisma.learner.count({ where: { schoolId, enrollmentStatus: "HISTORICAL" } }));
    const ledger = (0, billingLedgerStore_1.readSchoolLedger)(schoolId);
    const migrationLedger = ledger.filter(isMigrationLedgerEntry);
    const plans = (0, learnerBillingPlanStore_1.readSchoolBillingPlans)(schoolId);
    const history = (0, kidesysTransactionHistoryStore_1.readSchoolKidesysHistory)(schoolId);
    const batches = (0, migrationImportBatchStore_1.listImportBatches)().filter((b) => b.targetSchoolId === schoolId);
    const stageIdsFromBatches = new Set(batches.map((b) => String(b.stageId || "").trim()).filter(Boolean));
    const stagesForSchool = (0, migrationStageStore_1.listStages)().filter((s) => stageIdsFromBatches.has(s.stageId) || stageBelongsToSchool(s.stageId, schoolId));
    const pilots = (0, migrationPilotStore_1.listPilots)().filter((p) => p.schoolId === schoolId);
    const runbooks = (0, migrationRunbookStore_1.listRunbooks)().filter((r) => r.schoolId === schoolId);
    const signoffs = (0, migrationSignoffStore_1.listSignoffs)().filter((s) => s.schoolId === schoolId);
    const stagingDir = path_1.default.join(STAGING_UPLOAD_ROOT, schoolId);
    const jsonCounts = {
        billingLedgerTotal: ledger.length,
        billingLedgerMigration: migrationLedger.length,
        billingLedgerNonMigration: ledger.length - migrationLedger.length,
        learnerBillingPlanLearners: Object.keys(plans).length,
        kidesysHistoryRows: history.length,
    };
    const fileCounts = {
        migrationImportBatches: batches.length,
        migrationStages: stagesForSchool.length,
        migrationPilots: pilots.length,
        migrationRunbooks: runbooks.length,
        migrationSignoffs: signoffs.length,
        migrationStagingFiles: countStagingFiles(stagingDir),
    };
    return {
        school: { id: school.id, name: school.name },
        prisma: prismaCounts,
        json: jsonCounts,
        files: fileCounts,
    };
}
async function purgePrismaMigrationData(schoolId, tx) {
    const removed = {};
    const run = async (key, fn) => {
        const r = await fn();
        bump(removed, key, r.count);
    };
    await run("letter", () => tx.letter.deleteMany({ where: { schoolId } }));
    await run("parentTeacherMessage", () => tx.parentTeacherMessage.deleteMany({ where: { schoolId } }));
    await run("parentTeacherThread", () => tx.parentTeacherThread.deleteMany({ where: { schoolId } }));
    await run("parentLearnerLink", () => tx.parentLearnerLink.deleteMany({ where: { schoolId } }));
    await run("learnerIncident", () => tx.learnerIncident.deleteMany({ where: { schoolId } }));
    await run("learnerResult", () => tx.learnerResult.deleteMany({ where: { schoolId } }));
    await run("learnerReport", () => tx.learnerReport.deleteMany({ where: { schoolId } }));
    await run("billingDepositAllocation", () => tx.billingDepositAllocation.deleteMany({ where: { deposit: { schoolId } } }));
    await run("billingDepositHistoryEntry", () => tx.billingDepositHistoryEntry.deleteMany({ where: { deposit: { schoolId } } }));
    await run("billingDeposit", () => tx.billingDeposit.deleteMany({ where: { schoolId } }));
    await run("homeworkPost", () => tx.homeworkPost.deleteMany({ where: { schoolId } }));
    await run("schoolNotice", () => tx.schoolNotice.deleteMany({ where: { schoolId } }));
    await run("parentDocument", () => tx.parentDocument.deleteMany({ where: { schoolId } }));
    await run("parentNotification", () => tx.parentNotification.deleteMany({ where: { schoolId } }));
    await run("parentOnboarding", () => tx.parentOnboarding.deleteMany({ where: { schoolId } }));
    await run("parentOutreachQueue", () => tx.parentOutreachQueue.deleteMany({ where: { schoolId } }));
    await run("pushSubscription", () => tx.pushSubscription.deleteMany({ where: { schoolId } }));
    await run("learner", () => tx.learner.deleteMany({ where: { schoolId } }));
    await run("parent", () => tx.parent.deleteMany({ where: { schoolId } }));
    await run("familyAccount", () => tx.familyAccount.deleteMany({ where: { schoolId } }));
    await run("payslip", () => tx.payslip.deleteMany({ where: { schoolId } }));
    await run("payrollEmailLog", () => tx.payrollEmailLog.deleteMany({ where: { schoolId } }));
    await run("payrollItem", () => tx.payrollItem.deleteMany({
        where: { payrollRunEmployee: { payrollRun: { schoolId } } },
    }));
    await run("payrollRunEmployee", () => tx.payrollRunEmployee.deleteMany({ where: { payrollRun: { schoolId } } }));
    await run("payrollRun", () => tx.payrollRun.deleteMany({ where: { schoolId } }));
    await run("employee", () => tx.employee.deleteMany({ where: { schoolId } }));
    return removed;
}
function purgeJsonMigrationStores(schoolId) {
    const removed = {};
    const ledger = (0, billingLedgerStore_1.readSchoolLedger)(schoolId);
    const kept = ledger.filter((e) => !isMigrationLedgerEntry(e));
    const ledgerRemoved = ledger.length - kept.length;
    if (ledgerRemoved > 0 || kept.length !== ledger.length) {
        (0, billingLedgerStore_1.writeSchoolLedger)(schoolId, kept);
    }
    bump(removed, "billingLedgerMigrationEntries", ledgerRemoved);
    const plans = (0, learnerBillingPlanStore_1.readSchoolBillingPlans)(schoolId);
    const planLearners = Object.keys(plans).length;
    if (planLearners > 0) {
        const filePath = path_1.default.join(DATA_DIR, "learner-billing-plans.json");
        if (fs_1.default.existsSync(filePath)) {
            const all = JSON.parse(fs_1.default.readFileSync(filePath, "utf8"));
            delete all[schoolId];
            fs_1.default.writeFileSync(filePath, JSON.stringify(all, null, 2), "utf8");
        }
    }
    bump(removed, "learnerBillingPlanLearners", planLearners);
    const history = (0, kidesysTransactionHistoryStore_1.readSchoolKidesysHistory)(schoolId);
    if (history.length) {
        (0, kidesysTransactionHistoryStore_1.writeSchoolKidesysHistory)(schoolId, []);
    }
    bump(removed, "kidesysHistoryRows", history.length);
    bump(removed, "familyAccountAuditRows", clearJsonSchoolKey("family-account-audit.json", schoolId));
    bump(removed, "bankingImports", filterBankingImportsForSchool(schoolId));
    return removed;
}
function purgeMigrationFileArtifacts(schoolId) {
    const removed = {};
    const batches = (0, migrationImportBatchStore_1.listImportBatches)().filter((b) => b.targetSchoolId === schoolId);
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
        if (stageIds.has(item.stageId) || stageBelongsToSchool(item.stageId, schoolId)) {
            if ((0, migrationStageStore_1.deleteStage)(item.stageId))
                bump(removed, "migrationStages", 1);
        }
    }
    for (const pilot of (0, migrationPilotStore_1.listPilots)().filter((p) => p.schoolId === schoolId)) {
        const filePath = path_1.default.join(process.cwd(), "storage", "migration-pilots", `${pilot.pilotId}.json`);
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
            bump(removed, "migrationPilots", 1);
        }
    }
    for (const runbook of (0, migrationRunbookStore_1.listRunbooks)().filter((r) => r.schoolId === schoolId)) {
        const filePath = path_1.default.join(process.cwd(), "storage", "migration-runbooks", `${runbook.runbookId}.json`);
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
            bump(removed, "migrationRunbooks", 1);
        }
    }
    for (const pack of (0, migrationSignoffStore_1.listSignoffs)().filter((s) => s.schoolId === schoolId)) {
        const filePath = path_1.default.join(process.cwd(), "storage", "migration-signoffs", `${pack.signoffId}.json`);
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
            bump(removed, "migrationSignoffs", 1);
        }
    }
    const stagingDir = path_1.default.join(STAGING_UPLOAD_ROOT, schoolId);
    bump(removed, "migrationStagingFiles", removeStagingDir(stagingDir));
    return removed;
}
function printCounts(label, counts) {
    console.log(`\n=== ${label} ===`);
    console.log(`School: ${counts.school.name} (${counts.school.id})`);
    console.log("\nPrisma:");
    for (const [k, v] of Object.entries(counts.prisma).sort(([a], [b]) => a.localeCompare(b))) {
        console.log(`  ${k}: ${v}`);
    }
    console.log("\nJSON stores:");
    for (const [k, v] of Object.entries(counts.json).sort(([a], [b]) => a.localeCompare(b))) {
        console.log(`  ${k}: ${v}`);
    }
    console.log("\nFile artifacts:");
    for (const [k, v] of Object.entries(counts.files).sort(([a], [b]) => a.localeCompare(b))) {
        console.log(`  ${k}: ${v}`);
    }
}
function printRemoved(summary) {
    console.log("\n=== REMOVED ===");
    const sections = [
        ["Prisma", summary.prisma],
        ["JSON", summary.json],
        ["Files", summary.files],
    ];
    for (const [title, map] of sections) {
        const entries = Object.entries(map).filter(([, n]) => n > 0);
        if (!entries.length)
            continue;
        console.log(`\n${title}:`);
        for (const [k, v] of entries.sort(([a], [b]) => a.localeCompare(b))) {
            console.log(`  ${k}: ${v}`);
        }
    }
}
function expectedAfterReset() {
    return {
        learner: 0,
        parent: 0,
        parentLearnerLink: 0,
        familyAccount: 0,
        employee: 0,
        learnerHistorical: 0,
        billingLedgerMigration: 0,
        learnerBillingPlanLearners: 0,
        kidesysHistoryRows: 0,
        migrationImportBatches: 0,
        migrationStages: 0,
        migrationPilots: 0,
        migrationRunbooks: 0,
        migrationSignoffs: 0,
        migrationStagingFiles: 0,
        note: "users, roles, billingSettings, feeStructure, schoolFeeSetting, classroom — unchanged",
    };
}
async function promptConfirmation() {
    const rl = readline_1.default.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    const answer = await new Promise((resolve) => {
        rl.question(`\nType the confirmation phrase exactly (${CONFIRMATION_PHRASE}): `, (line) => {
            rl.close();
            resolve(line);
        });
    });
    return answer.trim() === CONFIRMATION_PHRASE;
}
async function main() {
    const school = await assertTargetSchool();
    const schoolId = school.id;
    const before = await collectCounts(schoolId);
    printCounts("BEFORE", before);
    if (!APPLY) {
        console.log("\nDry-run only. Re-run with --apply to execute reset.");
        console.log("\nExpected AFTER (migration blank slate):");
        console.log(JSON.stringify(expectedAfterReset(), null, 2));
        return;
    }
    const confirmed = await promptConfirmation();
    if (!confirmed) {
        console.error("\nAborted: confirmation phrase did not match.");
        process.exit(1);
    }
    console.log("\nExecuting reset…");
    const prismaRemoved = await prisma.$transaction(async (tx) => purgePrismaMigrationData(schoolId, tx), TX_OPTIONS);
    const jsonRemoved = purgeJsonMigrationStores(schoolId);
    const filesRemoved = purgeMigrationFileArtifacts(schoolId);
    const after = await collectCounts(schoolId);
    printCounts("AFTER", after);
    printRemoved({ prisma: prismaRemoved, json: jsonRemoved, files: filesRemoved });
    console.log("\nExpected AFTER (migration blank slate):");
    console.log(JSON.stringify(expectedAfterReset(), null, 2));
    const blockers = [];
    if (after.prisma.learner !== 0)
        blockers.push(`learners remaining: ${after.prisma.learner}`);
    if (after.prisma.parent !== 0)
        blockers.push(`parents remaining: ${after.prisma.parent}`);
    if (after.json.billingLedgerMigration !== 0) {
        blockers.push(`migration ledger rows remaining: ${after.json.billingLedgerMigration}`);
    }
    if (after.json.kidesysHistoryRows !== 0) {
        blockers.push(`Kid-e-Sys history rows remaining: ${after.json.kidesysHistoryRows}`);
    }
    if (after.files.migrationImportBatches !== 0) {
        blockers.push(`import batches remaining: ${after.files.migrationImportBatches}`);
    }
    if (blockers.length) {
        console.error("\nWARNING: reset incomplete:");
        for (const b of blockers)
            console.error(`  - ${b}`);
        process.exit(2);
    }
    console.log("\nDa Silva migration reset complete — school preserved, migration data cleared.");
}
main()
    .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
