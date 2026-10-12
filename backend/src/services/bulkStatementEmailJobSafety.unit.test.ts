/**
 * Bulk statement email — overlapping-job guard, provider idempotency and reconciliation safety.
 * In-memory Prisma + simulated Resend idempotency semantics. No database, no live email.
 * Run: node --import tsx src/services/bulkStatementEmailJobSafety.unit.test.ts
 */
import assert from "node:assert/strict";
import {
  BULK_STATEMENT_EMAIL_IDEMPOTENCY_WINDOW_MS,
  BULK_STATEMENT_RECONCILE_PREFIX,
  BULK_STATEMENT_UNCERTAIN_PREFIX,
  bulkStatementEmailIdempotencyKey,
  claimNextBulkStatementRecipient,
  createOrAttachBulkStatementEmailJob,
  deliverClaimedBulkStatementRecipient,
  isBulkStatementRecipientRetryAllowed,
  reclaimStaleBulkStatementSending,
  retryFailedBulkStatementEmailJob,
} from "./bulkStatementEmailJobService";
import {
  classifyResendIdempotencyConflict,
  postResendEmail,
  ResendHttpError,
  ResendNetworkUnavailableError,
} from "./resendClient";

type Row = Record<string, any>;

function createMemoryPrisma(opts: { honourAdvisoryLock?: boolean } = {}) {
  const honourLock = opts.honourAdvisoryLock !== false;
  const jobs = new Map<string, Row>();
  const recipients = new Map<string, Row>();
  const lockQueues = new Map<string, Promise<void>>();
  let seq = 1;
  let failRecipientWrites = 0;
  const id = () => `id_${String(seq++).padStart(4, "0")}`;
  const yieldTick = () => new Promise<void>((resolve) => setTimeout(resolve, 2));

  function matchesRecipientWhere(r: Row, where: any): boolean {
    if (!where) return true;
    if (typeof where.id === "string" && r.id !== where.id) return false;
    if (where.id?.in && !where.id.in.includes(r.id)) return false;
    if (where.jobId && r.jobId !== where.jobId) return false;
    if (where.schoolId && r.schoolId !== where.schoolId) return false;
    if (typeof where.status === "string" && r.status !== where.status) return false;
    if (where.status?.in && !where.status.in.includes(r.status)) return false;
    if (where.lastAttemptAt?.lt && !(r.lastAttemptAt && r.lastAttemptAt < where.lastAttemptAt.lt)) return false;
    if (where.job?.status?.in) {
      const job = jobs.get(r.jobId);
      if (!job || !where.job.status.in.includes(job.status)) return false;
    }
    if (where.OR) {
      const ok = where.OR.some((c: any) => {
        if (c.sendingLeaseUntil?.lt) return Boolean(r.sendingLeaseUntil && r.sendingLeaseUntil < c.sendingLeaseUntil.lt);
        if (c.sendingLeaseUntil === null && c.lastAttemptAt?.lt) {
          return !r.sendingLeaseUntil && Boolean(r.lastAttemptAt && r.lastAttemptAt < c.lastAttemptAt.lt);
        }
        if (c.sendingLeaseUntil === null && c.lastAttemptAt === null && c.updatedAt?.lt) {
          return !r.sendingLeaseUntil && !r.lastAttemptAt && r.updatedAt < c.updatedAt.lt;
        }
        return false;
      });
      if (!ok) return false;
    }
    return true;
  }

  function matchesJobWhere(job: Row, where: any): boolean {
    if (!where) return true;
    if (typeof where.id === "string" && job.id !== where.id) return false;
    if (where.id?.not && job.id === where.id.not) return false;
    if (where.schoolId && job.schoolId !== where.schoolId) return false;
    if (where.status?.in && !where.status.in.includes(job.status)) return false;
    if (where && "startedAt" in where && where.startedAt === null && job.startedAt) return false;
    return true;
  }

  const withRecipients = (job: Row) => ({
    ...job,
    recipients: [...recipients.values()].filter((r) => r.jobId === job.id).map((r) => ({ ...r })),
  });

  const api: any = {
    async $transaction(fn: (tx: any) => Promise<unknown>) {
      const releases: Array<() => void> = [];
      const tx = Object.create(api);
      tx.$executeRaw = async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        if (!honourLock) return 1;
        const key = String(values[0]);
        const previous = lockQueues.get(key) || Promise.resolve();
        let release!: () => void;
        const mine = new Promise<void>((resolve) => (release = resolve));
        lockQueues.set(key, previous.then(() => mine));
        await previous;
        releases.push(release);
        return 1;
      };
      try {
        return await fn(tx);
      } finally {
        for (const release of releases) release();
      }
    },
    async $executeRaw() {
      return 1;
    },
    bulkStatementEmailJob: {
      async create(args: any) {
        await yieldTick();
        const jobId = id();
        const now = new Date();
        const job: Row = {
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
          recipients.set(rid, {
            id: rid,
            jobId,
            ...r,
            attemptCount: 0,
            lastAttemptAt: null,
            sendingLeaseUntil: null,
            providerMessageId: null,
            sentAt: null,
            createdAt: new Date(now.getTime() + seq),
            updatedAt: now,
          });
        }
        return args.include?.recipients ? withRecipients(job) : { ...job };
      },
      async findUnique(args: any) {
        const job = jobs.get(args.where.id);
        if (!job) return null;
        return args.include?.recipients ? withRecipients(job) : { ...job };
      },
      async findUniqueOrThrow(args: any) {
        const job = await api.bulkStatementEmailJob.findUnique(args);
        if (!job) throw new Error("not found");
        return job;
      },
      async findFirst(args: any) {
        await yieldTick();
        const list = [...jobs.values()]
          .filter((job) => matchesJobWhere(job, args.where))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        if (!list[0]) return null;
        return args.include?.recipients ? withRecipients(list[0]) : { ...list[0] };
      },
      async findMany(args: any) {
        return [...jobs.values()].filter((job) => matchesJobWhere(job, args.where)).map((j) => ({ ...j }));
      },
      async update(args: any) {
        const job = jobs.get(args.where.id);
        if (!job) throw new Error("missing job");
        Object.assign(job, args.data, { updatedAt: new Date() });
        return { ...job };
      },
      async updateMany(args: any) {
        let count = 0;
        for (const job of jobs.values()) {
          if (!matchesJobWhere(job, args.where)) continue;
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
          .filter((r) => matchesRecipientWhere(r, args.where))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return list[0] ? { ...list[0] } : null;
      },
      async findMany(args: any) {
        return [...recipients.values()].filter((r) => matchesRecipientWhere(r, args.where)).map((r) => ({ ...r }));
      },
      async findUnique(args: any) {
        const row = recipients.get(args.where.id);
        if (!row) return null;
        if (args.include?.job) return { ...row, job: { ...jobs.get(row.jobId) } };
        return { ...row };
      },
      async updateMany(args: any) {
        if (failRecipientWrites > 0 && args.data?.status === "SENT") {
          failRecipientWrites -= 1;
          throw Object.assign(new Error("Server has closed the connection."), { code: "P1017" });
        }
        let count = 0;
        for (const r of recipients.values()) {
          if (!matchesRecipientWhere(r, args.where)) continue;
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
    _jobs: jobs,
    _recipients: recipients,
    _failSentWrites(n: number) {
      failRecipientWrites = n;
    },
  };
  return api;
}

/** Simulates Resend idempotency semantics documented at resend.com/docs/dashboard/emails/idempotency-keys. */
function createFakeResend() {
  const byKey = new Map<string, { payload: string; id: string; inProgress: boolean }>();
  const deliveries: string[] = [];
  let seq = 1;
  let behaviour: "normal" | "deliver_then_timeout" | "timeout_without_delivery" | "hold_in_progress" = "normal";

  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    const key = headers.get("Idempotency-Key") || "";
    const payload = String(init.body || "");
    if (behaviour === "timeout_without_delivery") {
      throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) });
    }
    if (key && byKey.has(key)) {
      const prior = byKey.get(key)!;
      if (prior.inProgress) {
        return new Response(
          JSON.stringify({ statusCode: 409, name: "concurrent_idempotent_requests", message: "in progress" }),
          { status: 409 }
        );
      }
      if (prior.payload !== payload) {
        return new Response(
          JSON.stringify({ statusCode: 409, name: "invalid_idempotent_request", message: "different payload" }),
          { status: 409 }
        );
      }
      return new Response(JSON.stringify({ id: prior.id }), { status: 200 });
    }
    const messageId = `resend-${seq++}`;
    deliveries.push(key || messageId);
    if (key) byKey.set(key, { payload, id: messageId, inProgress: behaviour === "hold_in_progress" });
    if (behaviour === "deliver_then_timeout") {
      throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) });
    }
    return new Response(JSON.stringify({ id: messageId }), { status: 200 });
  }) as unknown as typeof fetch;

  return {
    fetchImpl,
    deliveries,
    byKey,
    setBehaviour(next: typeof behaviour) {
      behaviour = next;
    },
    finishInProgress(key: string) {
      const row = byKey.get(key);
      if (row) row.inProgress = false;
    },
  };
}

