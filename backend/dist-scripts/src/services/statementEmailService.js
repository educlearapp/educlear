"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendStatementEmail = sendStatementEmail;
const emailService_1 = require("../routes/emailService");
const statementPdfData_1 = require("./statementPdfData");
/**
 * Sends a statement PDF to one recipient using the school's saved SMTP settings.
 */
async function sendStatementEmail(input) {
    const schoolId = String(input.schoolId || "").trim();
    if (!schoolId) {
        throw new Error("Missing schoolId for statement email delivery.");
    }
    const to = String(input.to || "").trim();
    const subject = String(input.subject || "").trim();
    const html = String(input.html || "").trim();
    if (!to || !subject || !html) {
        throw new Error("Missing required fields: schoolId, to, subject, html");
    }
    let pdfBuffer;
    let filename = input.filename;
    const learnerId = String(input.learnerId || "").trim();
    if (learnerId) {
        const generated = await (0, statementPdfData_1.buildAndGenerateStatementPdf)({
            schoolId,
            learnerId,
            period: input.period,
            statementNote: input.statementNote,
        });
        pdfBuffer = generated.buffer;
        filename = filename || generated.filename;
    }
    else {
        const pdfBase64 = String(input.pdfBase64 || "").trim();
        if (!pdfBase64) {
            throw new Error("Missing learnerId or pdfBase64 for statement attachment");
        }
        try {
            pdfBuffer = Buffer.from(pdfBase64, "base64");
        }
        catch {
            throw new Error("Invalid PDF data");
        }
    }
    if (pdfBuffer.length < 64 || pdfBuffer.length > 10 * 1024 * 1024) {
        throw new Error("PDF attachment is missing or too large");
    }
    const magic = pdfBuffer.subarray(0, 5).toString("utf8");
    if (!magic.startsWith("%PDF")) {
        throw new Error("Attachment is not a valid PDF");
    }
    const payload = {
        schoolId,
        to,
        subject,
        html,
        attachments: [
            {
                filename: filename || "statement.pdf",
                content: pdfBuffer,
                contentType: "application/pdf",
            },
        ],
    };
    return (0, emailService_1.sendEmailWithAttachment)(payload);
}
