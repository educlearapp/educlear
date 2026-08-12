/**
 * Apply AcademicMigrationPlan using existing EduClear models only.
 * Order: classrooms → learner placements (grade/className) → SchoolSubject catalog → safe groups → matched teachers.
 */

import { randomUUID } from "crypto";
import { prisma } from "../../../prisma";
import type { AcademicApplyResult, AcademicMigrationPlan } from "./AcademicMigrationTypes";
import { getAcademicApplyByPlan, saveAcademicApply } from "./academicPlanStore";
import { syncLegacyPrimaryTeacherAssignment } from "../../../utils/classroomTeachers";

function normalizeIdDigits(v: string | null | undefined): string {
  return String(v || "").replace(/\D/g, "");
}

export async function applyAcademicMigrationPlan(input: {
  plan: AcademicMigrationPlan;
  /** Only HIGH auto matches + operator-accepted items should apply. */
  force?: boolean;
}): Promise<AcademicApplyResult> {
  const plan = input.plan;
  const existing = getAcademicApplyByPlan(plan.planId);
  if (existing && !input.force) {
    return { ...existing, idempotentReplay: true };
  }

  if (plan.stale) {
    throw new Error("Academic plan is stale — recompile before apply.");
  }

  const criticalOpen = plan.learnerPlacements.filter(
    (p) => p.severity === "CRITICAL" && p.state !== "MATCHED" && p.state !== "ACCEPTED"
  );
  // Allow apply of safe HIGH pieces even when reviews remain — but track skips.
  const skipped: AcademicApplyResult["skipped"] = [];
  if (criticalOpen.length) {
    skipped.push({
      reason: "CRITICAL_PLACEMENTS_UNRESOLVED",
      detail: `${criticalOpen.length} learner placement(s) still need review — those learners were not placed.`,
    });
  }

  let classroomsCreated = 0;
  let classroomsReused = 0;
  let learnersPlaced = 0;
  let subjectsCreated = 0;
  let subjectsReused = 0;
  let groupsCreated = 0;
  let teacherAssignmentsApplied = 0;

  const schoolId = plan.targetSchoolId;

  // 1) Classes
  for (const c of plan.classes) {
    if (c.matchState === "REVIEW_REQUIRED" && c.confidence !== "HIGH") {
      skipped.push({
        reason: "CLASS_REVIEW_REQUIRED",
        detail: c.sourceValue,
      });
      continue;
    }
    if (c.matchState === "UNRESOLVED" || c.matchState === "IGNORED") continue;
    if (c.isHistoricalSuspect && c.matchState !== "ACCEPTED") {
      skipped.push({ reason: "HISTORICAL_CLASS", detail: c.proposedClassroomName });
      continue;
    }

    const name = c.proposedClassroomName;
    const found = await prisma.classroom.findFirst({
      where: { schoolId, name },
      select: { id: true },
    });
    if (found) {
      classroomsReused += 1;
      continue;
    }
    // Also try case-insensitive reuse
    const all = await prisma.classroom.findMany({
      where: { schoolId },
      select: { id: true, name: true },
    });
    const reuse = all.find((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (reuse) {
      classroomsReused += 1;
      continue;
    }
    await prisma.classroom.create({
      data: {
        schoolId,
        name,
        teacherName: "",
        teacherEmail: "",
      },
    });
    classroomsCreated += 1;
  }

  // 2) Learner placements (canonical learners only)
  for (const p of plan.learnerPlacements) {
    if (p.state !== "MATCHED" && p.state !== "ACCEPTED") {
      continue;
    }
    if (!p.proposedClassroomName) continue;

    let learner = null as {
      id: string;
      idNumber: string | null;
      admissionNo: string | null;
      className: string | null;
      grade: string;
    } | null;

    if (p.learnerIdNumber) {
      const digits = normalizeIdDigits(p.learnerIdNumber);
      const all = await prisma.learner.findMany({
        where: { schoolId },
        select: {
          id: true,
          idNumber: true,
          admissionNo: true,
          className: true,
          grade: true,
        },
      });
      learner = all.find((l) => normalizeIdDigits(l.idNumber) === digits) || null;
    }
    if (!learner && p.admissionNo) {
      learner = await prisma.learner.findFirst({
        where: { schoolId, admissionNo: p.admissionNo },
        select: {
          id: true,
          idNumber: true,
          admissionNo: true,
          className: true,
          grade: true,
        },
      });
    }

    if (!learner) {
      skipped.push({
        reason: "LEARNER_NOT_FOUND",
        detail: p.learnerName,
      });
      continue;
    }

    const nextGrade = p.proposedGrade || learner.grade;
    const nextClass = p.proposedClassroomName;
    if (learner.className === nextClass && learner.grade === nextGrade) {
      learnersPlaced += 1; // already placed — idempotent count as matched
      continue;
    }
    await prisma.learner.update({
      where: { id: learner.id },
      data: {
        className: nextClass,
        grade: nextGrade || learner.grade,
      },
    });
    learnersPlaced += 1;
  }

  // 3) Subjects → SchoolSubject catalog only
  for (const s of plan.subjects) {
    if (s.matchState === "IGNORED") continue;
    if (s.matchState === "REVIEW_REQUIRED" && s.confidence === "LOW") {
      skipped.push({ reason: "SUBJECT_REVIEW", detail: s.sourceValue });
      continue;
    }
    const name = s.proposedName;
    const found = await prisma.schoolSubject.findFirst({
      where: { schoolId, name },
      select: { id: true },
    });
    if (found) {
      subjectsReused += 1;
      continue;
    }
    const all = await prisma.schoolSubject.findMany({
      where: { schoolId },
      select: { id: true, name: true },
    });
    const reuse = all.find((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (reuse) {
      subjectsReused += 1;
      continue;
    }
    await prisma.schoolSubject.create({
      data: { schoolId, name, active: true, sortOrder: 0 },
    });
    subjectsCreated += 1;
  }

  // 4) Groups — only safe confirmed
  for (const g of plan.groups) {
    if (!g.safeToApplyAsGroup || g.matchState === "REVIEW_REQUIRED" || g.matchState === "IGNORED") {
      skipped.push({ reason: "GROUP_NOT_APPLIED", detail: g.sourceValue });
      continue;
    }
    if (g.matchState !== "ACCEPTED" && g.matchState !== "AUTO_MATCH") continue;
    const found = await prisma.group.findFirst({
      where: { schoolId, name: g.proposedName },
      select: { id: true },
    });
    if (found) continue;
    await prisma.group.create({
      data: { schoolId, name: g.proposedName },
    });
    groupsCreated += 1;
  }

  // 5) Teachers — MATCHED_EXISTING only
  for (const t of plan.teacherAssignments) {
    if (!t.applyAllowed || t.state !== "MATCHED_EXISTING") {
      skipped.push({ reason: "TEACHER_NOT_APPLIED", detail: t.sourceTeacherName });
      continue;
    }
    if (!t.proposedClassroomName || !t.sourceTeacherEmail) continue;
    const classroom = await prisma.classroom.findFirst({
      where: { schoolId, name: t.proposedClassroomName },
      select: { id: true },
    });
    if (!classroom) continue;
    await syncLegacyPrimaryTeacherAssignment(
      schoolId,
      classroom.id,
      t.sourceTeacherName,
      t.sourceTeacherEmail
    );
    teacherAssignmentsApplied += 1;
  }

  const result: AcademicApplyResult = {
    applyId: existing?.applyId || `aapply_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    academicPlanId: plan.planId,
    targetSchoolId: schoolId,
    appliedAt: new Date().toISOString(),
    classroomsCreated,
    classroomsReused,
    learnersPlaced,
    subjectsCreated,
    subjectsReused,
    groupsCreated,
    teacherAssignmentsApplied,
    skipped,
    idempotentReplay: false,
  };
  return saveAcademicApply(result);
}
