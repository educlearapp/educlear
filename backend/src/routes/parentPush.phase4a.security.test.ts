/**
 * Parent Portal Phase 4A — push subscription + preference security (no live Web Push).
 * SAFE TARGET: localhost PostgreSQL only. Synthetic fixtures cleaned after run.
 *
 * Requires local API on :3000 (or PP20_C4A_API_BASE).
 * Run: npx tsx src/routes/parentPush.phase4a.security.test.ts
 */
import assert from "assert";
import { PrismaClient } from "@prisma/client";
import { signParentToken } from "../middleware/parentAuth";
import { sendPushPlaceholder } from "../communication/communicationProviders/pushProvider";
import { resetParentPushSubscribeRateLimit } from "../middleware/parentPushSubscribeRateLimit";

const prisma = new PrismaClient();
const PREFIX = "pp20c4a-";
const API = process.env.PP20_C4A_API_BASE || "http://127.0.0.1:3000";

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
    `Refusing Phase 4A tests against non-local host: ${host || "(unknown)"}`
  );
}

async function cleanup() {
  const schools = await prisma.school.findMany({
    where: { id: { startsWith: PREFIX } },
    select: { id: true },
  });
  for (const s of schools) {
    const parents = await prisma.parent.findMany({ where: { schoolId: s.id }, select: { id: true } });
    for (const p of parents) {
      await prisma.parentPushDelivery.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
      await prisma.pushSubscription.deleteMany({ where: { parentId: p.id } });
      await prisma.parentNotificationPreference.deleteMany({ where: { parentId: p.id } });
      await prisma.parentNotification.deleteMany({ where: { parentId: p.id } });
      await prisma.parentLearnerLink.deleteMany({ where: { parentId: p.id } });
    }
    await prisma.parent.deleteMany({ where: { schoolId: s.id } });
    await prisma.learner.deleteMany({ where: { schoolId: s.id } });
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
  resetParentPushSubscribeRateLimit();
  await cleanup();

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const schoolA = await prisma.school.create({
    data: {
      id: `${PREFIX}a-${stamp}`,
      name: "Phase4A School A",
      email: `c4a-a-${stamp}@test.local`,
      lifecycleStatus: "ACTIVE",
    },
  });
  const schoolB = await prisma.school.create({
    data: {
      id: `${PREFIX}b-${stamp}`,
      name: "Phase4A School B",
      email: `c4a-b-${stamp}@test.local`,
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
      cellNo: "0820000001",
      idNumber: `900101${String(stamp).slice(-6)}01`,
    },
  });
  const parentB = await prisma.parent.create({
    data: {
      id: `${PREFIX}pb-${stamp}`,
      schoolId: schoolB.id,
      firstName: "Parent",
      surname: "Beta",
      email: `pb-${stamp}@test.local`,
      cellNo: "0820000002",
      idNumber: `900101${String(stamp).slice(-6)}02`,
    },
  });

  const tokenA = signParentToken({ parentId: parentA.id, schoolId: schoolA.id });
  const tokenB = signParentToken({ parentId: parentB.id, schoolId: schoolB.id });
  const authA = { Authorization: `Bearer ${tokenA}` };
  const authB = { Authorization: `Bearer ${tokenB}` };

  // Placeholder must not report real success
  const placeholder = await sendPushPlaceholder({
    messageId: "msg-test",
    schoolId: schoolA.id,
    recipient: "unused",
    subject: "n/a",
    body: "n/a",
  });
  assert.equal(placeholder.ok, false);
  assert.equal(placeholder.simulated, true);
  assert.ok(String(placeholder.error).includes("parent_push_engine"));

  // Legacy engine register must not create subscriptions (410 when reached; 401/403 if staff module gate blocks first)
  const legacy = await json("/api/communication-engine/push/register", {
    method: "POST",
    body: JSON.stringify({
      schoolId: schoolA.id,
      parentId: parentA.id,
      endpoint: "https://example.com/hijack",
      keys: { p256dh: "x", auth: "y" },
    }),
  });
  assert.ok([401, 403, 410].includes(legacy.status), `legacy push/register unexpected ${legacy.status}`);
  assert.notEqual(legacy.status, 200);
  const legacyCount = await prisma.pushSubscription.count({
    where: { endpoint: "https://example.com/hijack" },
  });
  assert.equal(legacyCount, 0, "legacy register must not persist subscriptions");

  // Unauthenticated denied
  const unauth = await json("/api/parent-portal/push/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      endpoint: "https://fcm.googleapis.com/fcm/send/test1",
      keys: { p256dh: "p256dh-key-1", auth: "auth-key-1" },
    }),
  });
  assert.ok(unauth.status === 401 || unauth.status === 403, `expected auth failure, got ${unauth.status}`);

  // Defaults: lock-screen preview off
  const prefsGet = await json("/api/parent-portal/notification-preferences", { headers: authA });
  assert.equal(prefsGet.status, 200);
  assert.equal(prefsGet.body.preferences.pushEnabled, false);
  assert.equal(prefsGet.body.preferences.lockScreenPreview, false);

  const prefsPut = await json("/api/parent-portal/notification-preferences", {
    method: "PUT",
    headers: authA,
    body: JSON.stringify({
      pushEnabled: true,
      pushTeacherMessages: false,
      soundEnabled: true,
      lockScreenPreview: false,
      quietHoursStart: "22:00",
      quietHoursEnd: "06:00",
    }),
  });
  assert.equal(prefsPut.status, 200);
  assert.equal(prefsPut.body.preferences.pushEnabled, true);
  assert.equal(prefsPut.body.preferences.pushTeacherMessages, false);
  assert.equal(prefsPut.body.preferences.soundEnabled, true);
  assert.equal(prefsPut.body.preferences.lockScreenPreview, false);

  const prefsPersist = await json("/api/parent-portal/notification-preferences", { headers: authA });
  assert.equal(prefsPersist.body.preferences.quietHoursStart, "22:00");

  // Invalid quiet hours
  const badQuiet = await json("/api/parent-portal/notification-preferences", {
    method: "PUT",
    headers: authA,
    body: JSON.stringify({ quietHoursStart: "22:00", quietHoursEnd: null }),
  });
  assert.equal(badQuiet.status, 400);

  // Subscribe device 1
  const ep1 = `https://fcm.googleapis.com/fcm/send/c4a-${stamp}-d1`;
  const sub1 = await json("/api/parent-portal/push/subscriptions", {
    method: "POST",
    headers: authA,
    body: JSON.stringify({
      endpoint: ep1,
      keys: { p256dh: "p256dh-device-1", auth: "auth-device-1" },
      deviceLabel: "Device One",
      schoolId: schoolB.id, // spoof ignored
      parentId: parentB.id,
    }),
  });
  assert.equal(sub1.status, 200, JSON.stringify(sub1.body));
  assert.equal(sub1.body.deliveryEnabled, false);
  assert.ok(sub1.body.subscription.id);
  assert.equal(sub1.body.subscription.endpointHost, "fcm.googleapis.com");

  // Second device
  const ep2 = `https://fcm.googleapis.com/fcm/send/c4a-${stamp}-d2`;
  const sub2 = await json("/api/parent-portal/push/subscriptions", {
    method: "POST",
    headers: authA,
    body: JSON.stringify({
      endpoint: ep2,
      keys: { p256dh: "p256dh-device-2", auth: "auth-device-2" },
      deviceLabel: "Device Two",
    }),
  });
  assert.equal(sub2.status, 200);

  const listA = await json("/api/parent-portal/push/subscriptions", { headers: authA });
  assert.equal(listA.status, 200);
  assert.equal(listA.body.subscriptions.length, 2);

  // Cross-school: parent B cannot see A's devices
  const listB = await json("/api/parent-portal/push/subscriptions", { headers: authB });
  assert.equal(listB.body.subscriptions.length, 0);

  // Endpoint ownership: parent B cannot steal parent A's endpoint
  const hijack = await json("/api/parent-portal/push/subscriptions", {
    method: "POST",
    headers: authB,
    body: JSON.stringify({
      endpoint: ep1,
      keys: { p256dh: "stolen", auth: "stolen" },
    }),
  });
  assert.equal(hijack.status, 403);

  // Parent A refresh own endpoint OK
  const refresh = await json("/api/parent-portal/push/subscriptions", {
    method: "POST",
    headers: authA,
    body: JSON.stringify({
      endpoint: ep1,
      keys: { p256dh: "p256dh-device-1-rotated", auth: "auth-device-1-rotated" },
    }),
  });
  assert.equal(refresh.status, 200);

  // Reject http non-local endpoint
  const httpBad = await json("/api/parent-portal/push/subscriptions", {
    method: "POST",
    headers: authA,
    body: JSON.stringify({
      endpoint: "http://evil.example/push",
      keys: { p256dh: "x", auth: "y" },
    }),
  });
  assert.equal(httpBad.status, 400);

  // Disable one device
  const disable = await json(`/api/parent-portal/push/subscriptions/${sub2.body.subscription.id}`, {
    method: "DELETE",
    headers: authA,
  });
  assert.equal(disable.status, 200);

  // Parent B cannot disable A's remaining device
  const crossDisable = await json(`/api/parent-portal/push/subscriptions/${sub1.body.subscription.id}`, {
    method: "DELETE",
    headers: authB,
  });
  assert.equal(crossDisable.status, 404);

  // Existing ParentNotification read state unaffected
  const notif = await prisma.parentNotification.create({
    data: {
      schoolId: schoolA.id,
      parentId: parentA.id,
      type: "SCHOOL_NOTICE",
      title: "Fixture notice",
      message: "Keep me unread",
      isRead: false,
    },
  });
  const notifs = await json("/api/parent-portal/notifications", { headers: authA });
  assert.equal(notifs.status, 200);
  const found = (notifs.body.notifications || []).find((n: any) => n.id === notif.id);
  assert.ok(found);
  assert.equal(found.isRead, false);

  const vapid = await json("/api/parent-portal/push/vapid-public-key", { headers: authA });
  assert.equal(vapid.status, 200);
  assert.equal(vapid.body.deliveryEnabled, false);
  assert.equal(typeof vapid.body.configured, "boolean");

  await cleanup();
  console.log("parentPush.phase4a.security.test: PASS");
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
