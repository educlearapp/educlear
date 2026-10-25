/**
 * P0 queue safety — unit checks (mocked dispatch; no live providers).
 * Run: npx tsx src/communication/communicationQueue.unit.test.ts
 */
import assert from "assert";
import {
  isRealDeliverySuccess,
  previewCommunicationQueueBatch,
  processCommunicationQueueBatch,
  retryCommunicationMessage,
  setCommunicationQueueDispatchForTests,
} from "./communicationQueue";
import { sendWhatsAppPlaceholder } from "./communicationProviders/whatsappProvider";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PREFIX = "cq-p0-";

assert.equal(isRealDeliverySuccess({ ok: true, simulated: false }), true);
assert.equal(isRealDeliverySuccess({ ok: true, simulated: true }), false);
assert.equal(isRealDeliverySuccess({ ok: false, simulated: true }), false);

async function cleanup() {
  const schools = await prisma.school.findMany({
    where: { id: { startsWith: PREFIX } },
    select: { id: true },
  });
  for (const s of schools) {
    await prisma.communicationLog.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.communicationMessage.deleteMany({ where: { schoolId: s.id } });
    await prisma.school.delete({ where: { id: s.id } }).catch(() => undefined);
  }
}

async function main() {
  const url = String(process.env.DATABASE_URL || "");
  assert.ok(url.includes("localhost") || url.includes("127.0.0.1"), "local DB only");
  setCommunicationQueueDispatchForTests(null);
  await cleanup();

  const stamp = `${Date.now()}`;
  const schoolA = await prisma.school.create({
    data: {
      id: `${PREFIX}a-${stamp}`,
      name: "Queue School A",
      email: `a-${stamp}@q.test`,
      lifecycleStatus: "ACTIVE",
    },
  });
  const schoolB = await prisma.school.create({
    data: {
      id: `${PREFIX}b-${stamp}`,
      name: "Queue School B",
      email: `b-${stamp}@q.test`,
      lifecycleStatus: "ACTIVE",
    },
  });

  const msgA = await prisma.communicationMessage.create({
    data: {
      schoolId: schoolA.id,
      category: "homework_added",
      channel: "whatsapp",
      subject: "WA A",
      body: "hello",
      recipient: "+27820000001",
      status: "queued",
    },
  });
  const msgB = await prisma.communicationMessage.create({
    data: {
      schoolId: schoolB.id,
      category: "homework_added",
      channel: "sms",
      subject: "SMS B",
      body: "hello",
      recipient: "+27820000002",
      status: "queued",
    },
  });

  // WhatsApp provider never ok
  const wa = await sendWhatsAppPlaceholder({
    schoolId: schoolA.id,
    messageId: msgA.id,
    recipient: "+27820000001",
    subject: "x",
    body: "y",
  });
  assert.equal(wa.ok, false);
  assert.equal(wa.simulated, true);

  // Preview never mutates
  const preview = await previewCommunicationQueueBatch(prisma, { schoolId: schoolA.id, limit: 10 });
  assert.equal(preview.count, 1);
  assert.equal(preview.items[0].id, msgA.id);
  const stillQueued = await prisma.communicationMessage.findUnique({ where: { id: msgA.id } });
  assert.equal(stillQueued?.status, "queued");

  // Dry-run process
  const dry = await processCommunicationQueueBatch(prisma, {
    schoolId: schoolA.id,
    dryRun: true,
  });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.processed, 0);
  assert.equal((await prisma.communicationMessage.findUnique({ where: { id: msgA.id } }))?.status, "queued");

  // Simulated dispatch cannot produce sent
  setCommunicationQueueDispatchForTests(async () => ({
    ok: true,
    simulated: true,
    error: "should_not_send",
  }));
  const sim = await processCommunicationQueueBatch(prisma, { schoolId: schoolA.id, limit: 5 });
  assert.equal(sim.processed, 1);
  assert.equal(sim.results[0].status, "failed");
  assert.equal(sim.results[0].simulated, true);
  const afterSim = await prisma.communicationMessage.findUnique({ where: { id: msgA.id } });
  assert.equal(afterSim?.status, "failed");
  assert.equal(afterSim?.sentAt, null);

  // School A process must not touch School B
  assert.equal((await prisma.communicationMessage.findUnique({ where: { id: msgB.id } }))?.status, "queued");

  // Re-queue A and test real mock success
  await prisma.communicationMessage.update({
    where: { id: msgA.id },
    data: { status: "queued", error: null, failedAt: null, sendingAt: null },
  });
  setCommunicationQueueDispatchForTests(async () => ({
    ok: true,
    simulated: false,
    reference: "mock-real",
  }));
  const real = await processCommunicationQueueBatch(prisma, { schoolId: schoolA.id });
  assert.equal(real.results[0].status, "sent");
  assert.equal((await prisma.communicationMessage.findUnique({ where: { id: msgA.id } }))?.status, "sent");

  // Concurrent claim: only one wins
  const raceMsg = await prisma.communicationMessage.create({
    data: {
      schoolId: schoolA.id,
      category: "homework_added",
      channel: "email",
      subject: "race",
      body: "x",
      recipient: "a@test.local",
      status: "queued",
    },
  });
  let calls = 0;
  setCommunicationQueueDispatchForTests(async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 30));
    return { ok: true, simulated: false, reference: "race" };
  });
  const [r1, r2] = await Promise.all([
    processCommunicationQueueBatch(prisma, { schoolId: schoolA.id, limit: 5 }),
    processCommunicationQueueBatch(prisma, { schoolId: schoolA.id, limit: 5 }),
  ]);
  const raceProcessed =
    r1.results.filter((x) => x.id === raceMsg.id).length +
    r2.results.filter((x) => x.id === raceMsg.id).length;
  assert.equal(raceProcessed, 1, "message processed once");
  assert.ok(calls <= 2);

  // Retry requires school ownership
  const failedB = await prisma.communicationMessage.create({
    data: {
      schoolId: schoolB.id,
      category: "homework_added",
      channel: "email",
      subject: "fail B",
      body: "x",
      recipient: "b@test.local",
      status: "failed",
      error: "x",
    },
  });
  const crossRetry = await retryCommunicationMessage(prisma, {
    messageId: failedB.id,
    schoolId: schoolA.id,
  });
  assert.equal(crossRetry.ok, false);
  assert.equal(crossRetry.error, "not_found");

  const okRetry = await retryCommunicationMessage(prisma, {
    messageId: failedB.id,
    schoolId: schoolB.id,
  });
  assert.equal(okRetry.ok, true);
  assert.equal((await prisma.communicationMessage.findUnique({ where: { id: failedB.id } }))?.status, "queued");

  // schoolId required
  await assert.rejects(
    () => processCommunicationQueueBatch(prisma, { schoolId: "" } as any),
    /schoolId/
  );

  // Historical sent unchanged by preview of other school
  const sentBefore = await prisma.communicationMessage.findUnique({ where: { id: msgA.id } });
  await previewCommunicationQueueBatch(prisma, { schoolId: schoolB.id });
  const sentAfter = await prisma.communicationMessage.findUnique({ where: { id: msgA.id } });
  assert.equal(sentBefore?.status, "sent");
  assert.equal(sentAfter?.status, "sent");
  assert.equal(String(sentBefore?.sentAt), String(sentAfter?.sentAt));

  setCommunicationQueueDispatchForTests(null);
  await cleanup();
  console.log("communicationQueue.unit.test: PASS");
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
