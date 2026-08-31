import { Router } from "express";

import type { SuperAdminRequest } from "../middleware/requireSuperAdmin";
import { listSuperAdminSchools } from "../services/superAdmin/listSuperAdminSchools";
import {
  resetSuperAdminSchoolPassword,
  SuperAdminSchoolPasswordResetError,
} from "../services/superAdmin/resetSuperAdminSchoolPassword";
import { updateSuperAdminSchool } from "../services/superAdmin/updateSuperAdminSchool";
import { updateSchoolLifecycle } from "../services/superAdmin/updateSchoolLifecycle";
import {
  SchoolLifecycleError,
  resolveLifecycleTargetSchoolId,
} from "../services/superAdmin/schoolLifecycle";

const router = Router();

/** GET /api/super-admin/schools — platform school monitoring (super-admin JWT only). */
router.get("/", async (_req: SuperAdminRequest, res) => {
  try {
    const result = await listSuperAdminSchools();
    return res.json(result);
  } catch (error: unknown) {
    console.error("[super-admin/schools]", error);
    const message = error instanceof Error ? error.message : "Failed to load schools";
    return res.status(500).json({ error: message });
  }
});

/** PATCH /api/super-admin/schools/:schoolId — lifecycle and/or subscription package (super-admin JWT only). */
router.patch("/:schoolId", async (req: SuperAdminRequest, res) => {
  try {
    const schoolId = resolveLifecycleTargetSchoolId(req.params.schoolId, req.body?.schoolId);
    const hasLifecycle =
      req.body != null && Object.prototype.hasOwnProperty.call(req.body, "lifecycleStatus");

    if (hasLifecycle) {
      const result = await updateSchoolLifecycle({
        schoolId,
        lifecycleStatus: req.body.lifecycleStatus,
        actor: req.superAdmin,
      });
      const packageRaw = req.body?.package as "Starter" | "Unlimited" | undefined;
      if (packageRaw) {
        await updateSuperAdminSchool({ schoolId, package: packageRaw });
      }
      return res.json(result);
    }

    const statusRaw = req.body?.status as "Active" | "Trial" | "Suspended" | undefined;
    const packageRaw = req.body?.package as "Starter" | "Unlimited" | undefined;
    await updateSuperAdminSchool({
      schoolId,
      status: statusRaw,
      package: packageRaw,
    });
    return res.json({ success: true });
  } catch (error: unknown) {
    console.error("[super-admin/schools] PATCH", error);
    if (error instanceof SchoolLifecycleError) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    const message = error instanceof Error ? error.message : "Failed to update school";
    return res.status(400).json({ success: false, error: message });
  }
});

/** POST /api/super-admin/schools/:schoolId/reset-password — owner login hash only. */
router.post("/:schoolId/reset-password", async (req: SuperAdminRequest, res) => {
  try {
    const schoolId = String(req.params.schoolId || "").trim();
    const result = await resetSuperAdminSchoolPassword({
      schoolId,
      claimedSchoolId: String(req.body?.schoolId || "").trim(),
      newPassword: String(req.body?.newPassword ?? req.body?.password ?? ""),
      confirmPassword: String(req.body?.confirmPassword ?? ""),
    });
    return res.json({
      success: true,
      schoolId: result.schoolId,
      schoolName: result.schoolName,
      ownerEmail: result.ownerEmail,
      message: `Password reset for ${result.schoolName}. The school owner can sign in with the new password.`,
    });
  } catch (error: unknown) {
    if (error instanceof SuperAdminSchoolPasswordResetError) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    console.error("[super-admin/schools] POST reset-password", error);
    const message = error instanceof Error ? error.message : "Failed to reset password";
    return res.status(500).json({ success: false, error: message });
  }
});

export default router;
