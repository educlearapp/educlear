/**
 * Migration parent identity resolution — types.
 * SOURCE-preserving; surname is never a unique identity key.
 */

export type ParentIdentityDecisionKind =
  | "REUSE_EXISTING"
  | "CREATE_NEW"
  | "REVIEW_REQUIRED"
  | "CONFLICT";

export type ParentIdentityMatchReason =
  | "EXACT_IDENTITY_NUMBER"
  | "STABLE_SOURCE_PARENT_ID"
  | "NORMALIZED_EMAIL_MATCH"
  | "NORMALIZED_CELLPHONE_MATCH"
  | "COMPATIBLE_FIRST_NAME"
  | "SURNAME_DIFFERENCE_IGNORED"
  | "EMAIL_CASE_NORMALIZED"
  | "CELLPHONE_FORMAT_NORMALIZED"
  | "DIFFERENT_SOURCE_PARENT_ID_IGNORED"
  | "SINGLE_CONTACT_ONLY"
  | "NAME_ONLY"
  | "CONFLICTING_IDENTITY_NUMBERS"
  | "NO_STRONG_IDENTITY"
  | "AMBIGUOUS_CANDIDATES";

export type ParentIdentityConfidence = "HIGH" | "MEDIUM" | "LOW";

export type SourceSystemKind = "SA-SAMS" | "KID-E-SYS" | "MANUAL" | "UNKNOWN";

/** Incoming parent payload from a source row (values preserved as supplied). */
export type IncomingParentIdentity = {
  firstName: string;
  surname: string;
  /** Raw identity number as supplied (SA ID / passport / foreign). */
  idNumber?: string | null;
  cellNo?: string | null;
  email?: string | null;
  relationship?: string | null;
  sourceSystem: SourceSystemKind;
  /** Stable source Parent/Guardian id when the export provides one (e.g. Kid-e-Sys parent_id). */
  sourceParentId?: string | null;
  /** Optional learner context for review reporting only. */
  learnerLabel?: string | null;
  sourceFile?: string | null;
  sourceRow?: number | null;
};

/** Existing EduClear Parent candidate (school-scoped). */
export type ExistingParentCandidate = {
  id: string;
  firstName: string;
  surname: string;
  idNumber?: string | null;
  cellNo?: string | null;
  email?: string | null;
  familyAccountId?: string | null;
};

export type ParentIdentityCandidateView = {
  parentId: string;
  firstName: string;
  surname: string;
  maskedIdNumber: string;
  maskedCellphone: string;
  maskedEmail: string;
  matchReasons: ParentIdentityMatchReason[];
  conflictReasons: ParentIdentityMatchReason[];
};

export type ParentIdentityDecision = {
  decision: ParentIdentityDecisionKind;
  /** Set when decision is REUSE_EXISTING. */
  parentId: string | null;
  confidence: ParentIdentityConfidence;
  reasons: ParentIdentityMatchReason[];
  conflictReasons: ParentIdentityMatchReason[];
  candidates: ParentIdentityCandidateView[];
  /** Recommended operator action for review queue. */
  recommendedAction: "REUSE" | "CREATE" | "REVIEW" | "CONFLICT";
};

export type MigrationParentReviewItem = {
  incoming: IncomingParentIdentity;
  decision: ParentIdentityDecisionKind;
  recommendedAction: "REUSE" | "CREATE" | "REVIEW" | "CONFLICT";
  confidence: ParentIdentityConfidence;
  reasons: ParentIdentityMatchReason[];
  conflictReasons: ParentIdentityMatchReason[];
  candidates: ParentIdentityCandidateView[];
  /** EduClear Parent created or reused (if any) during this import step. */
  resolvedParentId: string | null;
};

export type MigrationParentIdentityMetrics = {
  reuseByExactId: number;
  reuseBySourceParentId: number;
  reuseByStrongCorroboration: number;
  createNew: number;
  reviewRequired: number;
  conflict: number;
  duplicateParentsPrevented: number;
  falsePositiveAutoMerges: number;
  /** Parent/link writes blocked because row is REVIEW or CONFLICT. */
  unresolvedBlockedWrites: number;
};

/** Operator resolution for a REVIEW_REQUIRED (or authorised CONFLICT) row. */
export type ParentIdentityResolutionKind =
  | "LINK_TO_EXISTING_PARENT"
  | "CREATE_AS_NEW_PARENT"
  | "SKIP_HOLD";

export type ParentIdentityResolution = {
  /** Stable key matching planned item.itemKey */
  itemKey: string;
  kind: ParentIdentityResolutionKind;
  /** Required when kind is LINK_TO_EXISTING_PARENT */
  existingParentId?: string | null;
  /** Optional note for migration audit artifact */
  note?: string | null;
};

export type PlannedParentLink = {
  learnerId: string;
  relation?: string | null;
  isPrimary?: boolean;
  familyAccountId?: string | null;
  /** Extra create fields (work/home/cell storage form). */
  cellNoForStorage?: string | null;
  workNo?: string | null;
  homeNo?: string | null;
};

export type PlannedParentIdentityItem = {
  itemKey: string;
  incoming: IncomingParentIdentity;
  decision: ParentIdentityDecisionKind;
  confidence: ParentIdentityConfidence;
  reasons: ParentIdentityMatchReason[];
  conflictReasons: ParentIdentityMatchReason[];
  candidates: ParentIdentityCandidateView[];
  /** Set when decision is REUSE_EXISTING (real or virtual id from earlier CREATE in plan). */
  reuseParentId: string | null;
  /** True when reuseParentId refers to a virtual CREATE in this same pre-flight plan. */
  reuseIsVirtual: boolean;
  /** Planned learner link (optional — identity-only preflight may omit). */
  link: PlannedParentLink | null;
  /** Source surname/name preserved exactly for lineage reporting. */
  sourceNameExact: string;
  /** Operator resolution, if any. */
  resolution: ParentIdentityResolution | null;
};

export type ParentIdentityPreflightReport = {
  status: "READY_TO_APPLY" | "MIGRATION_REQUIRES_REVIEW";
  message: string;
  counts: {
    readyToReuse: number;
    readyToCreate: number;
    reviewRequired: number;
    conflicts: number;
    expectedLinks: number;
    unresolved: number;
  };
  metrics: MigrationParentIdentityMetrics;
  items: PlannedParentIdentityItem[];
  /** Virtual ids allocated for CREATE_NEW rows during preflight (not DB ids). */
  virtualCreateIds: string[];
};

export type ParentIdentityApplyResult = {
  status: "APPLIED" | "BLOCKED_REQUIRES_REVIEW" | "PARTIAL_SKIP";
  message: string;
  parentsReused: number;
  parentsCreated: number;
  linksUpserted: number;
  skippedReview: number;
  skippedConflict: number;
  skippedHold: number;
  unresolvedCreatedParents: number;
  parentIds: string[];
};
