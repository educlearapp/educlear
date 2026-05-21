import { Router } from "express";
import { buildSetupRequiredPayload } from "../services/schoolEmailService";
import { sendStatementEmail } from "../services/statementEmailService";

const router = Router();

router.post("/send-statement", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const to = String(req.body?.to || "").trim();
    const subject = String(req.body?.subject || "").trim();
    const html = String(req.body?.html || "").trim();
    const learnerId = String(req.body?.learnerId || "").trim();
    const period = req.body?.period != null ? String(req.body.period) : undefined;
    const statementNote =
      req.body?.statementNote != null ? String(req.body.statementNote) : undefined;
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

    const result = await sendStatementEmail({
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
  } catch (error: unknown) {
    console.error("Send statement email error:", error);
    const err = error as Error & { setupRequired?: boolean };
    if (err.message?.includes("Missing required fields") || err.message?.includes("Missing schoolId")) {
      return res.status(400).json({
        error: err.message,
        setupRequired: err.message.includes("schoolId"),
      });
    }
    if (err.setupRequired) {
      const payload = buildSetupRequiredPayload();
      return res.status(409).json(payload);
    }
    return res.status(500).json({
      error: err.message || "Failed to send statement email",
    });
  }
});

export default router;
