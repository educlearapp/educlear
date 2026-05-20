import { Router } from "express";
import { prisma } from "../prisma";

const router = Router();

async function classroomWithLearners(schoolId: string, classroomId: string) {
  const classroom = await prisma.classroom.findFirst({
    where: { id: classroomId, schoolId },
  });
  if (!classroom) return null;

  const learners = await prisma.learner.findMany({
    where: { schoolId, className: classroom.name },
    orderBy: [{ grade: "asc" }, { lastName: "asc" }],
  });

  return {
    ...classroom,
    className: classroom.name,
    teacher: classroom.teacherName,
    teacherName: classroom.teacherName,
    learners,
    children: learners,
    childrenCount: learners.length,
  };
}

router.get("/", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ error: "schoolId required" });

    const rows = await prisma.classroom.findMany({
      where: { schoolId },
      orderBy: { name: "asc" },
    });

    const classrooms = await Promise.all(
      rows.map(async (c) => {
        const learners = await prisma.learner.findMany({
          where: { schoolId, className: c.name },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            birthDate: true,
            grade: true,
            admissionNo: true,
          },
        });
        return {
          ...c,
          className: c.name,
          teacher: c.teacherName,
          teacherName: c.teacherName,
          learners,
          children: learners,
          childrenCount: learners.length,
        };
      })
    );

    return res.json({ classrooms });
  } catch (e) {
    console.error("list classrooms", e);
    return res.status(500).json({ error: "Failed to load classrooms" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const classroom = await classroomWithLearners(schoolId, String(req.params.id));
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });
    return res.json({ classroom });
  } catch (e) {
    return res.status(500).json({ error: "Failed to load classroom" });
  }
});

router.post("/", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const name = String(req.body?.name || "").trim();
    const teacher = String(req.body?.teacher || req.body?.teacherName || "").trim();
    if (!schoolId || !name) {
      return res.status(400).json({ error: "schoolId and name required" });
    }

    const classroom = await prisma.classroom.upsert({
      where: { schoolId_name: { schoolId, name } },
      create: {
        schoolId,
        name,
        teacherName: teacher,
        teacherEmail: String(req.body?.teacherEmail || "").trim(),
        notes: req.body?.notes || null,
        minAgeMonths: req.body?.minAgeMonths ?? null,
        maxAgeMonths: req.body?.maxAgeMonths ?? null,
      },
      update: {
        teacherName: teacher || undefined,
        teacherEmail: req.body?.teacherEmail ? String(req.body.teacherEmail) : undefined,
        notes: req.body?.notes ?? undefined,
        minAgeMonths: req.body?.minAgeMonths ?? undefined,
        maxAgeMonths: req.body?.maxAgeMonths ?? undefined,
      },
    });

    return res.json({ success: true, classroom });
  } catch (e) {
    console.error("create classroom", e);
    return res.status(500).json({ error: "Failed to create classroom" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || req.query.schoolId || "").trim();
    const id = String(req.params.id);
    const existing = await prisma.classroom.findFirst({ where: { id, schoolId } });
    if (!existing) return res.status(404).json({ error: "Classroom not found" });

    const name = req.body?.name != null ? String(req.body.name).trim() : existing.name;
    const classroom = await prisma.classroom.update({
      where: { id },
      data: {
        name,
        teacherName: String(req.body?.teacher ?? req.body?.teacherName ?? existing.teacherName),
        teacherEmail: String(req.body?.teacherEmail ?? existing.teacherEmail),
        notes: req.body?.notes ?? existing.notes,
        minAgeMonths: req.body?.minAgeMonths ?? existing.minAgeMonths,
        maxAgeMonths: req.body?.maxAgeMonths ?? existing.maxAgeMonths,
      },
    });

    if (name !== existing.name) {
      await prisma.learner.updateMany({
        where: { schoolId, className: existing.name },
        data: { className: name },
      });
    }

    return res.json({ success: true, classroom });
  } catch (e) {
    return res.status(500).json({ error: "Failed to update classroom" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    await prisma.classroom.deleteMany({ where: { id: String(req.params.id), schoolId } });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: "Failed to delete classroom" });
  }
});

router.post("/:id/add-learners", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const learnerIds: string[] = Array.isArray(req.body?.learnerIds) ? req.body.learnerIds : [];
    const classroom = await prisma.classroom.findFirst({
      where: { id: String(req.params.id), schoolId },
    });
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    await prisma.learner.updateMany({
      where: { schoolId, id: { in: learnerIds } },
      data: { className: classroom.name },
    });

    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: "Failed to add learners" });
  }
});

router.post("/:id/remove-learners", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const learnerIds: string[] = Array.isArray(req.body?.learnerIds) ? req.body.learnerIds : [];
    await prisma.learner.updateMany({
      where: { schoolId, id: { in: learnerIds } },
      data: { className: null },
    });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: "Failed to remove learners" });
  }
});

router.post("/:id/move-learners", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const targetId = String(req.body?.targetClassroomId || "").trim();
    const learnerIds: string[] = Array.isArray(req.body?.learnerIds) ? req.body.learnerIds : [];
    const target = await prisma.classroom.findFirst({ where: { id: targetId, schoolId } });
    if (!target) return res.status(404).json({ error: "Target classroom not found" });

    await prisma.learner.updateMany({
      where: { schoolId, id: { in: learnerIds } },
      data: { className: target.name },
    });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: "Failed to move learners" });
  }
});

router.get("/:id/export", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const data = await classroomWithLearners(schoolId, String(req.params.id));
    if (!data) return res.status(404).json({ error: "Not found" });
    return res.json({ classroom: data });
  } catch (e) {
    return res.status(500).json({ error: "Export failed" });
  }
});

export default router;
