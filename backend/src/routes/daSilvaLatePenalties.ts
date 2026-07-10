import { Router, type Request, type Response } from "express";

import { requireDaSilvaLatePenaltyApply, type DaSilvaLatePenaltyApplyRequest } from "../middleware/requireDaSilvaLatePenaltyApply";
import { isDaSilvaLatePenaltySchoolAllowed } from "../services/daSilvaLatePenaltyEngine";
import {
  applyDaSilvaLatePenalties,
  type DaSilvaPenaltyApplyResult,
} from "../services/daSilvaLatePenaltyApplyService";
import {
  previewDaSilvaLatePenalties,
  type DaSilvaLatePenaltyPreviewResult,
} from "../services/daSilvaLatePenaltyPreviewService";

export type DaSilvaLatePenaltyRouteDeps = {
  previewDaSilvaLatePenalties: typeof previewDaSilvaLatePenalties;
  applyDaSilvaLatePenalties: typeof applyDaSilvaLatePenalties;
};

const defaultDeps: DaSilvaLatePenaltyRouteDeps = {
  previewDaSilvaLatePenalties,
  applyDaSilvaLatePenalties,
};

/** Register routes (inject deps in integration tests to avoid ledger writes). */
export function registerDaSilvaLatePenaltyRoutes(
  router: Router,
  deps: DaSilvaLatePenaltyRouteDeps = defaultDeps
) {
  router.post("/preview", async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const schoolId = String(body.schoolId || "").trim();
      const penaltyMonth = String(body.penaltyMonth || "").trim();
      const accountRefs = Array.isArray(body.accountRefs)
        ? body.accountRefs.map((v) => String(v).trim()).filter(Boolean)
        : undefined;

      if (!schoolId) {
        return res.status(400).json({ success: false, error: "Missing schoolId" });
      }
      if (!penaltyMonth) {
        return res.status(400).json({ success: false, error: "Missing penaltyMonth (YYYY-MM)" });
      }

      if (!isDaSilvaLatePenaltySchoolAllowed(schoolId)) {
        return res.status(403).json({
          success: false,
          schoolAllowed: false,
          previewOnly: true,
          applyBlocked: true,
          error: "Da Silva late penalty preview is not available for this school.",
        });
      }

      const preview = await deps.previewDaSilvaLatePenalties({
        schoolId,
        penaltyMonth,
        accountRefs,
      });

      return res.json({
        success: true,
        ...preview,
      });
    } catch (error) {
      console.error("[billing/da-silva-late-penalties] POST /preview failed:", error);
      const message = error instanceof Error ? error.message : "Server error";
      return res.status(500).json({ success: false, error: message });
    }
  });

  router.get("/preview", async (req, res) => {
    try {
      const schoolId = String(req.query.schoolId || "").trim();
      const penaltyMonth = String(req.query.penaltyMonth || "").trim();
      const accountRefsRaw = String(req.query.accountRefs || "").trim();
      const accountRefs = accountRefsRaw
        ? accountRefsRaw.split(",").map((v) => v.trim()).filter(Boolean)
        : undefined;

      if (!schoolId) {
        return res.status(400).json({ success: false, error: "Missing schoolId" });
      }
      if (!penaltyMonth) {
        return res.status(400).json({ success: false, error: "Missing penaltyMonth (YYYY-MM)" });
      }

      if (!isDaSilvaLatePenaltySchoolAllowed(schoolId)) {
        return res.status(403).json({
          success: false,
          schoolAllowed: false,
          previewOnly: true,
          applyBlocked: true,
          error: "Da Silva late penalty preview is not available for this school.",
        });
      }

      const preview = await deps.previewDaSilvaLatePenalties({
        schoolId,
        penaltyMonth,
        accountRefs,
      });

      return res.json({
        success: true,
        ...preview,
      });
    } catch (error) {
      console.error("[billing/da-silva-late-penalties] GET /preview failed:", error);
      const message = error instanceof Error ? error.message : "Server error";
      return res.status(500).json({ success: false, error: message });
    }
  });

  router.post("/apply", requireDaSilvaLatePenaltyApply, async (req: DaSilvaLatePenaltyApplyRequest, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const schoolId = String(req.daSilvaApplyAuth?.schoolId || "").trim();
      const penaltyMonth = String(body.penaltyMonth || "").trim();
      const selectedAccountRefs = Array.isArray(body.selectedAccountRefs)
        ? body.selectedAccountRefs.map((v) => String(v).trim()).filter(Boolean)
        : [];

      if (!penaltyMonth) {
        return res.status(400).json({ success: false, error: "Missing penaltyMonth (YYYY-MM)" });
      }
      if (!selectedAccountRefs.length) {
        return res.status(400).json({ success: false, error: "No accounts selected for apply" });
      }

      const result: DaSilvaPenaltyApplyResult = await deps.applyDaSilvaLatePenalties({
        schoolId,
        penaltyMonth,
        selectedAccountRefs,
      });

      return res.json(result);
    } catch (error) {
      console.error("[billing/da-silva-late-penalties] POST /apply failed:", error);
      const message = error instanceof Error ? error.message : "Server error";
      return res.status(500).json({ success: false, error: message });
    }
  });
}

const router = Router();
registerDaSilvaLatePenaltyRoutes(router);
export default router;
