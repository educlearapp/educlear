/**
 * Teacher Portal HomeSafe Collections — school-scoped read + management + register patch.
 * Mounted under /api/teacher-app/homesafe/collections.
 * Uses teacherCtx.schoolId only (never client schoolId).
 * Reuses PrismaHomeSafeCollectionsService (same records as Admin) — does not proxy Admin routes.
 */
import { Router } from "express";
import { prisma } from "../prisma";
import {
  getPrismaHomeSafeCollectionsService,
} from "../services/homesafeCollectionsPrismaService";
import {
  HsCgDomainError,
  type HsCgAttendance,
  type HsCgGroupKind,
  type HsCgProgress,
} from "../services/homesafeCollectionsDomain";
import {
  DEFAULT_SCHOOL_TIMEZONE,
  resolveSchoolLocalParts,
} from "../utils/schoolLocalTime";

export type HomeSafeTeacherContext = {
  userId: string;
  schoolId: string;
};

const ATTENDANCE: ReadonlySet<string> = new Set([
  "PRESENT",
  "ABSENT",
  "LATE",
  "EXCUSED",
  "UNCONFIRMED",
]);

const PROGRESS: ReadonlySet<string> = new Set([
  "WAITING",
  "CALLED",
  "READY",
  "COLLECTED",
  "HANDED_OVER",
  "RETURNED",
  "PARTICIPATING",
  "COMPLETED",
  "AWAY",
]);

const router = Router();

function ctx(req: any): HomeSafeTeacherContext {
  return req.teacherCtx as HomeSafeTeacherContext;
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
  console.error("[homesafe-teacher-collections]", e);
  return res.status(500).json({ success: false, error: "Collections request failed" });
}

function resolveDate(queryDate: unknown): string {
  const raw = String(queryDate || "").trim();
  if (raw) return raw;
  return resolveSchoolLocalParts(new Date(), DEFAULT_SCHOOL_TIMEZONE).schoolLocalDate;
}

/**
 * Capabilities honestly advertise what the backend persists today.
 * Call/Ack teacher workflow is admin-demo only (no persistence).
 * Register patch persists attendance/progress/note but has no actor audit trail.
 */
const TEACHER_COLLECTIONS_CAPABILITIES = {
  canViewGroupsAndSessions: true,
  canManageGroups: true,
  canPatchRegister: true,
  hasRegisterActorAudit: false,
  hasCallAckWorkflow: false,
  hasLearnerPhotos: false,
  hasSoftDeleteArchive: false,
  hasGroupDescription: false,
} as const;

async function assertActiveTeacher(req: any, res: any): Promise<HomeSafeTeacherContext | null> {
  const teacher = ctx(req);
  if (!teacher?.schoolId || !teacher?.userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { id: teacher.userId },
    select: { id: true, schoolId: true, isActive: true, role: true },
  });
  if (!user || !user.isActive || user.schoolId !== teacher.schoolId) {
    res.status(403).json({
      success: false,
      error: "Teacher account is inactive or unauthorised for this school",
      code: "FORBIDDEN",
    });
    return null;
  }
  if (user.role === "FINANCE") {
    res.status(403).json({
      success: false,
      error: "HomeSafe Collections management is not available for finance accounts",
      code: "FORBIDDEN",
    });
    return null;
  }
  return teacher;
}

