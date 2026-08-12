/**
 * Operator-facing parent identity review types + helpers (Phase 1D).
 * Plain language labels — no Prisma / virtual-id jargon in UI copy.
 */

export type ParentIdentityResolutionKind =
  | "LINK_TO_EXISTING_PARENT"
  | "CREATE_AS_NEW_PARENT"
  | "SKIP_HOLD";

export type ParentIdentityResolution = {
  itemKey: string;
  kind: ParentIdentityResolutionKind;
  existingParentId?: string | null;
  note?: string | null;
};

export type ParentReviewCandidate = {
  parentId: string;
  firstName: string;
  surname: string;
  maskedIdNumber: string;
  maskedCellphone: string;
  maskedEmail: string;
  matchReasons?: string[];
  conflictReasons?: string[];
  linkedLearners?: Array<{ learnerId: string; label: string }>;
};

export type ParentReviewQueueItem = {
  itemKey: string;
  decision: "REVIEW_REQUIRED" | "CONFLICT";
  sourceNameExact: string;
  incoming: {
    firstName: string;
    surname: string;
    idNumber?: string | null;
    cellNo?: string | null;
    email?: string | null;
    relationship?: string | null;
    learnerLabel?: string | null;
    sourceFile?: string | null;
    sourceRow?: number | null;
  };
  reasons?: string[];
  conflictReasons?: string[];
  candidates: ParentReviewCandidate[];
  recommendedResolutions?: ParentIdentityResolutionKind[];
  note?: string;
};

export type ParentIdentityReviewContract = {
  status: "MIGRATION_REQUIRES_REVIEW" | "READY_TO_APPLY";
  message: string;
  counts: {
    readyToReuse: number;
    readyToCreate: number;
    reviewRequired: number;
    conflicts: number;
    expectedLinks: number;
    unresolved: number;
  };
  reviewQueue: ParentReviewQueueItem[];
  conflictQueue: ParentReviewQueueItem[];
  readyToReuse: Array<{ itemKey: string; sourceNameExact: string }>;
  readyToCreate: Array<{ itemKey: string; sourceNameExact: string }>;
  allowedResolutions: ParentIdentityResolutionKind[];
  conflictNote?: string;
};

export type ParentIdentityPreflightCounts = ParentIdentityReviewContract["counts"];

export type BoundParentIdentityResolutions = {
  stageId: string;
  migrationRunId: string;
  targetSchoolId: string;
  resolutions: ParentIdentityResolution[];
  updatedAt: string;
};

export function operatorDecisionLabel(kind: ParentIdentityResolutionKind | string): string {
  switch (kind) {
    case "LINK_TO_EXISTING_PARENT":
      return "Use this existing parent";
    case "CREATE_AS_NEW_PARENT":
      return "Create a new parent record";
    case "SKIP_HOLD":
      return "Leave for later";
    default:
      return "Needs a decision";
  }
}

export function operatorReasonLabel(reason: string): string {
  const map: Record<string, string> = {
    REVIEW_REQUIRED: "We found more than one possible match.",
    CONFLICT: "The details conflict — please choose carefully.",
    AMBIGUOUS_CANDIDATES: "More than one existing parent could match.",
    SINGLE_CONTACT_ONLY: "Only a phone or email matched — that is not enough to merge automatically.",
    NAME_ONLY: "Only the name looked similar — that is not enough to merge automatically.",
    NORMALIZED_EMAIL_MATCH: "Same email address",
    NORMALIZED_CELLPHONE_MATCH: "Same cellphone number",
    EXACT_IDENTITY_NUMBER: "Same SA ID / passport",
    CONFLICTING_IDENTITY_NUMBERS: "Different SA ID / passport numbers",
    NO_STRONG_IDENTITY: "Not enough strong identity details",
    COMPATIBLE_FIRST_NAME: "Similar first name",
    SURNAME_DIFFERENCE_IGNORED: "Surname spelling differs",
  };
  return map[reason] || reason.replace(/_/g, " ").toLowerCase();
}

export function isHighRiskReviewItem(item: ParentReviewQueueItem): boolean {
  if (item.decision === "CONFLICT") return true;
  const reasons = [...(item.reasons || []), ...(item.conflictReasons || [])];
  return reasons.some((r) =>
    [
      "CONFLICTING_IDENTITY_NUMBERS",
      "AMBIGUOUS_CANDIDATES",
      "SINGLE_CONTACT_ONLY",
    ].includes(r)
  );
}

/** Group review items that share the same person fingerprint for sibling context. */
export function groupSiblingLearnerLabels(items: ParentReviewQueueItem[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const key = [
      String(item.incoming.idNumber || "").trim().toUpperCase(),
      String(item.incoming.email || "").trim().toLowerCase(),
      String(item.incoming.cellNo || "").trim(),
      String(item.incoming.firstName || "").trim().toLowerCase(),
      String(item.incoming.surname || "").trim().toLowerCase(),
    ].join("|");
    const label = String(item.incoming.learnerLabel || "").trim();
    if (!label) continue;
    const list = groups.get(key) || [];
    if (!list.includes(label)) list.push(label);
    groups.set(key, list);
  }
  return groups;
}

export function siblingKeyForItem(item: ParentReviewQueueItem): string {
  return [
    String(item.incoming.idNumber || "").trim().toUpperCase(),
    String(item.incoming.email || "").trim().toLowerCase(),
    String(item.incoming.cellNo || "").trim(),
    String(item.incoming.firstName || "").trim().toLowerCase(),
    String(item.incoming.surname || "").trim().toLowerCase(),
  ].join("|");
}
