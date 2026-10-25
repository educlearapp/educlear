/**
 * Communications Phase 0 — draft visibility, parent content completeness, notification dedupe.
 * SAFE TARGET: localhost PostgreSQL only. Synthetic fixtures cleaned after run.
 * Does not send SMS/email/push or touch billing ledgers.
 *
 * Run: npx tsx src/routes/parentPortal.communications.phase0.security.test.ts
 */
import assert from "assert";
import { PrismaClient } from "@prisma/client";

import {
  createParentNotification,
  uniqueParentLearnerLinks,
} from "../services/parentPortalService";
import { ensureSchoolModuleEntitlements } from "../services/schoolModuleEntitlements";
import { signParentToken } from "../middleware/parentAuth";
import {
  isParentPublishedContent,
  parentPublishedHomeworkOrNoticeWhere,
  shouldNotifyParents,
} from "../utils/teacherVisibility";

const prisma = new PrismaClient();
const PREFIX = "pp20c0-";
const API = process.env.PP20_C0_API_BASE || "http://127.0.0.1:3000";

function assertLocalDatabase() {
  const url = String(process.env.DATABASE_URL || "");
  assert.ok(url, "DATABASE_URL required");
  let host = "";
  try {
    host = new URL(url.replace(/^postgresql:/, "http:")).hostname;
  } catch {
    host = "";
  }
  assert.ok(
    host === "localhost" || host === "127.0.0.1",
    `Refusing Phase 0 tests against non-local host: ${host || "(unknown)"}`
  );
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
      await prisma.parentNotification.deleteMany({ where: { parentId: p.id } });
      await prisma.communicationMessage.deleteMany({ where: { parentId: p.id } }).catch(() => undefined);
      await prisma.parentOnboarding.deleteMany({ where: { parentId: p.id } }).catch(() => undefined);
      await prisma.parentTeacherMessage.deleteMany({
        where: { thread: { parentId: p.id } },
      }).catch(() => undefined);
      await prisma.parentTeacherThread.deleteMany({ where: { parentId: p.id } });
      await prisma.parentLearnerLink.deleteMany({ where: { parentId: p.id } });
    }
    await prisma.homeworkPost.deleteMany({ where: { schoolId: s.id } });
    await prisma.schoolNotice.deleteMany({ where: { schoolId: s.id } });
    await prisma.parentDocument.deleteMany({ where: { schoolId: s.id } });
    await prisma.learnerIncident.deleteMany({ where: { schoolId: s.id } });
    await prisma.parentLearnerLink.deleteMany({ where: { schoolId: s.id } });
    await prisma.parent.deleteMany({ where: { schoolId: s.id } });
    await prisma.learner.deleteMany({ where: { schoolId: s.id } });
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

  assert.equal(shouldNotifyParents("CLASS_TEACHERS", true), false);
  assert.equal(shouldNotifyParents("PRIVATE", false), false);
  assert.equal(shouldNotifyParents("CLASS_TEACHERS", false), true);
  assert.equal(
    isParentPublishedContent({ isDraft: true, visibility: "CLASS_TEACHERS", hasDraftField: true }),
    false
  );
  assert.equal(
    isParentPublishedContent({ isDraft: false, visibility: "PRIVATE", hasDraftField: true }),
    false
  );
  console.log("✓ Publishing helpers: drafts and PRIVATE excluded from parent gate");

  const schoolA = await prisma.school.create({
    data: {
      id: `${PREFIX}A-${Date.now()}`,
      name: "PP20 Comm Phase0 School A",
      email: `${PREFIX}a@c0.test`,
      lifecycleStatus: "ACTIVE",
    },
  });
  const schoolB = await prisma.school.create({
    data: {
      id: `${PREFIX}B-${Date.now()}`,
      name: "PP20 Comm Phase0 School B",
      email: `${PREFIX}b@c0.test`,
      lifecycleStatus: "ACTIVE",
    },
  });
  await ensureSchoolModuleEntitlements(schoolA.id);
  await ensureSchoolModuleEntitlements(schoolB.id);

  const idNumber = `C0A${Date.now()}`.slice(0, 13);
  const cellNo = "0829000400";
  const parent = await prisma.parent.create({
    data: {
      id: `${schoolA.id}-parent`,
      schoolId: schoolA.id,
      firstName: "Comm",
      surname: "Parent",
      cellNo,
      idNumber,
      email: "comm.parent@c0.test",
    },
  });

  const kids: Array<{ id: string; grade: string; className: string }> = [];
  for (const tag of ["1", "2", "3", "4", "5"]) {
    const learner = await prisma.learner.create({
      data: {
        id: `${schoolA.id}-L${tag}`,
        schoolId: schoolA.id,
        firstName: `Kid${tag}`,
        lastName: "Comm",
        grade: tag === "5" ? "2" : "1",
        className: tag === "5" ? "B" : "A",
        admissionNo: `C0${tag}`,
      },
    });
    kids.push(learner);
    await prisma.parentLearnerLink.create({
      data: {
        schoolId: schoolA.id,
        parentId: parent.id,
        learnerId: learner.id,
        relation: "Mother",
        isPrimary: tag === "1",
      },
    });
  }

  // Kids 1 and 2 share class A / grade 1 — used for dedupe case.
  assert.equal(kids[0].className, "A");
  assert.equal(kids[1].className, "A");

  const draftNotice = await prisma.schoolNotice.create({
    data: {
      schoolId: schoolA.id,
      noticeType: "SCHOOL",
      title: "DRAFT only",
      body: "Should never reach parent",
      isDraft: true,
      visibility: "CLASS_TEACHERS",
      createdBy: "teacher@c0.test",
    },
  });
  const privateNotice = await prisma.schoolNotice.create({
    data: {
      schoolId: schoolA.id,
      noticeType: "CLASS",
      title: "PRIVATE notice",
      body: "Teacher private",
      className: "A",
      isDraft: false,
      visibility: "PRIVATE",
      createdBy: "teacher@c0.test",
    },
  });
  const publishedSchoolWide = await prisma.schoolNotice.create({
    data: {
      schoolId: schoolA.id,
      noticeType: "SCHOOL",
      title: "School-wide published",
      body: "Hello all parents",
      isDraft: false,
      visibility: "CLASS_TEACHERS",
      createdBy: "admin@c0.test",
    },
  });
  const publishedClassA = await prisma.schoolNotice.create({
    data: {
      schoolId: schoolA.id,
      noticeType: "CLASS",
      title: "Class A notice",
      body: "For class A",
      className: "A",
      isDraft: false,
      visibility: "CLASS_TEACHERS",
      createdBy: "teacher@c0.test",
    },
  });
  const publishedGrade2 = await prisma.schoolNotice.create({
    data: {
      schoolId: schoolA.id,
      noticeType: "GRADE",
      title: "Grade 2 notice",
      body: "For grade 2",
      grade: "2",
      isDraft: false,
      visibility: "CLASS_TEACHERS",
      createdBy: "teacher@c0.test",
    },
  });
  const foreignNotice = await prisma.schoolNotice.create({
    data: {
      schoolId: schoolB.id,
      noticeType: "SCHOOL",
      title: "Foreign school notice",
      body: "Other school",
      isDraft: false,
      visibility: "CLASS_TEACHERS",
      createdBy: "other@c0.test",
    },
  });

  const publishedWhere = parentPublishedHomeworkOrNoticeWhere();
  const visibleRows = await prisma.schoolNotice.findMany({
    where: { schoolId: schoolA.id, ...publishedWhere },
  });
  const visibleIds = visibleRows.map((n) => n.id);
  assert.ok(!visibleIds.includes(draftNotice.id), "draft excluded by parentPublished where");
  assert.ok(!visibleIds.includes(privateNotice.id), "PRIVATE excluded by parentPublished where");
  assert.ok(visibleIds.includes(publishedSchoolWide.id), "published school-wide included");
  assert.ok(!visibleIds.includes(foreignNotice.id), "cross-school excluded by schoolId");
  console.log("✓ Draft / PRIVATE / cross-school notices excluded from parent publish filter");

  // Multi-child fan-out dedupe for class A notice
  const classLinks = await prisma.parentLearnerLink.findMany({
    where: {
      schoolId: schoolA.id,
      parentId: parent.id,
      learner: { className: "A" },
    },
    select: { parentId: true, learnerId: true },
  });
  assert.ok(classLinks.length >= 2, "parent has ≥2 class A children");
  const unique = uniqueParentLearnerLinks(classLinks);
  assert.equal(unique.length, 1, "uniqueParentLearnerLinks collapses multi-child to one parent");

  for (const link of classLinks) {
    await createParentNotification({
      schoolId: schoolA.id,
      parentId: link.parentId,
      learnerId: link.learnerId,
      type: "SCHOOL_NOTICE",
      title: publishedClassA.title,
      message: publishedClassA.body,
      metadata: { noticeId: publishedClassA.id, className: "A" },
    });
  }
  const classAlerts = await prisma.parentNotification.findMany({
    where: {
      schoolId: schoolA.id,
      parentId: parent.id,
      metadata: { path: ["noticeId"], equals: publishedClassA.id },
    },
  });
  assert.equal(classAlerts.length, 1, "two children in same class → one announcement alert");
  console.log("✓ Multi-child class announcement: single parent notification");

  // Distinct learner-specific incidents remain distinct
  const inc1 = await prisma.learnerIncident.create({
    data: {
      schoolId: schoolA.id,
      learnerId: kids[0].id,
      type: "MEDIUM",
      subject: "Incident kid1",
      summary: "First",
      parentVisible: true,
      visibility: "CLASS_TEACHERS",
      createdBy: "teacher@c0.test",
    },
  });
  const inc2 = await prisma.learnerIncident.create({
    data: {
      schoolId: schoolA.id,
      learnerId: kids[1].id,
      type: "MEDIUM",
      subject: "Incident kid2",
      summary: "Second",
      parentVisible: true,
      visibility: "CLASS_TEACHERS",
      createdBy: "teacher@c0.test",
    },
  });
  await createParentNotification({
    schoolId: schoolA.id,
    parentId: parent.id,
    learnerId: kids[0].id,
    type: "INCIDENT",
    title: "Incident recorded",
    message: inc1.summary,
    metadata: { incidentId: inc1.id },
  });
  await createParentNotification({
    schoolId: schoolA.id,
    parentId: parent.id,
    learnerId: kids[1].id,
    type: "INCIDENT",
    title: "Incident recorded",
    message: inc2.summary,
    metadata: { incidentId: inc2.id },
  });
  const incidentAlerts = await prisma.parentNotification.findMany({
    where: {
      schoolId: schoolA.id,
      parentId: parent.id,
      type: "INCIDENT",
    },
  });
  assert.equal(incidentAlerts.length, 2, "distinct child incidents stay distinct");
  console.log("✓ Distinct learner incidents produce distinct alerts");

  // Read-state preserved on dedupe re-entry
  const first = classAlerts[0];
  await prisma.parentNotification.update({
    where: { id: first.id },
    data: { isRead: true, readAt: new Date() },
  });
  const again = await createParentNotification({
    schoolId: schoolA.id,
    parentId: parent.id,
    learnerId: kids[1].id,
    type: "SCHOOL_NOTICE",
    title: publishedClassA.title,
    message: "retry",
    metadata: { noticeId: publishedClassA.id },
  });
  assert.equal(again.id, first.id, "dedupe returns existing notification");
  assert.equal(again.isRead, true, "read state preserved on dedupe");
  console.log("✓ Notification read state preserved across dedupe");

  // Parents with 1 / 2 / 3 / 5 children — progressive unique collapse
  for (const n of [1, 2, 3, 5]) {
    const subset = kids.slice(0, n).map((k) => ({
      parentId: parent.id,
      learnerId: k.id,
    }));
    assert.equal(uniqueParentLearnerLinks(subset).length, 1);
  }
  console.log("✓ Unique parent collapse stable for 1, 2, 3 and 5 children");

  // Teacher message path unaffected (no noticeId/homeworkId dedupe)
  const thread = await prisma.parentTeacherThread.create({
    data: {
      schoolId: schoolA.id,
      parentId: parent.id,
      learnerId: kids[0].id,
      teacherName: "Ms Teacher",
      teacherEmail: "teacher@c0.test",
    },
  });
  const msg1 = await createParentNotification({
    schoolId: schoolA.id,
    parentId: parent.id,
    learnerId: kids[0].id,
    type: "TEACHER_MESSAGE",
    title: "New message from teacher",
    message: "Hello one",
    metadata: { threadId: thread.id },
  });
  const msg2 = await createParentNotification({
    schoolId: schoolA.id,
    parentId: parent.id,
    learnerId: kids[0].id,
    type: "TEACHER_MESSAGE",
    title: "New message from teacher",
    message: "Hello two",
    metadata: { threadId: thread.id },
  });
  assert.notEqual(msg1.id, msg2.id, "teacher messages are not collapsed by threadId");
  console.log("✓ Parent-teacher message notifications remain distinct");

  // Live HTTP checks when API is up
  let apiReachable = false;
  try {
    const ping = await fetch(`${API}/api/public/schools`);
    apiReachable = ping.ok;
  } catch {
    apiReachable = false;
  }

  if (apiReachable) {
    const token = signParentToken({
      parentId: parent.id,
      schoolId: schoolA.id,
      idNumber,
    });
    const auth = { Authorization: `Bearer ${token}` };
    const dash = await json(
      `/api/parent-portal/dashboard?learnerId=${encodeURIComponent(kids[0].id)}`,
      { headers: auth }
    );
    assert.equal(dash.status, 200, `dashboard ${dash.status}`);
    const dashNotices = Array.isArray(dash.body?.notices) ? dash.body.notices : [];
    const dashIds = dashNotices.map((n: { id: string }) => n.id);
    assert.ok(!dashIds.includes(draftNotice.id), "dashboard excludes draft notice");
    assert.ok(!dashIds.includes(privateNotice.id), "dashboard excludes PRIVATE notice");
    assert.ok(dashIds.includes(publishedSchoolWide.id), "dashboard includes school-wide published");
    assert.ok(dashIds.includes(publishedClassA.id), "dashboard includes class A notice for kid1");
    assert.ok(!dashIds.includes(foreignNotice.id), "dashboard excludes other school");

    const noticesList = await json(
      `/api/parent-portal/notices?learnerId=${encodeURIComponent(kids[0].id)}&limit=50`,
      { headers: auth }
    );
    assert.equal(noticesList.status, 200);
    const listIds = (noticesList.body?.notices || []).map((n: { id: string }) => n.id);
    assert.ok(listIds.includes(publishedSchoolWide.id));
    assert.ok(!listIds.includes(draftNotice.id));

    const gradeDash = await json(
      `/api/parent-portal/dashboard?learnerId=${encodeURIComponent(kids[4].id)}`,
      { headers: auth }
    );
    const gradeIds = (gradeDash.body?.notices || []).map((n: { id: string }) => n.id);
    assert.ok(gradeIds.includes(publishedGrade2.id), "grade targeting reaches grade-2 child");
    assert.ok(
      !gradeIds.includes(publishedClassA.id) || kids[4].className === "A",
      "class A notice not forced onto class B child"
    );
    assert.ok(!gradeIds.includes(publishedClassA.id), "class A notice excluded for class B child");

    const foreignToken = signParentToken({
      parentId: parent.id,
      schoolId: schoolB.id,
      idNumber: "x",
    });
    const cross = await json(`/api/parent-portal/notices?limit=20`, {
      headers: { Authorization: `Bearer ${foreignToken}` },
    });
    // Token schoolId mismatches parent → should fail auth or return empty/not found
    assert.ok(
      cross.status === 401 ||
        cross.status === 403 ||
        cross.status === 404 ||
        (cross.status === 200 && (cross.body?.notices || []).length === 0),
      "cross-school token cannot read school A notices"
    );
    console.log("✓ HTTP dashboard + notices list enforce draft/visibility/targeting/isolation");
  } else {
    console.log("⚠ API not reachable — skipped live dashboard/list HTTP assertions");
  }

  await cleanup();
  console.log("\nparentPortal.communications.phase0.security.test: PASS");
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