const noSleep = async () => {};

/** sendImpl that builds a statement payload and posts through the real Resend client. */
function resendSendImpl(resend: ReturnType<typeof createFakeResend>, pdfVariant: { value: string }) {
  return (async (input: any) =>
    postResendEmail({
      apiKey: "re_test",
      fetchImpl: resend.fetchImpl,
      sleepImpl: noSleep,
      idempotencyKey: input.idempotencyKey,
      payload: {
        from: "EduClear <noreply@example.test>",
        to: [input.to],
        subject: input.subject,
        html: input.html,
        attachments: [{ filename: "statement.pdf", content: `pdf:${input.accountNo}:${pdfVariant.value}` }],
      },
    })) as any;
}

const RECIPIENTS = [
  { accountNo: "ACC1", email: "one@example.test", parentId: "p1" },
  { accountNo: "ACC2", email: "two@example.test", parentId: "p2" },
];

function jobInput(schoolId: string) {
  return {
    schoolId,
    createdBy: "staff-1",
    subject: "Statement",
    htmlBody: "<p>Statement</p>",
    statementPeriod: "All Time",
    recipients: RECIPIENTS,
  };
}

async function claimAndDeliverAll(prisma: any, sendImpl: any, jobId?: string) {
  const outcomes: string[] = [];
  for (let i = 0; i < 20; i++) {
    const row = await claimNextBulkStatementRecipient(prisma, jobId ? { jobId } : undefined);
    if (!row) break;
    outcomes.push(await deliverClaimedBulkStatementRecipient(prisma, row.id, sendImpl, { sleepImpl: noSleep }));
  }
  return outcomes;
}

