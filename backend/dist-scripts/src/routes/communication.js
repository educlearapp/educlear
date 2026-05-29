"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = require("../prisma");
const schoolEmailService_1 = require("../services/schoolEmailService");
const schoolSender_1 = require("../communication/schoolSender");
const router = (0, express_1.Router)();
const DATA_FILE = path_1.default.join(process.cwd(), "data", "communication-store.json");
function defaultSettings() {
    return {
        sendViaEduClearDomain: false,
        administrationEmail: "",
        administrationCcSelf: false,
        billingEmail: "",
        billingCcSelf: false,
        signature: "Kind regards,\n[school_name]",
        standardEmailSubject: "[school_name] — [document_type] [document_no]",
        standardEmailMessage: "Dear [contact_name],\n\nPlease find your [document_type] ([document_no]) attached.\n\n[school_name]\n\n[signature]",
        standardSmsMessage: "Dear [contact_name], your [document_type] [document_no] from [school_name] is ready. Contact the school for details.",
        smsProvider: "WinSMS",
        winSmsUsername: "",
        winSmsPassword: "",
    };
}
function defaultSchoolStore() {
    return {
        settings: defaultSettings(),
        emailBalance: 5000,
        smsCredits: 1200,
        winSmsCredits: 800,
        emails: [],
        sms: [],
    };
}
function ensureStore() {
    const dir = path_1.default.dirname(DATA_FILE);
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
    if (!fs_1.default.existsSync(DATA_FILE)) {
        const initial = { schools: {} };
        fs_1.default.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), "utf8");
        return initial;
    }
    try {
        const parsed = JSON.parse(fs_1.default.readFileSync(DATA_FILE, "utf8"));
        return parsed && typeof parsed === "object" && parsed.schools ? parsed : { schools: {} };
    }
    catch {
        return { schools: {} };
    }
}
function writeStore(store) {
    const dir = path_1.default.dirname(DATA_FILE);
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
    fs_1.default.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}
