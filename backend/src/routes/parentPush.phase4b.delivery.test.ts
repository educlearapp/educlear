/**
 * Parent Portal Phase 4B — push delivery engine (mocked transport; no external send).
 * SAFE TARGET: localhost PostgreSQL only.
 *
 * Run: npx tsx src/routes/parentPush.phase4b.delivery.test.ts
 */
import assert from "assert";
import { PrismaClient } from "@prisma/client";
import { createParentNotification } from "../services/parentPortalService";
import {
  claimParentPushDelivery,
  enqueueParentPushDeliveriesForNotification,
  processClaimedParentPushDelivery,
  processParentPushDeliveryBatch,
} from "../services/parentPushDeliveryEngine";
import {
  MockPushTransport,
  setParentPushTransportForTests,
} from "../services/parentPushTransport";

const prisma = new PrismaClient();
const PREFIX = "pp20c4b-";

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
    `Refusing Phase 4B tests against non-local host: ${host || "(unknown)"}`
  );
}

async function cleanup() {
  const schools = await prisma.school.findMany({
    where: { id: { startsWith: PREFIX } },
    select: { id: true },
  });
  for (const s of schools) {
    await prisma.parentPushDelivery.deleteMany({ where: { schoolId: s.id } });
    await prisma.pushSubscription.deleteMany({ where: { schoolId: s.id } });
    await prisma.parentNotificationPreference.deleteMany({ where: { schoolId: s.id } });
    await prisma.parentNotification.deleteMany({ where: { schoolId: s.id } });
    await prisma.communicationLog.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.communicationMessage.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.parentLearnerLink.deleteMany({ where: { schoolId: s.id } });
    await prisma.parent.deleteMany({ where: { schoolId: s.id } });
    await prisma.learner.deleteMany({ where: { schoolId: s.id } });
    await prisma.school.delete({ where: { id: s.id } }).catch(() => undefined);
  }
}