async function testSimultaneousCreateSameSchool() {
  const prisma = createMemoryPrisma();
  const [a, b] = await Promise.all([
    createOrAttachBulkStatementEmailJob(prisma, jobInput("school-a")),
    createOrAttachBulkStatementEmailJob(prisma, jobInput("school-a")),
  ]);
  assert.equal(prisma._jobs.size, 1, "only one job created for simultaneous requests");
  assert.equal(a.job.id, b.job.id, "second request attaches to the same job");
  assert.deepEqual([a.created, b.created].sort(), [false, true], "exactly one request created the job");
  assert.equal(a.job.pendingCount, 2, "progress returned with the existing job");

  // Control: without the advisory lock the same race creates two jobs (proves the lock is load-bearing).
  const unlocked = createMemoryPrisma({ honourAdvisoryLock: false });
  await Promise.all([
    createOrAttachBulkStatementEmailJob(unlocked, jobInput("school-a")),
    createOrAttachBulkStatementEmailJob(unlocked, jobInput("school-a")),
  ]);
  assert.equal(unlocked._jobs.size, 2, "control: race reproduces duplicate jobs without the lock");
  console.log("  ✓ 1. simultaneous creates for one school → one job (control without lock → two)");
}

async function testNewJobAfterCompletion() {
  const prisma = createMemoryPrisma();
  const resend = createFakeResend();
  const first = await createOrAttachBulkStatementEmailJob(prisma, jobInput("school-a"));
  await claimAndDeliverAll(prisma, resendSendImpl(resend, { value: "v1" }));
  const done = await prisma.bulkStatementEmailJob.findUnique({ where: { id: first.job.id } });
  assert.equal(done.status, "COMPLETE");

  const second = await createOrAttachBulkStatementEmailJob(prisma, jobInput("school-a"));
  assert.equal(second.created, true, "new job allowed once the earlier job genuinely completed");
  assert.notEqual(second.job.id, first.job.id);
  const firstKeys = done && [...prisma._recipients.values()].filter((r: Row) => r.jobId === first.job.id);
  const secondKeys = [...prisma._recipients.values()].filter((r: Row) => r.jobId === second.job.id);
  const k1 = new Set(firstKeys.map((r: Row) => bulkStatementEmailIdempotencyKey(r.id)));
  assert.ok(
    secondKeys.every((r: Row) => !k1.has(bulkStatementEmailIdempotencyKey(r.id))),
    "deliberately new job uses new idempotency keys"
  );
  console.log("  ✓ 2. new job after genuine completion is created with fresh idempotency keys");
}

