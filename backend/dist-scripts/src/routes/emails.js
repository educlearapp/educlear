"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const schoolEmailService_1 = require("../services/schoolEmailService");
const statementEmailService_1 = require("../services/statementEmailService");
const router = (0, express_1.Router)();
router.post("/send-statement", async (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        const to = String(req.body?.to || "").trim();
        const subject = String(req.body?.subject || "").trim();
        const html = String(req.body?.html || "").trim();
        const learnerId = String(req.body?.learnerId || "").trim();
        const period = req.body?.period != null ? String(req.body.period) : undefined;
        const statementNote = req.body?.statementNote != null ? String(req.body.statementNote) : undefined;
        const filename = req.body?.filename != null ? String(req.body.filename) : undefined;
        const pdfBase64 = req.body?.pdfBase64 != null ? String(req.body.pdfBase64).trim() : undefined;
        if (!schoolId) {
            return res.status(400).json({
                error: "Missing schoolId. Billing emails must be sent using the school's saved SMTP settings.",
                setupRequired: true,
            });
        }
        if (!learnerId && !pdfBase64) {
            return res.status(400).json({
                error: "Missing learnerId. Statement PDF is generated on the server.",
            });
        }
        const result = await (0, statementEmailService_1.sendStatementEmail)({
            schoolId,
            to,
            subject,
            html,
            learnerId: learnerId || undefined,
            period,
            statementNote,
            filename,
            pdfBase64,
        });
        return res.json({
            success: true,
            messageId: result.messageId,
        });
    }
    catch (error) {
        console.error("Send statement email error:", error);
        const err = error;
        if (err.message?.includes("Missing required fields") || err.message?.includes("Missing schoolId")) {
            return res.status(400).json({
                error: err.message,
                setupRequired: err.message.includes("schoolId"),
            });
        }
        if (err.setupRequired) {
            const payload = (0, schoolEmailService_1.buildSetupRequiredPayload)();
            return res.status(409).json(payload);
        }
        return res.status(500).json({
            error: err.message || "Failed to send statement email",
        });
    }
});
exports.default = router;
