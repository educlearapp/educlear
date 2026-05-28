import { Router } from "express";
import { prisma } from "../prisma";
import {
  repairAllParentTeacherThreads,
  syncParentThreadsForClassroom,
} from "../services/parentPortalService";
import { normalizeStaffEmail } from "../utils/staffJwt";
import { activeLearnerWhere } from "../utils/learnerEnrollment";

const UNREGISTERED_PREFIX = "__learner_class__:";

function normalizeTeacherEmail(raw: unknown): string {
  return normalizeStaffEmail(String(raw ?? ""));
}

function normalizeTeacherName(raw: unknown): string {
  return String(raw ?? "").trim();
}

function unregisteredClassroomId(className: string) {
  return `${UNREGISTERED_PREFIX}${encodeURIComponent(className)}`;
}

export function isUnregisteredClassroomId(id: string) {
  return String(id || "").startsWith(UNREGISTERED_PREFIX);
}

export function classNameFromUnregisteredId(id: string) {
  return decodeURIComponent(String(id).slice(UNREGISTERED_PREFIX.length));
}

function formatClassroomRow<T extends { name: string; teacherName: string; teacherEmail: string }>(
  classroom: T,
  extras?: {
    learners?: unknown[];
    childrenCount?: number;
    registered?: boolean;
  }
) {
  return {
    ...classroom,
    className: classroom.name,
    teacher: classroom.teacherName,
    teacherName: classroom.teacherName,
    teacherEmail: classroom.teacherEmail,
    learners: extras?.learners,
    children: extras?.learners,
    childrenCount: extras?.childrenCount,
    registered: extras?.registered ?? true,
  };
}

async function distinctLearnerClassNames(schoolId: string): Promise<string[]> {
  const grouped = await prisma.learner.groupBy({
    by: ["className"],
    where: { ...activeLearnerWhere(schoolId), className: { not: "" } },
    _count: { _all: true },
  });
  return grouped
    .map((g) => String(g.className || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

async function learnerCountForClass(schoolId: string, className: string) {
  return prisma.learner.count({
    where: { ...activeLearnerWhere(schoolId), className },
  });
}

/** Create Classroom rows for every distinct learner className missing from the Classroom table. */
export async function rebuildMissingClassroomsFromLearners(schoolId: string) {
  const names = await distinctLearnerClassNames(schoolId);
  const existing = await prisma.classroom.findMany({
    where: { schoolId },
    select: { name: true },
  });
  const existingSet = new Set(existing.map((c) => c.name));
  const created: string[] = [];

  for (const name of names) {
    if (existingSet.has(name)) continue;
    const classroom = await prisma.classroom.create({
      data: {
        schoolId,
        name,
        teacherName: "",
        teacherEmail: "",
      },
    });
    existingSet.add(name);
    created.push(name);
    await syncParentThreadsForClassroom(schoolId, classroom.id);
  }

  return { created: created.length, names: created };
}

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

  return formatClassroomRow(classroom, { learners, childrenCount: learners.length, registered: true });
}

router.get("/", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ error: "schoolId required" });

    const rows = await prisma.classroom.findMany({
      where: { schoolId },
      orderBy: { name: "asc" },
    });

    const registeredByName = new Map<string, (typeof rows)[number]>();
    for (const c of rows) registeredByName.set(c.name, c);

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
        return formatClassroomRow(c, { learners, childrenCount: learners.length, registered: true });
      })
    );

    const learnerClassNames = await distinctLearnerClassNames(schoolId);
    for (const className of learnerClassNames) {
      if (registeredByName.has(className)) continue;
      const count = await learnerCountForClass(schoolId, className);
      const learners = await prisma.learner.findMany({
        where: { schoolId, className },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          birthDate: true,
          grade: true,
          admissionNo: true,
        },
        orderBy: [{ grade: "asc" }, { lastName: "asc" }],
      });
      classrooms.push({
        id: unregisteredClassroomId(className),
        schoolId,
        name: className,
        className,
        teacherName: "",
        teacherEmail: "",
        teacher: "",
        notes: null,
        minAgeMonths: null,
        maxAgeMonths: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        learners,
        children: learners,
        childrenCount: count,
        registered: false,
      });
    }

    classrooms.sort((a, b) => String(a.name).localeCompare(String(b.name)));

    return res.json({ classrooms });
  } catch (e) {
    console.error("list classrooms", e);
    return res.status(500).json({ error: "Failed to load classrooms" });
  }
});

router.post("/repair-missing", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || req.query.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ error: "schoolId required" });

    const rebuild = await rebuildMissingClassroomsFromLearners(schoolId);
    const threads = await repairAllParentTeacherThreads({ schoolId });

    return res.json({
      success: true,
      classrooms: rebuild,
      threads,
    });
  } catch (e) {
    console.error("repair-missing classrooms", e);
    return res.status(500).json({ error: "Failed to repair classrooms" });
  }
});