async function testStaleActiveJobIsRecountedNotBlocking() {
  const prisma = createMemoryPrisma();
  const resend = createFakeResend();
  const first = await createOrAttachBulkStatementEmailJob(prisma, jobInput("school-a"));
  await claimAndDeliverAll(prisma, resendSendImpl(resend, { value: "v1" }));
  // Simulate a missed recount: job row still says RUNNING although every recipient is terminal.
  prisma._jobs.get(first.job.id).status = "RUNNING";
  const next = await createOrAttachBulkStatementEmailJob(prisma, jobInput("school-a"));
  assert.equal(next.created, true, "stale RUNNING label is recounted, not treated as active");
  assert.equal(prisma._jobs.get(first.job.id).status, "COMPLETE");
  console.log("  ✓ 2b. stale RUNNING status is recounted from recipients before blocking");
}

async function testResendMatchingRequest() {
  const resend = createFakeResend();
  const payload = { from: "a@example.test", to: ["x@example.test"], subject: "S", html: "<p>h</p>" };
  const first = await postResendEmail({ apiKey: "re_test", payload, fetchImpl: resend.fetchImpl, idempotencyKey: "bulk-statement-email/r1" });
  const second = await postResendEmail({ apiKey: "re_test", payload, fetchImpl: resend.fetchImpl, idempotencyKey: "bulk-statement-email/r1" });
  assert.equal(first.messageId, second.messageId, "same key + same payload returns original response");
  assert.equal(resend.deliveries.length, 1, "matching request delivered once");

  let sentHeader = "";
  await postResendEmail({
    apiKey: "re_test",
    payload,
    idempotencyKey: "bulk-statement-email/r2",
    fetchImpl: (async (_u: string, init: RequestInit) => {
      sentHeader = new Headers(init.headers).get("Idempotency-Key") || "";
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    }) as any,
  });
  assert.equal(sentHeader, "bulk-statement-email/r2", "Idempotency-Key header sent");

  let headerWithoutKey: string | null = "unset";
  await postResendEmail({
    apiKey: "re_test",
    payload,
    fetchImpl: (async (_u: string, init: RequestInit) => {
      headerWithoutKey = new Headers(init.headers).get("Idempotency-Key");
      return new Response(JSON.stringify({ id: "y" }), { status: 200 });
    }) as any,
  });
  assert.equal(headerWithoutKey, null, "no header when no key (other email paths unchanged)");

  await assert.rejects(
    postResendEmail({ apiKey: "re_test", payload, fetchImpl: resend.fetchImpl, idempotencyKey: "k".repeat(257) }),
    /256/
  );
  console.log("  ✓ 3. Resend matching request: same key+payload → original id, single delivery");
}

