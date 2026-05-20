import type { ParentNotificationType, ParentMessageSenderType } from "@prisma/client";
import { prisma } from "../prisma";
import { normalizeStaffEmail } from "../utils/staffJwt";
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

export function normalizeTeacherEmail(email: string) {
  return normalizeStaffEmail(email);
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
  const classroom = await prisma.classroom.findFirst({
    where: { schoolId, name: className },
    orderBy: { updatedAt: "desc" },
  });
  if (classroom) return classroom;
  return prisma.classroom.create({
    data: {
      schoolId,
      name: className,
      teacherName: "",
      teacherEmail: "",
    },
  });
}

export type ParentThreadResolutionDebug = {
  learnerId: string;
  learnerClassName: string | null;
  learnerGrade: string | null;
  matchedClassroomId: string | null;
  matchedClassroomName: string | null;
  classroomTeacherEmail: string;
  classroomTeacherName: string;
  threadId: string | null;
  threadTeacherEmail: string;
  threadTeacherName: string;
};

export async function debugParentThreadResolution(opts: {
  schoolId: string;
  learnerId: string;
  parentId?: string;
  loggedInTeacherEmail?: string;
}): Promise<ParentThreadResolutionDebug | null> {
  const learner = await prisma.learner.findFirst({
    where: { id: opts.learnerId, schoolId: opts.schoolId },
    select: { id: true, className: true, grade: true },
  });
  if (!learner) return null;

  const classroom = await resolveClassroomForLearner(opts.schoolId, learner);
  let thread: { id: string; teacherEmail: string; teacherName: string } | null = null;
  if (opts.parentId) {
    thread = await prisma.parentTeacherThread.findUnique({
      where: {
        schoolId_parentId_learnerId: {
          schoolId: opts.schoolId,
          parentId: opts.parentId,
          learnerId: opts.learnerId,
        },
      },
      select: { id: true, teacherEmail: true, teacherName: true },
    });
  } else {
    thread = await prisma.parentTeacherThread.findFirst({
      where: { schoolId: opts.schoolId, learnerId: opts.learnerId },
      select: { id: true, teacherEmail: true, teacherName: true },
      orderBy: { updatedAt: "desc" },
    });
  }

  return {
    learnerId: learner.id,
    learnerClassName: learner.className,
    learnerGrade: learner.grade,
    matchedClassroomId: classroom?.id ?? null,
    matchedClassroomName: classroom?.name ?? null,
    classroomTeacherEmail: normalizeTeacherEmail(classroom?.teacherEmail || ""),
    classroomTeacherName: String(classroom?.teacherName || "").trim(),
    threadId: thread?.id ?? null,
    threadTeacherEmail: normalizeTeacherEmail(thread?.teacherEmail || ""),
    threadTeacherName: String(thread?.teacherName || "").trim(),
  };
}

export function logParentThreadResolution(
  label: string,
  debug: ParentThreadResolutionDebug,
  loggedInTeacherEmail?: string
) {
  console.log(`[parent-thread] ${label}`, {
    learnerId: debug.learnerId,
    learnerClassName: debug.learnerClassName,
    matchedClassroomId: debug.matchedClassroomId,
    matchedClassroomName: debug.matchedClassroomName,
    classroomTeacherEmail: debug.classroomTeacherEmail,
    threadTeacherEmail: debug.threadTeacherEmail,
    loggedInTeacherEmail: loggedInTeacherEmail
      ? normalizeTeacherEmail(loggedInTeacherEmail)
      : undefined,
  });
}

async function syncThreadTeacherFromClassroom(
  threadId: string,
  classroom: { id: string; teacherName: string; teacherEmail: string } | null
) {
  const teacherName = String(classroom?.teacherName || "").trim() || "Class Teacher";
  const teacherEmail = normalizeTeacherEmail(classroom?.teacherEmail || "");
  return prisma.parentTeacherThread.update({
    where: { id: threadId },
    data: {
      classroomId: classroom?.id ?? null,
      teacherName,
      teacherEmail,
    },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
}

/** Re-resolve classroom teacher for every parent–teacher thread in a school (or all schools). */
export async function repairAllParentTeacherThreads(opts?: { schoolId?: string }) {
  const where = opts?.schoolId ? { schoolId: opts.schoolId } : {};
  const threads = await prisma.parentTeacherThread.findMany({
    where,
    select: { id: true, schoolId: true, learnerId: true, teacherEmail: true, teacherName: true, classroomId: true },
  });

  let updated = 0;
  for (const thread of threads) {
    const learner = await prisma.learner.findFirst({
      where: { id: thread.learnerId, schoolId: thread.schoolId },
      select: { className: true, grade: true },
    });
    if (!learner) continue;

    const classroom = await resolveClassroomForLearner(thread.schoolId, learner);
    const teacherName = String(classroom?.teacherName || "").trim() || "Class Teacher";
    const teacherEmail = normalizeTeacherEmail(classroom?.teacherEmail || "");
    const classroomId = classroom?.id ?? null;

    if (
      thread.classroomId !== classroomId ||
      normalizeTeacherEmail(thread.teacherEmail) !== teacherEmail ||
      String(thread.teacherName || "").trim() !== teacherName
    ) {
      await prisma.parentTeacherThread.update({
        where: { id: thread.id },
        data: { classroomId, teacherName, teacherEmail },
      });
      updated += 1;
    }
  }

  return { scanned: threads.length, updated };
}

export async function syncParentThreadsForClassroom(schoolId: string, classroomId: string) {
  const classroom = await prisma.classroom.findFirst({
    where: { id: classroomId, schoolId },
  });
  if (!classroom) return { updated: 0 };

  const learners = await prisma.learner.findMany({
    where: { schoolId, className: classroom.name },
    select: { id: true },
  });
  const learnerIds = learners.map((l) => l.id);
  if (!learnerIds.length) return { updated: 0 };

  const teacherName = String(classroom.teacherName || "").trim() || "Class Teacher";
  const teacherEmail = normalizeTeacherEmail(classroom.teacherEmail);
  const result = await prisma.parentTeacherThread.updateMany({
    where: { schoolId, learnerId: { in: learnerIds } },
    data: { classroomId: classroom.id, teacherName, teacherEmail },
  });
  return { updated: result.count };
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
  const teacherName = String(classroom?.teacherName || "").trim() || "Class Teacher";
  const teacherEmail = normalizeTeacherEmail(classroom?.teacherEmail || "");

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

  if (existing) {
    const needsSync =
      existing.classroomId !== (classroom?.id ?? null) ||
      normalizeTeacherEmail(existing.teacherEmail) !== teacherEmail ||
      String(existing.teacherName || "").trim() !== teacherName;
    if (needsSync) {
      const thread = await syncThreadTeacherFromClassroom(existing.id, classroom);
      return { thread, classroom, learner };
    }
    return { thread: existing, classroom, learner };
  }

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
