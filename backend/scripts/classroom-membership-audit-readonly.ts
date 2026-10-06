/**
 * READ-ONLY classroom membership audit (Learner.className ↔ Classroom.name).
 *
 * Reports, per school, how rosters differ between the old rules (admin: exact string, all
 * statuses; teacher portal: exact or "… / <class>" suffix, ACTIVE) and the shared membership rule
 * in src/utils/classroomMembership.ts. Only findMany/findUnique are used. Learners are identified
 * by id and admission number only.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/classroom-membership-audit-readonly.ts <schoolId>
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  assignLearnersToClassrooms,
  classroomMembershipKey,
  createClassroomResolver,
} from "../src/utils/classroomMembership";

const prisma = new PrismaClient();

type LearnerRow = {
  id: string;
  admissionNo: string | null;
  grade: string;
  className: string | null;
  enrollmentStatus: string;
};

const ref = (l: LearnerRow) => ({ id: l.id, admissionNo: l.admissionNo, className: l.className });

async function main() {
  const schoolId = String(process.argv[2] || "").trim();
  if (!schoolId) throw new Error("Usage: classroom-membership-audit-readonly.ts <schoolId>");

  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true } });
  if (!school) throw new Error(`School not found: ${schoolId}`);

  const classrooms = await prisma.classroom.findMany({
    where: { schoolId },
    select: { id: true, name: true, createdAt: true, teacherEmail: true },
    orderBy: { name: "asc" },
  });
  const learners: LearnerRow[] = await prisma.learner.findMany({
    where: { schoolId },
    select: { id: true, admissionNo: true, grade: true, className: true, enrollmentStatus: true },
  });
  const active = learners.filter((l) => l.enrollmentStatus === "ACTIVE");
  const historical = learners.filter((l) => l.enrollmentStatus !== "ACTIVE");
  const activeWithClass = active.filter((l) => String(l.className || "").trim());
  const resolver = createClassroomResolver(classrooms);
  const { byClassroomId, unregistered } = assignLearnersToClassrooms(classrooms, activeWithClass);

  const oldTeacherRoster = (name: string) =>
    active.filter((l) => {
      const cn = String(l.className || "");
      return cn === name || cn.endsWith(`/${name}`) || cn.endsWith(` / ${name}`);
    });

  const affected = new Set<string>();
  const perClassroom = classrooms.map((c) => {
    const oldAdmin = learners.filter((l) => l.className === c.name);
    const oldAdminIds = new Set(oldAdmin.map((l) => l.id));
    const proposed = byClassroomId.get(c.id) || [];
    const proposedIds = new Set(proposed.map((l) => l.id));
    const newlyVisible = proposed.filter((l) => !oldAdminIds.has(l.id));
    const historicalDisappearing = oldAdmin.filter((l) => l.enrollmentStatus !== "ACTIVE");
    const activeLeaving = oldAdmin.filter((l) => l.enrollmentStatus === "ACTIVE" && !proposedIds.has(l.id));
    for (const l of [...newlyVisible, ...historicalDisappearing, ...activeLeaving]) affected.add(l.id);
    return {
      classroomId: c.id,
      classroom: c.name,
      createdAt: c.createdAt.toISOString(),
      hasTeacherEmail: Boolean(String(c.teacherEmail || "").trim()),
      oldAdminCountExactAllStatuses: oldAdmin.length,
      oldTeacherPortalCount: oldTeacherRoster(c.name).length,
      proposedCountActive: proposed.length,
      newlyVisible: newlyVisible.map(ref),
      historicalDisappearing: historicalDisappearing.map(ref),
      activeLeavingToAnotherClassroom: activeLeaving.map(ref),
      effectivelyEmpty: proposed.length === 0,
    };
  });

  const keyGroups = new Map<string, typeof classrooms>();
  for (const c of classrooms) {
    const key = classroomMembershipKey(c.name);
    keyGroups.set(key, [...(keyGroups.get(key) || []), c]);
  }
  const duplicateGroups = [...keyGroups.entries()]
    .filter(([, rooms]) => rooms.length > 1)
    .map(([key, rooms]) => ({
      key,
      oldestWins: resolver.classrooms.find((c) => classroomMembershipKey(c.name) === key)?.name ?? null,
      classrooms: rooms
        .map((r) => ({
          classroomId: r.id,
          name: r.name,
          createdAt: r.createdAt.toISOString(),
          hasTeacherEmail: Boolean(String(r.teacherEmail || "").trim()),
          proposedCountActive: (byClassroomId.get(r.id) || []).length,
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }));

  const gradeKeys = new Set(learners.map((l) => classroomMembershipKey(l.grade)).filter(Boolean));
  const labelRows = activeWithClass.map((l) => ({ l, label: String(l.className) }));
  const whitespaceOrCaseMismatches = labelRows
    .filter(({ label }) => {
      const owner = resolver.classroomFor(label);
      return owner && owner.name !== label && classroomMembershipKey(owner.name) === classroomMembershipKey(label);
    })
    .map(({ l, label }) => ({ ...ref(l), resolvesTo: resolver.classroomFor(label)!.name }));
  const slashAliasMatches = labelRows
    .filter(({ label }) => {
      const owner = resolver.classroomFor(label);
      return owner && classroomMembershipKey(owner.name) !== classroomMembershipKey(label);
    })
    .map(({ l, label }) => ({ ...ref(l), resolvesTo: resolver.classroomFor(label)!.name }));
  const classEqualsGrade = labelRows
    .filter(({ label }) => gradeKeys.has(classroomMembershipKey(label)))
    .map(({ l }) => ref(l));
  const bareSection = labelRows.filter(({ label }) => /^r[a-z]$/i.test(label.trim())).map(({ l }) => ref(l));
  const pipeOrLGrade = labelRows.filter(({ label }) => /^[|l]grade/i.test(label.trim())).map(({ l }) => ref(l));

  const report = {
    generatedAt: new Date().toISOString(),
    mode: "READ-ONLY",
    school,
    totals: {
      learners: learners.length,
      active: active.length,
      historical: historical.length,
      activeWithClassName: activeWithClass.length,
      activeWithoutClassName: active.length - activeWithClass.length,
      classroomRecords: classrooms.length,
      duplicateGroups: duplicateGroups.length,
      newlyVisibleLearners: perClassroom.reduce((n, c) => n + c.newlyVisible.length, 0),
      historicalDisappearing: perClassroom.reduce((n, c) => n + c.historicalDisappearing.length, 0),
      activeLeavingToAnotherClassroom: perClassroom.reduce((n, c) => n + c.activeLeavingToAnotherClassroom.length, 0),
      learnersAffected: affected.size,
      classroomsWithChangedCounts: perClassroom.filter(
        (c) => c.oldAdminCountExactAllStatuses !== c.proposedCountActive
      ).length,
      effectivelyEmptyClassrooms: perClassroom.filter((c) => c.effectivelyEmpty).length,
      unregisteredClassesAfterFix: unregistered.length,
    },
    perClassroom,
    duplicateGroups,
    unregisteredClassesAfterFix: unregistered.map((g) => ({
      displayName: g.displayName,
      activeLearners: g.learners.length,
      learners: g.learners.map(ref),
    })),
    ghostCandidates: {
      emptyClassroomRecords: perClassroom
        .filter((c) => c.effectivelyEmpty)
        .map((c) => ({ classroomId: c.classroomId, classroom: c.classroom, hasTeacherEmail: c.hasTeacherEmail })),
      duplicateNonOwners: duplicateGroups.flatMap((g) =>
        g.classrooms.filter((c) => c.name !== g.oldestWins).map((c) => ({ ...c, key: g.key }))
      ),
    },
    labelIssues: {
      whitespaceOrCaseMismatches,
      slashAliasMatches,
      classEqualsGrade,
      bareSection,
      pipeOrLGrade,
    },
    activeLearnersWithoutClassByGrade: countBy(
      active.filter((l) => !String(l.className || "").trim()).map((l) => l.grade || "(no grade)")
    ),
  };
  console.log(JSON.stringify(report, null, 2));
}

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] || 0) + 1;
  return out;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
