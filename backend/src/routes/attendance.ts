import { Router } from "express";
import { AttendanceStatus, Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { activeLearnerWhere } from "../utils/learnerEnrollment";

const router = Router();

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  LATE: "Late",
  EXCUSED: "Excused",
};

const STATUS_VALUE: Record<string, AttendanceStatus> = {
  present: "PRESENT",
  absent: "ABSENT",
  late: "LATE",
  excused: "EXCUSED",
};

function parseDateOnly(raw: string): Date | null {
  const value = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function statusFromLabel(raw: unknown): AttendanceStatus | null {
  const key = String(raw || "").trim().toLowerCase();
  return STATUS_VALUE[key] || null;
}

function labelFromStatus(status: AttendanceStatus): string {
  return STATUS_LABEL[status];
}

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
    if (!schoolId || !className) {
      return res.status(400).json({ success: false, error: "schoolId and className required" });
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

    return res.json({ success: true, learners, marks, summary });
  } catch (e) {
    console.error("load attendance", e);
    return res.status(500).json({ success: false, error: "Failed to load attendance" });
  }
});

router.get("/classes", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "schoolId required" });

    const grouped = await prisma.learner.groupBy({
      by: ["className"],
      where: { ...activeLearnerWhere(schoolId), className: { not: "" } },
      _count: { _all: true },
    });

    const classes = grouped
      .map((g) => ({
        name: String(g.className || "").trim(),
        learnerCount: g._count._all,
      }))
      .filter((c) => c.name)
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

    if (!schoolId || !className) {
      return res.status(400).json({ success: false, error: "schoolId and className required" });
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

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    let saved = 0;

    for (const mark of marks) {
      const learnerId = String(mark?.learnerId || "").trim();
      if (!learnerId || !allowedIds.has(learnerId)) continue;
      const status = statusFromLabel(mark?.status);
      if (!status) continue;

      const data = {
        schoolId,
        learnerId,
        className,
        date,
        status,
        arrivedAt: mark?.arrived ? String(mark.arrived).trim() || null : null,
        leftAt: mark?.left ? String(mark.left).trim() || null : null,
        reason: mark?.reason ? String(mark.reason).trim() || null : null,
        createdBy,
      };

      ops.push(
        prisma.learnerAttendance.upsert({
          where: {
            schoolId_learnerId_date: {
              schoolId,
              learnerId,
              date,
            },
          },
          create: data,
          update: {
            className,
            status: data.status,
            arrivedAt: data.arrivedAt,
            leftAt: data.leftAt,
            reason: data.reason,
            createdBy: data.createdBy || undefined,
          },
        })
      );
      saved += 1;
    }

    if (!ops.length) {
      return res.status(400).json({ success: false, error: "No valid attendance marks to save" });
    }

    await prisma.$transaction(ops);

    const rows = await prisma.learnerAttendance.findMany({
      where: {
        schoolId,
        date,
        learnerId: { in: [...allowedIds] },
      },
    });

    return res.json({
      success: true,
      saved,
      summary: {
        total: classLearners.length,
        present: rows.filter((r) => r.status === "PRESENT").length,
        absent: rows.filter((r) => r.status === "ABSENT").length,
        late: rows.filter((r) => r.status === "LATE").length,
        excused: rows.filter((r) => r.status === "EXCUSED").length,
        saved: rows.length,
      },
    });
  } catch (e) {
    console.error("save attendance bulk", e);
    return res.status(500).json({ success: false, error: "Failed to save attendance" });
  }
});

export default router;
