"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEV_TEST_SCHOOL_NAME = void 0;
exports.isDevEnvironment = isDevEnvironment;
exports.devTestSmtpEmail = devTestSmtpEmail;
exports.devTestSmtpAppPassword = devTestSmtpAppPassword;
exports.isDevTestSchool = isDevTestSchool;
exports.findDevTestSchoolId = findDevTestSchoolId;
exports.devTestSchoolSmtpTemplate = devTestSchoolSmtpTemplate;
exports.mergeDevTestSchoolSaveInput = mergeDevTestSchoolSaveInput;
exports.applyDevTestSchoolEmailPrefill = applyDevTestSchoolEmailPrefill;
exports.ensureDevTestSchoolEmailConfigured = ensureDevTestSchoolEmailConfigured;
exports.bootstrapDevTestSchoolEmail = bootstrapDevTestSchoolEmail;
const prisma_1 = require("../prisma");
const GMAIL_PRESET = {
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
    smtpSecure: false,
};
/** Localhost dev school used for EduClear demos and manual QA. */
exports.DEV_TEST_SCHOOL_NAME = "EduClear Test School";
const DEV_TEST_SMTP_EMAIL_FALLBACK = "dsahigh26@gmail.com";
function isDevEnvironment() {
    return process.env.NODE_ENV !== "production";
}
function devTestSmtpEmail() {
    return String(process.env.DEV_TEST_SCHOOL_SMTP_EMAIL || DEV_TEST_SMTP_EMAIL_FALLBACK).trim();
}
function devTestSmtpAppPassword() {
    return String(process.env.DEV_TEST_SCHOOL_SMTP_PASS || "").trim();
}
function isDevTestSchoolName(name) {
    return String(name || "").trim().toLowerCase() === exports.DEV_TEST_SCHOOL_NAME.toLowerCase();
}
async function isDevTestSchool(schoolId) {
    if (!isDevEnvironment() || !schoolId)
        return false;
    const pinnedId = String(process.env.DEV_TEST_SCHOOL_ID || "").trim();
    if (pinnedId && schoolId === pinnedId)
        return true;
    const school = await prisma_1.prisma.school.findUnique({
        where: { id: schoolId },
        select: { name: true },
    });
    return isDevTestSchoolName(school?.name);
}
async function findDevTestSchoolId() {
    if (!isDevEnvironment())
        return null;
    const pinnedId = String(process.env.DEV_TEST_SCHOOL_ID || "").trim();
    if (pinnedId) {
        const pinned = await prisma_1.prisma.school.findUnique({
            where: { id: pinnedId },
            select: { id: true, name: true },
        });
        if (pinned && isDevTestSchoolName(pinned.name))
            return pinned.id;
    }
    const match = await prisma_1.prisma.school.findFirst({
        where: { name: { equals: exports.DEV_TEST_SCHOOL_NAME, mode: "insensitive" } },
        select: { id: true },
    });
    return match?.id || null;
}
function devTestSchoolSmtpTemplate() {
    const email = devTestSmtpEmail();
    return {
        provider: "gmail",
        smtpHost: GMAIL_PRESET.smtpHost,
        smtpPort: GMAIL_PRESET.smtpPort,
        smtpSecure: GMAIL_PRESET.smtpSecure,
        smtpUser: email,
        smtpPass: devTestSmtpAppPassword(),
        fromEmail: email,
        fromName: exports.DEV_TEST_SCHOOL_NAME,
        replyTo: email,
    };
}
/** Merge localhost test-school SMTP defaults into save payloads (never used in production). */
async function mergeDevTestSchoolSaveInput(schoolId, input) {
    if (!(await isDevTestSchool(schoolId)))
        return input;
    const template = devTestSchoolSmtpTemplate();
    const pass = devTestSmtpAppPassword();
    const merged = {
        ...input,
        provider: input.provider || "gmail",
        smtpHost: String(input.smtpHost || "").trim() || template.smtpHost,
        smtpPort: input.smtpPort != null ? input.smtpPort : template.smtpPort,
        smtpSecure: input.smtpSecure ?? template.smtpSecure,
        smtpUser: String(input.smtpUser || "").trim() || template.smtpUser,
        fromEmail: String(input.fromEmail || "").trim() || template.fromEmail,
        fromName: String(input.fromName || "").trim() || template.fromName,
        replyTo: String(input.replyTo || "").trim() || template.replyTo,
    };
    const incomingPass = String(input.smtpPass || "");
    if (!incomingPass || incomingPass === "********") {
        if (pass)
            merged.smtpPass = pass;
    }
    return merged;
}
/** Pre-fill API/ UI fields for the localhost test school only. */
async function applyDevTestSchoolEmailPrefill(schoolId, settings) {
    if (!(await isDevTestSchool(schoolId)))
        return settings;
    const template = devTestSchoolSmtpTemplate();
    const pass = devTestSmtpAppPassword();
    const email = devTestSmtpEmail();
    return {
        ...settings,
        provider: "gmail",
        smtpHost: settings.smtpHost || template.smtpHost,
        smtpPort: settings.smtpPort || template.smtpPort,
        smtpSecure: settings.smtpSecure ?? template.smtpSecure,
        smtpUser: String(settings.smtpUser || "").trim() || template.smtpUser,
        fromEmail: String(settings.fromEmail || "").trim() || template.fromEmail,
        fromName: String(settings.fromName || "").trim() || template.fromName,
        replyTo: String(settings.replyTo || "").trim() || template.replyTo,
        smtpPassSet: settings.smtpPassSet || Boolean(pass),
    };
}
/**
 * Persist full Gmail SMTP for the dev test school when DEV_TEST_SCHOOL_SMTP_PASS is set.
 * Scoped to non-production and the EduClear Test School name only.
 */
