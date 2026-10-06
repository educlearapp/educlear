import { Router } from "express";
import { prisma } from "../prisma";
import {
  repairAllParentTeacherThreads,
  syncParentThreadsForClassroom,
} from "../services/parentPortalService";
import { normalizeStaffEmail } from "../utils/staffJwt";
import {
  listTeachersForClassroom,
  resolveUserIdForTeacherEmail,
  syncLegacyPrimaryTeacherAssignment,
} from "../utils/classroomTeachers";
import type { ClassroomTeacherRole, Prisma } from "@prisma/client";
import { activeLearnerWhere } from "../utils/learnerEnrollment";
import {
  activeClassMemberWhere,
  assignLearnersToClassrooms,
  classroomMembershipKey,
  cleanClassroomLabel,
  createClassroomResolver,
} from "../utils/classroomMembership";

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
  const existing = await prisma.classroom.findMany({
    where: { schoolId },
    select: { id: true, name: true, createdAt: true },
  });
  const learners = await prisma.learner.findMany({
    where: activeClassMemberWhere(schoolId),
    select: { className: true },
  });
  const names = assignLearnersToClassrooms(existing, learners).unregistered.map((g) => g.displayName);
  const existingSet = new Set(existing.map((c) => classroomMembershipKey(c.name)));
  const created: string[] = [];

  for (const name of names) {
    if (existingSet.has(classroomMembershipKey(name))) continue;
    const classroom = await prisma.classroom.create({
      data: {
        schoolId,
        name,
        teacherName: "",
        teacherEmail: "",
      },
    });
    existingSet.add(classroomMembershipKey(name));
    created.push(name);
    await syncParentThreadsForClassroom(schoolId, classroom.id);
  }

  return { created: created.length, names: created };
}

const router = Router();

const LEARNER_ROSTER_ORDER: Prisma.LearnerOrderByWithRelationInput[] = [
  { grade: "asc" },
  { lastName: "asc" },
];

/**
 * ACTIVE learner ids on a classroom roster (registered id or unregistered placeholder id),
 * using the shared membership rule. Roster rows and counts must both come from here.
 */
export async function classroomRosterLearnerIds(
  schoolId: string,
  classroomId: string
): Promise<{ classroomName: string; registered: boolean; learnerIds: string[] } | null> {
  const classrooms = await prisma.classroom.findMany({
    where: { schoolId },
    select: { id: true, name: true, createdAt: true },
  });
  const learners = await prisma.learner.findMany({
    where: activeClassMemberWhere(schoolId),
    select: { id: true, className: true },
  });
  const { byClassroomId, unregistered } = assignLearnersToClassrooms(classrooms, learners);

  let classroom = classrooms.find((c) => c.id === classroomId);
  if (!classroom && isUnregisteredClassroomId(classroomId)) {
    const className = classNameFromUnregisteredId(classroomId);
    const key = classroomMembershipKey(className);
    classroom = createClassroomResolver(classrooms).classroomFor(className) ?? undefined;
    if (!classroom) {
      const group = unregistered.find((g) => g.key === key);
      return {
        classroomName: className,
        registered: false,
        learnerIds: group ? group.learners.map((l) => l.id) : [],
      };
    }
  }
  if (!classroom) return null;
  return {
    classroomName: classroom.name,
    registered: true,
    learnerIds: (byClassroomId.get(classroom.id) || []).map((l) => l.id),
  };
}

/**
 * Delete a classroom record and clear className for the ACTIVE learners on its roster, atomically.
 * Learners of other classrooms (including case-variant duplicates) and HISTORICAL learners keep
 * their className.
 */
export async function deleteClassroomAndUnassignLearners(
  schoolId: string,
  classroomId: string
): Promise<{ classroomName: string; unassigned: number; unassignedLearnerIds: string[] } | null> {
  return prisma.$transaction(async (tx) => {
    const classrooms = await tx.classroom.findMany({
      where: { schoolId },
      select: { id: true, name: true, createdAt: true },
    });
    const classroom = classrooms.find((c) => c.id === classroomId);
    if (!classroom) return null;
    const learners = await tx.learner.findMany({
      where: activeClassMemberWhere(schoolId),
      select: { id: true, className: true },
    });
    const learnerIds = (
      assignLearnersToClassrooms(classrooms, learners).byClassroomId.get(classroom.id) || []
    ).map((l) => l.id);
    if (learnerIds.length) {
      await tx.learner.updateMany({
        where: { schoolId, id: { in: learnerIds } },
        data: { className: null },
      });
    }
    await tx.classroom.deleteMany({ where: { id: classroom.id, schoolId } });
    return {
      classroomName: classroom.name,
      unassigned: learnerIds.length,
      unassignedLearnerIds: learnerIds,
    };
  });
}

