import { prisma } from "../prisma";
import { sendEmailWithAttachment } from "../routes/emailService";
import { buildSetupRequiredPayload } from "./schoolEmailService";
import { activeLearnerWhere } from "../utils/learnerEnrollment";
import {
  classNameFromUnregisteredId,
  isUnregisteredClassroomId,
} from "../routes/classrooms";
import { buildAndGenerateLearnerReportPdf } from "./learnerReportPdfService";

export type ReportEmailError = {
  learnerId: string;
  learnerName: string;
  reason: string;
};

export type ReportEmailSummary = {
  success: boolean;
  sentCount: number;
  failedCount: number;
  missingEmailCount: number;
  errors: ReportEmailError[];
};

type ClassroomLearnerRow = {
  id: string;
  firstName: string;
  lastName: string;
};

type ParentRecipient = {
  email: string;
  name: string;
};

const inFlight = new Map<string, Promise<ReportEmailSummary>>();

function learnerDisplayName(row: { firstName?: string | null; lastName?: string | null }) {
  return `${row.firstName || ""} ${row.lastName || ""}`.trim() || "Learner";
}

async function loadClassroomLearners(
  schoolId: string,
  classroomId: string
): Promise<{ classroomName: string; learners: ClassroomLearnerRow[] } | null> {
  if (isUnregisteredClassroomId(classroomId)) {
    const className = classNameFromUnregisteredId(classroomId);
    const learners = await prisma.learner.findMany({
      where: { ...activeLearnerWhere(schoolId), className },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });
    return { classroomName: className, learners };
  }

  const classroom = await prisma.classroom.findFirst({
    where: { id: classroomId, schoolId },
    select: { id: true, name: true },
  });
  if (!classroom) return null;

  const learners = await prisma.learner.findMany({
    where: { ...activeLearnerWhere(schoolId), className: classroom.name },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  return { classroomName: classroom.name, learners };
}

async function resolveLearnerReportRecipients(
  schoolId: string,
  learnerId: string
): Promise<ParentRecipient[]> {
  const links = await prisma.parentLearnerLink.findMany({
    where: { schoolId, learnerId },
    include: {
      parent: {
        select: {
          firstName: true,
          surname: true,
          email: true,
          communicationByEmail: true,
        },
      },
    },
  });

  const seen = new Set<string>();
  const out: ParentRecipient[] = [];

  for (const link of links) {
    const parent = link.parent;
    if (!parent) continue;
    if (parent.communicationByEmail === false) continue;
    const email = String(parent.email || "").trim().toLowerCase();
    if (!email) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    const name = `${parent.firstName || ""} ${parent.surname || ""}`.trim() || "Parent / Guardian";
    out.push({ email, name });
  }

  return out;
}

function buildReportEmailHtml(opts: {
  schoolName: string;
  learnerName: string;
  classroomName: string;
  parentName: string;
}) {
  const { schoolName, learnerName, classroomName, parentName } = opts;
  return `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
      <p>Dear ${parentName},</p>
      <p>Please find attached the progress report for <strong>${learnerName}</strong> (${classroomName}) from ${schoolName}.</p>
      <p>If you have any questions, please contact the school.</p>
      <p style="color:#6b7280;font-size:12px;">This message was sent from EduClear on behalf of ${schoolName}.</p>
    </div>
  `.trim();
}

async function sendLearnerReportToParents(opts: {
  schoolId: string;
  schoolName: string;
  classroomName: string;
  learner: ClassroomLearnerRow;
}): Promise<{ sent: boolean; missingEmail: boolean; error?: string }> {
  const recipients = await resolveLearnerReportRecipients(opts.schoolId, opts.learner.id);
  const learnerName = learnerDisplayName(opts.learner);

  if (!recipients.length) {
    console.warn("[classroom-report-email] missing parent email", {
      schoolId: opts.schoolId,
      learnerId: opts.learner.id,
      learnerName,
    });
    return { sent: false, missingEmail: true };
  }

  try {
    const { buffer, filename } = await buildAndGenerateLearnerReportPdf({
      schoolId: opts.schoolId,
      learnerId: opts.learner.id,
    });

    const subject = `${opts.schoolName} — Progress report for ${learnerName}`;

    for (const recipient of recipients) {
      const html = buildReportEmailHtml({
        schoolName: opts.schoolName,
        learnerName,
        classroomName: opts.classroomName,
        parentName: recipient.name,
      });

      await sendEmailWithAttachment({
        schoolId: opts.schoolId,
        to: recipient.email,
        subject,
        html,
        attachments: [
          {
            filename,
            content: buffer,
            contentType: "application/pdf",
          },
        ],
      });
    }

    console.info("[classroom-report-email] sent", {
      schoolId: opts.schoolId,
      learnerId: opts.learner.id,
      learnerName,
      recipientCount: recipients.length,
    });

    return { sent: true, missingEmail: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to send report email";
    console.error("[classroom-report-email] failed", {
      schoolId: opts.schoolId,
      learnerId: opts.learner.id,
      learnerName,
      error: message,
    });
    return { sent: false, missingEmail: false, error: message };
  }
}

export async function getClassroomReportEmailPreview(schoolId: string, classroomId: string) {
  const ctx = await loadClassroomLearners(schoolId, classroomId);
  if (!ctx) return null;

  const learnersWithoutEmail: Array<{ id: string; name: string }> = [];
  const parentEmails = new Set<string>();

  for (const learner of ctx.learners) {
    const recipients = await resolveLearnerReportRecipients(schoolId, learner.id);
    if (!recipients.length) {
      learnersWithoutEmail.push({ id: learner.id, name: learnerDisplayName(learner) });
      continue;
    }
    for (const r of recipients) parentEmails.add(r.email);
  }

  return {
    classroomName: ctx.classroomName,
    learnerCount: ctx.learners.length,
    parentEmailCount: parentEmails.size,
    learnersWithoutEmail,
  };
}

async function emailReportsForClassroomInner(
  schoolId: string,
  classroomId: string
): Promise<ReportEmailSummary> {
  const ctx = await loadClassroomLearners(schoolId, classroomId);
  if (!ctx) {
    return {
      success: false,
      sentCount: 0,
      failedCount: 0,
      missingEmailCount: 0,
      errors: [{ learnerId: "", learnerName: "", reason: "Classroom not found" }],
    };
  }

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { name: true },
  });
  const schoolName = String(school?.name || "School").trim() || "School";

  let sentCount = 0;
  let failedCount = 0;
  let missingEmailCount = 0;
  const errors: ReportEmailError[] = [];

  for (const learner of ctx.learners) {
    const result = await sendLearnerReportToParents({
      schoolId,
      schoolName,
      classroomName: ctx.classroomName,
      learner,
    });

    if (result.missingEmail) {
      missingEmailCount += 1;
      errors.push({
        learnerId: learner.id,
        learnerName: learnerDisplayName(learner),
        reason: "No parent/guardian email on file",
      });
      continue;
    }

    if (result.sent) {
      sentCount += 1;
      continue;
    }

    failedCount += 1;
    errors.push({
      learnerId: learner.id,
      learnerName: learnerDisplayName(learner),
      reason: result.error || "Failed to send",
    });
  }

  return {
    success: failedCount === 0,
    sentCount,
    failedCount,
    missingEmailCount,
    errors,
  };
}

export function emailReportsForClassroom(
  schoolId: string,
  classroomId: string,
  idempotencyKey?: string
): Promise<ReportEmailSummary> {
  const key = `class:${schoolId}:${classroomId}:${idempotencyKey || "default"}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const job = emailReportsForClassroomInner(schoolId, classroomId).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, job);
  return job;
}

export async function emailReportForLearner(opts: {
  schoolId: string;
  classroomId: string;
  learnerId: string;
  idempotencyKey?: string;
}): Promise<ReportEmailSummary> {
  const key = `learner:${opts.schoolId}:${opts.classroomId}:${opts.learnerId}:${opts.idempotencyKey || "default"}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const job = (async () => {
    const ctx = await loadClassroomLearners(opts.schoolId, opts.classroomId);
    if (!ctx) {
      return {
        success: false,
        sentCount: 0,
        failedCount: 1,
        missingEmailCount: 0,
        errors: [{ learnerId: opts.learnerId, learnerName: "", reason: "Classroom not found" }],
      };
    }

    const learner = ctx.learners.find((l) => l.id === opts.learnerId);
    if (!learner) {
      return {
        success: false,
        sentCount: 0,
        failedCount: 1,
        missingEmailCount: 0,
        errors: [
          {
            learnerId: opts.learnerId,
            learnerName: "",
            reason: "Learner is not in this classroom",
          },
        ],
      };
    }

    const school = await prisma.school.findUnique({
      where: { id: opts.schoolId },
      select: { name: true },
    });
    const schoolName = String(school?.name || "School").trim() || "School";

    const result = await sendLearnerReportToParents({
      schoolId: opts.schoolId,
      schoolName,
      classroomName: ctx.classroomName,
      learner,
    });

    if (result.missingEmail) {
      return {
        success: false,
        sentCount: 0,
        failedCount: 0,
        missingEmailCount: 1,
        errors: [
          {
            learnerId: learner.id,
            learnerName: learnerDisplayName(learner),
            reason: "No parent/guardian email on file",
          },
        ],
      };
    }

    if (result.sent) {
      return {
        success: true,
        sentCount: 1,
        failedCount: 0,
        missingEmailCount: 0,
        errors: [],
      };
    }

    return {
      success: false,
      sentCount: 0,
      failedCount: 1,
      missingEmailCount: 0,
      errors: [
        {
          learnerId: learner.id,
          learnerName: learnerDisplayName(learner),
          reason: result.error || "Failed to send",
        },
      ],
    };
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, job);
  return job;
}

export function isEmailSetupError(err: unknown): boolean {
  return Boolean((err as Error & { setupRequired?: boolean })?.setupRequired);
}

export { buildSetupRequiredPayload };
