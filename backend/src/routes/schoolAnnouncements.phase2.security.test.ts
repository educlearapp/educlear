/**
 * Communications Phase 2 — announcement lifecycle, permissions, parent pagination, audit.
 * SAFE TARGET: localhost PostgreSQL only. Synthetic fixtures cleaned after run.
 * Does not send SMS/email/push or touch billing ledgers.
 *
 * Run: npx tsx src/routes/schoolAnnouncements.phase2.security.test.ts
 * Requires local API on PP20_C2_API_BASE (default http://127.0.0.1:3000).
 */
import assert from "assert";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { STAFF_JWT_SECRET } from "../utils/staffJwt";
import { signParentToken } from "../middleware/parentAuth";
import { ensureSchoolModuleEntitlements } from "../services/schoolModuleEntitlements";
import {
  assertActorMayManageTarget,
  lifecycleToIsDraft,
  parentVisibleNoticeWhere,
  resolveNoticeLifecycle,
} from "../services/schoolAnnouncementService";
import { uniqueParentLearnerLinks } from "../services/parentPortalService";

const prisma = new PrismaClient();
const PREFIX = "pp20c2-";
const API = process.env.PP20_C2_API_BASE || "http://127.0.0.1:3000";

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
    `Refusing Phase 2 tests against non-local host: ${host || "(unknown)"}`
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
      await prisma.parentNotification.deleteMany({ where: { parentId: p.id } });
      await prisma.communicationMessage.deleteMany({ where: { parentId: p.id } }).catch(() => undefined);
      await prisma.parentOnboarding.deleteMany({ where: { parentId: p.id } }).catch(() => undefined);
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

  assert.equal(lifecycleToIsDraft("DRAFT"), true);
  assert.equal(lifecycleToIsDraft("PUBLISHED"), false);
  assert.equal(lifecycleToIsDraft("UNPUBLISHED"), false);
  assert.equal(lifecycleToIsDraft("ARCHIVED"), false);
  assert.equal(
    resolveNoticeLifecycle({ isDraft: true, lifecycleStatus: "PUBLISHED" }),
    "DRAFT",
    "legacy isDraft=true must not resolve as PUBLISHED"
  );
  const gate = parentVisibleNoticeWhere();
  assert.equal(gate.lifecycleStatus, "PUBLISHED");
  assert.equal(gate.isDraft, false);
  assert.equal(gate.visibility, "CLASS_TEACHERS");

  const teacherActor = {
    userId: "t1",
    email: "t@x.com",
    role: "STAFF",
    isSchoolWideAdmin: false,
    assignedClassNames: ["A"],
  };
  assert.ok(assertActorMayManageTarget(teacherActor, { className: null }));
  assert.ok(assertActorMayManageTarget(teacherActor, { className: "B" }));
  assert.equal(assertActorMayManageTarget(teacherActor, { className: "A" }), null);
  assert.equal(
    assertActorMayManageTarget(
      { ...teacherActor, isSchoolWideAdmin: true },
      { className: null, grade: "3" }
    ),
    null
  );
  console.log("✓ Lifecycle helpers + teacher targeting assertions");

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const schoolA = await prisma.school.create({
    data: {
      id: `${PREFIX}a-${stamp}`,
      name: "Phase2 School A",
      email: `c2a-${stamp}@test.local`,
      lifecycleStatus: "ACTIVE",
    },
  });
  const schoolB = await prisma.school.create({
    data: {
      id: `${PREFIX}b-${stamp}`,
      name: "Phase2 School B",
      email: `c2b-${stamp}@test.local`,
      lifecycleStatus: "ACTIVE",
    },
  });
  await ensureSchoolModuleEntitlements(schoolA.id);
  await ensureSchoolModuleEntitlements(schoolB.id);

  const admin = await prisma.user.create({
    data: {
      id: `${PREFIX}admin-${stamp}`,
      schoolId: schoolA.id,
      email: `admin-${stamp}@c2.test`,
      passwordHash: "x",
      fullName: "Admin C2",
      role: "SCHOOL_ADMIN",
      isActive: true,
    },
  });
  await prisma.userRbacMeta.upsert({
    where: { userId: admin.id },
    create: { userId: admin.id, schoolId: schoolA.id, appRole: "Admin", permissions: {} },
    update: { appRole: "Admin" },
  });

  const teacher = await prisma.user.create({
    data: {
      id: `${PREFIX}teach-${stamp}`,
      schoolId: schoolA.id,
      email: `teacher-${stamp}@c2.test`,
      passwordHash: "x",
      fullName: "Teacher C2",
      role: "STAFF",
      isActive: true,
    },
  });
  // Teacher needs communications.* to use Communications Centre; still not school-wide admin.
  const teacherComms = {
    communications: {
      view: true,
      create: true,
      edit: true,
      delete: false,
      print: true,
      send: true,
    },
  };
  await prisma.userRbacMeta.upsert({
    where: { userId: teacher.id },
    create: {
      userId: teacher.id,
      schoolId: schoolA.id,
      appRole: "Teacher",
      permissions: teacherComms,
    },
    update: { appRole: "Teacher", permissions: teacherComms },
  });

  const finance = await prisma.user.create({
    data: {
      id: `${PREFIX}fin-${stamp}`,
      schoolId: schoolA.id,
      email: `finance-${stamp}@c2.test`,
      passwordHash: "x",
      fullName: "Finance C2",
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
      teacherName: "Teacher C2",
    },
  });
  await prisma.classroomTeacher.create({
    data: {
      schoolId: schoolA.id,
      classroomId: roomA.id,
      userId: teacher.id,
      teacherEmail: teacher.email,
      teacherName: "Teacher C2",
    },
  });

  const parent = await prisma.parent.create({
    data: {
      id: `${PREFIX}par-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Pat",
      surname: "Parent",
      email: `parent-${stamp}@c2.test`,
      cellNo: "0820000001",
      idNumber: `C2${stamp}`.replace(/\W/g, "").slice(0, 13).padEnd(13, "0"),
    },
  });

  const kids: Array<{ id: string; grade: string; className: string | null }> = [];
  for (const tag of ["1", "2"]) {
    const learner = await prisma.learner.create({
      data: {
        id: `${PREFIX}l${tag}-${stamp}`,
        schoolId: schoolA.id,
        firstName: `Kid${tag}`,
        lastName: "Phase2",
        grade: "3",
        className: "Grade 3A",
        admissionNo: `C2L${tag}${stamp.slice(0, 4)}`,
        enrollmentStatus: "ACTIVE",
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
  const otherLearner = await prisma.learner.create({
    data: {
      id: `${PREFIX}lx-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Other",
      lastName: "Class",
      grade: "4",
      className: "Grade 4B",
      admissionNo: `C2LX${stamp.slice(0, 4)}`,
      enrollmentStatus: "ACTIVE",
    },
  });
  await prisma.parentLearnerLink.create({
    data: {
      schoolId: schoolA.id,
      parentId: parent.id,
      learnerId: otherLearner.id,
      relation: "Mother",
      isPrimary: false,
    },
  });

  const legacyPublished = await prisma.schoolNotice.create({
    data: {
      schoolId: schoolA.id,
      noticeType: "SCHOOL",
      title: "Legacy published notice",
      body: "Pre-phase2 published",
      isDraft: false,
      lifecycleStatus: "PUBLISHED",
      visibility: "CLASS_TEACHERS",
      createdBy: "legacy@c2.test",
    },
  });

  // Inconsistent legacy: isDraft=true but lifecycleStatus left at PUBLISHED (schema default).
  // Must never appear as published to parents or in staff PUBLISHED filter. No DB rewrite.
  const legacyInconsistent = await prisma.schoolNotice.create({
    data: {
      schoolId: schoolA.id,
      noticeType: "SCHOOL",
      title: "Legacy inconsistent draft",
      body: "isDraft true with PUBLISHED lifecycle",
      isDraft: true,
      lifecycleStatus: "PUBLISHED",
      visibility: "CLASS_TEACHERS",
      createdBy: "legacy@c2.test",
    },
  });
  assert.equal(
    resolveNoticeLifecycle(legacyInconsistent),
    "DRAFT",
    "effective lifecycle treats inconsistent row as DRAFT"
  );

  const adminTok = bearer({
    id: admin.id,
    schoolId: schoolA.id,
    email: admin.email,
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
  const parentTok = signParentToken({
    parentId: parent.id,
    schoolId: schoolA.id,
    idNumber: parent.idNumber || undefined,
  });

  // Probe API + legacy inconsistent compatibility
  {
    const probe = await json(`/api/school-announcements?schoolId=${encodeURIComponent(schoolA.id)}`, {
      headers: { Authorization: adminTok },
    });
    assert.ok(
      [200, 401, 403].includes(probe.status),
      `API not reachable at ${API} (status ${probe.status}) — start local backend first`
    );
    assert.equal(probe.status, 200, `admin list failed: ${JSON.stringify(probe.body)}`);

    const publishedList = await json(
      `/api/school-announcements?schoolId=${encodeURIComponent(schoolA.id)}&lifecycle=PUBLISHED`,
      { headers: { Authorization: adminTok } }
    );
    assert.equal(publishedList.status, 200);
    const pubIds = (publishedList.body.items || []).map((n: { id: string }) => n.id);
    assert.ok(!pubIds.includes(legacyInconsistent.id), "inconsistent isDraft=true excluded from PUBLISHED list");
    assert.ok(pubIds.includes(legacyPublished.id), "true published remains in PUBLISHED list");

    const draftList = await json(
      `/api/school-announcements?schoolId=${encodeURIComponent(schoolA.id)}&lifecycle=DRAFT`,
      { headers: { Authorization: adminTok } }
    );
    assert.equal(draftList.status, 200);
    const draftItem = (draftList.body.items || []).find(
      (n: { id: string }) => n.id === legacyInconsistent.id
    );
    assert.ok(draftItem, "inconsistent legacy appears under DRAFT filter");
    assert.equal(draftItem.lifecycleStatus, "DRAFT", "API presents effective DRAFT (no DB rewrite required)");

    const parentLegacy = await json(
      `/api/parent-portal/notices?learnerId=${encodeURIComponent(kids[0].id)}&limit=50`,
      { headers: { Authorization: `Bearer ${parentTok}` } }
    );
    assert.equal(parentLegacy.status, 200, JSON.stringify(parentLegacy.body));
    const parentLegacyIds = (parentLegacy.body.notices || []).map((n: { id: string }) => n.id);
    assert.ok(
      !parentLegacyIds.includes(legacyInconsistent.id),
      "inconsistent isDraft=true hidden from parents"
    );
    assert.ok(parentLegacyIds.includes(legacyPublished.id), "consistent published still visible to parents");

    // Cannot unpublish an isDraft=true row even if stored lifecycle says PUBLISHED
    const badUnpublish = await json(`/api/school-announcements/${legacyInconsistent.id}/unpublish`, {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({ schoolId: schoolA.id }),
    });
    assert.equal(badUnpublish.status, 400, "legacy draft cannot be unpublished as if published");

    // Publish repairs consistency going forward (still no destructive cleanup of other rows)
    const repairPublish = await json(`/api/school-announcements/${legacyInconsistent.id}/publish`, {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({ schoolId: schoolA.id }),
    });
    assert.equal(repairPublish.status, 200, JSON.stringify(repairPublish.body));
    assert.equal(repairPublish.body.notice.lifecycleStatus, "PUBLISHED");
    assert.equal(repairPublish.body.notice.isDraft, false);
    const repairedRow = await prisma.schoolNotice.findUnique({ where: { id: legacyInconsistent.id } });
    assert.equal(repairedRow?.lifecycleStatus, "PUBLISHED");
    assert.equal(repairedRow?.isDraft, false);
    console.log("✓ Legacy isDraft/lifecycleStatus inconsistency handled without destructive cleanup");
  }

  // Draft create + edit
  const draftRes = await json("/api/school-announcements", {
    method: "POST",
    headers: { Authorization: adminTok },
    body: JSON.stringify({
      schoolId: schoolA.id,
      title: "Draft one",
      body: "Draft body",
      noticeType: "SCHOOL",
      publishNow: false,
    }),
  });
  assert.equal(draftRes.status, 200, JSON.stringify(draftRes.body));
  const draftId = draftRes.body.notice.id as string;
  assert.equal(draftRes.body.notice.lifecycleStatus, "DRAFT");
  assert.equal(draftRes.body.notice.isDraft, true);

  const editDraft = await json(`/api/school-announcements/${draftId}`, {
    method: "PATCH",
    headers: { Authorization: adminTok },
    body: JSON.stringify({
      schoolId: schoolA.id,
      title: "Draft one edited",
      body: "Edited body",
    }),
  });
  assert.equal(editDraft.status, 200, JSON.stringify(editDraft.body));
  assert.equal(editDraft.body.notice.title, "Draft one edited");
  assert.equal(editDraft.body.notice.lifecycleStatus, "DRAFT");

  // Teacher cannot create school-wide
  const teacherSchoolWide = await json("/api/school-announcements", {
    method: "POST",
    headers: { Authorization: teacherTok },
    body: JSON.stringify({
      schoolId: schoolA.id,
      title: "Teacher school-wide attempt",
      body: "nope",
      publishNow: true,
    }),
  });
  assert.equal(teacherSchoolWide.status, 403, "teacher school-wide denied");

  // Finance custom role cannot manage school-wide
  const financeCreate = await json("/api/school-announcements", {
    method: "POST",
    headers: { Authorization: financeTok },
    body: JSON.stringify({
      schoolId: schoolA.id,
      title: "Finance attempt",
      body: "nope",
      publishNow: true,
    }),
  });
  assert.equal(financeCreate.status, 403, "finance role not elevated");

  // Teacher class-scoped create
  const teacherDraft = await json("/api/school-announcements", {
    method: "POST",
    headers: { Authorization: teacherTok },
    body: JSON.stringify({
      schoolId: schoolA.id,
      title: "Class draft",
      body: "For 3A",
      noticeType: "CLASS",
      className: "Grade 3A",
      publishNow: false,
    }),
  });
  assert.equal(teacherDraft.status, 200, JSON.stringify(teacherDraft.body));
  const classDraftId = teacherDraft.body.notice.id as string;

  const teacherWrongClass = await json("/api/school-announcements", {
    method: "POST",
    headers: { Authorization: teacherTok },
    body: JSON.stringify({
      schoolId: schoolA.id,
      title: "Wrong class",
      body: "x",
      className: "Grade 4B",
      publishNow: true,
    }),
  });
  assert.equal(teacherWrongClass.status, 403, "teacher wrong class denied");

  // Publish draft (admin)
  const publish = await json(`/api/school-announcements/${draftId}/publish`, {
    method: "POST",
    headers: { Authorization: adminTok },
    body: JSON.stringify({ schoolId: schoolA.id }),
  });
  assert.equal(publish.status, 200, JSON.stringify(publish.body));
  assert.equal(publish.body.notice.lifecycleStatus, "PUBLISHED");
  assert.equal(publish.body.notice.isDraft, false);

  const afterPublishNotifs = await prisma.parentNotification.findMany({
    where: {
      schoolId: schoolA.id,
      parentId: parent.id,
      metadata: { path: ["noticeId"], equals: draftId },
    },
  });
  assert.equal(afterPublishNotifs.length, 1, "first publish → one parent alert (multi-child dedupe)");
  const firstNotifId = afterPublishNotifs[0].id;
  const notifCountBeforeEdit = await prisma.parentNotification.count({
    where: { schoolId: schoolA.id, parentId: parent.id },
  });

  // Ordinary edit — no new notification
  const editPub = await json(`/api/school-announcements/${draftId}`, {
    method: "PATCH",
    headers: { Authorization: adminTok },
    body: JSON.stringify({
      schoolId: schoolA.id,
      title: "Draft one published edited",
      body: "Still published",
    }),
  });
  assert.equal(editPub.status, 200);
  const notifsAfterEdit = await prisma.parentNotification.findMany({
    where: {
      schoolId: schoolA.id,
      parentId: parent.id,
      metadata: { path: ["noticeId"], equals: draftId },
    },
  });
  assert.equal(notifsAfterEdit.length, 1, "edit published does not re-notify");
  assert.equal(
    await prisma.parentNotification.count({ where: { schoolId: schoolA.id, parentId: parent.id } }),
    notifCountBeforeEdit,
    "ordinary edit does not create any new parent notifications"
  );

  // Unpublish / parent exclusion — no new alerts
  const unpublish = await json(`/api/school-announcements/${draftId}/unpublish`, {
    method: "POST",
    headers: { Authorization: adminTok },
    body: JSON.stringify({ schoolId: schoolA.id }),
  });
  assert.equal(unpublish.status, 200);
  assert.equal(unpublish.body.notice.lifecycleStatus, "UNPUBLISHED");
  assert.equal(
    await prisma.parentNotification.count({
      where: {
        schoolId: schoolA.id,
        parentId: parent.id,
        metadata: { path: ["noticeId"], equals: draftId },
      },
    }),
    1,
    "unpublish does not create alerts"
  );

  const parentList1 = await json(`/api/parent-portal/notices?learnerId=${kids[0].id}&limit=50`, {
    headers: { Authorization: `Bearer ${parentTok}` },
  });
  assert.equal(parentList1.status, 200, JSON.stringify(parentList1.body));
  const parentIds1 = (parentList1.body.notices || []).map((n: { id: string }) => n.id);
  assert.ok(!parentIds1.includes(draftId), "unpublished hidden from parent");
  assert.ok(!parentIds1.includes(classDraftId), "draft hidden from parent");
  assert.ok(parentIds1.includes(legacyPublished.id), "legacy published still visible");

  // Mark original alert read, then republish — must not duplicate or clear read state
  await prisma.parentNotification.update({
    where: { id: firstNotifId },
    data: { isRead: true, readAt: new Date() },
  });

  const republish = await json(`/api/school-announcements/${draftId}/republish`, {
    method: "POST",
    headers: { Authorization: adminTok },
    body: JSON.stringify({ schoolId: schoolA.id }),
  });
  assert.equal(republish.status, 200);
  assert.equal(republish.body.notice.lifecycleStatus, "PUBLISHED");
  const notifsAfterRepub = await prisma.parentNotification.findMany({
    where: {
      schoolId: schoolA.id,
      parentId: parent.id,
      metadata: { path: ["noticeId"], equals: draftId },
    },
  });
  assert.equal(
    notifsAfterRepub.length,
    1,
    "republish does not send another alert when original notice notification exists"
  );
  assert.equal(notifsAfterRepub[0].id, firstNotifId, "historical notification row unchanged");
  assert.equal(notifsAfterRepub[0].isRead, true, "read status preserved across republish");

  // Distinct notice → distinct alert
  const distinct = await json("/api/school-announcements", {
    method: "POST",
    headers: { Authorization: adminTok },
    body: JSON.stringify({
      schoolId: schoolA.id,
      title: "Distinct notice two",
      body: "another",
      noticeType: "SCHOOL",
      publishNow: true,
    }),
  });
  assert.equal(distinct.status, 200, JSON.stringify(distinct.body));
  const distinctId = distinct.body.notice.id as string;
  const distinctNotifs = await prisma.parentNotification.findMany({
    where: {
      schoolId: schoolA.id,
      parentId: parent.id,
      metadata: { path: ["noticeId"], equals: distinctId },
    },
  });
  assert.equal(distinctNotifs.length, 1, "distinct notice generates its own alert");
  assert.notEqual(distinctNotifs[0].id, firstNotifId);

  const parentList2 = await json(`/api/parent-portal/notices?learnerId=${kids[0].id}&limit=50`, {
    headers: { Authorization: `Bearer ${parentTok}` },
  });
  const parentIds2 = (parentList2.body.notices || []).map((n: { id: string }) => n.id);
  assert.ok(parentIds2.includes(draftId), "republished visible to parent");

  // Archive
  const archive = await json(`/api/school-announcements/${draftId}/archive`, {
    method: "POST",
    headers: { Authorization: adminTok },
    body: JSON.stringify({ schoolId: schoolA.id }),
  });
  assert.equal(archive.status, 200);
  assert.equal(archive.body.notice.lifecycleStatus, "ARCHIVED");
  const parentList3 = await json(`/api/parent-portal/notices?learnerId=${kids[0].id}&limit=50`, {
    headers: { Authorization: `Bearer ${parentTok}` },
  });
  const parentIds3 = (parentList3.body.notices || []).map((n: { id: string }) => n.id);
  assert.ok(!parentIds3.includes(draftId), "archived hidden from parent");

  const editArchived = await json(`/api/school-announcements/${draftId}`, {
    method: "PATCH",
    headers: { Authorization: adminTok },
    body: JSON.stringify({ schoolId: schoolA.id, title: "nope" }),
  });
  assert.equal(editArchived.status, 400, "archived not editable");

  // Grade targeting
  const gradeNotice = await json("/api/school-announcements", {
    method: "POST",
    headers: { Authorization: adminTok },
    body: JSON.stringify({
      schoolId: schoolA.id,
      title: "Grade 3 only",
      body: "g3",
      grade: "3",
      noticeType: "GRADE",
      publishNow: true,
    }),
  });
  assert.equal(gradeNotice.status, 200, JSON.stringify(gradeNotice.body));
  const gId = gradeNotice.body.notice.id as string;
  const parentG3 = await json(`/api/parent-portal/notices?learnerId=${kids[0].id}&limit=50`, {
    headers: { Authorization: `Bearer ${parentTok}` },
  });
  assert.ok(
    (parentG3.body.notices || []).some((n: { id: string }) => n.id === gId),
    "grade 3 learner sees grade notice"
  );
  const parentG4 = await json(`/api/parent-portal/notices?learnerId=${otherLearner.id}&limit=50`, {
    headers: { Authorization: `Bearer ${parentTok}` },
  });
  assert.ok(
    !(parentG4.body.notices || []).some((n: { id: string }) => n.id === gId),
    "grade 4 learner does not see grade 3 notice"
  );

  const links = await prisma.parentLearnerLink.findMany({
    where: { schoolId: schoolA.id, parentId: parent.id, learner: { className: "Grade 3A" } },
  });
  assert.equal(uniqueParentLearnerLinks(links).length, 1);

  // Cross-school denied
  const cross = await json("/api/school-announcements", {
    method: "POST",
    headers: { Authorization: adminTok },
    body: JSON.stringify({
      schoolId: schoolB.id,
      title: "Cross",
      body: "x",
      publishNow: true,
    }),
  });
  assert.equal(cross.status, 403, "cross-school IDOR denied");

  const parentCross = await json(`/api/parent-portal/notices?limit=20`, {
    headers: {
      Authorization: `Bearer ${signParentToken({
        parentId: parent.id,
        schoolId: schoolB.id,
      })}`,
    },
  });
  assert.ok(
    parentCross.status === 401 || parentCross.status === 403 || parentCross.status === 404,
    `parent token school mismatch rejected (got ${parentCross.status})`
  );

  // Audit trail
  const detail = await json(
    `/api/school-announcements/${draftId}?schoolId=${encodeURIComponent(schoolA.id)}`,
    { headers: { Authorization: adminTok } }
  );
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  const actions = (detail.body.audit || []).map((a: { action: string }) => a.action);
  assert.ok(actions.includes("CREATE_DRAFT"));
  assert.ok(actions.includes("EDIT_DRAFT") || actions.includes("EDIT_PUBLISHED"));
  assert.ok(actions.includes("PUBLISH"));
  assert.ok(actions.includes("UNPUBLISH"));
  assert.ok(actions.includes("REPUBLISH"));
  assert.ok(actions.includes("ARCHIVE"));
  assert.ok((detail.body.audit || []).every((a: { schoolId: string }) => a.schoolId === schoolA.id));

  // Staff list filters
  const drafts = await json(
    `/api/school-announcements?schoolId=${encodeURIComponent(schoolA.id)}&lifecycle=DRAFT`,
    { headers: { Authorization: adminTok } }
  );
  assert.equal(drafts.status, 200);
  assert.ok(
    (drafts.body.items || []).every((n: { lifecycleStatus: string }) => n.lifecycleStatus === "DRAFT")
  );

  // Pagination beyond 300
  console.log("… seeding 320 notices for pagination (local only)");
  const bulk = [];
  for (let i = 0; i < 320; i++) {
    bulk.push({
      schoolId: schoolA.id,
      noticeType: "SCHOOL" as const,
      title: `Bulk notice ${i}`,
      body: `body ${i}`,
      lifecycleStatus: "PUBLISHED" as const,
      isDraft: false,
      visibility: "CLASS_TEACHERS" as const,
      createdBy: "bulk@c2.test",
    });
  }
  for (let i = 0; i < bulk.length; i += 80) {
    await prisma.schoolNotice.createMany({ data: bulk.slice(i, i + 80) });
  }

  let seen = 0;
  let cursor: string | null = null;
  let pages = 0;
  const foundLegacy = new Set<string>();
  while (pages < 20) {
    const q = new URLSearchParams({
      learnerId: kids[0].id,
      limit: "100",
    });
    if (cursor) q.set("cursor", cursor);
    const page = await json(`/api/parent-portal/notices?${q}`, {
      headers: { Authorization: `Bearer ${parentTok}` },
    });
    assert.equal(page.status, 200, JSON.stringify(page.body));
    const rows = page.body.notices || [];
    seen += rows.length;
    for (const n of rows) foundLegacy.add(n.id);
    pages += 1;
    if (!page.body.hasMore) break;
    cursor = page.body.nextCursor || null;
    assert.ok(cursor, "nextCursor required when hasMore");
  }
  assert.ok(seen > 300, `parent pagination retrieved ${seen} notices (expected >300)`);
  assert.ok(foundLegacy.has(legacyPublished.id), "legacy published still in paginated set");
  console.log(`✓ Parent notice pagination beyond 300 (seen=${seen}, pages=${pages})`);

  const teacherList = await json(
    `/api/school-announcements?schoolId=${encodeURIComponent(schoolA.id)}&lifecycle=ALL&limit=20`,
    { headers: { Authorization: teacherTok } }
  );
  assert.equal(teacherList.status, 200);
  assert.ok(
    (teacherList.body.items || []).every(
      (n: { className?: string | null }) => n.className === "Grade 3A"
    ),
    "teacher list scoped to assigned class"
  );

  console.log("✓ Phase 2 announcement lifecycle, permissions, audit, notifications, pagination");

  await cleanup();
  console.log("schoolAnnouncements.phase2.security.test: PASS");
}

main()
  .catch(async (e) => {
    console.error(e);
    await cleanup().catch(() => undefined);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
