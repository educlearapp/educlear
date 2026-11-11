/**
 * Teacher Portal HomeSafe Collections — school-scoped read + register patch.
 * Mounted under /api/teacher-app/homesafe/collections.
 * Uses teacherCtx.schoolId only (never client schoolId).
 * Does not expose group/session/membership management.
 */
import { Router } from "express";
import {
  getPrismaHomeSafeCollectionsService,
} from "../services/homesafeCollectionsPrismaService";
import {
  HsCgDomainError,
  type HsCgAttendance,
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
  canManageGroups: false,
  canPatchRegister: true,
  hasRegisterActorAudit: false,
  hasCallAckWorkflow: false,
  hasLearnerPhotos: false,
} as const;

router.get("/bootstrap", async (req, res) => {
  try {
    const { schoolId } = ctx(req);
    if (!schoolId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const schoolLocalDate = resolveDate(req.query.date);
    const snapshot = await svc().getTeacherCollectionsSnapshot(schoolId, schoolLocalDate);
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

router.get("/registers", async (req, res) => {
  try {
    const { schoolId } = ctx(req);
    if (!schoolId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const schoolLocalDate = resolveDate(req.query.date);
    const result = await svc().getRegistersForDate(schoolId, schoolLocalDate);
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
    const { schoolId } = ctx(req);
    if (!schoolId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

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
      schoolId,
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
