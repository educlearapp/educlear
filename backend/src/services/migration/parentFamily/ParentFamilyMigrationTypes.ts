/**
 * Phase 1K — Parent / Guardian & Family Relationship Migration types.
 * Fits existing Parent + ParentLearnerLink + FamilyAccount — no parallel models.
 */

export const PARENT_FAMILY_MIGRATION_VERSION = "1K.1" as const;

export type ParentFamilyMatchState =
  | "MATCHED_EXISTING"
  | "PROPOSED_NEW"
  | "REVIEW_REQUIRED"
  | "IDENTITY_CONFLICT"
  | "INSUFFICIENT_EVIDENCE"
  | "IGNORED"
  | "ACCEPTED";

export type ParentFamilySeverity = "CRITICAL" | "NON_CRITICAL" | "INFO";

export type ParentFamilyConfidence = "HIGH" | "MEDIUM" | "LOW";

export type ParentFamilySourceEvidence = {
  sourceFileId?: string;
  sourceFilename?: string;
  column?: string;
  sourceValue: string;
  rowCount: number;
};

export type ParentPersonProposal = {
  proposalId: string;
  displayName: string;
  firstName: string;
  surname: string;
  idNumber: string | null;
  /** Foreign/passport-style identity when not 13-digit SA ID — stored in same Parent.idNumber column. */
  identityKind: "SA_ID" | "FOREIGN_OR_OTHER" | "NONE";
  cellNo: string | null;
  email: string | null;
  relationship: string | null;
  matchState: ParentFamilyMatchState;
  severity: ParentFamilySeverity;
  confidence: ParentFamilyConfidence;
  reasons: string[];
  warnings: string[];
  evidence: ParentFamilySourceEvidence[];
  /** Operator-safe candidate summaries (no raw UUIDs in UI — id kept for apply only). */
  matchedExistingParentId: string | null;
  candidateSummaries: Array<{
    label: string;
    cellphone: string;
    email: string;
    linkedLearners: string[];
    parentId: string;
  }>;
  learnerKeys: string[];
  isShellOrJunk: boolean;
  operatorMessage: string;
};

export type ParentLearnerLinkProposal = {
  linkId: string;
  parentProposalId: string;
  learnerKey: string;
  learnerLabel: string;
  learnerIdNumber: string | null;
  admissionNo: string | null;
  relation: string | null;
  canonicalLearnerId: string | null;
  matchState: ParentFamilyMatchState;
  severity: ParentFamilySeverity;
  warnings: string[];
};

export type ParentFamilyDiscovery = {
  discoveryId: string;
  version: typeof PARENT_FAMILY_MIGRATION_VERSION;
  generatedAt: string;
  targetSchoolId: string;
  stageId: string | null;
  sourceParentRecords: number;
  automaticallyResolved: number;
  proposedNew: number;
  reviewRequired: number;
  conflicts: number;
  insufficientEvidence: number;
  ignoredShell: number;
  plainLanguage: string[];
};

export type ParentFamilyMigrationPlan = {
  planId: string;
  version: typeof PARENT_FAMILY_MIGRATION_VERSION;
  generatedAt: string;
  targetSchoolId: string;
  stageId: string | null;
  sourceAnalysisId: string | null;
  fingerprint: string;
  discoveryId: string;
  people: ParentPersonProposal[];
  links: ParentLearnerLinkProposal[];
  warnings: string[];
  reviewItems: Array<{
    proposalId: string;
    kind: "person" | "link";
    message: string;
    severity: ParentFamilySeverity;
  }>;
  criticalUnresolvedCount: number;
  nonCriticalUnresolvedCount: number;
  metrics: {
    sourceParentRecords: number;
    automaticallyResolved: number;
    proposedNew: number;
    reviewRequired: number;
    blockingReview: number;
    ignored: number;
    manualMappingActionsRequired: number;
  };
  stale: boolean;
};

export type ParentFamilyCheck = {
  checkId: string;
  version: typeof PARENT_FAMILY_MIGRATION_VERSION;
  generatedAt: string;
  targetSchoolId: string;
  stageId: string | null;
  planId: string;
  parentsExpectedReuse: number;
  parentsExpectedCreate: number;
  parentsMatchedReuse: number;
  parentsMatchedCreate: number;
  linksExpected: number;
  linksMatched: number;
  status: "PARENT_FAMILY_MATCH" | "PARENT_FAMILY_REVIEW_REQUIRED" | "PARENT_FAMILY_STALE";
  parentFamilyMatch: boolean;
  parentFamilyReviewRequired: boolean;
  blockedReasons: string[];
  stale: boolean;
  plainLanguage: string[];
};

export type ParentFamilyApplyResult = {
  applyId: string;
  planId: string;
  targetSchoolId: string;
  appliedAt: string;
  parentsCreated: number;
  parentsReused: number;
  linksUpserted: number;
  skipped: Array<{ reason: string; detail?: string }>;
  idempotentReplay: boolean;
};
