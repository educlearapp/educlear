/**
 * Communications Phase 4 — Announcements recipient targeting (HTTP).
 * SAFE: localhost PostgreSQL (educlear_device_test) only. Synthetic fixtures cleaned.
 * No SMS/email; push only enqueues when subscriptions exist (fixtures have none).
 *
 * Run: DATABASE_URL=... PP20_C2_API_BASE=http://127.0.0.1:3000 npx tsx src/routes/schoolAnnouncements.phase4.audience.security.test.ts
 */
import assert from "assert";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { STAFF_JWT_SECRET } from "../utils/staffJwt";
import { signParentToken } from "../middleware/parentAuth";
import { ensureSchoolModuleEntitlements } from "../services/schoolModuleEntitlements";
import { permissionsForRole } from "../utils/userPermissions";

const prisma = new PrismaClient();
const PREFIX = "pp20c4-";
const API = process.env.PP20_C2_API_BASE || "http://127.0.0.1:3000";

const TEACHER_COMMS = {
  ...permissionsForRole("Teacher"),
  communications: {
    view: true,
    create: true,
    edit: true,
    delete: false,
    print: true,
    send: true,
  },
};

function assertLocalDatabase() {
  const url = String(process.env.DATABASE_URL || "");
  assert.ok(url, "DATABASE_URL required");
  let host = "";
  let db = "";
  try {
    const u = new URL(url.replace(/^postgresql:/, "http:"));
    host = u.hostname;
    db = (u.pathname || "").replace(/^\//, "");
  } catch {
    host = "";
  }
  assert.ok(
    host === "localhost" || host === "127.0.0.1",
    `Refusing Phase 4 tests against non-local host: ${host || "(unknown)"}`
  );
  assert.ok(
    db === "educlear_device_test" || process.env.ALLOW_NON_DEVICE_TEST === "1",
    `Expected educlear_device_test, got: ${db || "(unknown)"}`
  );
}

function bearer(user: { id: string; schoolId: string; email: string; role?: string }) {
  return `Bearer ${jwt.sign(
    {
      userId: user.id,
      schoolId: user.schoolId,
      email: user.email,
      role: user.role || "STAFF",
    },
    STAFF_JWT_SECRET,
    { expiresIn: "1h" }
  )}`;
}

async function cleanup() {
  const schools = await prisma.school.findMany({
    where: { id: { startsWith: PREFIX } },
    select: { id: true },
  });
  for (const s of schools) {
    const parents = await prisma.parent.findMany({
      where: { schoolId: s.id },
      select: { id: true },
    });
    for (const p of parents) {
      await prisma.parentPushDelivery.deleteMany({ where: { parentId: p.id } }).catch(() => undefined);
      await prisma.parentNotification.deleteMany({ where: { parentId: p.id } });
      await prisma.parentLearnerLink.deleteMany({ where: { parentId: p.id } });
    }
    await prisma.schoolNoticeAuditLog.deleteMany({ where: { schoolId: s.id } });
    await prisma.schoolNotice.deleteMany({ where: { schoolId: s.id } });
    await prisma.parentLearnerLink.deleteMany({ where: { schoolId: s.id } });
    await prisma.parent.deleteMany({ where: { schoolId: s.id } });
    await prisma.learner.deleteMany({ where: { schoolId: s.id } });
    await prisma.classroomTeacher.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.classroom.deleteMany({ where: { schoolId: s.id } });
    await prisma.userRbacMeta.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { schoolId: s.id } });
    await prisma.schoolModuleEntitlement.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.school.delete({ where: { id: s.id } }).catch(() => undefined);
  }
}

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  assertLocalDatabase();
  await cleanup();

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const schoolA = await prisma.school.create({
    data: {
      id: `${PREFIX}a-${stamp}`,
      name: "Phase4 School A",
      email: `c4a-${stamp}@test.local`,
      lifecycleStatus: "ACTIVE",
    },
  });
  const schoolB = await prisma.school.create({
    data: {
      id: `${PREFIX}b-${stamp}`,
      name: "Phase4 School B",
      email: `c4b-${stamp}@test.local`,
      lifecycleStatus: "ACTIVE",
    },
  });
  await ensureSchoolModuleEntitlements(schoolA.id);
  await ensureSchoolModuleEntitlements(schoolB.id);

  const admin = await prisma.user.create({
    data: {
      id: `${PREFIX}admin-${stamp}`,
      schoolId: schoolA.id,
      email: `admin-${stamp}@c4.test`,
      passwordHash: "x",
      fullName: "Admin C4",
      role: "SCHOOL_ADMIN",
      isActive: true,
    },
  });
  await prisma.userRbacMeta.upsert({
    where: { userId: admin.id },
    create: { userId: admin.id, schoolId: schoolA.id, appRole: "Admin", permissions: {} },
    update: { appRole: "Admin" },
  });

  const owner = await prisma.user.create({
    data: {
      id: `${PREFIX}owner-${stamp}`,
      schoolId: schoolA.id,
      email: `owner-${stamp}@c4.test`,
      passwordHash: "x",
      fullName: "Owner C4",
      role: "SCHOOL_ADMIN",
      isActive: true,
    },
  });
  await prisma.userRbacMeta.upsert({
    where: { userId: owner.id },
    create: { userId: owner.id, schoolId: schoolA.id, appRole: "Owner", permissions: {} },
    update: { appRole: "Owner" },
  });

  const teacher = await prisma.user.create({
    data: {
      id: `${PREFIX}teach-${stamp}`,
      schoolId: schoolA.id,
      email: `teacher-${stamp}@c4.test`,
      passwordHash: "x",
      fullName: "Teacher C4",
      role: "STAFF",
      isActive: true,
    },
  });
  await prisma.userRbacMeta.upsert({
    where: { userId: teacher.id },
    create: {
      userId: teacher.id,
      schoolId: schoolA.id,
      appRole: "Teacher",
      permissions: TEACHER_COMMS,
    },
    update: { appRole: "Teacher", permissions: TEACHER_COMMS },
  });

  const finance = await prisma.user.create({
    data: {
      id: `${PREFIX}fin-${stamp}`,
      schoolId: schoolA.id,
      email: `finance-${stamp}@c4.test`,
      passwordHash: "x",
      fullName: "Finance C4",
      role: "FINANCE",
      isActive: true,
    },
  });
  await prisma.userRbacMeta.upsert({
    where: { userId: finance.id },
    create: { userId: finance.id, schoolId: schoolA.id, appRole: "Finance", permissions: {} },
    update: { appRole: "Finance" },
  });

  const roomA = await prisma.classroom.create({
    data: {
      schoolId: schoolA.id,
      name: "Grade 3A",
      teacherEmail: teacher.email,
      teacherName: "Teacher C4",
    },
  });
  await prisma.classroomTeacher.create({
    data: {
      schoolId: schoolA.id,
      classroomId: roomA.id,
      userId: teacher.id,
      teacherEmail: teacher.email,
      teacherName: "Teacher C4",
    },
  });
  await prisma.classroom.create({
    data: {
      schoolId: schoolA.id,
      name: "Grade 3B",
    },
  });
  await prisma.classroom.create({
    data: {
      schoolId: schoolA.id,
      name: "Grade 4B",
    },
  });

  const parentSelected = await prisma.parent.create({
    data: {
      id: `${PREFIX}psel-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Sel",
      surname: "Parent",
      email: `psel-${stamp}@c4.test`,
      cellNo: "0821000001",
      idNumber: `C4S${stamp}`.replace(/\W/g, "").slice(0, 13).padEnd(13, "0"),
    },
  });
  const parentUnselected = await prisma.parent.create({
    data: {
      id: `${PREFIX}pun-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Unsel",
      surname: "Parent",
      email: `pun-${stamp}@c4.test`,
      cellNo: "0821000002",
      idNumber: `C4U${stamp}`.replace(/\W/g, "").slice(0, 13).padEnd(13, "0"),
    },
  });
  const parentMulti = await prisma.parent.create({
    data: {
      id: `${PREFIX}pmulti-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Multi",
      surname: "Parent",
      email: `pmulti-${stamp}@c4.test`,
      cellNo: "0821000003",
      idNumber: `C4M${stamp}`.replace(/\W/g, "").slice(0, 13).padEnd(13, "0"),
    },
  });
  const parentOtherSchool = await prisma.parent.create({
    data: {
      id: `${PREFIX}poth-${stamp}`,
      schoolId: schoolB.id,
      firstName: "Other",
      surname: "School",
      email: `poth-${stamp}@c4.test`,
      cellNo: "0821000004",
      idNumber: `C4O${stamp}`.replace(/\W/g, "").slice(0, 13).padEnd(13, "0"),
    },
  });
  const parentOtherClass = await prisma.parent.create({
    data: {
      id: `${PREFIX}pxcls-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Other",
      surname: "Class",
      email: `pxcls-${stamp}@c4.test`,
      cellNo: "0821000005",
      idNumber: `C4X${stamp}`.replace(/\W/g, "").slice(0, 13).padEnd(13, "0"),
    },
  });

  const kid3A = await prisma.learner.create({
    data: {
      id: `${PREFIX}l3a-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Kid",
      lastName: "ThreeA",
      grade: "3",
      className: "Grade 3A",
      admissionNo: `C4A${stamp.slice(0, 6)}`,
      enrollmentStatus: "ACTIVE",
    },
  });
  const kid3A2 = await prisma.learner.create({
    data: {
      id: `${PREFIX}l3a2-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Kid",
      lastName: "ThreeA2",
      grade: "3",
      className: "Grade 3A",
      admissionNo: `C4A2${stamp.slice(0, 5)}`,
      enrollmentStatus: "ACTIVE",
    },
  });
  const kid3B = await prisma.learner.create({
    data: {
      id: `${PREFIX}l3b-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Kid",
      lastName: "ThreeB",
      grade: "3",
      className: "Grade 3B",
      admissionNo: `C4B${stamp.slice(0, 6)}`,
      enrollmentStatus: "ACTIVE",
    },
  });
  const kid4B = await prisma.learner.create({
    data: {
      id: `${PREFIX}l4b-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Kid",
      lastName: "FourB",
      grade: "4",
      className: "Grade 4B",
      admissionNo: `C4C${stamp.slice(0, 6)}`,
      enrollmentStatus: "ACTIVE",
    },
  });
  const kidB = await prisma.learner.create({
    data: {
      id: `${PREFIX}lb-${stamp}`,
      schoolId: schoolB.id,
      firstName: "Kid",
      lastName: "SchoolB",
      grade: "1",
      className: "Grade 1A",
      admissionNo: `C4D${stamp.slice(0, 6)}`,
      enrollmentStatus: "ACTIVE",
    },
  });

  await prisma.parentLearnerLink.create({
    data: {
      schoolId: schoolA.id,
      parentId: parentSelected.id,
      learnerId: kid3A.id,
      relation: "Mother",
      isPrimary: true,
    },
  });
  await prisma.parentLearnerLink.create({
    data: {
      schoolId: schoolA.id,
      parentId: parentUnselected.id,
      learnerId: kid3B.id,
      relation: "Father",
      isPrimary: true,
    },
  });
  // Multi-child parent: two kids in 3A
  await prisma.parentLearnerLink.create({
    data: {
      schoolId: schoolA.id,
      parentId: parentMulti.id,
      learnerId: kid3A.id,
      relation: "Guardian",
      isPrimary: false,
    },
  });
  await prisma.parentLearnerLink.create({
    data: {
      schoolId: schoolA.id,
      parentId: parentMulti.id,
      learnerId: kid3A2.id,
      relation: "Guardian",
      isPrimary: true,
    },
  });
  await prisma.parentLearnerLink.create({
    data: {
      schoolId: schoolA.id,
      parentId: parentOtherClass.id,
      learnerId: kid4B.id,
      relation: "Mother",
      isPrimary: true,
    },
  });
  await prisma.parentLearnerLink.create({
    data: {
      schoolId: schoolB.id,
      parentId: parentOtherSchool.id,
      learnerId: kidB.id,
      relation: "Mother",
      isPrimary: true,
    },
  });

  // Legacy school-wide published (null audienceParentIds)
  const legacyWide = await prisma.schoolNotice.create({
    data: {
      schoolId: schoolA.id,
      noticeType: "SCHOOL",
      title: "Legacy school-wide",
      body: "Visible to all parents in school A",
      isDraft: false,
      lifecycleStatus: "PUBLISHED",
      visibility: "CLASS_TEACHERS",
      createdBy: "legacy@c4.test",
    },
  });
  const legacyClass = await prisma.schoolNotice.create({
    data: {
      schoolId: schoolA.id,
      noticeType: "CLASS",
      title: "Legacy class 3A",
      body: "Visible to 3A only",
      className: "Grade 3A",
      isDraft: false,
      lifecycleStatus: "PUBLISHED",
      visibility: "CLASS_TEACHERS",
      createdBy: "legacy@c4.test",
    },
  });
  const legacyDraft = await prisma.schoolNotice.create({
    data: {
      schoolId: schoolA.id,
      noticeType: "SCHOOL",
      title: "Legacy draft",
      body: "Must stay hidden",
      isDraft: true,
      lifecycleStatus: "DRAFT",
      visibility: "CLASS_TEACHERS",
      createdBy: "legacy@c4.test",
    },
  });
  const legacyArchived = await prisma.schoolNotice.create({
    data: {
      schoolId: schoolA.id,
      noticeType: "SCHOOL",
      title: "Legacy archived",
      body: "Must stay hidden",
      isDraft: false,
      lifecycleStatus: "ARCHIVED",
      archivedAt: new Date(),
      visibility: "CLASS_TEACHERS",
      createdBy: "legacy@c4.test",
    },
  });

  const adminTok = bearer({
    id: admin.id,
    schoolId: schoolA.id,
    email: admin.email,
    role: "SCHOOL_ADMIN",
  });
  const ownerTok = bearer({
    id: owner.id,
    schoolId: schoolA.id,
    email: owner.email,
    role: "SCHOOL_ADMIN",
  });
  const teacherTok = bearer({
    id: teacher.id,
    schoolId: schoolA.id,
    email: teacher.email,
    role: "STAFF",
  });
  const financeTok = bearer({
    id: finance.id,
    schoolId: schoolA.id,
    email: finance.email,
    role: "FINANCE",
  });
  const parentSelTok = signParentToken({
    parentId: parentSelected.id,
    schoolId: schoolA.id,
    idNumber: parentSelected.idNumber || undefined,
  });
  const parentUnselTok = signParentToken({
    parentId: parentUnselected.id,
    schoolId: schoolA.id,
    idNumber: parentUnselected.idNumber || undefined,
  });
  const parentMultiTok = signParentToken({
    parentId: parentMulti.id,
    schoolId: schoolA.id,
    idNumber: parentMulti.idNumber || undefined,
  });
  const parentOtherSchoolTok = signParentToken({
    parentId: parentOtherSchool.id,
    schoolId: schoolB.id,
    idNumber: parentOtherSchool.idNumber || undefined,
  });

  // Probe
  {
    const probe = await json(`/api/school-announcements?schoolId=${encodeURIComponent(schoolA.id)}`, {
      headers: { Authorization: adminTok },
    });
    assert.ok(
      [200, 401, 403].includes(probe.status),
      `API not reachable at ${API} (status ${probe.status}) — start local backend first`
    );
    assert.equal(probe.status, 200, `admin list failed: ${JSON.stringify(probe.body)}`);
  }

  // --- Preview permissions ---
  {
    const adminPreview = await json("/api/school-announcements/preview", {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        audienceMode: "all_parents",
      }),
    });
    assert.equal(adminPreview.status, 200, JSON.stringify(adminPreview.body));
    assert.ok(adminPreview.body.uniqueParentCount >= 4, "school-wide preview counts parents");

    const financePreview = await json("/api/school-announcements/preview", {
      method: "POST",
      headers: { Authorization: financeTok },
      body: JSON.stringify({ schoolId: schoolA.id, audienceMode: "all_parents" }),
    });
    assert.equal(financePreview.status, 403, "finance cannot preview");

    const teacherAll = await json("/api/school-announcements/preview", {
      method: "POST",
      headers: { Authorization: teacherTok },
      body: JSON.stringify({ schoolId: schoolA.id, audienceMode: "all_parents" }),
    });
    assert.equal(teacherAll.status, 403, "teacher cannot preview all parents");

    const teacherGrade = await json("/api/school-announcements/preview", {
      method: "POST",
      headers: { Authorization: teacherTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        audienceMode: "by_class",
        classScope: "grade",
        grade: "3",
      }),
    });
    assert.equal(teacherGrade.status, 403, "teacher cannot preview entire grade");

    const teacherClassOk = await json("/api/school-announcements/preview", {
      method: "POST",
      headers: { Authorization: teacherTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        audienceMode: "by_class",
        classScope: "classroom",
        className: "Grade 3A",
      }),
    });
    assert.equal(teacherClassOk.status, 200, JSON.stringify(teacherClassOk.body));
    assert.equal(teacherClassOk.body.uniqueParentCount, 2, "3A parents: selected + multi");

    const teacherWrongClass = await json("/api/school-announcements/preview", {
      method: "POST",
      headers: { Authorization: teacherTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        audienceMode: "by_class",
        classScope: "classroom",
        className: "Grade 4B",
      }),
    });
    assert.equal(teacherWrongClass.status, 403, "teacher cannot preview unassigned class");
    console.log("✓ Preview permissions (admin/teacher/finance)");
  }

  // --- Empty / forged individual lists ---
  {
    const empty = await json("/api/school-announcements/preview", {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        audienceMode: "individual",
        parentIds: [],
      }),
    });
    assert.equal(empty.status, 400, "empty individual rejected");

    const forged = await json("/api/school-announcements/preview", {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        audienceMode: "individual",
        parentIds: [parentOtherSchool.id],
      }),
    });
    assert.equal(forged.status, 400, "cross-school parent rejected at preview");

    const teacherCrossClass = await json("/api/school-announcements/preview", {
      method: "POST",
      headers: { Authorization: teacherTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        audienceMode: "individual",
        parentIds: [parentOtherClass.id],
      }),
    });
    assert.equal(teacherCrossClass.status, 403, "teacher cannot target parent outside assigned class");

    const createEmpty = await json("/api/school-announcements", {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        title: "Empty individual",
        body: "nope",
        audienceMode: "individual",
        parentIds: [],
        publishNow: true,
      }),
    });
    assert.equal(createEmpty.status, 400, "empty individual create rejected");
    console.log("✓ Empty/forged individual recipient lists rejected");
  }

  // --- Admin school-wide + grade + classroom publish ---
  {
    const widePreview = await json("/api/school-announcements/preview", {
      method: "POST",
      headers: { Authorization: ownerTok },
      body: JSON.stringify({ schoolId: schoolA.id, audienceMode: "all_parents" }),
    });
    assert.equal(widePreview.status, 200);
    const wideCount = widePreview.body.uniqueParentCount as number;

    const widePub = await json("/api/school-announcements", {
      method: "POST",
      headers: { Authorization: ownerTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        title: "Owner school-wide",
        body: "All parents",
        audienceMode: "all_parents",
        publishNow: true,
      }),
    });
    assert.equal(widePub.status, 200, JSON.stringify(widePub.body));
    const wideId = widePub.body.notice.id as string;
    assert.equal(widePub.body.notice.lifecycleStatus, "PUBLISHED");
    assert.equal(widePub.body.notice.audienceParentIds, null);

    const wideNotifs = await prisma.parentNotification.count({
      where: {
        schoolId: schoolA.id,
        metadata: { path: ["noticeId"], equals: wideId },
      },
    });
    assert.equal(wideNotifs, wideCount, "school-wide fan-out matches preview");

    const gradePreview = await json("/api/school-announcements/preview", {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        audienceMode: "by_class",
        classScope: "grade",
        grade: "3",
      }),
    });
    assert.equal(gradePreview.status, 200);
    const gradeCount = gradePreview.body.uniqueParentCount as number;
    assert.ok(gradeCount >= 3, "grade 3 includes 3A+3B parents");

    const gradePub = await json("/api/school-announcements", {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        title: "Admin grade 3",
        body: "Grade targeting",
        audienceMode: "by_class",
        classScope: "grade",
        grade: "3",
        publishNow: true,
      }),
    });
    assert.equal(gradePub.status, 200, JSON.stringify(gradePub.body));
    const gradeId = gradePub.body.notice.id as string;
    assert.equal(gradePub.body.notice.grade, "3");
    assert.equal(
      await prisma.parentNotification.count({
        where: { schoolId: schoolA.id, metadata: { path: ["noticeId"], equals: gradeId } },
      }),
      gradeCount,
      "grade fan-out matches preview"
    );

    const classPreview = await json("/api/school-announcements/preview", {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        audienceMode: "by_class",
        classScope: "classroom",
        className: "Grade 3A",
      }),
    });
    assert.equal(classPreview.status, 200);
    const classCount = classPreview.body.uniqueParentCount as number;

    const classPub = await json("/api/school-announcements", {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        title: "Admin class 3A",
        body: "Classroom targeting",
        audienceMode: "by_class",
        classScope: "classroom",
        className: "Grade 3A",
        publishNow: true,
      }),
    });
    assert.equal(classPub.status, 200, JSON.stringify(classPub.body));
    assert.equal(
      await prisma.parentNotification.count({
        where: {
          schoolId: schoolA.id,
          metadata: { path: ["noticeId"], equals: classPub.body.notice.id },
        },
      }),
      classCount,
      "classroom fan-out matches preview"
    );
    console.log("✓ Admin/Owner school-wide, grade, classroom publish + preview≡fan-out");
  }

  // --- Teacher: assigned classroom only ---
  {
    const teacherAll = await json("/api/school-announcements", {
      method: "POST",
      headers: { Authorization: teacherTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        title: "Teacher all attempt",
        body: "nope",
        audienceMode: "all_parents",
        publishNow: true,
      }),
    });
    assert.equal(teacherAll.status, 403, "teacher cannot publish school-wide");

    const teacherGrade = await json("/api/school-announcements", {
      method: "POST",
      headers: { Authorization: teacherTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        title: "Teacher grade attempt",
        body: "nope",
        audienceMode: "by_class",
        classScope: "grade",
        grade: "3",
        publishNow: true,
      }),
    });
    assert.equal(teacherGrade.status, 403, "teacher cannot publish entire grade");

    const teacherWrong = await json("/api/school-announcements", {
      method: "POST",
      headers: { Authorization: teacherTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        title: "Teacher wrong class",
        body: "nope",
        audienceMode: "by_class",
        classScope: "classroom",
        className: "Grade 4B",
        publishNow: true,
      }),
    });
    assert.equal(teacherWrong.status, 403, "teacher cannot publish unassigned class");

    const teacherOkPreview = await json("/api/school-announcements/preview", {
      method: "POST",
      headers: { Authorization: teacherTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        audienceMode: "by_class",
        classScope: "classroom",
        className: "Grade 3A",
      }),
    });
    assert.equal(teacherOkPreview.status, 200);
    const tCount = teacherOkPreview.body.uniqueParentCount as number;

    const teacherOk = await json("/api/school-announcements", {
      method: "POST",
      headers: { Authorization: teacherTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        title: "Teacher 3A ok",
        body: "Assigned class",
        audienceMode: "by_class",
        classScope: "classroom",
        className: "Grade 3A",
        publishNow: true,
      }),
    });
    assert.equal(teacherOk.status, 200, JSON.stringify(teacherOk.body));
    assert.equal(
      await prisma.parentNotification.count({
        where: {
          schoolId: schoolA.id,
          metadata: { path: ["noticeId"], equals: teacherOk.body.notice.id },
        },
      }),
      tCount,
      "teacher classroom fan-out matches preview"
    );
    console.log("✓ Teacher restricted to assigned classrooms");
  }

  // --- Individual targeting + Parent Portal visibility ---
  let individualId = "";
  {
    const preview = await json("/api/school-announcements/preview", {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        audienceMode: "individual",
        parentIds: [parentSelected.id, parentMulti.id],
      }),
    });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.uniqueParentCount, 2, "preview unique parents");
    assert.equal(preview.body.mode, "individual");

    // Audience change after preview — publish uses request body, not cached preview;
    // FE clears confirmation; backend re-resolves from publish payload.
    const changedPreview = await json("/api/school-announcements/preview", {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        audienceMode: "individual",
        parentIds: [parentSelected.id],
      }),
    });
    assert.equal(changedPreview.status, 200);
    assert.equal(changedPreview.body.uniqueParentCount, 1, "changed audience invalidates prior count");

    const pub = await json("/api/school-announcements", {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        title: "Individual only",
        body: "Selected parents only",
        audienceMode: "individual",
        parentIds: [parentSelected.id, parentMulti.id],
        publishNow: true,
      }),
    });
    assert.equal(pub.status, 200, JSON.stringify(pub.body));
    individualId = pub.body.notice.id as string;
    const stored = await prisma.schoolNotice.findUnique({ where: { id: individualId } });
    assert.ok(Array.isArray(stored?.audienceParentIds), "audienceParentIds persisted as array");
    const ids = stored!.audienceParentIds as string[];
    assert.ok(ids.includes(parentSelected.id) && ids.includes(parentMulti.id));
    assert.equal(stored!.grade, null);
    assert.equal(stored!.className, null);

    const notifs = await prisma.parentNotification.findMany({
      where: {
        schoolId: schoolA.id,
        metadata: { path: ["noticeId"], equals: individualId },
      },
    });
    assert.equal(notifs.length, 2, "exactly two ParentNotifications (preview≡fan-out)");
    const notifParents = new Set(notifs.map((n) => n.parentId));
    assert.ok(notifParents.has(parentSelected.id));
    assert.ok(notifParents.has(parentMulti.id));
    assert.ok(!notifParents.has(parentUnselected.id));
    assert.ok(!notifParents.has(parentOtherSchool.id));

    // Multi-child: one notification only
    const multiNotifs = notifs.filter((n) => n.parentId === parentMulti.id);
    assert.equal(multiNotifs.length, 1, "multi-child parent gets one notification");

    // No push deliveries (no subscriptions on synthetic parents)
    const pushCount = await prisma.parentPushDelivery.count({
      where: {
        parentNotificationId: { in: notifs.map((n) => n.id) },
      },
    });
    assert.equal(pushCount, 0, "no Web Push deliveries without subscriptions");

    // Parent portal notices
    const selNotices = await json(
      `/api/parent-portal/notices?learnerId=${encodeURIComponent(kid3A.id)}&limit=50`,
      { headers: { Authorization: `Bearer ${parentSelTok}` } }
    );
    assert.equal(selNotices.status, 200, JSON.stringify(selNotices.body));
    const selIds = (selNotices.body.notices || []).map((n: { id: string }) => n.id);
    assert.ok(selIds.includes(individualId), "selected parent sees individual notice");
    assert.ok(selIds.includes(legacyWide.id), "school-wide still visible");
    assert.ok(selIds.includes(legacyClass.id), "class notice still visible");
    assert.ok(!selIds.includes(legacyDraft.id), "draft hidden");
    assert.ok(!selIds.includes(legacyArchived.id), "archived hidden");

    const unselNotices = await json(
      `/api/parent-portal/notices?learnerId=${encodeURIComponent(kid3B.id)}&limit=50`,
      { headers: { Authorization: `Bearer ${parentUnselTok}` } }
    );
    assert.equal(unselNotices.status, 200);
    const unselIds = (unselNotices.body.notices || []).map((n: { id: string }) => n.id);
    assert.ok(!unselIds.includes(individualId), "unselected parent cannot see individual notice");
    assert.ok(unselIds.includes(legacyWide.id), "unselected still sees school-wide");
    assert.ok(!unselIds.includes(legacyClass.id), "3B parent does not see 3A class notice");

    const multiNotices = await json(
      `/api/parent-portal/notices?learnerId=${encodeURIComponent(kid3A2.id)}&limit=50`,
      { headers: { Authorization: `Bearer ${parentMultiTok}` } }
    );
    assert.equal(multiNotices.status, 200);
    const multiIds = (multiNotices.body.notices || []).map((n: { id: string }) => n.id);
    assert.ok(multiIds.includes(individualId), "multi-child parent sees individual notice");

    const otherSchoolNotices = await json(
      `/api/parent-portal/notices?learnerId=${encodeURIComponent(kidB.id)}&limit=50`,
      { headers: { Authorization: `Bearer ${parentOtherSchoolTok}` } }
    );
    assert.equal(otherSchoolNotices.status, 200);
    const otherIds = (otherSchoolNotices.body.notices || []).map((n: { id: string }) => n.id);
    assert.ok(!otherIds.includes(individualId), "other-school parent cannot see notice");
    assert.ok(!otherIds.includes(legacyWide.id), "other-school cannot see school A notices");

    // Dashboard vs notices agreement (selected parent)
    const dash = await json(
      `/api/parent-portal/dashboard?learnerId=${encodeURIComponent(kid3A.id)}`,
      { headers: { Authorization: `Bearer ${parentSelTok}` } }
    );
    assert.equal(dash.status, 200, JSON.stringify(dash.body));
    const dashNoticeIds = (dash.body.notices || []).map((n: { id: string }) => n.id);
    assert.ok(dashNoticeIds.includes(individualId), "dashboard shows individual notice to selected parent");
    assert.ok(dashNoticeIds.includes(legacyWide.id), "dashboard shows school-wide");
    assert.ok(!dashNoticeIds.includes(legacyDraft.id), "dashboard hides draft");
    assert.ok(
      selIds.includes(individualId) && dashNoticeIds.includes(individualId),
      "dashboard and notices list agree on individual visibility"
    );

    const dashUnsel = await json(
      `/api/parent-portal/dashboard?learnerId=${encodeURIComponent(kid3B.id)}`,
      { headers: { Authorization: `Bearer ${parentUnselTok}` } }
    );
    assert.equal(dashUnsel.status, 200);
    const dashUnselIds = (dashUnsel.body.notices || []).map((n: { id: string }) => n.id);
    assert.ok(!dashUnselIds.includes(individualId), "dashboard hides individual from unselected parent");
    console.log("✓ Individual targeting + Parent Portal visibility + multi-child dedupe");
  }

  // --- Malformed audience never becomes school-wide ---
  {
    const malformed = await prisma.schoolNotice.create({
      data: {
        schoolId: schoolA.id,
        noticeType: "SCHOOL",
        title: "Malformed audience",
        body: "Must be invisible to all parents",
        audienceParentIds: [],
        isDraft: false,
        lifecycleStatus: "PUBLISHED",
        visibility: "CLASS_TEACHERS",
        createdBy: "malformed@c4.test",
      },
    });
    const selSee = await json(
      `/api/parent-portal/notices?learnerId=${encodeURIComponent(kid3A.id)}&limit=50`,
      { headers: { Authorization: `Bearer ${parentSelTok}` } }
    );
    const ids = (selSee.body.notices || []).map((n: { id: string }) => n.id);
    assert.ok(!ids.includes(malformed.id), "empty audienceParentIds never school-wide");

    const objectMalformed = await prisma.schoolNotice.create({
      data: {
        schoolId: schoolA.id,
        noticeType: "SCHOOL",
        title: "Object audience",
        body: "Must be invisible",
        audienceParentIds: { forged: true } as any,
        isDraft: false,
        lifecycleStatus: "PUBLISHED",
        visibility: "CLASS_TEACHERS",
        createdBy: "malformed@c4.test",
      },
    });
    const selSee2 = await json(
      `/api/parent-portal/notices?learnerId=${encodeURIComponent(kid3A.id)}&limit=50`,
      { headers: { Authorization: `Bearer ${parentSelTok}` } }
    );
    const ids2 = (selSee2.body.notices || []).map((n: { id: string }) => n.id);
    assert.ok(!ids2.includes(objectMalformed.id), "non-array audienceParentIds never school-wide");
    console.log("✓ Malformed/empty audienceParentIds never expand to school-wide");
  }

  // --- Migration / legacy column safety ---
  {
    const legacyReload = await prisma.schoolNotice.findUnique({ where: { id: legacyWide.id } });
    assert.ok(legacyReload);
    assert.equal(legacyReload!.audienceParentIds, null, "legacy notices retain null audienceParentIds");
    assert.equal(legacyReload!.lifecycleStatus, "PUBLISHED");
    assert.equal(legacyReload!.title, "Legacy school-wide");

    // Billing untouched: this suite never opens billing files or payment allocation tables.
    const familyCount = await prisma.familyAccount.count({ where: { schoolId: schoolA.id } });
    assert.equal(familyCount, 0, "no family-account records created for fixture school");
    console.log("✓ Migration/legacy notice integrity; no billing side-effects");
  }

  // --- Draft individual unpublished hidden ---
  {
    const draftInd = await json("/api/school-announcements", {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        title: "Draft individual",
        body: "Hidden until publish",
        audienceMode: "individual",
        parentIds: [parentSelected.id],
        publishNow: false,
      }),
    });
    assert.equal(draftInd.status, 200, JSON.stringify(draftInd.body));
    const draftId = draftInd.body.notice.id as string;
    assert.equal(draftInd.body.notice.lifecycleStatus, "DRAFT");
    assert.equal(
      await prisma.parentNotification.count({
        where: { schoolId: schoolA.id, metadata: { path: ["noticeId"], equals: draftId } },
      }),
      0,
      "draft does not notify"
    );
    const sel = await json(
      `/api/parent-portal/notices?learnerId=${encodeURIComponent(kid3A.id)}&limit=50`,
      { headers: { Authorization: `Bearer ${parentSelTok}` } }
    );
    const ids = (sel.body.notices || []).map((n: { id: string }) => n.id);
    assert.ok(!ids.includes(draftId), "draft individual hidden from parent");

    // Publish after draft — recheck audience
    const pub = await json(`/api/school-announcements/${draftId}/publish`, {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({ schoolId: schoolA.id }),
    });
    assert.equal(pub.status, 200, JSON.stringify(pub.body));
    assert.equal(
      await prisma.parentNotification.count({
        where: { schoolId: schoolA.id, metadata: { path: ["noticeId"], equals: draftId } },
      }),
      1,
      "publish fan-out one selected parent"
    );
    console.log("✓ Draft individual hidden; publish rechecks audience");
  }

  // --- Parents search RBAC ---
  {
    const adminSearch = await json(
      `/api/school-announcements/parents/search?schoolId=${encodeURIComponent(schoolA.id)}&q=Sel`,
      { headers: { Authorization: adminTok } }
    );
    assert.equal(adminSearch.status, 200, JSON.stringify(adminSearch.body));
    assert.ok((adminSearch.body.parents || adminSearch.body.items || []).length >= 1);

    const financeSearch = await json(
      `/api/school-announcements/parents/search?schoolId=${encodeURIComponent(schoolA.id)}&q=Sel`,
      { headers: { Authorization: financeTok } }
    );
    assert.equal(financeSearch.status, 403, "finance cannot search parents for announcements");
    console.log("✓ Parents search requires communications permission");
  }

  await cleanup();
  console.log("✓ Phase 4 announcement audience HTTP security suite PASSED");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  });
