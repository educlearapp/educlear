import { Router } from "express";
import { prisma } from "../prisma";
import {
  activeLearnerWhere,
  resolveLearnerClassroomLabel,
} from "../utils/learnerEnrollment";
import {
  ATTENDANCE_PERIODS,
  bulkUpsertAttendance,
  labelFromStatus,
  normalizeAttendancePeriod,
  parseDateOnly,
  periodLabel,
} from "../utils/attendancePeriods";
import {
  normalizeAttendanceSessionKey,
  parseSubjectSlotIdFromPeriod,
  subjectSlotPeriodKey,
} from "../utils/attendanceSessionKeys";
import { buildAttendanceReport } from "../services/attendanceReportService";
import { buildWeeklyPeriodSubjectRegister } from "../services/weeklyPeriodSubjectRegisterService";

const router = Router();

async function learnersForClass(schoolId: string, className: string) {
  return prisma.learner.findMany({
    where: {
      ...activeLearnerWhere(schoolId),
      OR: [{ className }, { grade: className }],
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      grade: true,
      className: true,
      admissionNo: true,
    },
  });
}

async function resolveSubjectIdForSession(opts: {
  schoolId: string;
  className: string;
  period: string;
  subjectIdRaw?: unknown;
}): Promise<{ ok: true; subjectId: string | null } | { ok: false; error: string }> {
  const explicit = String(opts.subjectIdRaw || "").trim();
  const slotId = parseSubjectSlotIdFromPeriod(opts.period);
  if (slotId) {
    const slot = await prisma.classroomSubjectSlot.findFirst({
      where: { id: slotId, schoolId: opts.schoolId },
      include: { classroom: { select: { name: true } }, subject: { select: { id: true, active: true } } },
    });
    if (!slot) return { ok: false, error: "Subject timetable slot not found" };
    if (slot.classroom.name !== opts.className) {
      return { ok: false, error: "Subject slot does not belong to this classroom" };
    }
    if (!slot.subject.active) return { ok: false, error: "Subject is inactive" };
    if (explicit && explicit !== slot.subjectId) {
      return { ok: false, error: "subjectId does not match the selected timetable slot" };
    }
    return { ok: true, subjectId: slot.subjectId };
  }
  if (explicit) {
    const subject = await prisma.schoolSubject.findFirst({
      where: { id: explicit, schoolId: opts.schoolId, active: true },
      select: { id: true },
    });
    if (!subject) return { ok: false, error: "Invalid subjectId for this school" };
    return { ok: true, subjectId: subject.id };
  }
  return { ok: true, subjectId: null };
}

router.get("/", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const className = String(req.query.className || "").trim();
    const dateRaw = String(req.query.date || "").trim();
    const period = normalizeAttendanceSessionKey(req.query.period);
    if (!schoolId || !className) {
      return res.status(400).json({ success: false, error: "schoolId and className required" });
    }
    if (period === null) {
      return res.status(400).json({
        success: false,
        error: `Invalid period. Allowed: ${ATTENDANCE_PERIODS.join(", ")} or SLOT_<id>`,
      });
    }
    const date = parseDateOnly(dateRaw);
    if (!date) {
      return res.status(400).json({ success: false, error: "Valid date required (YYYY-MM-DD)" });
    }

    const learners = await learnersForClass(schoolId, className);
    const learnerIds = learners.map((l) => l.id);

    const rows =
      learnerIds.length === 0
        ? []
        : await prisma.learnerAttendance.findMany({
            where: {
              schoolId,
              date,
              period,
              learnerId: { in: learnerIds },
            },
            include: { subject: { select: { id: true, name: true } } },
          });

    const marks: Record<
      string,
      {
        status: string;
        arrived?: string;
        left?: string;
        reason?: string;
        subjectId?: string | null;
        subjectName?: string | null;
      }
    > = {};
    for (const row of rows) {
      marks[row.learnerId] = {
        status: labelFromStatus(row.status),
        arrived: row.arrivedAt || "",
        left: row.leftAt || "",
        reason: row.reason || "",
        subjectId: row.subjectId,
        subjectName: row.subject?.name || null,
      };
    }

    const summary = {
      total: learners.length,
      present: rows.filter((r) => r.status === "PRESENT").length,
      absent: rows.filter((r) => r.status === "ABSENT").length,
      late: rows.filter((r) => r.status === "LATE").length,
      excused: rows.filter((r) => r.status === "EXCUSED").length,
      saved: rows.length,
    };

    return res.json({ success: true, learners, marks, summary, period });
  } catch (e) {
    console.error("load attendance", e);
    return res.status(500).json({ success: false, error: "Failed to load attendance" });
  }
});

