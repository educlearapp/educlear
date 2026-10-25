/**
 * Communication outbound queue (Delivery Queue).
 *
 * Pre-P0 behaviour (documented): processCommunicationQueueBatch selected ALL schools'
 * queued rows and marked ok+simulated provider results as status=sent. That is fixed here.
 *
 * P0 rules:
 * - Every process/retry/claim requires an explicit schoolId (authorised staff school).
 * - Simulated / non-ok provider results never become status=sent.
 * - dryRun previews candidates without claiming or calling providers.
 * - No background auto-replay; only explicit process calls drain the queue.
 */
import type { CommunicationChannel, PrismaClient } from "@prisma/client";
import {
  sendEmailPlaceholder,
  type ProviderSendResult,
} from "./communicationProviders/emailProvider";
import { sendSmsPlaceholder } from "./communicationProviders/smsProvider";
import { sendWhatsAppPlaceholder } from "./communicationProviders/whatsappProvider";
import { sendPushPlaceholder } from "./communicationProviders/pushProvider";

export type QueueMessageRow = {
  id: string;
  schoolId: string;
  channel: CommunicationChannel;
  recipient: string | null;
  subject: string;
  body: string;
  status: string;
  category?: string;
  queuedAt?: Date;
};

export type QueueDispatchFn = (row: QueueMessageRow) => Promise<ProviderSendResult>;

let dispatchOverrideForTests: QueueDispatchFn | null = null;

/** Test-only: inject mock transport (never use in production paths). */
export function setCommunicationQueueDispatchForTests(fn: QueueDispatchFn | null) {
  dispatchOverrideForTests = fn;
}

export async function appendCommunicationLog(
  prisma: PrismaClient,
  opts: { schoolId: string; messageId: string; event: string; detail?: Record<string, unknown> }
) {
  return prisma.communicationLog.create({
    data: {
      schoolId: opts.schoolId,
      messageId: opts.messageId,
      event: opts.event,
      detail: opts.detail ? (opts.detail as object) : undefined,
    },
  });
}

export async function defaultDispatchByChannel(row: QueueMessageRow): Promise<ProviderSendResult> {
  const recipient = String(row.recipient || "").trim();
  const ctx = {
    schoolId: row.schoolId,
    messageId: row.id,
    recipient,
    subject: row.subject,
    body: row.body,
  };
  switch (row.channel) {
    case "email":
      return sendEmailPlaceholder(ctx);
    case "sms":
      return sendSmsPlaceholder(ctx);
    case "whatsapp":
      return sendWhatsAppPlaceholder(ctx);
    case "push":
      return sendPushPlaceholder(ctx);
    case "in_app":
      // in_app is excluded from queue processing; if reached, do not claim success as external send.
      return { ok: false, simulated: true, error: "in_app_not_queued" };
    default:
      return { ok: false, simulated: true, error: "unknown_channel" };
  }
}

function resolveDispatcher(override?: QueueDispatchFn | null): QueueDispatchFn {
  return override || dispatchOverrideForTests || defaultDispatchByChannel;
}

/** True only for a genuine external provider success (not simulated). */
export function isRealDeliverySuccess(result: ProviderSendResult): boolean {
  return Boolean(result.ok) && result.simulated !== true;
}

export type QueuePreviewItem = {
  id: string;
  channel: string;
  category?: string;
  recipient: string | null;
  subject: string;
  queuedAt: Date | null;
};

/**
 * Read-only preview of what process would claim. Never sends or mutates rows.
 */
export async function previewCommunicationQueueBatch(
  prisma: PrismaClient,
  opts: { schoolId: string; limit?: number }
): Promise<{ schoolId: string; count: number; items: QueuePreviewItem[] }> {
  const schoolId = String(opts.schoolId || "").trim();
  if (!schoolId) throw Object.assign(new Error("schoolId required"), { status: 400 });
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 100);

  const rows = await prisma.communicationMessage.findMany({
    where: {
      schoolId,
      status: "queued",
      channel: { not: "in_app" },
    },
    orderBy: { queuedAt: "asc" },
    take: limit,
    select: {
      id: true,
      channel: true,
      category: true,
      recipient: true,
      subject: true,
      queuedAt: true,
    },
  });

  return {
    schoolId,
    count: rows.length,
    items: rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      category: r.category,
      recipient: r.recipient,
      subject: r.subject,
      queuedAt: r.queuedAt,
    })),
  };
}