async function testResendChangedPayloadConflict() {
  const prisma = createMemoryPrisma();
  const resend = createFakeResend();
  const variant = { value: "v1" };
  const created = await createOrAttachBulkStatementEmailJob(prisma, jobInput("school-a"));

  // First attempt delivered at the provider, but both client attempts saw a timeout.
  resend.setBehaviour("deliver_then_timeout");
  const row = await claimNextBulkStatementRecipient(prisma, { jobId: created.job.id });
  const outcome = await deliverClaimedBulkStatementRecipient(prisma, row!.id, resendSendImpl(resend, variant), { sleepImpl: noSleep });
  // Internal retry re-used the key and identical payload → provider returned original id.
  assert.equal(outcome, "SENT", "internal retry with same key + payload resolves to SENT");
  assert.equal(resend.deliveries.length, 1, "no duplicate on transparent retry");

  // Next recipient: provider accepted, client saw a hard failure on both attempts → UNCERTAIN.
  resend.setBehaviour("normal");
  const row2 = await claimNextBulkStatementRecipient(prisma, { jobId: created.job.id });
  const key2 = bulkStatementEmailIdempotencyKey(row2!.id);
  let calls = 0;
  const flakySend = (async (input: any) => {
    calls += 1;
    await resendSendImpl(resend, variant)(input);
    throw new ResendNetworkUnavailableError({ code: "ETIMEDOUT", timedOut: true, attempts: 2 });
  }) as any;
  const uncertain = await deliverClaimedBulkStatementRecipient(prisma, row2!.id, flakySend, { sleepImpl: noSleep });
  assert.equal(uncertain, "FAILED");
  const r2 = prisma._recipients.get(row2!.id);
  assert.ok(
    String(r2.failureReason).startsWith(BULK_STATEMENT_UNCERTAIN_PREFIX),
    `timeout recorded as uncertain (got status=${r2.status} reason=${r2.failureReason})`
  );
  assert.equal(resend.deliveries.length, 2);

  // PDF regenerated with different bytes → retry within window sends same key, changed payload → 409.
  variant.value = "v2";
  const retry = await retryFailedBulkStatementEmailJob(prisma, { jobId: created.job.id, schoolId: "school-a" });
  assert.equal(retry.requeued, 1, "uncertain inside the 23h window is retryable (same key)");
  const again = await claimNextBulkStatementRecipient(prisma, { jobId: created.job.id });
  assert.equal(again!.id, row2!.id);
  const conflict = await deliverClaimedBulkStatementRecipient(prisma, again!.id, resendSendImpl(resend, variant), { sleepImpl: noSleep });
  assert.equal(conflict, "FAILED");
  assert.equal(resend.deliveries.length, 2, "changed payload never produces a second delivery");
  assert.ok(prisma._recipients.get(row2!.id).failureReason.startsWith(BULK_STATEMENT_RECONCILE_PREFIX));
  assert.equal(resend.byKey.has(key2), true);

  const held = await retryFailedBulkStatementEmailJob(prisma, { jobId: created.job.id, schoolId: "school-a" });
  assert.equal(held.requeued, 0, "reconcile rows are never requeued");
  assert.equal(held.heldForReconciliation, 1);
  const heldExplicit = await retryFailedBulkStatementEmailJob(prisma, {
    jobId: created.job.id,
    schoolId: "school-a",
    recipientIds: [row2!.id],
  });
  assert.equal(heldExplicit.requeued, 0, "explicit recipient selection cannot bypass reconciliation hold");
  assert.equal(calls, 1);

  // A generic 409 (not an idempotency conflict) is not treated as delivery proof or reconciliation.
  assert.equal(classifyResendIdempotencyConflict(new ResendHttpError(409, JSON.stringify({ name: "conflict" }))), null);
  assert.equal(classifyResendIdempotencyConflict(new ResendHttpError(422, JSON.stringify({ name: "invalid_idempotent_request" }))), null);
  console.log("  ✓ 4. changed payload → 409 invalid_idempotent_request → held for reconciliation, never resent");
}

