import type { SchoolClassMembership } from "./classroomMembership";
import { parentPublishedHomeworkOrNoticeWhere } from "./teacherVisibility";

type LearnerTarget = {
  id: string;
  grade?: string | null;
  className?: string | null;
};

/**
 * Prisma where fragment: published homework visible to one or more linked learners
 * (learner-specific, grade-wide, or class-targeted posts).
 */
export function parentHomeworkVisibilityWhere(
  schoolId: string,
  learners: LearnerTarget[],
  membership: SchoolClassMembership
) {
  const targets = learners.filter((l) => l && String(l.id || "").trim());
  const or: Record<string, unknown>[] = [];
  for (const active of targets) {
    or.push({ learnerId: active.id });
    const grade = String(active.grade || "").trim();
    if (grade) {
      or.push({ grade, learnerId: null });
    }
    const spellings = active.className ? membership.spellingsFor(active.className) : [];
    if (spellings.length) {
      or.push({
        className: { in: spellings },
        learnerId: null,
      });
    }
  }
  return {
    schoolId,
    ...parentPublishedHomeworkOrNoticeWhere(),
    ...(or.length ? { OR: or } : { id: "__no_homework_targets__" }),
  };
}
