"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DA_SILVA_JSON_STORE_FILES = void 0;
exports.collectDaSilvaSchoolIds = collectDaSilvaSchoolIds;
exports.buildDaSilvaPurgeScope = buildDaSilvaPurgeScope;
exports.purgeDaSilvaJsonStores = purgeDaSilvaJsonStores;
exports.collectDaSilvaEmptyStateCounts = collectDaSilvaEmptyStateCounts;
exports.auditDaSilvaEmptyState = auditDaSilvaEmptyState;
exports.assertDaSilvaEmptyState = assertDaSilvaEmptyState;
/**
 * Da Silva Academy — scope resolution, JSON billing purge, and empty-state assertions.
 *
 * Billing ledger / plans / Kid-e-Sys history are stored under canonical school id
 * (DA_SILVA_ACADEMY_SCHOOL_ID) even when the live Prisma school row uses another id.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const activateDaSilvaSubscription_1 = require("../../src/services/activateDaSilvaSubscription");
const daSilvaSchoolResolve_1 = require("../../src/services/daSilvaSchoolResolve");
const billingDisplayRules_1 = require("../../src/utils/billingDisplayRules");
const billingLedgerStore_1 = require("../../src/utils/billingLedgerStore");
const kidesysTransactionHistoryStore_1 = require("../../src/utils/kidesysTransactionHistoryStore");
const learnerBillingPlanStore_1 = require("../../src/utils/learnerBillingPlanStore");
const DATA_DIR = path_1.default.join(process.cwd(), "data");
exports.DA_SILVA_JSON_STORE_FILES = [
    "billing-ledger.json",
    "learner-billing-plans.json",
    "kidesys-transaction-history.json",
    "user-access.json",
    "family-account-audit.json",
    "banking-imports.json",
    "communication-store.json",
    "legal-document-history.json",
];
function bump(map, key, n) {
    if (n > 0)
        map[key] = (map[key] || 0) + n;
}
function readJsonObject(fileName) {
    const filePath = path_1.default.join(DATA_DIR, fileName);
    if (!fs_1.default.existsSync(filePath))
        return null;
    try {
        const parsed = JSON.parse(fs_1.default.readFileSync(filePath, "utf8"));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
function writeJsonObject(fileName, obj) {
    const filePath = path_1.default.join(DATA_DIR, fileName);
    if (!fs_1.default.existsSync(DATA_DIR))
        fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
    fs_1.default.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
}
function entryMatchesScope(entry, scope) {
    const schoolId = String(entry.schoolId || "").trim();
    if (schoolId && scope.schoolIds.includes(schoolId))
        return true;
    const learnerId = String(entry.learnerId || "").trim();
    if (learnerId && scope.learnerIds.has(learnerId))
        return true;
    const accountNo = String(entry.accountNo || "").trim();
    if (accountNo && scope.accountRefs.has(accountNo))
        return true;
    return false;
}
/** All Prisma + canonical school ids that may own Da Silva JSON billing buckets. */
async function collectDaSilvaSchoolIds(prisma, extraSchoolIds = []) {
    const ids = new Set([
        activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID,
        ...(await (0, daSilvaSchoolResolve_1.refreshDaSilvaSchoolIdCache)()),
        ...extraSchoolIds.map((id) => String(id || "").trim()).filter(Boolean),
    ]);
    const schools = await prisma.school.findMany({
        where: {
            OR: [
                { id: activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID },
                { email: activateDaSilvaSubscription_1.DA_SILVA_OWNER_EMAIL },
                { name: activateDaSilvaSubscription_1.DA_SILVA_SCHOOL_NAME },
                { name: { contains: "Da Silva", mode: "insensitive" } },
            ],
        },
        select: { id: true },
    });
    for (const row of schools)
        ids.add(row.id);
    return Array.from(ids);
}
/** Capture learner / family identifiers before Prisma rows are deleted. */
async function buildDaSilvaPurgeScope(prisma, primarySchoolId) {
    const schoolIds = await collectDaSilvaSchoolIds(prisma, [primarySchoolId]);
    const learnerIds = new Set();
    const familyAccountIds = new Set();
    const accountRefs = new Set();
    const learners = await prisma.learner.findMany({
        where: { schoolId: { in: schoolIds } },
        select: {
            id: true,
            admissionNo: true,
            familyAccountId: true,
            familyAccount: { select: { accountRef: true } },
        },
    });
    for (const row of learners) {
        learnerIds.add(row.id);
        const adm = String(row.admissionNo || "").trim();
        if (adm)
            accountRefs.add(adm);
        const ref = String(row.familyAccount?.accountRef || "").trim();
        if (ref)
            accountRefs.add(ref);
        const faId = String(row.familyAccountId || "").trim();
        if (faId)
            familyAccountIds.add(faId);
    }
    const familyAccounts = await prisma.familyAccount.findMany({
        where: { schoolId: { in: schoolIds } },
        select: { id: true, accountRef: true },
    });
    for (const row of familyAccounts) {
        familyAccountIds.add(row.id);
        const ref = String(row.accountRef || "").trim();
        if (ref)
            accountRefs.add(ref);
    }
    return { schoolIds, learnerIds, familyAccountIds, accountRefs };
}
function purgeBillingLedger(scope) {
    const obj = readJsonObject("billing-ledger.json");
    if (!obj)
        return 0;
    let removed = 0;
    const schoolIdSet = new Set(scope.schoolIds);
    for (const key of Object.keys(obj)) {
        if (schoolIdSet.has(key)) {
            const rows = obj[key];
            if (Array.isArray(rows))
                removed += rows.length;
            delete obj[key];
        }
    }
    for (const [key, value] of Object.entries(obj)) {
        if (!Array.isArray(value))
            continue;
        const before = value.length;
        const kept = value.filter((entry) => !entryMatchesScope(entry, scope));
        removed += before - kept.length;
        if (kept.length)
            obj[key] = kept;
        else
            delete obj[key];
    }
    writeJsonObject("billing-ledger.json", obj);
    return removed;
}
function purgeLearnerBillingPlans(scope) {
    const obj = readJsonObject("learner-billing-plans.json");
    if (!obj)
        return 0;
    let removed = 0;
    const schoolIdSet = new Set(scope.schoolIds);
    for (const key of [...Object.keys(obj)]) {
        const schoolPlans = obj[key];
        if (!schoolPlans || typeof schoolPlans !== "object" || Array.isArray(schoolPlans)) {
            if (schoolIdSet.has(key)) {
                delete obj[key];
                removed += 1;
            }
            continue;
        }
        const plans = schoolPlans;
        if (schoolIdSet.has(key)) {
            removed += Object.keys(plans).length;
            delete obj[key];
            continue;
        }
        const before = Object.keys(plans).length;
        for (const learnerId of Object.keys(plans)) {
            if (scope.learnerIds.has(learnerId)) {
                delete plans[learnerId];
                removed += 1;
            }
        }
        if (Object.keys(plans).length)
            obj[key] = plans;
        else
            delete obj[key];
        if (before > Object.keys(plans).length) {
            /* counted in loop */
        }
    }
    writeJsonObject("learner-billing-plans.json", obj);
    return removed;
}
function purgeKidesysHistory(scope) {
    const obj = readJsonObject("kidesys-transaction-history.json");
    if (!obj)
        return 0;
    let removed = 0;
    const schoolIdSet = new Set(scope.schoolIds);
    for (const key of Object.keys(obj)) {
        if (schoolIdSet.has(key)) {
            const rows = obj[key];
            if (Array.isArray(rows))
                removed += rows.length;
            delete obj[key];
        }
    }
    for (const [key, value] of Object.entries(obj)) {
        if (!Array.isArray(value))
            continue;
        const before = value.length;
        const kept = value.filter((entry) => !entryMatchesScope(entry, scope));
        removed += before - kept.length;
        if (kept.length)
            obj[key] = kept;
        else
            delete obj[key];
    }
    writeJsonObject("kidesys-transaction-history.json", obj);
    return removed;
}
function purgeUserAccess(scope) {
    const filePath = path_1.default.join(DATA_DIR, "user-access.json");
    if (!fs_1.default.existsSync(filePath))
        return 0;
    const parsed = JSON.parse(fs_1.default.readFileSync(filePath, "utf8"));
    const users = parsed.users || {};
    const schoolIdSet = new Set(scope.schoolIds);
    const before = Object.keys(users).length;
    for (const [uid, meta] of Object.entries(users)) {
        if (schoolIdSet.has(String(meta.schoolId || "").trim()))
            delete users[uid];
    }
    const removed = before - Object.keys(users).length;
    if (removed) {
        fs_1.default.writeFileSync(filePath, JSON.stringify({ users }, null, 2), "utf8");
    }
    return removed;
}
function purgeFamilyAccountAudit(scope) {
    const obj = readJsonObject("family-account-audit.json");
    if (!obj)
        return 0;
    let removed = 0;
    const schoolIdSet = new Set(scope.schoolIds);
    for (const key of Object.keys(obj)) {
        if (schoolIdSet.has(key)) {
            const rows = obj[key];
            if (Array.isArray(rows))
                removed += rows.length;
            delete obj[key];
        }
    }
    if (removed)
        writeJsonObject("family-account-audit.json", obj);
    return removed;
}
function purgeBankingImports(scope) {
    const filePath = path_1.default.join(DATA_DIR, "banking-imports.json");
    if (!fs_1.default.existsSync(filePath))
        return 0;
    const parsed = JSON.parse(fs_1.default.readFileSync(filePath, "utf8"));
    const schoolIdSet = new Set(scope.schoolIds);
    const imports = parsed.imports || [];
    const before = imports.length;
    parsed.imports = imports.filter((r) => !schoolIdSet.has(String(r.schoolId || "").trim()));
    const removed = before - parsed.imports.length;
    if (removed)
        fs_1.default.writeFileSync(filePath, JSON.stringify(parsed, null, 2), "utf8");
    return removed;
}
function purgeCommunicationStore(scope) {
    const filePath = path_1.default.join(DATA_DIR, "communication-store.json");
    if (!fs_1.default.existsSync(filePath))
        return 0;
    const parsed = JSON.parse(fs_1.default.readFileSync(filePath, "utf8"));
    const schoolIdSet = new Set(scope.schoolIds);
    let removed = 0;
    for (const sid of schoolIdSet) {
        if (parsed.schools?.[sid]) {
            delete parsed.schools[sid];
            removed += 1;
        }
    }
    if (removed)
        fs_1.default.writeFileSync(filePath, JSON.stringify(parsed, null, 2), "utf8");
    return removed;
}
function purgeLegalDocumentHistory(scope) {
    const filePath = path_1.default.join(DATA_DIR, "legal-document-history.json");
    if (!fs_1.default.existsSync(filePath))
        return 0;
    const parsed = JSON.parse(fs_1.default.readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed))
        return 0;
    const schoolIdSet = new Set(scope.schoolIds);
    const before = parsed.length;
    const next = parsed.filter((r) => !schoolIdSet.has(String(r.schoolId || "").trim()));
    const removed = before - next.length;
    if (removed)
        fs_1.default.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
    return removed;
}
/** Remove all JSON billing / migration artifacts for Da Silva (all known school id buckets). */
function purgeDaSilvaJsonStores(scope) {
    const removed = {};
    bump(removed, "billingLedgerEntries", purgeBillingLedger(scope));
    bump(removed, "learnerBillingPlanLearners", purgeLearnerBillingPlans(scope));
    bump(removed, "kidesysHistoryRows", purgeKidesysHistory(scope));
    bump(removed, "userAccessRecords", purgeUserAccess(scope));
    bump(removed, "familyAccountAuditRows", purgeFamilyAccountAudit(scope));
    bump(removed, "bankingImports", purgeBankingImports(scope));
    bump(removed, "communicationStoreSchools", purgeCommunicationStore(scope));
    bump(removed, "legalDocumentHistoryRows", purgeLegalDocumentHistory(scope));
    return removed;
}
async function collectDaSilvaEmptyStateCounts(prisma, schoolIds) {
    const scopeIds = schoolIds?.length ? schoolIds : await collectDaSilvaSchoolIds(prisma);
    const [schools, learners, classrooms, parents, familyAccounts, parentLearnerLinks,] = await Promise.all([
        prisma.school.count({
            where: {
                OR: [
                    { id: { in: scopeIds } },
                    { name: activateDaSilvaSubscription_1.DA_SILVA_SCHOOL_NAME },
                    { email: activateDaSilvaSubscription_1.DA_SILVA_OWNER_EMAIL },
                    { name: { contains: "Da Silva", mode: "insensitive" } },
                ],
            },
        }),
        prisma.learner.count({ where: { schoolId: { in: scopeIds } } }),
        prisma.classroom.count({ where: { schoolId: { in: scopeIds } } }),
        prisma.parent.count({ where: { schoolId: { in: scopeIds } } }),
        prisma.familyAccount.count({ where: { schoolId: { in: scopeIds } } }),
        prisma.parentLearnerLink.count({ where: { schoolId: { in: scopeIds } } }),
    ]);
    let billingLedgerEntries = 0;
    let billingPlanLearners = 0;
    let openingBalanceEntries = 0;
    let kidesysHistoryRows = 0;
    const seenLedger = new Set();
    for (const sid of scopeIds) {
        for (const entry of (0, billingLedgerStore_1.readSchoolLedger)(sid)) {
            const key = String(entry.id || `${entry.date}-${entry.reference}-${entry.amount}`);
            if (seenLedger.has(key))
                continue;
            seenLedger.add(key);
            billingLedgerEntries += 1;
            if ((0, billingDisplayRules_1.isKidesysOpeningBalanceEntry)(entry))
                openingBalanceEntries += 1;
        }
    }
    const seenPlans = new Set();
    for (const sid of scopeIds) {
        for (const learnerId of Object.keys((0, learnerBillingPlanStore_1.readSchoolBillingPlans)(sid))) {
            if (seenPlans.has(learnerId))
                continue;
            seenPlans.add(learnerId);
            billingPlanLearners += 1;
        }
    }
    const seenHistory = new Set();
    for (const sid of scopeIds) {
        for (const row of (0, kidesysTransactionHistoryStore_1.readSchoolKidesysHistory)(sid)) {
            const key = String(row.id || `${row.date}-${row.reference}`);
            if (seenHistory.has(key))
                continue;
            seenHistory.add(key);
            kidesysHistoryRows += 1;
        }
    }
    return {
        schools,
        learners,
        classrooms,
        parents,
        familyAccounts,
        parentLearnerLinks,
        billingLedgerEntries,
        billingPlanLearners,
        openingBalanceEntries,
        kidesysHistoryRows,
    };
}
async function auditDaSilvaEmptyState(prisma, options) {
    const scopeSchoolIds = options?.schoolIds?.length
        ? options.schoolIds
        : await collectDaSilvaSchoolIds(prisma);
    const counts = await collectDaSilvaEmptyStateCounts(prisma, scopeSchoolIds);
    const blockers = [];
    if (counts.schools > 0)
        blockers.push(`school rows: ${counts.schools}`);
    if (counts.learners > 0)
        blockers.push(`learners: ${counts.learners}`);
    if (counts.classrooms > 0)
        blockers.push(`classrooms: ${counts.classrooms}`);
    if (counts.parents > 0)
        blockers.push(`parents: ${counts.parents}`);
    if (counts.familyAccounts > 0)
        blockers.push(`family accounts: ${counts.familyAccounts}`);
    if (counts.parentLearnerLinks > 0)
        blockers.push(`parent-learner links: ${counts.parentLearnerLinks}`);
    if (counts.billingLedgerEntries > 0) {
        blockers.push(`billing ledger entries: ${counts.billingLedgerEntries}`);
    }
    if (counts.billingPlanLearners > 0) {
        blockers.push(`billing plans (learners): ${counts.billingPlanLearners}`);
    }
    if (counts.openingBalanceEntries > 0) {
        blockers.push(`opening balance ledger entries: ${counts.openingBalanceEntries}`);
    }
    if (counts.kidesysHistoryRows > 0) {
        blockers.push(`Kid-e-Sys history rows: ${counts.kidesysHistoryRows}`);
    }
    return {
        generatedAt: new Date().toISOString(),
        scopeSchoolIds,
        counts,
        blockers,
        passed: blockers.length === 0,
    };
}
async function assertDaSilvaEmptyState(prisma, label = "Da Silva empty-state assertion") {
    const report = await auditDaSilvaEmptyState(prisma);
    if (!report.passed) {
        throw new Error(`${label} failed:\n${report.blockers.map((b) => `  - ${b}`).join("\n")}`);
    }
    return report;
}
