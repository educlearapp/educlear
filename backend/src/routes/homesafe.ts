import { Router } from "express";
import {
  dismissHomeSafeLearner,
  normalizeHomeSafeCollectionMethod,
  searchHomeSafeLearners,
} from "../services/homesafeService";

export type HomeSafeTeacherContext = {
  userId: string;
  schoolId: string;
};

const router = Router();

function ctx(req: any): HomeSafeTeacherContext {
  return req.teacherCtx as HomeSafeTeacherContext;
}

router.get("/learners", async (req, res) => {
  try {
    const { schoolId } = ctx(req);
    const search = String(req.query.search || "");
    const result = await searchHomeSafeLearners({ schoolId, search });
    return res.json({
      success: true,
      schoolLocalDate: result.schoolLocalDate,
      learners: result.learners,
    });
  } catch (e) {
    console.error("[homesafe] search learners", e);
    return res.status(500).json({ success: false, error: "Failed to search learners" });
  }
});

router.post("/dismiss", async (req, res) => {
  try {
    const { schoolId, userId } = ctx(req);
    const learnerId = String(req.body?.learnerId || "").trim();
    const collectionMethod = normalizeHomeSafeCollectionMethod(req.body?.collectionMethod);

    if (!learnerId) {
      return res.status(400).json({ success: false, error: "learnerId required" });
    }
    if (!collectionMethod) {
      return res.status(400).json({
        success: false,
        error:
          "collectionMethod must be one of PARENT, UNCLE, SIBLING, GRANDPARENT, BOLT, SCHOOL_TRANSPORT, TAXI, OTHER (legacy TRANSPORT still accepted)",
      });
    }

    const collectionNote = String(req.body?.collectionNote || req.body?.staffNote || "").trim();

    const result = await dismissHomeSafeLearner({
      schoolId,
      teacherId: userId,
      learnerId,
      collectionMethod,
      collectionNote: collectionNote || null,
    });

    if (!result.ok) {
      if (result.code === "CONFLICT") {
        return res.status(409).json({
          success: false,
          error: result.message,
          code: "ALREADY_DISMISSED",
          existingDismissal: result.existing ?? null,
        });
      }
      if (result.code === "NOT_FOUND") {
        return res.status(404).json({ success: false, error: result.message });
      }
      if (result.code === "INACTIVE") {
        return res.status(409).json({ success: false, error: result.message, code: "INACTIVE" });
      }
      if (result.code === "NOTE_REQUIRED") {
        return res.status(400).json({ success: false, error: result.message, code: result.code });
      }
      return res.status(400).json({ success: false, error: result.message });
    }

    return res.json({ success: true, dismissal: result.dismissal });
  } catch (e) {
    console.error("[homesafe] dismiss", e);
    return res.status(500).json({ success: false, error: "Failed to save dismissal" });
  }
});

export default router;
