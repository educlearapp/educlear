import { Router } from "express";
import {
  buildSetupRequiredPayload,
  emailReportForLearner,
  emailReportsForClassroom,
  getClassroomReportEmailPreview,
  isEmailSetupError,
} from "../services/classroomReportEmailService";

const router = Router();

router.get("/:classroomId/email-reports/preview", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const classroomId = String(req.params.classroomId || "").trim();
    if (!schoolId || !classroomId) {
      return res.status(400).json({ success: false, error: "schoolId and classroomId are required" });
    }

    const preview = await getClassroomReportEmailPreview(schoolId, classroomId);
    if (!preview) {
      return res.status(404).json({ success: false, error: "Classroom not found" });
    }

    return res.json({ success: true, ...preview });
  } catch (error) {
    console.error("classroom email-reports preview", error);
    return res.status(500).json({ success: false, error: "Failed to load email preview" });
  }
});

router.post("/:classroomId/email-reports", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || req.query.schoolId || "").trim();
    const classroomId = String(req.params.classroomId || "").trim();
    const idempotencyKey = String(req.body?.idempotencyKey || "").trim() || undefined;

    if (!schoolId || !classroomId) {
      return res.status(400).json({ success: false, error: "schoolId and classroomId are required" });
    }

    const summary = await emailReportsForClassroom(schoolId, classroomId, idempotencyKey);
    return res.json({ ...summary, success: summary.failedCount === 0 });
  } catch (error: unknown) {
    console.error("classroom email-reports", error);
    if (isEmailSetupError(error)) {
      return res.status(409).json(buildSetupRequiredPayload());
    }
    const message = error instanceof Error ? error.message : "Failed to email reports";
    return res.status(500).json({ success: false, error: message });
  }
});

router.post("/:classroomId/learners/:learnerId/email-report", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || req.query.schoolId || "").trim();
    const classroomId = String(req.params.classroomId || "").trim();
    const learnerId = String(req.params.learnerId || "").trim();
    const idempotencyKey = String(req.body?.idempotencyKey || "").trim() || undefined;

    if (!schoolId || !classroomId || !learnerId) {
      return res.status(400).json({
        success: false,
        error: "schoolId, classroomId, and learnerId are required",
      });
    }

    const summary = await emailReportForLearner({
      schoolId,
      classroomId,
      learnerId,
      idempotencyKey,
    });

    return res.json({
      ...summary,
      success: summary.sentCount > 0 && summary.failedCount === 0,
    });
  } catch (error: unknown) {
    console.error("classroom learner email-report", error);
    if (isEmailSetupError(error)) {
      return res.status(409).json(buildSetupRequiredPayload());
    }
    const message = error instanceof Error ? error.message : "Failed to email report";
    return res.status(500).json({ success: false, error: message });
  }
});

export default router;
