"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.classDisplayFromMatchKeySuffix = classDisplayFromMatchKeySuffix;
exports.ensureDaSilvaAcademyProduction = ensureDaSilvaAcademyProduction;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const activateDaSilvaSubscription_1 = require("./activateDaSilvaSubscription");
const daSilvaFinalImportGate_1 = require("./daSilvaMigration/daSilvaFinalImportGate");
const prisma_1 = require("../prisma");
const classroomNormalization_1 = require("../utils/classroomNormalization");
const learnerBillingPlanStore_1 = require("../utils/learnerBillingPlanStore");
const billingLedgerStore_1 = require("../utils/billingLedgerStore");
const kidesysTransactionHistoryStore_1 = require("../utils/kidesysTransactionHistoryStore");
const kideesysSpreadsheet_1 = require("../utils/kideesysSpreadsheet");
const userAccessStore_1 = require("../utils/userAccessStore");
const daSilvaSchoolResolve_1 = require("./daSilvaSchoolResolve");
const runtime_1 = require("./runtime");
const DA_SILVA_OWNER_USER_ID = "cmpimyjkj00013lhz6kkxr9xu";
const DA_SILVA_LOGO_URL = "/uploads/school-logos/da-silva-academy-logo.png";
const DA_SILVA_PROJECT_ID = "dasilva-mpin5qzg-xn4cxh";
const MANIFEST_PATH = path_1.default.join(process.cwd(), "uploads", "migration-staging", activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID, `dasilva-${DA_SILVA_PROJECT_ID}.manifest.json`);
function loadProductionManifest() {
    if (!fs_1.default.existsSync(MANIFEST_PATH))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(MANIFEST_PATH, "utf8"));
    }
    catch {
        return null;
    }
}
function parseStoredMatchKey(matchKey) {
    const pipe = matchKey.indexOf("|");
    if (pipe === -1) {
        return { fullNameNormalized: matchKey.trim(), classMatchKey: "" };
    }
    return {
        fullNameNormalized: matchKey.slice(0, pipe).trim(),
        classMatchKey: matchKey.slice(pipe + 1).trim(),
    };
}
function titleCaseWords(text) {
    return text
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}
/** Reconstruct display class name from manifest match-key suffix (e.g. 6|b → Grade 6 B). */
function classDisplayFromMatchKeySuffix(classMatchKey) {
    const key = String(classMatchKey || "").trim().toLowerCase();
    if (!key)
        return "Unassigned";
    if (key.includes("creche") || key === "ps" || key.startsWith("ps|")) {
        return "Pre-School Creche";
    }
    const parts = key.split("|").filter(Boolean);
    if (parts.length >= 2 && /^\d{1,2}$/.test(parts[0])) {
        const grade = parts[0];
        const stream = parts[1].toUpperCase();
        const guess = stream.length === 1
            ? `Grade ${grade} ${stream}`
            : `Grade ${grade} / ${stream}`;
        const norm = (0, classroomNormalization_1.normalizeClassroomInput)(guess);
        return norm.classroomName || guess;
    }
    const norm = (0, classroomNormalization_1.normalizeClassroomInput)(classMatchKey);
    return norm.classroomName || titleCaseWords(classMatchKey.replace(/\|/g, " "));
}
function humanizeNormalizedName(normalized) {
    return titleCaseWords(normalized);
}
function sumBillingPlan(items) {
    return items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
}
/** Canonical JSON/manifest key; production DB row may use a different id after registration. */
const DA_SILVA_DATA_SCHOOL_ID = activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID;
async function findExistingDaSilvaSchool() {
    const byId = await prisma_1.prisma.school.findUnique({
        where: { id: activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID },
        select: { id: true },
    });
    if (byId) {
        return { id: byId.id, foundBy: "id" };
    }
    const byEmail = await prisma_1.prisma.school.findFirst({
        where: { email: activateDaSilvaSubscription_1.DA_SILVA_OWNER_EMAIL },
        select: { id: true },
    });
    if (byEmail) {
        return { id: byEmail.id, foundBy: "email" };
    }
    const byName = await prisma_1.prisma.school.findFirst({
        where: { name: activateDaSilvaSubscription_1.DA_SILVA_SCHOOL_NAME },
        select: { id: true },
    });
    if (byName) {
        return { id: byName.id, foundBy: "name" };
    }
    return null;
}
async function ensureSchoolRecord() {
    const logoPath = path_1.default.join(process.cwd(), "uploads", "school-logos", "da-silva-academy-logo.png");
    const logoExists = fs_1.default.existsSync(logoPath);
    const schoolUpdate = {
        name: activateDaSilvaSubscription_1.DA_SILVA_SCHOOL_NAME,
        email: activateDaSilvaSubscription_1.DA_SILVA_OWNER_EMAIL,
        ...(logoExists ? { logoUrl: DA_SILVA_LOGO_URL } : {}),
    };
    const existing = await findExistingDaSilvaSchool();
    if (existing?.foundBy === "email") {
        console.log("[startup] Da Silva existing school found by email");
    }
    else if (existing?.foundBy === "name") {
        console.log("[startup] Da Silva existing school found by name");
    }
    if (existing) {
        await prisma_1.prisma.school.update({
            where: { id: existing.id },
            data: schoolUpdate,
        });
        (0, activateDaSilvaSubscription_1.setDaSilvaResolvedSchoolId)(existing.id);
        return existing.id;
    }
    await prisma_1.prisma.school.create({
        data: {
            id: activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID,
            name: activateDaSilvaSubscription_1.DA_SILVA_SCHOOL_NAME,
            email: activateDaSilvaSubscription_1.DA_SILVA_OWNER_EMAIL,
            logoUrl: logoExists ? DA_SILVA_LOGO_URL : null,
        },
    });
    (0, activateDaSilvaSubscription_1.setDaSilvaResolvedSchoolId)(activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID);
    return activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID;
}
async function ensureOwnerLink() {
    const schoolId = (0, activateDaSilvaSubscription_1.getDaSilvaResolvedSchoolId)();
    let user = (await prisma_1.prisma.user.findUnique({
        where: { id: DA_SILVA_OWNER_USER_ID },
        select: { id: true, email: true, schoolId: true, passwordHash: true },
    })) ||
        (await prisma_1.prisma.user.findFirst({
            where: { email: activateDaSilvaSubscription_1.DA_SILVA_OWNER_EMAIL },
            select: { id: true, email: true, schoolId: true, passwordHash: true },
        }));
    if (!user) {
        console.warn("[startup] Da Silva owner user not in database — login via register-school reclaim (password unchanged by startup)");
        return;
    }
    if (user.schoolId !== schoolId) {
        await prisma_1.prisma.user.update({
            where: { id: user.id },
            data: { schoolId },
        });
        console.log(`[startup] Da Silva owner linked to school ${schoolId} (user ${user.id}, password unchanged)`);
    }
    else {
        console.log(`[startup] Da Silva owner already linked (user ${user.id}, password unchanged)`);
    }
    const existingMeta = (0, userAccessStore_1.getUserAccessMeta)(user.id);
    if (!existingMeta) {
        const storePath = path_1.default.join(process.cwd(), "data", "user-access.json");
        if (fs_1.default.existsSync(storePath)) {
            try {
                const store = JSON.parse(fs_1.default.readFileSync(storePath, "utf8"));
                const fromFile = store.users?.[DA_SILVA_OWNER_USER_ID] || store.users?.[user.id];
                if (fromFile) {
                    (0, userAccessStore_1.setUserAccessMeta)(user.id, { ...fromFile, schoolId });
                }
            }
            catch {
                // non-fatal
            }
        }
    }
}
function verifyJsonStores() {
    const schoolId = DA_SILVA_DATA_SCHOOL_ID;
    const plans = (0, learnerBillingPlanStore_1.readSchoolBillingPlans)(schoolId);
    const planLearners = Object.keys(plans).length;
    const ledger = (0, billingLedgerStore_1.readSchoolLedger)(schoolId);
    const history = (0, kidesysTransactionHistoryStore_1.readSchoolKidesysHistory)(schoolId);
    console.log(`[startup] Da Silva JSON stores: billing plans=${planLearners} learners, ledger=${ledger.length} entries, kidesys history=${history.length} rows`);
}
async function importFromManifest(manifest) {
    const schoolId = (0, activateDaSilvaSubscription_1.getDaSilvaResolvedSchoolId)();
    const matchEntries = Object.entries(manifest.matchKeyToLearnerId || {});
    const accountToLearner = manifest.accountToLearnerId || {};
    const stagedParents = manifest.stagedParentIds || {};
    const billingPlans = (0, learnerBillingPlanStore_1.readSchoolBillingPlans)(DA_SILVA_DATA_SCHOOL_ID);
    const classNames = new Set();
    for (const matchKey of matchEntries.map(([k]) => k)) {
        const { classMatchKey } = parseStoredMatchKey(matchKey);
        classNames.add(classDisplayFromMatchKeySuffix(classMatchKey));
    }
    let classroomsCreated = 0;
    for (const name of classNames) {
        if (!name)
            continue;
        await prisma_1.prisma.classroom.upsert({
            where: { schoolId_name: { schoolId, name } },
            create: { schoolId, name },
            update: {},
        });
        classroomsCreated += 1;
    }
    const accountNos = Object.keys(accountToLearner);
    const familyIdByAccount = new Map();
    for (const accountNo of accountNos) {
        const learnerId = accountToLearner[accountNo];
        const matchEntry = matchEntries.find(([, id]) => id === learnerId);
        const lastName = matchEntry
            ? (0, kideesysSpreadsheet_1.splitFullName)(humanizeNormalizedName(parseStoredMatchKey(matchEntry[0]).fullNameNormalized))
                .lastName
            : accountNo;
        const fa = await prisma_1.prisma.familyAccount.upsert({
            where: { accountRef: accountNo },
            create: {
                schoolId,
                accountRef: accountNo,
                familyName: lastName || accountNo,
            },
            update: {},
        });
        familyIdByAccount.set(accountNo, fa.id);
    }
    let parentsCreated = 0;
    const parentIdSet = new Set();
    for (const [stageKey, parentId] of Object.entries(stagedParents)) {
        if (parentIdSet.has(parentId))
            continue;
        parentIdSet.add(parentId);
        const colon = stageKey.lastIndexOf(":");
        const matchKey = colon >= 0 ? stageKey.slice(0, colon) : stageKey;
        const learnerId = manifest.matchKeyToLearnerId?.[matchKey];
        const accountEntry = Object.entries(accountToLearner).find(([, lid]) => lid === learnerId);
        const accountNo = accountEntry?.[0] || "";
        const familyAccountId = accountNo ? familyIdByAccount.get(accountNo) || null : null;
        const { fullNameNormalized } = parseStoredMatchKey(matchKey);
        const { firstName, lastName } = (0, kideesysSpreadsheet_1.splitFullName)(humanizeNormalizedName(fullNameNormalized));
        const digits = parentId.replace(/\D/g, "");
        const placeholderCell = `07${digits.slice(-8).padStart(8, "0")}`;
        await prisma_1.prisma.parent.upsert({
            where: { id: parentId },
            create: {
                id: parentId,
                schoolId,
                familyAccountId,
                firstName: firstName || "Family",
                surname: lastName || "Account",
                cellNo: placeholderCell,
                relationship: "Guardian",
            },
            update: {
                schoolId,
                familyAccountId,
            },
        });
        parentsCreated += 1;
    }
    let learnersUpserted = 0;
    for (const [matchKey, learnerId] of matchEntries) {
        const { fullNameNormalized, classMatchKey } = parseStoredMatchKey(matchKey);
        const fullName = humanizeNormalizedName(fullNameNormalized);
        const { firstName, lastName } = (0, kideesysSpreadsheet_1.splitFullName)(fullName);
        const className = classDisplayFromMatchKeySuffix(classMatchKey);
        const norm = (0, classroomNormalization_1.normalizeClassroomInput)(className);
        const accountEntry = Object.entries(accountToLearner).find(([, lid]) => lid === learnerId);
        const accountNo = accountEntry?.[0] || "";
        const familyAccountId = accountNo ? familyIdByAccount.get(accountNo) || null : null;
        const planItems = billingPlans[learnerId] || [];
        const billingTotal = sumBillingPlan(planItems);
        await prisma_1.prisma.learner.upsert({
            where: { id: learnerId },
            create: {
                id: learnerId,
                schoolId,
                familyAccountId,
                firstName: firstName || fullName,
                lastName: lastName || "",
                grade: norm.gradeLabel || className,
                className,
                admissionNo: accountNo || null,
                totalFee: billingTotal,
                tuitionFee: billingTotal,
            },
            update: {
                schoolId,
                familyAccountId,
                firstName: firstName || fullName,
                lastName: lastName || "",
                grade: norm.gradeLabel || className,
                className,
                admissionNo: accountNo || null,
                totalFee: billingTotal,
                tuitionFee: billingTotal,
            },
        });
        learnersUpserted += 1;
    }
    let linksUpserted = 0;
    for (const [stageKey, parentId] of Object.entries(stagedParents)) {
        const colon = stageKey.lastIndexOf(":");
        const matchKey = colon >= 0 ? stageKey.slice(0, colon) : stageKey;
        const learnerId = manifest.matchKeyToLearnerId?.[matchKey];
        if (!learnerId || !parentId)
            continue;
        await prisma_1.prisma.parentLearnerLink.upsert({
            where: { parentId_learnerId: { parentId, learnerId } },
            create: {
                schoolId,
                parentId,
                learnerId,
                relation: "Guardian",
                isPrimary: stageKey.endsWith(":0"),
            },
            update: { schoolId },
        });
        linksUpserted += 1;
    }
    console.log(`[startup] Da Silva import: classrooms=${classroomsCreated}, familyAccounts=${accountNos.length}, parents=${parentsCreated}, learners=${learnersUpserted}, parentLinks=${linksUpserted}`);
}
/**
 * Idempotent production ensure for Da Silva Academy only.
 * Rebuilds Prisma rows from the verified manifest + JSON billing files when the school is missing or incomplete.
 */
