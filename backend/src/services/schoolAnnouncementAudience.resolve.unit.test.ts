/**
 * Local DB audience resolve + parent visibility (no HTTP, no push send beyond createParentNotification enqueue).
 * SAFE: localhost educlear_device_test only. Synthetic fixtures cleaned.
 *
 * Run: DATABASE_URL=... npx tsx src/services/schoolAnnouncementAudience.resolve.unit.test.ts
 */
import assert from "assert";
import { PrismaClient } from "@prisma/client";
import {
  listParentVisibleNotices,
  parentMayViewNotice,
  resolveAnnouncementAudience,
} from "./schoolAnnouncementService";
import { loadSchoolClassMembership } from "../utils/classroomMembership";

const prisma = new PrismaClient();
const PREFIX = "ann-aud-";

function assertLocalDatabase() {
  const url = String(process.env.DATABASE_URL || "");
  assert.ok(url, "DATABASE_URL required");
  let host = "";
  try {
    host = new URL(url.replace(/^postgresql:/, "http:")).hostname;
  } catch {
    host = "";
  }
  assert.ok(host === "localhost" || host === "127.0.0.1", `Refuse non-local host: ${host}`);
}

async function cleanup() {
  const schools = await prisma.school.findMany({
    where: { id: { startsWith: PREFIX } },
    select: { id: true },
  });
  for (const s of schools) {
    const parents = await prisma.parent.findMany({ where: { schoolId: s.id }, select: { id: true } });
    for (const p of parents) {
      await prisma.parentNotification.deleteMany({ where: { parentId: p.id } });
      await prisma.parentLearnerLink.deleteMany({ where: { parentId: p.id } });
    }
    await prisma.schoolNoticeAuditLog.deleteMany({ where: { schoolId: s.id } });
    await prisma.schoolNotice.deleteMany({ where: { schoolId: s.id } });
    await prisma.parent.deleteMany({ where: { schoolId: s.id } });
    await prisma.learner.deleteMany({ where: { schoolId: s.id } });
    await prisma.classroom.deleteMany({ where: { schoolId: s.id } });
    await prisma.school.delete({ where: { id: s.id } }).catch(() => undefined);
  }
}

