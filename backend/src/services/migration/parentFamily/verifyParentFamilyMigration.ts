/**
 * Independent Parent/Family verification vs plan.
 */

import { randomUUID } from "crypto";
import { prisma } from "../../../prisma";
import { normalizeParentIdentityNumber } from "../parentIdentity/normalizeParentIdentity";
import type { ParentFamilyCheck, ParentFamilyMigrationPlan } from "./ParentFamilyMigrationTypes";
import { PARENT_FAMILY_MIGRATION_VERSION } from "./ParentFamilyMigrationTypes";
import { getParentFamilyApplyByPlan, saveParentFamilyCheck } from "./parentFamilyPlanStore";

export async function verifyParentFamilyMigration(input: {
  plan: ParentFamilyMigrationPlan;
}): Promise<ParentFamilyCheck> {
  const plan = input.plan;
  const schoolId = plan.targetSchoolId;
  const blockedReasons: string[] = [];

  if (plan.stale) blockedReasons.push("Parent/family plan is stale.");

  const expectedReuse = plan.people.filter(
    (p) =>
      p.matchState === "MATCHED_EXISTING" ||
      (p.matchState === "ACCEPTED" && p.matchedExistingParentId)
  );
  const expectedCreate = plan.people.filter(
    (p) =>
      p.matchState === "PROPOSED_NEW" ||
      (p.matchState === "ACCEPTED" && !p.matchedExistingParentId)
  );
  const expectedLinks = plan.links.filter(
    (l) =>
      l.canonicalLearnerId &&
      (l.matchState === "MATCHED_EXISTING" ||
        l.matchState === "PROPOSED_NEW" ||
        l.matchState === "ACCEPTED")
  );

  let parentsMatchedReuse = 0;
  for (const p of expectedReuse) {
    if (!p.matchedExistingParentId) continue;
    const found = await prisma.parent.findFirst({
      where: { id: p.matchedExistingParentId, schoolId },
      select: { id: true },
    });
    if (found) parentsMatchedReuse += 1;
  }

  let parentsMatchedCreate = 0;
  for (const p of expectedCreate) {
    const idNorm = normalizeParentIdentityNumber(p.idNumber);
    let found = null as { id: string } | null;
    if (idNorm) {
      found = await prisma.parent.findFirst({
        where: { schoolId, idNumber: idNorm },
        select: { id: true },
      });
    }
    if (!found && p.cellNo && p.email) {
      const all = await prisma.parent.findMany({
        where: { schoolId },
        select: { id: true, firstName: true, surname: true, cellNo: true, email: true },
      });
      found =
        all.find(
          (x) =>
            x.firstName.trim().toLowerCase() === p.firstName.trim().toLowerCase() &&
            x.surname.trim().toLowerCase() === p.surname.trim().toLowerCase() &&
            String(x.email || "").toLowerCase() === String(p.email || "").toLowerCase()
        ) || null;
    }
    if (found) parentsMatchedCreate += 1;
  }

  let linksMatched = 0;
  for (const link of expectedLinks) {
    const person = plan.people.find((p) => p.proposalId === link.parentProposalId);
    if (!person || !link.canonicalLearnerId) continue;
    let parentId = person.matchedExistingParentId;
    if (!parentId && person.idNumber) {
      const idNorm = normalizeParentIdentityNumber(person.idNumber);
      const hit = idNorm
        ? await prisma.parent.findFirst({
            where: { schoolId, idNumber: idNorm },
            select: { id: true },
          })
        : null;
      parentId = hit?.id || null;
    }
    if (!parentId) continue;
    const edge = await prisma.parentLearnerLink.findUnique({
      where: {
        parentId_learnerId: {
          parentId,
          learnerId: link.canonicalLearnerId,
        },
      },
      select: { id: true },
    });
    if (edge) linksMatched += 1;
  }

  const apply = getParentFamilyApplyByPlan(plan.planId);
  if (plan.criticalUnresolvedCount > 0) {
    blockedReasons.push(
      `${plan.criticalUnresolvedCount} critical parent/family item(s) still need review.`
    );
  }
  if (!apply && (expectedReuse.length > 0 || expectedCreate.length > 0)) {
    blockedReasons.push("Parent/family plan has not been applied yet.");
  }
  if (expectedReuse.length && parentsMatchedReuse < expectedReuse.length) {
    blockedReasons.push(
      `Expected reuse ${expectedReuse.length}, matched ${parentsMatchedReuse}.`
    );
  }
  if (expectedCreate.length && parentsMatchedCreate < expectedCreate.length) {
    blockedReasons.push(
      `Expected new parents ${expectedCreate.length}, matched ${parentsMatchedCreate}.`
    );
  }
  if (expectedLinks.length && linksMatched < expectedLinks.length) {
    blockedReasons.push(`Expected links ${expectedLinks.length}, matched ${linksMatched}.`);
  }

  const parentFamilyReviewRequired = plan.criticalUnresolvedCount > 0;
  const parentFamilyMatch =
    !plan.stale &&
    !parentFamilyReviewRequired &&
    blockedReasons.length === 0 &&
    parentsMatchedReuse === expectedReuse.length &&
    parentsMatchedCreate === expectedCreate.length &&
    linksMatched === expectedLinks.length;

  const status: ParentFamilyCheck["status"] = plan.stale
    ? "PARENT_FAMILY_STALE"
    : parentFamilyMatch
      ? "PARENT_FAMILY_MATCH"
      : "PARENT_FAMILY_REVIEW_REQUIRED";

  const check: ParentFamilyCheck = {
    checkId: `pfchk_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    version: PARENT_FAMILY_MIGRATION_VERSION,
    generatedAt: new Date().toISOString(),
    targetSchoolId: schoolId,
    stageId: plan.stageId,
    planId: plan.planId,
    parentsExpectedReuse: expectedReuse.length,
    parentsExpectedCreate: expectedCreate.length,
    parentsMatchedReuse,
    parentsMatchedCreate,
    linksExpected: expectedLinks.length,
    linksMatched,
    status,
    parentFamilyMatch,
    parentFamilyReviewRequired,
    blockedReasons,
    stale: plan.stale,
    plainLanguage: [
      `Parents matched to existing: ${parentsMatchedReuse} / ${expectedReuse.length}`,
      `New parents created/matched: ${parentsMatchedCreate} / ${expectedCreate.length}`,
      `Learner–parent links: ${linksMatched} / ${expectedLinks.length}`,
      parentFamilyMatch
        ? "Parents & Families check passed."
        : parentFamilyReviewRequired
          ? "Parent identity review is still required."
          : "Parents & Families check needs attention.",
    ],
  };
  return saveParentFamilyCheck(check);
}
