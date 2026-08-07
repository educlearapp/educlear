/**
 * Migration parent identity safety (two-stage: preflight → apply).
 *
 * OUT OF SCOPE THIS PHASE (separate HIGH-risk paths — do not modify here):
 * - backend/src/routes/learner.ts → saveParentLinks
 * - backend/src/routes/parents.ts → POST create parent
 * Normal application parent creation will be addressed in a later release.
 */

export type {
  ParentIdentityDecisionKind,
  ParentIdentityMatchReason,
  ParentIdentityConfidence,
  SourceSystemKind,
  IncomingParentIdentity,
  ExistingParentCandidate,
  ParentIdentityCandidateView,
  ParentIdentityDecision,
  MigrationParentReviewItem,
  MigrationParentIdentityMetrics,
  ParentIdentityResolutionKind,
  ParentIdentityResolution,
  PlannedParentLink,
  PlannedParentIdentityItem,
  ParentIdentityPreflightReport,
  ParentIdentityApplyResult,
} from "./parentIdentityTypes";

export {
  normalizeParentEmail,
  normalizeParentCellphone,
  normalizeParentIdentityNumber,
  firstNamesCompatible,
  maskIdentityNumber,
  maskCellphone,
  maskEmail,
  sourceIdentityKey,
} from "./normalizeParentIdentity";

export { resolveParentIdentity } from "./resolveParentIdentity";
export type { ResolveParentIdentityInput } from "./resolveParentIdentity";

export { MigrationParentIdentitySession } from "./MigrationParentIdentitySession";
export {
  loadSchoolParentCandidates,
  buildParentReuseUpdateData,
} from "./loadSchoolParentCandidates";

export {
  runParentIdentityPreflight,
  isParentIdentityPreflightClear,
} from "./parentIdentityPreflight";
export type { PreflightIncomingRow } from "./parentIdentityPreflight";

export { applyParentIdentityPlan } from "./parentIdentityApply";
export type { ApplyParentIdentityDeps } from "./parentIdentityApply";

export {
  buildParentIdentityReviewArtifact,
  writeParentIdentityReviewArtifact,
} from "./parentIdentityReviewArtifact";
export type { ParentIdentityReviewArtifact } from "./parentIdentityReviewArtifact";
