/**
 * Durable bulk statement-email job — create/claim/idempotency/resume/retry.
 * Run: npx ts-node --transpile-only src/services/bulkStatementEmailJobService.unit.test.ts
 */
import assert from "node:assert/strict";
import {
  BULK_STATEMENT_EMAIL_JOB_CONCURRENCY,
  buildBulkStatementRecipientKey,
  claimNextBulkStatementRecipient,
  createBulkStatementEmailJob,
  deliverClaimedBulkStatementRecipient,
  markBulkStatementRecipientSent,
  normalizeBulkStatementEmail,
  reclaimStaleBulkStatementSending,
  retryFailedBulkStatementEmailJob,
  safeBulkStatementDeliveryError,
} from "./bulkStatementEmailJobService";
import { processBulkStatementEmailJobsOnce } from "./bulkStatementEmailJobProcessor";

type JobRow = any;
type RecipRow = any;

function createMemoryPrisma() {
  const jobs = new Map<string, JobRow>();
  const recipients = new Map<string, RecipRow>();
  let seq = 1;
  const id = () => `id_${seq++}`;

  const api: any = {
    bulkStatementEmailJob: {
      async create(args: any) {
        const jobId = id();
        const now = new Date();
        const job: JobRow = {
          id: jobId,
          schoolId: args.data.schoolId,
          createdBy: args.data.createdBy || "",
          subject: args.data.subject,
          htmlBody: args.data.htmlBody,
          messagePlain: args.data.messagePlain || "",
          statementPeriod: args.data.statementPeriod || "All Time",
          filterSnapshot: args.data.filterSnapshot,
          status: args.data.status || "PENDING",
          totalRecipients: 0,
          pendingCount: 0,
          sendingCount: 0,
          sentCount: 0,
          failedCount: 0,
          skippedCount: 0,
          createdAt: now,
          startedAt: null,
          completedAt: null,
          updatedAt: now,
        };
        jobs.set(jobId, job);
        for (const r of args.data.recipients?.create || []) {
          const rid = id();
          const key = r.recipientKey;
          for (const existing of recipients.values()) {
            if (existing.jobId === jobId && existing.recipientKey === key) {
              throw new Error("Unique constraint failed on recipientKey");
            }
          }
          recipients.set(rid, {
            id: rid,
            jobId,
            ...r,
            attemptCount: 0,
            lastAttemptAt: null,
            sendingLeaseUntil: null,
            providerMessageId: null,
            sentAt: null,
            createdAt: now,
            updatedAt: now,
          });
        }
        if (args.include?.recipients) {
          return {
            ...job,
            recipients: [...recipients.values()].filter((r) => r.jobId === jobId),
          };
        }
        return job;
      },
      async findUnique(args: any) {
        const job = jobs.get(args.where.id);
        if (!job) return null;
        if (args.include?.recipients) {
          return {
            ...job,
            recipients: [...recipients.values()].filter((r) => r.jobId === job.id),
          };
        }
        return { ...job };
      },
      async findUniqueOrThrow(args: any) {
        const job = await api.bulkStatementEmailJob.findUnique(args);
        if (!job) throw new Error("not found");
        return job;
      },
      async findFirst(args: any) {
        for (const job of jobs.values()) {
          if (args.where?.id && job.id !== args.where.id) continue;
          if (args.where?.schoolId && job.schoolId !== args.where.schoolId) continue;
          if (args.include?.recipients) {
            return {
              ...job,
              recipients: [...recipients.values()].filter((r) => r.jobId === job.id),
            };
          }
          return { ...job };
        }
        return null;
      },
      async findMany(args: any) {
        let list = [...jobs.values()];
        if (args.where?.status?.in) {
          list = list.filter((j) => args.where.status.in.includes(j.status));
        }
        if (args.where?.schoolId) list = list.filter((j) => j.schoolId === args.where.schoolId);
        return list.map((j) => (args.select ? { id: j.id } : { ...j }));
      },
      async update(args: any) {
        const job = jobs.get(args.where.id);
        if (!job) throw new Error("missing job");
        Object.assign(job, args.data, { updatedAt: new Date() });
        if (args.data.startedAt === null) job.startedAt = null;
        if (args.data.completedAt === null) job.completedAt = null;
        jobs.set(job.id, job);
        return { ...job };
      },
      async updateMany(args: any) {
        let count = 0;
        for (const job of jobs.values()) {
          if (args.where?.id && job.id !== args.where.id) continue;
          if (args.where?.status?.in && !args.where.status.in.includes(job.status)) continue;
          Object.assign(job, args.data, { updatedAt: new Date() });
          count += 1;
        }
        return { count };
      },
    },
    bulkStatementEmailRecipient: {
      async groupBy(args: any) {
        const map = new Map<string, number>();
        for (const r of recipients.values()) {
          if (r.jobId !== args.where.jobId) continue;
          map.set(r.status, (map.get(r.status) || 0) + 1);
        }
        return [...map.entries()].map(([status, n]) => ({ status, _count: { _all: n } }));
      },
      async findFirst(args: any) {
        const list = [...recipients.values()]
          .filter((r) => {
            if (args.where?.status && r.status !== args.where.status) return false;
            if (args.where?.jobId && r.jobId !== args.where.jobId) return false;
            if (args.where?.job?.status?.in) {
              const job = jobs.get(r.jobId);
              if (!job || !args.where.job.status.in.includes(job.status)) return false;
            }
            return true;
          })
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return list[0] ? { ...list[0] } : null;
      },
      async findUnique(args: any) {
        const row = recipients.get(args.where.id);
        if (!row) return null;
        if (args.include?.job) return { ...row, job: { ...jobs.get(row.jobId) } };
        return { ...row };
      },
      async updateMany(args: any) {
        let count = 0;
        for (const r of recipients.values()) {
          if (args.where?.id && r.id !== args.where.id) continue;
          if (args.where?.jobId && r.jobId !== args.where.jobId) continue;
          if (args.where?.schoolId && r.schoolId !== args.where.schoolId) continue;
          if (args.where?.status) {
            if (typeof args.where.status === "string") {
              if (r.status !== args.where.status) continue;
            } else if (args.where.status?.in && !args.where.status.in.includes(r.status)) {
              continue;
            }
          }
          if (args.where?.OR) {
            const ok = args.where.OR.some((clause: any) => {
              if (clause.sendingLeaseUntil?.lt) {
                return Boolean(r.sendingLeaseUntil && r.sendingLeaseUntil < clause.sendingLeaseUntil.lt);
              }
              if (clause.sendingLeaseUntil === null && clause.lastAttemptAt?.lt) {
                return !r.sendingLeaseUntil && Boolean(r.lastAttemptAt && r.lastAttemptAt < clause.lastAttemptAt.lt);
              }
              if (clause.sendingLeaseUntil === null && clause.lastAttemptAt === null && clause.updatedAt?.lt) {
                return !r.sendingLeaseUntil && !r.lastAttemptAt && r.updatedAt < clause.updatedAt.lt;
              }
              return false;
            });
            if (!ok) continue;
          }
          const data = { ...args.data };
          if (data.attemptCount?.increment) {
            r.attemptCount = (r.attemptCount || 0) + data.attemptCount.increment;
            delete data.attemptCount;
          }
          Object.assign(r, data, { updatedAt: new Date() });
          count += 1;
        }
        return { count };
      },
    },
    _dump: () => ({ jobs, recipients }),
  };
  return api;
}

