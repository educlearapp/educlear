/**
 * HomeSafe Collections V2 staff API.
 * Mounted at /api/homesafe/collections under CORE school module gate.
 * Uses authorizedSchoolId — never trusts client schoolId for writes.
 * Prisma-backed. Does not modify Group/GroupLearner or Early Departure.
 */
import { Router } from "express";
import { getPrismaHomeSafeCollectionsService } from "../services/homesafeCollectionsPrismaService";
import { HsCgDomainError } from "../services/homesafeCollectionsDomain";

const router = Router();

function schoolIdFromReq(req: any): string {
  const auth = req.schoolModuleAuth as { authorizedSchoolId?: string } | undefined;
  const fromAuth = String(auth?.authorizedSchoolId || "").trim();
  if (fromAuth) return fromAuth;
  return String(req.collectionsSchoolId || "").trim();
}

function svc() {
  return getPrismaHomeSafeCollectionsService();
}

function sendDomainError(res: any, e: unknown) {
  if (e instanceof HsCgDomainError) {
    const status =
      e.code === "NOT_FOUND"
        ? 404
        : e.code === "CONFLICT"
          ? 409
          : e.code === "SCHOOL_MISMATCH" || e.code === "FORBIDDEN"
            ? 403
            : 400;
    return res.status(status).json({ success: false, error: e.message, code: e.code });
  }
  console.error("[homesafe-collections]", e);
  return res.status(500).json({ success: false, error: "Collections request failed" });
}

