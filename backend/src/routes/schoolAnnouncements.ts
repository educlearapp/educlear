import { Router } from "express";
import { prisma } from "../prisma";
import {
  allowSchool,
  resolveStaffSchoolGate,
  sendAuthRequired,
} from "../middleware/staffSchoolGate";
import { assignedClassroomIdsForTeacher } from "../utils/classroomTeachers";
import { normalizeStaffEmail } from "../utils/staffJwt";
import { isSchoolWideNoticePublisherRole } from "./parentPortal";
import {
  createAnnouncementDraft,
  getAnnouncement,
  listAnnouncementAudit,
  listAnnouncements,
  previewAnnouncementAudience,
  transitionAnnouncement,
  updateAnnouncement,
  type AnnouncementActor,
} from "../services/schoolAnnouncementService";
import {
  actionFromHttpMethod,
  allowCommunicationsCentreActor,
  communicationsActionForLifecycle,
} from "../utils/communicationsCentreAccess";
import type { PermissionAction } from "../utils/userPermissions";

const router = Router();

async function resolveAnnouncementActor(
  req: { headers: { authorization?: string }; body?: any; query?: any; method?: string },
  res: any,
  schoolId: string,
  requireAction?: PermissionAction
): Promise<AnnouncementActor | null> {
  const gate = await resolveStaffSchoolGate(req.headers.authorization);
  if (!gate) {
    sendAuthRequired(res);
    return null;
  }
  if (!allowSchool(gate, schoolId, res)) return null;

  const action = requireAction || actionFromHttpMethod(req.method || "GET");
  if (!allowCommunicationsCentreActor(gate, action)) {
    res.status(403).json({
      success: false,
      error: `Permission denied: communications.${action}`,
      code: "COMMUNICATIONS_FORBIDDEN",
    });
    return null;
  }

  const classrooms = await prisma.classroom.findMany({
    where: {
      schoolId,
      id: {
        in: await assignedClassroomIdsForTeacher(
          schoolId,
          gate.auth.userId,
          gate.auth.email
        ),
      },
    },
    select: { name: true },
  });
  // Also include primary teacherEmail matches
  const byEmail = await prisma.classroom.findMany({
    where: {
      schoolId,
      teacherEmail: { equals: normalizeStaffEmail(gate.auth.email), mode: "insensitive" },
    },
    select: { name: true },
  });
  const assignedClassNames = [
    ...new Set(
      [...classrooms, ...byEmail].map((c) => String(c.name || "").trim()).filter(Boolean)
    ),
  ];

  const isSchoolWideAdmin = isSchoolWideNoticePublisherRole({
    superAdmin: gate.superAdmin,
    appRole: gate.auth.appRole,
    role: gate.auth.role,
  });

  return {
    userId: gate.auth.userId,
    email: normalizeStaffEmail(gate.auth.email),
    role: String(gate.auth.role || ""),
    appRole: gate.auth.appRole,
    isSchoolWideAdmin,
    assignedClassNames,
  };
}

function sendErr(res: any, e: unknown) {
  const status = typeof (e as any)?.status === "number" ? (e as any).status : 500;
  const message = e instanceof Error ? e.message : "Request failed";
  if (status >= 500) console.error("school-announcements", e);
  return res.status(status).json({ success: false, error: message });
}

router.get("/", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "schoolId required" });
    const actor = await resolveAnnouncementActor(req, res, schoolId);
    if (!actor) return;

    const lifecycleRaw = String(req.query.lifecycle || "ALL").trim().toUpperCase();
    const lifecycle =
      lifecycleRaw === "DRAFT" ||
      lifecycleRaw === "PUBLISHED" ||
      lifecycleRaw === "UNPUBLISHED" ||
      lifecycleRaw === "ARCHIVED"
        ? lifecycleRaw
        : "ALL";

    const result = await listAnnouncements({
      schoolId,
      actor,
      lifecycle: lifecycle as any,
      q: String(req.query.q || ""),
      take: Number(req.query.limit) || 40,
      cursor: String(req.query.cursor || "").trim() || null,
    });
    return res.json({ success: true, ...result });
  } catch (e) {
    return sendErr(res, e);
  }
});

function targetingFromBody(body: any) {
  return {
    audienceMode: body?.audienceMode ?? null,
    classScope: body?.classScope ?? null,
    grade: body?.grade ?? null,
    className: body?.className ?? null,
    learnerId: body?.learnerId ?? null,
    parentIds: body?.parentIds ?? body?.audienceParentIds ?? null,
    audienceParentIds: body?.audienceParentIds ?? null,
  };
}

router.post("/preview", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "schoolId required" });
    const actor = await resolveAnnouncementActor(req, res, schoolId, "view");
    if (!actor) return;
    const preview = await previewAnnouncementAudience({
      schoolId,
      actor,
      targeting: targetingFromBody(req.body),
    });
    return res.json({
      success: true,
      audience: preview.label,
      mode: preview.mode,
      classScope: preview.classScope,
      uniqueParentCount: preview.uniqueParentCount,
      learnerCount: preview.learnerCount,
      recipients: preview.recipients,
      targeting: preview.targeting,
    });
  } catch (e) {
    return sendErr(res, e);
  }
});

