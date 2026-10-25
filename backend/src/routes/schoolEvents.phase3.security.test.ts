/**
 * Communications Phase 3 — SchoolEvent lifecycle, permissions, parent calendar, audit, pagination.
 * SAFE TARGET: localhost PostgreSQL only. Synthetic fixtures cleaned after run.
 *
 * Run: npx tsx src/routes/schoolEvents.phase3.security.test.ts
 */
import assert from "assert";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { STAFF_JWT_SECRET } from "../utils/staffJwt";
import { signParentToken } from "../middleware/parentAuth";
import { ensureSchoolModuleEntitlements } from "../services/schoolModuleEntitlements";
import { normalizeEventTargeting } from "../services/schoolEventService";

const prisma = new PrismaClient();
const PREFIX = "pp20c3-";
const API = process.env.PP20_C3_API_BASE || "http://127.0.0.1:3000";

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
    `Refusing Phase 3 tests against non-local host: ${host || "(unknown)"}`
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
    const parents = await prisma.parent.findMany({ where: { schoolId: s.id }, select: { id: true } });
    for (const p of parents) {
      await prisma.parentNotification.deleteMany({ where: { parentId: p.id } });
      await prisma.communicationMessage.deleteMany({ where: { parentId: p.id } }).catch(() => undefined);
      await prisma.parentLearnerLink.deleteMany({ where: { parentId: p.id } });
    }
    await prisma.schoolEventAuditLog.deleteMany({ where: { schoolId: s.id } });
    await prisma.schoolEvent.deleteMany({ where: { schoolId: s.id } });
    await prisma.schoolNotice.deleteMany({ where: { schoolId: s.id } });
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

  assert.equal(normalizeEventTargeting({ className: "A" }).mode, "CLASS");

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const schoolA = await prisma.school.create({
    data: {
      id: `${PREFIX}a-${stamp}`,
      name: "Phase3 School A",
      email: `c3a-${stamp}@test.local`,
      lifecycleStatus: "ACTIVE",
    },
  });
  const schoolB = await prisma.school.create({
    data: {
      id: `${PREFIX}b-${stamp}`,
      name: "Phase3 School B",
      email: `c3b-${stamp}@test.local`,
      lifecycleStatus: "ACTIVE",
    },
  });
  await ensureSchoolModuleEntitlements(schoolA.id);
  await ensureSchoolModuleEntitlements(schoolB.id);

  const admin = await prisma.user.create({
    data: {
      id: `${PREFIX}admin-${stamp}`,
      schoolId: schoolA.id,
      email: `admin-${stamp}@c3.test`,
      passwordHash: "x",
      fullName: "Admin C3",
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
      email: `teacher-${stamp}@c3.test`,
      passwordHash: "x",
      fullName: "Teacher C3",
      role: "STAFF",
      isActive: true,
    },
  });
  await prisma.userRbacMeta.upsert({
    where: { userId: teacher.id },
    create: { userId: teacher.id, schoolId: schoolA.id, appRole: "Teacher", permissions: {} },
    update: { appRole: "Teacher" },
  });

  const room = await prisma.classroom.create({
    data: {
      schoolId: schoolA.id,
      name: "Grade 3A",
      teacherEmail: teacher.email,
      teacherName: "Teacher C3",
    },
  });
  await prisma.classroomTeacher.create({
    data: {
      schoolId: schoolA.id,
      classroomId: room.id,
      userId: teacher.id,
      teacherEmail: teacher.email,
      teacherName: "Teacher C3",
    },
  });

  const parent = await prisma.parent.create({
    data: {
      id: `${PREFIX}par-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Pat",
      surname: "Parent",
      email: `parent-${stamp}@c3.test`,
      cellNo: "0820000031",
      idNumber: `C3${stamp}`.replace(/\W/g, "").slice(0, 13).padEnd(13, "0"),
    },
  });

  const kids: Array<{ id: string; grade: string; className: string | null }> = [];
  for (const tag of ["1", "2", "3", "4", "5"]) {
    const learner = await prisma.learner.create({
      data: {
        id: `${PREFIX}l${tag}-${stamp}`,
        schoolId: schoolA.id,
        firstName: `Kid${tag}`,
        lastName: "Phase3",
        grade: tag === "5" ? "4" : "3",
        className: tag === "5" ? "Grade 4B" : "Grade 3A",
        admissionNo: `C3L${tag}${stamp.slice(0, 4)}`,
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
  assert.equal(kids.length, 5);

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
  const parentTok = signParentToken({
    parentId: parent.id,
    schoolId: schoolA.id,
    idNumber: parent.idNumber || undefined,
  });

  const probe = await json(`/api/school-events?schoolId=${encodeURIComponent(schoolA.id)}`, {
    headers: { Authorization: adminTok },
  });
  assert.equal(probe.status, 200, `API unreachable or auth failed: ${JSON.stringify(probe.body)}`);

  const start = new Date(Date.now() + 2 * 24 * 3600 * 1000);
  const end = new Date(start.getTime() + 2 * 3600 * 1000);

  // Draft create + edit
  const draft = await json("/api/school-events", {
    method: "POST",
    headers: { Authorization: adminTok },
    body: JSON.stringify({
      schoolId: schoolA.id,
      title: "Sports day",
      description: "Whole school",
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      location: "Field",
      publishNow: false,
    }),
  });
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  const eventId = draft.body.event.id as string;
  assert.equal(draft.body.event.lifecycleStatus, "DRAFT");

  const edit = await json(`/api/school-events/${eventId}`, {
    method: "PATCH",
    headers: { Authorization: adminTok },
    body: JSON.stringify({
      schoolId: schoolA.id,
      title: "Sports day edited",
      description: "Updated",
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    }),
  });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.event.title, "Sports day edited");

  // Teacher cannot create school-wide
  const teacherWide = await json("/api/school-events", {
    method: "POST",
    headers: { Authorization: teacherTok },
    body: JSON.stringify({
      schoolId: schoolA.id,
      title: "Teacher wide",
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      publishNow: true,
    }),
  });
  assert.equal(teacherWide.status, 403);

  // Teacher class event OK; wrong class denied
  const teacherClass = await json("/api/school-events", {
    method: "POST",
    headers: { Authorization: teacherTok },
    body: JSON.stringify({
      schoolId: schoolA.id,
      title: "Class picnic",
      className: "Grade 3A",
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      publishNow: true,
    }),
  });
  assert.equal(teacherClass.status, 200, JSON.stringify(teacherClass.body));
  const classEventId = teacherClass.body.event.id as string;

  const teacherWrong = await json("/api/school-events", {
    method: "POST",
    headers: { Authorization: teacherTok },
    body: JSON.stringify({
      schoolId: schoolA.id,
      title: "Wrong",
      className: "Grade 4B",
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      publishNow: true,
    }),
  });
  assert.equal(teacherWrong.status, 403);

  // Parent cannot see draft
  const parentBefore = await json(`/api/parent-portal/events?range=all&limit=50`, {
    headers: { Authorization: `Bearer ${parentTok}` },
  });
  assert.equal(parentBefore.status, 200);
  assert.ok(!(parentBefore.body.events || []).some((e: { id: string }) => e.id === eventId));

  // Publish school-wide → one alert (5 children, multi-child dedupe)
  const publish = await json(`/api/school-events/${eventId}/publish`, {
    method: "POST",
    headers: { Authorization: adminTok },
    body: JSON.stringify({ schoolId: schoolA.id }),
  });
  assert.equal(publish.status, 200);
  assert.equal(publish.body.event.lifecycleStatus, "PUBLISHED");

  const alerts = await prisma.parentNotification.findMany({
    where: {
      schoolId: schoolA.id,
      parentId: parent.id,
      metadata: { path: ["eventId"], equals: eventId },
    },
  });
  assert.equal(alerts.length, 1, "school-wide event: one parent alert for multi-child family");
  const alertId = alerts[0].id;
  await prisma.parentNotification.update({
    where: { id: alertId },
    data: { isRead: true, readAt: new Date() },
  });

  // Ordinary edit — no new alert
  const editPub = await json(`/api/school-events/${eventId}`, {
    method: "PATCH",
    headers: { Authorization: adminTok },
    body: JSON.stringify({
      schoolId: schoolA.id,
      title: "Sports day final",
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    }),
  });
  assert.equal(editPub.status, 200);
  assert.equal(
    await prisma.parentNotification.count({
      where: {
        schoolId: schoolA.id,
        parentId: parent.id,
        metadata: { path: ["eventId"], equals: eventId },
      },
    }),
    1
  );

  // Grade targeting
  const gradeEv = await json("/api/school-events", {
    method: "POST",
    headers: { Authorization: adminTok },
    body: JSON.stringify({
      schoolId: schoolA.id,
      title: "Grade 3 assembly",
      grade: "3",
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      publishNow: true,
    }),
  });
  assert.equal(gradeEv.status, 200);
  const gId = gradeEv.body.event.id as string;

  // Cancel — visible as cancelled, no new alert
  const cancel = await json(`/api/school-events/${eventId}/cancel`, {
    method: "POST",
    headers: { Authorization: adminTok },
    body: JSON.stringify({ schoolId: schoolA.id, cancellationReason: "Rain" }),
  });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.event.lifecycleStatus, "CANCELLED");
  assert.equal(
    await prisma.parentNotification.count({
      where: {
        schoolId: schoolA.id,
        parentId: parent.id,
        metadata: { path: ["eventId"], equals: eventId },
      },
    }),
    1,
    "cancel does not create alerts"
  );
  const afterCancel = await prisma.parentNotification.findUnique({ where: { id: alertId } });
  assert.equal(afterCancel?.isRead, true, "read status preserved");

  // Cannot republish cancelled
  const republish = await json(`/api/school-events/${eventId}/publish`, {
    method: "POST",
    headers: { Authorization: adminTok },
    body: JSON.stringify({ schoolId: schoolA.id }),
  });
  assert.equal(republish.status, 400);

  const parentAll = await json(`/api/parent-portal/events?range=all&limit=50`, {
    headers: { Authorization: `Bearer ${parentTok}` },
  });
  assert.equal(parentAll.status, 200);
  const cancelledRow = (parentAll.body.events || []).find((e: { id: string }) => e.id === eventId);
  assert.ok(cancelledRow, "cancelled event remains parent-visible");
  assert.equal(cancelledRow.lifecycleStatus, "CANCELLED");
  assert.ok(cancelledRow.isSchoolWide, "school-wide flagged once");
  assert.ok((parentAll.body.events || []).some((e: { id: string }) => e.id === classEventId));
  assert.ok((parentAll.body.events || []).some((e: { id: string }) => e.id === gId));

  // Archive hides from parents
  const archive = await json(`/api/school-events/${eventId}/archive`, {
    method: "POST",
    headers: { Authorization: adminTok },
    body: JSON.stringify({ schoolId: schoolA.id }),
  });
  assert.equal(archive.status, 200);
  const parentAfterArchive = await json(`/api/parent-portal/events?range=all&limit=50`, {
    headers: { Authorization: `Bearer ${parentTok}` },
  });
  assert.ok(!(parentAfterArchive.body.events || []).some((e: { id: string }) => e.id === eventId));

  // Cross-school denied
  const cross = await json("/api/school-events", {
    method: "POST",
    headers: { Authorization: adminTok },
    body: JSON.stringify({
      schoolId: schoolB.id,
      title: "Cross",
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      publishNow: true,
    }),
  });
  assert.equal(cross.status, 403);

  // Ambiguous targeting rejected
  const ambiguous = await json("/api/school-events", {
    method: "POST",
    headers: { Authorization: adminTok },
    body: JSON.stringify({
      schoolId: schoolA.id,
      title: "Bad target",
      grade: "3",
      learnerId: kids[0].id,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      publishNow: false,
    }),
  });
  assert.equal(ambiguous.status, 400);

  // startsAt > endsAt rejected
  const badWindow = await json("/api/school-events", {
    method: "POST",
    headers: { Authorization: adminTok },
    body: JSON.stringify({
      schoolId: schoolA.id,
      title: "Bad window",
      startsAt: end.toISOString(),
      endsAt: start.toISOString(),
      publishNow: false,
    }),
  });
  assert.equal(badWindow.status, 400);

  // Audit
  const detail = await json(
    `/api/school-events/${eventId}?schoolId=${encodeURIComponent(schoolA.id)}`,
    { headers: { Authorization: adminTok } }
  );
  assert.equal(detail.status, 200);
  const actions = (detail.body.audit || []).map((a: { action: string }) => a.action);
  assert.ok(actions.includes("CREATE_DRAFT"));
  assert.ok(actions.includes("PUBLISH"));
  assert.ok(actions.includes("CANCEL"));
  assert.ok(actions.includes("ARCHIVE"));

  // Dashboard upcoming from real API
  const dash = await json(`/api/parent-portal/dashboard`, {
    headers: { Authorization: `Bearer ${parentTok}` },
  });
  assert.equal(dash.status, 200);
  assert.ok(Array.isArray(dash.body.upcomingEvents));

  // Announcements still work (unaffected)
  const noticeList = await json(
    `/api/school-announcements?schoolId=${encodeURIComponent(schoolA.id)}`,
    { headers: { Authorization: adminTok } }
  );
  assert.equal(noticeList.status, 200);

  // Pagination beyond 300
  console.log("… seeding 320 events for pagination");
  const bulk = [];
  for (let i = 0; i < 320; i++) {
    const s = new Date(Date.now() + (i + 10) * 3600 * 1000);
    bulk.push({
      schoolId: schoolA.id,
      title: `Bulk event ${i}`,
      description: `e${i}`,
      startsAt: s,
      endsAt: new Date(s.getTime() + 3600 * 1000),
      lifecycleStatus: "PUBLISHED" as const,
      publishedAt: new Date(),
      createdBy: "bulk@c3.test",
    });
  }
  for (let i = 0; i < bulk.length; i += 80) {
    await prisma.schoolEvent.createMany({ data: bulk.slice(i, i + 80) });
  }

  let seen = 0;
  let cursor: string | null = null;
  let pages = 0;
  while (pages < 20) {
    const q = new URLSearchParams({ range: "all", limit: "100" });
    if (cursor) q.set("cursor", cursor);
    const page = await json(`/api/parent-portal/events?${q}`, {
      headers: { Authorization: `Bearer ${parentTok}` },
    });
    assert.equal(page.status, 200);
    seen += (page.body.events || []).length;
    pages += 1;
    if (!page.body.hasMore) break;
    cursor = page.body.nextCursor || null;
    assert.ok(cursor);
  }
  assert.ok(seen > 300, `parent event pagination seen=${seen}`);
  console.log(`✓ Parent event pagination beyond 300 (seen=${seen}, pages=${pages})`);

  // Distinct event → distinct alert
  const distinct = await json("/api/school-events", {
    method: "POST",
    headers: { Authorization: adminTok },
    body: JSON.stringify({
      schoolId: schoolA.id,
      title: "Distinct event",
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      publishNow: true,
    }),
  });
  assert.equal(distinct.status, 200);
  const dId = distinct.body.event.id as string;
  const dAlerts = await prisma.parentNotification.findMany({
    where: {
      schoolId: schoolA.id,
      parentId: parent.id,
      metadata: { path: ["eventId"], equals: dId },
    },
  });
  assert.equal(dAlerts.length, 1);
  assert.notEqual(dAlerts[0].id, alertId);

  await cleanup();
  console.log("schoolEvents.phase3.security.test: PASS");
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
