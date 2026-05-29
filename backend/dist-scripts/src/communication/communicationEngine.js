"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.portalUrlDefault = exports.ensureDefaultCommunicationTemplates = void 0;
exports.submitParentInAppNotification = submitParentInAppNotification;
exports.enqueueOutboundMessage = enqueueOutboundMessage;
exports.queueParentOutreachChannels = queueParentOutreachChannels;
exports.queueBillingFollowupsForParent = queueBillingFollowupsForParent;
exports.queueAttendanceCommunication = queueAttendanceCommunication;
const prisma_1 = require("../prisma");
const communicationTypes_1 = require("./communicationTypes");
const communicationTemplates_1 = require("./communicationTemplates");
Object.defineProperty(exports, "ensureDefaultCommunicationTemplates", { enumerable: true, get: function () { return communicationTemplates_1.ensureDefaultCommunicationTemplates; } });
const portalUrlDefault = process.env.PARENT_PORTAL_URL || "https://educlear.co.za/parent";
exports.portalUrlDefault = portalUrlDefault;
async function submitParentInAppNotification(opts) {
    await (0, communicationTemplates_1.ensureDefaultCommunicationTemplates)(prisma_1.prisma);
    const category = opts.communicationCategoryOverride ??
        (0, communicationTypes_1.communicationCategoryFromParentNotificationType)(opts.parentNotificationType);
    let title = String(opts.title || "").trim();
    let message = String(opts.message || "").trim();
    if (opts.templateKey) {
        const resolved = await (0, communicationTemplates_1.resolveRenderedMessage)(prisma_1.prisma, opts.schoolId, opts.templateKey, opts.templateVariables || {});
        if (resolved.found) {
            if (String(resolved.subject || "").trim())
                title = resolved.subject;
            if (String(resolved.body || "").trim())
                message = resolved.body;
        }
    }
    if (!title)
        title = "Notice";
    if (!message)
        message = "";
    return prisma_1.prisma.$transaction(async (tx) => {
        const notif = await tx.parentNotification.create({
            data: {
                schoolId: opts.schoolId,
                parentId: opts.parentId,
                learnerId: opts.learnerId || null,
                type: opts.parentNotificationType,
                title,
                message,
                metadata: opts.metadata ? opts.metadata : undefined,
            },
        });
        const msg = await tx.communicationMessage.create({
            data: {
                schoolId: opts.schoolId,
                parentId: opts.parentId,
                learnerId: opts.learnerId || null,
                category,
                channel: "in_app",
                templateKey: opts.templateKey || null,
                subject: title,
                body: message,
                variables: (opts.templateVariables || opts.metadata
                    ? { ...(opts.templateVariables || {}), ...(opts.metadata || {}) }
                    : undefined),
                status: "sent",
                queuedAt: new Date(),
                sentAt: new Date(),
                recipient: `parent:${opts.parentId}`,
                parentNotificationId: notif.id,
                createdBy: opts.createdBy || "system",
            },
        });
        await tx.communicationLog.create({
            data: {
                schoolId: opts.schoolId,
                messageId: msg.id,
                event: "in_app_delivered",
                detail: { parentNotificationId: notif.id },
            },
        });
        return { parentNotification: notif, communicationMessage: msg };
    });
}
async function enqueueOutboundMessage(opts) {
    return prisma_1.prisma.communicationMessage.create({
        data: {
            schoolId: opts.schoolId,
            parentId: opts.parentId || null,
            learnerId: opts.learnerId || null,
            category: opts.category,
            channel: opts.channel,
            templateKey: opts.templateKey || null,
            subject: opts.subject,
            body: opts.body,
            recipient: opts.recipient,
            variables: opts.variables ? opts.variables : undefined,
            campaignId: opts.campaignId || null,
            status: "queued",
            createdBy: opts.createdBy || "system",
        },
    });
}
async function queueParentOutreachChannels(opts) {
    const category = opts.category || "onboarding_invite";
    const tasks = [];
    for (const ch of opts.channels) {
        const channel = (0, communicationTypes_1.outreachChannelToCommunicationChannel)(ch);
        const recipient = channel === "email" ? String(opts.email || "").trim() : String(opts.cellNo || "").trim();
        if (!recipient)
            continue;
        tasks.push(enqueueOutboundMessage({
            schoolId: opts.schoolId,
            parentId: opts.parentId,
            category,
            channel,
            subject: opts.subject,
            body: opts.body,
            recipient,
            campaignId: opts.campaignId,
            createdBy: opts.createdBy || "outreach",
        }));
    }
    await Promise.all(tasks);
}
async function queueBillingFollowupsForParent(opts) {
    await (0, communicationTemplates_1.ensureDefaultCommunicationTemplates)(prisma_1.prisma);
    const school = await prisma_1.prisma.school.findUnique({
        where: { id: opts.schoolId },
        select: { name: true },
    });
    const schoolName = school?.name || "School";
    const portalUrl = portalUrlDefault;
    const vars = {
        month: opts.monthLabel,
        runId: opts.runId,
        schoolName,
        portalUrl,
    };
    const inv = await (0, communicationTemplates_1.resolveRenderedMessage)(prisma_1.prisma, opts.schoolId, "invoice_ready", vars);
    const stmt = await (0, communicationTemplates_1.resolveRenderedMessage)(prisma_1.prisma, opts.schoolId, "statement_ready", vars);
    const tasks = [];
    if (opts.communicationByEmail && opts.email?.trim()) {
        if (inv.found) {
            tasks.push(enqueueOutboundMessage({
                schoolId: opts.schoolId,
                parentId: opts.parentId,
                category: "invoice_ready",
                channel: "email",
                templateKey: "invoice_ready",
                subject: inv.subject,
                body: inv.body,
                recipient: opts.email.trim(),
                variables: vars,
                campaignId: opts.campaignId,
                createdBy: "invoice_run",
            }));
        }
        if (stmt.found) {
            tasks.push(enqueueOutboundMessage({
                schoolId: opts.schoolId,
                parentId: opts.parentId,
                category: "statement_ready",
                channel: "email",
                templateKey: "statement_ready",
                subject: stmt.subject,
                body: stmt.body,
                recipient: opts.email.trim(),
                variables: vars,
                campaignId: opts.campaignId,
                createdBy: "invoice_run",
            }));
        }
    }
    if (opts.communicationBySMS && opts.cellNo?.trim()) {
        const smsBody = `${schoolName}: Invoice and statement for ${opts.monthLabel} are ready. ${portalUrl}`;
        tasks.push(enqueueOutboundMessage({
            schoolId: opts.schoolId,
            parentId: opts.parentId,
            category: "invoice_ready",
            channel: "sms",
            subject: "",
            body: smsBody,
            recipient: opts.cellNo.trim(),
            variables: vars,
            campaignId: opts.campaignId,
            createdBy: "invoice_run",
        }));
        tasks.push(enqueueOutboundMessage({
            schoolId: opts.schoolId,
            parentId: opts.parentId,
            category: "invoice_ready",
            channel: "whatsapp",
            subject: "",
            body: smsBody,
            recipient: opts.cellNo.trim(),
            variables: vars,
            campaignId: opts.campaignId,
            createdBy: "invoice_run",
        }));
    }
    await Promise.all(tasks);
}
async function queueAttendanceCommunication(opts) {
    return submitParentInAppNotification({
        schoolId: opts.schoolId,
        parentId: opts.parentId,
        learnerId: opts.learnerId,
        parentNotificationType: "SCHOOL_NOTICE",
        communicationCategoryOverride: opts.kind === "absent" ? "attendance_absent" : "attendance_late",
        title: opts.title,
        message: opts.message,
        metadata: { attendanceKind: opts.kind },
        createdBy: opts.createdBy || "attendance",
    });
}
