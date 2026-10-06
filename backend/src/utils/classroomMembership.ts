/**
 * Classroom membership rule (Learner.className ↔ Classroom.name).
 *
 * Learner.className remains the source of truth. A label resolves to a registered classroom by:
 *   1. exact (trimmed) name match;
 *   2. otherwise the oldest classroom with the same membership key — Unicode-normalized,
 *      case-insensitive, all whitespace ignored ("Grade RA" = "Grade Ra" = " GRADE R A ");
 *   3. otherwise the oldest classroom whose key equals the section after the last "/"
 *      ("Grade 1 / 1A" → "1A"; slash-format import labels, historically honoured by the
 *      teacher portal).
 * Labels that resolve to no classroom form "unregistered" classes grouped by membership key.
 * Rosters and counts only include ACTIVE learners.
 *
 * Every subsystem that decides whether a learner belongs to a classroom must use this module.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { activeLearnerWhere } from "./learnerEnrollment";

export function classroomMembershipKey(raw: string | null | undefined): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "");
}

/** Trim and collapse internal whitespace for persisted labels. */
export function cleanClassroomLabel(raw: string | null | undefined): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
}

function slashSectionKey(raw: string | null | undefined): string {
  const s = String(raw ?? "");
  const i = s.lastIndexOf("/");
  return i >= 0 ? classroomMembershipKey(s.slice(i + 1)) : "";
}

type ClassroomRef = { id: string; name: string; createdAt?: Date | string | null };
type LearnerRef = { className: string | null };

export type ClassroomResolution =
  | { registered: true; key: string; classroomId: string; classroomName: string }
  | { registered: false; key: string };

export type ClassroomResolver<C extends ClassroomRef> = {
  /** Classrooms oldest first (createdAt, then id). */
  classrooms: C[];
  classroomFor(label: string | null | undefined): C | null;
  resolve(label: string | null | undefined): ClassroomResolution | null;
  /** True when both labels resolve to the same registered classroom or the same unregistered class. */
  sameClassroom(a: string | null | undefined, b: string | null | undefined): boolean;
};

export function createClassroomResolver<C extends ClassroomRef>(classrooms: C[]): ClassroomResolver<C> {
  const ordered = [...classrooms].sort((a, b) => {
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return at - bt || a.id.localeCompare(b.id);
  });
  const exactByName = new Map<string, C>();
  const firstByKey = new Map<string, C>();
  for (const c of ordered) {
    const trimmed = String(c.name || "").trim();
    if (!exactByName.has(trimmed)) exactByName.set(trimmed, c);
    const key = classroomMembershipKey(c.name);
    if (key && !firstByKey.has(key)) firstByKey.set(key, c);
  }

  const classroomFor = (label: string | null | undefined): C | null => {
    const trimmed = String(label ?? "").trim();
    const key = classroomMembershipKey(trimmed);
    if (!key) return null;
    const exact = exactByName.get(trimmed) || firstByKey.get(key);
    if (exact) return exact;
    const section = slashSectionKey(trimmed);
    return (section && firstByKey.get(section)) || null;
  };

  const resolve = (label: string | null | undefined): ClassroomResolution | null => {
    const key = classroomMembershipKey(label);
    if (!key) return null;
    const c = classroomFor(label);
    return c
      ? { registered: true, key, classroomId: c.id, classroomName: c.name }
      : { registered: false, key };
  };

  const sameClassroom = (a: string | null | undefined, b: string | null | undefined) => {
    const ra = resolve(a);
    const rb = resolve(b);
    if (!ra || !rb) return false;
    if (ra.registered && rb.registered) return ra.classroomId === rb.classroomId;
    if (!ra.registered && !rb.registered) return ra.key === rb.key;
    return false;
  };

  return { classrooms: ordered, classroomFor, resolve, sameClassroom };
}

export function learnerBelongsToClassroom(
  learnerClassName: string | null | undefined,
  classroomName: string | null | undefined
): boolean {
  if (!classroomMembershipKey(classroomName)) return false;
  return (
    createClassroomResolver([{ id: "_", name: String(classroomName) }]).classroomFor(learnerClassName) !==
    null
  );
}

export type UnregisteredClassGroup<L> = {
  key: string;
  /** Most common trimmed spelling among the group's learners. */
  displayName: string;
  learners: L[];
};

/**
 * Assign each learner to exactly one classroom using the resolver rules above. Learners whose
 * label has no classroom are grouped as unregistered classes.
 */
