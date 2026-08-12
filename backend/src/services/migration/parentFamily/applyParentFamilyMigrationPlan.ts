/**
 * Apply ParentFamilyMigrationPlan using existing Parent + ParentLearnerLink.
 * Order: reuse/enrich existing parents → create approved new → upsert links.
 * Never overwrites trusted fields with blanks (buildParentReuseUpdateData).
 * Does NOT move family accounts or change finance balances.
 */

import { randomUUID } from "crypto";
import { prisma } from "../../../prisma";
import { buildParentReuseUpdateData } from "../parentIdentity/loadSchoolParentCandidates";
import {
  normalizeParentCellphone,
  normalizeParentIdentityNumber,
} from "../parentIdentity/normalizeParentIdentity";
import type { ParentFamilyApplyResult, ParentFamilyMigrationPlan } from "./ParentFamilyMigrationTypes";
import { getParentFamilyApplyByPlan, saveParentFamilyApply } from "./parentFamilyPlanStore";

export async function applyParentFamilyMigrationPlan(input: {
  plan: ParentFamilyMigrationPlan;
  force?: boolean;
}): Promise<ParentFamilyApplyResult> {
  const plan = input.plan;
  const existing = getParentFamilyApplyByPlan(plan.planId);
  if (existing && !input.force) {
    return { ...existing, idempotentReplay: true };
  }
  if (plan.stale) throw new Error("Parent/family plan is stale — recompile before apply.");

  const skipped: ParentFamilyApplyResult["skipped"] = [];
  let parentsCreated = 0;
  let parentsReused = 0;
  let linksUpserted = 0;
  const schoolId = plan.targetSchoolId;
  const proposalToParentId = new Map<string, string>();

  for (const person of plan.people) {
    if (person.matchState === "IGNORED" || person.matchState === "INSUFFICIENT_EVIDENCE") {
      skipped.push({ reason: "IGNORED_OR_INSUFFICIENT", detail: person.displayName });
      continue;
    }
    if (
      person.matchState === "REVIEW_REQUIRED" ||
      person.matchState === "IDENTITY_CONFLICT"
    ) {
      skipped.push({ reason: "REVIEW_REQUIRED", detail: person.displayName });
      continue;
    }

    const applyable =
      person.matchState === "MATCHED_EXISTING" ||
      person.matchState === "PROPOSED_NEW" ||
      person.matchState === "ACCEPTED";

    if (!applyable) continue;

    if (person.matchedExistingParentId && person.matchState !== "PROPOSED_NEW") {
      const parentId = person.matchedExistingParentId;
      const existingParent = await prisma.parent.findFirst({
        where: { id: parentId, schoolId },
      });
      if (!existingParent) {
        skipped.push({ reason: "EXISTING_PARENT_MISSING", detail: person.displayName });
        continue;
      }
      const cellNo =
        normalizeParentCellphone(person.cellNo) || existingParent.cellNo;
      const updateData = buildParentReuseUpdateData({
        existing: existingParent,
        incoming: {
          email: person.email,
          cellNo,
          idNumber: person.idNumber,
          relationship: person.relationship,
        },
        normalizedCellNo: cellNo && cellNo !== "0000000000" ? cellNo : null,
      });
      if (Object.keys(updateData).length) {
        await prisma.parent.update({ where: { id: parentId }, data: updateData });
      }
      proposalToParentId.set(person.proposalId, parentId);
      parentsReused += 1;
      continue;
    }

    if (person.matchState === "PROPOSED_NEW" || person.matchState === "ACCEPTED") {
      // Idempotent: if same school+id already exists, reuse
      const idNorm = normalizeParentIdentityNumber(person.idNumber);
      if (idNorm) {
        const hit = await prisma.parent.findFirst({
          where: { schoolId, idNumber: idNorm },
          select: { id: true },
        });
        if (hit) {
          proposalToParentId.set(person.proposalId, hit.id);
          parentsReused += 1;
          continue;
        }
      }
      const cellNo = normalizeParentCellphone(person.cellNo) || "0000000000";
      const created = await prisma.parent.create({
        data: {
          schoolId,
          firstName: person.firstName || "Parent",
          surname: person.surname || "",
          cellNo,
          email: person.email,
          idNumber: idNorm,
          relationship: person.relationship,
          outstandingAmount: 0,
        },
        select: { id: true },
      });
      proposalToParentId.set(person.proposalId, created.id);
      parentsCreated += 1;
    }
  }

  for (const link of plan.links) {
    const parentId = proposalToParentId.get(link.parentProposalId);
    if (!parentId) continue;
    if (!link.canonicalLearnerId) {
      skipped.push({
        reason: "LEARNER_NOT_RESOLVED",
        detail: link.learnerLabel,
      });
      continue;
    }
    // Portal safety: only link when parent was MATCHED/PROPOSED/ACCEPTED (already filtered)
    await prisma.parentLearnerLink.upsert({
      where: {
        parentId_learnerId: {
          parentId,
          learnerId: link.canonicalLearnerId,
        },
      },
      create: {
        schoolId,
        parentId,
        learnerId: link.canonicalLearnerId,
        relation: link.relation,
        isPrimary: false,
      },
      update: {
        relation: link.relation,
      },
    });
    linksUpserted += 1;
  }

  const result: ParentFamilyApplyResult = {
    applyId: existing?.applyId || `pfapply_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    planId: plan.planId,
    targetSchoolId: schoolId,
    appliedAt: new Date().toISOString(),
    parentsCreated,
    parentsReused,
    linksUpserted,
    skipped,
    idempotentReplay: false,
  };
  return saveParentFamilyApply(result);
}
