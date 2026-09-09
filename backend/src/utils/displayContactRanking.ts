/**
 * Shared display-contact ranking for Outstanding Accounts and Lists & Registers.
 * Weights match statement PDF display ranking (no email gate).
 */

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

/** Alternate contact: workNo, then homeNo. */
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
  relationship: string;
  score: number;
};

/** Rank parents for a single learner; highest score wins. Stable tie-break by id. */
export function rankDisplayParentsForLearner(
  parents: Array<{
    id?: string | null;
    firstName?: string | null;
    surname?: string | null;
    cellNo?: string | null;
    workNo?: string | null;
    homeNo?: string | null;
    email?: string | null;
    relationship?: string | null;
    relation?: string | null;
    isPrimary?: boolean | null;
    isPayingPerson?: boolean | null;
    communicationBilling?: boolean | null;
  }>
): RankedDisplayParent | null {
  const ranked: RankedDisplayParent[] = [];
  for (const p of parents || []) {
    const id = String(p.id || "").trim();
    if (!id) continue;
    ranked.push({
      id,
      firstName: String(p.firstName || "").trim(),
      surname: String(p.surname || "").trim(),
      cellNo: String(p.cellNo || "").trim(),
      workNo: String(p.workNo || "").trim(),
      homeNo: String(p.homeNo || "").trim(),
      email: String(p.email || "").trim(),
      relationship: String(p.relation || p.relationship || "").trim(),
      score: scoreDisplayContact({
        isPrimary: p.isPrimary,
        isPayingPerson: p.isPayingPerson,
        communicationBilling: p.communicationBilling,
      }),
    });
  }
  if (!ranked.length) return null;
  ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return ranked[0];
}
