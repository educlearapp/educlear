/**
 * Parent Portal Phase 4B — Web Push delivery engine.
 * ParentNotification is authoritative. One ParentPushDelivery per (notification, device).
 * External send only when WEB_PUSH_DELIVERY_ENABLED=true; mocks never set externalSent.
 */
import type { ParentNotification, ParentNotificationType, Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { isHttpsOrLocalEndpoint } from "./parentPushFoundation";
import {
  getParentPushTransport,
  isWebPushDeliveryEnabled,
  type PushPayload,
  type PushSubscriptionWire,
} from "./parentPushTransport";

export const PUSH_ELIGIBLE_TYPES = new Set<ParentNotificationType>([
  "TEACHER_MESSAGE",
  "SCHOOL_NOTICE",
  "ASSESSMENT",
  "EXAM",
  "SCHOOL_EVENT",
]);

export const PUSH_MAX_ATTEMPTS = 5;
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];

export type DeliveryStatus =
  | "queued"
  | "deferred"
  | "sending"
  | "sent"
  | "mock_ok"
  | "failed"
  | "expired"
  | "skipped"
  | "suppressed";

export function isPushEligibleType(type: ParentNotificationType | string): boolean {
  return PUSH_ELIGIBLE_TYPES.has(type as ParentNotificationType);
}

export function isBillingOrUnsupportedType(type: ParentNotificationType | string): boolean {
  return !isPushEligibleType(type);
}

