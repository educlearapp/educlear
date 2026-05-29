"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Da Silva Academy — replace live dirty data with approved localhost snapshot (idempotent).
 *
 * Does NOT touch EduClear Platform, info@educlear.co.za, or other schools.
 * Does NOT reset the whole DB or change owner password when the account already exists.
 *
 * Usage:
 *   npx tsx scripts/da-silva-live-snapshot-replace.ts
 *   npx tsx scripts/da-silva-live-snapshot-replace.ts --apply
 *   npx tsx scripts/da-silva-live-snapshot-replace.ts --apply --snapshot-dir /path/to/localhost/backend
 *
 * Env (--apply only):
 *   CONFIRM_DA_SILVA_LIVE_REPLACE=true
 *   DATABASE_URL — used for pg_dump backup (optional but recommended)
 *   DA_SILVA_OWNER_PASSWORD — only if owner user must be created after purge
 */
require("dotenv/config");
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const activateDaSilvaSubscription_1 = require("../src/services/activateDaSilvaSubscription");
const statementAccounts_1 = require("../src/services/statementAccounts");
const ownerProvisioning_1 = require("../src/utils/ownerProvisioning");
const kidesysTransactionHistoryStore_1 = require("../src/utils/kidesysTransactionHistoryStore");
const billingLedgerStore_1 = require("../src/utils/billingLedgerStore");
const learnerBillingPlanStore_1 = require("../src/utils/learnerBillingPlanStore");
const prisma = new client_1.PrismaClient();
const APPLY = process.argv.includes("--apply");
const SNAPSHOT_DIR_ARG = process.argv.find((a, i) => process.argv[i - 1] === "--snapshot-dir");
const CONFIRM_ENV = "CONFIRM_DA_SILVA_LIVE_REPLACE";
const PLATFORM_SCHOOL_NAME = "EduClear Platform";
const SUPER_ADMIN_EMAIL = "info@educlear.co.za";
const DA_SILVA_LOGO_REL = "uploads/school-logos/da-silva-academy-logo.png";
const DA_SILVA_EXPECTED_HISTORY_ROW_COUNT = 40916;
const DA_SILVA_PHASE5_BALANCE_GUARDS = {
    accounts: 344,
    netOutstanding: 1228655.42,
    overPaid: 490355.03,
};
/** Approved localhost snapshot counts (Da Silva Academy only). */
const EXPECTED = {
    learners: 396,
    parents: 290,
    parentLinks: 330,
    classrooms: 21,
    familyAccounts: 344,
    statementAccounts: DA_SILVA_PHASE5_BALANCE_GUARDS.accounts,
    billingPlanLearners: 396,
    ledgerEntries: 337,
    historyRows: DA_SILVA_EXPECTED_HISTORY_ROW_COUNT,
    netOutstanding: DA_SILVA_PHASE5_BALANCE_GUARDS.netOutstanding,
    overPaid: DA_SILVA_PHASE5_BALANCE_GUARDS.overPaid,
    subscriptionStatus: client_1.SchoolSubscriptionStatus.ACTIVE,
    subscriptionPackage: "UNLIMITED",
};
const JSON_SNAPSHOT_FILES = [
    "billing-ledger.json",
    "learner-billing-plans.json",
    "kidesys-transaction-history.json",
    "user-access.json",
    "family-account-audit.json",
    "banking-imports.json",
    "communication-store.json",
    "legal-document-history.json",
];
function captureSnapshotBundle(snapshotDir, schoolId) {
    const jsonByFile = {};
    for (const file of JSON_SNAPSHOT_FILES) {
        const filePath = path_1.default.join(snapshotDir, "data", file);
        if (fs_1.default.existsSync(filePath)) {
            jsonByFile[file] = JSON.parse(fs_1.default.readFileSync(filePath, "utf8"));
        }
    }
    const manifestSrc = path_1.default.join(snapshotDir, "uploads", "migration-staging", schoolId);
    let manifestDirBackup = null;
    if (fs_1.default.existsSync(manifestSrc)) {
        manifestDirBackup = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), "da-silva-manifest-"));
        fs_1.default.cpSync(manifestSrc, manifestDirBackup, { recursive: true });
    }
    const logoPath = path_1.default.join(snapshotDir, DA_SILVA_LOGO_REL);
    const logoBytes = fs_1.default.existsSync(logoPath) ? fs_1.default.readFileSync(logoPath) : null;
    return { jsonByFile, manifestDirBackup, logoBytes };
}
function snapshotCountsFromBundle(bundle) {
    const sid = activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID;
    let manifest = null;
    if (bundle.manifestDirBackup) {
        const files = fs_1.default.readdirSync(bundle.manifestDirBackup).filter((f) => f.endsWith(".manifest.json"));
        if (files[0]) {
            manifest = JSON.parse(fs_1.default.readFileSync(path_1.default.join(bundle.manifestDirBackup, files[0]), "utf8"));
        }
    }
    const staged = manifest?.stagedParentIds || {};
    const parentIds = new Set(Object.values(staged));
    const plans = bundle.jsonByFile["learner-billing-plans.json"];
    const ledger = bundle.jsonByFile["billing-ledger.json"];
    const history = bundle.jsonByFile["kidesys-transaction-history.json"];
    const schoolPlans = plans && typeof plans === "object" && !Array.isArray(plans)
        ? plans[sid]
        : null;
    const schoolLedger = ledger && typeof ledger === "object" && !Array.isArray(ledger)
        ? ledger[sid]
        : null;
    const schoolHistory = history && typeof history === "object" && !Array.isArray(history)
        ? history[sid]
        : null;
    return {
        learners: manifest?.learnerIds?.length || Object.keys(manifest?.matchKeyToLearnerId || {}).length,
        parents: parentIds.size,
        parentLinks: Object.keys(staged).length,
        familyAccounts: Object.keys(manifest?.accountToLearnerId || {}).length,
        billingPlanLearners: schoolPlans && typeof schoolPlans === "object"
            ? Object.keys(schoolPlans).length
            : 0,
        ledgerEntries: Array.isArray(schoolLedger) ? schoolLedger.length : 0,
        historyRows: Array.isArray(schoolHistory) ? schoolHistory.length : 0,
        manifestPresent: Boolean(manifest),
        logoPresent: Boolean(bundle.logoBytes?.length),
    };
}
function round2(n) {
    return Math.round(n * 100) / 100;
}
function resolveSnapshotDir() {
    const raw = SNAPSHOT_DIR_ARG?.trim();
    if (raw) {
        const abs = path_1.default.resolve(raw);
        if (!fs_1.default.existsSync(abs)) {
            throw new Error(`--snapshot-dir not found: ${abs}`);
        }
        return abs;
    }
    return process.cwd();
}
async function findDaSilvaSchool() {
    const byId = await prisma.school.findUnique({
        where: { id: activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID },
        select: { id: true, name: true },
    });
    if (byId)
        return { ...byId, foundBy: "id" };
    const byEmail = await prisma.school.findFirst({
        where: { email: activateDaSilvaSubscription_1.DA_SILVA_OWNER_EMAIL },
        select: { id: true, name: true },
    });
    if (byEmail)
        return { ...byEmail, foundBy: "email" };
    const byName = await prisma.school.findFirst({
        where: { name: activateDaSilvaSubscription_1.DA_SILVA_SCHOOL_NAME },
        select: { id: true, name: true },
    });
    if (byName)
        return { ...byName, foundBy: "name" };
    return null;
}
async function assertProtections(schoolId) {
    const warnings = [];
    const platform = await prisma.school.findFirst({
        where: { name: { equals: PLATFORM_SCHOOL_NAME, mode: "insensitive" } },
        select: { id: true, name: true },
    });
    if (!platform) {
        warnings.push(`WARNING: ${PLATFORM_SCHOOL_NAME} not found — verify manually before apply`);
    }
    const superAdmin = await prisma.user.findFirst({
        where: { email: SUPER_ADMIN_EMAIL },
        select: { id: true, email: true, schoolId: true, role: true },
    });
    if (!superAdmin) {
        warnings.push(`WARNING: super admin ${SUPER_ADMIN_EMAIL} not found in database`);
    }
    else if (superAdmin.schoolId === schoolId) {
        throw new Error(`Refusing: super admin ${SUPER_ADMIN_EMAIL} is linked to Da Silva school — would be at risk`);
    }
    const otherSchools = await prisma.school.count({
        where: {
            id: { not: schoolId },
            NOT: { name: { equals: PLATFORM_SCHOOL_NAME, mode: "insensitive" } },
        },
    });
    if (otherSchools > 0) {
        const names = await prisma.school.findMany({
            where: {
                id: { not: schoolId },
                NOT: { name: { equals: PLATFORM_SCHOOL_NAME, mode: "insensitive" } },
            },
            select: { name: true },
        });
        warnings.push(`Other schools present (untouched): ${names.map((s) => s.name).join(", ")}`);
    }
    return warnings;
}
function validateSnapshotCounts(snapshot) {
    const blockers = [];
    if (!snapshot.manifestPresent)
        blockers.push("Snapshot manifest missing");
    if (snapshot.learners !== EXPECTED.learners) {
        blockers.push(`Snapshot learners=${snapshot.learners}, expected ${EXPECTED.learners}`);
    }
    if (snapshot.parents !== EXPECTED.parents) {
        blockers.push(`Snapshot parents=${snapshot.parents}, expected ${EXPECTED.parents}`);
    }
    if (snapshot.parentLinks !== EXPECTED.parentLinks) {
        blockers.push(`Snapshot parentLinks=${snapshot.parentLinks}, expected ${EXPECTED.parentLinks}`);
    }
    if (snapshot.familyAccounts !== EXPECTED.familyAccounts) {
        blockers.push(`Snapshot familyAccounts=${snapshot.familyAccounts}, expected ${EXPECTED.familyAccounts}`);
    }
    if (snapshot.billingPlanLearners !== EXPECTED.billingPlanLearners) {
        blockers.push(`Snapshot billingPlanLearners=${snapshot.billingPlanLearners}, expected ${EXPECTED.billingPlanLearners}`);
    }
    if (snapshot.ledgerEntries !== EXPECTED.ledgerEntries) {
        blockers.push(`Snapshot ledgerEntries=${snapshot.ledgerEntries}, expected ${EXPECTED.ledgerEntries}`);
    }
    if (snapshot.historyRows !== EXPECTED.historyRows) {
        blockers.push(`Snapshot historyRows=${snapshot.historyRows}, expected ${EXPECTED.historyRows}`);
    }
    if (!snapshot.logoPresent) {
        blockers.push(`Snapshot logo missing at ${DA_SILVA_LOGO_REL}`);
    }
    return blockers;
}
async function collectLiveCounts(schoolId) {
    const ledger = (0, billingLedgerStore_1.readSchoolLedger)(schoolId);
    const history = (0, kidesysTransactionHistoryStore_1.readSchoolKidesysHistory)(schoolId);
    const plans = (0, learnerBillingPlanStore_1.readSchoolBillingPlans)(schoolId);
    const accounts = await (0, statementAccounts_1.buildAccountsFromLearners)(schoolId, ledger);
    const netOutstanding = round2(accounts.reduce((sum, row) => sum + Number(row.balance), 0));
    const overPaid = round2(Math.abs(accounts
        .filter((row) => Number(row.balance) < 0)
        .reduce((sum, row) => sum + Number(row.balance), 0)));
    const subscription = await prisma.schoolSubscription.findUnique({
        where: { schoolId },
        select: { status: true, packageCode: true },
    });
    const owner = await prisma.user.findFirst({
        where: { schoolId, email: activateDaSilvaSubscription_1.DA_SILVA_OWNER_EMAIL },
        select: { email: true },
    });
    const familyAccountCount = await prisma.familyAccount.count({ where: { schoolId } });
    const dashboardUnlocked = subscription?.status === client_1.SchoolSubscriptionStatus.ACTIVE &&
        subscription?.packageCode === EXPECTED.subscriptionPackage;
    return {
        learners: await prisma.learner.count({ where: { schoolId } }),
        parents: await prisma.parent.count({ where: { schoolId } }),
        parentLinks: await prisma.parentLearnerLink.count({ where: { schoolId } }),
        classrooms: await prisma.classroom.count({ where: { schoolId } }),
        familyAccounts: familyAccountCount,
        statementAccounts: familyAccountCount,
        billingPlanLearners: Object.keys(plans).length,
        ledgerEntries: ledger.length,
        historyRows: history.length,
        netOutstanding,
        overPaid,
        subscriptionStatus: subscription?.status || null,
        subscriptionPackage: subscription?.packageCode || null,
        dashboardUnlocked,
        ownerEmail: owner?.email || null,
        ownerPresent: Boolean(owner),
    };
}
async function validateLive(schoolId) {
    const live = await collectLiveCounts(schoolId);
    const blockers = [];
    if (live.learners !== EXPECTED.learners) {
        blockers.push(`live learners=${live.learners}, expected ${EXPECTED.learners}`);
    }
    if (live.parents !== EXPECTED.parents) {
        blockers.push(`live parents=${live.parents}, expected ${EXPECTED.parents}`);
    }
    if (live.parentLinks !== EXPECTED.parentLinks) {
        blockers.push(`live parentLinks=${live.parentLinks}, expected ${EXPECTED.parentLinks}`);
    }
    if (live.classrooms !== EXPECTED.classrooms) {
        blockers.push(`live classrooms=${live.classrooms}, expected ${EXPECTED.classrooms}`);
    }
    if (live.familyAccounts !== EXPECTED.familyAccounts) {
        blockers.push(`live familyAccounts=${live.familyAccounts}, expected ${EXPECTED.familyAccounts}`);
    }
    if (live.statementAccounts !== EXPECTED.statementAccounts) {
        blockers.push(`live statementAccounts=${live.statementAccounts}, expected ${EXPECTED.statementAccounts}`);
    }
    if (live.billingPlanLearners !== EXPECTED.billingPlanLearners) {
        blockers.push(`live billingPlanLearners=${live.billingPlanLearners}, expected ${EXPECTED.billingPlanLearners}`);
    }
    if (live.ledgerEntries !== EXPECTED.ledgerEntries) {
        blockers.push(`live ledgerEntries=${live.ledgerEntries}, expected ${EXPECTED.ledgerEntries}`);
    }
    if (live.historyRows !== EXPECTED.historyRows) {
        blockers.push(`live historyRows=${live.historyRows}, expected ${EXPECTED.historyRows}`);
    }
    if (Math.abs(live.netOutstanding - EXPECTED.netOutstanding) >= 0.02) {
        blockers.push(`live netOutstanding=${live.netOutstanding}, expected ${EXPECTED.netOutstanding}`);
    }
    if (Math.abs(live.overPaid - EXPECTED.overPaid) >= 0.02) {
        blockers.push(`live overPaid=${live.overPaid}, expected ${EXPECTED.overPaid}`);
    }
    if (live.subscriptionStatus !== EXPECTED.subscriptionStatus) {
        blockers.push(`live subscription status=${live.subscriptionStatus}, expected ${EXPECTED.subscriptionStatus}`);
    }
    if (live.subscriptionPackage !== EXPECTED.subscriptionPackage) {
        blockers.push(`live subscription package=${live.subscriptionPackage}, expected ${EXPECTED.subscriptionPackage}`);
    }
    if (!live.dashboardUnlocked) {
        blockers.push("dashboardUnlocked is false");
    }
    if (!live.ownerPresent) {
        blockers.push(`owner ${activateDaSilvaSubscription_1.DA_SILVA_OWNER_EMAIL} missing`);
    }
    return { passed: blockers.length === 0, blockers, live };
}
function mergeSnapshotJsonFromMemory(liveFilePath, snapshotRaw, schoolId, fileName) {
    if (snapshotRaw === undefined) {
        return `skip ${fileName} (not in snapshot bundle)`;
    }
    const liveRaw = fs_1.default.existsSync(liveFilePath)
        ? JSON.parse(fs_1.default.readFileSync(liveFilePath, "utf8"))
        : null;
    if (fileName === "user-access.json") {
        const snap = snapshotRaw;
        const live = liveRaw || { users: {} };
        live.users = live.users || {};
        const snapUsers = snap.users || {};
        for (const [uid, meta] of Object.entries(snapUsers)) {
            const school = String(meta.schoolId || "");
            if (school === schoolId) {
                live.users[uid] = meta;
            }
        }
        fs_1.default.mkdirSync(path_1.default.dirname(liveFilePath), { recursive: true });
        fs_1.default.writeFileSync(liveFilePath, JSON.stringify(live, null, 2), "utf8");
        return `merged user-access for Da Silva`;
    }
    if (fileName === "banking-imports.json") {
        const live = liveRaw || { imports: [] };
        const snapImports = snapshotRaw.imports || [];
        const other = (live.imports || []).filter((r) => String(r.schoolId || "") !== schoolId);
        const daSilvaImports = snapImports.filter((r) => String(r.schoolId || "") === schoolId);
        live.imports = [...other, ...daSilvaImports];
        fs_1.default.mkdirSync(path_1.default.dirname(liveFilePath), { recursive: true });
        fs_1.default.writeFileSync(liveFilePath, JSON.stringify(live, null, 2), "utf8");
        return `merged banking-imports (${daSilvaImports.length} Da Silva row(s))`;
    }
    if (fileName === "communication-store.json") {
        const snap = snapshotRaw;
        const live = liveRaw || { schools: {} };
        live.schools = live.schools || {};
        if (snap.schools?.[schoolId]) {
            live.schools[schoolId] = snap.schools[schoolId];
        }
        fs_1.default.mkdirSync(path_1.default.dirname(liveFilePath), { recursive: true });
        fs_1.default.writeFileSync(liveFilePath, JSON.stringify(live, null, 2), "utf8");
        return `merged communication-store for Da Silva`;
    }
    if (fileName === "legal-document-history.json" && Array.isArray(snapshotRaw)) {
        const snapRows = snapshotRaw.filter((r) => String(r.schoolId || "") === schoolId);
        const liveArr = Array.isArray(liveRaw) ? liveRaw : [];
        const other = liveArr.filter((r) => String(r.schoolId || "") !== schoolId);
        const next = [...other, ...snapRows];
        fs_1.default.mkdirSync(path_1.default.dirname(liveFilePath), { recursive: true });
        fs_1.default.writeFileSync(liveFilePath, JSON.stringify(next, null, 2), "utf8");
        return `merged legal-document-history (${snapRows.length} Da Silva row(s))`;
    }
    if (snapshotRaw && typeof snapshotRaw === "object" && !Array.isArray(snapshotRaw)) {
        const snapObj = snapshotRaw;
        const liveObj = liveRaw && typeof liveRaw === "object" && !Array.isArray(liveRaw)
            ? liveRaw
            : {};
        if (snapObj[schoolId] !== undefined) {
            liveObj[schoolId] = snapObj[schoolId];
            fs_1.default.mkdirSync(path_1.default.dirname(liveFilePath), { recursive: true });
            fs_1.default.writeFileSync(liveFilePath, JSON.stringify(liveObj, null, 2), "utf8");
            const size = Array.isArray(snapObj[schoolId])
                ? snapObj[schoolId].length
                : typeof snapObj[schoolId] === "object" && snapObj[schoolId]
                    ? Object.keys(snapObj[schoolId]).length
                    : 1;
            return `replaced ${fileName} key (${size} item(s))`;
        }
    }
    return `skip ${fileName} (no Da Silva key in snapshot)`;
}
function applySnapshotBundle(bundle, liveRoot, schoolId) {
    const log = [];
    const liveData = path_1.default.join(liveRoot, "data");
    fs_1.default.mkdirSync(liveData, { recursive: true });
    for (const file of JSON_SNAPSHOT_FILES) {
        log.push(mergeSnapshotJsonFromMemory(path_1.default.join(liveData, file), bundle.jsonByFile[file], schoolId, file));
    }
    const liveManifestDir = path_1.default.join(liveRoot, "uploads", "migration-staging", schoolId);
    if (bundle.manifestDirBackup) {
        fs_1.default.rmSync(liveManifestDir, { recursive: true, force: true });
        fs_1.default.mkdirSync(path_1.default.dirname(liveManifestDir), { recursive: true });
        fs_1.default.cpSync(bundle.manifestDirBackup, liveManifestDir, { recursive: true });
        log.push(`restored migration-staging/${schoolId} from snapshot bundle`);
    }
    else {
        log.push("WARNING: snapshot manifest missing from bundle");
    }
    if (bundle.logoBytes?.length) {
        const liveLogo = path_1.default.join(liveRoot, DA_SILVA_LOGO_REL);
        fs_1.default.mkdirSync(path_1.default.dirname(liveLogo), { recursive: true });
        fs_1.default.writeFileSync(liveLogo, bundle.logoBytes);
        log.push(`restored ${DA_SILVA_LOGO_REL}`);
    }
    return log;
}
function runBackups(liveRoot) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const backupDir = path_1.default.join(liveRoot, "backups", `da-silva-replace-${stamp}`);
    fs_1.default.mkdirSync(backupDir, { recursive: true });
    const out = {};
    const dbUrl = String(process.env.DATABASE_URL || "").trim();
    if (dbUrl) {
        try {
            const dumpPath = path_1.default.join(backupDir, `educlear-pre-replace-${stamp}.dump`);
            (0, child_process_1.execSync)(`pg_dump "${dbUrl.replace(/"/g, '\\"')}" -Fc -f "${dumpPath}"`, {
                stdio: "inherit",
                env: process.env,
            });
            out.db = dumpPath;
        }
        catch (e) {
            console.warn(`WARNING: pg_dump failed — ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    const dataDir = path_1.default.join(liveRoot, "data");
    if (fs_1.default.existsSync(dataDir)) {
        const tarPath = path_1.default.join(backupDir, `educlear-data-${stamp}.tar.gz`);
        (0, child_process_1.execSync)(`tar -czf "${tarPath}" -C "${liveRoot}" data`, { stdio: "inherit" });
        out.data = tarPath;
    }
    const logosDir = path_1.default.join(liveRoot, "uploads", "school-logos");
    if (fs_1.default.existsSync(logosDir)) {
        const tarPath = path_1.default.join(backupDir, `educlear-school-logos-${stamp}.tar.gz`);
        (0, child_process_1.execSync)(`tar -czf "${tarPath}" -C "${liveRoot}/uploads" school-logos`, {
            stdio: "inherit",
        });
        out.logos = tarPath;
    }
    return out;
}
async function purgeDaSilvaSubscriptionRows(schoolId) {
    await prisma.subscriptionPaymentLog.deleteMany({ where: { schoolId } });
    const invoices = await prisma.subscriptionInvoice.deleteMany({ where: { schoolId } });
    const subs = await prisma.schoolSubscription.deleteMany({ where: { schoolId } });
    return invoices.count + subs.count;
}
async function purgeDaSilvaOnly(schoolId) {
    const { purgeImportedSchoolData, clearJsonStoresForSchools } = await Promise.resolve().then(() => __importStar(require("./school-data-cleanup")));
    const school = await prisma.school.findUnique({
        where: { id: schoolId },
        select: { id: true, email: true },
    });
    if (!school)
        throw new Error(`School not found: ${schoolId}`);
    const registrationOwners = await prisma.user
        .findMany({
        where: { schoolId, isActive: true },
        select: { id: true, email: true, fullName: true },
    })
        .then((users) => users.filter((u) => (0, ownerProvisioning_1.isRegistrationProvisionedOwner)(u, school)));
    const prismaPurged = await purgeImportedSchoolData(schoolId);
    const subscriptionRows = await purgeDaSilvaSubscriptionRows(schoolId);
    const jsonCleared = clearJsonStoresForSchools([schoolId]);
    let usersDeleted = 0;
    if (registrationOwners.length === 0) {
        const users = await prisma.user.findMany({
            where: { schoolId },
            select: { id: true },
        });
        if (users.length) {
            await prisma.userPermissionOverride.deleteMany({
                where: { userId: { in: users.map((u) => u.id) } },
            });
            usersDeleted = (await prisma.user.deleteMany({
                where: {
                    schoolId,
                    email: { not: activateDaSilvaSubscription_1.DA_SILVA_OWNER_EMAIL },
                },
            })).count;
        }
    }
    return {
        prismaPurged,
        subscriptionRows,
        jsonCleared,
        usersDeleted,
        preservedOwners: registrationOwners.map((u) => u.email),
    };
}
async function main() {
    const liveRoot = process.cwd();
    const snapshotDir = resolveSnapshotDir();
    const school = await findDaSilvaSchool();
    if (!school) {
        console.error("BLOCKER: Da Silva Academy not found (id / email / name)");
        process.exit(1);
    }
    (0, activateDaSilvaSubscription_1.setDaSilvaResolvedSchoolId)(school.id);
    const protectionWarnings = await assertProtections(school.id);
    const snapshotBundle = captureSnapshotBundle(snapshotDir, school.id);
    const snapshot = snapshotCountsFromBundle(snapshotBundle);
    const snapshotBlockers = validateSnapshotCounts(snapshot);
    const preValidation = await validateLive(school.id);
    const report = {
        mode: APPLY ? "APPLY" : "DRY_RUN",
        generatedAt: new Date().toISOString(),
        school: { id: school.id, name: school.name, foundBy: school.foundBy },
        snapshotDir,
        liveRoot,
        expected: EXPECTED,
        snapshot,
        snapshotBlockers,
        liveBefore: preValidation.live,
        protectionWarnings,
    };
    const txt = [
        `Da Silva live snapshot replace — ${APPLY ? "APPLY" : "DRY RUN"}`,
        `Generated: ${report.generatedAt}`,
        "",
        `School: ${school.name} (${school.id}) found by ${school.foundBy}`,
        `Snapshot: ${snapshotDir}`,
        "",
    ];
    if (snapshotBlockers.length) {
        txt.push("=== SNAPSHOT BLOCKERS ===");
        for (const b of snapshotBlockers)
            txt.push(`  ! ${b}`);
        txt.push("");
    }
    if (protectionWarnings.length) {
        txt.push("=== PROTECTION NOTES ===");
        for (const w of protectionWarnings)
            txt.push(`  ${w}`);
        txt.push("");
    }
    if (preValidation.passed) {
        txt.push("=== VERDICT ===");
        txt.push("READY TO DEPLOY");
        txt.push("(Live already matches approved localhost snapshot — no changes needed)");
        writeReports(liveRoot, report, txt);
        console.log(txt.join("\n"));
        process.exit(0);
    }
    txt.push("=== LIVE BEFORE ===");
    txt.push(JSON.stringify(preValidation.live, null, 2));
    txt.push("");
    txt.push("=== LIVE VALIDATION GAPS ===");
    for (const b of preValidation.blockers)
        txt.push(`  ! ${b}`);
    txt.push("");
    if (!APPLY) {
        txt.push("=== PLANNED ACTIONS (--apply) ===");
        txt.push("  1. Backup live DB (pg_dump) + data/ + school-logos/");
        txt.push("  2. Purge Da Silva Prisma imported rows + subscription rows");
        txt.push("  3. Clear Da Silva JSON store keys");
        txt.push("  4. Merge approved snapshot JSON + manifest + logo");
        txt.push("  5. Import Prisma rows from manifest (idempotent upserts)");
        txt.push("  6. Activate UNLIMITED ACTIVE subscription");
        txt.push("  7. Re-validate counts and balances");
        txt.push("");
        txt.push(`Set ${CONFIRM_ENV}=true and re-run with --apply after review.`);
        writeReports(liveRoot, report, txt);
        console.log(txt.join("\n"));
        process.exit(snapshotBlockers.length ? 1 : 0);
    }
    if (snapshotBlockers.length) {
        txt.push("=== VERDICT ===");
        txt.push("BLOCKER: snapshot invalid — fix snapshot before apply");
        writeReports(liveRoot, report, txt);
        console.log(txt.join("\n"));
        process.exit(1);
    }
    if (String(process.env[CONFIRM_ENV] || "").trim().toLowerCase() !== "true") {
        txt.push("=== VERDICT ===");
        txt.push(`BLOCKER: set ${CONFIRM_ENV}=true to execute apply`);
        writeReports(liveRoot, report, txt);
        console.log(txt.join("\n"));
        process.exit(1);
    }
    txt.push("=== APPLY ===");
    const backups = runBackups(liveRoot);
    report.backups = backups;
    txt.push(`  DB backup: ${backups.db || "(skipped — no DATABASE_URL)"}`);
    txt.push(`  Data backup: ${backups.data || "(skipped)"}`);
    txt.push(`  Logos backup: ${backups.logos || "(skipped)"}`);
    const purgeResult = await purgeDaSilvaOnly(school.id);
    report.purge = purgeResult;
    txt.push("  Purged Da Silva dirty data");
    const assetLog = applySnapshotBundle(snapshotBundle, liveRoot, school.id);
    report.snapshotCopy = assetLog;
    for (const line of assetLog)
        txt.push(`  ${line}`);
    const importOut = (0, child_process_1.execSync)(`npx tsx scripts/da-silva-import-manifest-only.ts "${school.id}"`, {
        cwd: liveRoot,
        encoding: "utf8",
        env: process.env,
    });
    const importStats = JSON.parse(importOut.trim().split("\n").pop() || "{}");
    report.import = importStats;
    txt.push(`  Imported: classrooms=${importStats.classrooms} familyAccounts=${importStats.familyAccounts} parents=${importStats.parents} learners=${importStats.learners} links=${importStats.parentLinks}`);
    await (0, activateDaSilvaSubscription_1.ensureDaSilvaAcademySubscription)();
    txt.push("  Subscription: UNLIMITED ACTIVE");
    const postValidation = await validateLive(school.id);
    report.liveAfter = postValidation.live;
    report.blockers = postValidation.blockers;
    txt.push("");
    txt.push("=== LIVE AFTER ===");
    txt.push(JSON.stringify(postValidation.live, null, 2));
    txt.push("");
    if (postValidation.passed) {
        txt.push("=== VERDICT ===");
        txt.push("READY TO DEPLOY");
        writeReports(liveRoot, report, txt);
        console.log(txt.join("\n"));
        process.exit(0);
    }
    txt.push("=== VERDICT ===");
    txt.push("BLOCKER: post-import validation failed");
    for (const b of postValidation.blockers)
        txt.push(`  ! ${b}`);
    writeReports(liveRoot, report, txt);
    console.log(txt.join("\n"));
    process.exit(1);
}
function writeReports(liveRoot, report, txt) {
    const jsonOut = path_1.default.join(liveRoot, "da-silva-live-snapshot-replace.json");
    const txtOut = path_1.default.join(liveRoot, "da-silva-live-snapshot-replace.txt");
    fs_1.default.writeFileSync(jsonOut, JSON.stringify(report, null, 2), "utf8");
    fs_1.default.writeFileSync(txtOut, txt.join("\n"), "utf8");
    console.log(`\nReport: ${jsonOut}`);
    console.log(`Report: ${txtOut}`);
}
main()
    .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
