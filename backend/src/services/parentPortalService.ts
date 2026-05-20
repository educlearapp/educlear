import type { ParentNotificationType, ParentMessageSenderType } from "@prisma/client";
import { prisma } from "../prisma";
import {
  ensureDefaultCommunicationTemplates,
  portalUrlDefault,
  queueBillingFollowupsForParent,
  queueParentOutreachChannels,
  submitParentInAppNotification,
} from "../communication/communicationEngine";
import { resolveRenderedMessage } from "../communication/communicationTemplates";

export function normalizeSaPhone(phone: string) {
  const digits = String(phone || "").replace(/\D/g, "");
  const localCell = digits.startsWith("27") ? `0${digits.slice(2)}` : digits;
  const internationalCell = digits.startsWith("27")
    ? `+${digits}`
    : `+27${digits.replace(/^0/, "")}`;
  const plainInternational = internationalCell.replace("+", "");
  return { raw: phone, localCell, internationalCell, plainInternational };
}

export function phoneOrClause(rawCellNo: string, idNumber?: string) {
  const { localCell, internationalCell, plainInternational } = normalizeSaPhone(rawCellNo);
  return [
    { cellNo: rawCellNo },
    { cellNo: localCell },
    { cellNo: internationalCell },
    { cellNo: plainInternational },
    ...(idNumber ? [{ idNumber }] : []),
  ];
}

export async function findParentByCredentials(opts: {
  schoolId?: string;
  cellNo?: string;
  idNumber?: string;
}) {
  const schoolId = String(opts.schoolId || "").trim();
  const rawCellNo = String(opts.cellNo || "").trim();
  const idNumber = String(opts.idNumber || "").trim();

  if (!idNumber && !rawCellNo) return null;

  const where: any = {
    ...(schoolId ? { schoolId } : {}),
    OR: idNumber
      ? [{ idNumber }, ...(rawCellNo ? phoneOrClause(rawCellNo) : [])]
      : rawCellNo
        ? phoneOrClause(rawCellNo)
        : [],
  };

  return prisma.parent.findFirst({
    where,
    include: {
      links: { include: { learner: true } },
      school: { select: { id: true, name: true } },
    },
  });
}

export async function resolveClassroomForLearner(
  schoolId: string,
  learner: {
    className?: string | null;
    grade?: string | null;
  }
) {
  const className = String(learner.className || "").trim();
  if (!className) return null;
  let classroom = await prisma.classroom.findFirst({
    where: { schoolId, name: className },
  });
  if (!classroom) {
    classroom = await prisma.classroom.create({
      data: {
        schoolId,
        name: className,
        teacherName: "",
        teacherEmail: "",
      },
    });
  }
  return classroom;
}

