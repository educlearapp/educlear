"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Create a brand-new empty Da Silva Academy + owner (migration testing).
 *
 *   npx tsx scripts/create-fresh-da-silva-school.ts
 *
 * Requires no existing school row for Da Silva / owner email (run reset-da-silva-school first if needed).
 */
require("dotenv/config");
const client_1 = require("@prisma/client");
const activateDaSilvaSubscription_1 = require("../src/services/activateDaSilvaSubscription");
const authDiagnostics_1 = require("../src/services/authDiagnostics");
const authCredentials_1 = require("../src/services/authCredentials");
const schoolEmailService_1 = require("../src/services/schoolEmailService");
const userPermissions_1 = require("../src/utils/userPermissions");
const userAccessStore_1 = require("../src/utils/userAccessStore");
const daSilvaEmptyState_1 = require("./lib/daSilvaEmptyState");
const prisma = new client_1.PrismaClient();
const OWNER_EMAIL = (0, authCredentials_1.normalizeAuthEmail)(activateDaSilvaSubscription_1.DA_SILVA_OWNER_EMAIL);
const OWNER_PASSWORD = "Tmjs0407@";
const OWNER_FULL_NAME = "Da Silva Academy";
async function assertNoExistingDaSilva() {
    const schools = await prisma.school.findMany({
        where: {
            OR: [
                { id: activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID },
                { email: { equals: OWNER_EMAIL, mode: "insensitive" } },
                { name: { equals: activateDaSilvaSubscription_1.DA_SILVA_SCHOOL_NAME, mode: "insensitive" } },
                { name: { contains: "Da Silva Academy", mode: "insensitive" } },
            ],
        },
        select: { id: true, name: true },
    });
    if (schools.length) {
        throw new Error(`Da Silva school already exists (${schools.map((s) => `${s.name} ${s.id}`).join(", ")}). Run reset-da-silva-school.ts --confirm first.`);
    }
    const users = await prisma.user.findMany({
        where: { email: { equals: OWNER_EMAIL, mode: "insensitive" } },
        select: { id: true, schoolId: true },
    });
    if (users.length) {
        throw new Error(`Owner user already exists for ${OWNER_EMAIL}. Run reset-da-silva-school.ts --confirm first.`);
    }
}
async function main() {
    await assertNoExistingDaSilva();
    const passwordHash = await (0, authCredentials_1.hashAuthPassword)(OWNER_PASSWORD);
    const ownerRole = (0, userPermissions_1.prismaRoleForAppRole)("Owner");
    const school = await prisma.school.create({
        data: {
            id: activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID,
            name: activateDaSilvaSubscription_1.DA_SILVA_SCHOOL_NAME,
            email: OWNER_EMAIL,
        },
        select: { id: true, name: true, email: true },
    });
    (0, activateDaSilvaSubscription_1.setDaSilvaResolvedSchoolId)(school.id);
    const owner = await prisma.user.create({
        data: {
            schoolId: school.id,
            email: OWNER_EMAIL,
            fullName: OWNER_FULL_NAME,
            passwordHash,
            role: ownerRole,
            isActive: true,
        },
        select: {
            id: true,
            schoolId: true,
            email: true,
            role: true,
            isActive: true,
            passwordHash: true,
        },
    });
    (0, userAccessStore_1.setUserAccessMeta)(owner.id, {
        schoolId: school.id,
        firstName: "Da Silva",
        surname: "Academy",
        appRole: "Owner",
        permissions: (0, userPermissions_1.permissionsForRole)("Owner"),
        lastLoginAt: null,
    });
    try {
        await (0, schoolEmailService_1.seedSchoolEmailDefaults)(school.id);
    }
    catch (err) {
        console.warn("[create-fresh-da-silva] seedSchoolEmailDefaults:", err);
    }
    const purgeScope = await (0, daSilvaEmptyState_1.buildDaSilvaPurgeScope)(prisma, school.id);
    const jsonRemoved = (0, daSilvaEmptyState_1.purgeDaSilvaJsonStores)(purgeScope);
    const passwordOk = await (0, authCredentials_1.compareAuthPassword)(OWNER_PASSWORD, owner.passwordHash);
    const diag = await (0, authDiagnostics_1.buildAuthDiagnostics)(OWNER_EMAIL, { testPassword: OWNER_PASSWORD });
    const counts = await prisma.$transaction([
        prisma.learner.count({ where: { schoolId: school.id } }),
        prisma.parent.count({ where: { schoolId: school.id } }),
        prisma.schoolSubscription.count({ where: { schoolId: school.id } }),
        prisma.billingDeposit.count({ where: { schoolId: school.id } }),
    ]);
    console.log("");
    console.log("=== Fresh Da Silva Academy created ===");
    console.log(`school id:            ${school.id}`);
    console.log(`school name:          ${school.name}`);
    console.log(`owner user id:        ${owner.id}`);
    console.log(`login email:          ${OWNER_EMAIL}`);
    console.log(`role:                 ${owner.role}`);
    console.log(`password verify:      ${passwordOk ? "MATCH" : "MISMATCH"}`);
    console.log(`login-ready:          ${diag.loginReady ? "YES" : "NO"}`);
    console.log(`learners:             ${counts[0]}`);
    console.log(`parents:              ${counts[1]}`);
    console.log(`subscriptions:        ${counts[2]}`);
    console.log(`billing deposits:     ${counts[3]}`);
    if (jsonRemoved && Object.keys(jsonRemoved).length) {
        console.log(`json stores purged:   ${JSON.stringify(jsonRemoved)}`);
    }
    if (diag.issues.length) {
        console.log(`diagnostics:            ${diag.issues.join("; ")}`);
    }
    const dataClean = counts[0] === 0 &&
        counts[1] === 0 &&
        counts[2] === 0 &&
        counts[3] === 0;
    if (!passwordOk || !diag.loginReady || !dataClean) {
        process.exitCode = 1;
    }
}
main()
    .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