router.get("/report", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const startDate = String(req.query.startDate || "").trim();
    const endDate = String(req.query.endDate || "").trim();
    const className = String(req.query.className || "").trim();
    const includeWeekends =
      String(req.query.includeWeekends || "").toLowerCase() === "true" ||
      String(req.query.includeWeekends || "") === "1";
    const groupBy = String(req.query.groupBy || "classrooms").trim();

    if (!schoolId) {
      return res.status(400).json({ success: false, error: "schoolId required" });
    }
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: "startDate and endDate required (YYYY-MM-DD)",
      });
    }

    const period = normalizeAttendancePeriod(req.query.period);
    if (period === null) {
      return res.status(400).json({
        success: false,
        error: `Invalid period. Allowed: ${ATTENDANCE_PERIODS.join(", ")}`,
      });
    }

    const report = await buildAttendanceReport({
      schoolId,
      startDate,
      endDate,
      period,
      className: className || null,
      includeWeekends,
      groupBy: groupBy === "groups" ? "groups" : "classrooms",
      reportKind: (() => {
        const kind = String(req.query.reportKind || "").trim().toLowerCase();
        if (kind === "daily" || kind === "weekly" || kind === "monthly" || kind === "list") {
          return kind;
        }
        return undefined;
      })(),
    });

    return res.json({ success: true, report });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to build attendance report";
    if (/required|Invalid|must be|not found/i.test(message) && !/Failed to/i.test(message)) {
      return res.status(400).json({ success: false, error: message });
    }
    console.error("attendance report", e);
    return res.status(500).json({ success: false, error: "Failed to build attendance report" });
  }
});

router.get("/weekly-period-subject-register", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const weekAnchor = String(req.query.weekAnchor || req.query.week || "").trim();
    const className = String(req.query.className || "").trim();
    const displayModeRaw = String(req.query.displayMode || "Automatic").trim();
    const displayMode =
      displayModeRaw === "Periods" || displayModeRaw === "Subjects" || displayModeRaw === "Automatic"
        ? displayModeRaw
        : "Automatic";

    const report = await buildWeeklyPeriodSubjectRegister({
      schoolId,
      weekAnchor,
      className,
      grade: String(req.query.grade || "").trim() || null,
      teacher: String(req.query.teacher || "").trim() || null,
      displayMode,
      learnerSearch: String(req.query.learnerSearch || "").trim() || null,
      statusFilter: String(req.query.statusFilter || "All").trim() || "All",
    });
    return res.json({ success: true, report });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to build weekly period/subject register";
    if (/required|Invalid|must be|not found|specific classroom/i.test(message)) {
      return res.status(400).json({ success: false, error: message });
    }
    console.error("weekly period/subject register", e);
    return res.status(500).json({
      success: false,
      error: "Failed to build weekly period/subject register",
    });
  }
});

router.get("/capture-sessions", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const className = String(req.query.className || "").trim();
    const dateRaw = String(req.query.date || "").trim();
    if (!schoolId || !className) {
      return res.status(400).json({ success: false, error: "schoolId and className required" });
    }
    const date = parseDateOnly(dateRaw);
    if (!date) {
      return res.status(400).json({ success: false, error: "Valid date required (YYYY-MM-DD)" });
    }

    const classroom = await prisma.classroom.findFirst({
      where: { schoolId, name: className },
      select: { id: true, attendanceSessionDisplay: true },
    });
    const mode = classroom?.attendanceSessionDisplay || "PERIODS";
    if (mode !== "SUBJECTS" || !classroom) {
      return res.json({
        success: true,
        mode: "PERIODS",
        sessions: ATTENDANCE_PERIODS.filter((p) => p !== "DAILY").map((p) => ({
          period: p,
          label: periodLabel(p),
          subjectId: null as string | null,
        })),
        emptyMessage: null as string | null,
      });
    }

    const dayOfWeek = date.getUTCDay();
    const slots = await prisma.classroomSubjectSlot.findMany({
      where: { schoolId, classroomId: classroom.id, dayOfWeek },
      include: { subject: { select: { id: true, name: true, active: true } } },
      orderBy: [{ sortOrder: "asc" }],
    });
    const activeSlots = slots.filter((s) => s.subject.active);
    // Number repeated subjects on the same day (Session 1, Session 2, …) by timetable order.
    const subjectOccurrence = new Map<string, number>();
    const subjectTotals = new Map<string, number>();
    for (const s of activeSlots) {
      subjectTotals.set(s.subjectId, (subjectTotals.get(s.subjectId) || 0) + 1);
    }
    const sessions = activeSlots.map((s) => {
      const occurrence = (subjectOccurrence.get(s.subjectId) || 0) + 1;
      subjectOccurrence.set(s.subjectId, occurrence);
      const total = subjectTotals.get(s.subjectId) || 1;
      const sessionLabel =
        total > 1 ? `${s.subject.name} (Session ${occurrence})` : s.subject.name;
      return {
        period: subjectSlotPeriodKey(s.id),
        label: sessionLabel,
        subjectName: s.subject.name,
        subjectId: s.subjectId,
        sortOrder: s.sortOrder,
        slotId: s.id,
        sessionIndex: occurrence,
        sessionCountForSubject: total,
      };
    });
    return res.json({
      success: true,
      mode: "SUBJECTS",
      sessions,
      emptyMessage:
        sessions.length === 0
          ? "No subject sessions are scheduled for this classroom on the selected date."
          : null,
    });
  } catch (e) {
    console.error("capture sessions", e);
    return res.status(500).json({ success: false, error: "Failed to load capture sessions" });
  }
});

