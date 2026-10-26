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
  createEventDraft,
  getEvent,
  listEventAudit,
  listStaffEvents,
  transitionEvent,
  updateEvent,
  type EventActor,
} from "../services/schoolEventService";
import { parseEventInstant } from "../services/schoolEventService";
import {
  actionFromHttpMethod,
  allowCommunicationsCentreActor,
  communicationsActionForLifecycle,
} from "../utils/communicationsCentreAccess";
import type { PermissionAction } from "../utils/userPermissions";

const router = Router();

async function resolveEventActor(
  req: { headers: { authorization?: string }; method?: string },
  res: any,
  schoolId: string,
  requireAction?: PermissionAction
): Promise<EventActor | null> {
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

  return {
    userId: gate.auth.userId,
    email: normalizeStaffEmail(gate.auth.email),
    role: String(gate.auth.role || ""),
    appRole: gate.auth.appRole,
    isSchoolWideAdmin: isSchoolWideNoticePublisherRole({
      superAdmin: gate.superAdmin,
      appRole: gate.auth.appRole,
      role: gate.auth.role,
    }),
    assignedClassNames,
  };
}

function sendErr(res: any, e: unknown) {
  const status = typeof (e as any)?.status === "number" ? (e as any).status : 500;
  const message = e instanceof Error ? e.message : "Request failed";
  if (status >= 500) console.error("school-events", e);
  return res.status(status).json({ success: false, error: message });
}

router.get("/", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "schoolId required" });
    const actor = await resolveEventActor(req, res, schoolId);
    if (!actor) return;

    const lifecycleRaw = String(req.query.lifecycle || "ALL").trim().toUpperCase();
    const lifecycle =
      lifecycleRaw === "DRAFT" ||
      lifecycleRaw === "PUBLISHED" ||
      lifecycleRaw === "CANCELLED" ||
      lifecycleRaw === "ARCHIVED"
        ? lifecycleRaw
        : "ALL";

    let from: Date | null = null;
    let to: Date | null = null;
    if (req.query.from) from = parseEventInstant(req.query.from, "from");
    if (req.query.to) to = parseEventInstant(req.query.to, "to");

    const result = await listStaffEvents({
      schoolId,
      actor,
      lifecycle: lifecycle as any,
      q: String(req.query.q || ""),
      from,
      to,
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
    const actor = await resolveEventActor(req, res, schoolId, publishNow ? "send" : "create");
    if (!actor) return;
    const event = await createEventDraft({
      schoolId,
      actor,
      title: String(req.body?.title || ""),
      description: String(req.body?.description || ""),
      startsAt: req.body?.startsAt,
      endsAt: req.body?.endsAt,
      location: req.body?.location ?? null,
      targeting: {
        grade: req.body?.grade ?? null,
        className: req.body?.className ?? null,
        learnerId: req.body?.learnerId ?? null,
      },
      publishNow,
    });
    return res.json({ success: true, event });
  } catch (e) {
    return sendErr(res, e);
  }
});

router.get("/:id", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const id = String(req.params.id || "").trim();
    if (!schoolId || !id) return res.status(400).json({ success: false, error: "schoolId and id required" });
    const actor = await resolveEventActor(req, res, schoolId);
    if (!actor) return;
    const event = await getEvent(schoolId, id);
    if (!event) return res.status(404).json({ success: false, error: "Not found" });
    if (!actor.isSchoolWideAdmin) {
      if (!event.className || !actor.assignedClassNames.includes(event.className)) {
        return res.status(403).json({ success: false, error: "Access denied" });
      }
    }
    const audit = await listEventAudit(schoolId, id);
    return res.json({ success: true, event, audit });
  } catch (e) {
    return sendErr(res, e);
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const id = String(req.params.id || "").trim();
    if (!schoolId || !id) return res.status(400).json({ success: false, error: "schoolId and id required" });
    const actor = await resolveEventActor(req, res, schoolId);
    if (!actor) return;
    const hasTargeting =
      req.body?.grade !== undefined ||
      req.body?.className !== undefined ||
      req.body?.learnerId !== undefined;
    const event = await updateEvent({
      schoolId,
      eventId: id,
      actor,
      title: req.body?.title,
      description: req.body?.description,
      startsAt: req.body?.startsAt,
      endsAt: req.body?.endsAt,
      location: req.body?.location,
      targeting: hasTargeting
        ? {
            grade: req.body?.grade,
            className: req.body?.className,
            learnerId: req.body?.learnerId,
          }
        : undefined,
    });
    return res.json({ success: true, event });
  } catch (e) {
    return sendErr(res, e);
  }
});

function transitionHandler(action: "publish" | "cancel" | "archive") {
  return async (req: any, res: any) => {
    try {
      const schoolId = String(req.body?.schoolId || "").trim();
      const id = String(req.params.id || "").trim();
      if (!schoolId || !id) {
        return res.status(400).json({ success: false, error: "schoolId and id required" });
      }
      const actor = await resolveEventActor(
        req,
        res,
        schoolId,
        communicationsActionForLifecycle(action)
      );
      if (!actor) return;
      const event = await transitionEvent({
        schoolId,
        eventId: id,
        actor,
        action,
        cancellationReason: req.body?.cancellationReason ?? null,
      });
      return res.json({ success: true, event });
    } catch (e) {
      return sendErr(res, e);
    }
  };
}

router.post("/:id/publish", transitionHandler("publish"));
router.post("/:id/cancel", transitionHandler("cancel"));
router.post("/:id/archive", transitionHandler("archive"));

export default router;
