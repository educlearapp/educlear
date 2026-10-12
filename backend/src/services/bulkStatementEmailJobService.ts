/**
 * Durable bulk statement-email jobs — create, claim, send, resume, retry.
 * Calls statementEmailService directly (no HTTP self-call).
 */
import type { PrismaClient } from "@prisma/client";
import { sendStatementEmail } from "./statementEmailService";
import {
  classifyResendIdempotencyConflict,
  isResendNetworkUnavailableError,
} from "./resendClient";

export const BULK_STATEMENT_EMAIL_JOB_CONCURRENCY = 5;
export const BULK_STATEMENT_EMAIL_DISPATCH_SPACING_MS = 220;
export const BULK_STATEMENT_EMAIL_SENDING_LEASE_MS = 10 * 60 * 1000;
export const BULK_STATEMENT_EMAIL_429_BACKOFF_MS = 1500;
/** Resend keeps idempotency keys for 24h; stay inside that window with a 1h margin. */
export const BULK_STATEMENT_EMAIL_IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;
/** Re-check delay when Resend reports the same idempotency key is still in progress. */
export const BULK_STATEMENT_EMAIL_IN_PROGRESS_RECHECK_MS = 60 * 1000;
/** failureReason prefix: delivery state unknown — never requeued automatically or by "Retry failed". */
export const BULK_STATEMENT_RECONCILE_PREFIX = "[RECONCILE]";
/** failureReason prefix: provider did not confirm; retry is safe only inside the idempotency window. */
export const BULK_STATEMENT_UNCERTAIN_PREFIX = "[UNCERTAIN]";

const ACTIVE_BULK_STATEMENT_JOB_STATUSES = ["PENDING", "RUNNING"] as const;

/** One key per persisted recipient row: stable across retries, new for every new job. */
export function bulkStatementEmailIdempotencyKey(recipientId: string): string {
  return `bulk-statement-email/${String(recipientId || "").trim()}`;
}

/**
 * Unprefixed network/timeout failures were recorded before idempotency keys existed, so the
 * provider may have delivered them and a retry would be an unprotected fresh send.
 */
const LEGACY_UNCERTAIN_DELIVERY_REASON =
  /could not be reached|temporarily unavailable|timed? ?out|timeout|ETIMEDOUT|ECONNRESET|socket hang up/i;

export function isBulkStatementRecipientRetryAllowed(
  row: { failureReason?: string | null; lastAttemptAt?: Date | null },
  now = new Date()
): boolean {
  const reason = String(row.failureReason || "");
  if (reason.startsWith(BULK_STATEMENT_RECONCILE_PREFIX)) return false;
  if (!reason.startsWith(BULK_STATEMENT_UNCERTAIN_PREFIX) && LEGACY_UNCERTAIN_DELIVERY_REASON.test(reason)) {
    return false;
  }
  if (reason.startsWith(BULK_STATEMENT_UNCERTAIN_PREFIX)) {
    if (!row.lastAttemptAt) return false;
    return now.getTime() - row.lastAttemptAt.getTime() < BULK_STATEMENT_EMAIL_IDEMPOTENCY_WINDOW_MS;
  }
  return true;
}

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
  const result = await createOrAttachBulkStatementEmailJob(prisma, input);
  return result.job;
}

/**
 * Creates a job, or returns the school's existing PENDING/RUNNING job instead.
 * A per-school Postgres advisory transaction lock serialises concurrent creates, so two
 * simultaneous requests can never both create an active job for the same school.
 */
