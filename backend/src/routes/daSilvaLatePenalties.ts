import { Router } from "express";

import { isDaSilvaLatePenaltySchoolAllowed } from "../services/daSilvaLatePenaltyEngine";
import { previewDaSilvaLatePenalties } from "../services/daSilvaLatePenaltyPreviewService";

const router = Router();

/**
 * Da Silva percentage-based late penalty preview (phase 2).
 * READ-ONLY — no apply route; existing fixed-amount apply path is unchanged.
 */
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

    const preview = await previewDaSilvaLatePenalties({
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

    const preview = await previewDaSilvaLatePenalties({
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

export default router;
