import { Router } from "express";
import {
  EMAIL_PROVIDER_PRESETS,
  formatSmtpError,
  getPublicSchoolEmailSettings,
  saveSchoolEmailSettings,
  testSchoolEmailConnection,
  type SchoolEmailSettingsInput,
} from "../services/schoolEmailService";

const router = Router();

router.get("/presets", (_req, res) => {
  return res.json({ success: true, presets: EMAIL_PROVIDER_PRESETS });
});

router.get("/", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }
    const settings = await getPublicSchoolEmailSettings(schoolId);
    return res.json({
      success: true,
      settings,
    });
  } catch (error) {
    console.error("[school-email-settings] GET failed:", error);
    return res.status(500).json({ success: false, error: "Failed to load email settings" });
  }
});

router.put("/", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }

    const input: SchoolEmailSettingsInput = {
      provider: req.body?.provider,
      smtpHost: req.body?.smtpHost,
      smtpPort: req.body?.smtpPort,
      smtpSecure: req.body?.smtpSecure,
      smtpUser: req.body?.smtpUser,
      smtpPass: req.body?.smtpPass,
      fromEmail: req.body?.fromEmail,
      fromName: req.body?.fromName,
      replyTo: req.body?.replyTo,
    };

    const result = await saveSchoolEmailSettings(schoolId, input);
    if (!result.ok) {
      return res.status(400).json({ success: false, errors: result.errors });
    }

    return res.json({ success: true, settings: result.settings });
  } catch (error) {
    console.error("[school-email-settings] PUT failed:", error);
    return res.status(500).json({ success: false, error: "Failed to save email settings" });
  }
});

router.post("/test", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const testTo = String(req.body?.testTo || req.body?.to || "").trim();
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }

    const result = await testSchoolEmailConnection(schoolId, testTo || undefined);
    if (!result.ok) {
      console.error(
        `[school-email-settings] test failed schoolId=${schoolId}:`,
        result.error
      );
      const status = result.setupRequired ? 409 : 400;
      return res.status(status).json({
        success: false,
        error: result.error,
        setupRequired: Boolean(result.setupRequired),
      });
    }

    const settings = result.settings ?? (await getPublicSchoolEmailSettings(schoolId));
    return res.json({
      success: true,
      message: "Test email sent successfully.",
      messageId: result.messageId,
      sentTo: result.sentTo,
      lastTestedAt: result.lastTestedAt ?? settings.lastTestedAt,
      settings,
    });
  } catch (error) {
    const message = formatSmtpError(error);
    console.error("[school-email-settings] POST test failed:", error);
    return res.status(500).json({ success: false, error: message });
  }
});

export default router;
