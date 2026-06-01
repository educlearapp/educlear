import { Router } from "express";

import type { SuperAdminRequest } from "../middleware/requireSuperAdmin";
import { listSuperAdminSchools } from "../services/superAdmin/listSuperAdminSchools";

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

export default router;