async function testResendInProgress() {
  const prisma = createMemoryPrisma();
  const resend = createFakeResend();
  const variant = { value: "v1" };
  const created = await createOrAttachBulkStatementEmailJob(prisma, jobInput("school-a"));
  const row = await claimNextBulkStatementRecipient(prisma, { jobId: created.job.id });
  const key = bulkStatementEmailIdempotencyKey(row!.id);

  // Another worker's request with the same key is still being processed by the provider.
  resend.setBehaviour("hold_in_progress");
  await resendSendImpl(resend, variant)({ to: "one@example.test", subject: "Statement", html: "<p>Statement</p>", accountNo: "ACC1", idempotencyKey: key });
  resend.setBehaviour("normal");

  const outcome = await deliverClaimedBulkStatementRecipient(prisma, row!.id, resendSendImpl(resend, variant), { sleepImpl: noSleep });
  assert.equal(outcome, "DEFERRED", "in-progress conflict is deferred, not failed or sent");
  const r = prisma._recipients.get(row!.id);
  assert.equal(r.status, "SENDING", "row stays claimed");
  assert.ok(r.sendingLeaseUntil.getTime() - Date.now() <= 61_000, "short re-check lease");
  assert.equal(resend.deliveries.length, 1);

  resend.finishInProgress(key);
  const reclaimed = await reclaimStaleBulkStatementSending(prisma, new Date(Date.now() + 61_000));
  assert.equal(reclaimed, 1);
  const again = await claimNextBulkStatementRecipient(prisma, { jobId: created.job.id });
  const final = await deliverClaimedBulkStatementRecipient(prisma, again!.id, resendSendImpl(resend, variant), { sleepImpl: noSleep });
  assert.equal(final, "SENT", "re-check with the same key returns the original response");
  assert.equal(resend.deliveries.length, 1, "still exactly one delivery");
  console.log("  ✓ 5. in-progress 409 → DEFERRED with short lease → re-check resolves to SENT, one delivery");
}

async function testUncertainOutsideWindowHeld() {
  const now = new Date();
  assert.equal(
    isBulkStatementRecipientRetryAllowed(
      { failureReason: `${BULK_STATEMENT_UNCERTAIN_PREFIX} x`, lastAttemptAt: new Date(now.getTime() - 60_000) },
      now
    ),
    true
  );
  assert.equal(
    isBulkStatementRecipientRetryAllowed(
      {
        failureReason: `${BULK_STATEMENT_UNCERTAIN_PREFIX} x`,
        lastAttemptAt: new Date(now.getTime() - BULK_STATEMENT_EMAIL_IDEMPOTENCY_WINDOW_MS - 1),
      },
      now
    ),
    false,
    "uncertain outside the provider window is held"
  );
  assert.equal(isBulkStatementRecipientRetryAllowed({ failureReason: "mailbox rejected", lastAttemptAt: null }, now), true);

  // SENDING row interrupted for longer than the idempotency window → reconcile, not resend.
  const prisma = createMemoryPrisma();
  const created = await createOrAttachBulkStatementEmailJob(prisma, jobInput("school-a"));
  const row = await claimNextBulkStatementRecipient(prisma, { jobId: created.job.id });
  prisma._recipients.get(row!.id).lastAttemptAt = new Date(Date.now() - BULK_STATEMENT_EMAIL_IDEMPOTENCY_WINDOW_MS - 5_000);
  prisma._recipients.get(row!.id).sendingLeaseUntil = new Date(Date.now() - 1_000);
  await reclaimStaleBulkStatementSending(prisma, new Date());
  const r = prisma._recipients.get(row!.id);
  assert.equal(r.status, "FAILED");
  assert.ok(r.failureReason.startsWith(BULK_STATEMENT_RECONCILE_PREFIX), "expired-window send held for reconciliation");
  console.log("  ✓ 6. uncertain delivery: retry only inside 23h window; older interrupted sends held for reconciliation");
}

