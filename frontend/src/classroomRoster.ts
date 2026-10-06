type Rec = Record<string, unknown>;

function rec(value: unknown): Rec {
  return value && typeof value === "object" ? (value as Rec) : {};
}

/** GET /api/classrooms/:id returns `{ classroom: { learners } }`; older shapes used top-level keys. */
export function classroomDetailLearners(data: unknown): Rec[] {
  const d = rec(data);
  const c = rec(d.classroom);
  for (const candidate of [c.learners, c.children, d.learners, d.children]) {
    if (Array.isArray(candidate)) return candidate as Rec[];
  }
  return [];
}

export function classroomDetailChildrenCount(data: unknown, learners: unknown[]): number {
  const d = rec(data);
  const n = Number(rec(d.classroom).childrenCount ?? d.childrenCount ?? learners.length);
  return Number.isFinite(n) ? n : learners.length;
}

export type AddLearnerCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  grade: string;
  currentClass: string;
  birthDate: string | null;
};

/** Learners that can be added: active learners (from /api/learners) not already on this roster. */
export function addLearnerCandidates(
  learners: unknown[],
  rosterLearnerIds: Iterable<string>
): AddLearnerCandidate[] {
  const onRoster = new Set(Array.from(rosterLearnerIds, String));
  return (Array.isArray(learners) ? learners : [])
    .map((raw) => {
      const l = rec(raw);
      return {
        id: String(l.id ?? ""),
        firstName: String(l.firstName ?? ""),
        lastName: String(l.lastName ?? ""),
        grade: String(l.grade ?? ""),
        currentClass: String(l.className ?? "").trim(),
        birthDate: l.birthDate ? String(l.birthDate) : null,
      };
    })
    .filter((l) => l.id && l.firstName && l.lastName && !onRoster.has(l.id));
}

/** User-facing summary of POST /api/classrooms/:id/add-learners. */
export function addLearnersResultMessage(result: unknown, requestedCount: number): string {
  const r = rec(result);
  const assigned = Number(r.assigned ?? 0);
  const skipped = Array.isArray(r.skippedLearnerIds) ? r.skippedLearnerIds.length : 0;
  const base = `${assigned} of ${requestedCount} learner(s) added to ${String(r.classroomName || "this classroom")}.`;
  return skipped ? `${base} ${skipped} could not be added (not active in this school).` : base;
}

export function deleteClassroomConfirmMessage(rosterCount: number): string {
  const n = Number.isFinite(rosterCount) && rosterCount > 0 ? Math.floor(rosterCount) : 0;
  return `Delete this classroom? Learners will NOT be deleted; their classroom will be cleared (${n} active learner(s) on this roster will become unassigned).`;
}

/** User-facing summary of DELETE /api/classrooms/:id. */
export function deleteClassroomResultMessage(result: unknown): string {
  const r = rec(result);
  const unassigned = Number(r.unassigned ?? 0);
  const name = String(r.classroomName || "Classroom");
  return `${name} deleted. ${Number.isFinite(unassigned) ? unassigned : 0} learner(s) unassigned.`;
}
