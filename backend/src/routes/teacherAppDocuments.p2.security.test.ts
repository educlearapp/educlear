/**
 * P2 — teacher-app document attachment security (local only).
 * Run: npx tsx src/routes/teacherAppDocuments.p2.security.test.ts
 * Requires API on :3000 (or PP20_P2_API_BASE).
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { STAFF_JWT_SECRET } from "../utils/staffJwt";
import { signParentToken } from "../middleware/parentAuth";
import { ensureSchoolModuleEntitlements } from "../services/schoolModuleEntitlements";
import { TEACHER_APP_UPLOAD_DIR } from "../services/teacherAppFileAccess";

const prisma = new PrismaClient();
const PREFIX = "pp20p2-";
const API = process.env.PP20_P2_API_BASE || "http://127.0.0.1:3000";

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
      role: user.role || "SCHOOL_ADMIN",
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
    await prisma.parentDocument.deleteMany({ where: { schoolId: s.id } });
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

async function json(pathName: string, opts: RequestInit = {}) {
  const res = await fetch(`${API}${pathName}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, headers: res.headers };
}

async function raw(pathName: string, opts: RequestInit = {}) {
  const res = await fetch(`${API}${pathName}`, opts);
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

async function main() {
  assertLocalDatabase();
  await cleanup();

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  if (!fs.existsSync(TEACHER_APP_UPLOAD_DIR)) {
    fs.mkdirSync(TEACHER_APP_UPLOAD_DIR, { recursive: true });
  }
  const fileName = `p2-${stamp}.txt`;
  const abs = path.join(TEACHER_APP_UPLOAD_DIR, fileName);
  fs.writeFileSync(abs, "P2-SECRET-ATTACHMENT-CONTENT");
  const beforeStat = fs.statSync(abs);

  const schoolA = await prisma.school.create({
    data: {
      id: `${PREFIX}a-${stamp}`,
      name: "P2 A",
      email: `p2a-${stamp}@t.local`,
      lifecycleStatus: "ACTIVE",
    },
  });
  const schoolB = await prisma.school.create({
    data: {
      id: `${PREFIX}b-${stamp}`,
      name: "P2 B",
      email: `p2b-${stamp}@t.local`,
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
  const room = await prisma.classroom.create({
    data: {
      schoolId: schoolA.id,
      name: "P2-4A",
      teacherEmail: teacher.email,
      teacherName: "Teacher",
    },
  });
  await prisma.classroomTeacher.create({
    data: {
      schoolId: schoolA.id,
      classroomId: room.id,
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
      cellNo: "0820000002",
      idNumber: `P2${stamp}`.replace(/\W/g, "").slice(0, 13).padEnd(13, "0"),
    },
  });
  const learner = await prisma.learner.create({
    data: {
      id: `${PREFIX}l1-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Kid",
      lastName: "One",
      grade: "4",
      className: "P2-4A",
      enrollmentStatus: "ACTIVE",
    },
  });
  await prisma.parentLearnerLink.create({
    data: { schoolId: schoolA.id, parentId: parent.id, learnerId: learner.id },
  });

  const outsiderParent = await prisma.parent.create({
    data: {
      id: `${PREFIX}px-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Out",
      surname: "Side",
      email: `out-${stamp}@t.local`,
      cellNo: "0820000003",
      idNumber: `PX${stamp}`.replace(/\W/g, "").slice(0, 13).padEnd(13, "0"),
    },
  });
  const otherLearner = await prisma.learner.create({
    data: {
      id: `${PREFIX}l2-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Other",
      lastName: "Kid",
      grade: "7",
      className: "OTHER-CLASS",
      enrollmentStatus: "ACTIVE",
    },
  });
  await prisma.parentLearnerLink.create({
    data: { schoolId: schoolA.id, parentId: outsiderParent.id, learnerId: otherLearner.id },
  });

  // Legacy absolute URL still on disk — must resolve via auth APIs only
  const doc = await prisma.parentDocument.create({
    data: {
      schoolId: schoolA.id,
      title: "P2 Secure Doc",
      className: "P2-4A",
      fileUrl: `http://127.0.0.1:3000/uploads/teacher-app/${fileName}`,
      fileName: "secure.txt",
      createdBy: teacher.email,
      createdByTeacherId: teacher.id,
      visibility: "CLASS_TEACHERS",
    },
  });

  const parentTok = signParentToken({ parentId: parent.id, schoolId: schoolA.id });
  const outsiderTok = signParentToken({ parentId: outsiderParent.id, schoolId: schoolA.id });
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

  // 1) Unauthenticated legacy URL denied
  const publicHit = await raw(`/uploads/teacher-app/${fileName}`);
  assert.equal(publicHit.status, 401, `public URL must be denied, got ${publicHit.status}`);
  assert.equal(publicHit.text.includes("P2-SECRET"), false);

  // Path traversal / forged names via authenticated download helpers
  const travName = await raw(`/api/parent-portal/documents/${encodeURIComponent("../etc/passwd")}/file`, {
    headers: { Authorization: `Bearer ${parentTok}` },
  });
  assert.ok(
    travName.status === 404 || travName.status === 400,
    `forged path id got ${travName.status}`
  );
  assert.equal(travName.text.includes("P2-SECRET"), false);

  // 2) Parent list must not expose public fileUrl
  const list = await json(`/api/parent-portal/documents?limit=20`, {
    headers: { Authorization: `Bearer ${parentTok}` },
  });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const row = (list.body.documents || []).find((d: { id: string }) => d.id === doc.id);
  assert.ok(row, "parent should see class document");
  assert.equal(row.fileUrl, null);
  assert.ok(String(row.downloadPath).includes(`/documents/${doc.id}/file`));

  // 3) Parent can download own visible doc
  const parentDl = await raw(`/api/parent-portal/documents/${doc.id}/file`, {
    headers: { Authorization: `Bearer ${parentTok}` },
  });
  assert.equal(parentDl.status, 200, parentDl.text.slice(0, 200));
  assert.ok(parentDl.text.includes("P2-SECRET-ATTACHMENT-CONTENT"));
  assert.ok(String(parentDl.headers.get("cache-control") || "").includes("no-store"));

  // 4) Unrelated parent denied
  const outDl = await raw(`/api/parent-portal/documents/${doc.id}/file`, {
    headers: { Authorization: `Bearer ${outsiderTok}` },
  });
  assert.ok(outDl.status === 404 || outDl.status === 403, `outsider got ${outDl.status}`);
  assert.equal(outDl.text.includes("P2-SECRET"), false);

  // 5) Teacher download ok
  const teachDl = await raw(`/api/teacher-app/documents/${doc.id}/file`, {
    headers: { Authorization: teacherTok },
  });
  assert.equal(teachDl.status, 200, teachDl.text.slice(0, 200));

  // 6) Admin via school-parent-documents ok
  const adminDl = await raw(
    `/api/school-parent-documents/${doc.id}/file?schoolId=${encodeURIComponent(schoolA.id)}`,
    { headers: { Authorization: adminTok } }
  );
  assert.equal(adminDl.status, 200);

  // 7) Cross-school denied
  const cross = await raw(
    `/api/school-parent-documents/${doc.id}/file?schoolId=${encodeURIComponent(schoolA.id)}`,
    { headers: { Authorization: otherTok } }
  );
  assert.ok(cross.status === 403 || cross.status === 401, `cross-school got ${cross.status}`);

  // 8) Forged document id
  const forged = await raw(`/api/parent-portal/documents/not-a-real-id/file`, {
    headers: { Authorization: `Bearer ${parentTok}` },
  });
  assert.equal(forged.status, 404);

  // 9) File unchanged on disk
  const afterStat = fs.statSync(abs);
  assert.equal(afterStat.size, beforeStat.size);
  assert.equal(fs.readFileSync(abs, "utf8"), "P2-SECRET-ATTACHMENT-CONTENT");

  // 10) School logos still public (unrelated upload path)
  const logoProbe = await raw(`/uploads/school-logos/`);
  assert.notEqual(logoProbe.status, 401, "school-logos must not inherit teacher-app deny");

  console.log("teacherAppDocuments.p2.security.test: PASS");
  await cleanup();
  // Leave synthetic file; cleanup does not delete uploads (no document file deletion)
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
