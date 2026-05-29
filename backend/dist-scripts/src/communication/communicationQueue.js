"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendCommunicationLog = appendCommunicationLog;
exports.processCommunicationQueueBatch = processCommunicationQueueBatch;
exports.retryCommunicationMessage = retryCommunicationMessage;
const emailProvider_1 = require("./communicationProviders/emailProvider");
const smsProvider_1 = require("./communicationProviders/smsProvider");
const whatsappProvider_1 = require("./communicationProviders/whatsappProvider");
const pushProvider_1 = require("./communicationProviders/pushProvider");
async function appendCommunicationLog(prisma, opts) {
    return prisma.communicationLog.create({
        data: {
            schoolId: opts.schoolId,
            messageId: opts.messageId,
            event: opts.event,
            detail: opts.detail ? opts.detail : undefined,
        },
    });
}
async function dispatchByChannel(row) {
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
            return (0, emailProvider_1.sendEmailPlaceholder)(ctx);
        case "sms":
            return (0, smsProvider_1.sendSmsPlaceholder)(ctx);
        case "whatsapp":
            return (0, whatsappProvider_1.sendWhatsAppPlaceholder)(ctx);
        case "push":
            return (0, pushProvider_1.sendPushPlaceholder)(ctx);
        case "in_app":
            return { ok: true, simulated: true, reference: "in_app" };
        default:
            return { ok: false, simulated: true, error: "unknown_channel" };
    }
}
async function processCommunicationQueueBatch(prisma, limit = 25) {
    const batch = await prisma.communicationMessage.findMany({
        where: { status: "queued", channel: { not: "in_app" } },
        orderBy: { queuedAt: "asc" },
        take: limit,
    });
    const results = [];
    for (const msg of batch) {
        const claimed = await prisma.communicationMessage.updateMany({
            where: { id: msg.id, status: "queued" },
            data: { status: "sending", sendingAt: new Date() },
        });
        if (claimed.count === 0)
            continue;
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
                        providerResponse: send,
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
                    providerResponse: send,
                },
            });
            await appendCommunicationLog(prisma, {
                schoolId: msg.schoolId,
                messageId: msg.id,
                event: "sent",
                detail: { providerResponse: send },
            });
            results.push({ id: msg.id, status: "sent" });
        }
        catch (e) {
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
async function retryCommunicationMessage(prisma, messageId) {
    const msg = await prisma.communicationMessage.findUnique({ where: { id: messageId } });
    if (!msg)
        return { ok: false, error: "not_found" };
    if (msg.channel === "in_app")
        return { ok: false, error: "in_app_not_retryable" };
    if (msg.status !== "failed")
        return { ok: false, error: "not_failed" };
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
    return { ok: true };
}