async function main() {
  assert.equal(BULK_STATEMENT_EMAIL_JOB_CONCURRENCY, 5, "concurrency starts at 5");
  assert.equal(
    buildBulkStatementRecipientKey({
      accountNo: "fam1",
      parentId: "p1",
      normalizedEmail: "A@X.COM",
    }),
    "FAM1|p1|a@x.com",
    "stable recipient key"
  );
  assert.equal(normalizeBulkStatementEmail(" A@X.COM "), "a@x.com");
  assert.match(
    safeBulkStatementDeliveryError(new Error("Load failed")),
    /temporarily unavailable|retry/i,
    "browser Load failed rewritten"
  );

  // --- create + school isolation / persistence ---
  const prisma = createMemoryPrisma();
  const job = await createBulkStatementEmailJob(prisma, {
    schoolId: "school-a",
    createdBy: "user-1",
    subject: "Statement",
    htmlBody: "<p>hi</p>",
    statementPeriod: "All Time",
    recipients: [
      { accountNo: "A1", email: "a@example.test", contactName: "A", learnerId: "L1" },
      { accountNo: "A1", email: "b@example.test", contactName: "B", learnerId: "L1", parentId: "p2" },
      { accountNo: "A1", email: "", contactName: "C", skipped: true, skipReason: "Missing email" },
      {
        accountNo: "A1",
        email: "school@example.test",
        contactName: "D",
        skipped: true,
        skipReason: "School or internal email",
      },
      { accountNo: "A2", email: "g1@example.test", contactName: "G1", learnerId: "L2" },
      { accountNo: "A2", email: "g2@example.test", contactName: "G2", learnerId: "L2", parentId: "p9" },
    ],
  });

  assert.equal(job.schoolId, "school-a");
  const pending = job.recipients.filter((r: any) => r.status === "PENDING");
  const skipped = job.recipients.filter((r: any) => r.status === "SKIPPED");
  assert.equal(pending.length, 4, "eligible recipients persisted once");
  assert.equal(skipped.length, 2, "skipped persisted, not sent");
  assert.equal(job.pendingCount, 4);
  assert.equal(job.skippedCount, 2);

  // --- send success / failure / no double-send ---
  let sends = 0;
  const sendOk = async (input: any) => {
    sends += 1;
    if (String(input.to).includes("b@")) throw new Error("mailbox rejected");
    return { messageId: `msg-${sends}` };
  };

  // Claim+deliver all with concurrency simulation
  const claimedIds: string[] = [];
  for (let i = 0; i < 10; i++) {
    const row = await claimNextBulkStatementRecipient(prisma);
    if (!row) break;
    claimedIds.push(row.id);
    // duplicate claim of same id must fail
    const again = await prisma.bulkStatementEmailRecipient.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: { status: "SENDING" },
    });
    assert.equal(again.count, 0, "duplicate worker cannot re-claim PENDING already SENDING");
    await deliverClaimedBulkStatementRecipient(prisma, row.id, sendOk as any);
  }

  const after = await prisma.bulkStatementEmailJob.findUnique({
    where: { id: job.id },
    include: { recipients: true },
  });
  assert.equal(after.sentCount, 3, "three successful sends");
  assert.equal(after.failedCount, 1, "one provider failure");
  assert.ok(after.recipients.some((r: any) => r.status === "FAILED" && /mailbox rejected/i.test(r.failureReason)));
  const sentBefore = sends;

  // Mark already SENT again — no extra provider call
  const sentRow = after.recipients.find((r: any) => r.status === "SENT");
  await markBulkStatementRecipientSent(prisma, sentRow.id, "dup");
  await deliverClaimedBulkStatementRecipient(prisma, sentRow.id, sendOk as any);
  assert.equal(sends, sentBefore, "SENT is terminal — no duplicate delivery");

  // --- retry failed only ---
  const retry = await retryFailedBulkStatementEmailJob(prisma, {
    jobId: job.id,
    schoolId: "school-a",
  });
  assert.equal(retry.requeued, 1, "only FAILED requeued");
  const mid = await prisma.bulkStatementEmailJob.findUnique({
    where: { id: job.id },
    include: { recipients: true },
  });
  assert.equal(mid.recipients.filter((r: any) => r.status === "SENT").length, 3, "SENT untouched by retry");
  assert.equal(mid.recipients.filter((r: any) => r.status === "PENDING").length, 1, "failed became pending");

  // Duplicate retry while pending — still one pending, SENT unchanged
  await retryFailedBulkStatementEmailJob(prisma, { jobId: job.id, schoolId: "school-a" });
  const mid2 = await prisma.bulkStatementEmailJob.findUnique({
    where: { id: job.id },
    include: { recipients: true },
  });
  assert.equal(mid2.recipients.filter((r: any) => r.status === "SENT").length, 3);

  // --- stale SENDING reclaim + resume after processor restart ---
  const prisma2 = createMemoryPrisma();
  const job2 = await createBulkStatementEmailJob(prisma2, {
    schoolId: "school-b",
    createdBy: "u",
    subject: "S",
    htmlBody: "<p>x</p>",
    recipients: [
      { accountNo: "Z1", email: "z1@example.test" },
      { accountNo: "Z2", email: "z2@example.test" },
    ],
  });
  const claimed = await claimNextBulkStatementRecipient(prisma2, { jobId: job2.id });
  assert.ok(claimed);
  // Simulate crash: leave SENDING with expired lease
  await prisma2.bulkStatementEmailRecipient.updateMany({
    where: { id: claimed!.id },
    data: {
      status: "SENDING",
      sendingLeaseUntil: new Date(Date.now() - 1000),
      lastAttemptAt: new Date(Date.now() - 60_000),
    },
  });
  const reclaimed = await reclaimStaleBulkStatementSending(prisma2, new Date());
  assert.ok(reclaimed >= 1, "stale SENDING reclaimed");

  let resumeSends = 0;
  await processBulkStatementEmailJobsOnce(prisma2, {
    concurrency: 5,
    spacingMs: 0,
    maxClaims: 10,
    sendImpl: async () => {
      resumeSends += 1;
      return { messageId: `r-${resumeSends}` };
    },
  });
  const done = await prisma2.bulkStatementEmailJob.findUnique({
    where: { id: job2.id },
    include: { recipients: true },
  });
  assert.equal(done.sentCount, 2, "job resumes after simulated processor restart");
  assert.equal(resumeSends, 2);

  // School isolation: job from school-a not visible via school-b findFirst
  const cross = await prisma.bulkStatementEmailJob.findFirst({
    where: { id: job.id, schoolId: "school-b" },
  });
  assert.equal(cross, null, "school isolation");

  console.log("bulkStatementEmailJobService.unit.test.ts: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
