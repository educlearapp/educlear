import type { CommunicationChannel, PrismaClient } from "@prisma/client";
import { sendEmailPlaceholder } from "./communicationProviders/emailProvider";
import { sendSmsPlaceholder } from "./communicationProviders/smsProvider";
import { sendWhatsAppPlaceholder } from "./communicationProviders/whatsappProvider";
import { sendPushPlaceholder } from "./communicationProviders/pushProvider";

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

async function dispatchByChannel(
  row: {
    id: string;
    schoolId: string;
    channel: CommunicationChannel;
    recipient: string | null;
    subject: string;
    body: string;
  }
) {
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
      return { ok: true, simulated: true, reference: "in_app" };
    default:
      return { ok: false, simulated: true, error: "unknown_channel" };
  }
}

export async function processCommunicationQueueBatch(prisma: PrismaClient, limit = 25) {
  const batch = await prisma.communicationMessage.findMany({
    where: { status: "queued", channel: { not: "in_app" } },
    orderBy: { queuedAt: "asc" },
    take: limit,
  });

  const results: { id: string; status: string }[] = [];

  for (const msg of batch) {
    const claimed = await prisma.communicationMessage.updateMany({
      where: { id: msg.id, status: "queued" },
      data: { status: "sending", sendingAt: new Date() },
    });
    if (claimed.count === 0) continue;

    if (!String(msg.recipient || "").trim()) {
      await prisma.communicationMessage.update({
        where: { id: msg.id },
        data: {
          status: "failed",
          failedAt: new Date(),
          error: "missing_recipient",
        },
      });
      await appendCommunicationLog(prisma, {
        schoolId: msg.schoolId,
        messageId: msg.id,
        event: "failed",
        detail: { reason: "missing_recipient" },
      });
      results.push({ id: msg.id, status: "failed" });
      continue;
    }

    try {
      const send = await dispatchByChannel(msg);
      if (!send.ok) {
        await prisma.communicationMessage.update({
          where: { id: msg.id },
          data: {
            status: "failed",
            failedAt: new Date(),
            error: send.error || "provider_failed",
            providerResponse: send as object,
          },
        });
        await appendCommunicationLog(prisma, {
          schoolId: msg.schoolId,
          messageId: msg.id,
          event: "failed",
          detail: { providerResponse: send },
        });
        results.push({ id: msg.id, status: "failed" });
        continue;
      }
      await prisma.communicationMessage.update({
        where: { id: msg.id },
        data: {
          status: "sent",
          sentAt: new Date(),
          providerResponse: send as object,
        },
      });
      await appendCommunicationLog(prisma, {
        schoolId: msg.schoolId,
        messageId: msg.id,
        event: "sent",
        detail: { providerResponse: send },
      });
      results.push({ id: msg.id, status: "sent" });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      await prisma.communicationMessage.update({
        where: { id: msg.id },
        data: {
          status: "failed",
          failedAt: new Date(),
          error: message,
        },
      });
      await appendCommunicationLog(prisma, {
        schoolId: msg.schoolId,
        messageId: msg.id,
        event: "error",
        detail: { message },
      });
      results.push({ id: msg.id, status: "failed" });
    }
  }

  return { processed: results.length, results };
}

export async function retryCommunicationMessage(prisma: PrismaClient, messageId: string) {
  const msg = await prisma.communicationMessage.findUnique({ where: { id: messageId } });
  if (!msg) return { ok: false as const, error: "not_found" };
  if (msg.channel === "in_app") return { ok: false as const, error: "in_app_not_retryable" };
  if (msg.status !== "failed") return { ok: false as const, error: "not_failed" };

  await prisma.communicationMessage.update({
    where: { id: messageId },
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
  await appendCommunicationLog(prisma, {
    schoolId: msg.schoolId,
    messageId: msg.id,
    event: "retry_queued",
    detail: {},
  });
  return { ok: true as const };
}