async function classroomWithLearners(schoolId: string, classroomId: string) {
  const classroom = await prisma.classroom.findFirst({
    where: { id: classroomId, schoolId },
  });
  if (!classroom) return null;

  const roster = await classroomRosterLearnerIds(schoolId, classroom.id);
  const learners = await prisma.learner.findMany({
    where: { schoolId, id: { in: roster?.learnerIds ?? [] } },
    orderBy: LEARNER_ROSTER_ORDER,
  });

  return formatClassroomRow(classroom, { learners, childrenCount: learners.length, registered: true });
}

async function unregisteredClassroomWithLearners(schoolId: string, id: string) {
  const roster = await classroomRosterLearnerIds(schoolId, id);
  const className = roster?.classroomName ?? classNameFromUnregisteredId(id);
  const learners = await prisma.learner.findMany({
    where: { schoolId, id: { in: roster?.learnerIds ?? [] } },
    orderBy: LEARNER_ROSTER_ORDER,
  });
  return { className, learners };
}

router.get("/", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ error: "schoolId required" });

    const rows = await prisma.classroom.findMany({
      where: { schoolId },
      orderBy: { name: "asc" },
    });

    const memberRows = await prisma.learner.findMany({
      where: activeClassMemberWhere(schoolId),
      select: {
        id: true,
        firstName: true,
        lastName: true,
        birthDate: true,
        grade: true,
        admissionNo: true,
        className: true,
      },
      orderBy: LEARNER_ROSTER_ORDER,
    });
    const { byClassroomId, unregistered } = assignLearnersToClassrooms(rows, memberRows);

    const classrooms = rows.map((c) => {
      const learners = byClassroomId.get(c.id) || [];
      return formatClassroomRow(c, { learners, childrenCount: learners.length, registered: true });
    });

    for (const group of unregistered) {
      const className = group.displayName;
      const learners = group.learners;
      const count = learners.length;
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
        attendanceSessionDisplay: "PERIODS",
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
      const { className, learners } = await unregisteredClassroomWithLearners(schoolId, id);
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
    const name = cleanClassroomLabel(req.body?.name);
    const teacher = normalizeTeacherName(req.body?.teacher || req.body?.teacherName);
    const teacherEmail = normalizeTeacherEmail(req.body?.teacherEmail);
    if (!schoolId || !name) {
      return res.status(400).json({ error: "schoolId and name required" });
    }

    const nameKey = classroomMembershipKey(name);
    const existingRooms = await prisma.classroom.findMany({
      where: { schoolId },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });
    const sameKey =
      existingRooms.find((c) => c.name === name) ||
      existingRooms.find((c) => classroomMembershipKey(c.name) === nameKey);

    const classroom = sameKey
      ? await prisma.classroom.update({
          where: { id: sameKey.id },
          data: {
            teacherName: teacher,
            teacherEmail: req.body?.teacherEmail != null ? teacherEmail : undefined,
            notes: req.body?.notes ?? undefined,
            minAgeMonths: req.body?.minAgeMonths ?? undefined,
            maxAgeMonths: req.body?.maxAgeMonths ?? undefined,
          },
        })
      : await prisma.classroom.create({
          data: {
            schoolId,
            name,
            teacherName: teacher,
            teacherEmail,
            notes: req.body?.notes || null,
            minAgeMonths: req.body?.minAgeMonths ?? null,
            maxAgeMonths: req.body?.maxAgeMonths ?? null,
          },
        });

    await syncParentThreadsForClassroom(schoolId, classroom.id);
    await syncLegacyPrimaryTeacherAssignment(schoolId, classroom.id, teacher, teacherEmail);

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

    const name = req.body?.name != null ? cleanClassroomLabel(req.body.name) : existing.name;
    if (!name) return res.status(400).json({ error: "Classroom name required" });
    const otherClassrooms = await prisma.classroom.findMany({
      where: { schoolId, id: { not: id } },
      select: { id: true, name: true, createdAt: true },
    });
    if (
      name !== existing.name &&
      otherClassrooms.some((c) => classroomMembershipKey(c.name) === classroomMembershipKey(name))
    ) {
      return res.status(409).json({ error: `A classroom named "${name}" already exists.` });
    }
    const teacherName =
      req.body?.teacher != null || req.body?.teacherName != null
        ? normalizeTeacherName(req.body?.teacher ?? req.body?.teacherName)
        : existing.teacherName;
    const teacherEmail =
      req.body?.teacherEmail != null
        ? normalizeTeacherEmail(req.body.teacherEmail)
        : existing.teacherEmail;
    const modeRaw = String(req.body?.attendanceSessionDisplay || "").trim().toUpperCase();
    const attendanceSessionDisplay =
      modeRaw === "PERIODS" || modeRaw === "SUBJECTS"
        ? modeRaw
        : existing.attendanceSessionDisplay;

    const classroom = await prisma.classroom.update({
      where: { id },
      data: {
        name,
        teacherName,
        teacherEmail,
        notes: req.body?.notes ?? existing.notes,
        minAgeMonths: req.body?.minAgeMonths ?? existing.minAgeMonths,
        maxAgeMonths: req.body?.maxAgeMonths ?? existing.maxAgeMonths,
        attendanceSessionDisplay,
      },
    });

    if (name !== existing.name) {
      const resolverBeforeRename = createClassroomResolver([...otherClassrooms, existing]);
      const members = await prisma.learner.findMany({
        where: { schoolId, className: { not: null } },
        select: { id: true, className: true },
      });
      const ids = members
        .filter((l) => resolverBeforeRename.classroomFor(l.className)?.id === existing.id)
        .map((l) => l.id);
      if (ids.length) {
        await prisma.learner.updateMany({
          where: { schoolId, id: { in: ids } },
          data: { className: name },
        });
      }
    }

    await syncParentThreadsForClassroom(schoolId, classroom.id);
    await syncLegacyPrimaryTeacherAssignment(schoolId, classroom.id, teacherName, teacherEmail);

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
    if (!schoolId) return res.status(400).json({ error: "schoolId required" });
    const result = await deleteClassroomAndUnassignLearners(schoolId, id);
    if (!result) return res.status(404).json({ error: "Classroom not found" });
    return res.json({ success: true, ...result });
  } catch (e) {
    return res.status(500).json({ error: "Failed to delete classroom" });
  }
});