router.get("/groups", async (req, res) => {
  try {
    const schoolId = schoolIdFromReq(req);
    if (!schoolId) return res.status(401).json({ success: false, error: "Authentication required" });
    return res.json({ success: true, groups: await svc().listGroups(schoolId) });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.post("/groups", async (req, res) => {
  try {
    const schoolId = schoolIdFromReq(req);
    if (!schoolId) return res.status(401).json({ success: false, error: "Authentication required" });
    const group = await svc().createGroup({
      schoolId,
      name: String(req.body?.name || ""),
      kind: req.body?.kind,
      driverName: req.body?.driverName,
      driverContact: req.body?.driverContact,
      vehicleReg: req.body?.vehicleReg,
    });
    return res.status(201).json({ success: true, group });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.patch("/groups/:groupId", async (req, res) => {
  try {
    const schoolId = schoolIdFromReq(req);
    if (!schoolId) return res.status(401).json({ success: false, error: "Authentication required" });
    const group = await svc().updateGroup({
      schoolId,
      groupId: String(req.params.groupId),
      name: req.body?.name,
      driverName: req.body?.driverName,
      driverContact: req.body?.driverContact,
      vehicleReg: req.body?.vehicleReg,
      expectedUpdatedAt: req.body?.expectedUpdatedAt,
    });
    return res.json({ success: true, group });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.get("/groups/:groupId/deletion-impact", async (req, res) => {
  try {
    const schoolId = schoolIdFromReq(req);
    if (!schoolId) return res.status(401).json({ success: false, error: "Authentication required" });
    const impact = await svc().getGroupDeletionImpact(schoolId, String(req.params.groupId));
    return res.json({ success: true, impact });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.delete("/groups/:groupId", async (req, res) => {
  try {
    const schoolId = schoolIdFromReq(req);
    if (!schoolId) return res.status(401).json({ success: false, error: "Authentication required" });
    const result = await svc().deleteGroup({
      schoolId,
      groupId: String(req.params.groupId),
      confirmName: String(req.body?.confirmName || req.query?.confirmName || ""),
      expectedUpdatedAt:
        req.body?.expectedUpdatedAt !== undefined
          ? String(req.body.expectedUpdatedAt)
          : req.query?.expectedUpdatedAt !== undefined
            ? String(req.query.expectedUpdatedAt)
            : undefined,
    });
    return res.json({ success: true, ...result });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.get("/groups/:groupId/sessions", async (req, res) => {
  try {
    const schoolId = schoolIdFromReq(req);
    if (!schoolId) return res.status(401).json({ success: false, error: "Authentication required" });
    const sessions = await svc().listSessionsForGroup(schoolId, String(req.params.groupId));
    return res.json({ success: true, sessions });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.post("/groups/:groupId/sessions", async (req, res) => {
  try {
    const schoolId = schoolIdFromReq(req);
    if (!schoolId) return res.status(401).json({ success: false, error: "Authentication required" });
    const result = await svc().createSession({
      schoolId,
      groupId: String(req.params.groupId),
      weekday: String(req.body?.weekday || ""),
      startTime: String(req.body?.startTime || req.body?.start || ""),
      endTime: String(req.body?.endTime || req.body?.end || ""),
      responsibleAdult: req.body?.responsibleAdult,
      location: req.body?.location,
      learnerIds: Array.isArray(req.body?.learnerIds) ? req.body.learnerIds.map(String) : [],
    });
    return res.status(201).json({ success: true, ...result });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.patch("/sessions/:sessionId", async (req, res) => {
  try {
    const schoolId = schoolIdFromReq(req);
    if (!schoolId) return res.status(401).json({ success: false, error: "Authentication required" });
    const session = await svc().updateSession({
      schoolId,
      sessionId: String(req.params.sessionId),
      weekday: req.body?.weekday,
      startTime: req.body?.startTime ?? req.body?.start,
      endTime: req.body?.endTime ?? req.body?.end,
      responsibleAdult: req.body?.responsibleAdult,
      location: req.body?.location,
      expectedUpdatedAt: req.body?.expectedUpdatedAt,
    });
    return res.json({ success: true, session });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.delete("/sessions/:sessionId", async (req, res) => {
  try {
    const schoolId = schoolIdFromReq(req);
    if (!schoolId) return res.status(401).json({ success: false, error: "Authentication required" });
    const result = await svc().deleteSession({
      schoolId,
      sessionId: String(req.params.sessionId),
      expectedUpdatedAt:
        req.body?.expectedUpdatedAt !== undefined
          ? String(req.body.expectedUpdatedAt)
          : req.query?.expectedUpdatedAt !== undefined
            ? String(req.query.expectedUpdatedAt)
            : undefined,
    });
    return res.json({ success: true, ...result });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.get("/sessions/:sessionId/learners", async (req, res) => {
  try {
    const schoolId = schoolIdFromReq(req);
    if (!schoolId) return res.status(401).json({ success: false, error: "Authentication required" });
    const learnerIds = await svc().getSessionLearnerIds(schoolId, String(req.params.sessionId));
    return res.json({ success: true, sessionId: req.params.sessionId, learnerIds });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.put("/sessions/:sessionId/learners", async (req, res) => {
  try {
    const schoolId = schoolIdFromReq(req);
    if (!schoolId) return res.status(401).json({ success: false, error: "Authentication required" });
    const learnerIds = Array.isArray(req.body?.learnerIds) ? req.body.learnerIds.map(String) : [];
    const result = await svc().setSessionLearners({
      schoolId,
      sessionId: String(req.params.sessionId),
      learnerIds,
    });
    return res.json({ success: true, ...result });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.delete("/sessions/:sessionId/learners/:learnerId", async (req, res) => {
  try {
    const schoolId = schoolIdFromReq(req);
    if (!schoolId) return res.status(401).json({ success: false, error: "Authentication required" });
    await svc().removeLearnerFromSession({
      schoolId,
      sessionId: String(req.params.sessionId),
      learnerId: String(req.params.learnerId),
    });
    return res.json({ success: true });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.post("/assignments", async (req, res) => {
  try {
    const schoolId = schoolIdFromReq(req);
    if (!schoolId) return res.status(401).json({ success: false, error: "Authentication required" });
    const result = await svc().assignLearnersToSessions({
      schoolId,
      learnerIds: Array.isArray(req.body?.learnerIds) ? req.body.learnerIds.map(String) : [],
      sessionIds: Array.isArray(req.body?.sessionIds) ? req.body.sessionIds.map(String) : [],
    });
    return res.json({ success: true, ...result });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.get("/registers", async (req, res) => {
  try {
    const schoolId = schoolIdFromReq(req);
    if (!schoolId) return res.status(401).json({ success: false, error: "Authentication required" });
    const date = String(req.query.date || "").trim();
    if (!date) return res.status(400).json({ success: false, error: "date (YYYY-MM-DD) required" });
    const result = await svc().getRegistersForDate(schoolId, date);
    return res.json({ success: true, date, ...result });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.patch("/registers", async (req, res) => {
  try {
    const schoolId = schoolIdFromReq(req);
    if (!schoolId) return res.status(401).json({ success: false, error: "Authentication required" });
    const row = await svc().patchRegisterRow({
      schoolId,
      sessionId: String(req.body?.sessionId || ""),
      learnerId: String(req.body?.learnerId || ""),
      schoolLocalDate: String(req.body?.date || req.body?.schoolLocalDate || ""),
      attendance: req.body?.attendance,
      progress: req.body?.progress,
      note: req.body?.note,
    });
    return res.json({ success: true, row });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.get("/learners", async (req, res) => {
  try {
    const schoolId = schoolIdFromReq(req);
    if (!schoolId) return res.status(401).json({ success: false, error: "Authentication required" });
    const learners = await svc().listSchoolLearners(schoolId);
    return res.json({ success: true, learners });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

export default router;
