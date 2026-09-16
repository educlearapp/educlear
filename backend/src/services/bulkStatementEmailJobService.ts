/**
 * Durable bulk statement-email jobs — create, claim, send, resume, retry.
 * Calls statementEmailService directly (no HTTP self-call).
 */
import type { PrismaClient } from "@prisma/client";
import { sendStatementEmail } from "./statementEmailService";

export const BULK_STATEMENT_EMAIL_JOB_CONCURRENCY = 5;
export const BULK_STATEMENT_EMAIL_DISPATCH_SPACING_MS = 220;
export const BULK_STATEMENT_EMAIL_SENDING_LEASE_MS = 10 * 60 * 1000;
export const BULK_STATEMENT_EMAIL_429_BACKOFF_MS = 1500;

export type BulkStatementEmailRecipientInput = {
  accountNo: string;
  learnerId?: string;
  learnerName?: string;
  parentId?: string;
  contactName?: string;
  relationship?: string;
  email: string;
  /** When true, persist as SKIPPED (not sent). */
  skipped?: boolean;
  skipReason?: string;
};

export type CreateBulkStatementEmailJobInput = {
  schoolId: string;
  createdBy: string;
  subject: string;
  htmlBody: string;
  messagePlain?: string;
  statementPeriod?: string;
  filterSnapshot?: Record<string, unknown> | null;
  recipients: BulkStatementEmailRecipientInput[];
};

export function normalizeBulkStatementEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

export function buildBulkStatementRecipientKey(input: {
  accountNo: string;
  parentId?: string;
  normalizedEmail: string;
}): string {
  const accountNo = String(input.accountNo || "").trim().toUpperCase();
  const parentId = String(input.parentId || "").trim();
  const email = normalizeBulkStatementEmail(input.normalizedEmail);
  return `${accountNo}|${parentId}|${email}`;
}

export function safeBulkStatementDeliveryError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || "Statement email delivery failed");
  const trimmed = raw.trim().slice(0, 500);
  const lower = trimmed.toLowerCase();
  if (
    lower.includes("api key") ||
    lower.includes("authorization") ||
    lower.includes("bearer ") ||
    lower.includes("password")
  ) {
    return "Statement email delivery failed";
  }
  if (lower === "load failed" || lower === "failed to fetch" || lower === "fetch failed") {
    return "Email delivery temporarily unavailable. The server will retry failed recipients.";
  }
  return trimmed || "Statement email delivery failed";
}

export function isRetryableBulkStatementProviderError(error: unknown): boolean {
  const msg = String(error instanceof Error ? error.message : error || "").toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("could not be reached") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("503") ||
    msg.includes("502")
  );
}

export async function recountBulkStatementEmailJob(
  prisma: PrismaClient,
  jobId: string
): Promise<void> {
  const groups = await prisma.bulkStatementEmailRecipient.groupBy({
    by: ["status"],
    where: { jobId },
    _count: { _all: true },
  });
  const counts = {
    PENDING: 0,
    SENDING: 0,
    SENT: 0,
    FAILED: 0,
    SKIPPED: 0,
  };
  for (const row of groups) {
    counts[row.status as keyof typeof counts] = row._count._all;
  }
  const total =
    counts.PENDING + counts.SENDING + counts.SENT + counts.FAILED + counts.SKIPPED;
  const unfinished = counts.PENDING + counts.SENDING;
  let status: "PENDING" | "RUNNING" | "COMPLETE" | "PARTIAL" | "FAILED" | "CANCELLED" = "PENDING";
  let completedAt: Date | null = null;
  if (unfinished > 0) {
    status = counts.SENDING > 0 || counts.SENT > 0 || counts.FAILED > 0 ? "RUNNING" : "PENDING";
  } else if (total === 0) {
    status = "FAILED";
    completedAt = new Date();
  } else if (counts.FAILED === 0 && counts.SENT >= 0) {
    status = counts.SENT > 0 || counts.SKIPPED === total ? "COMPLETE" : "COMPLETE";
    completedAt = new Date();
  } else if (counts.SENT === 0 && counts.FAILED > 0) {
    status = "FAILED";
    completedAt = new Date();
  } else {
    status = "PARTIAL";
    completedAt = new Date();
  }

  const existing = await prisma.bulkStatementEmailJob.findUnique({ where: { id: jobId } });
  if (!existing) return;
  if (existing.status === "CANCELLED") return;

  await prisma.bulkStatementEmailJob.update({
    where: { id: jobId },
    data: {
      totalRecipients: total,
      pendingCount: counts.PENDING,
      sendingCount: counts.SENDING,
      sentCount: counts.SENT,
      failedCount: counts.FAILED,
      skippedCount: counts.SKIPPED,
      status,
      completedAt: unfinished > 0 ? null : completedAt,
      startedAt: existing.startedAt || (status === "RUNNING" || status === "COMPLETE" || status === "PARTIAL" || status === "FAILED" ? new Date() : null),
    },
  });
}

