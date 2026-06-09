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
} from "../utils/attendancePeriods";

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

router.get("/", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const className = String(req.query.className || "").trim();
    const dateRaw = String(req.query.date || "").trim();
    const period = normalizeAttendancePeriod(req.query.period);
    if (!schoolId || !className) {
      return res.status(400).json({ success: false, error: "schoolId and className required" });
    }
    if (period === null) {
      return res.status(400).json({
        success: false,
        error: `Invalid period. Allowed: ${ATTENDANCE_PERIODS.join(", ")}`,
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
          });

    const marks: Record<
      string,
      { status: string; arrived?: string; left?: string; reason?: string }
    > = {};
    for (const row of rows) {
      marks[row.learnerId] = {
        status: labelFromStatus(row.status),
        arrived: row.arrivedAt || "",
        left: row.leftAt || "",
        reason: row.reason || "",
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

    const classes = [...classCounts.entries()]
      .map(([name, learnerCount]) => ({ name, learnerCount }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    console.log(
      `[attendanceClasses] schoolId=${schoolId} learnerCount=${activeLearners.length} classCount=${classes.length}`
    );

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
    const period = normalizeAttendancePeriod(req.body?.period);

    if (!schoolId || !className) {
      return res.status(400).json({ success: false, error: "schoolId and className required" });
    }
    if (period === null) {
      return res.status(400).json({
        success: false,
        error: `Invalid period. Allowed: ${ATTENDANCE_PERIODS.join(", ")}`,
      });
    }
    const date = parseDateOnly(dateRaw);
    if (!date) {
      return res.status(400).json({ success: false, error: "Valid date required (YYYY-MM-DD)" });
    }
    if (!marks.length) {
      return res.status(400).json({ success: false, error: "At least one attendance mark required" });
    }

    const classLearners = await learnersForClass(schoolId, className);
    const allowedIds = new Set(classLearners.map((l) => l.id));

    try {
      const result = await bulkUpsertAttendance({
        schoolId,
        className,
        date,
        period,
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
