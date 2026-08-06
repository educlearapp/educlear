import { Router } from "express";
import {
  buildSetupRequiredPayload,
  isResendNetworkUnavailableError,
  RESEND_NETWORK_UNAVAILABLE_MESSAGE,
} from "../services/schoolEmailService";
import { sendStatementEmail } from "../services/statementEmailService";

const router = Router();

function isRawFetchFailedMessage(message: string | undefined): boolean {
  const m = String(message || "").trim().toLowerCase();
  return m === "fetch failed" || m === "network error" || m === "failed to fetch";
}

router.post("/send-statement", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const to = String(req.body?.to || "").trim();
    const subject = String(req.body?.subject || "").trim();
    const html = String(req.body?.html || "").trim();
    const learnerId = String(req.body?.learnerId || "").trim();
    const accountNo = String(req.body?.accountNo || "").trim();
    const period = req.body?.period != null ? String(req.body.period) : undefined;
    const statementNote =
      req.body?.statementNote != null ? String(req.body.statementNote) : undefined;
    const filename = req.body?.filename != null ? String(req.body.filename) : undefined;
    const pdfBase64 = req.body?.pdfBase64 != null ? String(req.body.pdfBase64).trim() : undefined;

    if (!schoolId) {
      return res.status(400).json({
        error: "Missing schoolId. Billing emails must be sent through the EduClear email service.",
        setupRequired: true,
      });
    }

    if (!learnerId && !accountNo && !pdfBase64) {
      return res.status(400).json({
        error: "Missing learnerId or accountNo. Statement PDF is generated on the server.",
      });
    }

    const result = await sendStatementEmail({
      schoolId,
      to,
      subject,
      html,
      learnerId: learnerId || undefined,
      accountNo: accountNo || undefined,
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
    const err = error as Error & { setupRequired?: boolean; statusCode?: number };
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
    if (isResendNetworkUnavailableError(error) || isRawFetchFailedMessage(err.message)) {
      return res.status(503).json({
        error: RESEND_NETWORK_UNAVAILABLE_MESSAGE,
      });
    }
    // Never leak undici's raw "fetch failed" as a 500 body
    const safeMessage =
      isRawFetchFailedMessage(err.message)
        ? RESEND_NETWORK_UNAVAILABLE_MESSAGE
        : err.message || "Failed to send statement email";
    return res.status(500).json({
      error: safeMessage,
    });
  }
});

export default router;