export async function createBulkStatementEmailJob(
  prisma: PrismaClient,
  input: CreateBulkStatementEmailJobInput
) {
  const schoolId = String(input.schoolId || "").trim();
  if (!schoolId) throw new Error("Missing schoolId");
  const subject = String(input.subject || "").trim();
  const htmlBody = String(input.htmlBody || "").trim();
  if (!subject || !htmlBody) throw new Error("Missing subject or htmlBody");

  const seen = new Set<string>();
  const rows: Array<{
    schoolId: string;
    accountNo: string;
    learnerId: string;
    learnerName: string;
    parentId: string;
    contactName: string;
    relationship: string;
    normalizedEmail: string;
    displayEmail: string;
    recipientKey: string;
    status: "PENDING" | "SKIPPED";
    failureReason: string | null;
  }> = [];

  for (const raw of input.recipients || []) {
    const accountNo = String(raw.accountNo || "").trim().toUpperCase();
    const email = String(raw.email || "").trim();
    const normalizedEmail = normalizeBulkStatementEmail(email);
    const parentId = String(raw.parentId || "").trim();
    if (!accountNo) continue;
    const recipientKey = buildBulkStatementRecipientKey({
      accountNo,
      parentId,
      normalizedEmail: normalizedEmail || `skip:${rows.length}`,
    });
    if (seen.has(recipientKey)) continue;
    seen.add(recipientKey);

    const skipped = Boolean(raw.skipped) || !normalizedEmail;
    rows.push({
      schoolId,
      accountNo,
      learnerId: String(raw.learnerId || "").trim(),
      learnerName: String(raw.learnerName || "").trim(),
      parentId,
      contactName: String(raw.contactName || "").trim(),
      relationship: String(raw.relationship || "").trim(),
      normalizedEmail: normalizedEmail || "",
      displayEmail: email,
      recipientKey,
      status: skipped ? "SKIPPED" : "PENDING",
      failureReason: skipped ? String(raw.skipReason || "Skipped").slice(0, 500) : null,
    });
  }

  if (!rows.some((r) => r.status === "PENDING")) {
    throw new Error("No eligible recipients to send");
  }

  const job = await prisma.bulkStatementEmailJob.create({
    data: {
      schoolId,
      createdBy: String(input.createdBy || "").trim(),
      subject,
      htmlBody,
      messagePlain: String(input.messagePlain || "").trim(),
      statementPeriod: String(input.statementPeriod || "All Time").trim() || "All Time",
      filterSnapshot: input.filterSnapshot ? (input.filterSnapshot as object) : undefined,
      status: "PENDING",
      recipients: {
        create: rows.map((r) => ({
          schoolId: r.schoolId,
          accountNo: r.accountNo,
          learnerId: r.learnerId,
          learnerName: r.learnerName,
          parentId: r.parentId,
          contactName: r.contactName,
          relationship: r.relationship,
          normalizedEmail: r.normalizedEmail,
          displayEmail: r.displayEmail,
          recipientKey: r.recipientKey,
          status: r.status,
          failureReason: r.failureReason,
        })),
      },
    },
    include: { recipients: true },
  });

  await recountBulkStatementEmailJob(prisma, job.id);
  return prisma.bulkStatementEmailJob.findUniqueOrThrow({
    where: { id: job.id },
    include: { recipients: { orderBy: [{ accountNo: "asc" }, { contactName: "asc" }] } },
  });
}