async function testLegacyAndExpiredUncertainNeverRequeued() {
  const now = new Date();
  for (const legacy of [
    "The email service could not be reached. Please try again shortly.",
    "Email delivery temporarily unavailable. The server will retry failed recipients.",
    "SMTP send timed out after 45s. Check SMTP host, port, TLS mode, and credentials.",
    "connect ETIMEDOUT",
  ]) {
    assert.equal(
      isBulkStatementRecipientRetryAllowed({ failureReason: legacy, lastAttemptAt: now }, now),
      false,
      "pre-release network/timeout failure (no idempotency key) is held"
    );
  }

  // Through retry-failed, 25h after an uncertain attempt, even when the admin explicitly selects the row.
  const prisma = createMemoryPrisma();
  const created = await createOrAttachBulkStatementEmailJob(prisma, jobInput("school-a"));
  await claimAndDeliverAll(prisma, (async () => {
    throw new Error("mailbox rejected");
  }) as any);
  const rows = [...prisma._recipients.values()].filter((r: any) => r.jobId === created.job.id);
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
  rows[0].failureReason = `${BULK_STATEMENT_UNCERTAIN_PREFIX} The email service could not be reached.`;
  rows[0].lastAttemptAt = old;
  rows[1].failureReason = "The email service could not be reached. Please try again shortly.";
  rows[1].lastAttemptAt = old;
  const result = await retryFailedBulkStatementEmailJob(prisma, {
    jobId: created.job.id,
    schoolId: "school-a",
    recipientIds: [rows[0].id, rows[1].id],
  });
  assert.equal(result.heldForReconciliation, 2);
  assert.equal(rows[0].status, "FAILED");
  assert.equal(rows[1].status, "FAILED");
  console.log("  ✓ 6b. legacy unkeyed and >24h uncertain recipients are never requeued, even when selected");
}

async function testDbFailureAfterProviderAcceptance() {
  const prisma = createMemoryPrisma();
  const resend = createFakeResend();
  const variant = { value: "v1" };
  const created = await createOrAttachBulkStatementEmailJob(prisma, jobInput("school-a"));

  // Transient: first SENT write fails, retry succeeds.
  prisma._failSentWrites(1);
  const row1 = await claimNextBulkStatementRecipient(prisma, { jobId: created.job.id });
  const o1 = await deliverClaimedBulkStatementRecipient(prisma, row1!.id, resendSendImpl(resend, variant), { sleepImpl: noSleep });
  assert.equal(o1, "SENT");
  assert.equal(prisma._recipients.get(row1!.id).status, "SENT");
  assert.ok(prisma._recipients.get(row1!.id).providerMessageId);

  // Persistent: all SENT writes fail → never FAILED, stays SENDING for safe reconciliation.
  prisma._failSentWrites(99);
  const originalError = console.error;
  const logged: string[] = [];
  console.error = (line: unknown) => logged.push(String(line));
  const row2 = await claimNextBulkStatementRecipient(prisma, { jobId: created.job.id });
  const o2 = await deliverClaimedBulkStatementRecipient(prisma, row2!.id, resendSendImpl(resend, variant), { sleepImpl: noSleep });
  console.error = originalError;
  assert.equal(o2, "UNRECORDED");
  assert.equal(prisma._recipients.get(row2!.id).status, "SENDING", "not marked FAILED after provider acceptance");
  assert.ok(logged.some((l) => l.includes("bulk_statement_email_sent_unrecorded") && l.includes("resend-")), "provider id logged");
  assert.ok(!logged.some((l) => l.includes("two@example.test")), "no email address in reconciliation log");
  assert.equal(resend.deliveries.length, 2);

  // Database recovers; lease expires; reclaim + re-delivery uses the same key → no second delivery.
  prisma._failSentWrites(0);
  await reclaimStaleBulkStatementSending(prisma, new Date(Date.now() + 11 * 60 * 1000));
  const again = await claimNextBulkStatementRecipient(prisma, { jobId: created.job.id });
  assert.equal(again!.id, row2!.id);
  const o3 = await deliverClaimedBulkStatementRecipient(prisma, again!.id, resendSendImpl(resend, variant), { sleepImpl: noSleep });
  assert.equal(o3, "SENT");
  assert.equal(resend.deliveries.length, 2, "reconciled without a duplicate delivery");

  // A row that already carries a provider id is marked SENT without calling the provider.
  const prisma2 = createMemoryPrisma();
  const c2 = await createOrAttachBulkStatementEmailJob(prisma2, jobInput("school-z"));
  const r = await claimNextBulkStatementRecipient(prisma2, { jobId: c2.job.id });
  prisma2._recipients.get(r!.id).providerMessageId = "resend-existing";
  let providerCalls = 0;
  const o4 = await deliverClaimedBulkStatementRecipient(prisma2, r!.id, (async () => {
    providerCalls += 1;
    return { messageId: "should-not-happen" };
  }) as any);
  assert.equal(o4, "SENT");
  assert.equal(providerCalls, 0, "existing provider id reused, provider not called");
  assert.equal(prisma2._recipients.get(r!.id).providerMessageId, "resend-existing");
  console.log("  ✓ 7. DB failure after acceptance → retried / left SENDING (never FAILED) → reconciled with one delivery");
}

