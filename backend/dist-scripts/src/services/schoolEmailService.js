"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMAIL_PROVIDER_PRESETS = void 0;
exports.normalizeProvider = normalizeProvider;
exports.applyProviderDefaults = applyProviderDefaults;
exports.validateSchoolEmailSettings = validateSchoolEmailSettings;
exports.maskPassword = maskPassword;
exports.loadSchoolEmailBranding = loadSchoolEmailBranding;
exports.applySchoolSenderDefaults = applySchoolSenderDefaults;
exports.isSmtpRowConfigured = isSmtpRowConfigured;
exports.isSchoolEmailReadyFromRow = isSchoolEmailReadyFromRow;
exports.computeSchoolEmailReadinessFlags = computeSchoolEmailReadinessFlags;
exports.toPublicSettings = toPublicSettings;
exports.buildPublicSchoolEmailSettings = buildPublicSchoolEmailSettings;
exports.getPublicSchoolEmailSettings = getPublicSchoolEmailSettings;
exports.buildSetupRequiredPayload = buildSetupRequiredPayload;
exports.getSchoolEmailSettingsRow = getSchoolEmailSettingsRow;
exports.isSchoolEmailConfigured = isSchoolEmailConfigured;
exports.isSchoolEmailReady = isSchoolEmailReady;
exports.seedSchoolEmailDefaults = seedSchoolEmailDefaults;
exports.saveSchoolEmailSettings = saveSchoolEmailSettings;
exports.createTransportFromSettings = createTransportFromSettings;
exports.resolveReplyToForSchoolSend = resolveReplyToForSchoolSend;
exports.sendSchoolEmail = sendSchoolEmail;
exports.testSchoolEmailConnection = testSchoolEmailConnection;
const nodemailer_1 = __importDefault(require("nodemailer"));
const prisma_1 = require("../prisma");
const schoolSender_1 = require("../communication/schoolSender");
const devTestSchoolEmail_1 = require("../dev/devTestSchoolEmail");
exports.EMAIL_PROVIDER_PRESETS = {
    gmail: {
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpSecure: false,
        hint: "Use a Google App Password (2-Step Verification required).",
    },
    outlook: {
        smtpHost: "smtp.office365.com",
        smtpPort: 587,
        smtpSecure: false,
        hint: "Office 365 / Outlook SMTP with STARTTLS on port 587.",
    },
    icloud: {
        smtpHost: "smtp.mail.me.com",
        smtpPort: 587,
        smtpSecure: false,
        hint: "Use an app-specific password from Apple ID settings.",
    },
    yahoo: {
        smtpHost: "smtp.mail.yahoo.com",
        smtpPort: 587,
        smtpSecure: false,
        hint: "Use a Yahoo app password when 2FA is enabled.",
    },
    custom: {
        smtpHost: "",
        smtpPort: 587,
        smtpSecure: false,
        hint: "Enter your domain host, port, and TLS/SSL mode manually.",
    },
};
const MASKED_PASSWORD = "********";
const SETUP_REQUIRED_MESSAGE = "Email is not configured for this school. Open Communication → Email (SMTP), save your provider settings, then use Send Test Email.";
function normalizeProvider(raw) {
    const p = String(raw || "")
        .trim()
        .toLowerCase();
    if (p === "gmail" || p === "google")
        return "gmail";
    if (p === "outlook" || p === "office365" || p === "office_365" || p === "microsoft")
        return "outlook";
    if (p === "icloud" || p === "apple")
        return "icloud";
    if (p === "yahoo")
        return "yahoo";
    if (p === "custom" || p === "other" || p === "smtp")
        return "custom";
    return null;
}
function applyProviderDefaults(provider, input) {
    const preset = exports.EMAIL_PROVIDER_PRESETS[provider];
    const smtpHost = provider === "custom"
        ? String(input.smtpHost || "").trim()
        : String(input.smtpHost || "").trim() || preset.smtpHost;
    const smtpPort = input.smtpPort != null && !Number.isNaN(Number(input.smtpPort))
        ? Number(input.smtpPort)
        : preset.smtpPort;
    const smtpSecure = input.smtpSecure === true || (input.smtpSecure !== false && smtpPort === 465);
    return {
        provider,
        smtpHost,
        smtpPort,
        smtpSecure,
        smtpUser: String(input.smtpUser || "").trim(),
        smtpPass: String(input.smtpPass || ""),
        fromEmail: String(input.fromEmail || "").trim(),
        fromName: String(input.fromName || "").trim(),
        replyTo: String(input.replyTo || "").trim(),
    };
}
function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function validateSchoolEmailSettings(resolved, opts) {
    const errors = [];
    if (!resolved.smtpHost)
        errors.push("SMTP host is required.");
    if (!resolved.smtpPort || resolved.smtpPort < 1 || resolved.smtpPort > 65535) {
        errors.push("SMTP port must be between 1 and 65535.");
    }
    if (!resolved.smtpUser)
        errors.push("SMTP username is required.");
    if (opts.requirePassword && !resolved.smtpPass && !opts.existingPass) {
        errors.push("SMTP password or app password is required.");
    }
    if (!resolved.fromEmail)
        errors.push("From email is required.");
    else if (!isValidEmail(resolved.fromEmail))
        errors.push("From email must be a valid email address.");
    if (resolved.replyTo && !isValidEmail(resolved.replyTo)) {
        errors.push("Reply-to must be a valid email address when provided.");
    }
    return errors;
}
function maskPassword(password) {
    if (!password)
        return "";
    return MASKED_PASSWORD;
}
async function loadSchoolEmailBranding(schoolId) {
    const school = await prisma_1.prisma.school.findUnique({
        where: { id: schoolId },
        select: { name: true, email: true },
    });
    return {
        schoolName: String(school?.name || "").trim() || "School",
        schoolEmail: String(school?.email || "").trim(),
    };
}
/** Pre-fill sender fields from School registration when SMTP row is missing or sender fields are empty. */
function applySchoolSenderDefaults(settings, branding) {
    const schoolEmail = branding.schoolEmail.trim();
    if (!schoolEmail)
        return settings;
    return {
        ...settings,
        fromEmail: String(settings.fromEmail || "").trim() || schoolEmail,
        fromName: String(settings.fromName || "").trim() || branding.schoolName.trim() || "School",
        replyTo: String(settings.replyTo || "").trim() || schoolEmail,
    };
}
function isSmtpRowConfigured(row) {
    return Boolean(row?.smtpHost && row?.smtpUser && row?.smtpPass && row?.fromEmail);
}
/** Persisted readiness: SMTP configured and a successful test timestamp on file. */
function isSchoolEmailReadyFromRow(row) {
    if (!isSmtpRowConfigured(row))
        return false;
    return Boolean(row?.testEmailPassedAt);
}
function computeSchoolEmailReadinessFlags(row) {
    const configured = isSmtpRowConfigured(row);
    const lastTestedAt = row?.testEmailPassedAt ? row.testEmailPassedAt.toISOString() : null;
    const tested = Boolean(lastTestedAt);
    const ready = configured && tested && Boolean(lastTestedAt);
    return { configured, tested, testEmailPassed: tested, lastTestedAt, ready };
}
function toPublicSettings(row, schoolId) {
    if (!row) {
        return {
            schoolId,
            provider: "gmail",
            smtpHost: exports.EMAIL_PROVIDER_PRESETS.gmail.smtpHost,
            smtpPort: exports.EMAIL_PROVIDER_PRESETS.gmail.smtpPort,
            smtpSecure: exports.EMAIL_PROVIDER_PRESETS.gmail.smtpSecure,
            smtpUser: "",
            smtpPass: "",
            smtpPassSet: false,
            fromEmail: "",
            fromName: "",
            replyTo: "",
            configured: false,
            tested: false,
            testEmailPassed: false,
            lastTestedAt: null,
            ready: false,
        };
    }
    const provider = normalizeProvider(row.provider) || "custom";
    const { configured, tested, testEmailPassed, lastTestedAt, ready } = computeSchoolEmailReadinessFlags(row);
    return {
        schoolId: row.schoolId,
        provider,
        smtpHost: row.smtpHost,
        smtpPort: row.smtpPort,
        smtpSecure: row.smtpSecure,
        smtpUser: row.smtpUser,
        smtpPass: maskPassword(row.smtpPass),
        smtpPassSet: Boolean(row.smtpPass),
        fromEmail: row.fromEmail,
        fromName: row.fromName || "",
        replyTo: row.replyTo || "",
        configured,
        tested,
        testEmailPassed,
        lastTestedAt,
        ready,
    };
}
/** Build public SMTP settings from DB — does not mutate rows (avoids clearing test status on read). */
async function buildPublicSchoolEmailSettings(schoolId) {
    const [row, branding] = await Promise.all([
        getSchoolEmailSettingsRow(schoolId),
        loadSchoolEmailBranding(schoolId),
    ]);
    const base = applySchoolSenderDefaults(toPublicSettings(row, schoolId), branding);
    return (0, devTestSchoolEmail_1.applyDevTestSchoolEmailPrefill)(schoolId, base);
}
async function getPublicSchoolEmailSettings(schoolId) {
    return buildPublicSchoolEmailSettings(schoolId);
}
function buildSetupRequiredPayload() {
    return {
        error: SETUP_REQUIRED_MESSAGE,
        setupRequired: true,
    };
}
async function getSchoolEmailSettingsRow(schoolId) {
    return prisma_1.prisma.schoolEmailSettings.findUnique({ where: { schoolId } });
}
async function isSchoolEmailConfigured(schoolId) {
    const row = await getSchoolEmailSettingsRow(schoolId);
    return isSmtpRowConfigured(row);
}
async function isSchoolEmailReady(schoolId) {
    const row = await getSchoolEmailSettingsRow(schoolId);
    return isSchoolEmailReadyFromRow(row);
}
/** Persist registration email as default From/Reply-To before SMTP credentials are saved. */
async function seedSchoolEmailDefaults(schoolId) {
    if (await (0, devTestSchoolEmail_1.isDevTestSchool)(schoolId)) {
        await (0, devTestSchoolEmail_1.ensureDevTestSchoolEmailConfigured)(schoolId);
        return;
    }
    const branding = await loadSchoolEmailBranding(schoolId);
    if (!branding.schoolEmail)
        return;
    const existing = await getSchoolEmailSettingsRow(schoolId);
    if (existing)
        return;
    const preset = exports.EMAIL_PROVIDER_PRESETS.gmail;
    await prisma_1.prisma.schoolEmailSettings.create({
        data: {
            schoolId,
            provider: "gmail",
            smtpHost: preset.smtpHost,
            smtpPort: preset.smtpPort,
            smtpSecure: preset.smtpSecure,
            smtpUser: "",
            smtpPass: "",
            fromEmail: branding.schoolEmail,
            fromName: branding.schoolName,
            replyTo: branding.schoolEmail,
        },
    });
}
function smtpCredentialsChanged(existing, resolved) {
    return (existing.smtpHost !== resolved.smtpHost ||
        existing.smtpUser !== resolved.smtpUser ||
        existing.smtpPass !== resolved.smtpPass ||
        existing.fromEmail !== resolved.fromEmail);
}
async function saveSchoolEmailSettings(schoolId, input) {
    const mergedDevInput = await (0, devTestSchoolEmail_1.mergeDevTestSchoolSaveInput)(schoolId, input);
    const provider = normalizeProvider(String(mergedDevInput.provider || ""));
    if (!provider) {
        return { ok: false, errors: ["Provider must be gmail, outlook, icloud, yahoo, or custom."] };
    }
    const branding = await loadSchoolEmailBranding(schoolId);
    const existing = await getSchoolEmailSettingsRow(schoolId);
    const mergedInput = { ...mergedDevInput };
    if (await (0, devTestSchoolEmail_1.isDevTestSchool)(schoolId)) {
        const devTemplate = (0, devTestSchoolEmail_1.devTestSchoolSmtpTemplate)();
        if (!String(mergedInput.fromEmail || "").trim())
            mergedInput.fromEmail = devTemplate.fromEmail;
        if (!String(mergedInput.fromName || "").trim())
            mergedInput.fromName = devTemplate.fromName;
        if (!String(mergedInput.replyTo || "").trim())
            mergedInput.replyTo = devTemplate.replyTo;
        if (!String(mergedInput.smtpUser || "").trim())
            mergedInput.smtpUser = devTemplate.smtpUser;
    }
    if (branding.schoolEmail) {
        if (!String(mergedInput.fromEmail || "").trim())
            mergedInput.fromEmail = branding.schoolEmail;
        if (!String(mergedInput.fromName || "").trim())
            mergedInput.fromName = branding.schoolName;
        if (!String(mergedInput.replyTo || "").trim())
            mergedInput.replyTo = branding.schoolEmail;
    }
    if (mergedInput.smtpPass === undefined ||
        mergedInput.smtpPass === MASKED_PASSWORD ||
        mergedInput.smtpPass === "") {
        mergedInput.smtpPass = existing?.smtpPass || "";
    }
    const resolved = applyProviderDefaults(provider, mergedInput);
    const errors = validateSchoolEmailSettings(resolved, {
        requirePassword: true,
        existingPass: existing?.smtpPass,
    });
    if (errors.length)
        return { ok: false, errors };
    const data = {
        provider,
        smtpHost: resolved.smtpHost,
        smtpPort: resolved.smtpPort,
        smtpSecure: resolved.smtpSecure,
        smtpUser: resolved.smtpUser,
        smtpPass: resolved.smtpPass,
        fromEmail: resolved.fromEmail,
        fromName: resolved.fromName,
        replyTo: resolved.replyTo || null,
        ...(existing && smtpCredentialsChanged(existing, resolved) ? { testEmailPassedAt: null } : {}),
    };
    const row = await prisma_1.prisma.schoolEmailSettings.upsert({
        where: { schoolId },
        create: { schoolId, ...data },
        update: data,
    });
    const saved = applySchoolSenderDefaults(toPublicSettings(row, schoolId), branding);
    return {
        ok: true,
        settings: await (0, devTestSchoolEmail_1.applyDevTestSchoolEmailPrefill)(schoolId, saved),
    };
}
function formatFromAddress(fromName, fromEmail) {
    const email = fromEmail.trim();
    const name = fromName.trim();
    if (!name)
        return email;
    return `"${name.replace(/"/g, '\\"')}" <${email}>`;
}
function createTransportFromSettings(row) {
    const port = row.smtpPort;
    const secure = row.smtpSecure || port === 465;
    return nodemailer_1.default.createTransport({
        host: row.smtpHost,
        port,
        secure,
        requireTLS: !secure && port === 587,
        auth: {
            user: row.smtpUser,
            pass: row.smtpPass,
        },
    });
}
/** Resolve Reply-To for outbound mail (ignores client-supplied values). */
async function resolveReplyToForSchoolSend(schoolId) {
    const [row, branding] = await Promise.all([
        getSchoolEmailSettingsRow(schoolId),
        loadSchoolEmailBranding(schoolId),
    ]);
    const publicSmtp = applySchoolSenderDefaults(toPublicSettings(row, schoolId), branding);
    const smtp = row ? (0, schoolSender_1.smtpSenderFromPublic)(publicSmtp) : null;
    return (0, schoolSender_1.resolveSchoolReplyToEmail)(null, branding, smtp);
}
async function sendSchoolEmail(schoolId, input) {
    const row = await getSchoolEmailSettingsRow(schoolId);
    if (!row || !(await isSchoolEmailConfigured(schoolId))) {
        const err = new Error(SETUP_REQUIRED_MESSAGE);
        err.setupRequired = true;
        throw err;
    }
    const transporter = createTransportFromSettings(row);
    const from = formatFromAddress(row.fromName, row.fromEmail);
    const replyTo = await resolveReplyToForSchoolSend(schoolId);
    return transporter.sendMail({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        replyTo,
        attachments: input.attachments || [],
    });
}
async function testSchoolEmailConnection(schoolId, testTo) {
    const row = await getSchoolEmailSettingsRow(schoolId);
    if (!row || !(await isSchoolEmailConfigured(schoolId))) {
        return { ok: false, error: SETUP_REQUIRED_MESSAGE, setupRequired: true };
    }
    const to = String(testTo || row.fromEmail || row.smtpUser).trim();
    if (!to || !isValidEmail(to)) {
        return { ok: false, error: "A valid test recipient email is required." };
    }
    try {
        const result = await sendSchoolEmail(schoolId, {
            to,
            subject: "EduClear — Test Email",
            html: `<div style="font-family:Arial,sans-serif;line-height:1.5">
        <p>This is a test message from EduClear.</p>
        <p>If you received this email, your school's SMTP settings are working.</p>
      </div>`,
        });
        const passedAt = new Date();
        const updated = await prisma_1.prisma.schoolEmailSettings.update({
            where: { schoolId },
            data: { testEmailPassedAt: passedAt },
        });
        const branding = await loadSchoolEmailBranding(schoolId);
        let settings = applySchoolSenderDefaults(toPublicSettings(updated, schoolId), branding);
        settings = await (0, devTestSchoolEmail_1.applyDevTestSchoolEmailPrefill)(schoolId, settings);
        return {
            ok: true,
            messageId: result.messageId,
            sentTo: to,
            settings,
            lastTestedAt: passedAt.toISOString(),
        };
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { ok: false, error: message };
    }
}
