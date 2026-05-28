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
