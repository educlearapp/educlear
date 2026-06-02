import { Router } from "express";

import type { SuperAdminRequest } from "../middleware/requireSuperAdmin";
import { listSuperAdminSchools } from "../services/superAdmin/listSuperAdminSchools";
import { updateSuperAdminSchool } from "../services/superAdmin/updateSuperAdminSchool";

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

/** PATCH /api/super-admin/schools/:schoolId — update school status/package (super-admin JWT only). */
router.patch("/:schoolId", async (req: SuperAdminRequest, res) => {
  try {
    const schoolId = String(req.params.schoolId || "").trim();
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
    const message = error instanceof Error ? error.message : "Failed to update school";
    return res.status(400).json({ success: false, error: message });
  }
});

export default router;
