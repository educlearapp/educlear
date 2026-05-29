"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAuthDiagnostics = buildAuthDiagnostics;
const prisma_1 = require("../prisma");
const authCredentials_1 = require("./authCredentials");
function emailStoredNormalized(stored, normalized) {
    return stored === normalized;
}
async function buildAuthDiagnostics(rawEmail, options) {
    const email = (0, authCredentials_1.normalizeAuthEmail)(rawEmail);
    const issues = [];
    if (!email) {
        return {
            email: "",
            userFound: false,
            userId: null,
            role: null,
            schoolId: null,
            active: null,
            passwordHashExists: false,
            duplicateEmailCount: 0,
            duplicateActiveCount: 0,
            loginReady: false,
            users: [],
            issues: ["email empty after trim/lowercase"],
        };
    }
    const rows = await prisma_1.prisma.user.findMany({
        where: { email: { equals: email, mode: "insensitive" } },
        select: {
            id: true,
            email: true,
            schoolId: true,
            role: true,
            isActive: true,
            passwordHash: true,
        },
        orderBy: { createdAt: "asc" },
    });
    const schoolIds = [...new Set(rows.map((r) => r.schoolId))];
    const schools = schoolIds.length > 0
        ? await prisma_1.prisma.school.findMany({
            where: { id: { in: schoolIds } },
            select: { id: true, name: true },
        })
        : [];
    const schoolById = new Map(schools.map((s) => [s.id, s]));
    const users = rows.map((row) => {
        const school = schoolById.get(row.schoolId);
        const hash = row.passwordHash || "";
        const passwordHashExists = hash.length > 0;
        const passwordHashValidFormat = (0, authCredentials_1.isValidBcryptHash)(hash);
        if (!emailStoredNormalized(row.email, email)) {
            issues.push(`user ${row.id} email not normalized in DB: ${row.email}`);
        }
        if (!passwordHashExists) {
            issues.push(`user ${row.id} missing passwordHash`);
        }
        else if (!passwordHashValidFormat) {
            issues.push(`user ${row.id} passwordHash is not valid bcrypt`);
        }
        if (!school) {
            issues.push(`user ${row.id} orphan schoolId ${row.schoolId}`);
        }
        return {
            userId: row.id,
            email: row.email,
            emailNormalized: emailStoredNormalized(row.email, email),
            role: row.role,
            schoolId: row.schoolId,
            active: row.isActive,
            passwordHashExists,
            passwordHashValidFormat,
            schoolExists: Boolean(school),
            schoolName: school?.name ?? null,
        };
    });
    const duplicateEmailCount = rows.length;
    const duplicateActiveCount = rows.filter((r) => r.isActive).length;
    if (duplicateEmailCount > 1) {
        issues.push(`${duplicateEmailCount} user rows share this email`);
    }
    if (duplicateActiveCount > 1) {
        issues.push(`${duplicateActiveCount} active user rows share this email`);
    }
    const activeReady = users.filter((u) => u.active &&
        u.passwordHashExists &&
        u.passwordHashValidFormat &&
        u.schoolExists &&
        u.role === "SCHOOL_ADMIN");
    let loginReady = activeReady.length === 1 &&
        duplicateActiveCount <= 1 &&
        activeReady[0].emailNormalized;
    const testPassword = options?.testPassword;
    if (testPassword) {
        let anyMatch = false;
        for (const row of rows.filter((r) => r.isActive)) {
            if (await (0, authCredentials_1.compareAuthPassword)(testPassword, row.passwordHash)) {
                anyMatch = true;
                break;
            }
        }
        loginReady = loginReady && anyMatch;
        if (!anyMatch) {
            issues.push("test password does not match any active user hash");
        }
    }
    const primary = activeReady[0] ??
        users.find((u) => u.active) ??
        users[0] ??
        null;
    return {
        email,
        userFound: rows.length > 0,
        userId: primary?.userId ?? null,
        role: primary?.role ?? null,
        schoolId: primary?.schoolId ?? null,
        active: primary?.active ?? null,
        passwordHashExists: Boolean(primary?.passwordHashExists),
        duplicateEmailCount,
        duplicateActiveCount,
        loginReady,
        users,
        issues: [...new Set(issues)],
    };
}
