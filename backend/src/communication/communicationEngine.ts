import type {
  CommunicationCategory,
  CommunicationChannel,
  ParentNotificationType,
} from "@prisma/client";
import { prisma } from "../prisma";
import {
  communicationCategoryFromParentNotificationType,
  outreachChannelToCommunicationChannel,
} from "./communicationTypes";
import { ensureDefaultCommunicationTemplates, resolveRenderedMessage } from "./communicationTemplates";

const portalUrlDefault =
  process.env.PARENT_PORTAL_URL || "https://educlear.co.za/parent";

export { ensureDefaultCommunicationTemplates, portalUrlDefault };

export async function submitParentInAppNotification(opts: {
  schoolId: string;
  parentId: string;
  learnerId?: string | null;
  parentNotificationType: ParentNotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  createdBy?: string;
  templateKey?: string | null;
  templateVariables?: Record<string, string | undefined | null>;
  communicationCategoryOverride?: CommunicationCategory;
}) {
  await ensureDefaultCommunicationTemplates(prisma);

  const category =
    opts.communicationCategoryOverride ??
    communicationCategoryFromParentNotificationType(opts.parentNotificationType);

  let title = String(opts.title || "").trim();
  let message = String(opts.message || "").trim();

  if (opts.templateKey) {
    const resolved = await resolveRenderedMessage(
      prisma,
      opts.schoolId,
      opts.templateKey,
      opts.templateVariables || {}
    );
    if (resolved.found) {
      if (String(resolved.subject || "").trim()) title = resolved.subject;
      if (String(resolved.body || "").trim()) message = resolved.body;
    }
  }

  if (!title) title = "Notice";
  if (!message) message = "";

  return prisma.$transaction(async (tx) => {
    const notif = await tx.parentNotification.create({
      data: {
        schoolId: opts.schoolId,
        parentId: opts.parentId,
        learnerId: opts.learnerId || null,
        type: opts.parentNotificationType,
        title,
        message,
        metadata: opts.metadata ? (opts.metadata as object) : undefined,
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
          ? ({ ...(opts.templateVariables || {}), ...(opts.metadata || {}) } as Record<string, unknown>)
          : undefined) as object | undefined,
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

export async function enqueueOutboundMessage(opts: {
  schoolId: string;
  parentId?: string | null;
  learnerId?: string | null;
  category: CommunicationCategory;
  channel: CommunicationChannel;
  templateKey?: string | null;
  subject: string;
  body: string;
  recipient: string;
  variables?: Record<string, unknown>;
  campaignId?: string | null;
  createdBy?: string;
}) {
  return prisma.communicationMessage.create({
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
      variables: opts.variables ? (opts.variables as object) : undefined,
      campaignId: opts.campaignId || null,
      status: "queued",
      createdBy: opts.createdBy || "system",
    },
  });
}

export async function queueParentOutreachChannels(opts: {
  schoolId: string;
  parentId: string;
  channels: Array<"SMS" | "EMAIL" | "WHATSAPP">;
  subject: string;
  body: string;
  cellNo?: string | null;
  email?: string | null;
  campaignId?: string | null;
  category?: CommunicationCategory;
  createdBy?: string;
}) {
  const category = opts.category || "onboarding_invite";
  const tasks: Promise<unknown>[] = [];
  for (const ch of opts.channels) {
    const channel = outreachChannelToCommunicationChannel(ch);
    const recipient =
      channel === "email" ? String(opts.email || "").trim() : String(opts.cellNo || "").trim();
    if (!recipient) continue;
    tasks.push(
      enqueueOutboundMessage({
        schoolId: opts.schoolId,
        parentId: opts.parentId,
        category,
        channel,
        subject: opts.subject,
        body: opts.body,
        recipient,
        campaignId: opts.campaignId,
        createdBy: opts.createdBy || "outreach",
      })
    );
  }
  await Promise.all(tasks);
}

export async function queueBillingFollowupsForParent(opts: {
  schoolId: string;
  parentId: string;
  monthLabel: string;
  runId: string;
  email: string | null;
  cellNo: string | null;
  communicationByEmail: boolean;
  communicationBySMS: boolean;
  campaignId?: string | null;
}) {
  await ensureDefaultCommunicationTemplates(prisma);
  const school = await prisma.school.findUnique({
    where: { id: opts.schoolId },
    select: { name: true },
  });
  const schoolName = school?.name || "School";
  const portalUrl = portalUrlDefault;
  const vars: Record<string, string | undefined | null> = {
    month: opts.monthLabel,
    runId: opts.runId,
    schoolName,
    portalUrl,
  };

  const inv = await resolveRenderedMessage(prisma, opts.schoolId, "invoice_ready", vars);
  const stmt = await resolveRenderedMessage(prisma, opts.schoolId, "statement_ready", vars);

  const tasks: Promise<unknown>[] = [];

  if (opts.communicationByEmail && opts.email?.trim()) {
    if (inv.found) {
      tasks.push(
        enqueueOutboundMessage({
          schoolId: opts.schoolId,
          parentId: opts.parentId,
          category: "invoice_ready",
          channel: "email",
          templateKey: "invoice_ready",
          subject: inv.subject,
          body: inv.body,
          recipient: opts.email.trim(),
          variables: vars as unknown as Record<string, unknown>,
          campaignId: opts.campaignId,
          createdBy: "invoice_run",
        })
      );
    }
    if (stmt.found) {
      tasks.push(
        enqueueOutboundMessage({
          schoolId: opts.schoolId,
          parentId: opts.parentId,
          category: "statement_ready",
          channel: "email",
          templateKey: "statement_ready",
          subject: stmt.subject,
          body: stmt.body,
          recipient: opts.email.trim(),
          variables: vars as unknown as Record<string, unknown>,
          campaignId: opts.campaignId,
          createdBy: "invoice_run",
        })
      );
    }
  }

  if (opts.communicationBySMS && opts.cellNo?.trim()) {
    const smsBody = `${schoolName}: Invoice and statement for ${opts.monthLabel} are ready. ${portalUrl}`;
    tasks.push(
      enqueueOutboundMessage({
        schoolId: opts.schoolId,
        parentId: opts.parentId,
        category: "invoice_ready",
        channel: "sms",
        subject: "",
        body: smsBody,
        recipient: opts.cellNo.trim(),
        variables: vars as unknown as Record<string, unknown>,
        campaignId: opts.campaignId,
        createdBy: "invoice_run",
      })
    );
    tasks.push(
      enqueueOutboundMessage({
        schoolId: opts.schoolId,
        parentId: opts.parentId,
        category: "invoice_ready",
        channel: "whatsapp",
        subject: "",
        body: smsBody,
        recipient: opts.cellNo.trim(),
        variables: vars as unknown as Record<string, unknown>,
        campaignId: opts.campaignId,
        createdBy: "invoice_run",
      })
    );
  }

  await Promise.all(tasks);
}

export async function queueAttendanceCommunication(opts: {
  schoolId: string;
  parentId: string;
  learnerId: string;
  kind: "absent" | "late";
  title: string;
  message: string;
  createdBy?: string;
}) {
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