export async function reclaimStaleBulkStatementSending(
  prisma: PrismaClient,
  now = new Date(),
  leaseMs = BULK_STATEMENT_EMAIL_SENDING_LEASE_MS
): Promise<number> {
  const cutoff = new Date(now.getTime() - leaseMs);
  const result = await prisma.bulkStatementEmailRecipient.updateMany({
    where: {
      status: "SENDING",
      OR: [
        { sendingLeaseUntil: { lt: now } },
        { sendingLeaseUntil: null, lastAttemptAt: { lt: cutoff } },
        { sendingLeaseUntil: null, lastAttemptAt: null, updatedAt: { lt: cutoff } },
      ],
    },
    data: {
      status: "PENDING",
      sendingLeaseUntil: null,
      failureReason: "Reclaimed after interrupted send (safe retry)",
    },
  });
  return result.count;
}

/** Atomically claim one PENDING recipient for sending. Returns null if none. */
export async function claimNextBulkStatementRecipient(
  prisma: PrismaClient,
  opts?: { jobId?: string; now?: Date; leaseMs?: number }
) {
  const now = opts?.now || new Date();
  const leaseMs = opts?.leaseMs ?? BULK_STATEMENT_EMAIL_SENDING_LEASE_MS;
  const leaseUntil = new Date(now.getTime() + leaseMs);

  const next = await prisma.bulkStatementEmailRecipient.findFirst({
    where: {
      status: "PENDING",
      ...(opts?.jobId ? { jobId: opts.jobId } : {}),
      job: { status: { in: ["PENDING", "RUNNING"] } },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!next) return null;

  const claimed = await prisma.bulkStatementEmailRecipient.updateMany({
    where: { id: next.id, status: "PENDING" },
    data: {
      status: "SENDING",
      lastAttemptAt: now,
      attemptCount: { increment: 1 },
      sendingLeaseUntil: leaseUntil,
      failureReason: null,
    },
  });
  if (claimed.count === 0) return null;

  await prisma.bulkStatementEmailJob.updateMany({
    where: { id: next.jobId, status: { in: ["PENDING", "RUNNING"] } },
    data: {
      status: "RUNNING",
      startedAt: now,
    },
  });

  return prisma.bulkStatementEmailRecipient.findUnique({ where: { id: next.id } });
}

export async function markBulkStatementRecipientSent(
  prisma: PrismaClient,
  recipientId: string,
  providerMessageId?: string | null
) {
  const current = await prisma.bulkStatementEmailRecipient.findUnique({ where: { id: recipientId } });
  if (!current) return;
  if (current.status === "SENT") return; // terminal — never duplicate

  await prisma.bulkStatementEmailRecipient.updateMany({
    where: { id: recipientId, status: { in: ["SENDING", "PENDING"] } },
    data: {
      status: "SENT",
      providerMessageId: providerMessageId || null,
      sentAt: new Date(),
      sendingLeaseUntil: null,
      failureReason: null,
    },
  });
  await recountBulkStatementEmailJob(prisma, current.jobId);
}

export async function markBulkStatementRecipientFailed(
  prisma: PrismaClient,
  recipientId: string,
  reason: string
) {
  const current = await prisma.bulkStatementEmailRecipient.findUnique({ where: { id: recipientId } });
  if (!current) return;
  if (current.status === "SENT") return; // never overwrite SENT

  await prisma.bulkStatementEmailRecipient.updateMany({
    where: { id: recipientId, status: { in: ["SENDING", "PENDING"] } },
    data: {
      status: "FAILED",
      failureReason: String(reason || "Statement email delivery failed").slice(0, 500),
      sendingLeaseUntil: null,
    },
  });
  await recountBulkStatementEmailJob(prisma, current.jobId);
}

export async function deliverClaimedBulkStatementRecipient(
  prisma: PrismaClient,
  recipientId: string,
  sendImpl: typeof sendStatementEmail = sendStatementEmail
): Promise<"SENT" | "FAILED" | "SKIPPED"> {
  const row = await prisma.bulkStatementEmailRecipient.findUnique({
    where: { id: recipientId },
    include: { job: true },
  });
  if (!row) return "SKIPPED";
  if (row.status === "SENT") return "SENT";
  if (row.status !== "SENDING") return row.status as "FAILED" | "SKIPPED" | "SENT";

  try {
    const result = await sendImpl({
      schoolId: row.schoolId,
      to: row.displayEmail || row.normalizedEmail,
      subject: row.job.subject,
      html: row.job.htmlBody,
      learnerId: row.learnerId || undefined,
      accountNo: row.accountNo || undefined,
      period: row.job.statementPeriod,
    });
    await markBulkStatementRecipientSent(prisma, row.id, result?.messageId || null);
    return "SENT";
  } catch (error) {
    await markBulkStatementRecipientFailed(prisma, row.id, safeBulkStatementDeliveryError(error));
    return "FAILED";
  }
}

export async function retryFailedBulkStatementEmailJob(
  prisma: PrismaClient,
  input: { jobId: string; schoolId: string; recipientIds?: string[] }
) {
  const job = await prisma.bulkStatementEmailJob.findFirst({
    where: { id: input.jobId, schoolId: input.schoolId },
  });
  if (!job) throw new Error("Job not found");

  const where = {
    jobId: input.jobId,
    schoolId: input.schoolId,
    status: "FAILED" as const,
    ...(input.recipientIds?.length ? { id: { in: input.recipientIds } } : {}),
  };

  const updated = await prisma.bulkStatementEmailRecipient.updateMany({
    where,
    data: {
      status: "PENDING",
      failureReason: null,
      sendingLeaseUntil: null,
    },
  });

  // SENT rows are never touched by the where clause above.
  await prisma.bulkStatementEmailJob.update({
    where: { id: job.id },
    data: {
      status: "PENDING",
      completedAt: null,
    },
  });
  await recountBulkStatementEmailJob(prisma, job.id);
  return { requeued: updated.count };
}

export function serializeBulkStatementEmailJob(
  job: {
    id: string;
    schoolId: string;
    createdBy: string;
    subject: string;
    messagePlain: string;
    statementPeriod: string;
    filterSnapshot: unknown;
    status: string;
    totalRecipients: number;
    pendingCount: number;
    sendingCount: number;
    sentCount: number;
    failedCount: number;
    skippedCount: number;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    updatedAt: Date;
    recipients?: Array<Record<string, unknown>>;
  },
  opts?: { includeRecipients?: boolean }
) {
  return {
    id: job.id,
    schoolId: job.schoolId,
    createdBy: job.createdBy,
    subject: job.subject,
    messagePlain: job.messagePlain,
    statementPeriod: job.statementPeriod,
    filterSnapshot: job.filterSnapshot,
    status: job.status,
    totalRecipients: job.totalRecipients,
    pendingCount: job.pendingCount,
    sendingCount: job.sendingCount,
    sentCount: job.sentCount,
    failedCount: job.failedCount,
    skippedCount: job.skippedCount,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    updatedAt: job.updatedAt,
    continuesAfterLogout: true,
    recipients:
      opts?.includeRecipients === false
        ? undefined
        : (job.recipients || []).map((r) => ({
            id: r.id,
            accountNo: r.accountNo,
            learnerId: r.learnerId,
            learnerName: r.learnerName,
            parentId: r.parentId,
            contactName: r.contactName,
            relationship: r.relationship,
            email: r.displayEmail || r.normalizedEmail,
            status: r.status,
            failureReason: r.failureReason,
            providerMessageId: r.providerMessageId,
            attemptCount: r.attemptCount,
            lastAttemptAt: r.lastAttemptAt,
            sentAt: r.sentAt,
          })),
  };
}