export function assignLearnersToClassrooms<C extends ClassroomRef, L extends LearnerRef>(
  classrooms: C[],
  learners: L[]
): { byClassroomId: Map<string, L[]>; unregistered: UnregisteredClassGroup<L>[] } {
  const resolver = createClassroomResolver(classrooms);
  const byClassroomId = new Map<string, L[]>();
  for (const c of resolver.classrooms) byClassroomId.set(c.id, []);

  const unregisteredByKey = new Map<string, { learners: L[]; spellings: Map<string, number> }>();
  for (const learner of learners) {
    const trimmed = String(learner.className || "").trim();
    const resolved = resolver.resolve(trimmed);
    if (!resolved) continue;
    if (resolved.registered) {
      byClassroomId.get(resolved.classroomId)!.push(learner);
      continue;
    }
    const group = unregisteredByKey.get(resolved.key) || {
      learners: [],
      spellings: new Map<string, number>(),
    };
    group.learners.push(learner);
    group.spellings.set(trimmed, (group.spellings.get(trimmed) || 0) + 1);
    unregisteredByKey.set(resolved.key, group);
  }

  const unregistered: UnregisteredClassGroup<L>[] = [];
  for (const [key, group] of unregisteredByKey) {
    const displayName = [...group.spellings.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    )[0][0];
    unregistered.push({ key, displayName, learners: group.learners });
  }
  unregistered.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { byClassroomId, unregistered };
}

/** ACTIVE learners with a className in this school (input for {@link assignLearnersToClassrooms}). */
export function activeClassMemberWhere(schoolId: string): Prisma.LearnerWhereInput {
  return { ...activeLearnerWhere(schoolId), className: { not: null } };
}

export type SchoolClassMembership = {
  resolver: ClassroomResolver<{ id: string; name: string; createdAt: Date }>;
  /** Distinct stored Learner.className values in the school (any enrolment status, untrimmed). */
  classNames: string[];
  /**
   * Stored className values that belong to the same classroom as `label`, plus the label and the
   * registered classroom name. Use with `className: { in: ... }`; callers add status filters.
   */
  spellingsFor(label: string | null | undefined): string[];
  /** Canonical display label: registered classroom name, else one stable spelling per unregistered class. */
  labelFor(label: string | null | undefined): string;
  /** One display label per distinct classroom among the stored class names. */
  classLabels(): string[];
};

export async function loadSchoolClassMembership(schoolId: string): Promise<SchoolClassMembership> {
  const [classrooms, rows] = await Promise.all([
    prisma.classroom.findMany({
      where: { schoolId },
      select: { id: true, name: true, createdAt: true },
    }),
    prisma.learner.findMany({
      where: { schoolId, className: { not: null } },
      select: { className: true },
      distinct: ["className"],
    }),
  ]);
  const resolver = createClassroomResolver(classrooms);
  const classNames = rows.map((r) => r.className as string).filter((v) => classroomMembershipKey(v));

  const spellingsFor = (label: string | null | undefined): string[] => {
    const trimmed = String(label ?? "").trim();
    if (!classroomMembershipKey(trimmed)) return [];
    const out = new Set<string>([trimmed]);
    const target = resolver.classroomFor(trimmed);
    if (target) out.add(target.name);
    for (const cn of classNames) {
      if (resolver.sameClassroom(trimmed, cn)) out.add(cn);
    }
    return [...out];
  };

  const unregisteredLabelByKey = new Map<string, string>();
  for (const cn of [...classNames].sort((a, b) => a.trim().localeCompare(b.trim()))) {
    const r = resolver.resolve(cn);
    if (r && !r.registered && !unregisteredLabelByKey.has(r.key)) {
      unregisteredLabelByKey.set(r.key, cleanClassroomLabel(cn));
    }
  }

  const labelFor = (label: string | null | undefined): string => {
    const r = resolver.resolve(label);
    if (!r) return "";
    if (r.registered) return r.classroomName;
    return unregisteredLabelByKey.get(r.key) || cleanClassroomLabel(label);
  };

  const classLabels = (): string[] => {
    const labels = new Set<string>();
    for (const cn of classNames) {
      const label = labelFor(cn);
      if (label) labels.add(label);
    }
    return [...labels].sort((a, b) => a.localeCompare(b));
  };

  return { resolver, classNames, spellingsFor, labelFor, classLabels };
}

/**
 * Attendance/register learner filter: members of the class named `label`, or — for grade-level
 * registers — learners whose grade equals `label`. Callers add enrolment-status filters.
 */
export function classOrGradeLearnerWhere(
  membership: SchoolClassMembership,
  label: string
): Prisma.LearnerWhereInput {
  const spellings = membership.spellingsFor(label);
  return { OR: [{ className: { in: spellings.length ? spellings : [label] } }, { grade: label }] };
}

/** Register grouping label for a learner: canonical class label, else the grade. */
export function learnerRegisterLabel(
  membership: SchoolClassMembership,
  learner: { className?: string | null; grade?: string | null }
): string {
  return membership.labelFor(learner.className) || String(learner.grade || "").trim();
}

/**
 * Resolve a requested learner class label to the registered Classroom name it belongs to;
 * otherwise return the cleaned label. Empty → null.
 */
export async function resolveCanonicalClassName(
  schoolId: string,
  raw: string | null | undefined
): Promise<string | null> {
  const cleaned = cleanClassroomLabel(raw);
  if (!cleaned) return null;
  const classrooms = await prisma.classroom.findMany({
    where: { schoolId },
    select: { id: true, name: true, createdAt: true },
  });
  const match = createClassroomResolver(classrooms).classroomFor(cleaned);
  return match ? match.name : cleaned;
}
