"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EDUCLEAR_RELAY_FROM_EMAIL = exports.FALLBACK_SENDER_EMAIL = void 0;
exports.resolveSchoolDisplayName = resolveSchoolDisplayName;
exports.resolveSchoolSenderEmail = resolveSchoolSenderEmail;
exports.resolveSchoolReplyToEmail = resolveSchoolReplyToEmail;
exports.formatComposeSenderLabel = formatComposeSenderLabel;
exports.resolveEmailSignature = resolveEmailSignature;
exports.applyEmailTemplateTokens = applyEmailTemplateTokens;
exports.smtpSenderFromPublic = smtpSenderFromPublic;
exports.FALLBACK_SENDER_EMAIL = "no-reply@educlear.co.za";
exports.EDUCLEAR_RELAY_FROM_EMAIL = "billing@educlear.co.za";
function resolveSchoolDisplayName(school, smtp) {
    if (smtp?.configured) {
        const smtpName = String(smtp.fromName || "").trim();
        if (smtpName)
            return smtpName;
    }
    return String(school?.schoolName || "School").trim() || "School";
}
/** SMTP from → school registration email → administration email; sendViaEduClearDomain always uses EDUCLEAR_RELAY_FROM_EMAIL. */
function resolveSchoolSenderEmail(settings, school, smtp) {
    if (settings?.sendViaEduClearDomain) {
        return exports.EDUCLEAR_RELAY_FROM_EMAIL;
    }
    if (smtp?.configured) {
        const smtpFrom = String(smtp.fromEmail || "").trim();
        if (smtpFrom)
            return smtpFrom;
    }
    const schoolEmail = String(school?.schoolEmail || "").trim();
    if (schoolEmail)
        return schoolEmail;
    const administration = String(settings?.administrationEmail || "").trim();
    if (administration)
        return administration;
    return "";
}
/** Parents reply here: SMTP replyTo → school registration email → SMTP from → no-reply only if no school email. */
function resolveSchoolReplyToEmail(_settings, school, smtp) {
    if (smtp?.configured) {
        const replyTo = String(smtp.replyTo || "").trim();
        if (replyTo)
            return replyTo;
    }
    const schoolEmail = String(school?.schoolEmail || "").trim();
    if (schoolEmail)
        return schoolEmail;
    if (smtp?.configured) {
        const fromEmail = String(smtp.fromEmail || "").trim();
        if (fromEmail)
            return fromEmail;
    }
    return exports.FALLBACK_SENDER_EMAIL;
}
function formatComposeSenderLabel(settings, school, smtp) {
    const name = resolveSchoolDisplayName(school, smtp);
    const email = resolveSchoolSenderEmail(settings, school, smtp);
    if (!email)
        return name;
    return `${name} ${email}`;
}
const LEGACY_SIGNATURE_RE = /EduClear School Finance/i;
function resolveEmailSignature(signature, schoolName) {
    const name = String(schoolName || "School").trim() || "School";
    let sig = String(signature || "").trim();
    if (!sig)
        return `Kind regards,\n${name}`;
    sig = sig.replace(/\[school_name\]/g, name);
    if (LEGACY_SIGNATURE_RE.test(sig)) {
        return `Kind regards,\n${name}`;
    }
    return sig;
}
function applyEmailTemplateTokens(template, opts) {
    const schoolName = opts.schoolName;
    const signature = resolveEmailSignature(opts.settings?.signature, schoolName);
    return String(template || "")
        .replace(/\[school_name\]/g, schoolName)
        .replace(/\[signature\]/g, signature);
}
function smtpSenderFromPublic(settings) {
    return {
        configured: settings.configured,
        fromEmail: settings.fromEmail,
        fromName: settings.fromName,
        replyTo: settings.replyTo,
    };
}
