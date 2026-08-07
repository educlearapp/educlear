/**
 * In-run migration session for parent identity resolution.
 * Tracks sourceParentId → Parent.id without requiring schema changes.
 * Collects REVIEW/CONFLICT items for the migration report.
 */

import type {
  ExistingParentCandidate,
  IncomingParentIdentity,
  MigrationParentIdentityMetrics,
  MigrationParentReviewItem,
  ParentIdentityDecision,
} from "./parentIdentityTypes";
import { sourceIdentityKey } from "./normalizeParentIdentity";
import { resolveParentIdentity } from "./resolveParentIdentity";

export class MigrationParentIdentitySession {
  readonly sourceParentIdMap = new Map<string, string>();
  readonly reviewItems: MigrationParentReviewItem[] = [];
  readonly metrics: MigrationParentIdentityMetrics = {
    reuseByExactId: 0,
    reuseBySourceParentId: 0,
    reuseByStrongCorroboration: 0,
    createNew: 0,
    reviewRequired: 0,
    conflict: 0,
    duplicateParentsPrevented: 0,
    falsePositiveAutoMerges: 0,
    unresolvedBlockedWrites: 0,
  };

  /**
   * Resolve against current candidates. Does not write to DB.
   * Records REVIEW/CONFLICT for the report.
   */
  resolve(
    incoming: IncomingParentIdentity,
    candidates: ExistingParentCandidate[]
  ): ParentIdentityDecision {
    const decision = resolveParentIdentity({
      incoming,
      candidates,
      sourceParentIdMap: this.sourceParentIdMap,
    });

    if (decision.decision === "REUSE_EXISTING") {
      if (decision.reasons.includes("EXACT_IDENTITY_NUMBER")) this.metrics.reuseByExactId += 1;
      else if (decision.reasons.includes("STABLE_SOURCE_PARENT_ID"))
        this.metrics.reuseBySourceParentId += 1;
      else this.metrics.reuseByStrongCorroboration += 1;
      this.metrics.duplicateParentsPrevented += 1;
      this.rememberSourceMapping(incoming, decision.parentId);
    } else if (decision.decision === "CREATE_NEW") {
      this.metrics.createNew += 1;
    } else if (decision.decision === "REVIEW_REQUIRED") {
      this.metrics.reviewRequired += 1;
      this.metrics.unresolvedBlockedWrites += 1;
      this.reviewItems.push({
        incoming,
        decision: decision.decision,
        recommendedAction: decision.recommendedAction,
        confidence: decision.confidence,
        reasons: decision.reasons,
        conflictReasons: decision.conflictReasons,
        candidates: decision.candidates,
        resolvedParentId: null,
      });
    } else if (decision.decision === "CONFLICT") {
      this.metrics.conflict += 1;
      this.metrics.unresolvedBlockedWrites += 1;
      this.reviewItems.push({
        incoming,
        decision: decision.decision,
        recommendedAction: decision.recommendedAction,
        confidence: decision.confidence,
        reasons: decision.reasons,
        conflictReasons: decision.conflictReasons,
        candidates: decision.candidates,
        resolvedParentId: null,
      });
    }

    return decision;
  }

  /** After create/reuse, bind source parent id for Level 2 within this run. */
  rememberSourceMapping(incoming: IncomingParentIdentity, parentId: string | null | undefined) {
    if (!parentId) return;
    const key = sourceIdentityKey(incoming.sourceSystem, incoming.sourceParentId);
    if (key) this.sourceParentIdMap.set(key, parentId);
  }

  markReviewResolved(incoming: IncomingParentIdentity, parentId: string) {
    const item = [...this.reviewItems]
      .reverse()
      .find(
        (r) =>
          r.resolvedParentId == null &&
          r.incoming.sourceRow === incoming.sourceRow &&
          r.incoming.firstName === incoming.firstName &&
          r.incoming.surname === incoming.surname
      );
    if (item) item.resolvedParentId = parentId;
  }
}
