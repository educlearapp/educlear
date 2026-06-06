import { Router } from "express";
import {
  checkSchoolSmsCreditBalance,
  getPublicSchoolSmsSettings,
  saveSchoolSmsSettings,
  testSchoolSmsConnection,
  type SchoolSmsSettingsInput,
} from "../services/schoolSmsService";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }
    const settings = await getPublicSchoolSmsSettings(schoolId);
    return res.json({ success: true, settings });
  } catch (error) {
    console.error("[school-sms-settings] GET failed:", error);
    return res.status(500).json({ success: false, error: "Failed to load SMS settings" });
  }
});

router.put("/", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }

    const input: SchoolSmsSettingsInput = {
      provider: req.body?.provider,
      apiKey: req.body?.apiKey,
    };

    const result = await saveSchoolSmsSettings(schoolId, input);
    if (!result.ok) {
      return res.status(400).json({ success: false, errors: result.errors });
    }

    return res.json({ success: true, settings: result.settings });
  } catch (error) {
    console.error("[school-sms-settings] PUT failed:", error);
    return res.status(500).json({ success: false, error: "Failed to save SMS settings" });
  }
});

router.post("/test", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const apiKey = req.body?.apiKey;
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }

    const result = await testSchoolSmsConnection(schoolId, apiKey);
    if (!result.ok) {
      return res.status(400).json({
        success: false,
        error: result.error,
        settings: result.settings,
      });
    }

    return res.json({
      success: true,
      message: result.message,
      creditBalance: result.creditBalance,
      settings: result.settings,
    });
  } catch (error) {
    console.error("[school-sms-settings] POST test failed:", error);
    return res.status(500).json({ success: false, error: "Connection test failed" });
  }
});

router.get("/balance", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }

    const result = await checkSchoolSmsCreditBalance(schoolId);
    if (!result.ok) {
      return res.status(400).json({
        success: false,
        error: result.error,
        settings: result.settings,
      });
    }

    return res.json({
      success: true,
      creditBalance: result.creditBalance,
      settings: result.settings,
    });
  } catch (error) {
    console.error("[school-sms-settings] GET balance failed:", error);
    return res.status(500).json({ success: false, error: "Failed to check credit balance" });
  }
});

export default router;
