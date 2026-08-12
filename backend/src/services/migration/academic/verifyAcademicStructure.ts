/**
 * Academic Structure Check — source plan vs applied EduClear structure.
 */

import { randomUUID } from "crypto";
import { prisma } from "../../../prisma";
import type {
  AcademicMigrationPlan,
  AcademicStructureCheck,
} from "./AcademicMigrationTypes";
import { ACADEMIC_MIGRATION_VERSION } from "./AcademicMigrationTypes";
import { getAcademicApplyByPlan, saveAcademicCheck } from "./academicPlanStore";

export async function verifyAcademicStructure(input: {
  plan: AcademicMigrationPlan;
}): Promise<AcademicStructureCheck> {
  const plan = input.plan;
  const schoolId = plan.targetSchoolId;
  const blockedReasons: string[] = [];

  if (plan.stale) {
    blockedReasons.push("Academic plan is stale.");
  }

  const classrooms = await prisma.classroom.findMany({
    where: { schoolId },
    select: { name: true },
  });
  const classNames = new Set(classrooms.map((c) => c.name.trim().toLowerCase()));

  const subjects = await prisma.schoolSubject.findMany({
    where: { schoolId },
    select: { name: true },
  });
  const subjectNames = new Set(subjects.map((s) => s.name.trim().toLowerCase()));

  const learners = await prisma.learner.findMany({
    where: { schoolId },
    select: { idNumber: true, admissionNo: true, className: true, grade: true },
  });

  const gradesExpected = plan.grades.filter((g) => g.matchState !== "IGNORED").length;
  const gradeLabels = new Set(
    plan.grades
      .filter((g) => g.matchState === "AUTO_MATCH" || g.matchState === "ACCEPTED" || g.matchState === "MATCHED")
      .map((g) => g.proposedLabel)
  );
  const gradesMatched = [...gradeLabels].filter((g) =>
    learners.some((l) => String(l.grade || "").trim() === g)
  ).length;

  const applyableClasses = plan.classes.filter(
    (c) =>
      (c.matchState === "AUTO_MATCH" || c.matchState === "ACCEPTED" || c.matchState === "MATCHED") &&
      !c.isHistoricalSuspect
  );
  const classesExpected = applyableClasses.length;
  const classesMatched = applyableClasses.filter((c) =>
    classNames.has(c.proposedClassroomName.trim().toLowerCase())
  ).length;

  const matchedPlacements = plan.learnerPlacements.filter(
    (p) => p.state === "MATCHED" || p.state === "ACCEPTED"
  );
  const unresolvedPlacements = plan.learnerPlacements.filter(
    (p) => p.state === "REVIEW_REQUIRED" || p.state === "UNPLACED"
  );
  let placementsMatched = 0;
  for (const p of matchedPlacements) {
    if (!p.proposedClassroomName) continue;
    const digits = String(p.learnerIdNumber || "").replace(/\D/g, "");
    const learner = learners.find(
      (l) =>
        (digits && String(l.idNumber || "").replace(/\D/g, "") === digits) ||
        (p.admissionNo && l.admissionNo === p.admissionNo)
    );
    if (learner && String(learner.className || "") === p.proposedClassroomName) {
      placementsMatched += 1;
    }
  }

  const applyableSubjects = plan.subjects.filter(
    (s) =>
      s.matchState === "AUTO_MATCH" ||
      s.matchState === "ACCEPTED" ||
      (s.matchState === "REVIEW_REQUIRED" && s.confidence === "HIGH")
  );
  const subjectsExpected = applyableSubjects.length;
  const subjectsMatched = applyableSubjects.filter((s) =>
    subjectNames.has(s.proposedName.trim().toLowerCase())
  ).length;

  const subjectEnrollmentsDetected = plan.subjectEnrollments.length;
  const subjectEnrollmentsUnsupportedLearnerLevel = plan.subjectEnrollments.filter(
    (e) => e.persistMode === "UNSUPPORTED_LEARNER_ENROLLMENT"
  ).length;
  const catalogNames = new Set(plan.subjects.map((s) => s.proposedName.toLowerCase()));
  const subjectEnrollmentsCatalogApplied = [...catalogNames].filter((n) =>
    subjectNames.has(n)
  ).length;

  const apply = getAcademicApplyByPlan(plan.planId);

  if (plan.criticalUnresolvedCount > 0) {
    blockedReasons.push(
      `${plan.criticalUnresolvedCount} critical academic item(s) still need review.`
    );
  }
  if (classesExpected > 0 && classesMatched < classesExpected) {
    blockedReasons.push(
      `Classes expected ${classesExpected}, matched/applied ${classesMatched}.`
    );
  }
  if (matchedPlacements.length > 0 && placementsMatched < matchedPlacements.length) {
    blockedReasons.push(
      `Learner placements expected ${matchedPlacements.length}, matched ${placementsMatched}.`
    );
  }
  if (!apply && (classesExpected > 0 || matchedPlacements.length > 0)) {
    blockedReasons.push("Academic structure has not been applied yet.");
  }

  const academicReviewRequired =
    plan.criticalUnresolvedCount > 0 || unresolvedPlacements.length > 0;
  const academicStructureMatch =
    !plan.stale &&
    !academicReviewRequired &&
    blockedReasons.length === 0 &&
    classesMatched === classesExpected &&
    placementsMatched === matchedPlacements.length;

  const status: AcademicStructureCheck["status"] = plan.stale
    ? "ACADEMIC_STALE"
    : academicStructureMatch
      ? "ACADEMIC_STRUCTURE_MATCH"
      : "ACADEMIC_REVIEW_REQUIRED";

  const check: AcademicStructureCheck = {
    checkId: `achk_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    version: ACADEMIC_MIGRATION_VERSION,
    generatedAt: new Date().toISOString(),
    targetSchoolId: schoolId,
    stageId: plan.stageId,
    academicPlanId: plan.planId,
    gradesExpected,
    gradesMatched,
    classesExpected,
    classesMatched,
    placementsExpected: matchedPlacements.length,
    placementsMatched,
    placementsUnresolved: unresolvedPlacements.length,
    subjectsExpected,
    subjectsMatched,
    subjectEnrollmentsDetected,
    subjectEnrollmentsCatalogApplied,
    subjectEnrollmentsUnsupportedLearnerLevel,
    academicStructureMatch,
    academicReviewRequired,
    status,
    blockedReasons,
    stale: plan.stale,
    plainLanguage: [
      `Grades expected: ${gradesExpected} · matched: ${gradesMatched}`,
      `Classes expected: ${classesExpected} · matched/applied: ${classesMatched} · difference: ${classesExpected - classesMatched}`,
      `Learner placements expected: ${matchedPlacements.length} · matched: ${placementsMatched} · unresolved: ${unresolvedPlacements.length}`,
      `Subjects expected: ${subjectsExpected} · matched: ${subjectsMatched}`,
      subjectEnrollmentsDetected
        ? `Subject selections detected: ${subjectEnrollmentsDetected} (catalog applied: ${subjectEnrollmentsCatalogApplied}; learner-level enrollments not stored in EduClear: ${subjectEnrollmentsUnsupportedLearnerLevel})`
        : "No learner subject selections detected.",
      academicStructureMatch
        ? "Academic Structure Check passed."
        : academicReviewRequired
          ? "Academic review is still required."
          : "Academic Structure Check needs attention.",
    ],
  };

  return saveAcademicCheck(check);
}
