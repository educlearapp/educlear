import { parentPublishedDocumentWhere } from "../utils/teacherVisibility";

export type ParentDocumentLearnerTarget = {
  id: string;
  grade: string;
  className: string | null;
};

/**
 * Prisma where for parent-visible ParentDocument rows targeted at the given learners.
 * Uses DB-level OR targeting (school-wide / learner / grade / class spellings) so
 * pagination does not depend on a bounded in-memory scan.
 */
export function buildParentDocumentVisibilityWhere(opts: {
  schoolId: string;
  learners: ParentDocumentLearnerTarget[];
  /** When set, only that learner's targeting applies (plus school-wide). */
  activeLearnerId?: string | null;
  spellingsFor: (className: string | null | undefined) => string[];
}): Record<string, unknown> {
  const activeId = String(opts.activeLearnerId || "").trim();
  const learners = activeId
    ? opts.learners.filter((l) => l.id === activeId)
    : opts.learners;

  const base = {
    schoolId: opts.schoolId,
    ...parentPublishedDocumentWhere(),
  };

  const schoolWide = {
    AND: [{ learnerId: null }, { grade: null }, { className: null }],
  };

  if (!learners.length) {
    return { ...base, ...schoolWide };
  }

  const learnerIds = [...new Set(learners.map((l) => l.id).filter(Boolean))];
  const grades = [
    ...new Set(learners.map((l) => String(l.grade || "").trim()).filter(Boolean)),
  ];
  const classSpellings = new Set<string>();
  for (const l of learners) {
    for (const s of opts.spellingsFor(l.className)) {
      const t = String(s || "").trim();
      if (t) classSpellings.add(t);
    }
  }

  const or: Record<string, unknown>[] = [schoolWide];
  if (learnerIds.length) or.push({ learnerId: { in: learnerIds } });
  if (grades.length) or.push({ grade: { in: grades } });
  if (classSpellings.size) or.push({ className: { in: [...classSpellings] } });

  return { ...base, OR: or };
}
