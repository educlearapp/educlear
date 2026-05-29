"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DA_SILVA_SCHOOL_NAME = exports.DA_SILVA_OWNER_EMAIL = exports.DA_SILVA_ACADEMY_SCHOOL_ID = void 0;
exports.getDaSilvaResolvedSchoolId = getDaSilvaResolvedSchoolId;
exports.setDaSilvaResolvedSchoolId = setDaSilvaResolvedSchoolId;
exports.ensureDaSilvaAcademySubscription = ensureDaSilvaAcademySubscription;
const client_1 = require("@prisma/client");
const prisma_1 = require("../prisma");
const payfastService_1 = require("./payfastService");
const ensureEduClearPackages_1 = require("./ensureEduClearPackages");
exports.DA_SILVA_ACADEMY_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
exports.DA_SILVA_OWNER_EMAIL = "dasilvaacademy@gmail.com";
exports.DA_SILVA_SCHOOL_NAME = "Da Silva Academy";
let daSilvaResolvedSchoolId = exports.DA_SILVA_ACADEMY_SCHOOL_ID;
/** School id for Prisma after ensure (may differ from canonical id when registered under another row). */
function getDaSilvaResolvedSchoolId() {
    return daSilvaResolvedSchoolId;
}
function setDaSilvaResolvedSchoolId(id) {
    const key = String(id || "").trim();
    if (!key)
        return;
    daSilvaResolvedSchoolId = key;
}
const TARGET_PACKAGE = "UNLIMITED";
/**
 * Idempotent UNLIMITED / ACTIVE subscription for Da Silva Academy only.
 * Safe to run on every production boot after the school record exists.
 */
async function ensureDaSilvaAcademySubscription(requestedSchoolId) {
    const hintId = String(requestedSchoolId || getDaSilvaResolvedSchoolId() || "").trim();
    let school = hintId &&
        (await prisma_1.prisma.school.findUnique({
            where: { id: hintId },
            select: { id: true, name: true },
        }));
    if (!school) {
        school =
            (await prisma_1.prisma.school.findFirst({
                where: { email: exports.DA_SILVA_OWNER_EMAIL },
                select: { id: true, name: true },
            })) ||
                (await prisma_1.prisma.school.findFirst({
                    where: { name: exports.DA_SILVA_SCHOOL_NAME },
                    select: { id: true, name: true },
                }));
    }
    if (!school) {
        throw new Error(`School not found: ${hintId || exports.DA_SILVA_ACADEMY_SCHOOL_ID}`);
    }
    setDaSilvaResolvedSchoolId(school.id);
    await (0, ensureEduClearPackages_1.ensureEduClearPackages)();
    const unlimitedPackage = await prisma_1.prisma.eduClearPackage.findUnique({
        where: { code: TARGET_PACKAGE },
        select: { id: true, code: true, name: true },
    });
    if (!unlimitedPackage) {
        throw new Error(`Package ${TARGET_PACKAGE} missing after ensureEduClearPackages`);
    }
    const activatedAt = new Date();
    const currentPeriodStart = new Date(activatedAt.getFullYear(), activatedAt.getMonth(), activatedAt.getDate());
    const currentPeriodEnd = (0, payfastService_1.addOneCalendarMonth)(currentPeriodStart);
    const resolvedSchoolId = school.id;
    await prisma_1.prisma.schoolSubscription.upsert({
        where: { schoolId: resolvedSchoolId },
        create: {
            schoolId: resolvedSchoolId,
            packageId: unlimitedPackage.id,
            packageCode: TARGET_PACKAGE,
            status: client_1.SchoolSubscriptionStatus.ACTIVE,
            currentPeriodStart,
            currentPeriodEnd,
            activatedAt,
            cancelledAt: null,
        },
        update: {
            packageId: unlimitedPackage.id,
            packageCode: TARGET_PACKAGE,
            status: client_1.SchoolSubscriptionStatus.ACTIVE,
            currentPeriodStart,
            currentPeriodEnd,
            activatedAt,
            cancelledAt: null,
        },
    });
    console.log(`[activateDaSilva] ${school.name} (${resolvedSchoolId}): ${TARGET_PACKAGE} ACTIVE until ${currentPeriodEnd.toISOString()}`);
    console.log(`[activateDaSilva] dashboardUnlocked=true (subscription status ACTIVE)`);
}
