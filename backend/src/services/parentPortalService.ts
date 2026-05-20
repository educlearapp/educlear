import type { ParentNotificationType, ParentMessageSenderType } from "@prisma/client";
import { prisma } from "../prisma";

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

export async function resolveClassroomForLearner(schoolId: string, learner: {
  className?: string | null;
  grade?: string | null;
}) {
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

export async function createParentNotification(opts: {
  schoolId: string;
  parentId: string;
  learnerId?: string | null;
  type: ParentNotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.parentNotification.create({
    data: {
      schoolId: opts.schoolId,
      parentId: opts.parentId,
      learnerId: opts.learnerId || null,
      type: opts.type,
      title: opts.title,
      message: opts.message,
      metadata: opts.metadata ? (opts.metadata as object) : undefined,
    },
  });
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
  const monthLabel = String(opts.month || "this period").trim();
  const parents = await prisma.parent.findMany({
    where: {
      schoolId: opts.schoolId,
      ...(opts.learnerIds?.length
        ? {
            links: { some: { learnerId: { in: opts.learnerIds } } },
          }
        : {}),
    },
    select: { id: true },
  });

  const seen = new Set<string>();
  for (const p of parents) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    await createParentNotification({
      schoolId: opts.schoolId,
      parentId: p.id,
      type: "INVOICE_READY",
      title: "Invoice ready",
      message: `Your invoice for ${monthLabel} is ready.`,
      metadata: { runId: opts.runId, month: monthLabel },
    });
    await createParentNotification({
      schoolId: opts.schoolId,
      parentId: p.id,
      type: "STATEMENT_READY",
      title: "Statement ready",
      message: `Your statement for ${monthLabel} is ready to view.`,
      metadata: { runId: opts.runId, month: monthLabel },
    });
  }
  return seen.size;
}

export async function queueParentOutreach(opts: {
  schoolId: string;
  parentId: string;
  channels: Array<"SMS" | "EMAIL" | "WHATSAPP">;
  subject: string;
  body: string;
  cellNo?: string | null;
  email?: string | null;
}) {
  const rows = [];
  for (const channel of opts.channels) {
    const recipient =
      channel === "EMAIL"
        ? String(opts.email || "").trim()
        : String(opts.cellNo || "").trim();
    if (!recipient) continue;
    rows.push(
      prisma.parentOutreachQueue.create({
        data: {
          schoolId: opts.schoolId,
          parentId: opts.parentId,
          channel,
          recipient,
          subject: opts.subject,
          body: opts.body,
          status: "QUEUED",
        },
      })
    );
  }
  return Promise.all(rows);
}

export async function runMigrationParentOnboarding(schoolId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) throw new Error("School not found");

  const parents = await prisma.parent.findMany({
    where: {
      schoolId,
      OR: [
        { email: { not: null } },
        { cellNo: { not: "" } },
      ],
    },
  });

  const portalUrl =
    process.env.PARENT_PORTAL_URL || "https://educlear.co.za/parent";
  let invited = 0;

  for (const parent of parents) {
    const hasContact =
      Boolean(String(parent.email || "").trim()) ||
      Boolean(String(parent.cellNo || "").trim());
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

    const body = [
      `${school.name} is now using the EduClear Parent Portal.`,
      "",
      "View invoices, statements, school notices, homework, and message your child's class teacher.",
      "",
      `Open: ${portalUrl}`,
      "",
      "On your phone: open the link in your browser, then use Add to Home Screen to install the app.",
    ].join("\n");

    await createParentNotification({
      schoolId,
      parentId: parent.id,
      type: "ONBOARDING",
      title: "Welcome to EduClear Parent Portal",
      message: body,
      metadata: { portalUrl, schoolName: school.name },
    });

    const channels: Array<"SMS" | "EMAIL" | "WHATSAPP"> = [];
    if (parent.communicationBySMS && parent.cellNo) {
      channels.push("SMS", "WHATSAPP");
    }
    if (parent.communicationByEmail && parent.email) {
      channels.push("EMAIL");
    }

    await queueParentOutreach({
      schoolId,
      parentId: parent.id,
      channels,
      subject: `${school.name} — EduClear Parent Portal`,
      body,
      cellNo: parent.cellNo,
      email: parent.email,
    });

    invited += 1;
  }

  return { invited, schoolName: school.name };
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
