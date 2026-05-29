"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmailWithAttachment = sendEmailWithAttachment;
const schoolEmailService_1 = require("../services/schoolEmailService");
/**
 * Sends billing/statement mail using the school's saved SMTP settings (scoped by schoolId).
 */
async function sendEmailWithAttachment(input) {
    const schoolId = String(input.schoolId || "").trim();
    if (!schoolId) {
        throw new Error("Missing schoolId for email delivery.");
    }
    if (!(await (0, schoolEmailService_1.isSchoolEmailConfigured)(schoolId))) {
        const payload = (0, schoolEmailService_1.buildSetupRequiredPayload)();
        const err = new Error(payload.error);
        err.setupRequired = true;
        throw err;
    }
    return (0, schoolEmailService_1.sendSchoolEmail)(schoolId, {
        to: input.to,
        subject: input.subject,
        html: input.html,
        attachments: input.attachments,
    });
}