router.get("/bootstrap", async (req, res) => {
  try {
    const teacher = await assertActiveTeacher(req, res);
    if (!teacher) return;
    const schoolLocalDate = resolveDate(req.query.date);
    const snapshot = await svc().getTeacherCollectionsSnapshot(teacher.schoolId, schoolLocalDate);
    return res.json({
      success: true,
      schoolLocalDate,
      weekday: snapshot.weekday,
      groups: snapshot.groups,
      learners: snapshot.learners,
      registers: snapshot.registers,
      daySessions: snapshot.daySessions,
      capabilities: TEACHER_COLLECTIONS_CAPABILITIES,
    });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.get("/learners", async (req, res) => {
  try {
    const teacher = await assertActiveTeacher(req, res);
    if (!teacher) return;
    const learners = await svc().listSchoolLearners(teacher.schoolId);
    return res.json({
      success: true,
      learners,
      capabilities: TEACHER_COLLECTIONS_CAPABILITIES,
    });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.get("/groups", async (req, res) => {
  try {
    const teacher = await assertActiveTeacher(req, res);
    if (!teacher) return;
    return res.json({
      success: true,
      groups: await svc().listGroups(teacher.schoolId),
      capabilities: TEACHER_COLLECTIONS_CAPABILITIES,
    });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.post("/groups", async (req, res) => {
  try {
    const teacher = await assertActiveTeacher(req, res);
    if (!teacher) return;
    const kind = String(req.body?.kind || "").trim().toUpperCase() as HsCgGroupKind;
    const group = await svc().createGroup({
      schoolId: teacher.schoolId,
      name: String(req.body?.name || ""),
      kind,
      driverName: req.body?.driverName,
      driverContact: req.body?.driverContact,
      vehicleReg: req.body?.vehicleReg,
    });
    return res.status(201).json({
      success: true,
      group,
      capabilities: TEACHER_COLLECTIONS_CAPABILITIES,
    });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.patch("/groups/:groupId", async (req, res) => {
  try {
    const teacher = await assertActiveTeacher(req, res);
    if (!teacher) return;
    const group = await svc().updateGroup({
      schoolId: teacher.schoolId,
      groupId: String(req.params.groupId || ""),
      name: req.body?.name,
      driverName: req.body?.driverName,
      driverContact: req.body?.driverContact,
      vehicleReg: req.body?.vehicleReg,
      expectedUpdatedAt: req.body?.expectedUpdatedAt,
    });
    return res.json({
      success: true,
      group,
      capabilities: TEACHER_COLLECTIONS_CAPABILITIES,
    });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.get("/groups/:groupId/deletion-impact", async (req, res) => {
  try {
    const teacher = await assertActiveTeacher(req, res);
    if (!teacher) return;
    const impact = await svc().getGroupDeletionImpact(
      teacher.schoolId,
      String(req.params.groupId || "")
    );
    return res.json({
      success: true,
      impact,
      capabilities: TEACHER_COLLECTIONS_CAPABILITIES,
    });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.delete("/groups/:groupId", async (req, res) => {
  try {
    const teacher = await assertActiveTeacher(req, res);
    if (!teacher) return;
    const result = await svc().deleteGroup({
      schoolId: teacher.schoolId,
      groupId: String(req.params.groupId || ""),
      confirmName: String(req.body?.confirmName || req.query?.confirmName || ""),
      expectedUpdatedAt:
        req.body?.expectedUpdatedAt !== undefined
          ? String(req.body.expectedUpdatedAt)
          : req.query?.expectedUpdatedAt !== undefined
            ? String(req.query.expectedUpdatedAt)
            : undefined,
    });
    return res.json({
      success: true,
      ...result,
      capabilities: TEACHER_COLLECTIONS_CAPABILITIES,
    });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.get("/groups/:groupId/sessions", async (req, res) => {
  try {
    const teacher = await assertActiveTeacher(req, res);
    if (!teacher) return;
    const sessions = await svc().listSessionsForGroup(
      teacher.schoolId,
      String(req.params.groupId || "")
    );
    return res.json({
      success: true,
      sessions,
      capabilities: TEACHER_COLLECTIONS_CAPABILITIES,
    });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.post("/groups/:groupId/sessions", async (req, res) => {
  try {
    const teacher = await assertActiveTeacher(req, res);
    if (!teacher) return;
    const weekdays = Array.isArray(req.body?.weekdays)
      ? req.body.weekdays.map(String)
      : req.body?.weekday
        ? [String(req.body.weekday)]
        : [];
    const learnerIds = Array.isArray(req.body?.learnerIds)
      ? req.body.learnerIds.map(String)
      : [];
    if (weekdays.length > 1) {
      const result = await svc().createSessionsForWeekdays({
        schoolId: teacher.schoolId,
        groupId: String(req.params.groupId || ""),
        weekdays,
        startTime: String(req.body?.startTime || req.body?.start || ""),
        endTime: String(req.body?.endTime || req.body?.end || ""),
        responsibleAdult: req.body?.responsibleAdult,
        location: req.body?.location,
        learnerIds,
      });
      return res.status(201).json({
        success: true,
        ...result,
        capabilities: TEACHER_COLLECTIONS_CAPABILITIES,
      });
    }
    const result = await svc().createSession({
      schoolId: teacher.schoolId,
      groupId: String(req.params.groupId || ""),
      weekday: weekdays[0] || String(req.body?.weekday || ""),
      startTime: String(req.body?.startTime || req.body?.start || ""),
      endTime: String(req.body?.endTime || req.body?.end || ""),
      responsibleAdult: req.body?.responsibleAdult,
      location: req.body?.location,
      learnerIds,
    });
    return res.status(201).json({
      success: true,
      ...result,
      capabilities: TEACHER_COLLECTIONS_CAPABILITIES,
    });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.patch("/sessions/:sessionId", async (req, res) => {
  try {
    const teacher = await assertActiveTeacher(req, res);
    if (!teacher) return;
    const session = await svc().updateSession({
      schoolId: teacher.schoolId,
      sessionId: String(req.params.sessionId || ""),
      weekday: req.body?.weekday,
      startTime: req.body?.startTime ?? req.body?.start,
      endTime: req.body?.endTime ?? req.body?.end,
      responsibleAdult: req.body?.responsibleAdult,
      location: req.body?.location,
      expectedUpdatedAt: req.body?.expectedUpdatedAt,
    });
    return res.json({
      success: true,
      session,
      capabilities: TEACHER_COLLECTIONS_CAPABILITIES,
    });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.delete("/sessions/:sessionId", async (req, res) => {
  try {
    const teacher = await assertActiveTeacher(req, res);
    if (!teacher) return;
    const result = await svc().deleteSession({
      schoolId: teacher.schoolId,
      sessionId: String(req.params.sessionId || ""),
      expectedUpdatedAt:
        req.body?.expectedUpdatedAt !== undefined
          ? String(req.body.expectedUpdatedAt)
          : req.query?.expectedUpdatedAt !== undefined
            ? String(req.query.expectedUpdatedAt)
            : undefined,
    });
    return res.json({
      success: true,
      ...result,
      capabilities: TEACHER_COLLECTIONS_CAPABILITIES,
    });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.get("/sessions/:sessionId/learners", async (req, res) => {
  try {
    const teacher = await assertActiveTeacher(req, res);
    if (!teacher) return;
    const learnerIds = await svc().getSessionLearnerIds(
      teacher.schoolId,
      String(req.params.sessionId || "")
    );
    return res.json({
      success: true,
      sessionId: req.params.sessionId,
      learnerIds,
      capabilities: TEACHER_COLLECTIONS_CAPABILITIES,
    });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.put("/sessions/:sessionId/learners", async (req, res) => {
  try {
    const teacher = await assertActiveTeacher(req, res);
    if (!teacher) return;
    const learnerIds = Array.isArray(req.body?.learnerIds)
      ? req.body.learnerIds.map(String)
      : [];
    const result = await svc().setSessionLearners({
      schoolId: teacher.schoolId,
      sessionId: String(req.params.sessionId || ""),
      learnerIds,
    });
    return res.json({
      success: true,
      ...result,
      capabilities: TEACHER_COLLECTIONS_CAPABILITIES,
    });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.delete("/sessions/:sessionId/learners/:learnerId", async (req, res) => {
  try {
    const teacher = await assertActiveTeacher(req, res);
    if (!teacher) return;
    await svc().removeLearnerFromSession({
      schoolId: teacher.schoolId,
      sessionId: String(req.params.sessionId || ""),
      learnerId: String(req.params.learnerId || ""),
    });
    return res.json({
      success: true,
      capabilities: TEACHER_COLLECTIONS_CAPABILITIES,
    });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.post("/assignments", async (req, res) => {
  try {
    const teacher = await assertActiveTeacher(req, res);
    if (!teacher) return;
    const result = await svc().assignLearnersToSessions({
      schoolId: teacher.schoolId,
      learnerIds: Array.isArray(req.body?.learnerIds) ? req.body.learnerIds.map(String) : [],
      sessionIds: Array.isArray(req.body?.sessionIds) ? req.body.sessionIds.map(String) : [],
    });
    return res.json({
      success: true,
      ...result,
      capabilities: TEACHER_COLLECTIONS_CAPABILITIES,
    });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.get("/registers", async (req, res) => {
  try {
    const teacher = await assertActiveTeacher(req, res);
    if (!teacher) return;
    const schoolLocalDate = resolveDate(req.query.date);
    const result = await svc().getRegistersForDate(teacher.schoolId, schoolLocalDate);
    return res.json({
      success: true,
      date: schoolLocalDate,
      weekday: result.weekday,
      rows: result.rows,
      sessions: result.sessions,
      capabilities: TEACHER_COLLECTIONS_CAPABILITIES,
    });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

router.patch("/registers", async (req, res) => {
  try {
    const teacher = await assertActiveTeacher(req, res);
    if (!teacher) return;

    const sessionId = String(req.body?.sessionId || "").trim();
    const learnerId = String(req.body?.learnerId || "").trim();
    const schoolLocalDate = String(
      req.body?.date || req.body?.schoolLocalDate || ""
    ).trim();
    if (!sessionId || !learnerId || !schoolLocalDate) {
      return res.status(400).json({
        success: false,
        error: "sessionId, learnerId, and date (YYYY-MM-DD) are required",
      });
    }

    const attendanceRaw =
      req.body?.attendance !== undefined ? String(req.body.attendance).trim() : undefined;
    const progressRaw =
      req.body?.progress !== undefined ? String(req.body.progress).trim() : undefined;

    if (attendanceRaw !== undefined && !ATTENDANCE.has(attendanceRaw)) {
      return res.status(400).json({ success: false, error: "Invalid attendance value" });
    }
    if (progressRaw !== undefined && !PROGRESS.has(progressRaw)) {
      return res.status(400).json({ success: false, error: "Invalid progress value" });
    }
    if (attendanceRaw === undefined && progressRaw === undefined && req.body?.note === undefined) {
      return res.status(400).json({
        success: false,
        error: "Provide attendance, progress, and/or note",
      });
    }

    const row = await svc().patchRegisterRow({
      schoolId: teacher.schoolId,
      sessionId,
      learnerId,
      schoolLocalDate,
      attendance: attendanceRaw as HsCgAttendance | undefined,
      progress: progressRaw as HsCgProgress | undefined,
      note: req.body?.note !== undefined ? String(req.body.note ?? "") || null : undefined,
    });

    return res.json({
      success: true,
      row,
      capabilities: TEACHER_COLLECTIONS_CAPABILITIES,
      warning:
        "Register status is persisted, but there is no actor/audit trail for who changed it yet.",
    });
  } catch (e) {
    return sendDomainError(res, e);
  }
});

export default router;