async function main() {
  assertLocalDatabase();
  await cleanup();
  const stamp = Date.now().toString(36);
  const schoolId = `${PREFIX}${stamp}`;

  await prisma.school.create({
    data: { id: schoolId, name: "Ann Audience Test" },
  });
  const room = await prisma.classroom.create({
    data: { schoolId, name: "Grade 1A" },
  });
  const learnerA = await prisma.learner.create({
    data: {
      schoolId,
      firstName: "Ann",
      lastName: "One",
      grade: "1",
      className: "Grade 1A",
      admissionNo: `AA${stamp}1`.slice(0, 12),
      enrollmentStatus: "ACTIVE",
    },
  });
  const learnerB = await prisma.learner.create({
    data: {
      schoolId,
      firstName: "Bob",
      lastName: "Two",
      grade: "2",
      className: "Grade 2A",
      admissionNo: `AA${stamp}2`.slice(0, 12),
      enrollmentStatus: "ACTIVE",
    },
  });
  const parentSelected = await prisma.parent.create({
    data: {
      schoolId,
      firstName: "Selected",
      surname: "Parent",
      cellNo: "0820000001",
      idNumber: `A${stamp}01`.replace(/\W/g, "").slice(0, 13).padEnd(13, "0"),
    },
  });
  const parentOther = await prisma.parent.create({
    data: {
      schoolId,
      firstName: "Other",
      surname: "Parent",
      cellNo: "0820000002",
      idNumber: `A${stamp}02`.replace(/\W/g, "").slice(0, 13).padEnd(13, "0"),
    },
  });
  // Selected parent has learners in two classes
  await prisma.parentLearnerLink.create({
    data: {
      schoolId,
      parentId: parentSelected.id,
      learnerId: learnerA.id,
      relation: "Mother",
      isPrimary: true,
    },
  });
  await prisma.parentLearnerLink.create({
    data: {
      schoolId,
      parentId: parentSelected.id,
      learnerId: learnerB.id,
      relation: "Mother",
      isPrimary: false,
    },
  });
  await prisma.parentLearnerLink.create({
    data: {
      schoolId,
      parentId: parentOther.id,
      learnerId: learnerB.id,
      relation: "Father",
      isPrimary: true,
    },
  });

  const admin = {
    userId: "admin1",
    email: "admin@test.local",
    role: "SCHOOL_ADMIN",
    isSchoolWideAdmin: true,
    assignedClassNames: [] as string[],
  };
  const teacher = {
    userId: "teach1",
    email: "teach@test.local",
    role: "STAFF",
    isSchoolWideAdmin: false,
    assignedClassNames: ["Grade 1A"],
  };

  const all = await resolveAnnouncementAudience({
    schoolId,
    actor: admin,
    input: { audienceMode: "all_parents" },
  });
  assert.equal(all.uniqueParentCount, 2);
  assert.ok(all.learnerCount >= 2);

  const byClass = await resolveAnnouncementAudience({
    schoolId,
    actor: admin,
    input: { audienceMode: "by_class", classScope: "classroom", className: "Grade 1A" },
  });
  assert.equal(byClass.uniqueParentCount, 1);
  assert.equal(byClass.recipients[0]?.parentId, parentSelected.id);

  await assert.rejects(
    () =>
      resolveAnnouncementAudience({
        schoolId,
        actor: teacher,
        input: { audienceMode: "all_parents" },
      }),
    /administrators/i
  );

  const individual = await resolveAnnouncementAudience({
    schoolId,
    actor: admin,
    input: { audienceMode: "individual", parentIds: [parentSelected.id] },
  });
  assert.equal(individual.uniqueParentCount, 1);
  assert.equal(individual.learnerCount, 2, "multi-class children counted");

  // Teacher individual: may select parent via Grade 1A link
  const teacherInd = await resolveAnnouncementAudience({
    schoolId,
    actor: teacher,
    input: { audienceMode: "individual", parentIds: [parentSelected.id] },
  });
  assert.equal(teacherInd.uniqueParentCount, 1);

  await assert.rejects(
    () =>
      resolveAnnouncementAudience({
        schoolId,
        actor: teacher,
        input: { audienceMode: "individual", parentIds: [parentOther.id] },
      }),
    /assigned classrooms/i
  );

  const notice = await prisma.schoolNotice.create({
    data: {
      schoolId,
      noticeType: "SCHOOL",
      title: "Private note",
      body: "Only selected",
      audienceParentIds: [parentSelected.id],
      lifecycleStatus: "PUBLISHED",
      isDraft: false,
      visibility: "CLASS_TEACHERS",
      publishedAt: new Date(),
    },
  });

  const membership = await loadSchoolClassMembership(schoolId);
  assert.equal(
    parentMayViewNotice({
      parentId: parentSelected.id,
      learners: [
        { id: learnerA.id, grade: "1", className: "Grade 1A" },
        { id: learnerB.id, grade: "2", className: "Grade 2A" },
      ],
      notice,
      sameClassroom: (a, b) => membership.resolver.sameClassroom(a, b),
    }),
    true
  );
  assert.equal(
    parentMayViewNotice({
      parentId: parentOther.id,
      learners: [{ id: learnerB.id, grade: "2", className: "Grade 2A" }],
      notice,
      sameClassroom: (a, b) => membership.resolver.sameClassroom(a, b),
    }),
    false
  );

  const pageSelected = await listParentVisibleNotices({
    schoolId,
    parentId: parentSelected.id,
    learners: [
      { id: learnerA.id, grade: "1", className: "Grade 1A" },
      { id: learnerB.id, grade: "2", className: "Grade 2A" },
    ],
    spellingsFor: (cn) => membership.spellingsFor(cn),
    limit: 20,
  });
  assert.ok(pageSelected.notices.some((n) => n.id === notice.id));

  const pageOther = await listParentVisibleNotices({
    schoolId,
    parentId: parentOther.id,
    learners: [{ id: learnerB.id, grade: "2", className: "Grade 2A" }],
    spellingsFor: (cn) => membership.spellingsFor(cn),
    limit: 20,
  });
  assert.equal(
    pageOther.notices.some((n) => n.id === notice.id),
    false,
    "other parent must not see individual notice"
  );

  await cleanup();
  await prisma.$disconnect();
  console.log("schoolAnnouncementAudience.resolve.unit.test: PASS");
  void room;
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