/** Minutes since local midnight. */
function localMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function parseHm(hm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hm || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** True when `now` falls inside quiet window (supports overnight wrap). */
export function isWithinQuietHours(
  now: Date,
  start: string | null | undefined,
  end: string | null | undefined
): boolean {
  if (!start || !end) return false;
  const s = parseHm(start);
  const e = parseHm(end);
  if (s == null || e == null || s === e) return false;
  const mins = localMinutes(now);
  if (s < e) return mins >= s && mins < e;
  return mins >= s || mins < e;
}

/** Next local DateTime when quiet hours end. */
export function nextQuietHoursEnd(
  now: Date,
  start: string | null | undefined,
  end: string | null | undefined
): Date | null {
  if (!isWithinQuietHours(now, start, end)) return null;
  const e = parseHm(String(end));
  if (e == null) return null;
  const out = new Date(now);
  out.setSeconds(0, 0);
  out.setHours(Math.floor(e / 60), e % 60, 0, 0);
  if (out.getTime() <= now.getTime()) {
    out.setDate(out.getDate() + 1);
  }
  return out;
}

export function backoffMsForAttempt(attemptCountAfterFailure: number): number {
  const idx = Math.min(Math.max(attemptCountAfterFailure - 1, 0), BACKOFF_MS.length - 1);
  return BACKOFF_MS[idx];
}

function preferenceAllowsType(
  prefs: {
    pushEnabled: boolean;
    pushTeacherMessages: boolean;
    pushAnnouncements: boolean;
    pushEvents: boolean;
  },
  type: ParentNotificationType
): boolean {
  if (!prefs.pushEnabled) return false;
  if (type === "TEACHER_MESSAGE") return prefs.pushTeacherMessages;
  if (type === "SCHOOL_EVENT") return prefs.pushEvents;
  if (type === "SCHOOL_NOTICE" || type === "ASSESSMENT" || type === "EXAM") {
    return prefs.pushAnnouncements;
  }
  return false;
}

export function buildPrivacySafePayload(
  notif: Pick<ParentNotification, "id" | "type" | "title" | "message">,
  lockScreenPreview: boolean
): PushPayload {
  const title = String(notif.title || "EduClear").slice(0, 80);
  // Never include learner names, billing, or full message by default.
  const body = lockScreenPreview ? String(notif.message || "").slice(0, 140) : undefined;
  return {
    title,
    body,
    lockScreenPreview: Boolean(lockScreenPreview && body),
    notificationId: notif.id,
    type: String(notif.type),
  };
}

function parseSubscriptionKeys(keys: unknown): { p256dh: string; auth: string } | null {
  if (!keys || typeof keys !== "object") return null;
  const k = keys as Record<string, unknown>;
  const p256dh = String(k.p256dh || "").trim();
  const auth = String(k.auth || "").trim();
  if (!p256dh || !auth) return null;
  return { p256dh, auth };
}

/**
 * After a new ParentNotification is persisted, enqueue one delivery per enabled device.
 * Safe to call on republish paths that return existing notifications — caller must skip.
 * Unique (parentNotificationId, subscriptionId) prevents duplicates under races.
 */
export async function enqueueParentPushDeliveriesForNotification(
  notif: Pick<ParentNotification, "id" | "schoolId" | "parentId" | "type" | "title" | "message">,
  now: Date = new Date()
): Promise<{ created: number; skippedReason?: string }> {
  if (!isPushEligibleType(notif.type)) {
    return { created: 0, skippedReason: "ineligible_type" };
  }

  const prefsRow = await prisma.parentNotificationPreference.findFirst({
    where: { parentId: notif.parentId, schoolId: notif.schoolId },
  });
  const prefs = {
    pushEnabled: prefsRow?.pushEnabled ?? false,
    pushTeacherMessages: prefsRow?.pushTeacherMessages ?? true,
    pushAnnouncements: prefsRow?.pushAnnouncements ?? true,
    pushEvents: prefsRow?.pushEvents ?? true,
    quietHoursStart: prefsRow?.quietHoursStart ?? null,
    quietHoursEnd: prefsRow?.quietHoursEnd ?? null,
  };

  if (!preferenceAllowsType(prefs, notif.type)) {
    return { created: 0, skippedReason: "preferences_disabled" };
  }

  const subscriptions = await prisma.pushSubscription.findMany({
    where: {
      schoolId: notif.schoolId,
      parentId: notif.parentId,
      enabled: true,
    },
    take: 20,
  });

  if (subscriptions.length === 0) {
    return { created: 0, skippedReason: "no_subscriptions" };
  }

  const inQuiet = isWithinQuietHours(now, prefs.quietHoursStart, prefs.quietHoursEnd);
  const nextAttemptAt = inQuiet
    ? nextQuietHoursEnd(now, prefs.quietHoursStart, prefs.quietHoursEnd)
    : null;
  const status: DeliveryStatus = inQuiet ? "deferred" : "queued";

  let created = 0;
  for (const sub of subscriptions) {
    if (!isHttpsOrLocalEndpoint(sub.endpoint)) continue;
    try {
      await prisma.parentPushDelivery.create({
        data: {
          schoolId: notif.schoolId,
          parentId: notif.parentId,
          parentNotificationId: notif.id,
          subscriptionId: sub.id,
          status,
          nextAttemptAt: nextAttemptAt ?? undefined,
        },
      });
      created += 1;
    } catch (e: unknown) {
      // Unique violation → already enqueued (republish / race) — ignore.
      const code = (e as { code?: string })?.code;
      if (code === "P2002") continue;
      throw e;
    }
  }
  return { created };
}

/**
 * Claim a single delivery for this worker. Concurrent callers lose the race (count=0).
 */
export async function claimParentPushDelivery(opts: {
  deliveryId: string;
  workerId: string;
  now?: Date;
}): Promise<boolean> {
  const now = opts.now ?? new Date();
  const result = await prisma.parentPushDelivery.updateMany({
    where: {
      id: opts.deliveryId,
      status: { in: ["queued", "deferred", "failed"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      attemptCount: { lt: PUSH_MAX_ATTEMPTS },
      externalSent: false,
    },
    data: {
      status: "sending",
      claimedAt: now,
      claimedBy: opts.workerId.slice(0, 80),
      attemptedAt: now,
    },
  });
  return result.count === 1;
}

async function markSubscriptionExpired(subscriptionId: string, schoolId: string, parentId: string) {
  await prisma.pushSubscription.updateMany({
    where: { id: subscriptionId, schoolId, parentId },
    data: { enabled: false, failCount: { increment: 1 }, lastSeenAt: new Date() },
  });
}

export async function processClaimedParentPushDelivery(opts: {
  deliveryId: string;
  workerId: string;
  now?: Date;
}): Promise<{ status: string; externalSent: boolean }> {
  const now = opts.now ?? new Date();
  const row = await prisma.parentPushDelivery.findUnique({
    where: { id: opts.deliveryId },
    include: {
      subscription: true,
    },
  });
  if (!row || row.status !== "sending" || row.claimedBy !== opts.workerId) {
    return { status: "not_claimed", externalSent: false };
  }

  // Feature flag OFF — never call external provider; mark suppressed (not success).
  if (!isWebPushDeliveryEnabled()) {
    await prisma.parentPushDelivery.update({
      where: { id: row.id },
      data: {
        status: "suppressed",
        error: "web_push_delivery_disabled",
        attemptCount: { increment: 1 },
        claimedAt: null,
        claimedBy: null,
        externalSent: false,
      },
    });
    return { status: "suppressed", externalSent: false };
  }

  const notif = await prisma.parentNotification.findFirst({
    where: {
      id: row.parentNotificationId,
      schoolId: row.schoolId,
      parentId: row.parentId,
    },
  });
  if (!notif) {
    await prisma.parentPushDelivery.update({
      where: { id: row.id },
      data: {
        status: "failed",
        error: "notification_missing",
        attemptCount: { increment: 1 },
        claimedAt: null,
        claimedBy: null,
        externalSent: false,
      },
    });
    return { status: "failed", externalSent: false };
  }

  // Re-check prefs at send time (parent may have disabled).
  const prefsRow = await prisma.parentNotificationPreference.findFirst({
    where: { parentId: row.parentId, schoolId: row.schoolId },
  });
  const prefs = {
    pushEnabled: prefsRow?.pushEnabled ?? false,
    pushTeacherMessages: prefsRow?.pushTeacherMessages ?? true,
    pushAnnouncements: prefsRow?.pushAnnouncements ?? true,
    pushEvents: prefsRow?.pushEvents ?? true,
    quietHoursStart: prefsRow?.quietHoursStart ?? null,
    quietHoursEnd: prefsRow?.quietHoursEnd ?? null,
    lockScreenPreview: prefsRow?.lockScreenPreview ?? false,
  };

  if (!preferenceAllowsType(prefs, notif.type)) {
    await prisma.parentPushDelivery.update({
      where: { id: row.id },
      data: {
        status: "skipped",
        error: "preferences_disabled",
        claimedAt: null,
        claimedBy: null,
        externalSent: false,
      },
    });
    return { status: "skipped", externalSent: false };
  }

  if (isWithinQuietHours(now, prefs.quietHoursStart, prefs.quietHoursEnd)) {
    const next = nextQuietHoursEnd(now, prefs.quietHoursStart, prefs.quietHoursEnd);
    await prisma.parentPushDelivery.update({
      where: { id: row.id },
      data: {
        status: "deferred",
        nextAttemptAt: next,
        claimedAt: null,
        claimedBy: null,
        error: "quiet_hours",
        externalSent: false,
      },
    });
    return { status: "deferred", externalSent: false };
  }

  if (!row.subscription.enabled || row.subscription.schoolId !== row.schoolId || row.subscription.parentId !== row.parentId) {
    await prisma.parentPushDelivery.update({
      where: { id: row.id },
      data: {
        status: "expired",
        error: "subscription_disabled_or_mismatch",
        claimedAt: null,
        claimedBy: null,
        externalSent: false,
      },
    });
    return { status: "expired", externalSent: false };
  }

  if (!isHttpsOrLocalEndpoint(row.subscription.endpoint)) {
    await prisma.parentPushDelivery.update({
      where: { id: row.id },
      data: {
        status: "failed",
        error: "invalid_endpoint",
        attemptCount: { increment: 1 },
        claimedAt: null,
        claimedBy: null,
        externalSent: false,
      },
    });
    return { status: "failed", externalSent: false };
  }

  const keys = parseSubscriptionKeys(row.subscription.keys);
  if (!keys) {
    await prisma.parentPushDelivery.update({
      where: { id: row.id },
      data: {
        status: "failed",
        error: "missing_subscription_keys",
        attemptCount: { increment: 1 },
        claimedAt: null,
        claimedBy: null,
        externalSent: false,
      },
    });
    return { status: "failed", externalSent: false };
  }

  const wire: PushSubscriptionWire = {
    endpoint: row.subscription.endpoint,
    keys,
  };
  const payload = buildPrivacySafePayload(notif, prefs.lockScreenPreview);

  // Safe log — never endpoint keys or VAPID private material.
  console.info("[parent-push] send attempt", {
    deliveryId: row.id,
    schoolId: row.schoolId,
    parentId: row.parentId,
    notificationId: notif.id,
    type: notif.type,
    workerId: opts.workerId,
  });

  const transport = getParentPushTransport();
  const result = await transport.send(wire, payload);
  const nextAttempt = row.attemptCount + 1;

  if (result.ok && result.externalSent) {
    await prisma.parentPushDelivery.update({
      where: { id: row.id },
      data: {
        status: "sent",
        externalSent: true,
        sentAt: now,
        attemptCount: nextAttempt,
        error: null,
        claimedAt: null,
        claimedBy: null,
        nextAttemptAt: null,
      },
    });
    await prisma.pushSubscription.updateMany({
      where: { id: row.subscriptionId, schoolId: row.schoolId, parentId: row.parentId },
      data: { lastSuccessAt: now, failCount: 0, lastSeenAt: now },
    });
    return { status: "sent", externalSent: true };
  }

  if (result.ok && result.simulated && !result.externalSent) {
    // Mock success path — must not look like a real external send.
    await prisma.parentPushDelivery.update({
      where: { id: row.id },
      data: {
        status: "mock_ok",
        externalSent: false,
        sentAt: now,
        attemptCount: nextAttempt,
        error: "mock_transport_ok",
        claimedAt: null,
        claimedBy: null,
        nextAttemptAt: null,
      },
    });
    return { status: "mock_ok", externalSent: false };
  }

  const statusCode = result.statusCode;
  if (statusCode === 404 || statusCode === 410) {
    await markSubscriptionExpired(row.subscriptionId, row.schoolId, row.parentId);
    await prisma.parentPushDelivery.update({
      where: { id: row.id },
      data: {
        status: "expired",
        error: `endpoint_${statusCode}`,
        attemptCount: nextAttempt,
        claimedAt: null,
        claimedBy: null,
        externalSent: false,
      },
    });
    return { status: "expired", externalSent: false };
  }

  if (nextAttempt >= PUSH_MAX_ATTEMPTS) {
    await prisma.parentPushDelivery.update({
      where: { id: row.id },
      data: {
        status: "failed",
        error: (result.error || "max_attempts").slice(0, 200),
        attemptCount: nextAttempt,
        claimedAt: null,
        claimedBy: null,
        externalSent: false,
      },
    });
    await prisma.pushSubscription.updateMany({
      where: { id: row.subscriptionId },
      data: { failCount: { increment: 1 }, lastSeenAt: now },
    });
    return { status: "failed", externalSent: false };
  }

  const delay = backoffMsForAttempt(nextAttempt);
  await prisma.parentPushDelivery.update({
    where: { id: row.id },
    data: {
      status: "failed",
      error: (result.error || "send_failed").slice(0, 200),
      attemptCount: nextAttempt,
      nextAttemptAt: new Date(now.getTime() + delay),
      claimedAt: null,
      claimedBy: null,
      externalSent: false,
    },
  });
  await prisma.pushSubscription.updateMany({
    where: { id: row.subscriptionId },
    data: { failCount: { increment: 1 }, lastSeenAt: now },
  });
  return { status: "failed", externalSent: false };
}

export async function processParentPushDeliveryBatch(opts?: {
  limit?: number;
  workerId?: string;
  now?: Date;
  schoolId?: string;
}): Promise<{ processed: number; results: Array<{ id: string; status: string; externalSent: boolean }> }> {
  const limit = Math.min(Math.max(opts?.limit ?? 25, 1), 100);
  const workerId = opts?.workerId || `push-worker-${process.pid}`;
  const now = opts?.now ?? new Date();

  const where: Prisma.ParentPushDeliveryWhereInput = {
    status: { in: ["queued", "deferred", "failed"] },
    externalSent: false,
    attemptCount: { lt: PUSH_MAX_ATTEMPTS },
    OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
  };
  if (opts?.schoolId) where.schoolId = opts.schoolId;

  const candidates = await prisma.parentPushDelivery.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  const results: Array<{ id: string; status: string; externalSent: boolean }> = [];
  for (const c of candidates) {
    const claimed = await claimParentPushDelivery({ deliveryId: c.id, workerId, now });
    if (!claimed) continue;
    const outcome = await processClaimedParentPushDelivery({ deliveryId: c.id, workerId, now });
    results.push({ id: c.id, ...outcome });
  }
  return { processed: results.length, results };
}