/** School-scoped parent search for individual targeting. */
router.get("/parents/search", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const q = String(req.query.q || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "schoolId required" });
    const actor = await resolveAnnouncementActor(req, res, schoolId, "view");
    if (!actor) return;

    const links = await prisma.parentLearnerLink.findMany({
      where: { schoolId },
      include: {
        parent: { select: { id: true, firstName: true, surname: true, idNumber: true, cellNo: true } },
        learner: { select: { id: true, firstName: true, lastName: true, className: true, grade: true } },
      },
      take: 500,
    });

    const assigned = new Set(actor.assignedClassNames.map((c) => String(c || "").trim()).filter(Boolean));
    const byParent = new Map<
      string,
      {
        id: string;
        name: string;
        idNumber: string | null;
        cellNo: string | null;
        learnerLabels: string[];
      }
    >();

    for (const link of links) {
      if (!actor.isSchoolWideAdmin) {
        const cn = String(link.learner.className || "").trim();
        if (!assigned.has(cn)) continue;
      }
      const name = `${link.parent.firstName || ""} ${link.parent.surname || ""}`.trim() || "Parent";
      const needle = q.toLowerCase();
      const hay = `${name} ${link.parent.idNumber || ""} ${link.parent.cellNo || ""}`.toLowerCase();
      if (q && !hay.includes(needle)) continue;
      const cur = byParent.get(link.parent.id) || {
        id: link.parent.id,
        name,
        idNumber: link.parent.idNumber ?? null,
        cellNo: (link.parent as { cellNo?: string | null }).cellNo ?? null,
        learnerLabels: [],
      };
      const label = `${link.learner.firstName || ""} ${link.learner.lastName || ""}`.trim();
      const cls = link.learner.className ? ` (${link.learner.className})` : "";
      const learnerLabel = `${label || "Learner"}${cls}`;
      if (!cur.learnerLabels.includes(learnerLabel)) cur.learnerLabels.push(learnerLabel);
      byParent.set(link.parent.id, cur);
    }

    const parents = [...byParent.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 40);
    return res.json({ success: true, parents });
  } catch (e) {
    return sendErr(res, e);
  }
});

router.post("/", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "schoolId required" });
    const publishNow = Boolean(req.body?.publishNow);
    // Draft create → create; publish-on-create → send (view alone must not publish).
    const actor = await resolveAnnouncementActor(req, res, schoolId, publishNow ? "send" : "create");
    if (!actor) return;

    const notice = await createAnnouncementDraft({
      schoolId,
      actor,
      title: String(req.body?.title || ""),
      body: String(req.body?.body || ""),
      noticeType: String(req.body?.noticeType || ""),
      targeting: targetingFromBody(req.body),
      visibility: req.body?.visibility,
      publishNow,
    });
    return res.json({ success: true, notice });
  } catch (e) {
    return sendErr(res, e);
  }
});

router.get("/:id", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const id = String(req.params.id || "").trim();
    if (!schoolId || !id) return res.status(400).json({ success: false, error: "schoolId and id required" });
    const actor = await resolveAnnouncementActor(req, res, schoolId);
    if (!actor) return;
    const notice = await getAnnouncement(schoolId, id);
    if (!notice) return res.status(404).json({ success: false, error: "Not found" });
    if (!actor.isSchoolWideAdmin) {
      const isOwnerNotice = notice.createdByTeacherId === actor.userId;
      const classOk =
        notice.className && actor.assignedClassNames.includes(String(notice.className));
      if (!classOk && !isOwnerNotice) {
        return res.status(403).json({ success: false, error: "Access denied" });
      }
    }
    const audit = await listAnnouncementAudit(schoolId, id);
    return res.json({ success: true, notice, audit });
  } catch (e) {
    return sendErr(res, e);
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const id = String(req.params.id || "").trim();
    if (!schoolId || !id) return res.status(400).json({ success: false, error: "schoolId and id required" });
    const actor = await resolveAnnouncementActor(req, res, schoolId);
    if (!actor) return;
    const body = req.body || {};
    const retarget =
      body.audienceMode != null ||
      body.classScope != null ||
      body.parentIds != null ||
      body.audienceParentIds != null ||
      "grade" in body ||
      "className" in body ||
      "learnerId" in body;
    const notice = await updateAnnouncement({
      schoolId,
      noticeId: id,
      actor,
      title: body.title,
      body: body.body,
      noticeType: body.noticeType,
      targeting: retarget ? targetingFromBody(body) : undefined,
      visibility: body.visibility,
    });
    return res.json({ success: true, notice });
  } catch (e) {
    return sendErr(res, e);
  }
});

function transitionHandler(action: "publish" | "unpublish" | "republish" | "archive") {
  return async (req: any, res: any) => {
    try {
      const schoolId = String(req.body?.schoolId || "").trim();
      const id = String(req.params.id || "").trim();
      if (!schoolId || !id) {
        return res.status(400).json({ success: false, error: "schoolId and id required" });
      }
      const actor = await resolveAnnouncementActor(
        req,
        res,
        schoolId,
        communicationsActionForLifecycle(action)
      );
      if (!actor) return;
      const notice = await transitionAnnouncement({ schoolId, noticeId: id, actor, action });
      return res.json({ success: true, notice });
    } catch (e) {
      return sendErr(res, e);
    }
  };
}

router.post("/:id/publish", transitionHandler("publish"));
router.post("/:id/unpublish", transitionHandler("unpublish"));
router.post("/:id/republish", transitionHandler("republish"));
router.post("/:id/archive", transitionHandler("archive"));

export default router;