export async function getOrCreateThread(opts: {
  schoolId: string;
  parentId: string;
  learnerId: string;
}) {
  const learner = await prisma.learner.findFirst({
    where: { id: opts.learnerId, schoolId: opts.schoolId },
  });
  if (!learner) throw new Error("Learner not found");

  const classroom = await resolveClassroomForLearner(opts.schoolId, learner);
  const teacherName = classroom?.teacherName || "Class Teacher";
  const teacherEmail = classroom?.teacherEmail || "";

  const existing = await prisma.parentTeacherThread.findUnique({
    where: {
      schoolId_parentId_learnerId: {
        schoolId: opts.schoolId,
        parentId: opts.parentId,
        learnerId: opts.learnerId,
      },
    },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (existing) return { thread: existing, classroom, learner };

  const thread = await prisma.parentTeacherThread.create({
    data: {
      schoolId: opts.schoolId,
      parentId: opts.parentId,
      learnerId: opts.learnerId,
      classroomId: classroom?.id || null,
      teacherName,
      teacherEmail,
    },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  return { thread, classroom, learner };
}

function templateKeyForParentType(t: ParentNotificationType): string | null {
  switch (t) {
    case "INVOICE_READY":
      return "invoice_ready";
    case "STATEMENT_READY":
      return "statement_ready";
    case "ONBOARDING":
      return "onboarding_welcome";
    case "HOMEWORK":
      return "homework_uploaded";
    case "INCIDENT":
      return "incident_notice";
    case "ASSESSMENT":
    case "EXAM":
    case "SCHOOL_NOTICE":
      return "assessment_reminder";
    case "TEACHER_MESSAGE":
      return "teacher_reply";
    default:
      return null;
  }
}

export async function createParentNotification(opts: {
  schoolId: string;
  parentId: string;
  learnerId?: string | null;
  type: ParentNotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  await ensureDefaultCommunicationTemplates(prisma);
  const school = await prisma.school.findUnique({
    where: { id: opts.schoolId },
    select: { name: true },
  });
  const schoolName = school?.name || "School";
  const md = (opts.metadata || {}) as Record<string, unknown>;
  const templateKey = templateKeyForParentType(opts.type);
  const templateVariables: Record<string, string | undefined> = {
    schoolName,
    portalUrl: portalUrlDefault,
    noticeTitle: opts.title,
    noticeBody: opts.message,
    homeworkTitle: opts.title,
    incidentSummary: opts.message,
    messagePreview: opts.message.slice(0, 800),
    month: md.month != null ? String(md.month) : undefined,
    runId: md.runId != null ? String(md.runId) : undefined,
  };

  const { parentNotification } = await submitParentInAppNotification({
    schoolId: opts.schoolId,
    parentId: opts.parentId,
    learnerId: opts.learnerId ?? null,
    parentNotificationType: opts.type,
    title: opts.title,
    message: opts.message,
    metadata: opts.metadata,
    templateKey: templateKey || undefined,
    templateVariables: templateKey ? templateVariables : undefined,
  });
  return parentNotification;
}

export async function notifyParentsForLearner(opts: {
  schoolId: string;
  learnerId: string;
  type: ParentNotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  const links = await prisma.parentLearnerLink.findMany({
    where: { schoolId: opts.schoolId, learnerId: opts.learnerId },
    select: { parentId: true },
  });
  const parentIds = [...new Set(links.map((l) => l.parentId))];
  await Promise.all(
    parentIds.map((parentId) =>
      createParentNotification({
        schoolId: opts.schoolId,
        parentId,
        learnerId: opts.learnerId,
        type: opts.type,
        title: opts.title,
        message: opts.message,
        metadata: opts.metadata,
      })
    )
  );
  return parentIds.length;
}

export async function notifyParentsInvoiceRun(opts: {
  schoolId: string;
  month: string;
  runId: string;
  learnerIds?: string[];
}) {
  await ensureDefaultCommunicationTemplates(prisma);
  const monthLabel = String(opts.month || "this period").trim();
  const school = await prisma.school.findUnique({
    where: { id: opts.schoolId },
    select: { name: true },
  });
  const schoolName = school?.name || "School";
  const portalUrl = portalUrlDefault;
  const templateVars = {
    month: monthLabel,
    runId: opts.runId,
    schoolName,
    portalUrl,
  };

  const parents = await prisma.parent.findMany({
    where: {
      schoolId: opts.schoolId,
      ...(opts.learnerIds?.length
        ? {
            links: { some: { learnerId: { in: opts.learnerIds } } },
          }
        : {}),
    },
    select: {
      id: true,
      email: true,
      cellNo: true,
      communicationByEmail: true,
      communicationBySMS: true,
    },
  });

  const seen = new Set<string>();
  for (const p of parents) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);

    await submitParentInAppNotification({
      schoolId: opts.schoolId,
      parentId: p.id,
      parentNotificationType: "INVOICE_READY",
      title: "",
      message: "",
      metadata: { runId: opts.runId, month: monthLabel },
      templateKey: "invoice_ready",
      templateVariables: templateVars,
      createdBy: "invoice_run",
    });

    await submitParentInAppNotification({
      schoolId: opts.schoolId,
      parentId: p.id,
      parentNotificationType: "STATEMENT_READY",
      title: "",
      message: "",
      metadata: { runId: opts.runId, month: monthLabel },
      templateKey: "statement_ready",
      templateVariables: templateVars,
      createdBy: "invoice_run",
    });

    await queueBillingFollowupsForParent({
      schoolId: opts.schoolId,
      parentId: p.id,
      monthLabel,
      runId: opts.runId,
      email: p.email,
      cellNo: p.cellNo,
      communicationByEmail: p.communicationByEmail,
      communicationBySMS: p.communicationBySMS,
    });
  }
  return seen.size;
}

export async function runMigrationParentOnboarding(schoolId: string) {
  await ensureDefaultCommunicationTemplates(prisma);
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) throw new Error("School not found");

  const parents = await prisma.parent.findMany({
    where: {
      schoolId,
      OR: [{ email: { not: null } }, { cellNo: { not: "" } }],
    },
  });

  const portalUrl = portalUrlDefault;
  let invited = 0;

  const campaign = await prisma.communicationCampaign.create({
    data: {
      schoolId,
      name: `Parent onboarding (${school.name})`,
      category: "onboarding_invite",
      metadata: { source: "migration_onboarding" },
      createdBy: "migration",
    },
  });

  for (const parent of parents) {
    const hasContact =
      Boolean(String(parent.email || "").trim()) || Boolean(String(parent.cellNo || "").trim());
    if (!hasContact) continue;

    await prisma.parentOnboarding.upsert({
      where: { parentId: parent.id },
      create: {
        schoolId,
        parentId: parent.id,
        status: "INVITED",
      },
      update: { status: "INVITED", invitedAt: new Date() },
    });

    const templateVars = {
      schoolName: school.name,
      portalUrl,
    };

    await submitParentInAppNotification({
      schoolId,
      parentId: parent.id,
      parentNotificationType: "ONBOARDING",
      title: "",
      message: "",
      templateKey: "onboarding_welcome",
      templateVariables: templateVars,
      metadata: { portalUrl, schoolName: school.name, campaignId: campaign.id },
      createdBy: "migration",
    });

    const channels: Array<"SMS" | "EMAIL" | "WHATSAPP"> = [];
    if (parent.communicationBySMS && parent.cellNo) {
      channels.push("SMS", "WHATSAPP");
    }
    if (parent.communicationByEmail && parent.email) {
      channels.push("EMAIL");
    }

    const rendered = await resolveRenderedMessage(prisma, schoolId, "onboarding_welcome", templateVars);
    const subject = rendered.found
      ? rendered.subject
      : `${school.name} — EduClear Parent Portal`;
    const body = rendered.found
      ? rendered.body
      : [
          `${school.name} is now using the EduClear Parent Portal.`,
          "",
          `Open: ${portalUrl}`,
        ].join("\n");

    await queueParentOutreachChannels({
      schoolId,
      parentId: parent.id,
      channels,
      subject,
      body,
      cellNo: parent.cellNo,
      email: parent.email,
      campaignId: campaign.id,
      category: "onboarding_invite",
      createdBy: "migration",
    });

    invited += 1;
  }

  return { invited, schoolName: school.name, campaignId: campaign.id };
}

export function mapThreadMessage(msg: {
  id: string;
  senderType: ParentMessageSenderType;
  senderName: string;
  body: string;
  attachments: unknown;
  isRead: boolean;
  createdAt: Date;
}) {
  return {
    id: msg.id,
    sender:
      msg.senderType === "PARENT"
        ? "PARENT"
        : msg.senderType === "TEACHER"
          ? "TEACHER"
          : "ADMIN",
    senderType: msg.senderType,
    senderName: msg.senderName,
    body: msg.body,
    attachments: msg.attachments,
    isRead: msg.isRead,
    createdAt: msg.createdAt.toISOString(),
  };
}
