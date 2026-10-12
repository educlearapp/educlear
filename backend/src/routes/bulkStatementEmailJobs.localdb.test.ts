/**
 * Isolated route-level check: simultaneous POST /api/bulk-statement-email-jobs for one school
 * create exactly one active job. LOCAL Postgres + test-only school; no email provider configured
 * (any send attempt fails before reaching a network). Cleans up its own school.
 * Run: node --import tsx src/routes/bulkStatementEmailJobs.localdb.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { prisma } from "../prisma";
import bulkStatementEmailJobsRouter from "./bulkStatementEmailJobs";

function assertIsolatedEnvironment() {
  let host = "";
  try {
    host = new URL(String(process.env.DATABASE_URL || "")).hostname;
  } catch {
    host = "";
  }
  if (host !== "localhost" && host !== "127.0.0.1") throw new Error("Refusing: DATABASE_URL is not local.");
  for (const key of ["RESEND_API_KEY", "EDUCLEAR_SMTP_HOST", "SMTP_HOST"]) {
    if (String(process.env[key] || "").trim()) throw new Error(`Refusing: ${key} is configured.`);
  }
}

async function waitForNoSending(jobId: string, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const sending = await prisma.bulkStatementEmailRecipient.count({ where: { jobId, status: "SENDING" } });
    if (sending === 0) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function main() {
  assertIsolatedEnvironment();
  const otherActive = await prisma.bulkStatementEmailJob.count({ where: { status: { in: ["PENDING", "RUNNING"] } } });
  if (otherActive > 0) throw new Error("Refusing: local database already has active statement jobs.");

  const school = await prisma.school.create({ data: { name: `TEST bulk-statement lock ${Date.now()}` } });
  const otherSchool = await prisma.school.create({ data: { name: `TEST bulk-statement lock other ${Date.now()}` } });
  const app = express();
  app.use(express.json());
  app.use("/api/bulk-statement-email-jobs", (req, _res, next) => {
    const schoolId = String(req.header("x-test-school") || "");
    (req as any).schoolModuleAuth = { authorizedSchoolId: schoolId, userId: "test-staff" };
    next();
  });
  app.use("/api/bulk-statement-email-jobs", bulkStatementEmailJobsRouter);
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;

  const body = {
    subject: "TEST statement",
    html: "<p>TEST</p>",
    statementPeriod: "All Time",
    recipients: [
      { accountNo: "TEST001", email: "test-one@example.test", parentId: "tp1" },
      { accountNo: "TEST002", email: "test-two@example.test", parentId: "tp2" },
    ],
  };
  const post = (schoolId: string) =>
    fetch(`http://127.0.0.1:${port}/api/bulk-statement-email-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-school": schoolId },
      body: JSON.stringify(body),
    }).then(async (res) => ({ status: res.status, body: (await res.json()) as any }));

  try {
    const responses = await Promise.all(Array.from({ length: 5 }, () => post(school.id)));
    const statuses = responses.map((r) => r.status).sort();
    const jobIds = new Set(responses.map((r) => r.body?.job?.id));
    const jobs = await prisma.bulkStatementEmailJob.findMany({ where: { schoolId: school.id } });

    assert.deepEqual(statuses, [200, 200, 200, 200, 201], "one 201 created, four 200 attached");
    assert.equal(jobIds.size, 1, "every response carries the same job id");
    assert.equal(jobs.length, 1, "exactly one job row for the school");
    assert.ok(responses.filter((r) => r.status === 200).every((r) => r.body.existingActiveJob === true));
    assert.ok(responses.every((r) => r.body.success === true && Array.isArray(r.body.job.recipients)));
    console.log(`  ✓ 5 simultaneous POSTs → statuses ${statuses.join(",")}, 1 job row`);

    const other = await post(otherSchool.id);
    assert.equal(other.status, 201, "a different school is not blocked");
    assert.notEqual(other.body.job.id, [...jobIds][0]);
    console.log("  ✓ a second school creates its own job (tenant isolation)");

    await waitForNoSending([...jobIds][0]);
    await waitForNoSending(other.body.job.id);
    const sent = await prisma.bulkStatementEmailRecipient.count({
      where: { schoolId: { in: [school.id, otherSchool.id] }, status: "SENT" },
    });
    assert.equal(sent, 0, "no email delivered (no provider configured)");
    console.log("  ✓ no recipient reached SENT — fake/no email delivery");
  } finally {
    server.close();
    await new Promise((r) => setTimeout(r, 500));
    await prisma.school.deleteMany({ where: { id: { in: [school.id, otherSchool.id] } } });
    const left = await prisma.bulkStatementEmailJob.count({ where: { schoolId: { in: [school.id, otherSchool.id] } } });
    assert.equal(left, 0, "test data cleaned up");
    await prisma.$disconnect();
  }
  console.log("bulkStatementEmailJobs.localdb.test.ts: OK");
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