export async function processCommunicationQueueBatch(
  prisma: PrismaClient,
  opts: {
    schoolId: string;
    limit?: number;
    dryRun?: boolean;
    dispatcher?: QueueDispatchFn | null;
  }
): Promise<{
  processed: number;
  schoolId: string;
  dryRun: boolean;
  results: { id: string; status: string; simulated?: boolean; error?: string }[];
}> {
  const schoolId = String(opts.schoolId || "").trim();
  if (!schoolId) throw Object.assign(new Error("schoolId required"), { status: 400 });

  if (opts.dryRun) {
    const preview = await previewCommunicationQueueBatch(prisma, {
      schoolId,
      limit: opts.limit,
    });
    return {
      processed: 0,
      schoolId,
      dryRun: true,
      results: preview.items.map((i) => ({
        id: i.id,
        status: "preview",
        simulated: true,
        error: "dry_run_no_send",
      })),
    };
  }

  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const dispatch = resolveDispatcher(opts.dispatcher);

  const batch = await prisma.communicationMessage.findMany({
    where: {
      schoolId,
      status: "queued",
      channel: { not: "in_app" },
    },
    orderBy: { queuedAt: "asc" },
    take: limit,
  });

  const results: { id: string; status: string; simulated?: boolean; error?: string }[] = [];

  for (const msg of batch) {
    // Tenant-bound claim — concurrent workers / other schools cannot steal this row.
    const claimed = await prisma.communicationMessage.updateMany({
      where: { id: msg.id, schoolId, status: "queued" },
      data: { status: "sending", sendingAt: new Date() },
    });
    if (claimed.count === 0) continue;

    if (!String(msg.recipient || "").trim()) {
      await prisma.communicationMessage.updateMany({
        where: { id: msg.id, schoolId },
        data: {
          status: "failed",
          failedAt: new Date(),
          error: "missing_recipient",
        },
      });
      await appendCommunicationLog(prisma, {
        schoolId,
        messageId: msg.id,
        event: "failed",
        detail: { reason: "missing_recipient" },
      });
      results.push({ id: msg.id, status: "failed", error: "missing_recipient" });
      continue;
    }

    try {
      const send = await dispatch(msg);

      if (!isRealDeliverySuccess(send)) {
        const error =
          send.error ||
          (send.simulated ? "simulated_not_sent" : "provider_failed");
        await prisma.communicationMessage.updateMany({
          where: { id: msg.id, schoolId },
          data: {
            status: "failed",
            failedAt: new Date(),
            error: String(error).slice(0, 500),
            providerResponse: send as object,
            // Ensure we never leave a partial "sent" mark from older buggy paths.
            sentAt: null,
          },
        });
        await appendCommunicationLog(prisma, {
          schoolId,
          messageId: msg.id,
          event: send.simulated ? "held_simulated" : "failed",
          detail: { providerResponse: send },
        });
        results.push({
          id: msg.id,
          status: "failed",
          simulated: Boolean(send.simulated),
          error: String(error).slice(0, 200),
        });
        continue;
      }

      await prisma.communicationMessage.updateMany({
        where: { id: msg.id, schoolId },
        data: {
          status: "sent",
          sentAt: new Date(),
          providerResponse: send as object,
          error: null,
        },
      });
      await appendCommunicationLog(prisma, {
        schoolId,
        messageId: msg.id,
        event: "sent",
        detail: { providerResponse: send },
      });
      results.push({ id: msg.id, status: "sent", simulated: false });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      await prisma.communicationMessage.updateMany({
        where: { id: msg.id, schoolId },
        data: {
          status: "failed",
          failedAt: new Date(),
          error: message.slice(0, 500),
          sentAt: null,
        },
      });
      await appendCommunicationLog(prisma, {
        schoolId,
        messageId: msg.id,
        event: "error",
        detail: { message },
      });
      results.push({ id: msg.id, status: "failed", error: message.slice(0, 200) });
    }
  }

  return { processed: results.length, schoolId, dryRun: false, results };
}

export async function retryCommunicationMessage(
  prisma: PrismaClient,
  opts: { messageId: string; schoolId: string }
) {
  const schoolId = String(opts.schoolId || "").trim();
  const messageId = String(opts.messageId || "").trim();
  if (!schoolId || !messageId) {
    return { ok: false as const, error: "schoolId_and_messageId_required" };
  }

  const msg = await prisma.communicationMessage.findFirst({
    where: { id: messageId, schoolId },
  });
  if (!msg) return { ok: false as const, error: "not_found" };
  if (msg.channel === "in_app") return { ok: false as const, error: "in_app_not_retryable" };
  if (msg.status !== "failed") return { ok: false as const, error: "not_failed" };

  const updated = await prisma.communicationMessage.updateMany({
    where: { id: messageId, schoolId, status: "failed" },
    data: {
      status: "queued",
      error: null,
      failedAt: null,
      sendingAt: null,
      sentAt: null,
      retryCount: { increment: 1 },
      queuedAt: new Date(),
    },
  });
  if (updated.count === 0) return { ok: false as const, error: "not_failed" };

  await appendCommunicationLog(prisma, {
    schoolId,
    messageId: msg.id,
    event: "retry_queued",
    detail: {},
  });
  return { ok: true as const };
}
