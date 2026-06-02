import { splitMergedAccountNames } from "./daSilvaMigration/daSilvaMergedFamily";
import { normalizeMatchText } from "../utils/kideesysSpreadsheet";

export type LearnerNameRow = {
  id: string;
  firstName: string;
  lastName: string;
};

export function splitAccountHolderNames(accountHolder: string): string[] {
  return splitMergedAccountNames(accountHolder);
}

export function learnerFullName(learner: LearnerNameRow): string {
  return `${String(learner.firstName || "").trim()} ${String(learner.lastName || "").trim()}`
    .trim()
    .replace(/\s+/g, " ");
}

export function buildLearnerNameIndex(learners: LearnerNameRow[]): Map<string, LearnerNameRow> {
  const index = new Map<string, LearnerNameRow>();
  for (const learner of learners) {
    const full = learnerFullName(learner);
    if (!full) continue;
    const key = normalizeMatchText(full);
    if (!index.has(key)) index.set(key, learner);
  }
  return index;
}

/** Match school learners to Kid-e-Sys age-analysis account holder label(s). */
export function matchLearnersToAccountHolder(
  learners: LearnerNameRow[],
  accountHolder: string
): LearnerNameRow[] {
  const names = splitAccountHolderNames(accountHolder);
  if (!names.length) return [];

  const index = buildLearnerNameIndex(learners);
  const seen = new Set<string>();
  const matched: LearnerNameRow[] = [];

  const tryAdd = (learner: LearnerNameRow | undefined) => {
    if (!learner || seen.has(learner.id)) return;
    seen.add(learner.id);
    matched.push(learner);
  };

  for (const name of names) {
    const key = normalizeMatchText(name);
    if (!key) continue;
    tryAdd(index.get(key));

    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const first = normalizeMatchText(parts[0]);
      const last = normalizeMatchText(parts[parts.length - 1]);
      for (const learner of learners) {
        const lFirst = normalizeMatchText(learner.firstName);
        const lLast = normalizeMatchText(learner.lastName);
        if (lFirst === first && lLast === last) tryAdd(learner);
      }
    }
  }

  return matched;
}

export function resolveMemberNames(
  accountHolder: string,
  matchedLearners: LearnerNameRow[]
): string[] {
  const fromHolder = splitAccountHolderNames(accountHolder);
  if (fromHolder.length) return fromHolder;
  return matchedLearners.map(learnerFullName).filter(Boolean);
}
