/**
 * STAGE 2 — Apply parent identity plan.
 *
 * ATOMIC SAFETY (default): if any REVIEW_REQUIRED or CONFLICT remains unresolved,
 * apply NOTHING (no Parent creates, no ParentLearnerLinks).
 *
 * REVIEW_REQUIRED / CONFLICT never create Parents.
 */

import type { PrismaClient } from "@prisma/client";
import { buildParentReuseUpdateData } from "./loadSchoolParentCandidates";
import { normalizeParentCellphone, normalizeParentIdentityNumber } from "./normalizeParentIdentity";
import { isParentIdentityPreflightClear } from "./parentIdentityPreflight";
import type {
  ParentIdentityApplyResult,
  ParentIdentityPreflightReport,
  PlannedParentIdentityItem,
} from "./parentIdentityTypes";

/** Prisma client or interactive transaction client. */
export type ParentIdentityPrisma = PrismaClient | {
  parent: PrismaClient["parent"];
  parentLearnerLink: PrismaClient["parentLearnerLink"];
};

export type ApplyParentIdentityDeps = {
  prisma: ParentIdentityPrisma;
  schoolId: string;
  /**
   * When true (default), refuse all parent/link writes if any REVIEW/CONFLICT remain.
   * Prefer atomic safety over partial unpredictable migration.
   */
  requireFullyResolved?: boolean;
};

async function applyOneItem(
  deps: ApplyParentIdentityDeps,
  item: PlannedParentIdentityItem,
  virtualToReal: Map<string, string>,
  result: ParentIdentityApplyResult
): Promise<void> {
  const { prisma, schoolId } = deps;

  if (item.decision === "REVIEW_REQUIRED") {
    result.skippedReview += 1;
    return;
  }
  if (item.decision === "CONFLICT") {
    result.skippedConflict += 1;
    return;
  }
  if (item.resolution?.kind === "SKIP_HOLD") {
    result.skippedHold += 1;
    return;
  }

  let parentId: string | null = null;

  if (item.decision === "REUSE_EXISTING") {
    const plannedId = item.reuseParentId;
    if (!plannedId) return;
    parentId = plannedId.startsWith("virtual:")
      ? virtualToReal.get(plannedId) || null
      : plannedId;
    if (!parentId) return;

    const existing = await prisma.parent.findUnique({ where: { id: parentId } });
    if (!existing) return;

    const cellNo =
      normalizeParentCellphone(item.incoming.cellNo) ||
      item.link?.cellNoForStorage ||
      existing.cellNo;
    const cleanedId = normalizeParentIdentityNumber(item.incoming.idNumber);
    const updateData = buildParentReuseUpdateData({
      existing,
      incoming: {
        email: item.incoming.email || null,
        cellNo,
        idNumber: cleanedId,
        workNo: item.link?.workNo || null,
        homeNo: item.link?.homeNo || null,
        relationship: item.incoming.relationship || null,
      },
      normalizedCellNo: cellNo && cellNo !== "0000000000" ? cellNo : null,
    });
    if (
      !existing.familyAccountId &&
      item.link?.familyAccountId
    ) {
      updateData.familyAccountId = item.link.familyAccountId;
    }
    if (Object.keys(updateData).length) {
      await prisma.parent.update({ where: { id: existing.id }, data: updateData });
    }
    result.parentsReused += 1;
  } else if (item.decision === "CREATE_NEW") {
    const cellNo =
      item.link?.cellNoForStorage ||
      normalizeParentCellphone(item.incoming.cellNo) ||
      "0000000000";
    const cleanedId = normalizeParentIdentityNumber(item.incoming.idNumber);
    const created = await prisma.parent.create({
      data: {
        schoolId,
        familyAccountId: item.link?.familyAccountId || null,
        firstName: item.incoming.firstName,
        surname: item.incoming.surname,
        cellNo,
        email: item.incoming.email || null,
        idNumber: cleanedId,
        relationship: item.incoming.relationship || null,
        workNo: item.link?.workNo || null,
        homeNo: item.link?.homeNo || null,
        outstandingAmount: 0,
      },
      select: { id: true },
    });
    parentId = created.id;
    if (item.reuseParentId?.startsWith("virtual:")) {
      virtualToReal.set(item.reuseParentId, created.id);
    }
    result.parentsCreated += 1;
  }

  if (!parentId || !item.link?.learnerId) return;

  await prisma.parentLearnerLink.upsert({
    where: {
      parentId_learnerId: { parentId, learnerId: item.link.learnerId },
    },
    create: {
      schoolId,
      parentId,
      learnerId: item.link.learnerId,
      relation: item.link.relation || item.incoming.relationship || null,
      isPrimary: Boolean(item.link.isPrimary),
    },
    update: {
      relation: item.link.relation || item.incoming.relationship || null,
      ...(item.link.isPrimary != null ? { isPrimary: item.link.isPrimary } : {}),
    },
  });
  result.linksUpserted += 1;
  result.parentIds.push(parentId);
}

/**
 * Apply a preflight plan.
 * Default policy: atomic — blocked entirely while unresolved REVIEW/CONFLICT exist.
 */
export async function applyParentIdentityPlan(
  deps: ApplyParentIdentityDeps,
  report: ParentIdentityPreflightReport
): Promise<ParentIdentityApplyResult> {
  const requireFullyResolved = deps.requireFullyResolved !== false;

  const result: ParentIdentityApplyResult = {
    status: "APPLIED",
    message: "",
    parentsReused: 0,
    parentsCreated: 0,
    linksUpserted: 0,
    skippedReview: 0,
    skippedConflict: 0,
    skippedHold: 0,
    unresolvedCreatedParents: 0,
    parentIds: [],
  };

  if (requireFullyResolved && !isParentIdentityPreflightClear(report)) {
    result.status = "BLOCKED_REQUIRES_REVIEW";
    result.message = report.message;
    result.skippedReview = report.counts.reviewRequired;
    result.skippedConflict = report.counts.conflicts;
    return result;
  }

  const virtualToReal = new Map<string, string>();

  // Apply CREATE_NEW first so virtual ids resolve before dependent REUSE rows.
  const creates = report.items.filter((i) => i.decision === "CREATE_NEW");
  const reuses = report.items.filter((i) => i.decision === "REUSE_EXISTING");
  const holds = report.items.filter(
    (i) => i.decision === "REVIEW_REQUIRED" || i.decision === "CONFLICT"
  );

  for (const item of creates) {
    await applyOneItem(deps, item, virtualToReal, result);
  }
  for (const item of reuses) {
    await applyOneItem(deps, item, virtualToReal, result);
  }
  for (const item of holds) {
    await applyOneItem(deps, item, virtualToReal, result);
  }

  // Hard invariant: unresolved must never create parents
  result.unresolvedCreatedParents = 0;
  result.message =
    result.skippedReview || result.skippedConflict
      ? `Applied resolved rows only (skipped review=${result.skippedReview} conflict=${result.skippedConflict})`
      : `Applied parentsReused=${result.parentsReused} parentsCreated=${result.parentsCreated} links=${result.linksUpserted}`;

  if (!requireFullyResolved && (result.skippedReview || result.skippedConflict)) {
    result.status = "PARTIAL_SKIP";
  }

  return result;
}