export async function createOrAttachBulkStatementEmailJob(
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

  const lockKey = `bulk-statement-email-job:${schoolId}`;
  return prisma.$transaction(
    async (tx) => {
      const db = tx as unknown as PrismaClient;
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      const active = await db.bulkStatementEmailJob.findFirst({
        where: { schoolId, status: { in: [...ACTIVE_BULK_STATEMENT_JOB_STATUSES] } },
        orderBy: { createdAt: "asc" },
      });
      if (active) {
        // Confirm from recipient rows that the job is genuinely still active.
        await recountBulkStatementEmailJob(db, active.id);
        const current = await db.bulkStatementEmailJob.findUniqueOrThrow({
          where: { id: active.id },
          include: { recipients: { orderBy: [{ accountNo: "asc" }, { contactName: "asc" }] } },
        });
        if ((ACTIVE_BULK_STATEMENT_JOB_STATUSES as readonly string[]).includes(current.status)) {
          return { job: current, created: false as const };
        }
      }

      const job = await db.bulkStatementEmailJob.create({
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

      await recountBulkStatementEmailJob(db, job.id);
      const created = await db.bulkStatementEmailJob.findUniqueOrThrow({
        where: { id: job.id },
        include: { recipients: { orderBy: [{ accountNo: "asc" }, { contactName: "asc" }] } },
      });
      return { job: created, created: true as const };
    },
    { maxWait: 10_000, timeout: 60_000 }
  );
}

export async function reclaimStaleBulkStatementSending(
  prisma: PrismaClient,
  now = new Date(),
  leaseMs = BULK_STATEMENT_EMAIL_SENDING_LEASE_MS
): Promise<number> {
  const cutoff = new Date(now.getTime() - leaseMs);
  // Past the provider idempotency window a resend could duplicate — hold for reconciliation.
  const idempotencyCutoff = new Date(now.getTime() - BULK_STATEMENT_EMAIL_IDEMPOTENCY_WINDOW_MS);
  const expired = await prisma.bulkStatementEmailRecipient.updateMany({
    where: {
      status: "SENDING",
      lastAttemptAt: { lt: idempotencyCutoff },
    },
    data: {
      status: "FAILED",
      sendingLeaseUntil: null,
      failureReason: `${BULK_STATEMENT_RECONCILE_PREFIX} Send was interrupted more than 23 hours ago. Delivery not confirmed — verify in Resend before resending.`,
    },
  });
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
  return result.count + expired.count;
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
    },
  });
  await prisma.bulkStatementEmailJob.updateMany({
    where: { id: next.jobId, startedAt: null },
    data: { startedAt: now },
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

export type BulkStatementDeliveryOutcome =
  | "SENT"
  | "FAILED"
  | "SKIPPED"
  /** Provider still processing the same idempotency key — left SENDING with a short lease. */
  | "DEFERRED"
  /** Provider accepted but the SENT write failed — left SENDING; lease reclaim re-checks with the same key. */
  | "UNRECORDED";

const SENT_PERSIST_ATTEMPTS = 3;

async function persistBulkStatementRecipientSent(
  prisma: PrismaClient,
  recipientId: string,
  providerMessageId: string | null,
  sleepImpl: (ms: number) => Promise<void>
) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= SENT_PERSIST_ATTEMPTS; attempt++) {
    try {
      await markBulkStatementRecipientSent(prisma, recipientId, providerMessageId);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < SENT_PERSIST_ATTEMPTS) await sleepImpl(250 * attempt);
    }
  }
  throw lastError;
}

function defaultDeliverySleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function deliverClaimedBulkStatementRecipient(
  prisma: PrismaClient,
  recipientId: string,
  sendImpl: typeof sendStatementEmail = sendStatementEmail,
  opts?: { sleepImpl?: (ms: number) => Promise<void> }
): Promise<BulkStatementDeliveryOutcome> {
  const sleepImpl = opts?.sleepImpl || defaultDeliverySleep;
  const row = await prisma.bulkStatementEmailRecipient.findUnique({
    where: { id: recipientId },
    include: { job: true },
  });
  if (!row) return "SKIPPED";
  if (row.status === "SENT") return "SENT";
  if (row.status !== "SENDING") return row.status as "FAILED" | "SKIPPED" | "SENT";

  // A provider id already on the row means an earlier attempt was accepted — never send again.
  if (row.providerMessageId) {
    await markBulkStatementRecipientSent(prisma, row.id, row.providerMessageId);
    return "SENT";
  }

  let result: Awaited<ReturnType<typeof sendStatementEmail>>;
  try {
    result = await sendImpl({
      schoolId: row.schoolId,
      to: row.displayEmail || row.normalizedEmail,
      subject: row.job.subject,
      html: row.job.htmlBody,
      learnerId: row.learnerId || undefined,
      accountNo: row.accountNo || undefined,
      period: row.job.statementPeriod,
      idempotencyKey: bulkStatementEmailIdempotencyKey(row.id),
    });
  } catch (error) {
    const conflict = classifyResendIdempotencyConflict(error);
    if (conflict === "in_progress") {
      await prisma.bulkStatementEmailRecipient.updateMany({
        where: { id: row.id, status: "SENDING" },
        data: {
          sendingLeaseUntil: new Date(Date.now() + BULK_STATEMENT_EMAIL_IN_PROGRESS_RECHECK_MS),
          failureReason:
            "Email provider is still processing this statement; re-checking with the same idempotency key.",
        },
      });
      return "DEFERRED";
    }
    if (conflict === "key_reused_different_payload") {
      await markBulkStatementRecipientFailed(
        prisma,
        row.id,
        `${BULK_STATEMENT_RECONCILE_PREFIX} Email provider already received this statement with different content. Delivery not confirmed — verify in Resend before resending.`
      );
      return "FAILED";
    }
    if (isResendNetworkUnavailableError(error)) {
      await markBulkStatementRecipientFailed(
        prisma,
        row.id,
        `${BULK_STATEMENT_UNCERTAIN_PREFIX} ${safeBulkStatementDeliveryError(error)}`
      );
      return "FAILED";
    }
    await markBulkStatementRecipientFailed(prisma, row.id, safeBulkStatementDeliveryError(error));
    return "FAILED";
  }

  const providerMessageId = String(result?.messageId || "").trim() || null;
  try {
    await persistBulkStatementRecipientSent(prisma, row.id, providerMessageId, sleepImpl);
    return "SENT";
  } catch (error) {
    // Never mark FAILED after provider acceptance; keep the provider id in logs for reconciliation.
    console.error(
      JSON.stringify({
        event: "bulk_statement_email_sent_unrecorded",
        jobId: row.jobId,
        recipientId: row.id,
        providerMessageId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      })
    );
    return "UNRECORDED";
  }
}

export async function retryFailedBulkStatementEmailJob(
  prisma: PrismaClient,
  input: { jobId: string; schoolId: string; recipientIds?: string[] }
) {
  const schoolId = String(input.schoolId || "").trim();
  const lockKey = `bulk-statement-email-job:${schoolId}`;
  return prisma.$transaction(
    async (tx) => {
      const db = tx as unknown as PrismaClient;
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      const job = await db.bulkStatementEmailJob.findFirst({
        where: { id: input.jobId, schoolId },
      });
      if (!job) throw new Error("Job not found");

      // Requeueing re-activates this job; refuse while a different job is still active.
      const otherActive = await db.bulkStatementEmailJob.findFirst({
        where: {
          schoolId,
          id: { not: job.id },
          status: { in: [...ACTIVE_BULK_STATEMENT_JOB_STATUSES] },
        },
      });
      if (otherActive) {
        await recountBulkStatementEmailJob(db, otherActive.id);
        const current = await db.bulkStatementEmailJob.findUnique({ where: { id: otherActive.id } });
        if (current && (ACTIVE_BULK_STATEMENT_JOB_STATUSES as readonly string[]).includes(current.status)) {
          throw new Error("Another statement email job is still active for this school");
        }
      }

      const where = {
        jobId: input.jobId,
        schoolId,
        status: "FAILED" as const,
        ...(input.recipientIds?.length ? { id: { in: input.recipientIds } } : {}),
      };

      const failedRows = await db.bulkStatementEmailRecipient.findMany({
        where,
        select: { id: true, failureReason: true, lastAttemptAt: true },
      });
      const now = new Date();
      const retryIds = failedRows
        .filter((row) => isBulkStatementRecipientRetryAllowed(row, now))
        .map((row) => row.id);
      const heldForReconciliation = failedRows.length - retryIds.length;

      const updated = retryIds.length
        ? await db.bulkStatementEmailRecipient.updateMany({
            where: { ...where, id: { in: retryIds } },
            data: {
              status: "PENDING",
              failureReason: null,
              sendingLeaseUntil: null,
            },
          })
        : { count: 0 };

      // SENT rows are never touched by the where clause above.
      await db.bulkStatementEmailJob.update({
        where: { id: job.id },
        data: {
          status: "PENDING",
          completedAt: null,
        },
      });
      await recountBulkStatementEmailJob(db, job.id);
      return { requeued: updated.count, heldForReconciliation };
    },
    { maxWait: 10_000, timeout: 30_000 }
  );
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
