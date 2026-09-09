/**
 * Shared display-contact ranking (mirrors backend/src/utils/displayContactRanking.ts).
 * Outstanding Accounts uses rankDisplayParentsForLearner (single pick).
 * Contact List / Address List use listRankedDisplayParentsForLearner (all linked).
 */

export type RankableParentInput = {
  id?: string | null;
  firstName?: string | null;
  surname?: string | null;
  cellNo?: string | null;
  workNo?: string | null;
  homeNo?: string | null;
  email?: string | null;
  homeAddress?: string | null;
  relationship?: string | null;
  relation?: string | null;
  isPrimary?: boolean | null;
  isPayingPerson?: boolean | null;
  communicationBilling?: boolean | null;
};

export function scoreDisplayContact(input: {
  isPrimary?: boolean | null;
  isPayingPerson?: boolean | null;
  communicationBilling?: boolean | null;
}): number {
  let score = 0;
  if (input.isPrimary) score += 10;
  if (input.isPayingPerson) score += 6;
  if (input.communicationBilling !== false) score += 2;
  return score;
}

export function parentDisplayName(parent: {
  firstName?: string | null;
  surname?: string | null;
}): string {
  return `${parent.firstName || ""} ${parent.surname || ""}`.trim();
}

export function pickAlternateContact(parent: {
  workNo?: string | null;
  homeNo?: string | null;
}): string | null {
  const work = String(parent.workNo || "").trim();
  if (work) return work;
  const home = String(parent.homeNo || "").trim();
  if (home) return home;
  return null;
}

export type RankedDisplayParent = {
  id: string;
  firstName: string;
  surname: string;
  cellNo: string;
  workNo: string;
  homeNo: string;
  email: string;
  homeAddress: string;
  relationship: string;
  isPrimary: boolean;
  isPayingPerson: boolean;
  score: number;
};

/** All linked parents for a learner, deduped by id, primary → paying → remaining. */
export function listRankedDisplayParentsForLearner(
  parents: RankableParentInput[]
): RankedDisplayParent[] {
  const byId = new Map<string, RankedDisplayParent>();
  for (const p of parents || []) {
    const id = String(p.id || "").trim();
    if (!id) continue;
    const next: RankedDisplayParent = {
      id,
      firstName: String(p.firstName || "").trim(),
      surname: String(p.surname || "").trim(),
      cellNo: String(p.cellNo || "").trim(),
      workNo: String(p.workNo || "").trim(),
      homeNo: String(p.homeNo || "").trim(),
      email: String(p.email || "").trim(),
      homeAddress: String(p.homeAddress || "").trim(),
      relationship: String(p.relation || p.relationship || "").trim(),
      isPrimary: Boolean(p.isPrimary),
      isPayingPerson: Boolean(p.isPayingPerson),
      score: scoreDisplayContact({
        isPrimary: p.isPrimary,
        isPayingPerson: p.isPayingPerson,
        communicationBilling: p.communicationBilling,
      }),
    };
    const prev = byId.get(id);
    if (!prev || next.score > prev.score) byId.set(id, next);
  }
  return Array.from(byId.values()).sort(
    (a, b) => b.score - a.score || a.id.localeCompare(b.id)
  );
}

/** Single display/billing contact (Outstanding Accounts semantics). */
export function rankDisplayParentsForLearner(
  parents: RankableParentInput[]
): RankedDisplayParent | null {
  const ranked = listRankedDisplayParentsForLearner(parents);
  return ranked[0] || null;
}
