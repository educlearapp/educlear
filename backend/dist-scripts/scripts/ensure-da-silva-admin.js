"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Create or permanently repair Da Silva Academy owner login (idempotent).
 *
 *   npx tsx scripts/ensure-da-silva-admin.ts
 */
require("dotenv/config");
const client_1 = require("@prisma/client");
const activateDaSilvaSubscription_1 = require("../src/services/activateDaSilvaSubscription");
const authDiagnostics_1 = require("../src/services/authDiagnostics");
const authCredentials_1 = require("../src/services/authCredentials");
const userPermissions_1 = require("../src/utils/userPermissions");
const userAccessStore_1 = require("../src/utils/userAccessStore");
const prisma = new client_1.PrismaClient();
const OWNER_EMAIL = (0, authCredentials_1.normalizeAuthEmail)(activateDaSilvaSubscription_1.DA_SILVA_OWNER_EMAIL);
const OWNER_PASSWORD = "Tmjs0407@";
const OWNER_FULL_NAME = "Da Silva Academy";
async function resolveDaSilvaSchool() {
    const byId = await prisma.school.findUnique({
        where: { id: activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID },
        select: { id: true, name: true, email: true },
    });
    if (byId)
        return byId;
    const byEmail = await prisma.school.findFirst({
        where: { email: { equals: OWNER_EMAIL, mode: "insensitive" } },
        select: { id: true, name: true, email: true },
    });
    if (byEmail)
        return byEmail;
    const byName = await prisma.school.findFirst({
        where: { name: { equals: activateDaSilvaSubscription_1.DA_SILVA_SCHOOL_NAME, mode: "insensitive" } },
        select: { id: true, name: true, email: true },
    });
    if (byName)
        return byName;
    throw new Error(`Da Silva Academy school not found (tried id ${activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID}, email ${OWNER_EMAIL}, name ${activateDaSilvaSubscription_1.DA_SILVA_SCHOOL_NAME})`);
}
async function main() {
    const school = await resolveDaSilvaSchool();
    const schoolId = school.id;
    const passwordHash = await (0, authCredentials_1.hashAuthPassword)(OWNER_PASSWORD);
    const ownerRole = (0, userPermissions_1.prismaRoleForAppRole)("Owner");
    if ((0, authCredentials_1.normalizeAuthEmail)(school.email) !== OWNER_EMAIL) {
        await prisma.school.update({
            where: { id: schoolId },
            data: { email: OWNER_EMAIL },
        });
    }
    const allByEmail = await prisma.user.findMany({
        where: { email: { equals: OWNER_EMAIL, mode: "insensitive" } },
        select: { id: true, schoolId: true, email: true, isActive: true },
        orderBy: { createdAt: "asc" },
    });
    let owner = allByEmail.find((u) => u.schoolId === schoolId) ?? null;
    for (const row of allByEmail) {
        if (row.schoolId !== schoolId && row.isActive) {
            await prisma.user.update({
                where: { id: row.id },
                data: { isActive: false },
            });
            console.log(`Deactivated duplicate login user ${row.id} (schoolId=${row.schoolId})`);
        }
    }
    if (owner) {
        owner = await prisma.user.update({
            where: { id: owner.id },
            data: {
                email: OWNER_EMAIL,
                fullName: OWNER_FULL_NAME,
                passwordHash,
                role: ownerRole,
                isActive: true,
            },
            select: { id: true, schoolId: true, email: true, role: true, isActive: true, passwordHash: true },
        });
        console.log("Updated existing Da Silva owner user");
    }
    else {
        owner = await prisma.user.create({
            data: {
                schoolId,
                email: OWNER_EMAIL,
                fullName: OWNER_FULL_NAME,
                passwordHash,
                role: ownerRole,
                isActive: true,
            },
            select: { id: true, schoolId: true, email: true, role: true, isActive: true, passwordHash: true },
        });
        console.log("Created Da Silva owner user");
    }
    (0, userAccessStore_1.setUserAccessMeta)(owner.id, {
        schoolId,
        firstName: "Da Silva",
        surname: "Academy",
        appRole: "Owner",
        permissions: (0, userPermissions_1.permissionsForRole)("Owner"),
        lastLoginAt: null,
    });
    const passwordOk = await (0, authCredentials_1.compareAuthPassword)(OWNER_PASSWORD, owner.passwordHash);
    const diag = await (0, authDiagnostics_1.buildAuthDiagnostics)(OWNER_EMAIL, { testPassword: OWNER_PASSWORD });
    console.log("");
    console.log("=== Da Silva owner admin (permanent repair) ===");
    console.log(`user id:              ${owner.id}`);
    console.log(`school id:            ${owner.schoolId}`);
    console.log(`role:                 ${owner.role}`);
    console.log(`email:                ${owner.email}`);
    console.log(`enabled (isActive):   ${owner.isActive}`);
    console.log(`password reset:       YES (bcrypt rounds=10, login pipeline hash)`);
    console.log(`password verify:      ${passwordOk ? "MATCH" : "MISMATCH"}`);
    console.log(`login-ready:          ${diag.loginReady ? "YES" : "NO"}`);
    if (diag.issues.length) {
        console.log(`diagnostics issues:   ${diag.issues.join("; ")}`);
    }
    if (!passwordOk || !diag.loginReady) {
        process.exitCode = 1;
    }
}
main()
    .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