async function ensureDevTestSchoolEmailConfigured(schoolId) {
    if (!isDevEnvironment())
        return { schoolId: null, seeded: false };
    const id = schoolId && (await isDevTestSchool(schoolId)) ? schoolId : await findDevTestSchoolId();
    if (!id)
        return { schoolId: null, seeded: false };
    const pass = devTestSmtpAppPassword();
    if (!pass)
        return { schoolId: id, seeded: false };
    const template = devTestSchoolSmtpTemplate();
    const existing = await prisma_1.prisma.schoolEmailSettings.findUnique({ where: { schoolId: id } });
    const data = {
        provider: "gmail",
        smtpHost: template.smtpHost,
        smtpPort: template.smtpPort,
        smtpSecure: template.smtpSecure,
        smtpUser: template.smtpUser,
        smtpPass: pass,
        fromEmail: template.fromEmail,
        fromName: template.fromName,
        replyTo: template.replyTo,
    };
    if (!existing) {
        await prisma_1.prisma.schoolEmailSettings.create({
            data: { schoolId: id, ...data },
        });
        return { schoolId: id, seeded: true };
    }
    const credentialsChanged = existing.smtpHost !== data.smtpHost ||
        existing.smtpUser !== data.smtpUser ||
        existing.smtpPass !== data.smtpPass ||
        existing.fromEmail !== data.fromEmail;
    const unchanged = !credentialsChanged && existing.replyTo === data.replyTo;
    if (unchanged)
        return { schoolId: id, seeded: false };
    await prisma_1.prisma.schoolEmailSettings.update({
        where: { schoolId: id },
        data,
    });
    return { schoolId: id, seeded: true };
}
async function bootstrapDevTestSchoolEmail() {
    if (!isDevEnvironment())
        return;
    try {
        const result = await ensureDevTestSchoolEmailConfigured();
        if (result.seeded && result.schoolId) {
            console.log(`[dev] Preconfigured SMTP for "${exports.DEV_TEST_SCHOOL_NAME}" (${result.schoolId}). Send Test Email from Communication → Email (SMTP).`);
        }
        else if (result.schoolId && !devTestSmtpAppPassword()) {
            console.log(`[dev] "${exports.DEV_TEST_SCHOOL_NAME}" SMTP prefill active. Set DEV_TEST_SCHOOL_SMTP_PASS in backend/.env to enable sending.`);
        }
    }
    catch (err) {
        console.error("[dev] ensureDevTestSchoolEmailConfigured failed:", err);
    }
}
