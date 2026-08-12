/** Client helpers for Phase 1J Academic Structure Review. */

export type AcademicStructureDiscovery = {
  discoveryId: string;
  detectedGrades: number;
  detectedClasses: number;
  detectedSubjects: number;
  learnersWithClearPrimaryClass: number;
  learnersWithAmbiguousClass: number;
  learnersWithNoClass: number;
  plainLanguage: string[];
};

export type AcademicMigrationPlan = {
  planId: string;
  stageId: string | null;
  targetSchoolId: string;
  criticalUnresolvedCount: number;
  nonCriticalUnresolvedCount: number;
  stale: boolean;
  grades: Array<{
    proposalId: string;
    sourceValue: string;
    proposedLabel: string;
    confidence: string;
    matchState: string;
    learnerCount: number;
    warnings: string[];
  }>;
  classes: Array<{
    proposalId: string;
    sourceValue: string;
    proposedClassroomName: string;
    confidence: string;
    matchState: string;
    learnerCount: number;
    warnings: string[];
    isHistoricalSuspect: boolean;
  }>;
  subjects: Array<{
    proposalId: string;
    sourceValue: string;
    proposedName: string;
    confidence: string;
    matchState: string;
    learnerCount: number;
    warnings: string[];
  }>;
  groups: Array<{
    proposalId: string;
    sourceValue: string;
    proposedName: string;
    matchState: string;
    warnings: string[];
    safeToApplyAsGroup: boolean;
  }>;
  learnerPlacements: Array<{
    placementId: string;
    learnerName: string;
    sourceClass: string | null;
    proposedClassroomName: string | null;
    state: string;
    severity: string;
    warnings: string[];
  }>;
  teacherAssignments: Array<{
    assignmentId: string;
    sourceTeacherName: string;
    state: string;
    warnings: string[];
  }>;
  reviewItems: Array<{
    kind: string;
    proposalId: string;
    message: string;
    severity: string;
  }>;
  warnings: string[];
};

export type AcademicStructureCheck = {
  checkId: string;
  status: string;
  academicStructureMatch: boolean;
  academicReviewRequired: boolean;
  stale: boolean;
  plainLanguage: string[];
  gradesExpected: number;
  gradesMatched: number;
  classesExpected: number;
  classesMatched: number;
  placementsExpected: number;
  placementsMatched: number;
  placementsUnresolved: number;
};

export async function postAcademicPlan(input: {
  stageId: string;
  targetSchoolId?: string;
}): Promise<{
  discovery: AcademicStructureDiscovery;
  plan: AcademicMigrationPlan;
  readiness: { academicReady: boolean; academicReviewRequired: boolean };
}> {
  const res = await fetch("/api/migration/academic-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) throw new Error(data?.error || "Academic plan failed");
  return data;
}

export async function postAcademicReview(input: {
  planId: string;
  kind: string;
  proposalId: string;
  action: "ACCEPT_PROPOSED" | "IGNORE" | "MARK_UNRESOLVED";
  chosenValue?: string;
}): Promise<{ plan: AcademicMigrationPlan }> {
  const res = await fetch("/api/migration/academic-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) throw new Error(data?.error || "Academic review failed");
  return { plan: data.plan };
}

export async function postAcademicApply(input: {
  planId: string;
}): Promise<{ result: Record<string, unknown> }> {
  const res = await fetch("/api/migration/academic-apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) throw new Error(data?.error || "Academic apply failed");
  return { result: data.result };
}

export async function postAcademicStructureCheck(input: {
  planId: string;
}): Promise<{ check: AcademicStructureCheck }> {
  const res = await fetch("/api/migration/academic-structure-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) throw new Error(data?.error || "Academic check failed");
  return { check: data.check };
}
