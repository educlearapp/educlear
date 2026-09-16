/**
 * Recoverable pull processor for bulk statement-email jobs.
 * Survives browser logout and backend restarts (DB claim + lease reclaim).
 */
import type { PrismaClient } from "@prisma/client";
import {
  BULK_STATEMENT_EMAIL_DISPATCH_SPACING_MS,
  BULK_STATEMENT_EMAIL_JOB_CONCURRENCY,
  BULK_STATEMENT_EMAIL_429_BACKOFF_MS,
  claimNextBulkStatementRecipient,
  deliverClaimedBulkStatementRecipient,
  reclaimStaleBulkStatementSending,
  recountBulkStatementEmailJob,
} from "./bulkStatementEmailJobService";
import { sendStatementEmail } from "./statementEmailService";

let processorTimer: NodeJS.Timeout | null = null;
let tickInFlight = false;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function processBulkStatementEmailJobsOnce(
  prisma: PrismaClient,
  opts?: {
    concurrency?: number;
    spacingMs?: number;
    sendImpl?: typeof sendStatementEmail;
    maxClaims?: number;
  }
): Promise<{ claimed: number; sent: number; failed: number; reclaimed: number }> {
  const concurrency = Math.max(
    1,
    Math.min(opts?.concurrency ?? BULK_STATEMENT_EMAIL_JOB_CONCURRENCY, BULK_STATEMENT_EMAIL_JOB_CONCURRENCY)
  );
  const spacingMs = opts?.spacingMs ?? BULK_STATEMENT_EMAIL_DISPATCH_SPACING_MS;
  const sendImpl = opts?.sendImpl ?? sendStatementEmail;
  const maxClaims = opts?.maxClaims ?? concurrency * 4;

  const reclaimed = await reclaimStaleBulkStatementSending(prisma);
  if (reclaimed > 0) {
    const jobs = await prisma.bulkStatementEmailJob.findMany({
      where: { status: { in: ["PENDING", "RUNNING"] } },
      select: { id: true },
      take: 50,
    });
    for (const job of jobs) {
      await recountBulkStatementEmailJob(prisma, job.id);
    }
  }

  let claimed = 0;
  let sent = 0;
  let failed = 0;
  let rateLimited = false;

  while (claimed < maxClaims && !rateLimited) {
    const batch: string[] = [];
    for (let i = 0; i < concurrency && claimed + batch.length < maxClaims; i++) {
      const row = await claimNextBulkStatementRecipient(prisma);
      if (!row) break;
      batch.push(row.id);
      if (spacingMs > 0) await sleep(spacingMs);
    }
    if (!batch.length) break;
    claimed += batch.length;

    const outcomes = await Promise.all(
      batch.map((id) => deliverClaimedBulkStatementRecipient(prisma, id, sendImpl))
    );

    for (const outcome of outcomes) {
      if (outcome === "SENT") sent += 1;
      if (outcome === "FAILED") failed += 1;
    }

    // Soft throttle when many failures look provider-related (next tick resumes).
    if (failed > 0 && failed >= sent && failed >= concurrency) {
      rateLimited = true;
      await sleep(BULK_STATEMENT_EMAIL_429_BACKOFF_MS);
      break;
    }
  }

  return { claimed, sent, failed, reclaimed };
}

export async function tickBulkStatementEmailJobProcessor(prisma: PrismaClient): Promise<void> {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    await processBulkStatementEmailJobsOnce(prisma);
  } catch (error) {
    console.error("[bulk-statement-email-jobs] processor tick failed:", error);
  } finally {
    tickInFlight = false;
  }
}

/** Start recoverable interval processor (safe across restarts — work is DB-claimed). */
export function startBulkStatementEmailJobProcessor(
  prisma: PrismaClient,
  intervalMs = 4000
): void {
  if (processorTimer) return;
  void tickBulkStatementEmailJobProcessor(prisma);
  processorTimer = setInterval(() => {
    void tickBulkStatementEmailJobProcessor(prisma);
  }, intervalMs);
  if (typeof processorTimer.unref === "function") processorTimer.unref();
}

export function stopBulkStatementEmailJobProcessor(): void {
  if (processorTimer) {
    clearInterval(processorTimer);
    processorTimer = null;
  }
}
