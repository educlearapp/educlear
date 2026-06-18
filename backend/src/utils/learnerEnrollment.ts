import type { Prisma } from "@prisma/client";

/** Learners on current class lists — counted in dashboard and classroom totals. */
export const ACTIVE_LEARNER_WHERE: Prisma.LearnerWhereInput = {
  enrollmentStatus: "ACTIVE",
};

export function activeLearnerWhere(schoolId: string): Prisma.LearnerWhereInput {
  return { schoolId, ...ACTIVE_LEARNER_WHERE };
}

export function isHistoricalEnrollmentStatus(
  status: string | null | undefined
): boolean {
  return String(status || "").toUpperCase() === "HISTORICAL";
}

export function normalizeLearnerEnrollmentStatusUpdate(
  status: unknown
): "ACTIVE" | "HISTORICAL" | null {
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized === "ACTIVE" || normalized === "HISTORICAL") return normalized;
  if (["UNENROLLED", "UNENROL", "WITHDRAWN", "INACTIVE"].includes(normalized)) {
    return "HISTORICAL";
  }
  return null;
}

/** Same class label logic as registration stats (className, then grade). */
export function resolveLearnerClassroomLabel(learner: {
  className?: string | null;
  grade?: string | null;
}): string {
  return String(learner.className || learner.grade || "").trim();
}

export function registrationEnrollmentFields(enrollmentStatus: string | null | undefined): {
  enrollmentStatus: string;
  childStatus: string;
  status: string;
  enrolled: boolean;
  isEnrolled: boolean;
} {
  const tier = String(enrollmentStatus || "ACTIVE").toUpperCase();
  const active = tier === "ACTIVE";
  return {
    enrollmentStatus: active ? "ACTIVE" : tier,
    childStatus: active ? "Enrolled" : "Historical",
    status: active ? "Enrolled" : "Historical",
    enrolled: active,
    isEnrolled: active,
  };
}