router.post("/bulk-create-missing", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || req.query.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ error: "schoolId required" });

    const rebuild = await rebuildMissingClassroomsFromLearners(schoolId);
    return res.json({ success: true, ...rebuild });
  } catch (e) {
    console.error("bulk-create-missing classrooms", e);
    return res.status(500).json({ error: "Failed to create missing classrooms" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const id = String(req.params.id);

    if (isUnregisteredClassroomId(id)) {
      const className = classNameFromUnregisteredId(id);
      const learners = await prisma.learner.findMany({
        where: { schoolId, className },
        orderBy: [{ grade: "asc" }, { lastName: "asc" }],
      });
      return res.json({
        classroom: {
          id,
          schoolId,
          name: className,
          className,
          teacher: "",
          teacherName: "",
          teacherEmail: "",
          notes: "",
          minAgeMonths: null,
          maxAgeMonths: null,
          learners,
          children: learners,
          childrenCount: learners.length,
          registered: false,
        },
      });
    }

    const classroom = await classroomWithLearners(schoolId, id);
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
    const teacher = normalizeTeacherName(req.body?.teacher || req.body?.teacherName);
    const teacherEmail = normalizeTeacherEmail(req.body?.teacherEmail);
    if (!schoolId || !name) {
      return res.status(400).json({ error: "schoolId and name required" });
    }

    const classroom = await prisma.classroom.upsert({
      where: { schoolId_name: { schoolId, name } },
      create: {
        schoolId,
        name,
        teacherName: teacher,
        teacherEmail,
        notes: req.body?.notes || null,
        minAgeMonths: req.body?.minAgeMonths ?? null,
        maxAgeMonths: req.body?.maxAgeMonths ?? null,
      },
      update: {
        teacherName: teacher,
        teacherEmail: req.body?.teacherEmail != null ? teacherEmail : undefined,
        notes: req.body?.notes ?? undefined,
        minAgeMonths: req.body?.minAgeMonths ?? undefined,
        maxAgeMonths: req.body?.maxAgeMonths ?? undefined,
      },
    });

    await syncParentThreadsForClassroom(schoolId, classroom.id);

    return res.json({ success: true, classroom: formatClassroomRow(classroom) });
  } catch (e) {
    console.error("create classroom", e);
    return res.status(500).json({ error: "Failed to create classroom" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || req.query.schoolId || "").trim();
    const id = String(req.params.id);

    if (isUnregisteredClassroomId(id)) {
      return res.status(400).json({
        error: "This class exists only on learner records. Create a classroom record first.",
      });
    }

    const existing = await prisma.classroom.findFirst({ where: { id, schoolId } });
    if (!existing) return res.status(404).json({ error: "Classroom not found" });

    const name = req.body?.name != null ? String(req.body.name).trim() : existing.name;
    const teacherName =
      req.body?.teacher != null || req.body?.teacherName != null
        ? normalizeTeacherName(req.body?.teacher ?? req.body?.teacherName)
        : existing.teacherName;
    const teacherEmail =
      req.body?.teacherEmail != null
        ? normalizeTeacherEmail(req.body.teacherEmail)
        : existing.teacherEmail;
    const classroom = await prisma.classroom.update({
      where: { id },
      data: {
        name,
        teacherName,
        teacherEmail,
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

    await syncParentThreadsForClassroom(schoolId, classroom.id);

    return res.json({ success: true, classroom: formatClassroomRow(classroom) });
  } catch (e) {
    return res.status(500).json({ error: "Failed to update classroom" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const id = String(req.params.id);
    if (isUnregisteredClassroomId(id)) {
      return res.status(400).json({ error: "Cannot delete an unregistered classroom placeholder" });
    }
    await prisma.classroom.deleteMany({ where: { id, schoolId } });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: "Failed to delete classroom" });
  }
});

router.post("/:id/add-learners", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const learnerIds: string[] = Array.isArray(req.body?.learnerIds) ? req.body.learnerIds : [];
    const id = String(req.params.id);

    let classroomName = "";
    if (isUnregisteredClassroomId(id)) {
      classroomName = classNameFromUnregisteredId(id);
    } else {
      const classroom = await prisma.classroom.findFirst({
        where: { id, schoolId },
      });
      if (!classroom) return res.status(404).json({ error: "Classroom not found" });
      classroomName = classroom.name;
    }

    await prisma.learner.updateMany({
      where: { schoolId, id: { in: learnerIds } },
      data: { className: classroomName },
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
    const id = String(req.params.id);
    if (isUnregisteredClassroomId(id)) {
      const className = classNameFromUnregisteredId(id);
      const learners = await prisma.learner.findMany({
        where: { schoolId, className },
        orderBy: [{ grade: "asc" }, { lastName: "asc" }],
      });
      return res.json({
        classroom: {
          id,
          name: className,
          className,
          teacher: "",
          teacherName: "",
          teacherEmail: "",
          learners,
          children: learners,
          childrenCount: learners.length,
          registered: false,
        },
      });
    }
    const data = await classroomWithLearners(schoolId, id);
    if (!data) return res.status(404).json({ error: "Not found" });
    return res.json({ classroom: data });
  } catch (e) {
    return res.status(500).json({ error: "Export failed" });
  }
});

export default router;
