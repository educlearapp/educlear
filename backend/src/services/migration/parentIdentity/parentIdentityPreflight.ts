/**
 * STAGE 1 — Parent identity pre-flight (ZERO writes).
 *
 * Builds an apply plan. REVIEW_REQUIRED / CONFLICT never allocate Parent rows.
 * CREATE_NEW rows get virtual ids so later source rows in the same batch can REUSE them.
 */

import { resolveParentIdentity } from "./resolveParentIdentity";
import { sourceIdentityKey } from "./normalizeParentIdentity";
import type {
  ExistingParentCandidate,
  IncomingParentIdentity,
  MigrationParentIdentityMetrics,
  ParentIdentityPreflightReport,
  ParentIdentityResolution,
  PlannedParentIdentityItem,
  PlannedParentLink,
} from "./parentIdentityTypes";

export type PreflightIncomingRow = {
  incoming: IncomingParentIdentity;
  link?: PlannedParentLink | null;
  /** Optional storage form of cellphone for CREATE apply. */
  cellNoForStorage?: string | null;
  workNo?: string | null;
  homeNo?: string | null;
};

function emptyMetrics(): MigrationParentIdentityMetrics {
  return {
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
}

function makeItemKey(incoming: IncomingParentIdentity, index: number): string {
  const parts = [
    incoming.sourceSystem || "UNKNOWN",
    incoming.sourceParentId || "",
    incoming.sourceFile || "",
    incoming.sourceRow != null ? String(incoming.sourceRow) : "",
    incoming.firstName || "",
    incoming.surname || "",
    incoming.learnerLabel || "",
    String(index),
  ];
  return parts.join("|");
}

/**
 * Pure pre-flight: resolve every incoming parent against candidates + in-batch virtual creates.
 * Does not write to the database.
 */
export function runParentIdentityPreflight(opts: {
  candidates: ExistingParentCandidate[];
  rows: PreflightIncomingRow[];
  /** Optional prior operator resolutions keyed by itemKey. */
  resolutions?: ParentIdentityResolution[];
}): ParentIdentityPreflightReport {
  const metrics = emptyMetrics();
  const sourceParentIdMap = new Map<string, string>();
  const workingCandidates: ExistingParentCandidate[] = opts.candidates.map((c) => ({ ...c }));
  const virtualCreateIds: string[] = [];
  const resolutionByKey = new Map(
    (opts.resolutions || []).map((r) => [r.itemKey, r] as const)
  );

  const items: PlannedParentIdentityItem[] = [];
  let virtualSeq = 0;

  for (let i = 0; i < opts.rows.length; i++) {
    const row = opts.rows[i]!;
    const incoming = row.incoming;
    const itemKey = makeItemKey(incoming, i);
    const resolution = resolutionByKey.get(itemKey) || null;

    const decision = resolveParentIdentity({
      incoming,
      candidates: workingCandidates,
      sourceParentIdMap,
    });

    let finalDecision = decision.decision;
    let reuseParentId: string | null = decision.parentId;
    let reuseIsVirtual = Boolean(
      reuseParentId && String(reuseParentId).startsWith("virtual:")
    );

    // Apply explicit operator resolution for REVIEW / CONFLICT before planning writes.
    if (
      (finalDecision === "REVIEW_REQUIRED" || finalDecision === "CONFLICT") &&
      resolution
    ) {
      if (resolution.kind === "LINK_TO_EXISTING_PARENT" && resolution.existingParentId) {
        finalDecision = "REUSE_EXISTING";
        reuseParentId = resolution.existingParentId;
        reuseIsVirtual = false;
      } else if (resolution.kind === "CREATE_AS_NEW_PARENT") {
        finalDecision = "CREATE_NEW";
        reuseParentId = null;
        reuseIsVirtual = false;
      } else if (resolution.kind === "SKIP_HOLD") {
        // Remain unresolved for apply-skip; still counts as review/conflict lineage.
      }
    }

    if (finalDecision === "REUSE_EXISTING" && reuseParentId) {
      if (decision.reasons.includes("EXACT_IDENTITY_NUMBER")) metrics.reuseByExactId += 1;
      else if (decision.reasons.includes("STABLE_SOURCE_PARENT_ID"))
        metrics.reuseBySourceParentId += 1;
      else metrics.reuseByStrongCorroboration += 1;
      metrics.duplicateParentsPrevented += 1;
      const srcKey = sourceIdentityKey(incoming.sourceSystem, incoming.sourceParentId);
      if (srcKey) sourceParentIdMap.set(srcKey, reuseParentId);
    } else if (finalDecision === "CREATE_NEW") {
      metrics.createNew += 1;
      virtualSeq += 1;
      const virtualId = `virtual:${virtualSeq}`;
      virtualCreateIds.push(virtualId);
      reuseParentId = virtualId;
      reuseIsVirtual = true;
      workingCandidates.push({
        id: virtualId,
        firstName: incoming.firstName,
        surname: incoming.surname,
        idNumber: incoming.idNumber || null,
        cellNo: incoming.cellNo || null,
        email: incoming.email || null,
        familyAccountId: row.link?.familyAccountId || null,
      });
      const srcKey = sourceIdentityKey(incoming.sourceSystem, incoming.sourceParentId);
      if (srcKey) sourceParentIdMap.set(srcKey, virtualId);
    } else if (finalDecision === "REVIEW_REQUIRED") {
      metrics.reviewRequired += 1;
      metrics.unresolvedBlockedWrites += 1;
      reuseParentId = null;
      reuseIsVirtual = false;
    } else if (finalDecision === "CONFLICT") {
      metrics.conflict += 1;
      metrics.unresolvedBlockedWrites += 1;
      reuseParentId = null;
      reuseIsVirtual = false;
    }

    const link: PlannedParentLink | null = row.link
      ? {
          ...row.link,
          cellNoForStorage: row.cellNoForStorage ?? row.link.cellNoForStorage ?? null,
          workNo: row.workNo ?? row.link.workNo ?? null,
          homeNo: row.homeNo ?? row.link.homeNo ?? null,
        }
      : null;

    items.push({
      itemKey,
      incoming,
      decision: finalDecision,
      confidence: decision.confidence,
      reasons: decision.reasons,
      conflictReasons: decision.conflictReasons,
      candidates: decision.candidates,
      reuseParentId,
      reuseIsVirtual,
      link,
      sourceNameExact: `${incoming.firstName} ${incoming.surname}`.trim(),
      resolution,
    });
  }

  const readyToReuse = items.filter((i) => i.decision === "REUSE_EXISTING").length;
  const readyToCreate = items.filter((i) => i.decision === "CREATE_NEW").length;
  const reviewRequired = items.filter((i) => i.decision === "REVIEW_REQUIRED").length;
  const conflicts = items.filter((i) => i.decision === "CONFLICT").length;
  const unresolved = reviewRequired + conflicts;
  // SKIP_HOLD still leaves decision as REVIEW/CONFLICT unless we track separately —
  // resolved CREATE/LINK already flipped decision above.
  const expectedLinks = items.filter(
    (i) =>
      i.link &&
      (i.decision === "REUSE_EXISTING" || i.decision === "CREATE_NEW")
  ).length;

  const status = unresolved > 0 ? "MIGRATION_REQUIRES_REVIEW" : "READY_TO_APPLY";
  const message =
    status === "MIGRATION_REQUIRES_REVIEW"
      ? `MIGRATION REQUIRES REVIEW — readyToReuse=${readyToReuse} readyToCreate=${readyToCreate} reviewRequired=${reviewRequired} conflicts=${conflicts}`
      : `READY TO APPLY — readyToReuse=${readyToReuse} readyToCreate=${readyToCreate} expectedLinks=${expectedLinks}`;

  return {
    status,
    message,
    counts: {
      readyToReuse,
      readyToCreate,
      reviewRequired,
      conflicts,
      expectedLinks,
      unresolved,
    },
    metrics,
    items,
    virtualCreateIds,
  };
}

/** True when preflight has no unresolved REVIEW/CONFLICT. */
export function isParentIdentityPreflightClear(
  report: ParentIdentityPreflightReport
): boolean {
  return report.status === "READY_TO_APPLY" && report.counts.unresolved === 0;
}
