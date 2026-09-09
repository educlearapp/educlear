import { Router } from "express";

import {
  requireOutstandingAccountsAuth,
  type OutstandingAccountsAuthRequest,
} from "../middleware/requireOutstandingAccountsAuth";
import { buildOutstandingAccountsReport } from "../services/outstandingAccountsService";

const router = Router();

/**
 * GET /api/outstanding-accounts?schoolId=
 * Read-only Outstanding Accounts report for the authenticated staff school.
 * schoolId query must match JWT/DB authorized school when provided.
 */
router.get("/", requireOutstandingAccountsAuth, async (req: OutstandingAccountsAuthRequest, res) => {
  try {
    const auth = req.outstandingAccountsAuth;
    if (!auth?.authorizedSchoolId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
        code: "AUTH_REQUIRED",
      });
    }

    const asOfRaw = typeof req.query?.asOfDate === "string" ? String(req.query.asOfDate).trim() : "";
    const report = await buildOutstandingAccountsReport({
      schoolId: auth.authorizedSchoolId,
      asOfDate: asOfRaw || undefined,
    });

    return res.json({
      success: true,
      schoolId: report.schoolId,
      asOfDate: report.asOfDate,
      summary: report.summary,
      accounts: report.accounts,
    });
  } catch (error) {
    console.error("[outstanding-accounts] GET / failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
