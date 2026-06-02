import type { ClassroomTeacherRole } from "@prisma/client";
import { prisma } from "../prisma";
import { normalizeStaffEmail } from "./staffJwt";

export type ClassroomTeacherRow = {
  id: string;
  classroomId: string;
  userId: string | null;
  teacherEmail: string;
  teacherName: string;
  role: ClassroomTeacherRole;
};

export async function resolveUserIdForTeacherEmail(
  schoolId: string,
  teacherEmail: string
): Promise<string | null> {
  const norm = normalizeStaffEmail(teacherEmail);
  if (!norm) return null;
  const user = await prisma.user.findFirst({
    where: { schoolId, email: { equals: norm, mode: "insensitive" } },
    select: { id: true },
  });
  return user?.id ?? null;
}

export async function syncLegacyPrimaryTeacherAssignment(
  schoolId: string,
  classroomId: string,
  teacherName: string,
  teacherEmail: string
) {
  const norm = normalizeStaffEmail(teacherEmail);
  if (!norm) return;

  const userId = await resolveUserIdForTeacherEmail(schoolId, norm);
  await prisma.classroomTeacher.upsert({
    where: {
      classroomId_teacherEmail: { classroomId, teacherEmail: norm },
    },
    create: {
      schoolId,
      classroomId,
      userId,
      teacherEmail: norm,
      teacherName: String(teacherName || "").trim() || "Class Teacher",
      role: "PRIMARY",
    },
    update: {
      userId,
      teacherName: String(teacherName || "").trim() || "Class Teacher",
      role: "PRIMARY",
    },
  });
}

export async function listTeachersForClassroom(
  schoolId: string,
  classroomId: string
): Promise<ClassroomTeacherRow[]> {
  const rows = await prisma.classroomTeacher.findMany({
    where: { schoolId, classroomId },
    orderBy: [{ role: "asc" }, { teacherName: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    classroomId: r.classroomId,
    userId: r.userId,
    teacherEmail: normalizeStaffEmail(r.teacherEmail),
    teacherName: r.teacherName,
    role: r.role,
  }));
}

export async function assignedClassroomIdsForTeacher(
  schoolId: string,
  userId: string,
  teacherEmail: string
): Promise<string[]> {
  const norm = normalizeStaffEmail(teacherEmail);
  const or: Array<Record<string, unknown>> = [{ userId }];
  if (norm) {
    or.push({ teacherEmail: { equals: norm, mode: "insensitive" } });
  }

  const junction = await prisma.classroomTeacher.findMany({
    where: { schoolId, OR: or },
    select: { classroomId: true },
  });

  const legacy =
    norm ?
      await prisma.classroom.findMany({
        where: { schoolId, teacherEmail: { equals: norm, mode: "insensitive" } },
        select: { id: true },
      })
    : [];

  const ids = new Set<string>();
  for (const j of junction) ids.add(j.classroomId);
  for (const c of legacy) ids.add(c.id);
  return [...ids];
}

export async function primaryTeacherUserIdForClassroom(
  schoolId: string,
  classroomId: string
): Promise<string | null> {
  const primary = await prisma.classroomTeacher.findFirst({
    where: { schoolId, classroomId, role: "PRIMARY" },
    select: { userId: true, teacherEmail: true },
  });
  if (primary?.userId) return primary.userId;
  if (primary?.teacherEmail) {
    return resolveUserIdForTeacherEmail(schoolId, primary.teacherEmail);
  }
  const classroom = await prisma.classroom.findFirst({
    where: { id: classroomId, schoolId },
    select: { teacherEmail: true },
  });
  if (classroom?.teacherEmail) {
    return resolveUserIdForTeacherEmail(schoolId, classroom.teacherEmail);
  }
  return null;
}
