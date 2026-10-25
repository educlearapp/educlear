/**
 * P0 communication-engine queue tenancy + role gates (local API; mocked dispatch via unit tests).
 * SAFE TARGET: localhost PostgreSQL only.
 *
 * Run: npx tsx src/routes/communicationEngine.p0.security.test.ts
 * Requires local API on :3000 (or CQ_P0_API_BASE) with this branch compiled.
 */
import assert from "assert";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { STAFF_JWT_SECRET } from "../utils/staffJwt";
import {
  processCommunicationQueueBatch,
  setCommunicationQueueDispatchForTests,
} from "../communication/communicationQueue";

const prisma = new PrismaClient();
const PREFIX = "cqeng-p0-";
const API = process.env.CQ_P0_API_BASE || "http://127.0.0.1:3000";

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

function bearer(user: { id: string; schoolId: string; email: string; role?: string }) {
  return `Bearer ${jwt.sign(
    {
      userId: user.id,
      schoolId: user.schoolId,
      email: user.email,
      role: user.role || "SCHOOL_ADMIN",
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
    await prisma.communicationLog.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.communicationMessage.deleteMany({ where: { schoolId: s.id } });
    await prisma.userRbacMeta.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { schoolId: s.id } });
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
  setCommunicationQueueDispatchForTests(null);
  await cleanup();

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  const schoolA = await prisma.school.create({
    data: {
      id: `${PREFIX}a-${stamp}`,
      name: "Eng A",
      email: `enga-${stamp}@t.local`,
      lifecycleStatus: "ACTIVE",
    },
  });
  const schoolB = await prisma.school.create({
    data: {
      id: `${PREFIX}b-${stamp}`,
      name: "Eng B",
      email: `engb-${stamp}@t.local`,
      lifecycleStatus: "ACTIVE",
    },
  });

  const ownerA = await prisma.user.create({
    data: {
      id: `${PREFIX}oa-${stamp}`,
      schoolId: schoolA.id,
      email: `oa-${stamp}@t.local`,
      passwordHash: "x",
      fullName: "Owner A",
      role: "SCHOOL_ADMIN",
      isActive: true,
    },
  });
  await prisma.userRbacMeta.upsert({
    where: { userId: ownerA.id },
    create: { userId: ownerA.id, schoolId: schoolA.id, appRole: "Owner", permissions: {} },
    update: { appRole: "Owner", schoolId: schoolA.id },
  });

  const teacherA = await prisma.user.create({
    data: {
      id: `${PREFIX}ta-${stamp}`,
      schoolId: schoolA.id,
      email: `ta-${stamp}@t.local`,
      passwordHash: "x",
      fullName: "Teacher A",
      role: "STAFF",
      isActive: true,
    },
  });
  await prisma.userRbacMeta.upsert({
    where: { userId: teacherA.id },
    create: { userId: teacherA.id, schoolId: schoolA.id, appRole: "Teacher", permissions: {} },
    update: { appRole: "Teacher", schoolId: schoolA.id },
  });

  const ownerB = await prisma.user.create({
    data: {
      id: `${PREFIX}ob-${stamp}`,
      schoolId: schoolB.id,
      email: `ob-${stamp}@t.local`,
      passwordHash: "x",
      fullName: "Owner B",
      role: "SCHOOL_ADMIN",
      isActive: true,
    },
  });
  await prisma.userRbacMeta.upsert({
    where: { userId: ownerB.id },
    create: { userId: ownerB.id, schoolId: schoolB.id, appRole: "Owner", permissions: {} },
    update: { appRole: "Owner", schoolId: schoolB.id },
  });

  const tokA = bearer({ id: ownerA.id, schoolId: schoolA.id, email: ownerA.email });
  const tokTeacher = bearer({
    id: teacherA.id,
    schoolId: schoolA.id,
    email: teacherA.email,
    role: "STAFF",
  });
  const tokB = bearer({ id: ownerB.id, schoolId: schoolB.id, email: ownerB.email });

  const msgA = await prisma.communicationMessage.create({
    data: {
      schoolId: schoolA.id,
      category: "homework_added",
      channel: "email",
      subject: "A mail",
      body: "body",
      recipient: "parent-a@test.local",
      status: "queued",
    },
  });
  const msgB = await prisma.communicationMessage.create({
    data: {
      schoolId: schoolB.id,
      category: "homework_added",
      channel: "email",
      subject: "B mail",
      body: "body",
      recipient: "parent-b@test.local",
      status: "queued",
    },
  });

  // Unauthenticated
  const unauth = await json("/api/communication-engine/queue/process", {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert.ok([401, 403].includes(unauth.status), `unauth ${unauth.status}`);

  // Teacher cannot process
  const teacherProc = await json("/api/communication-engine/queue/process", {
    method: "POST",
    headers: { Authorization: tokTeacher },
    body: JSON.stringify({ schoolId: schoolA.id }),
  });
  assert.equal(teacherProc.status, 403);

  // Forged schoolId from Owner A claiming B
  const forged = await json("/api/communication-engine/queue/process", {
    method: "POST",
    headers: { Authorization: tokA },
    body: JSON.stringify({ schoolId: schoolB.id }),
  });
  assert.equal(forged.status, 403);

  // Preview dry-run — no status change
  const preview = await json(`/api/communication-engine/queue/preview?schoolId=${schoolA.id}`, {
    headers: { Authorization: tokA },
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.dryRun, true);
  assert.equal(preview.body.sent, false);
  assert.ok(preview.body.count >= 1);
  assert.equal((await prisma.communicationMessage.findUnique({ where: { id: msgA.id } }))?.status, "queued");

  // Process with dryRun body
  const dry = await json("/api/communication-engine/queue/process", {
    method: "POST",
    headers: { Authorization: tokA },
    body: JSON.stringify({ schoolId: schoolA.id, dryRun: true }),
  });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.dryRun, true);
  assert.equal(dry.body.processed, 0);
  assert.equal((await prisma.communicationMessage.findUnique({ where: { id: msgA.id } }))?.status, "queued");
  assert.equal((await prisma.communicationMessage.findUnique({ where: { id: msgB.id } }))?.status, "queued");

  // Cross-school list denied when forged query
  const listForge = await json(`/api/communication-engine/messages?schoolId=${schoolB.id}`, {
    headers: { Authorization: tokA },
  });
  assert.equal(listForge.status, 403);

  // Owner A can list own school
  const listA = await json(`/api/communication-engine/messages?schoolId=${schoolA.id}&status=queued`, {
    headers: { Authorization: tokA },
  });
  assert.equal(listA.status, 200);
  assert.ok((listA.body.items || []).every((m: any) => m.schoolId === schoolA.id));

  // Retry B as A → not found / denied
  await prisma.communicationMessage.update({
    where: { id: msgB.id },
    data: { status: "failed", error: "x" },
  });
  const retryCross = await json(`/api/communication-engine/messages/${msgB.id}/retry`, {
    method: "POST",
    headers: { Authorization: tokA },
    body: JSON.stringify({ schoolId: schoolA.id }),
  });
  assert.ok([403, 404].includes(retryCross.status), `cross retry ${retryCross.status}`);

  // Teacher cannot retry
  await prisma.communicationMessage.update({
    where: { id: msgA.id },
    data: { status: "failed", error: "x" },
  });
  const teacherRetry = await json(`/api/communication-engine/messages/${msgA.id}/retry`, {
    method: "POST",
    headers: { Authorization: tokTeacher },
    body: JSON.stringify({ schoolId: schoolA.id }),
  });
  assert.equal(teacherRetry.status, 403);

  // Direct service: A process with mock does not touch B (still failed/queued independently)
  setCommunicationQueueDispatchForTests(async () => ({
    ok: false,
    simulated: true,
    error: "sms_provider_not_ready",
  }));
  await prisma.communicationMessage.update({
    where: { id: msgA.id },
    data: { status: "queued", error: null, failedAt: null, sendingAt: null, sentAt: null },
  });
  const batch = await processCommunicationQueueBatch(prisma, { schoolId: schoolA.id, limit: 10 });
  assert.ok(batch.results.every((r) => r.status === "failed"));
  assert.ok(batch.results.every((r) => r.simulated === true));
  assert.equal((await prisma.communicationMessage.findUnique({ where: { id: msgA.id } }))?.status, "failed");
  assert.notEqual((await prisma.communicationMessage.findUnique({ where: { id: msgA.id } }))?.status, "sent");

  // Owner B can still see B message
  const listB = await json(`/api/communication-engine/messages?schoolId=${schoolB.id}`, {
    headers: { Authorization: tokB },
  });
  assert.equal(listB.status, 200);

  setCommunicationQueueDispatchForTests(null);
  await cleanup();
  console.log("communicationEngine.p0.security.test: PASS");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    setCommunicationQueueDispatchForTests(null);
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  });
