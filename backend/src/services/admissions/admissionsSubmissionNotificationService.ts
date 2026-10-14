/**
 * Submission confirmation emails for online admissions.
 *
 * Sent only after a confirmed DRAFT → SUBMITTED transition (never on draft create/autosave).
 * Runs after the HTTP response: a failure here never blocks or reverses an accepted application.
 * One minimal message per recipient (reference, intake, grade — no names, ID numbers, bank details
 * or documents). Delivery attempts are recorded as AdmissionAuditEvent rows holding only a hashed
 * recipient key and an error code — never the address or provider message.
 */
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { sendSchoolEmail, type SendSchoolEmailInput } from "../schoolEmailService";
import {
  classifyResendIdempotencyConflict,
  isResendNetworkUnavailableError,
  ResendHttpError,
} from "../resendClient";
import { isOutboundEmailDisabled } from "../../utils/outboundSafety";

export const ADMISSION_NOTIFICATION_SENT = "ADMISSION_NOTIFICATION_SENT";
export const ADMISSION_NOTIFICATION_ATTEMPT_FAILED = "ADMISSION_NOTIFICATION_ATTEMPT_FAILED";
export const ADMISSION_NOTIFICATION_FAILED = "ADMISSION_NOTIFICATION_FAILED";
export const ADMISSION_NOTIFICATION_SKIPPED = "ADMISSION_NOTIFICATION_SKIPPED";

/** Attempt 1 immediately, then after 30 s and 2 min. In-process only (no queue infrastructure). */
export const DEFAULT_NOTIFICATION_RETRY_DELAYS_MS = [0, 30_000, 120_000] as const;

export type AdmissionRecipientType = "SCHOOL" | "PARENT";

export type AdmissionNotificationSender = (
  schoolId: string,
  input: SendSchoolEmailInput
) => Promise<unknown>;

export type SubmissionNotificationDeps = {
  prisma: PrismaClient;
  send?: AdmissionNotificationSender;
  sleep?: (ms: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
  isEmailDisabled?: () => boolean;
};

export type RecipientOutcome = {
  recipientType: AdmissionRecipientType;
  recipientKey: string;
  result: "SENT" | "FAILED" | "SKIPPED_ALREADY_SENT" | "SKIPPED_DISABLED";
  attempts: number;
  errorCode?: string;
};

export type SubmissionNotificationResult = {
  outcomes: RecipientOutcome[];
  skippedReasons: string[];
};

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

export function normalizeRecipientEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email && email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

export function recipientKeyFor(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function classifyNotificationError(err: unknown): { code: string; retryable: boolean } {
  const conflict = classifyResendIdempotencyConflict(err);
  if (conflict === "in_progress") return { code: "IDEMPOTENCY_IN_PROGRESS", retryable: true };
  if (conflict === "key_reused_different_payload") {
    return { code: "IDEMPOTENCY_KEY_REUSED", retryable: false };
  }
  if ((err as { setupRequired?: boolean } | null)?.setupRequired) {
    return { code: "SCHOOL_EMAIL_SETUP_REQUIRED", retryable: false };
  }
  if (isResendNetworkUnavailableError(err)) return { code: "NETWORK_UNAVAILABLE", retryable: true };
  if (err instanceof ResendHttpError) {
    const status = err.httpStatus;
    return {
      code: `PROVIDER_HTTP_${status}`,
      retryable: status === 408 || status === 429 || status >= 500,
    };
  }
  return { code: "SEND_FAILED", retryable: true };
}

type MessageContext = {
  schoolName: string;
  applicationNumber: string;
  intakeYear: number;
  requestedGrade: string | null;
  feeRequired: boolean;
};

export function buildSchoolNotificationEmail(ctx: MessageContext): { subject: string; html: string } {
  const grade = ctx.requestedGrade ? escapeHtml(ctx.requestedGrade) : "—";
  return {
    subject: `New admission application ${ctx.applicationNumber}`,
    html: [
      `<p>A new online admission application has been submitted to ${escapeHtml(ctx.schoolName)}.</p>`,
      `<p><strong>Application number:</strong> ${escapeHtml(ctx.applicationNumber)}<br/>`,
      `<strong>Intake year:</strong> ${escapeHtml(ctx.intakeYear)}<br/>`,
      `<strong>Grade:</strong> ${grade}</p>`,
      `<p>Sign in to EduClear and open <strong>Admissions</strong> to review the application.</p>`,
    ].join(""),
  };
}

export function buildParentConfirmationEmail(ctx: MessageContext): { subject: string; html: string } {
  const grade = ctx.requestedGrade ? escapeHtml(ctx.requestedGrade) : "—";
  const feeLine = ctx.feeRequired
    ? `<p>If you still need to pay the admission fee, please use <strong>${escapeHtml(
        ctx.applicationNumber
      )}</strong> as your payment reference. Payment instructions are shown on the application page on the device you used to apply.</p>`
    : "";
  return {
    subject: `Application received — ${ctx.applicationNumber}`,
    html: [
      `<p>Thank you. ${escapeHtml(ctx.schoolName)} has received your online admission application.</p>`,
      `<p><strong>Application number:</strong> ${escapeHtml(ctx.applicationNumber)}<br/>`,
      `<strong>Intake year:</strong> ${escapeHtml(ctx.intakeYear)}<br/>`,
      `<strong>Grade:</strong> ${grade}</p>`,
      feeLine,
      `<p>Please keep this number for your records. The school will contact you about next steps.</p>`,
    ].join(""),
  };
}

async function recordEvent(
  prisma: PrismaClient,
  schoolId: string,
  applicationId: string,
  eventType: string,
  metadata: Record<string, string | number | boolean>
): Promise<void> {
  try {
    await prisma.admissionAuditEvent.create({
      data: { schoolId, applicationId, eventType, actorType: "SYSTEM", metadataJson: metadata },
    });
  } catch (err) {
    console.warn("[admissions-notify] audit write failed", {
      applicationId,
      eventType,
      error: err instanceof Error ? err.name : "unknown",
    });
  }
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as { unref?: () => void }).unref?.();
  });

