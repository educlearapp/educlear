/**
 * Operator review resolutions for academic proposals.
 */

import type { AcademicMigrationPlan, AcademicMatchState } from "./AcademicMigrationTypes";
import { saveAcademicPlan, getAcademicCheckByStage, saveAcademicCheck } from "./academicPlanStore";

export type AcademicReviewAction =
  | "ACCEPT_PROPOSED"
  | "IGNORE"
  | "MARK_UNRESOLVED";

export function applyAcademicReviewAction(input: {
  plan: AcademicMigrationPlan;
  kind: "grade" | "class" | "group" | "subject" | "placement" | "teacher";
  proposalId: string;
  action: AcademicReviewAction;
  /** Optional override name when choosing/creating — kept simple for operators. */
  chosenValue?: string;
}): AcademicMigrationPlan {
  const plan = structuredClone(input.plan) as AcademicMigrationPlan;
  const state: AcademicMatchState =
    input.action === "ACCEPT_PROPOSED"
      ? "ACCEPTED"
      : input.action === "IGNORE"
        ? "IGNORED"
        : "UNRESOLVED";

  if (input.kind === "grade") {
    const row = plan.grades.find((g) => g.proposalId === input.proposalId);
    if (row) {
      row.matchState = state;
      if (input.chosenValue) row.proposedLabel = input.chosenValue;
    }
  } else if (input.kind === "class") {
    const row = plan.classes.find((c) => c.proposalId === input.proposalId);
    if (row) {
      row.matchState = state;
      if (input.chosenValue) row.proposedClassroomName = input.chosenValue;
      if (state === "ACCEPTED") row.isHistoricalSuspect = false;
    }
  } else if (input.kind === "group") {
    const row = plan.groups.find((g) => g.proposalId === input.proposalId);
    if (row) {
      row.matchState = state;
      if (state === "ACCEPTED") row.safeToApplyAsGroup = true;
    }
  } else if (input.kind === "subject") {
    const row = plan.subjects.find((s) => s.proposalId === input.proposalId);
    if (row) {
      row.matchState = state;
      if (input.chosenValue) row.proposedName = input.chosenValue;
    }
  } else if (input.kind === "placement") {
    const row = plan.learnerPlacements.find((p) => p.placementId === input.proposalId);
    if (row) {
      if (input.action === "ACCEPT_PROPOSED") {
        row.state = "ACCEPTED";
        if (input.chosenValue) row.proposedClassroomName = input.chosenValue;
      } else if (input.action === "IGNORE") {
        row.state = "UNPLACED";
        row.severity = "NON_CRITICAL";
      } else {
        row.state = "REVIEW_REQUIRED";
      }
    }
  } else if (input.kind === "teacher") {
    const row = plan.teacherAssignments.find((t) => t.assignmentId === input.proposalId);
    if (row) {
      if (input.action === "ACCEPT_PROPOSED" && row.state === "MATCHED_EXISTING") {
        row.applyAllowed = true;
      } else if (input.action === "IGNORE") {
        row.state = "UNRESOLVED";
        row.applyAllowed = false;
      }
    }
  }

  // Rebuild review counts
  plan.reviewItems = plan.reviewItems.filter((r) => r.proposalId !== input.proposalId);
  plan.criticalUnresolvedCount = plan.learnerPlacements.filter(
    (p) => p.severity === "CRITICAL" && p.state !== "MATCHED" && p.state !== "ACCEPTED"
  ).length;
  plan.criticalUnresolvedCount += plan.grades.filter(
    (g) => g.matchState === "REVIEW_REQUIRED" || g.matchState === "UNRESOLVED"
  ).length;
  plan.criticalUnresolvedCount += plan.classes.filter(
    (c) => c.matchState === "REVIEW_REQUIRED" || c.matchState === "UNRESOLVED"
  ).length;
  plan.nonCriticalUnresolvedCount = plan.subjects.filter(
    (s) => s.matchState === "REVIEW_REQUIRED"
  ).length;

  // Review mutations change plan — mark downstream stale via fingerprint bump note
  plan.warnings = [
    ...plan.warnings.filter((w) => !w.startsWith("STALE:")),
    "Academic review updated — re-run Academic Structure Check after apply.",
  ];

  const saved = saveAcademicPlan(plan);
  // Downstream academic check becomes stale after review changes
  if (saved.stageId) {
    const check = getAcademicCheckByStage(saved.stageId);
    if (check) {
      check.stale = true;
      check.status = "ACADEMIC_STALE";
      check.academicStructureMatch = false;
      check.blockedReasons = [
        ...check.blockedReasons,
        "Academic review changed the plan — re-run Academic Structure Check.",
      ];
      saveAcademicCheck(check);
    }
  }
  return saved;
}