function getSchoolStore(store, schoolId) {
    if (!store.schools[schoolId]) {
        store.schools[schoolId] = defaultSchoolStore();
        writeStore(store);
    }
    return store.schools[schoolId];
}
function newId(prefix) {
    return `${prefix}-${Date.now()}-${crypto_1.default.randomBytes(4).toString("hex")}`;
}
function maskPassword(password) {
    if (!password)
        return "";
    return "********";
}
function settingsForClient(settings) {
    return {
        ...settings,
        winSmsPassword: maskPassword(settings.winSmsPassword),
        winSmsPasswordSet: Boolean(settings.winSmsPassword),
    };
}
function mergeSettings(current, incoming) {
    const next = { ...current, ...incoming };
    if (incoming.winSmsPassword === undefined || incoming.winSmsPassword === "********") {
        next.winSmsPassword = current.winSmsPassword;
    }
    return next;
}
async function loadSchoolBranding(schoolId) {
    const school = await prisma_1.prisma.school.findUnique({
        where: { id: schoolId },
        select: { id: true, name: true, email: true },
    });
    if (!school)
        return null;
    return {
        schoolId: school.id,
        schoolName: school.name || "School",
        schoolEmail: school.email || "",
    };
}
router.get("/settings", async (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "").trim();
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        const store = ensureStore();
        const schoolStore = getSchoolStore(store, schoolId);
        const [branding, smtpPublic] = await Promise.all([
            loadSchoolBranding(schoolId),
            (0, schoolEmailService_1.getPublicSchoolEmailSettings)(schoolId).catch(() => null),
        ]);
        const schoolName = branding?.schoolName || "School";
        const schoolEmail = branding?.schoolEmail || "";
        const schoolCtx = { schoolName, schoolEmail };
        const smtp = smtpPublic ? (0, schoolSender_1.smtpSenderFromPublic)(smtpPublic) : null;
        const clientSettings = settingsForClient(schoolStore.settings);
        const senderEmail = (0, schoolSender_1.resolveSchoolSenderEmail)(schoolStore.settings, schoolCtx, smtp);
        const replyToEmail = (0, schoolSender_1.resolveSchoolReplyToEmail)(schoolStore.settings, schoolCtx, smtp);
        const senderLabel = (0, schoolSender_1.formatComposeSenderLabel)(schoolStore.settings, schoolCtx, smtp);
        return res.json({
            success: true,
            settings: {
                ...clientSettings,
                signature: (0, schoolSender_1.resolveEmailSignature)(clientSettings.signature, schoolName),
            },
            emailBalance: schoolStore.emailBalance,
            smsCredits: schoolStore.smsCredits,
            winSmsCredits: schoolStore.winSmsCredits,
            schoolName,
            schoolEmail,
            senderEmail,
            senderLabel,
            replyToEmail,
        });
    }
    catch (error) {
        console.error("[communication] GET settings failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.put("/settings", async (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        const store = ensureStore();
        const schoolStore = getSchoolStore(store, schoolId);
        schoolStore.settings = mergeSettings(schoolStore.settings, req.body?.settings || {});
        writeStore(store);
        const [branding, smtpPublic] = await Promise.all([
            loadSchoolBranding(schoolId),
            (0, schoolEmailService_1.getPublicSchoolEmailSettings)(schoolId).catch(() => null),
        ]);
        const schoolName = branding?.schoolName || "School";
        const schoolEmail = branding?.schoolEmail || "";
        const schoolCtx = { schoolName, schoolEmail };
        const smtp = smtpPublic ? (0, schoolSender_1.smtpSenderFromPublic)(smtpPublic) : null;
        const clientSettings = settingsForClient(schoolStore.settings);
        const senderEmail = (0, schoolSender_1.resolveSchoolSenderEmail)(schoolStore.settings, schoolCtx, smtp);
        const replyToEmail = (0, schoolSender_1.resolveSchoolReplyToEmail)(schoolStore.settings, schoolCtx, smtp);
        const senderLabel = (0, schoolSender_1.formatComposeSenderLabel)(schoolStore.settings, schoolCtx, smtp);
        return res.json({
            success: true,
            settings: {
                ...clientSettings,
                signature: (0, schoolSender_1.resolveEmailSignature)(clientSettings.signature, schoolName),
            },
            emailBalance: schoolStore.emailBalance,
            smsCredits: schoolStore.smsCredits,
            winSmsCredits: schoolStore.winSmsCredits,
            schoolName,
            schoolEmail,
            senderEmail,
            senderLabel,
            replyToEmail,
        });
    }
    catch (error) {
        console.error("[communication] PUT settings failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.post("/settings/test-sms", (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        const store = ensureStore();
        const school = getSchoolStore(store, schoolId);
        const username = String(req.body?.winSmsUsername || school.settings.winSmsUsername || "").trim();
        if (!username) {
            return res.status(400).json({ success: false, error: "WinSMS username is required" });
        }
        return res.json({
            success: true,
            ok: true,
            message: "Credentials validated (simulated). Live SMS delivery is not enabled yet.",
            provider: school.settings.smsProvider,
        });
    }
    catch (error) {
        console.error("[communication] test-sms failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.get("/emails", (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "").trim();
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        const store = ensureStore();
        const school = getSchoolStore(store, schoolId);
        const emails = [...school.emails].sort((a, b) => b.date.localeCompare(a.date));
        return res.json({
            success: true,
            emails,
            emailBalance: school.emailBalance,
        });
    }
    catch (error) {
        console.error("[communication] GET emails failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.get("/emails/:id", (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "").trim();
        const id = String(req.params.id || "").trim();
        const store = ensureStore();
        const school = getSchoolStore(store, schoolId);
        const email = school.emails.find((e) => e.id === id);
        if (!email)
            return res.status(404).json({ success: false, error: "Email not found" });
        return res.json({ success: true, email });
    }
    catch (error) {
        console.error("[communication] GET email failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.post("/emails", async (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        const store = ensureStore();
        const school = getSchoolStore(store, schoolId);
        const [branding, smtpPublic] = await Promise.all([
            loadSchoolBranding(schoolId),
            (0, schoolEmailService_1.getPublicSchoolEmailSettings)(schoolId).catch(() => null),
        ]);
        const schoolCtx = {
            schoolName: branding?.schoolName || "School",
            schoolEmail: branding?.schoolEmail || "",
        };
        const smtp = smtpPublic ? (0, schoolSender_1.smtpSenderFromPublic)(smtpPublic) : null;
        const defaultFromLabel = (0, schoolSender_1.formatComposeSenderLabel)(school.settings, schoolCtx, smtp);
        const now = new Date().toISOString();
        const record = {
            id: newId("email"),
            schoolId,
            date: now.slice(0, 10),
            description: String(req.body?.description || "New email").trim(),
            from: String(req.body?.from || defaultFromLabel).trim(),
            subject: String(req.body?.subject || "").trim(),
            message: String(req.body?.message || "").trim(),
            contacts: Array.isArray(req.body?.contacts) ? req.body.contacts : [],
            status: "Draft",
            createdAt: now,
            updatedAt: now,
        };
        school.emails.unshift(record);
        writeStore(store);
        return res.status(201).json({ success: true, email: record });
    }
    catch (error) {
        console.error("[communication] POST email failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.put("/emails/:id", (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        const id = String(req.params.id || "").trim();
        const store = ensureStore();
        const school = getSchoolStore(store, schoolId);
        const idx = school.emails.findIndex((e) => e.id === id);
        if (idx < 0)
            return res.status(404).json({ success: false, error: "Email not found" });
        const current = school.emails[idx];
        const updated = {
            ...current,
            description: req.body?.description !== undefined ? String(req.body.description) : current.description,
            from: req.body?.from !== undefined ? String(req.body.from) : current.from,
            subject: req.body?.subject !== undefined ? String(req.body.subject) : current.subject,
            message: req.body?.message !== undefined ? String(req.body.message) : current.message,
            contacts: Array.isArray(req.body?.contacts) ? req.body.contacts : current.contacts,
            updatedAt: new Date().toISOString(),
        };
        school.emails[idx] = updated;
        writeStore(store);
        return res.json({ success: true, email: updated });
    }
    catch (error) {
        console.error("[communication] PUT email failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.delete("/emails/:id", (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || req.body?.schoolId || "").trim();
        const id = String(req.params.id || "").trim();
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        if (!id)
            return res.status(400).json({ success: false, error: "Missing email id" });
        const store = ensureStore();
        const school = getSchoolStore(store, schoolId);
        const before = school.emails.length;
        school.emails = school.emails.filter((e) => e.id !== id);
        if (school.emails.length === before) {
            return res.status(404).json({ success: false, error: "Email not found" });
        }
        writeStore(store);
        return res.json({ success: true });
    }
    catch (error) {
        console.error("[communication] DELETE email failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.post("/emails/:id/send", (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        const id = String(req.params.id || "").trim();
        const store = ensureStore();
        const school = getSchoolStore(store, schoolId);
        const idx = school.emails.findIndex((e) => e.id === id);
        if (idx < 0)
            return res.status(404).json({ success: false, error: "Email not found" });
        const record = school.emails[idx];
        if (!record.contacts.length) {
            return res.status(400).json({ success: false, error: "Add at least one contact before sending" });
        }
        const sentAt = new Date().toISOString();
        record.contacts = record.contacts.map((c) => ({ ...c, status: "Sent" }));
        record.status = "Sent";
        record.sentAt = sentAt;
        record.updatedAt = sentAt;
        school.emails[idx] = record;
        school.emailBalance = Math.max(0, school.emailBalance - record.contacts.length);
        writeStore(store);
        return res.json({
            success: true,
            email: record,
            emailBalance: school.emailBalance,
            simulated: true,
        });
    }
    catch (error) {
        console.error("[communication] send email failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.get("/sms", (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "").trim();
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        const store = ensureStore();
        const school = getSchoolStore(store, schoolId);
        const messages = [...school.sms].sort((a, b) => b.date.localeCompare(a.date));
        return res.json({
            success: true,
            sms: messages,
            smsCredits: school.smsCredits,
            winSmsCredits: school.winSmsCredits,
        });
    }
    catch (error) {
        console.error("[communication] GET sms failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.get("/sms/:id", (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "").trim();
        const id = String(req.params.id || "").trim();
        const store = ensureStore();
        const school = getSchoolStore(store, schoolId);
        const sms = school.sms.find((e) => e.id === id);
        if (!sms)
            return res.status(404).json({ success: false, error: "SMS not found" });
        return res.json({ success: true, sms });
    }
    catch (error) {
        console.error("[communication] GET sms item failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.post("/sms", (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        const store = ensureStore();
        const school = getSchoolStore(store, schoolId);
        const now = new Date().toISOString();
        const record = {
            id: newId("sms"),
            schoolId,
            date: now.slice(0, 10),
            description: String(req.body?.description || "New SMS").trim(),
            message: String(req.body?.message || "").trim(),
            contacts: Array.isArray(req.body?.contacts) ? req.body.contacts : [],
            status: "Draft",
            createdAt: now,
            updatedAt: now,
        };
        school.sms.unshift(record);
        writeStore(store);
        return res.status(201).json({ success: true, sms: record });
    }
    catch (error) {
        console.error("[communication] POST sms failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.put("/sms/:id", (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        const id = String(req.params.id || "").trim();
        const store = ensureStore();
        const school = getSchoolStore(store, schoolId);
        const idx = school.sms.findIndex((e) => e.id === id);
        if (idx < 0)
            return res.status(404).json({ success: false, error: "SMS not found" });
        const current = school.sms[idx];
        const updated = {
            ...current,
            description: req.body?.description !== undefined ? String(req.body.description) : current.description,
            message: req.body?.message !== undefined ? String(req.body.message) : current.message,
            contacts: Array.isArray(req.body?.contacts) ? req.body.contacts : current.contacts,
            updatedAt: new Date().toISOString(),
        };
        school.sms[idx] = updated;
        writeStore(store);
        return res.json({ success: true, sms: updated });
    }
    catch (error) {
        console.error("[communication] PUT sms failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.delete("/sms/:id", (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || req.body?.schoolId || "").trim();
        const id = String(req.params.id || "").trim();
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        if (!id)
            return res.status(400).json({ success: false, error: "Missing SMS id" });
        const store = ensureStore();
        const school = getSchoolStore(store, schoolId);
        const before = school.sms.length;
        school.sms = school.sms.filter((e) => e.id !== id);
        if (school.sms.length === before) {
            return res.status(404).json({ success: false, error: "SMS not found" });
        }
        writeStore(store);
        return res.json({ success: true });
    }
    catch (error) {
        console.error("[communication] DELETE sms failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.post("/sms/:id/send", (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        const id = String(req.params.id || "").trim();
        const store = ensureStore();
        const school = getSchoolStore(store, schoolId);
        const idx = school.sms.findIndex((e) => e.id === id);
        if (idx < 0)
            return res.status(404).json({ success: false, error: "SMS not found" });
        const record = school.sms[idx];
        if (!record.contacts.length) {
            return res.status(400).json({ success: false, error: "Add at least one contact before sending" });
        }
        const segments = Math.max(1, Math.ceil(record.message.length / 160));
        const cost = record.contacts.length * segments;
        const sentAt = new Date().toISOString();
        record.contacts = record.contacts.map((c) => ({ ...c, status: "Sent" }));
        record.status = "Sent";
        record.sentAt = sentAt;
        record.updatedAt = sentAt;
        school.sms[idx] = record;
        school.smsCredits = Math.max(0, school.smsCredits - cost);
        school.winSmsCredits = Math.max(0, school.winSmsCredits - cost);
        writeStore(store);
        return res.json({
            success: true,
            sms: record,
            smsCredits: school.smsCredits,
            winSmsCredits: school.winSmsCredits,
            simulated: true,
        });
    }
    catch (error) {
        console.error("[communication] send sms failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
exports.default = router;