async function ensureDaSilvaAcademyProduction() {
    if (!(0, runtime_1.isProductionOrGoLive)()) {
        return;
    }
    const existingLookup = await findExistingDaSilvaSchool();
    if (existingLookup) {
        (0, activateDaSilvaSubscription_1.setDaSilvaResolvedSchoolId)(existingLookup.id);
    }
    const schoolId = (0, activateDaSilvaSubscription_1.getDaSilvaResolvedSchoolId)();
    const existing = existingLookup ? { id: existingLookup.id } : null;
    const learnerCount = existing
        ? await prisma_1.prisma.learner.count({ where: { schoolId } })
        : 0;
    const manifest = loadProductionManifest();
    if (!manifest) {
        if (!existing) {
            console.error(`[startup] Da Silva production manifest missing at ${MANIFEST_PATH} — cannot import school`);
        }
        return;
    }
    const expectedLearners = daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.learners;
    if (existing && learnerCount === expectedLearners) {
        await ensureSchoolRecord();
        await ensureOwnerLink();
        verifyJsonStores();
        console.log(`[startup] Da Silva school already present (${learnerCount} learners) — import skipped`);
        return;
    }
    if (existing && learnerCount > expectedLearners) {
        await ensureSchoolRecord();
        await ensureOwnerLink();
        verifyJsonStores();
        await (0, daSilvaSchoolResolve_1.refreshDaSilvaSchoolIdCache)();
        console.warn(`[startup] Da Silva go-live: ${learnerCount} learners on file (import snapshot expects ${expectedLearners}) — keeping live data, skipping import`);
        return;
    }
    console.log("[startup] Da Silva school ensure/import starting…");
    await ensureSchoolRecord();
    await importFromManifest(manifest);
    await ensureOwnerLink();
    verifyJsonStores();
    const finalLearners = await prisma_1.prisma.learner.count({ where: { schoolId } });
    const finalParents = await prisma_1.prisma.parent.count({ where: { schoolId } });
    const finalClassrooms = await prisma_1.prisma.classroom.count({ where: { schoolId } });
    console.log(`[startup] Da Silva school ensured/imported: ${activateDaSilvaSubscription_1.DA_SILVA_SCHOOL_NAME} (${schoolId}) learners=${finalLearners} parents=${finalParents} classrooms=${finalClassrooms}`);
    if (finalLearners < expectedLearners) {
        console.warn(`[startup] Da Silva learner count ${finalLearners} is below expected ${expectedLearners}`);
    }
}