router.post("/:id/add-learners", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const learnerIds: string[] = Array.isArray(req.body?.learnerIds) ? req.body.learnerIds : [];
    const id = String(req.params.id);

    if (!schoolId) return res.status(400).json({ error: "schoolId required" });
    if (!learnerIds.length) return res.status(400).json({ error: "Select at least one learner" });

    let classroomName = "";
    if (isUnregisteredClassroomId(id)) {
      classroomName = cleanClassroomLabel(classNameFromUnregisteredId(id));
    } else {
      const classroom = await prisma.classroom.findFirst({
        where: { id, schoolId },
      });
      if (!classroom) return res.status(404).json({ error: "Classroom not found" });
      classroomName = classroom.name;
    }
    if (!classroomName) return res.status(400).json({ error: "Classroom name missing" });

    const eligible = await prisma.learner.findMany({
      where: { ...activeLearnerWhere(schoolId), id: { in: learnerIds.map(String) } },
      select: { id: true },
    });
    const eligibleIds = eligible.map((l) => l.id);
    const skippedLearnerIds = learnerIds.map(String).filter((lid) => !eligibleIds.includes(lid));
    if (!eligibleIds.length) {
      return res.status(400).json({
        error: "None of the selected learners are active learners in this school.",
        assigned: 0,
        skippedLearnerIds,
      });
    }

    const result = await prisma.learner.updateMany({
      where: { schoolId, id: { in: eligibleIds } },
      data: { className: classroomName },
    });

    return res.json({
      success: true,
      classroomName,
      assigned: result.count,
      assignedLearnerIds: eligibleIds,
      skippedLearnerIds,
    });
  } catch (e) {
    console.error("add learners to classroom", e);
    return res.status(500).json({ error: "Failed to add learners" });
  }
});