/**
 * Resolve school recipients: the admissions contact address plus active users listed in
 * notificationRecipientUserIds that belong to the same school. Deduplicated.
 */
export async function resolveSchoolNotificationRecipients(
  prisma: PrismaClient,
  schoolId: string,
  settings: { admissionContactEmail: string | null; notificationRecipientUserIds: unknown }
): Promise<string[]> {
  const out = new Set<string>();
  const contact = normalizeRecipientEmail(settings.admissionContactEmail);
  if (contact) out.add(contact);
  const ids = Array.isArray(settings.notificationRecipientUserIds)
    ? settings.notificationRecipientUserIds.filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0
      )
    : [];
  if (ids.length) {
    const users = await prisma.user.findMany({
      where: { id: { in: ids }, schoolId, isActive: true },
      select: { email: true },
    });
    for (const user of users) {
      const email = normalizeRecipientEmail(user.email);
      if (email) out.add(email);
    }
  }
  return Array.from(out);
}

export async function notifyApplicationSubmitted(
  deps: SubmissionNotificationDeps,
  input: { schoolId: string; applicationId: string }
): Promise<SubmissionNotificationResult> {
  const { prisma } = deps;
  const send = deps.send ?? sendSchoolEmail;
  const sleep = deps.sleep ?? defaultSleep;
  const delays = deps.retryDelaysMs?.length ? deps.retryDelaysMs : DEFAULT_NOTIFICATION_RETRY_DELAYS_MS;
  const emailDisabled = deps.isEmailDisabled ?? isOutboundEmailDisabled;
  const { schoolId, applicationId } = input;
  const result: SubmissionNotificationResult = { outcomes: [], skippedReasons: [] };

  const app = await prisma.admissionApplication.findFirst({
    where: { id: applicationId, schoolId },
    select: {
      id: true,
      status: true,
      applicationNumber: true,
      intakeYear: true,
      requestedGrade: true,
      feeRequired: true,
      guardians: { select: { email: true, isPrimary: true } },
      school: { select: { name: true } },
    },
  });
  if (!app || app.status === "DRAFT" || !app.applicationNumber) {
    result.skippedReasons.push("NOT_SUBMITTED");
    return result;
  }

  const settings = await prisma.schoolAdmissionsSettings.findUnique({
    where: { schoolId },
    select: { admissionContactEmail: true, notificationRecipientUserIds: true },
  });

  const ctx: MessageContext = {
    schoolName: app.school?.name || "the school",
    applicationNumber: app.applicationNumber,
    intakeYear: app.intakeYear,
    requestedGrade: app.requestedGrade,
    feeRequired: Boolean(app.feeRequired),
  };

  const recipients: Array<{ type: AdmissionRecipientType; email: string }> = [];
  const schoolEmails = settings
    ? await resolveSchoolNotificationRecipients(prisma, schoolId, settings)
    : [];
  for (const email of schoolEmails) recipients.push({ type: "SCHOOL", email });
  if (!schoolEmails.length) {
    result.skippedReasons.push("NO_SCHOOL_RECIPIENT");
    await recordEvent(prisma, schoolId, applicationId, ADMISSION_NOTIFICATION_SKIPPED, {
      recipientType: "SCHOOL",
      reason: "NO_SCHOOL_RECIPIENT",
    });
  }
  const primaryEmail = normalizeRecipientEmail(app.guardians.find((g) => g.isPrimary)?.email);
  if (primaryEmail) {
    recipients.push({ type: "PARENT", email: primaryEmail });
  } else {
    result.skippedReasons.push("NO_PARENT_EMAIL");
    await recordEvent(prisma, schoolId, applicationId, ADMISSION_NOTIFICATION_SKIPPED, {
      recipientType: "PARENT",
      reason: "NO_PARENT_EMAIL",
    });
  }

  const alreadySent = await prisma.admissionAuditEvent.findMany({
    where: { schoolId, applicationId, eventType: ADMISSION_NOTIFICATION_SENT },
    select: { metadataJson: true },
  });
  const sentKeys = new Set(
    alreadySent.map((row) => {
      const meta = (row.metadataJson || {}) as { recipientType?: unknown; recipientKey?: unknown };
      return `${String(meta.recipientType)}:${String(meta.recipientKey)}`;
    })
  );

  for (const recipient of recipients) {
    const recipientKey = recipientKeyFor(recipient.email);
    const outcome: RecipientOutcome = {
      recipientType: recipient.type,
      recipientKey,
      result: "FAILED",
      attempts: 0,
    };
    result.outcomes.push(outcome);

    if (sentKeys.has(`${recipient.type}:${recipientKey}`)) {
      outcome.result = "SKIPPED_ALREADY_SENT";
      continue;
    }
    if (emailDisabled()) {
      outcome.result = "SKIPPED_DISABLED";
      await recordEvent(prisma, schoolId, applicationId, ADMISSION_NOTIFICATION_SKIPPED, {
        recipientType: recipient.type,
        recipientKey,
        reason: "OUTBOUND_EMAIL_DISABLED",
      });
      continue;
    }

    const message =
      recipient.type === "SCHOOL" ? buildSchoolNotificationEmail(ctx) : buildParentConfirmationEmail(ctx);
    const idempotencyKey = `admission-submitted-${applicationId}-${recipient.type.toLowerCase()}-${recipientKey}`;

    for (let attempt = 1; attempt <= delays.length; attempt += 1) {
      const wait = delays[attempt - 1] ?? 0;
      if (wait > 0) await sleep(wait);
      outcome.attempts = attempt;
      try {
        await send(schoolId, {
          to: recipient.email,
          subject: message.subject,
          html: message.html,
          idempotencyKey,
        });
        outcome.result = "SENT";
        outcome.errorCode = undefined;
        sentKeys.add(`${recipient.type}:${recipientKey}`);
        await recordEvent(prisma, schoolId, applicationId, ADMISSION_NOTIFICATION_SENT, {
          recipientType: recipient.type,
          recipientKey,
          attempt,
        });
        break;
      } catch (err) {
        const { code, retryable } = classifyNotificationError(err);
        outcome.errorCode = code;
        const final = !retryable || attempt >= delays.length;
        await recordEvent(
          prisma,
          schoolId,
          applicationId,
          final ? ADMISSION_NOTIFICATION_FAILED : ADMISSION_NOTIFICATION_ATTEMPT_FAILED,
          { recipientType: recipient.type, recipientKey, attempt, errorCode: code }
        );
        console.warn("[admissions-notify] send failed", {
          applicationId,
          recipientType: recipient.type,
          attempt,
          errorCode: code,
          final,
        });
        if (final) break;
      }
    }
  }

  return result;
}

/** Fire-and-forget wrapper for the submit route. Never throws. */
export function scheduleSubmissionNotifications(
  deps: SubmissionNotificationDeps,
  input: { schoolId: string; applicationId: string }
): void {
  void notifyApplicationSubmitted(deps, input).catch((err) => {
    console.warn("[admissions-notify] unexpected failure", {
      applicationId: input.applicationId,
      error: err instanceof Error ? err.name : "unknown",
    });
  });
}
