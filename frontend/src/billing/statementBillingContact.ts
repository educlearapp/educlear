/**
 * Shared statement billing-contact eligibility and ranking.
 * Used by single-statement send and bulk recipient construction so rules cannot drift.
 */

export type StatementContact = {
  name: string;
  email: string;
  relationship: string;
};

export type StatementParentPair = {
  parent: any;
  link: any;
};

/** Same validation standard as parentFormUtils / RegisterSchool. */
export function isValidStatementEmail(email: string): boolean {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export function normalizeStatementEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

export function parentDisplayName(parent: any): string {
  return (
    `${parent?.firstName || parent?.name || ""} ${parent?.surname || parent?.lastName || ""}`.trim() ||
    String(parent?.fullName || "").trim() ||
    "Parent / Guardian"
  );
}

function learnerFullName(learner: any): string {
  return `${learner?.firstName || learner?.name || ""} ${learner?.lastName || learner?.surname || ""}`.trim();
}

/**
 * School/internal inbox protection using authoritative school profile email only.
 * Does not ban generic providers (gmail, etc.).
 */
export function isSchoolOrInternalRecipientEmail(
  email: string,
  schoolEmail: string | null | undefined
): boolean {
  const candidate = normalizeStatementEmail(email);
  const school = normalizeStatementEmail(String(schoolEmail || ""));
  if (!candidate || !school) return false;
  return candidate === school;
}

/**
 * Single-send / bulk shared consent rule.
 * Explicit false on statement/billing/email preferences excludes the contact.
 * Null/undefined legacy values are allowed (same as historical single-send).
 * Flat parent rows (learner.parents) carry flags on the parent object; linked rows
 * may carry billingStatement on the link — both shapes are checked.
 */
export function isStatementBillingContact(pair: StatementParentPair): boolean {
  const parent = pair.parent;
  const link = pair.link;
  if (link?.billingStatement === false || parent?.billingStatement === false) return false;
  if (parent?.communicationBilling === false || link?.communicationBilling === false) return false;
  if (parent?.communicationByEmail === false || link?.communicationByEmail === false) return false;
  return Boolean(String(parent?.email || "").trim());
}

/** Ranking used to pick the canonical billing recipient for an account. */
export function contactScore(pair: StatementParentPair): number {
  let score = 0;
  if (pair.link?.isPrimary || pair.parent?.isPrimary) score += 10;
  if (pair.link?.isPayingPerson || pair.parent?.isPayingPerson) score += 6;
  if (pair.parent?.communicationBilling !== false && pair.link?.communicationBilling !== false) {
    score += 2;
  }
  return score;
}

export function collectParentPairsForLearner(
  learner: any,
  globalParents: any[] = []
): StatementParentPair[] {
  const seen = new Set<string>();
  const pairs: StatementParentPair[] = [];

  const add = (rawParent: any, link: any = {}) => {
    if (!rawParent) return;
    const parent = rawParent?.parent || rawParent;
    const mergedLink = rawParent?.parent ? rawParent : link;
    const id = String(parent?.id || "").trim();
    const email = normalizeStatementEmail(parent?.email || "");
    const key = id || `${parentDisplayName(parent)}|${email}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    pairs.push({ parent, link: mergedLink || {} });
  };

  add(learner?.parent);
  add(learner?.primaryParent);
  add(learner?.guardian);
  for (const p of learner?.parents || []) add(p);
  for (const link of learner?.links || learner?.parentLinks || []) {
    add(link?.parent || link, link);
  }

  const learnerId = String(learner?.id || learner?.learnerId || "").trim();
  const learnerName = learnerFullName(learner).toLowerCase();

  for (const parent of globalParents || []) {
    const childIds = [
      parent?.learnerId,
      parent?.childId,
      parent?.studentId,
      parent?.child?.id,
      parent?.learner?.id,
      ...(Array.isArray(parent?.learnerIds) ? parent.learnerIds : []),
      ...(Array.isArray(parent?.children) ? parent.children.map((c: any) => c?.id) : []),
      ...(Array.isArray(parent?.learners) ? parent.learners.map((c: any) => c?.id) : []),
    ]
      .filter(Boolean)
      .map(String);

    const childNames = [
      parent?.learnerName,
      parent?.childName,
      parent?.studentName,
      ...(Array.isArray(parent?.children) ? parent.children.map((c: any) => learnerFullName(c)) : []),
      ...(Array.isArray(parent?.learners) ? parent.learners.map((c: any) => learnerFullName(c)) : []),
    ]
      .map((x: any) => String(x || "").toLowerCase().trim())
      .filter(Boolean);

    if (childIds.includes(learnerId) || childNames.includes(learnerName)) {
      add(parent);
    }
  }

  return pairs;
}

/** Linked parent/guardian for statement email (billing + email flags). */
export function resolveStatementBillingContact(
  learners: any[],
  globalParents: any[],
  accountLearnerIds: string[]
): StatementContact | null {
  const ids = accountLearnerIds.filter(Boolean);
  const candidates: StatementParentPair[] = [];

  for (const learnerId of ids) {
    const learner = (learners || []).find((l) => String(l?.id || l?.learnerId) === learnerId);
    if (!learner) continue;
    for (const pair of collectParentPairsForLearner(learner, globalParents)) {
      if (isStatementBillingContact(pair)) candidates.push(pair);
    }
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => contactScore(b) - contactScore(a));
  const best = candidates[0];
  return {
    name: parentDisplayName(best.parent),
    email: String(best.parent.email || "").trim(),
    relationship: String(
      best.link?.relation || best.link?.relationship || best.parent?.relationship || "Parent"
    ),
  };
}

export function pickCanonicalStatementBillingPair(
  pairs: StatementParentPair[]
): StatementParentPair | null {
  const eligible = pairs.filter((pair) => isStatementBillingContact(pair));
  if (!eligible.length) return null;
  const ranked = [...eligible].sort((a, b) => contactScore(b) - contactScore(a));
  return ranked[0] || null;
}
