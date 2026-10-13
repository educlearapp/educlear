type LinkedParent = Record<string, unknown>;

type LearnerWithParentLinks = {
  parents?: unknown;
  parentLinks?: unknown;
} | null | undefined;

/**
 * Parents linked to a learner, taken only from persisted ParentLearnerLink data
 * (learner.parents / learner.parentLinks as returned by the API).
 * Never infer parents by surname or family account — a shared surname or billing
 * account does not authorise a parent for a learner.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function learnerLinkedParents(learner: LearnerWithParentLinks): any[] {
  const parents = Array.isArray(learner?.parents) ? (learner.parents as LinkedParent[]) : [];
  const fromLinks = Array.isArray(learner?.parentLinks)
    ? (learner.parentLinks as LinkedParent[])
        .map((link) => (link?.parent as LinkedParent | undefined) || link)
        .filter(Boolean)
    : [];
  return [...parents, ...fromLinks];
}