async function testNoUnintendedDuplicatesAndTenantIsolation() {
  const prisma = createMemoryPrisma();
  const resend = createFakeResend();
  const variant = { value: "v1" };
  const a = await createOrAttachBulkStatementEmailJob(prisma, jobInput("school-a"));
  const aAgain = await createOrAttachBulkStatementEmailJob(prisma, jobInput("school-a"));
  const b = await createOrAttachBulkStatementEmailJob(prisma, jobInput("school-b"));
  assert.equal(aAgain.created, false);
  assert.equal(aAgain.job.id, a.job.id);
  assert.equal(b.created, true, "another school's active job never blocks or attaches across tenants");
  assert.notEqual(b.job.schoolId, a.job.schoolId);

  await claimAndDeliverAll(prisma, resendSendImpl(resend, variant));
  assert.equal(resend.deliveries.length, 4, "2 recipients × 2 schools, each delivered once");

  await assert.rejects(
    retryFailedBulkStatementEmailJob(prisma, { jobId: a.job.id, schoolId: "school-b" }),
    /Job not found/,
    "cross-tenant retry rejected"
  );

  // Retry-failed cannot re-activate a finished job while another job is active for the same school.
  const prisma2 = createMemoryPrisma();
  const first = await createOrAttachBulkStatementEmailJob(prisma2, jobInput("school-a"));
  await claimAndDeliverAll(prisma2, (async () => {
    throw new Error("mailbox rejected");
  }) as any);
  const second = await createOrAttachBulkStatementEmailJob(prisma2, jobInput("school-a"));
  assert.equal(second.created, true);
  await assert.rejects(
    retryFailedBulkStatementEmailJob(prisma2, { jobId: first.job.id, schoolId: "school-a" }),
    /still active/,
    "retry blocked while another job is active"
  );
  console.log("  ✓ 8/9. no duplicate deliveries; tenant isolation for create, attach and retry");
}

async function testStartedAtPreserved() {
  const prisma = createMemoryPrisma();
  const created = await createOrAttachBulkStatementEmailJob(prisma, jobInput("school-a"));
  const t1 = new Date("2026-10-12T06:31:30.000Z");
  const t2 = new Date("2026-10-12T06:48:40.000Z");
  const r1 = await claimNextBulkStatementRecipient(prisma, { jobId: created.job.id, now: t1 });
  await deliverClaimedBulkStatementRecipient(prisma, r1!.id, (async () => ({ messageId: "m1" })) as any);
  const r2 = await claimNextBulkStatementRecipient(prisma, { jobId: created.job.id, now: t2 });
  await deliverClaimedBulkStatementRecipient(prisma, r2!.id, (async () => ({ messageId: "m2" })) as any);
  const job = prisma._jobs.get(created.job.id);
  assert.equal(job.startedAt.toISOString(), t1.toISOString(), "start time is the first claim, not the last");
  assert.equal(job.status, "COMPLETE");
  assert.equal(job.sentCount, 2);
  assert.equal(job.pendingCount, 0);
  assert.equal(job.sendingCount, 0);
  console.log("  ✓ 10. job status/counts accurate and original start time preserved");
}

async function main() {
  console.log("bulkStatementEmailJobSafety.unit.test.ts");
  await testSimultaneousCreateSameSchool();
  await testNewJobAfterCompletion();
  await testStaleActiveJobIsRecountedNotBlocking();
  await testResendMatchingRequest();
  await testResendChangedPayloadConflict();
  await testResendInProgress();
  await testUncertainOutsideWindowHeld();
  await testLegacyAndExpiredUncertainNeverRequeued();
  await testDbFailureAfterProviderAcceptance();
  await testNoUnintendedDuplicatesAndTenantIsolation();
  await testStartedAtPreserved();
  console.log("bulkStatementEmailJobSafety.unit.test.ts: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
