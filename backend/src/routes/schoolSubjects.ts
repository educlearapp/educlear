import { Router } from "express";
import { AttendanceSessionDisplay } from "@prisma/client";
import { prisma } from "../prisma";

const router = Router();

function parseMode(raw: unknown): AttendanceSessionDisplay | null {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "PERIODS" || v === "SUBJECTS") return v;
  return null;
}

/** GET /api/school-subjects?schoolId= */
router.get("/", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "schoolId required" });
    const includeInactive = String(req.query.includeInactive || "") === "true";
    const subjects = await prisma.schoolSubject.findMany({
      where: { schoolId, ...(includeInactive ? {} : { active: true }) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return res.json({ success: true, subjects });
  } catch (e) {
    console.error("list school subjects", e);
    return res.status(500).json({ success: false, error: "Failed to list subjects" });
  }
});

/** POST /api/school-subjects  { schoolId, name, sortOrder? } */
router.post("/", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const name = String(req.body?.name || "").trim();
    const sortOrder = Number(req.body?.sortOrder ?? 0);
    if (!schoolId || !name) {
      return res.status(400).json({ success: false, error: "schoolId and name required" });
    }
    const subject = await prisma.schoolSubject.create({
      data: {
        schoolId,
        name,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
        active: true,
      },
    });
    return res.json({ success: true, subject });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Unique constraint/i.test(msg)) {
      return res.status(409).json({ success: false, error: "Subject name already exists for this school" });
    }
    console.error("create school subject", e);
    return res.status(500).json({ success: false, error: "Failed to create subject" });
  }
});

/** PUT /api/school-subjects/:id */
router.put("/:id", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || req.query.schoolId || "").trim();
    const id = String(req.params.id || "").trim();
    if (!schoolId || !id) {
      return res.status(400).json({ success: false, error: "schoolId and id required" });
    }
    const existing = await prisma.schoolSubject.findFirst({ where: { id, schoolId } });
    if (!existing) return res.status(404).json({ success: false, error: "Subject not found" });
    const subject = await prisma.schoolSubject.update({
      where: { id },
      data: {
        name: req.body?.name != null ? String(req.body.name).trim() : undefined,
        active: req.body?.active != null ? Boolean(req.body.active) : undefined,
        sortOrder: req.body?.sortOrder != null ? Number(req.body.sortOrder) : undefined,
      },
    });
    return res.json({ success: true, subject });
  } catch (e) {
    console.error("update school subject", e);
    return res.status(500).json({ success: false, error: "Failed to update subject" });
  }
});

/** GET /api/school-subjects/classroom-slots?schoolId=&classroomId= */
router.get("/classroom-slots", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const classroomId = String(req.query.classroomId || "").trim();
    if (!schoolId || !classroomId) {
      return res.status(400).json({ success: false, error: "schoolId and classroomId required" });
    }
    const classroom = await prisma.classroom.findFirst({
      where: { id: classroomId, schoolId },
      select: { id: true, name: true, attendanceSessionDisplay: true },
    });
    if (!classroom) return res.status(404).json({ success: false, error: "Classroom not found" });
    const slots = await prisma.classroomSubjectSlot.findMany({
      where: { schoolId, classroomId },
      include: { subject: { select: { id: true, name: true, active: true } } },
      orderBy: [{ dayOfWeek: "asc" }, { sortOrder: "asc" }],
    });
    return res.json({
      success: true,
      classroom,
      slots: slots.map((s) => ({
        id: s.id,
        dayOfWeek: s.dayOfWeek,
        sortOrder: s.sortOrder,
        subjectId: s.subjectId,
        subjectName: s.subject.name,
        periodKey: `SLOT_${s.id}`,
      })),
    });
  } catch (e) {
    console.error("list classroom subject slots", e);
    return res.status(500).json({ success: false, error: "Failed to load timetable slots" });
  }
});

