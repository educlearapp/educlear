"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.purgeImportedSchoolData = purgeImportedSchoolData;
exports.deleteSchoolUsers = deleteSchoolUsers;
exports.deleteSchoolRoles = deleteSchoolRoles;
exports.clearJsonStoresForSchools = clearJsonStoresForSchools;
exports.clearStagingForSchools = clearStagingForSchools;
/**
 * Targeted school cleanup for demo/test removal and Da Silva re-import prep.
 *
 * Usage:
 *   npx tsx scripts/school-data-cleanup.ts              # dry-run (default)
 *   npx tsx scripts/school-data-cleanup.ts --apply      # execute deletions
 *
 * Env (apply only, Da Silva owner):
 *   DA_SILVA_OWNER_PASSWORD — required to create dasilvaacademy@gmail.com if missing
 */
require("dotenv/config");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const ownerProvisioning_1 = require("../src/utils/ownerProvisioning");
const userAccessStore_1 = require("../src/utils/userAccessStore");
const prisma = new client_1.PrismaClient();
const APPLY = process.argv.includes("--apply");
const PLATFORM_SCHOOL_NAME = "EduClear Platform";
const DA_SILVA_OWNER_EMAIL = "dasilvaacademy@gmail.com";
const DEMO_SCHOOL_NAME_PATTERNS = [
    /^educlear test school$/i,
    /^auth test school$/i,
];
const DATA_DIR = path_1.default.join(process.cwd(), "data");
const STAGING_ROOT = path_1.default.join(process.cwd(), "uploads", "migration-staging");
const JSON_STORE_FILES = [
    "billing-ledger.json",
    "learner-billing-plans.json",
    "kidesys-transaction-history.json",
    "user-access.json",
    "family-account-audit.json",
    "banking-imports.json",
    "communication-store.json",
    "legal-document-history.json",
];
function isDemoSchool(name) {
    return DEMO_SCHOOL_NAME_PATTERNS.some((re) => re.test(name.trim()));
}
function isDaSilvaSchool(name) {
    return /da silva academy/i.test(name.trim());
}
function isProtectedPlatform(name) {
    return name.trim().toLowerCase() === PLATFORM_SCHOOL_NAME.toLowerCase();
}
async function countSchoolPrismaRows(schoolId) {
    const counts = {};
    const add = async (key, fn) => {
        counts[key] = await fn();
    };
    await add("user", () => prisma.user.count({ where: { schoolId } }));
    await add("userPermissionOverride", () => prisma.userPermissionOverride.count({ where: { user: { schoolId } } }));
    await add("schoolRole", () => prisma.schoolRole.count({ where: { schoolId } }));
    await add("rolePermission", () => prisma.rolePermission.count({ where: { role: { schoolId } } }));
    await add("parentLearnerLink", () => prisma.parentLearnerLink.count({ where: { schoolId } }));
    await add("parentTeacherThread", () => prisma.parentTeacherThread.count({ where: { schoolId } }));
    await add("parentTeacherMessage", () => prisma.parentTeacherMessage.count({ where: { schoolId } }));
    await add("learner", () => prisma.learner.count({ where: { schoolId } }));
    await add("parent", () => prisma.parent.count({ where: { schoolId } }));
    await add("familyAccount", () => prisma.familyAccount.count({ where: { schoolId } }));
    await add("classroom", () => prisma.classroom.count({ where: { schoolId } }));
    await add("employee", () => prisma.employee.count({ where: { schoolId } }));
    await add("feeStructure", () => prisma.feeStructure.count({ where: { schoolId } }));
    await add("schoolFeeSetting", () => prisma.schoolFeeSetting.count({ where: { schoolId } }));
    await add("letter", () => prisma.letter.count({ where: { schoolId } }));
    await add("letterTemplate", () => prisma.letterTemplate.count({ where: { schoolId } }));
    await add("learnerIncident", () => prisma.learnerIncident.count({ where: { schoolId } }));
    await add("learnerResult", () => prisma.learnerResult.count({ where: { schoolId } }));
    await add("learnerReport", () => prisma.learnerReport.count({ where: { schoolId } }));
    await add("billingDeposit", () => prisma.billingDeposit.count({ where: { schoolId } }));
    await add("bankStatementImport", () => prisma.bankStatementImport.count({ where: { schoolId } }));
    await add("bankTransaction", () => prisma.bankTransaction.count({ where: { schoolId } }));
    await add("billingSettings", () => prisma.billingSettings.count({ where: { schoolId } }));
    await add("supplier", () => prisma.supplier.count({ where: { schoolId } }));
    await add("supplierInvoice", () => prisma.supplierInvoice.count({ where: { schoolId } }));
    await add("expenseCategory", () => prisma.expenseCategory.count({ where: { schoolId } }));
    await add("accountingJournal", () => prisma.accountingJournal.count({ where: { schoolId } }));
    await add("payrollRun", () => prisma.payrollRun.count({ where: { schoolId } }));
    await add("payslip", () => prisma.payslip.count({ where: { schoolId } }));
    await add("payrollSetting", () => prisma.payrollSetting.count({ where: { schoolId } }));
    await add("teacherPerformance", () => prisma.teacherPerformance.count({ where: { schoolId } }));
    await add("homeworkPost", () => prisma.homeworkPost.count({ where: { schoolId } }));
    await add("schoolNotice", () => prisma.schoolNotice.count({ where: { schoolId } }));
    await add("parentDocument", () => prisma.parentDocument.count({ where: { schoolId } }));
    await add("parentOnboarding", () => prisma.parentOnboarding.count({ where: { schoolId } }));
    await add("parentOutreachQueue", () => prisma.parentOutreachQueue.count({ where: { schoolId } }));
    await add("parentNotification", () => prisma.parentNotification.count({ where: { schoolId } }));
    await add("communicationMessage", () => prisma.communicationMessage.count({ where: { schoolId } }));
    await add("communicationCampaign", () => prisma.communicationCampaign.count({ where: { schoolId } }));
    await add("communicationTemplate", () => prisma.communicationTemplate.count({ where: { schoolId } }));
    await add("communicationLog", () => prisma.communicationLog.count({ where: { schoolId } }));
    await add("pushSubscription", () => prisma.pushSubscription.count({ where: { schoolId } }));
    await add("schoolEmailSettings", () => prisma.schoolEmailSettings.count({ where: { schoolId } }));
    await add("schoolCommunicationProfile", () => prisma.schoolCommunicationProfile.count({ where: { schoolId } }));
    return counts;
}
function sumCounts(counts) {
    return Object.values(counts).reduce((s, n) => s + n, 0);
}
function scanJsonStoreImpact(schoolIds) {
    const impacts = [];
    const idSet = new Set(schoolIds);
    for (const file of JSON_STORE_FILES) {
        const filePath = path_1.default.join(DATA_DIR, file);
        if (!fs_1.default.existsSync(filePath)) {
            impacts.push({ file, action: "skip", detail: "file not found" });
            continue;
        }
        const raw = fs_1.default.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (file === "billing-ledger.json" && parsed && typeof parsed === "object") {
            for (const sid of schoolIds) {
                const entries = parsed[sid];
                if (Array.isArray(entries) && entries.length) {
                    impacts.push({
                        file,
                        action: "remove school key",
                        detail: `${sid}: ${entries.length} ledger entries`,
                    });
                }
            }
            continue;
        }
        if (file === "learner-billing-plans.json" && parsed && typeof parsed === "object") {
            for (const sid of schoolIds) {
                const plans = parsed[sid];
                if (plans && Object.keys(plans).length) {
                    impacts.push({
                        file,
                        action: "remove school key",
                        detail: `${sid}: ${Object.keys(plans).length} learner plan(s)`,
                    });
                }
            }
            continue;
        }
        if (file === "kidesys-transaction-history.json" && parsed && typeof parsed === "object") {
            for (const sid of schoolIds) {
                const rows = parsed[sid];
                if (Array.isArray(rows) && rows.length) {
                    impacts.push({
                        file,
                        action: "remove school key",
                        detail: `${sid}: ${rows.length} history row(s)`,
                    });
                }
            }
            continue;
        }
        if (file === "user-access.json" && parsed && typeof parsed === "object") {
            const users = parsed.users || {};
            const matches = Object.entries(users).filter(([, m]) => idSet.has(String(m.schoolId || "")));
            if (matches.length) {
                impacts.push({
                    file,
                    action: "remove user meta",
                    detail: `${matches.length} user access record(s) for target school(s)`,
                });
            }
            continue;
        }
        if (file === "family-account-audit.json" && parsed && typeof parsed === "object") {
            for (const sid of schoolIds) {
                const rows = parsed[sid];
                if (Array.isArray(rows) && rows.length) {
                    impacts.push({
                        file,
                        action: "remove school key",
                        detail: `${sid}: ${rows.length} audit row(s)`,
                    });
                }
            }
            continue;
        }
        if (file === "banking-imports.json" && parsed && typeof parsed === "object") {
            const imports = parsed.imports || [];
            const n = imports.filter((r) => idSet.has(String(r.schoolId || ""))).length;
            if (n)
                impacts.push({ file, action: "filter imports array", detail: `${n} import(s)` });
            continue;
        }
        if (file === "communication-store.json" && parsed && typeof parsed === "object") {
            const schools = parsed.schools || {};
            for (const sid of schoolIds) {
                if (schools[sid]) {
                    impacts.push({ file, action: "remove schools key", detail: sid });
                }
            }
            continue;
        }
        if (file === "legal-document-history.json" && Array.isArray(parsed)) {
            const n = parsed.filter((r) => idSet.has(String(r.schoolId || "")))
                .length;
            if (n)
                impacts.push({ file, action: "filter array entries", detail: `${n} row(s)` });
        }
    }
    return impacts;
}
function scanStagingImpact(schoolIds) {
    const out = [];
    const walk = (dir) => {
        let files = 0;
        let bytes = 0;
        if (!fs_1.default.existsSync(dir))
            return { files, bytes };
        for (const entry of fs_1.default.readdirSync(dir, { withFileTypes: true })) {
            const full = path_1.default.join(dir, entry.name);
            if (entry.isDirectory()) {
                const sub = walk(full);
                files += sub.files;
                bytes += sub.bytes;
            }
            else {
                files += 1;
                bytes += fs_1.default.statSync(full).size;
            }
        }
        return { files, bytes };
    };
    for (const sid of schoolIds) {
        const dir = path_1.default.join(STAGING_ROOT, sid);
        const stats = walk(dir);
        if (stats.files)
            out.push({ path: dir, files: stats.files, bytes: stats.bytes });
    }
    return out;
}
async function purgeImportedSchoolData(schoolId) {
    const removed = {};
    const run = async (key, fn) => {
        const r = await fn();
        if (r.count)
            removed[key] = r.count;
    };
    await run("communicationRecipient", () => prisma.communicationRecipient.deleteMany({
        where: { message: { schoolId } },
    }));
    await run("communicationLog", () => prisma.communicationLog.deleteMany({ where: { schoolId } }));
    await run("communicationMessage", () => prisma.communicationMessage.deleteMany({ where: { schoolId } }));
    await run("communicationCampaign", () => prisma.communicationCampaign.deleteMany({ where: { schoolId } }));
    await run("communicationTemplate", () => prisma.communicationTemplate.deleteMany({ where: { schoolId } }));
    await run("parentTeacherMessage", () => prisma.parentTeacherMessage.deleteMany({ where: { schoolId } }));
    await run("parentTeacherThread", () => prisma.parentTeacherThread.deleteMany({ where: { schoolId } }));
    await run("parentLearnerLink", () => prisma.parentLearnerLink.deleteMany({ where: { schoolId } }));
    await run("learnerIncident", () => prisma.learnerIncident.deleteMany({ where: { schoolId } }));
    await run("learnerResult", () => prisma.learnerResult.deleteMany({ where: { schoolId } }));
    await run("learnerReport", () => prisma.learnerReport.deleteMany({ where: { schoolId } }));
    await run("billingDepositAllocation", () => prisma.billingDepositAllocation.deleteMany({ where: { deposit: { schoolId } } }));
    await run("billingDepositHistoryEntry", () => prisma.billingDepositHistoryEntry.deleteMany({ where: { deposit: { schoolId } } }));
    await run("billingDeposit", () => prisma.billingDeposit.deleteMany({ where: { schoolId } }));
    await run("bankTransaction", () => prisma.bankTransaction.deleteMany({ where: { schoolId } }));
    await run("bankStatementImport", () => prisma.bankStatementImport.deleteMany({ where: { schoolId } }));
    await run("accountingJournalLine", () => prisma.accountingJournalLine.deleteMany({ where: { journal: { schoolId } } }));
    await run("accountingJournal", () => prisma.accountingJournal.deleteMany({ where: { schoolId } }));
    await run("supplierInvoicePayment", () => prisma.supplierInvoicePayment.deleteMany({ where: { invoice: { schoolId } } }));
    await run("supplierInvoiceLine", () => prisma.supplierInvoiceLine.deleteMany({ where: { invoice: { schoolId } } }));
    await run("supplierInvoice", () => prisma.supplierInvoice.deleteMany({ where: { schoolId } }));
    await run("supplier", () => prisma.supplier.deleteMany({ where: { schoolId } }));
    await run("expenseCategory", () => prisma.expenseCategory.deleteMany({ where: { schoolId } }));
    await run("payslip", () => prisma.payslip.deleteMany({ where: { schoolId } }));
    await run("payrollEmailLog", () => prisma.payrollEmailLog.deleteMany({ where: { schoolId } }));
    await run("payrollItem", () => prisma.payrollItem.deleteMany({ where: { payrollRunEmployee: { payrollRun: { schoolId } } } }));
    await run("payrollRunEmployee", () => prisma.payrollRunEmployee.deleteMany({ where: { payrollRun: { schoolId } } }));
    await run("payrollRun", () => prisma.payrollRun.deleteMany({ where: { schoolId } }));
    await run("payrollSetting", () => prisma.payrollSetting.deleteMany({ where: { schoolId } }));
    await run("learner", () => prisma.learner.deleteMany({ where: { schoolId } }));
    await run("parentOnboarding", () => prisma.parentOnboarding.deleteMany({ where: { schoolId } }));
    await run("parentOutreachQueue", () => prisma.parentOutreachQueue.deleteMany({ where: { schoolId } }));
    await run("parentNotification", () => prisma.parentNotification.deleteMany({ where: { schoolId } }));
    await run("pushSubscription", () => prisma.pushSubscription.deleteMany({ where: { schoolId } }));
    await run("parent", () => prisma.parent.deleteMany({ where: { schoolId } }));
    await run("familyAccount", () => prisma.familyAccount.deleteMany({ where: { schoolId } }));
    await run("homeworkPost", () => prisma.homeworkPost.deleteMany({ where: { schoolId } }));
    await run("schoolNotice", () => prisma.schoolNotice.deleteMany({ where: { schoolId } }));
    await run("parentDocument", () => prisma.parentDocument.deleteMany({ where: { schoolId } }));
    await run("classroom", () => prisma.classroom.deleteMany({ where: { schoolId } }));
    await run("employee", () => prisma.employee.deleteMany({ where: { schoolId } }));
    await run("letter", () => prisma.letter.deleteMany({ where: { schoolId } }));
    await run("letterTemplate", () => prisma.letterTemplate.deleteMany({ where: { schoolId } }));
    await run("feeStructure", () => prisma.feeStructure.deleteMany({ where: { schoolId } }));
    await run("schoolFeeSetting", () => prisma.schoolFeeSetting.deleteMany({ where: { schoolId } }));
    await run("teacherPerformance", () => prisma.teacherPerformance.deleteMany({ where: { schoolId } }));
    await run("billingSettings", () => prisma.billingSettings.deleteMany({ where: { schoolId } }));
    await run("schoolEmailSettings", () => prisma.schoolEmailSettings.deleteMany({ where: { schoolId } }));
    await run("schoolCommunicationProfile", () => prisma.schoolCommunicationProfile.deleteMany({ where: { schoolId } }));
    return removed;
}
async function deleteSchoolUsers(schoolId) {
    const users = await prisma.user.findMany({
        where: { schoolId },
        select: { id: true },
    });
    if (!users.length)
        return 0;
    await prisma.userPermissionOverride.deleteMany({
        where: { userId: { in: users.map((u) => u.id) } },
    });
    for (const u of users) {
        (0, userAccessStore_1.deleteUserAccessMeta)(u.id);
    }
    const r = await prisma.user.deleteMany({ where: { schoolId } });
    return r.count;
}
async function deleteSchoolRoles(schoolId) {
    const roles = await prisma.schoolRole.findMany({
        where: { schoolId },
        select: { id: true },
    });
    if (!roles.length)
        return 0;
    await prisma.rolePermission.deleteMany({
        where: { roleId: { in: roles.map((r) => r.id) } },
    });
    const r = await prisma.schoolRole.deleteMany({ where: { schoolId } });
    return r.count;
}
function clearJsonStoresForSchools(schoolIds) {
    const idSet = new Set(schoolIds);
    const applied = [];
    for (const file of JSON_STORE_FILES) {
        const filePath = path_1.default.join(DATA_DIR, file);
        if (!fs_1.default.existsSync(filePath))
            continue;
        const parsed = JSON.parse(fs_1.default.readFileSync(filePath, "utf8"));
        let changed = false;
        if (file === "billing-ledger.json" && parsed && typeof parsed === "object") {
            const obj = parsed;
            for (const sid of schoolIds) {
                if (obj[sid]) {
                    applied.push({
                        file,
                        action: "removed",
                        detail: `${sid}: ${obj[sid].length} ledger entries`,
                    });
                    delete obj[sid];
                    changed = true;
                }
            }
            if (changed)
                fs_1.default.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
            continue;
        }
        if (file === "learner-billing-plans.json" && parsed && typeof parsed === "object") {
            const obj = parsed;
            for (const sid of schoolIds) {
                if (obj[sid]) {
                    applied.push({
                        file,
                        action: "removed",
                        detail: `${sid}: ${Object.keys(obj[sid]).length} learner plan(s)`,
                    });
                    delete obj[sid];
                    changed = true;
                }
            }
            if (changed)
                fs_1.default.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
            continue;
        }
        if (file === "kidesys-transaction-history.json" && parsed && typeof parsed === "object") {
            const obj = parsed;
            for (const sid of schoolIds) {
                if (obj[sid]) {
                    applied.push({
                        file,
                        action: "removed",
                        detail: `${sid}: ${obj[sid].length} history row(s)`,
                    });
                    delete obj[sid];
                    changed = true;
                }
            }
            if (changed)
                fs_1.default.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
            continue;
        }
        if (file === "user-access.json" && parsed && typeof parsed === "object") {
            const store = parsed;
            const before = Object.keys(store.users).length;
            for (const [uid, meta] of Object.entries(store.users)) {
                if (idSet.has(String(meta.schoolId || "")))
                    delete store.users[uid];
            }
            const removed = before - Object.keys(store.users).length;
            if (removed) {
                applied.push({ file, action: "removed", detail: `${removed} user access record(s)` });
                fs_1.default.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
            }
            continue;
        }
        if (file === "family-account-audit.json" && parsed && typeof parsed === "object") {
            const obj = parsed;
            for (const sid of schoolIds) {
                if (obj[sid]) {
                    applied.push({ file, action: "removed", detail: `${sid}: ${obj[sid].length} audit row(s)` });
                    delete obj[sid];
                    changed = true;
                }
            }
            if (changed)
                fs_1.default.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
            continue;
        }
        if (file === "banking-imports.json" && parsed && typeof parsed === "object") {
            const obj = parsed;
            const before = obj.imports.length;
            obj.imports = obj.imports.filter((r) => !idSet.has(String(r.schoolId || "")));
            const removed = before - obj.imports.length;
            if (removed) {
                applied.push({ file, action: "filtered", detail: `${removed} import(s)` });
                fs_1.default.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
            }
            continue;
        }
        if (file === "communication-store.json" && parsed && typeof parsed === "object") {
            const obj = parsed;
            for (const sid of schoolIds) {
                if (obj.schools[sid]) {
                    applied.push({ file, action: "removed", detail: sid });
                    delete obj.schools[sid];
                    changed = true;
                }
            }
            if (changed)
                fs_1.default.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
            continue;
        }
        if (file === "legal-document-history.json" && Array.isArray(parsed)) {
            const arr = parsed;
            const before = arr.length;
            const next = arr.filter((r) => !idSet.has(String(r.schoolId || "")));
            const removed = before - next.length;
            if (removed) {
                applied.push({ file, action: "filtered", detail: `${removed} row(s)` });
                fs_1.default.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
            }
        }
    }
    return applied;
}
function clearStagingForSchools(schoolIds) {
    const removed = [];
    const rmDir = (dir) => {
        if (!fs_1.default.existsSync(dir))
            return 0;
        const walkCount = (d) => {
            let n = 0;
            for (const e of fs_1.default.readdirSync(d, { withFileTypes: true })) {
                const full = path_1.default.join(d, e.name);
                n += e.isDirectory() ? walkCount(full) : 1;
            }
            return n;
        };
        const files = walkCount(dir);
        fs_1.default.rmSync(dir, { recursive: true, force: true });
        return files;
    };
    for (const sid of schoolIds) {
        const dir = path_1.default.join(STAGING_ROOT, sid);
        const files = rmDir(dir);
        if (files)
            removed.push({ path: dir, files });
    }
    return removed;
}
async function ensureDaSilvaOwner(schoolId) {
    const email = DA_SILVA_OWNER_EMAIL.trim().toLowerCase();
    const password = String(process.env.DA_SILVA_OWNER_PASSWORD || "").trim();
    const existing = await prisma.user.findFirst({
        where: { schoolId, email },
        select: { id: true, fullName: true },
    });
    if (existing) {
        return { action: "owner user already exists (unchanged)", email };
    }
    if (!password) {
        throw new Error(`DA_SILVA_OWNER_PASSWORD is required in env to create owner user ${email}`);
    }
    const passwordHash = await bcryptjs_1.default.hash(password, 10);
    const user = await prisma.user.create({
        data: {
            schoolId,
            email,
            fullName: "Da Silva Academy Owner",
            passwordHash,
            role: "SCHOOL_ADMIN",
            isActive: true,
        },
        select: { id: true },
    });
    (0, userAccessStore_1.setUserAccessMeta)(user.id, {
        schoolId,
        firstName: "Da Silva",
        surname: "Owner",
        appRole: "Owner",
        permissions: {},
        lastLoginAt: null,
    });
    return { action: "created owner user", email };
}
function formatBytes(n) {
    if (n < 1024)
        return `${n} B`;
    if (n < 1024 * 1024)
        return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
async function main() {
    const schools = await prisma.school.findMany({
        select: { id: true, name: true, email: true, createdAt: true },
        orderBy: { createdAt: "asc" },
    });
    const platform = schools.filter((s) => isProtectedPlatform(s.name));
    const demo = schools.filter((s) => isDemoSchool(s.name));
    const daSilva = schools.find((s) => isDaSilvaSchool(s.name));
    const other = schools.filter((s) => !isProtectedPlatform(s.name) && !isDemoSchool(s.name) && !isDaSilvaSchool(s.name));
    const demoIds = demo.map((s) => s.id);
    const daSilvaId = daSilva?.id || null;
    const jsonSchoolIds = [...demoIds, ...(daSilvaId ? [daSilvaId] : [])];
    const report = {
        mode: APPLY ? "APPLY" : "DRY_RUN",
        generatedAt: new Date().toISOString(),
        protected: {
            platformSchools: platform.map((s) => ({ id: s.id, name: s.name })),
            note: "EduClear Platform will not be modified",
        },
        demoSchools: [],
        daSilva: null,
        unclassifiedSchools: other.map((s) => ({ id: s.id, name: s.name })),
        jsonStores: scanJsonStoreImpact(jsonSchoolIds),
        migrationStaging: scanStagingImpact(jsonSchoolIds),
        warnings: [],
    };
    if (!daSilva) {
        report.warnings.push("Da Silva Academy not found in database");
    }
    if (other.length) {
        report.warnings.push(`Unexpected school(s) not in cleanup scope: ${other.map((s) => s.name).join(", ")}`);
    }
    for (const school of demo) {
        const users = await prisma.user.findMany({
            where: { schoolId: school.id },
            select: { id: true, email: true, role: true, fullName: true },
        });
        const counts = await countSchoolPrismaRows(school.id);
        report.demoSchools.push({
            id: school.id,
            name: school.name,
            email: school.email,
            action: "DELETE entire school row + all linked data + users",
            users: users.map((u) => ({ id: u.id, email: u.email, role: u.role })),
            prismaRowCounts: counts,
            prismaRowsTotal: sumCounts(counts),
        });
    }
    if (daSilva) {
        const counts = await countSchoolPrismaRows(daSilva.id);
        const ownerExists = await prisma.user.findFirst({
            where: { schoolId: daSilva.id, email: DA_SILVA_OWNER_EMAIL },
            select: { id: true },
        });
        report.daSilva = {
            id: daSilva.id,
            name: daSilva.name,
            action: "PURGE imported data only — keep School row",
            prismaRowCounts: counts,
            prismaRowsTotal: sumCounts(counts),
            ownerAdmin: {
                email: DA_SILVA_OWNER_EMAIL,
                exists: Boolean(ownerExists),
                onApply: ownerExists
                    ? "no change"
                    : "create owner user (requires DA_SILVA_OWNER_PASSWORD in env)",
            },
        };
    }
    const txtLines = [
        `EduClear school data cleanup — ${APPLY ? "APPLY" : "DRY RUN"}`,
        `Generated: ${report.generatedAt}`,
        "",
        "=== PROTECTED (no changes) ===",
        ...platform.map((s) => `  ${s.name} (${s.id})`),
        "",
        "=== DEMO / TEST SCHOOLS (full delete) ===",
    ];
    for (const entry of report.demoSchools) {
        txtLines.push(`  ${entry.name} (${entry.id})`);
        txtLines.push(`    Users to delete: ${entry.users.map((u) => u.email).join(", ")}`);
        txtLines.push(`    Prisma rows (approx): ${entry.prismaRowsTotal}`);
    }
    txtLines.push("", "=== DA SILVA ACADEMY (purge import, keep school) ===");
    if (report.daSilva) {
        const ds = report.daSilva;
        txtLines.push(`  School id: ${ds.id}`);
        txtLines.push(`  Prisma rows to delete: ${ds.prismaRowsTotal}`);
        const top = Object.entries(ds.prismaRowCounts)
            .filter(([, n]) => n > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12);
        for (const [k, n] of top)
            txtLines.push(`    ${k}: ${n}`);
        txtLines.push(`  Owner ${ds.ownerAdmin.email}: ${ds.ownerAdmin.exists ? "exists" : "would create on apply"}`);
        txtLines.push(`  On apply: ${ds.ownerAdmin.onApply}`);
    }
    else {
        txtLines.push("  (not found)");
    }
    txtLines.push("", "=== JSON FILE STORES ===");
    for (const j of report.jsonStores) {
        txtLines.push(`  ${j.file}: ${j.action} — ${j.detail}`);
    }
    txtLines.push("", "=== MIGRATION STAGING ===");
    for (const s of report.migrationStaging) {
        txtLines.push(`  ${s.path}: ${s.files} file(s), ${formatBytes(s.bytes)}`);
    }
    if (report.warnings.length) {
        txtLines.push("", "=== WARNINGS ===");
        for (const w of report.warnings)
            txtLines.push(`  ! ${w}`);
    }
    if (!APPLY) {
        txtLines.push("", "No changes written. Re-run with --apply after review.");
    }
    else {
        txtLines.push("", "=== APPLY RESULTS ===");
        const applyLog = { demo: [], daSilva: null, json: [], staging: [] };
        for (const school of demo) {
            const purged = await purgeImportedSchoolData(school.id);
            const usersDeleted = await deleteSchoolUsers(school.id);
            const rolesDeleted = await deleteSchoolRoles(school.id);
            await prisma.school.delete({ where: { id: school.id } });
            applyLog.demo = [
                ...applyLog.demo,
                {
                    schoolId: school.id,
                    name: school.name,
                    purged,
                    usersDeleted,
                    rolesDeleted,
                    schoolRowDeleted: true,
                },
            ];
            txtLines.push(`  Deleted demo school ${school.name}`);
        }
        if (daSilva) {
            const purged = await purgeImportedSchoolData(daSilva.id);
            const rolesDeleted = await deleteSchoolRoles(daSilva.id);
            let ownerResult = null;
            const daSilvaSchool = await prisma.school.findUnique({
                where: { id: daSilva.id },
                select: { id: true, email: true },
            });
            const registrationOwners = daSilvaSchool
                ? await prisma.user.findMany({
                    where: { schoolId: daSilva.id, isActive: true },
                    select: { id: true, email: true, fullName: true },
                }).then((users) => users.filter((u) => (0, ownerProvisioning_1.isRegistrationProvisionedOwner)(u, daSilvaSchool)))
                : [];
            const usersDeleted = registrationOwners.length > 0 ? 0 : await deleteSchoolUsers(daSilva.id);
            if (registrationOwners.length > 0) {
                report.warnings.push(`Preserved ${registrationOwners.length} registration-provisioned owner user(s) — not deleted`);
            }
            try {
                ownerResult = await ensureDaSilvaOwner(daSilva.id);
            }
            catch (e) {
                report.warnings.push(e instanceof Error ? e.message : "Failed to ensure Da Silva owner");
            }
            applyLog.daSilva = {
                purged,
                usersDeleted,
                rolesDeleted,
                ownerResult,
                schoolKept: true,
                preservedRegistrationOwners: registrationOwners.map((u) => u.email),
            };
            txtLines.push(`  Purged Da Silva imported data (${sumCounts(purged)} deleteMany total)`);
            if (registrationOwners.length) {
                txtLines.push(`  Preserved registration owner(s): ${registrationOwners.map((u) => u.email).join(", ")}`);
            }
            else if (usersDeleted) {
                txtLines.push(`  Removed ${usersDeleted} user row(s) before ensure owner`);
            }
            if (ownerResult)
                txtLines.push(`  Owner: ${ownerResult.action} (${ownerResult.email})`);
        }
        const jsonApplied = clearJsonStoresForSchools(jsonSchoolIds);
        const stagingRemoved = clearStagingForSchools(jsonSchoolIds);
        applyLog.json = jsonApplied;
        applyLog.staging = stagingRemoved;
        report.applyResults = applyLog;
        for (const j of jsonApplied)
            txtLines.push(`  JSON ${j.file}: ${j.detail}`);
        for (const s of stagingRemoved)
            txtLines.push(`  Staging removed: ${s.path} (${s.files} files)`);
    }
    const jsonOut = path_1.default.join(process.cwd(), "school-data-cleanup-dry-run.json");
    const txtOut = path_1.default.join(process.cwd(), "school-data-cleanup-dry-run.txt");
    fs_1.default.writeFileSync(jsonOut, JSON.stringify(report, null, 2), "utf8");
    fs_1.default.writeFileSync(txtOut, txtLines.join("\n"), "utf8");
    console.log(txtLines.join("\n"));
    console.log(`\nReport written: ${jsonOut}`);
    console.log(`Report written: ${txtOut}`);
}
const isDirectCliRun = Boolean(process.argv[1]) &&
    path_1.default.basename(process.argv[1]).replace(/\.(tsx|ts|js)$/, "") === "school-data-cleanup";
if (isDirectCliRun) {
    main()
        .catch((e) => {
        console.error(e);
        process.exit(1);
    })
        .finally(() => prisma.$disconnect());
}
