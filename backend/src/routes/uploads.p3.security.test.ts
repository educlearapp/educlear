/**
 * P3 — remaining upload security (parent-messages + ops paths + logos allowlist).
 * Run: npx tsx src/routes/uploads.p3.security.test.ts
 * Requires local API on :3000 (or PP20_P3_API_BASE).
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { STAFF_JWT_SECRET } from "../utils/staffJwt";
import { signParentToken } from "../middleware/parentAuth";
import { ensureSchoolModuleEntitlements } from "../services/schoolModuleEntitlements";

const prisma = new PrismaClient();
const PREFIX = "pp20p3-";
const API = process.env.PP20_P3_API_BASE || "http://127.0.0.1:3000";
const MSG_DIR = path.join(process.cwd(), "uploads/parent-messages");

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
    await prisma.parentTeacherMessage.deleteMany({ where: { schoolId: s.id } });
    await prisma.parentTeacherThread.deleteMany({ where: { schoolId: s.id } });
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

async function raw(pathName: string, opts: RequestInit = {}) {
  const res = await fetch(`${API}${pathName}`, opts);
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

async function json(pathName: string, opts: RequestInit = {}) {
  const res = await fetch(`${API}${pathName}`, {
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
  if (!fs.existsSync(MSG_DIR)) fs.mkdirSync(MSG_DIR, { recursive: true });
  const fileName = `p3-${stamp}.txt`;
  const abs = path.join(MSG_DIR, fileName);
  fs.writeFileSync(abs, "P3-PARENT-MSG-SECRET");
  const before = fs.statSync(abs);

  // Ops marker files (must not be publicly downloadable; do not delete)
  const resetDir = path.join(process.cwd(), "uploads/reset-backups");
  if (!fs.existsSync(resetDir)) fs.mkdirSync(resetDir, { recursive: true });
  const resetMarker = path.join(resetDir, `p3-marker-${stamp}.json`);
  fs.writeFileSync(resetMarker, JSON.stringify({ marker: true }));

  const schoolA = await prisma.school.create({
    data: {
      id: `${PREFIX}a-${stamp}`,
      name: "P3 A",
      email: `p3a-${stamp}@t.local`,
      lifecycleStatus: "ACTIVE",
    },
  });
  const schoolB = await prisma.school.create({
    data: {
      id: `${PREFIX}b-${stamp}`,
      name: "P3 B",
      email: `p3b-${stamp}@t.local`,
      lifecycleStatus: "ACTIVE",
    },
  });
  await ensureSchoolModuleEntitlements(schoolA.id);
  await ensureSchoolModuleEntitlements(schoolB.id);

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
      name: "P3-1A",
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
      cellNo: "0820000011",
      idNumber: `P3${stamp}`.replace(/\W/g, "").slice(0, 13).padEnd(13, "0"),
    },
  });
  const learner = await prisma.learner.create({
    data: {
      id: `${PREFIX}l1-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Kid",
      lastName: "One",
      grade: "1",
      className: "P3-1A",
      enrollmentStatus: "ACTIVE",
    },
  });
  await prisma.parentLearnerLink.create({
    data: { schoolId: schoolA.id, parentId: parent.id, learnerId: learner.id },
  });

  const thread = await prisma.parentTeacherThread.create({
    data: {
      schoolId: schoolA.id,
      parentId: parent.id,
      learnerId: learner.id,
      classroomId: room.id,
      teacherEmail: teacher.email,
      teacherName: "Teacher",
      assignedTeacherId: teacher.id,
    },
  });
  const msg = await prisma.parentTeacherMessage.create({
    data: {
      threadId: thread.id,
      schoolId: schoolA.id,
      senderType: "TEACHER",
      senderName: "Teacher",
      body: "See attachment",
      attachments: [
        {
          name: "note.txt",
          url: `http://127.0.0.1:3000/uploads/parent-messages/${fileName}`,
          mimeType: "text/plain",
        },
      ],
    },
  });

  const parentTok = signParentToken({ parentId: parent.id, schoolId: schoolA.id });
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

  // Anonymous parent-message URL denied
  const pub = await raw(`/uploads/parent-messages/${fileName}`);
  assert.equal(pub.status, 401);
  assert.equal(pub.text.includes("P3-PARENT-MSG-SECRET"), false);

  // Ops paths denied (no public download endpoints)
  for (const p of [
    `/uploads/reset-backups/p3-marker-${stamp}.json`,
    `/uploads/migration-staging/`,
    `/uploads/migration-centre/`,
  ]) {
    const r = await raw(p);
    assert.equal(r.status, 401, `${p} expected 401 got ${r.status}`);
  }

  // School logos still public
  const logos = await raw(`/uploads/school-logos/`);
  assert.notEqual(logos.status, 401, "school-logos must remain public");

  // Catch-all removed — unknown private-ish path should not serve as public static
  const unknown = await raw(`/uploads/does-not-exist-xyz/`);
  assert.ok(unknown.status === 404 || unknown.status === 401);

  // Thread mapping strips public url
  const threadRes = await json(`/api/parent-portal/thread?learnerId=${encodeURIComponent(learner.id)}`, {
    headers: { Authorization: `Bearer ${parentTok}` },
  });
  assert.equal(threadRes.status, 200, JSON.stringify(threadRes.body));
  const mapped = (threadRes.body.thread?.messages || []).find((m: { id: string }) => m.id === msg.id);
  assert.ok(mapped);
  assert.equal(mapped.attachments?.[0]?.url, null);
  assert.ok(String(mapped.attachments?.[0]?.downloadPath || "").includes(`/messages/${msg.id}/attachments/0`));

  // Parent authorised download
  const parentDl = await raw(`/api/parent-portal/messages/${msg.id}/attachments/0`, {
    headers: { Authorization: `Bearer ${parentTok}` },
  });
  assert.equal(parentDl.status, 200, parentDl.text.slice(0, 120));
  assert.ok(parentDl.text.includes("P3-PARENT-MSG-SECRET"));
  assert.ok(String(parentDl.headers.get("cache-control") || "").includes("no-store"));

  // Teacher authorised download
  const teachDl = await raw(
    `/api/teacher-inbox/messages/${msg.id}/attachments/0?schoolId=${encodeURIComponent(schoolA.id)}`,
    { headers: { Authorization: teacherTok } }
  );
  assert.equal(teachDl.status, 200, teachDl.text.slice(0, 120));

  // Cross-school denied
  const cross = await raw(
    `/api/teacher-inbox/messages/${msg.id}/attachments/0?schoolId=${encodeURIComponent(schoolA.id)}`,
    { headers: { Authorization: otherTok } }
  );
  assert.ok(cross.status === 403 || cross.status === 401, `cross got ${cross.status}`);

  // Forged message id
  const forged = await raw(`/api/parent-portal/messages/not-real/attachments/0`, {
    headers: { Authorization: `Bearer ${parentTok}` },
  });
  assert.equal(forged.status, 404);

  // Path traversal index / name
  const trav = await raw(`/api/parent-portal/messages/${msg.id}/attachments/../0`, {
    headers: { Authorization: `Bearer ${parentTok}` },
  });
  assert.ok(trav.status === 404 || trav.status === 400);

  // Files unchanged
  assert.equal(fs.readFileSync(abs, "utf8"), "P3-PARENT-MSG-SECRET");
  assert.equal(fs.statSync(abs).size, before.size);
  assert.ok(fs.existsSync(resetMarker));

  console.log("uploads.p3.security.test: PASS");
  await cleanup();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
