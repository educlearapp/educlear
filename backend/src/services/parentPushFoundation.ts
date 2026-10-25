import type { ParentNotificationPreference, Prisma } from "@prisma/client";
import { prisma } from "../prisma";

export type PushKeysPayload = {
  p256dh?: string;
  auth?: string;
};

export type ParentNotificationPreferenceInput = {
  pushEnabled?: boolean;
  pushTeacherMessages?: boolean;
  pushAnnouncements?: boolean;
  pushEvents?: boolean;
  soundEnabled?: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  lockScreenPreview?: boolean;
};

const DEFAULT_PREFS = {
  pushEnabled: false,
  pushTeacherMessages: true,
  pushAnnouncements: true,
  pushEvents: true,
  soundEnabled: false,
  quietHoursStart: null as string | null,
  quietHoursEnd: null as string | null,
  lockScreenPreview: false,
};

export function getVapidPublicKey(): string | null {
  const key = String(process.env.VAPID_PUBLIC_KEY || "").trim();
  return key || null;
}

/** Public key only — never expose VAPID_PRIVATE_KEY. */
export function assertVapidConfiguredForSubscribe(): string | null {
  return getVapidPublicKey();
}

export function isHttpsOrLocalEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    if (u.protocol === "https:") return true;
    // Local/dev push services occasionally use http://127.0.0.1 — allow only loopback.
    if (u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function validateQuietHours(start: string | null | undefined, end: string | null | undefined): string | null {
  const s = start == null || start === "" ? null : String(start).trim();
  const e = end == null || end === "" ? null : String(end).trim();
  if (!s && !e) return null;
  if (!s || !e) return "quietHoursStart and quietHoursEnd must both be set or both cleared";
  const re = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!re.test(s) || !re.test(e)) return "quiet hours must use HH:mm (24-hour)";
  return null;
}

export function serializePreference(row: ParentNotificationPreference | null, schoolId: string, parentId: string) {
  if (!row) {
    return { schoolId, parentId, ...DEFAULT_PREFS };
  }
  return {
    schoolId: row.schoolId,
    parentId: row.parentId,
    pushEnabled: row.pushEnabled,
    pushTeacherMessages: row.pushTeacherMessages,
    pushAnnouncements: row.pushAnnouncements,
    pushEvents: row.pushEvents,
    soundEnabled: row.soundEnabled,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    lockScreenPreview: row.lockScreenPreview,
    updatedAt: row.updatedAt,
  };
}

export async function getOrDefaultPreferences(schoolId: string, parentId: string) {
  const row = await prisma.parentNotificationPreference.findFirst({
    where: { parentId, schoolId },
  });
  return serializePreference(row, schoolId, parentId);
}

export async function upsertPreferences(
  schoolId: string,
  parentId: string,
  input: ParentNotificationPreferenceInput
) {
  const existing = await prisma.parentNotificationPreference.findFirst({
    where: { parentId },
  });
  if (existing && existing.schoolId !== schoolId) {
    throw Object.assign(new Error("Preference school mismatch"), { status: 403 });
  }
  const nextStart =
    input.quietHoursStart !== undefined
      ? input.quietHoursStart
        ? String(input.quietHoursStart).trim() || null
        : null
      : existing?.quietHoursStart ?? null;
  const nextEnd =
    input.quietHoursEnd !== undefined
      ? input.quietHoursEnd
        ? String(input.quietHoursEnd).trim() || null
        : null
      : existing?.quietHoursEnd ?? null;
  const mergedQuietErr = validateQuietHours(nextStart, nextEnd);
  if (mergedQuietErr) throw Object.assign(new Error(mergedQuietErr), { status: 400 });

  const data: Prisma.ParentNotificationPreferenceUncheckedCreateInput = {
    schoolId,
    parentId,
    pushEnabled: input.pushEnabled ?? existing?.pushEnabled ?? false,
    pushTeacherMessages: input.pushTeacherMessages ?? existing?.pushTeacherMessages ?? true,
    pushAnnouncements: input.pushAnnouncements ?? existing?.pushAnnouncements ?? true,
    pushEvents: input.pushEvents ?? existing?.pushEvents ?? true,
    soundEnabled: input.soundEnabled ?? existing?.soundEnabled ?? false,
    quietHoursStart: nextStart,
    quietHoursEnd: nextEnd,
    lockScreenPreview: input.lockScreenPreview ?? existing?.lockScreenPreview ?? false,
  };

  const row = await prisma.parentNotificationPreference.upsert({
    where: { parentId },
    create: data,
    update: {
      schoolId,
      pushEnabled: data.pushEnabled,
      pushTeacherMessages: data.pushTeacherMessages,
      pushAnnouncements: data.pushAnnouncements,
      pushEvents: data.pushEvents,
      soundEnabled: data.soundEnabled,
      quietHoursStart: data.quietHoursStart,
      quietHoursEnd: data.quietHoursEnd,
      lockScreenPreview: data.lockScreenPreview,
    },
  });

  // Guard against preference row pointing at a different school than authenticated parent.
  if (row.schoolId !== schoolId) {
    throw Object.assign(new Error("Preference school mismatch"), { status: 403 });
  }
  return serializePreference(row, schoolId, parentId);
}

