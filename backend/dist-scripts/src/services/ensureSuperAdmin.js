"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.canAutoEnsureSuperAdmin = canAutoEnsureSuperAdmin;
exports.ensureSuperAdminUser = ensureSuperAdminUser;
exports.ensureSuperAdminOnStartup = ensureSuperAdminOnStartup;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = require("../prisma");
const superAdmin_1 = require("../utils/superAdmin");
const PLATFORM_SCHOOL_NAME = "EduClear Platform";
function canAutoEnsureSuperAdmin() {
    const allowed = (0, superAdmin_1.parseSuperAdminEmails)();
    const password = String(process.env.SUPER_ADMIN_SEED_PASSWORD || "").trim();
    return allowed.length > 0 && password.length > 0;
}
async function resolvePlatformSchool(email) {
    const byContactEmail = await prisma_1.prisma.school.findFirst({
        where: { email },
        select: { id: true, name: true, email: true },
    });
    if (byContactEmail)
        return byContactEmail;
    const byName = await prisma_1.prisma.school.findFirst({
        where: { name: PLATFORM_SCHOOL_NAME },
        select: { id: true, name: true, email: true },
    });
    if (byName)
        return byName;
    return prisma_1.prisma.school.create({
        data: {
            name: PLATFORM_SCHOOL_NAME,
            email,
            phone: "",
        },
        select: { id: true, name: true, email: true },
    });
}
/**
 * Creates or updates the platform super-admin user (idempotent).
 * Requires SUPER_ADMIN_EMAILS and SUPER_ADMIN_SEED_PASSWORD.
 * Super-admin login role (`educlearRole: superAdmin`) is granted at auth when the email is in SUPER_ADMIN_EMAILS.
 */
async function ensureSuperAdminUser() {
    const allowed = (0, superAdmin_1.parseSuperAdminEmails)();
    if (!allowed.length) {
        throw new Error("SUPER_ADMIN_EMAILS is empty — add info@educlear.co.za (comma-separated list)");
    }
    const email = (0, superAdmin_1.normalizeSuperAdminEmail)(process.env.SUPER_ADMIN_SEED_EMAIL || allowed[0]);
    const plainPassword = String(process.env.SUPER_ADMIN_SEED_PASSWORD || "").trim();
    if (!plainPassword) {
        throw new Error("SUPER_ADMIN_SEED_PASSWORD is required (set in env, never commit it)");
    }
    if (!allowed.includes(email)) {
        throw new Error(`${email} is not listed in SUPER_ADMIN_EMAILS`);
    }
    const passwordHash = await bcryptjs_1.default.hash(plainPassword, 10);
    const existing = await prisma_1.prisma.user.findFirst({
        where: { email },
        select: { id: true, email: true, schoolId: true, isActive: true, fullName: true },
        orderBy: { createdAt: "asc" },
    });
    if (existing) {
        await prisma_1.prisma.user.update({
            where: { id: existing.id },
            data: {
                passwordHash,
                isActive: true,
                role: "SCHOOL_ADMIN",
                fullName: existing.fullName?.trim() ? existing.fullName : "EduClear Super Admin",
            },
        });
        return email;
    }
    const school = await resolvePlatformSchool(email);
    await prisma_1.prisma.user.create({
        data: {
            schoolId: school.id,
            email,
            fullName: "EduClear Super Admin",
            passwordHash,
            role: "SCHOOL_ADMIN",
            isActive: true,
        },
    });
    return email;
}
/** Runs on every backend boot when seed env vars are configured. */
async function ensureSuperAdminOnStartup() {
    const allowed = (0, superAdmin_1.parseSuperAdminEmails)();
    const hasPassword = Boolean(String(process.env.SUPER_ADMIN_SEED_PASSWORD || "").trim());
    if (!allowed.length) {
        console.warn("[ensureSuperAdmin] Skipped: SUPER_ADMIN_EMAILS is not set or empty");
        return;
    }
    if (!hasPassword) {
        console.warn("[ensureSuperAdmin] Skipped: SUPER_ADMIN_SEED_PASSWORD is not set");
        return;
    }
    try {
        const email = await ensureSuperAdminUser();
        console.log(`Super admin ensured: ${email}`);
    }
    catch (error) {
        console.error("[ensureSuperAdmin] Failed to ensure super admin:", error);
    }
}