/**
 * PUT /api/school-subjects/classroom-slots
 * Replace slots for a classroom: { schoolId, classroomId, slots: [{ dayOfWeek, sortOrder, subjectId }] }
 */
router.put("/classroom-slots", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const classroomId = String(req.body?.classroomId || "").trim();
    const slotsIn = Array.isArray(req.body?.slots) ? req.body.slots : null;
    if (!schoolId || !classroomId || !slotsIn) {
      return res.status(400).json({
        success: false,
        error: "schoolId, classroomId, and slots[] required",
      });
    }
    const classroom = await prisma.classroom.findFirst({ where: { id: classroomId, schoolId } });
    if (!classroom) return res.status(404).json({ success: false, error: "Classroom not found" });

    const normalized: Array<{ dayOfWeek: number; sortOrder: number; subjectId: string }> = [];
    for (const row of slotsIn) {
      const dayOfWeek = Number(row?.dayOfWeek);
      const sortOrder = Number(row?.sortOrder ?? 0);
      const subjectId = String(row?.subjectId || "").trim();
      if (!subjectId || dayOfWeek < 1 || dayOfWeek > 5) {
        return res.status(400).json({
          success: false,
          error: "Each slot needs dayOfWeek 1–5 (Mon–Fri) and subjectId",
        });
      }
      normalized.push({
        dayOfWeek,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
        subjectId,
      });
    }

    const subjectIds = [...new Set(normalized.map((s) => s.subjectId))];
    if (subjectIds.length) {
      const found = await prisma.schoolSubject.count({
        where: { schoolId, id: { in: subjectIds } },
      });
      if (found !== subjectIds.length) {
        return res.status(400).json({ success: false, error: "One or more subjects are invalid for this school" });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.classroomSubjectSlot.deleteMany({ where: { schoolId, classroomId } });
      if (normalized.length) {
        await tx.classroomSubjectSlot.createMany({
          data: normalized.map((s) => ({
            schoolId,
            classroomId,
            dayOfWeek: s.dayOfWeek,
            sortOrder: s.sortOrder,
            subjectId: s.subjectId,
          })),
        });
      }
    });

    const slots = await prisma.classroomSubjectSlot.findMany({
      where: { schoolId, classroomId },
      include: { subject: { select: { id: true, name: true } } },
      orderBy: [{ dayOfWeek: "asc" }, { sortOrder: "asc" }],
    });
    return res.json({
      success: true,
      slots: slots.map((s) => ({
        id: s.id,
        dayOfWeek: s.dayOfWeek,
        sortOrder: s.sortOrder,
        subjectId: s.subjectId,
        subjectName: s.subject.name,
        periodKey: `SLOT_${s.id}`,
      })),
    });
  } catch (e) {
    console.error("replace classroom subject slots", e);
    return res.status(500).json({ success: false, error: "Failed to save timetable slots" });
  }
});

/** PATCH classroom attendance session display via subjects API convenience */
router.put("/classroom-display-mode", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const classroomId = String(req.body?.classroomId || "").trim();
    const mode = parseMode(req.body?.attendanceSessionDisplay ?? req.body?.mode);
    if (!schoolId || !classroomId || !mode) {
      return res.status(400).json({
        success: false,
        error: "schoolId, classroomId, and attendanceSessionDisplay (PERIODS|SUBJECTS) required",
      });
    }
    const existing = await prisma.classroom.findFirst({ where: { id: classroomId, schoolId } });
    if (!existing) return res.status(404).json({ success: false, error: "Classroom not found" });
    const classroom = await prisma.classroom.update({
      where: { id: classroomId },
      data: { attendanceSessionDisplay: mode },
    });
    return res.json({
      success: true,
      classroom: {
        id: classroom.id,
        name: classroom.name,
        attendanceSessionDisplay: classroom.attendanceSessionDisplay,
      },
    });
  } catch (e) {
    console.error("set classroom display mode", e);
    return res.status(500).json({ success: false, error: "Failed to update classroom display mode" });
  }
});

export default router;
