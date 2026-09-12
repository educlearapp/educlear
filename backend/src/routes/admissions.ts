/**
 * Staff Online Admissions settings API (OA-03A).
 * GET/PUT /api/admissions/settings — no public application routes.
 */
import { Router } from "express";

import {
  requireAdmissionsSettingsAuth,
  type AdmissionsSettingsAuthRequest,
} from "../middleware/requireAdmissionsSettingsAuth";
import { prisma } from "../prisma";
import {
  AdmissionsSettingsConflictError,
  AdmissionsSettingsValidationError,
  getSchoolAdmissionsSettings,
  upsertSchoolAdmissionsSettings,
} from "../services/admissions/schoolAdmissionsSettingsService";

const router = Router();

router.get(
  "/settings",
  requireAdmissionsSettingsAuth("view"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      const schoolId = req.admissionsSettingsAuth!.authorizedSchoolId;
      const settings = await getSchoolAdmissionsSettings(prisma, schoolId);
      return res.json({ success: true, settings });
    } catch (err) {
      if (err instanceof AdmissionsSettingsValidationError) {
        return res.status(err.statusCode).json({ success: false, error: err.message });
      }
      console.error("GET /api/admissions/settings failed", err);
      return res.status(500).json({ success: false, error: "Failed to load admissions settings" });
    }
  }
);

router.put(
  "/settings",
  requireAdmissionsSettingsAuth("manage"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      const schoolId = req.admissionsSettingsAuth!.authorizedSchoolId;
      const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
        string,
        unknown
      >;
      const settings = await upsertSchoolAdmissionsSettings(prisma, schoolId, body);
      // Intentionally do not log bank fields.
      return res.json({ success: true, settings });
    } catch (err) {
      if (err instanceof AdmissionsSettingsValidationError) {
        return res.status(err.statusCode).json({ success: false, error: err.message });
      }
      if (err instanceof AdmissionsSettingsConflictError) {
        return res.status(err.statusCode).json({
          success: false,
          error: err.message,
          code: err.code,
        });
      }
      console.error("PUT /api/admissions/settings failed");
      return res.status(500).json({ success: false, error: "Failed to save admissions settings" });
    }
  }
);

export default router;