async function main() {
  assertLocalDatabase();
  const prevFlag = process.env.WEB_PUSH_DELIVERY_ENABLED;
  process.env.WEB_PUSH_DELIVERY_ENABLED = "false";
  setParentPushTransportForTests(null);
  await cleanup();

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const schoolA = await prisma.school.create({
    data: {
      id: `${PREFIX}a-${stamp}`,
      name: "Phase4B School A",
      email: `c4b-a-${stamp}@test.local`,
      lifecycleStatus: "ACTIVE",
    },
  });
  const schoolB = await prisma.school.create({
    data: {
      id: `${PREFIX}b-${stamp}`,
      name: "Phase4B School B",
      email: `c4b-b-${stamp}@test.local`,
      lifecycleStatus: "ACTIVE",
    },
  });

  const parentA = await prisma.parent.create({
    data: {
      id: `${PREFIX}pa-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Parent",
      surname: "Alpha",
      email: `pa-${stamp}@test.local`,
      cellNo: "0821000001",
      idNumber: `C4B${stamp}`.replace(/\W/g, "").slice(0, 13).padEnd(13, "0"),
    },
  });
  const parentB = await prisma.parent.create({
    data: {
      id: `${PREFIX}pb-${stamp}`,
      schoolId: schoolB.id,
      firstName: "Parent",
      surname: "Beta",
      email: `pb-${stamp}@test.local`,
      cellNo: "0821000002",
      idNumber: `C4Bb${stamp}`.replace(/\W/g, "").slice(0, 13).padEnd(13, "0"),
    },
  });

  const kid1 = await prisma.learner.create({
    data: {
      id: `${PREFIX}l1-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Kid",
      lastName: "One",
      grade: "3",
    },
  });
  const kid2 = await prisma.learner.create({
    data: {
      id: `${PREFIX}l2-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Kid",
      lastName: "Two",
      grade: "5",
    },
  });
  await prisma.parentLearnerLink.createMany({
    data: [
      { schoolId: schoolA.id, parentId: parentA.id, learnerId: kid1.id, relation: "Mother" },
      { schoolId: schoolA.id, parentId: parentA.id, learnerId: kid2.id, relation: "Mother" },
    ],
  });

  await prisma.parentNotificationPreference.create({
    data: {
      schoolId: schoolA.id,
      parentId: parentA.id,
      pushEnabled: true,
      pushTeacherMessages: true,
      pushAnnouncements: true,
      pushEvents: true,
      lockScreenPreview: false,
    },
  });

  const sub1 = await prisma.pushSubscription.create({
    data: {
      schoolId: schoolA.id,
      parentId: parentA.id,
      endpoint: `https://fcm.googleapis.com/fcm/send/c4b-${stamp}-d1`,
      keys: { p256dh: "p1", auth: "a1" },
      enabled: true,
      deviceLabel: "Device 1",
    },
  });
  const sub2 = await prisma.pushSubscription.create({
    data: {
      schoolId: schoolA.id,
      parentId: parentA.id,
      endpoint: `https://fcm.googleapis.com/fcm/send/c4b-${stamp}-d2`,
      keys: { p256dh: "p2", auth: "a2" },
      enabled: true,
      deviceLabel: "Device 2",
    },
  });
  // Cross-school noise
  await prisma.pushSubscription.create({
    data: {
      schoolId: schoolB.id,
      parentId: parentB.id,
      endpoint: `https://fcm.googleapis.com/fcm/send/c4b-${stamp}-b`,
      keys: { p256dh: "pb", auth: "ab" },
      enabled: true,
    },
  });

  // ——— First eligible notification creates one delivery per device ———
  const teacherNotif = await createParentNotification({
    schoolId: schoolA.id,
    parentId: parentA.id,
    learnerId: kid1.id,
    type: "TEACHER_MESSAGE",
    title: "New message from teacher",
    message: "Please bring kit tomorrow for Kid One",
    metadata: { threadId: `thread-${stamp}` },
  });
  let deliveries = await prisma.parentPushDelivery.findMany({
    where: { parentNotificationId: teacherNotif.id },
  });
  assert.equal(deliveries.length, 2, "two devices → two deliveries");
  assert.ok(deliveries.every((d) => d.schoolId === schoolA.id && d.parentId === parentA.id));
  assert.ok(deliveries.every((d) => d.status === "queued"));
  assert.ok(deliveries.every((d) => d.externalSent === false));

  // ——— Feature flag OFF suppresses external send ———
  const batchOff = await processParentPushDeliveryBatch({
    workerId: "w-off",
    schoolId: schoolA.id,
    limit: 10,
  });
  assert.ok(batchOff.processed >= 1);
  deliveries = await prisma.parentPushDelivery.findMany({
    where: { parentNotificationId: teacherNotif.id },
  });
  assert.ok(deliveries.every((d) => d.status === "suppressed"));
  assert.ok(deliveries.every((d) => d.externalSent === false));

  // Reset to queued for further tests
  await prisma.parentPushDelivery.updateMany({
    where: { parentNotificationId: teacherNotif.id },
    data: {
      status: "queued",
      error: null,
      attemptCount: 0,
      nextAttemptAt: null,
      claimedAt: null,
      claimedBy: null,
    },
  });

  // ——— Mock transport with flag ON → mock_ok, never externalSent ———
  process.env.WEB_PUSH_DELIVERY_ENABLED = "true";
  const mock = new MockPushTransport();
  setParentPushTransportForTests(mock);
  const batchMock = await processParentPushDeliveryBatch({
    workerId: "w-mock",
    schoolId: schoolA.id,
    limit: 10,
  });
  assert.equal(batchMock.processed, 2);
  assert.ok(batchMock.results.every((r) => r.status === "mock_ok" && r.externalSent === false));
  assert.equal(mock.sent.length, 2);
  for (const s of mock.sent) {
    assert.equal(s.payload.lockScreenPreview, false);
    assert.equal(s.payload.body, undefined);
    assert.ok(!JSON.stringify(s.payload).toLowerCase().includes("kid"));
  }
  deliveries = await prisma.parentPushDelivery.findMany({
    where: { parentNotificationId: teacherNotif.id },
  });
  assert.ok(deliveries.every((d) => d.status === "mock_ok" && d.externalSent === false));

  // Read state preserved
  const notifAfter = await prisma.parentNotification.findUnique({ where: { id: teacherNotif.id } });
  assert.equal(notifAfter?.isRead, false);

  // ——— Announcement + event ———
  await prisma.parentPushDelivery.deleteMany({ where: { parentNotificationId: teacherNotif.id } });
  const notice = await createParentNotification({
    schoolId: schoolA.id,
    parentId: parentA.id,
    type: "SCHOOL_NOTICE",
    title: "Term notice",
    message: "Assembly at 10",
    metadata: { noticeId: `notice-${stamp}` },
  });
  assert.equal(
    (await prisma.parentPushDelivery.count({ where: { parentNotificationId: notice.id } })),
    2
  );

  const event = await createParentNotification({
    schoolId: schoolA.id,
    parentId: parentA.id,
    type: "SCHOOL_EVENT",
    title: "Sports day",
    message: "Friday",
    metadata: { eventId: `event-${stamp}` },
  });
  assert.equal(
    (await prisma.parentPushDelivery.count({ where: { parentNotificationId: event.id } })),
    2
  );

  // ——— Billing / unsupported excluded ———
  const invoice = await createParentNotification({
    schoolId: schoolA.id,
    parentId: parentA.id,
    type: "INVOICE_READY",
    title: "Invoice ready",
    message: "Balance due",
    metadata: { month: "2026-10" },
  });
  assert.equal(
    await prisma.parentPushDelivery.count({ where: { parentNotificationId: invoice.id } }),
    0
  );

  // ——— Disabled preferences suppress ———
  await prisma.parentNotificationPreference.update({
    where: { parentId: parentA.id },
    data: { pushEnabled: false },
  });
  const suppressed = await createParentNotification({
    schoolId: schoolA.id,
    parentId: parentA.id,
    type: "TEACHER_MESSAGE",
    title: "Should not push",
    message: "x",
    metadata: { threadId: `thread-off-${stamp}` },
  });
  assert.equal(
    await prisma.parentPushDelivery.count({ where: { parentNotificationId: suppressed.id } }),
    0
  );
  await prisma.parentNotificationPreference.update({
    where: { parentId: parentA.id },
    data: { pushEnabled: true },
  });

  // ——— Quiet hours defer ———
  const quietNow = new Date();
  quietNow.setHours(23, 15, 0, 0);
  await prisma.parentNotificationPreference.update({
    where: { parentId: parentA.id },
    data: { quietHoursStart: "22:00", quietHoursEnd: "06:00" },
  });
  const quietNotif = await createParentNotification({
    schoolId: schoolA.id,
    parentId: parentA.id,
    type: "SCHOOL_NOTICE",
    title: "Quiet notice",
    message: "Night",
    metadata: { noticeId: `quiet-${stamp}` },
  });
  // createParentNotification uses Date.now internally for enqueue — re-enqueue with forced now
  await prisma.parentPushDelivery.deleteMany({ where: { parentNotificationId: quietNotif.id } });
  const enq = await enqueueParentPushDeliveriesForNotification(quietNotif, quietNow);
  assert.equal(enq.created, 2);
  const deferred = await prisma.parentPushDelivery.findMany({
    where: { parentNotificationId: quietNotif.id },
  });
  assert.ok(deferred.every((d) => d.status === "deferred"));
  assert.ok(deferred.every((d) => d.nextAttemptAt != null));

  await prisma.parentNotificationPreference.update({
    where: { parentId: parentA.id },
    data: { quietHoursStart: null, quietHoursEnd: null },
  });

  // ——— Republish does not duplicate (content dedupe) ———
  const again = await createParentNotification({
    schoolId: schoolA.id,
    parentId: parentA.id,
    type: "SCHOOL_NOTICE",
    title: "Term notice",
    message: "Assembly at 10",
    metadata: { noticeId: `notice-${stamp}` },
  });
  assert.equal(again.id, notice.id);
  assert.equal(
    await prisma.parentPushDelivery.count({ where: { parentNotificationId: notice.id } }),
    2,
    "republish must not add deliveries"
  );

  // ——— Concurrent claim ———
  const claimNotif = await prisma.parentNotification.create({
    data: {
      schoolId: schoolA.id,
      parentId: parentA.id,
      type: "TEACHER_MESSAGE",
      title: "Claim race",
      message: "x",
      isRead: false,
    },
  });
  const claimTarget = await prisma.parentPushDelivery.create({
    data: {
      schoolId: schoolA.id,
      parentId: parentA.id,
      parentNotificationId: claimNotif.id,
      subscriptionId: sub1.id,
      status: "queued",
    },
  });

  const [c1, c2] = await Promise.all([
    claimParentPushDelivery({ deliveryId: claimTarget.id, workerId: "worker-a" }),
    claimParentPushDelivery({ deliveryId: claimTarget.id, workerId: "worker-b" }),
  ]);
  assert.equal(Number(c1) + Number(c2), 1, "only one worker claims");

  // Finish claimed with mock
  mock.nextResult = { ok: true, externalSent: false, simulated: true, reference: "mock-ok" };
  const winner = c1 ? "worker-a" : "worker-b";
  await processClaimedParentPushDelivery({ deliveryId: claimTarget.id, workerId: winner });

  // ——— 404/410 expires subscription ———
  const expNotif = await prisma.parentNotification.create({
    data: {
      schoolId: schoolA.id,
      parentId: parentA.id,
      type: "TEACHER_MESSAGE",
      title: "Expire test",
      message: "x",
      isRead: false,
    },
  });
  const expSub = await prisma.pushSubscription.create({
    data: {
      schoolId: schoolA.id,
      parentId: parentA.id,
      endpoint: `https://fcm.googleapis.com/fcm/send/c4b-${stamp}-exp`,
      keys: { p256dh: "pe", auth: "ae" },
      enabled: true,
    },
  });
  const expDel = await prisma.parentPushDelivery.create({
    data: {
      schoolId: schoolA.id,
      parentId: parentA.id,
      parentNotificationId: expNotif.id,
      subscriptionId: expSub.id,
      status: "queued",
    },
  });
  mock.failWithStatus = 410;
  assert.equal(await claimParentPushDelivery({ deliveryId: expDel.id, workerId: "w-exp" }), true);
  const expOut = await processClaimedParentPushDelivery({ deliveryId: expDel.id, workerId: "w-exp" });
  assert.equal(expOut.status, "expired");
  const expSubAfter = await prisma.pushSubscription.findUnique({ where: { id: expSub.id } });
  assert.equal(expSubAfter?.enabled, false);
  mock.failWithStatus = null;

  // ——— Retry / backoff ———
  const retryNotif = await prisma.parentNotification.create({
    data: {
      schoolId: schoolA.id,
      parentId: parentA.id,
      type: "SCHOOL_EVENT",
      title: "Retry",
      message: "x",
      isRead: false,
    },
  });
  const retryDel = await prisma.parentPushDelivery.create({
    data: {
      schoolId: schoolA.id,
      parentId: parentA.id,
      parentNotificationId: retryNotif.id,
      subscriptionId: sub2.id,
      status: "queued",
      attemptCount: 0,
    },
  });
  mock.nextResult = { ok: false, externalSent: false, simulated: true, error: "mock_temp_fail", statusCode: 500 };
  assert.equal(await claimParentPushDelivery({ deliveryId: retryDel.id, workerId: "w-retry" }), true);
  const retryOut = await processClaimedParentPushDelivery({ deliveryId: retryDel.id, workerId: "w-retry" });
  assert.equal(retryOut.status, "failed");
  const retryRow = await prisma.parentPushDelivery.findUnique({ where: { id: retryDel.id } });
  assert.equal(retryRow?.attemptCount, 1);
  assert.ok(retryRow?.nextAttemptAt);
  assert.equal(retryRow?.externalSent, false);

  // Cross-school: parent B deliveries never created for school A notifs
  assert.equal(
    await prisma.parentPushDelivery.count({
      where: { parentNotificationId: notice.id, parentId: parentB.id },
    }),
    0
  );

  // Multiple children → one content notification still (uniqueParentLearnerLinks at caller);
  // here one parent already has one notice with 2 device deliveries — content is one row.
  assert.equal(
    await prisma.parentNotification.count({
      where: {
        parentId: parentA.id,
        metadata: { path: ["noticeId"], equals: `notice-${stamp}` },
      },
    }),
    1
  );

  process.env.WEB_PUSH_DELIVERY_ENABLED = prevFlag;
  setParentPushTransportForTests(null);
  await cleanup();
  console.log("parentPush.phase4b.delivery.test: PASS");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    process.env.WEB_PUSH_DELIVERY_ENABLED = undefined;
    setParentPushTransportForTests(null);
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  });
