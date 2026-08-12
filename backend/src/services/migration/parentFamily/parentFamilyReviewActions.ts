/**
 * Operator review actions for parent/family proposals (plain-language).
 */

import type { ParentFamilyMigrationPlan } from "./ParentFamilyMigrationTypes";
import {
  getParentFamilyCheckByStage,
  saveParentFamilyCheck,
  saveParentFamilyPlan,
} from "./parentFamilyPlanStore";

export type ParentFamilyReviewAction =
  | "ACCEPT_MATCH"
  | "CHOOSE_EXISTING"
  | "CREATE_NEW"
  | "IGNORE"
  | "KEEP_EXISTING_INFO";

export function applyParentFamilyReviewAction(input: {
  plan: ParentFamilyMigrationPlan;
  proposalId: string;
  action: ParentFamilyReviewAction;
  /** When CHOOSING existing — parent id from candidateSummaries (not shown as UUID in UI copy). */
  chosenParentId?: string;
}): ParentFamilyMigrationPlan {
  const plan = structuredClone(input.plan) as ParentFamilyMigrationPlan;
  const person = plan.people.find((p) => p.proposalId === input.proposalId);
  if (!person) return plan;

  if (input.action === "ACCEPT_MATCH") {
    if (person.matchedExistingParentId) {
      person.matchState = "ACCEPTED";
      person.severity = "INFO";
    } else if (person.matchState === "PROPOSED_NEW") {
      person.matchState = "ACCEPTED";
      person.severity = "INFO";
    } else {
      person.matchState = "ACCEPTED";
    }
  } else if (input.action === "CHOOSE_EXISTING") {
    if (!input.chosenParentId) {
      person.warnings = [...person.warnings, "Choose an existing parent to continue."];
    } else {
      person.matchedExistingParentId = input.chosenParentId;
      person.matchState = "ACCEPTED";
      person.severity = "INFO";
      person.operatorMessage = "Operator chose an existing parent.";
    }
  } else if (input.action === "CREATE_NEW") {
    person.matchedExistingParentId = null;
    person.matchState = "ACCEPTED";
    person.severity = "INFO";
    person.operatorMessage = "Operator chose to create a new parent.";
  } else if (input.action === "IGNORE") {
    person.matchState = "IGNORED";
    person.severity = "NON_CRITICAL";
    person.isShellOrJunk = true;
  } else if (input.action === "KEEP_EXISTING_INFO") {
    // Enrichment already blank-safe; acknowledge conflict without overwrite.
    person.warnings = [
      ...person.warnings,
      "Existing parent information will be kept; blank/conflicting source values will not overwrite.",
    ];
    if (person.matchedExistingParentId) {
      person.matchState = "ACCEPTED";
      person.severity = "INFO";
    }
  }

  // Update links for this person
  for (const link of plan.links) {
    if (link.parentProposalId !== person.proposalId) continue;
    if (person.matchState === "ACCEPTED" || person.matchState === "MATCHED_EXISTING" || person.matchState === "PROPOSED_NEW") {
      link.matchState = person.matchState === "ACCEPTED" ? "ACCEPTED" : person.matchState;
      link.severity = "INFO";
    } else if (person.matchState === "IGNORED") {
      link.matchState = "IGNORED";
      link.severity = "NON_CRITICAL";
    }
  }

  plan.reviewItems = plan.reviewItems.filter((r) => r.proposalId !== input.proposalId);
  plan.criticalUnresolvedCount = plan.people.filter(
    (p) =>
      (p.matchState === "REVIEW_REQUIRED" || p.matchState === "IDENTITY_CONFLICT") &&
      p.severity === "CRITICAL"
  ).length;
  plan.metrics.blockingReview = plan.criticalUnresolvedCount;
  plan.metrics.reviewRequired = plan.people.filter(
    (p) => p.matchState === "REVIEW_REQUIRED" || p.matchState === "IDENTITY_CONFLICT"
  ).length;
  plan.warnings = [
    ...plan.warnings.filter((w) => !w.includes("review updated")),
    "Parent/family review updated — re-run Parents & Families check after apply.",
  ];

  const saved = saveParentFamilyPlan(plan);
  if (saved.stageId) {
    const check = getParentFamilyCheckByStage(saved.stageId);
    if (check) {
      check.stale = true;
      check.status = "PARENT_FAMILY_STALE";
      check.parentFamilyMatch = false;
      check.blockedReasons = [
        ...check.blockedReasons,
        "Parent/family review changed the plan — re-run check.",
      ];
      saveParentFamilyCheck(check);
    }
  }
  return saved;
}
