/**
 * P1 Communications Centre — parent document pagination + staff targeting RBAC.
 * SAFE TARGET: localhost PostgreSQL only. No external providers.
 *
 * Run: npx tsx src/routes/schoolParentDocuments.p1.security.test.ts
 * Requires local API on :3000 (or PP20_P1_API_BASE).
 */
import assert from "assert";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { STAFF_JWT_SECRET } from "../utils/staffJwt";
import { signParentToken } from "../middleware/parentAuth";
import { ensureSchoolModuleEntitlements } from "../services/schoolModuleEntitlements";

const prisma = new PrismaClient();
const PREFIX = "pp20p1-";
const API = process.env.PP20_P1_API_BASE || "http://127.0.0.1:3000";

function assertLocalDatabase() {
  const url = String(process.env.DATABASE_URL || "");
  let host = "";
  try {
    host = new URL(url.replace(/^postgresql:/, "http:")).hostname;
  } catch {
    host = "";
  }
  assert.ok(host === "localhost" || host === "127.0.0.1", `non-local host ${host}`);
}

function staffBearer(user: {
  id: string;
  schoolId: string;
  email: string;
  role?: string;
  appRole?: string;
}) {
  return `Bearer ${jwt.sign(
    {
      userId: user.id,
      schoolId: user.schoolId,
      email: user.email,
      role: user.role || "TEACHER",
      appRole: user.appRole,
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
    await prisma.parentNotification.deleteMany({ where: { schoolId: s.id } });
    await prisma.parentPushDelivery.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.parentDocument.deleteMany({ where: { schoolId: s.id } });
    await prisma.parentLearnerLink.deleteMany({ where: { schoolId: s.id } });
    await prisma.parent.deleteMany({ where: { schoolId: s.id } });
    await prisma.learner.deleteMany({ where: { schoolId: s.id } });
    await prisma.classroomTeacher.deleteMany({ where: { classroom: { schoolId: s.id } } }).catch(() => undefined);
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

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  const schoolA = await prisma.school.create({
    data: {
      id: `${PREFIX}a-${stamp}`,
      name: "P1 Docs A",
      email: `p1a-${stamp}@t.local`,
      lifecycleStatus: "ACTIVE",
    },
  });
  const schoolB = await prisma.school.create({
    data: {
      id: `${PREFIX}b-${stamp}`,
      name: "P1 Docs B",
      email: `p1b-${stamp}@t.local`,
      lifecycleStatus: "ACTIVE",
    },
  });
  await ensureSchoolModuleEntitlements(schoolA.id);
  await ensureSchoolModuleEntitlements(schoolB.id);

  const admin = await prisma.user.create({
    data: {
      id: `${PREFIX}admin-${stamp}`,
      schoolId: schoolA.id,
      email: `admin-${stamp}@t.local`,
      passwordHash: "x",
      role: "SCHOOL_ADMIN",
      fullName: "Admin",
      isActive: true,
    },
  });
  await prisma.userRbacMeta.create({
    data: { userId: admin.id, schoolId: schoolA.id, appRole: "Admin", permissions: {} },
  });

  const teacher = await prisma.user.create({
    data: {
      id: `${PREFIX}teach-${stamp}`,
      schoolId: schoolA.id,
      email: `teach-${stamp}@t.local`,
      passwordHash: "x",
      role: "STAFF",
      fullName: "Teacher",
      isActive: true,
    },
  });
  await prisma.userRbacMeta.create({
    data: { userId: teacher.id, schoolId: schoolA.id, appRole: "Teacher", permissions: {} },
  });

  const classA = await prisma.classroom.create({
    data: {
      schoolId: schoolA.id,
      name: "P1-4A",
      teacherEmail: teacher.email,
      teacherName: "Teacher",
    },
  });
  await prisma.classroomTeacher.create({
    data: {
      schoolId: schoolA.id,
      classroomId: classA.id,
      userId: teacher.id,
      teacherEmail: teacher.email,
      teacherName: "Teacher",
    },
  });

  const otherAdmin = await prisma.user.create({
    data: {
      id: `${PREFIX}ob-${stamp}`,
      schoolId: schoolB.id,
      email: `ob-${stamp}@t.local`,
      passwordHash: "x",
      role: "SCHOOL_ADMIN",
      fullName: "Other",
      isActive: true,
    },
  });
  await prisma.userRbacMeta.create({
    data: { userId: otherAdmin.id, schoolId: schoolB.id, appRole: "Admin", permissions: {} },
  });

  const parent = await prisma.parent.create({
    data: {
      id: `${PREFIX}pa-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Pat",
      surname: "Parent",
      email: `pat-${stamp}@t.local`,
      cellNo: "0820000001",
      idNumber: `P1${stamp}`.slice(0, 13),
    },
  });
  const learner = await prisma.learner.create({
    data: {
      id: `${PREFIX}l1-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Kid",
      lastName: "One",
      grade: "4",
      className: "P1-4A",
      enrollmentStatus: "ACTIVE",
    },
  });
  await prisma.parentLearnerLink.create({
    data: { schoolId: schoolA.id, parentId: parent.id, learnerId: learner.id },
  });

  const parentToken = signParentToken({ parentId: parent.id, schoolId: schoolA.id });
  const adminTok = staffBearer({
    id: admin.id,
    schoolId: schoolA.id,
    email: admin.email,
    role: "SCHOOL_ADMIN",
    appRole: "Admin",
  });
  const teacherTok = staffBearer({
    id: teacher.id,
    schoolId: schoolA.id,
    email: teacher.email,
    role: "STAFF",
    appRole: "Teacher",
  });
  const otherTok = staffBearer({
    id: otherAdmin.id,
    schoolId: schoolB.id,
    email: otherAdmin.email,
    role: "SCHOOL_ADMIN",
    appRole: "Admin",
  });

  // Seed >300 matching + non-matching docs
  const matching: { schoolId: string; title: string; fileUrl: string; fileName: string; className: string; visibility: "CLASS_TEACHERS" }[] = [];
  for (let i = 0; i < 320; i++) {
    matching.push({
      schoolId: schoolA.id,
      title: `Match ${i}`,
      fileUrl: `http://127.0.0.1/uploads/teacher-app/m-${i}.pdf`,
      fileName: `m-${i}.pdf`,
      className: "P1-4A",
      visibility: "CLASS_TEACHERS",
    });
  }
  const noise: typeof matching = [];
  for (let i = 0; i < 50; i++) {
    noise.push({
      schoolId: schoolA.id,
      title: `Noise ${i}`,
      fileUrl: `http://127.0.0.1/uploads/teacher-app/n-${i}.pdf`,
      fileName: `n-${i}.pdf`,
      className: "OTHER-CLASS",
      visibility: "CLASS_TEACHERS",
    });
  }
  // batch create
  for (let i = 0; i < matching.length; i += 50) {
    await prisma.parentDocument.createMany({ data: matching.slice(i, i + 50) });
  }
  await prisma.parentDocument.createMany({ data: noise });

  const page1 = await json(`/api/parent-portal/documents?limit=50&offset=0`, {
    headers: { Authorization: `Bearer ${parentToken}` },
  });
  assert.equal(page1.status, 200, JSON.stringify(page1.body));
  assert.equal(page1.body.documents?.length, 50);
  assert.equal(page1.body.total, 320, "total must count all matching beyond 300");
  assert.equal(page1.body.hasMore, true);

  const pageDeep = await json(`/api/parent-portal/documents?limit=50&offset=300`, {
    headers: { Authorization: `Bearer ${parentToken}` },
  });
  assert.equal(pageDeep.status, 200);
  assert.equal(pageDeep.body.documents?.length, 20, "offset 300 must return remaining matching rows");
  assert.equal(pageDeep.body.hasMore, false);
  assert.ok(
    (pageDeep.body.documents || []).every((d: { title: string }) => String(d.title).startsWith("Match")),
    "deep page must not include non-matching OTHER-CLASS docs"
  );

  // Teacher cannot create school-wide via JSON staff endpoint
  const teachSchoolWide = await json(`/api/parent-portal/staff/documents`, {
    method: "POST",
    headers: { Authorization: teacherTok },
    body: JSON.stringify({
      schoolId: schoolA.id,
      title: "School wide attempt",
      fileUrl: "http://127.0.0.1/uploads/teacher-app/x.pdf",
      fileName: "x.pdf",
    }),
  });
  assert.equal(teachSchoolWide.status, 403);
  assert.equal(teachSchoolWide.body.code, "TARGETING_DENIED");

  // Teacher can create for assigned class
  const teachClass = await json(`/api/parent-portal/staff/documents`, {
    method: "POST",
    headers: { Authorization: teacherTok },
    body: JSON.stringify({
      schoolId: schoolA.id,
      title: "Class doc",
      className: "P1-4A",
      fileUrl: "http://127.0.0.1/uploads/teacher-app/c.pdf",
      fileName: "c.pdf",
    }),
  });
  assert.equal(teachClass.status, 200, JSON.stringify(teachClass.body));

  // Cross-school list denied
  const cross = await json(
    `/api/school-parent-documents?schoolId=${encodeURIComponent(schoolA.id)}`,
    { headers: { Authorization: otherTok } }
  );
  assert.ok(cross.status === 403 || cross.status === 401, `cross-school expected deny got ${cross.status}`);

  // Admin list ok
  const adminList = await json(
    `/api/school-parent-documents?schoolId=${encodeURIComponent(schoolA.id)}&limit=5`,
    { headers: { Authorization: adminTok } }
  );
  assert.equal(adminList.status, 200, JSON.stringify(adminList.body));
  assert.ok((adminList.body.total || 0) >= 320);

  // Notifications overview school-scoped, no message bodies
  await prisma.parentNotification.create({
    data: {
      schoolId: schoolA.id,
      parentId: parent.id,
      learnerId: learner.id,
      type: "DOCUMENT",
      title: "Overview title",
      message: "SECRET_BODY_SHOULD_NOT_LEAK",
      isRead: false,
    },
  });
  const overview = await json(
    `/api/school-notifications-overview?schoolId=${encodeURIComponent(schoolA.id)}`,
    { headers: { Authorization: adminTok } }
  );
  assert.equal(overview.status, 200, JSON.stringify(overview.body));
  assert.ok((overview.body.inApp?.created || 0) >= 1);
  const blob = JSON.stringify(overview.body);
  assert.equal(blob.includes("SECRET_BODY_SHOULD_NOT_LEAK"), false, "must not expose message bodies");

  const overviewCross = await json(
    `/api/school-notifications-overview?schoolId=${encodeURIComponent(schoolA.id)}`,
    { headers: { Authorization: otherTok } }
  );
  assert.ok(
    overviewCross.status === 403 || overviewCross.status === 401,
    `overview cross-school deny got ${overviewCross.status}`
  );

  // Queue process must not auto-fire from overview/list (sanity: process still Owner/Admin gated)
  const teachProcess = await json(`/api/communication-engine/queue/process`, {
    method: "POST",
    headers: { Authorization: teacherTok },
    body: JSON.stringify({ schoolId: schoolA.id }),
  });
  assert.equal(teachProcess.status, 403);

  console.log("schoolParentDocuments.p1.security.test: PASS");
  await cleanup();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