router.get("/classes", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "schoolId required" });

    const activeLearners = await prisma.learner.findMany({
      where: activeLearnerWhere(schoolId),
      select: { className: true, grade: true },
    });

    const classCounts = new Map<string, number>();
    for (const learner of activeLearners) {
      const name = resolveLearnerClassroomLabel(learner);
      if (!name || /no classroom/i.test(name)) continue;
      classCounts.set(name, (classCounts.get(name) || 0) + 1);
    }

    const classroomRows = await prisma.classroom.findMany({
      where: { schoolId },
      select: { name: true, attendanceSessionDisplay: true, teacherName: true },
    });
    const modeByName = new Map(classroomRows.map((c) => [c.name, c]));

    const classes = [...classCounts.entries()]
      .map(([name, learnerCount]) => ({
        name,
        learnerCount,
        attendanceSessionDisplay: modeByName.get(name)?.attendanceSessionDisplay || "PERIODS",
        teacherName: modeByName.get(name)?.teacherName || "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    return res.json({ success: true, classes });
  } catch (e) {
    console.error("list attendance classes", e);
    return res.status(500).json({ success: false, error: "Failed to load classes" });
  }
});

router.post("/bulk", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const className = String(req.body?.className || "").trim();
    const dateRaw = String(req.body?.date || "").trim();
    const createdBy = String(req.body?.createdBy || "").trim();
    const marks = Array.isArray(req.body?.marks) ? req.body.marks : [];
    const period = normalizeAttendanceSessionKey(req.body?.period);

    if (!schoolId || !className) {
      return res.status(400).json({ success: false, error: "schoolId and className required" });
    }
    if (period === null) {
      return res.status(400).json({
        success: false,
        error: `Invalid period. Allowed: ${ATTENDANCE_PERIODS.join(", ")} or SLOT_<id>`,
      });
    }
    const date = parseDateOnly(dateRaw);
    if (!date) {
      return res.status(400).json({ success: false, error: "Valid date required (YYYY-MM-DD)" });
    }
    if (!marks.length) {
      return res.status(400).json({ success: false, error: "At least one attendance mark required" });
    }

    const classroom = await prisma.classroom.findFirst({
      where: { schoolId, name: className },
      select: { attendanceSessionDisplay: true },
    });
    const subjectResolve = await resolveSubjectIdForSession({
      schoolId,
      className,
      period,
      subjectIdRaw: req.body?.subjectId,
    });
    if (!subjectResolve.ok) {
      return res.status(400).json({ success: false, error: subjectResolve.error });
    }
    if (classroom?.attendanceSessionDisplay === "SUBJECTS" && !subjectResolve.subjectId) {
      return res.status(400).json({
        success: false,
        error: "subjectId (or SLOT_ period) is required for SUBJECTS-mode classrooms",
      });
    }

    const classLearners = await learnersForClass(schoolId, className);
    const allowedIds = new Set(classLearners.map((l) => l.id));

    try {
      const result = await bulkUpsertAttendance({
        schoolId,
        className,
        date,
        period,
        subjectId: subjectResolve.subjectId,
        marks,
        createdBy,
        allowedLearnerIds: allowedIds,
        totalLearners: classLearners.length,
      });

      return res.json({
        success: true,
        saved: result.saved,
        summary: result.summary,
        period,
        subjectId: subjectResolve.subjectId,
      });
    } catch (e) {
      if (e instanceof Error && e.message === "NO_VALID_MARKS") {
        return res.status(400).json({ success: false, error: "No valid attendance marks to save" });
      }
      throw e;
    }
  } catch (e) {
    console.error("save attendance bulk", e);
    return res.status(500).json({ success: false, error: "Failed to save attendance" });
  }
});

export default router;
