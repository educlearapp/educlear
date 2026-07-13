import type { BillingAccountRow } from "../billing/billingLedger";
import { normalizeKidESysAccountRef } from "../billing/billingAccountRef";
import { isActiveEnrollment } from "../utils/learnerGender";
import type { FinanceAccountSnapshot } from "./financeAccountEngine";

function learnerId(learner: unknown): string {
  return String((learner as any)?.id || (learner as any)?.learnerId || "").trim();
}

function learnerFamilyAccountId(learner: unknown): string {
  return String(
    (learner as any)?.familyAccountId || (learner as any)?.familyAccount?.id || ""
  ).trim();
}

function learnerAccountRef(learner: unknown): string {
  return normalizeKidESysAccountRef(
    (learner as any)?.accountNo ||
      (learner as any)?.accountRef ||
      (learner as any)?.familyAccount?.accountRef
  );
}

/** Learners linked to a billing account row (active + historical). */
export function learnersLinkedToBillingAccount(
  row: BillingAccountRow,
  enrollmentLearners: unknown[]
): unknown[] {
  const accountRef = normalizeKidESysAccountRef(row.accountNo);
  const familyAccountId = String(row.familyAccountId || "").trim();
  const memberIds = new Set(
    [
      ...(row.memberLearnerIds || []),
      String(row.learnerId || row.id || ""),
    ].filter(Boolean)
  );

  return (enrollmentLearners || []).filter((learner) => {
    const id = learnerId(learner);
    const learnerFamilyId = learnerFamilyAccountId(learner);
    const learnerRef = learnerAccountRef(learner);
    return (
      (id && memberIds.has(id)) ||
      Boolean(familyAccountId && learnerFamilyId && learnerFamilyId === familyAccountId) ||
      Boolean(accountRef && learnerRef && learnerRef === accountRef)
    );
  });
}

/**
 * Active Collections Centre accounts must have at least one currently enrolled learner.
 * When no learner records match the account, the row is kept (statements remain authoritative).
 */
export function isActiveCollectionsAccount(
  row: BillingAccountRow,
  enrollmentLearners: unknown[]
): boolean {
  const linked = learnersLinkedToBillingAccount(row, enrollmentLearners);
  if (!linked.length) return true;
  return linked.some((learner) => isActiveEnrollment(learner as any));
}

export function filterActiveCollectionsSnapshots(
  snapshots: FinanceAccountSnapshot[],
  enrollmentLearners: unknown[]
): FinanceAccountSnapshot[] {
  if (!enrollmentLearners?.length) return snapshots;
  return snapshots.filter((snapshot) =>
    isActiveCollectionsAccount(snapshot.row, enrollmentLearners)
  );
}