router.post("/:id/remove-learners", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const learnerIds: string[] = Array.isArray(req.body?.learnerIds) ? req.body.learnerIds : [];
    if (!schoolId) return res.status(400).json({ error: "schoolId required" });
    if (!learnerIds.length) return res.status(400).json({ error: "Select at least one learner" });

    const roster = await classroomRosterLearnerIds(schoolId, String(req.params.id));
    if (!roster) return res.status(404).json({ error: "Classroom not found" });
    const ids = learnerIds.map(String).filter((lid) => roster.learnerIds.includes(lid));
    if (!ids.length) {
      return res.status(400).json({ error: "The selected learners are not in this classroom.", removed: 0 });
    }

    const result = await prisma.learner.updateMany({
      where: { schoolId, id: { in: ids } },
      data: { className: null },
    });
    return res.json({ success: true, removed: result.count });
  } catch (e) {
    console.error("remove learners from classroom", e);
    return res.status(500).json({ error: "Failed to remove learners" });
  }
});

router.post("/:id/move-learners", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const targetId = String(req.body?.targetClassroomId || "").trim();
    const learnerIds: string[] = Array.isArray(req.body?.learnerIds) ? req.body.learnerIds : [];
    if (!learnerIds.length) return res.status(400).json({ error: "Select at least one learner" });
    const target = await prisma.classroom.findFirst({ where: { id: targetId, schoolId } });
    if (!target) return res.status(404).json({ error: "Target classroom not found" });

    const result = await prisma.learner.updateMany({
      where: { ...activeLearnerWhere(schoolId), id: { in: learnerIds.map(String) } },
      data: { className: target.name },
    });
    if (result.count === 0) {
      return res.status(400).json({ error: "No active learners in this school were moved.", moved: 0 });
    }
    return res.json({ success: true, moved: result.count });
  } catch (e) {
    console.error("move learners between classrooms", e);
    return res.status(500).json({ error: "Failed to move learners" });
  }
});

router.get("/:id/teachers", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const id = String(req.params.id);
    if (isUnregisteredClassroomId(id)) {
      return res.json({ success: true, teachers: [] });
    }
    const classroom = await prisma.classroom.findFirst({ where: { id, schoolId } });
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });
    const teachers = await listTeachersForClassroom(schoolId, id);
    return res.json({ success: true, teachers, primaryTeacherEmail: classroom.teacherEmail });
  } catch (e) {
    return res.status(500).json({ error: "Failed to load teachers" });
  }
});

router.put("/:id/teachers", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || req.query.schoolId || "").trim();
    const id = String(req.params.id);
    if (isUnregisteredClassroomId(id)) {
      return res.status(400).json({ error: "Register this classroom before assigning teachers" });
    }
    const classroom = await prisma.classroom.findFirst({ where: { id, schoolId } });
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    const teachersIn: Array<{
      teacherEmail?: string;
      teacherName?: string;
      role?: string;
      userId?: string;
    }> = Array.isArray(req.body?.teachers) ? req.body.teachers : [];

    const allowedRoles = new Set(["PRIMARY", "CO_TEACHER", "ASSISTANT"]);
    const normalized = teachersIn
      .map((t) => ({
        teacherEmail: normalizeTeacherEmail(t.teacherEmail),
        teacherName: normalizeTeacherName(t.teacherName),
        role: (allowedRoles.has(String(t.role || "").toUpperCase())
          ? String(t.role).toUpperCase()
          : "CO_TEACHER") as ClassroomTeacherRole,
        userId: t.userId ? String(t.userId) : null,
      }))
      .filter((t) => t.teacherEmail);

    const primary = normalized.find((t) => t.role === "PRIMARY") || normalized[0];
    if (primary) {
      await prisma.classroom.update({
        where: { id },
        data: {
          teacherName: primary.teacherName || classroom.teacherName,
          teacherEmail: primary.teacherEmail,
        },
      });
    }

    await prisma.classroomTeacher.deleteMany({ where: { classroomId: id, schoolId } });
    for (const t of normalized) {
      const userId = t.userId || (await resolveUserIdForTeacherEmail(schoolId, t.teacherEmail));
      await prisma.classroomTeacher.create({
        data: {
          schoolId,
          classroomId: id,
          userId,
          teacherEmail: t.teacherEmail,
          teacherName: t.teacherName || "Teacher",
          role: t.role,
        },
      });
    }

    await syncParentThreadsForClassroom(schoolId, id);
    const teachers = await listTeachersForClassroom(schoolId, id);
    return res.json({ success: true, teachers });
  } catch (e) {
    console.error("update classroom teachers", e);
    return res.status(500).json({ error: "Failed to update teachers" });
  }
});

router.get("/:id/export", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const id = String(req.params.id);
    if (isUnregisteredClassroomId(id)) {
      const { className, learners } = await unregisteredClassroomWithLearners(schoolId, id);
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
