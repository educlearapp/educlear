"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmailPlaceholder = sendEmailPlaceholder;
const schoolEmailService_1 = require("../../services/schoolEmailService");
async function sendEmailPlaceholder(ctx) {
    const recipient = String(ctx.recipient || "").trim();
    if (!recipient) {
        return { ok: false, simulated: false, error: "missing_recipient" };
    }
    if (!(await (0, schoolEmailService_1.isSchoolEmailConfigured)(ctx.schoolId))) {
        return {
            ok: false,
            simulated: false,
            error: "email_setup_required",
            setupRequired: true,
        };
    }
    try {
        const result = await (0, schoolEmailService_1.sendSchoolEmail)(ctx.schoolId, {
            to: recipient,
            subject: ctx.subject || "Message from your school",
            html: `<div style="font-family:Arial,sans-serif;line-height:1.5">${String(ctx.body || "")
                .split("\n")
                .map((line) => `<p style="margin:0 0 8px">${line}</p>`)
                .join("")}</div>`,
        });
        return {
            ok: true,
            simulated: false,
            reference: result.messageId || `email:${ctx.messageId}`,
        };
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const setupRequired = Boolean(e.setupRequired);
        return {
            ok: false,
            simulated: false,
            error: message,
            setupRequired,
        };
    }
}
