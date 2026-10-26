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
      targeting: {
        grade: req.body?.grade ?? null,
        className: req.body?.className ?? null,
        learnerId: req.body?.learnerId ?? null,
      },
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
      if (!notice.className || !actor.assignedClassNames.includes(notice.className)) {
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
    const notice = await updateAnnouncement({
      schoolId,
      noticeId: id,
      actor,
      title: req.body?.title,
      body: req.body?.body,
      noticeType: req.body?.noticeType,
      targeting: {
        grade: req.body?.grade,
        className: req.body?.className,
        learnerId: req.body?.learnerId,
      },
      visibility: req.body?.visibility,
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