export function sanitizeSubscriptionForClient(row: {
  id: string;
  endpoint: string;
  userAgent: string | null;
  deviceLabel: string | null;
  enabled: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    endpointHost: safeEndpointHost(row.endpoint),
    userAgent: row.userAgent,
    deviceLabel: row.deviceLabel,
    enabled: row.enabled,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function safeEndpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "(invalid)";
  }
}

export async function listParentSubscriptions(schoolId: string, parentId: string) {
  const rows = await prisma.pushSubscription.findMany({
    where: { schoolId, parentId },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  return rows.map(sanitizeSubscriptionForClient);
}

/**
 * Upsert subscription for the authenticated parent only.
 * If endpoint already belongs to another parent/school → 403 (no hijack).
 */
export async function upsertParentSubscription(opts: {
  schoolId: string;
  parentId: string;
  endpoint: string;
  keys?: PushKeysPayload | null;
  userAgent?: string | null;
  deviceLabel?: string | null;
}) {
  const endpoint = String(opts.endpoint || "").trim();
  if (!endpoint || endpoint.length > 2048) {
    throw Object.assign(new Error("Invalid subscription endpoint"), { status: 400 });
  }
  if (!isHttpsOrLocalEndpoint(endpoint)) {
    throw Object.assign(new Error("Subscription endpoint must be HTTPS"), { status: 400 });
  }
  const p256dh = String(opts.keys?.p256dh || "").trim();
  const auth = String(opts.keys?.auth || "").trim();
  if (!p256dh || !auth) {
    throw Object.assign(new Error("Subscription keys (p256dh, auth) required"), { status: 400 });
  }

  const existing = await prisma.pushSubscription.findUnique({ where: { endpoint } });
  if (existing && (existing.parentId !== opts.parentId || existing.schoolId !== opts.schoolId)) {
    throw Object.assign(new Error("Subscription endpoint already registered"), { status: 403 });
  }

  const keysJson = { p256dh, auth };
  const row = await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      schoolId: opts.schoolId,
      parentId: opts.parentId,
      endpoint,
      keys: keysJson,
      userAgent: opts.userAgent ? String(opts.userAgent).slice(0, 400) : null,
      deviceLabel: opts.deviceLabel ? String(opts.deviceLabel).slice(0, 80) : null,
      enabled: true,
      lastSeenAt: new Date(),
      failCount: 0,
    },
    update: {
      keys: keysJson,
      userAgent: opts.userAgent ? String(opts.userAgent).slice(0, 400) : undefined,
      deviceLabel:
        opts.deviceLabel !== undefined
          ? opts.deviceLabel
            ? String(opts.deviceLabel).slice(0, 80)
            : null
          : undefined,
      enabled: true,
      lastSeenAt: new Date(),
      failCount: 0,
    },
  });

  return sanitizeSubscriptionForClient(row);
}

export async function disableParentSubscription(opts: {
  schoolId: string;
  parentId: string;
  subscriptionId?: string;
  endpoint?: string;
}) {
  const where = opts.subscriptionId
    ? { id: opts.subscriptionId, schoolId: opts.schoolId, parentId: opts.parentId }
    : opts.endpoint
      ? { endpoint: String(opts.endpoint).trim(), schoolId: opts.schoolId, parentId: opts.parentId }
      : null;
  if (!where) throw Object.assign(new Error("subscriptionId or endpoint required"), { status: 400 });

  const result = await prisma.pushSubscription.updateMany({
    where,
    data: { enabled: false, lastSeenAt: new Date() },
  });
  if (result.count === 0) {
    throw Object.assign(new Error("Subscription not found"), { status: 404 });
  }
  return { disabled: result.count };
}

/**
 * Phase 4B hook documentation — not invoked in 4A.
 * One ParentPushDelivery row per (notification, subscription); payload must omit bodies unless lockScreenPreview.
 */
export function phase4bDeliveryContract() {
  return {
    status: "deferred",
    rule: "one delivery per parentNotificationId + subscriptionId",
    defaultPayload: ["notificationId", "type", "title"],
    omitUnlessPreview: ["body", "learnerName", "message"],
    neverInclude: ["billing", "account balances", "OTP", "full teacher message body by default"],
  };
}
