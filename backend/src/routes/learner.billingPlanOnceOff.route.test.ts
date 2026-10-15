/**
 * Route integration: PATCH /api/learners/:id/billing-plan and PUT /api/learners/:id reject newly added
 * once-off / annual / termly fees before writing anything. Local DB + disposable EduClear Test School only.
 * Run: npx tsx src/routes/learner.billingPlanOnceOff.route.test.ts
 */
import "dotenv/config";
import crypto from "crypto";
import express from "express";
import fs from "fs";
import http from "http";
import path from "path";

import { prisma } from "../prisma";
import learnerRoutes from "./learner";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(String(process.env.DATABASE_URL || ""))) {
  throw new Error("Refusing to run: DATABASE_URL must point at a local database");
}

const PLAN_JSON = path.resolve(__dirname, "../../data/learner-billing-plans.json");
const meta = (uiType: string) => `FEES_META:${JSON.stringify({ category: "SCHOOL_CHARGE", uiType, notes: null })}`;

type Call = (method: string, url: string, body?: unknown) => Promise<{ status: number; json: any }>;

async function startServer(): Promise<{ call: Call; close: () => void }> {
  const app = express();
  app.use(express.json());
  app.use("/api/learners", learnerRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const call: Call = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { call, close: () => server.close() };
}

function fileSha(file: string): string {
  return fs.existsSync(file) ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") : "absent";
}

async function planOf(schoolId: string, learnerId: string) {
  const rows = await prisma.learnerBillingPlanLine.findMany({
    where: { schoolId, learnerId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, feeDescription: true, amount: true, updatedAt: true },
  });
  return JSON.stringify(rows);
}

async function run() {
  const planJsonBackup = fs.existsSync(PLAN_JSON) ? fs.readFileSync(PLAN_JSON) : null;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const school = await prisma.school.create({
    data: { name: `EduClear Test School once-off guard ${suffix}`, email: `onceoff-${suffix}@test.local` },
  });
  const S = school.id;
  const { call, close } = await startServer();
  let passed = 0;
  const test = async (name: string, fn: () => Promise<void>) => {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  };

  try {
    await prisma.feeStructure.createMany({
      data: [
        { schoolId: S, name: "PRE-PRIMARY 2026 CRECHE AND GRADE R HALF DAY", amount: 2800, frequency: "MONTHLY", grade: meta("MONTHLY") },
        { schoolId: S, name: "Grade R Graduation", amount: 400, frequency: "ONCE_OFF", grade: meta("ONCE_OFF") },
        { schoolId: S, name: "JAMF Fee", amount: 450, frequency: "YEARLY", grade: meta("ANNUALLY") },
        { schoolId: S, name: "Aftercare", amount: 550, frequency: "MONTHLY", grade: meta("MONTHLY") },
      ] as any,
    });
    const learner = await prisma.learner.create({
      data: { schoolId: S, firstName: "Test", lastName: "OnceOff", grade: "Grade R", notes: "original" } as any,
    });
    const legacy = await prisma.learner.create({
      data: { schoolId: S, firstName: "Test", lastName: "Legacy", grade: "Grade R" } as any,
    });
    await prisma.learnerBillingPlanLine.createMany({
      data: [
        { schoolId: S, learnerId: learner.id, feeDescription: "PRE-PRIMARY 2026 CRECHE AND GRADE R HALF DAY", amount: 2800, sortOrder: 0 },
        { schoolId: S, learnerId: legacy.id, feeDescription: "PRE-PRIMARY 2026 CRECHE AND GRADE R HALF DAY", amount: 2800, sortOrder: 0 },
        { schoolId: S, learnerId: legacy.id, feeDescription: "Grade R Graduation", amount: 400, sortOrder: 1 },
      ],
    });

    const tuition = { description: "PRE-PRIMARY 2026 CRECHE AND GRADE R HALF DAY", amount: 2800 };
    const grad = { description: "Grade R Graduation", amount: 400, type: "ONCE_OFF" };
    const jamf = { description: "JAMF Fee", amount: 450, type: "ANNUALLY" };
    const aftercare = { description: "Aftercare", amount: 550, type: "MONTHLY" };

    await test("PATCH adding Grade R Graduation -> 422, plan and JSON mirror unchanged", async () => {
      const before = [await planOf(S, learner.id), fileSha(PLAN_JSON)];
      const res = await call("PATCH", `/api/learners/${learner.id}/billing-plan`, { billingPlan: [tuition, grad] });
      assert(res.status === 422 && res.json?.code === "NON_RECURRING_FEE_ON_BILLING_PLAN", `status ${res.status} ${JSON.stringify(res.json)}`);
      assert(/"Grade R Graduation" is a ONCE_OFF fee/.test(res.json.error), "message names the fee and type");
      assert(JSON.stringify([await planOf(S, learner.id), fileSha(PLAN_JSON)]) === JSON.stringify(before), "nothing written");
    });

    await test("PATCH adding annual JAMF fee -> 422", async () => {
      const res = await call("PATCH", `/api/learners/${learner.id}/billing-plan`, { billingPlan: [tuition, jamf] });
      assert(res.status === 422 && /ANNUALLY/.test(res.json?.error), `status ${res.status}`);
    });

    await test("PUT learner with graduation in billingPlan -> 422 before learner fields are saved", async () => {
      const before = await planOf(S, learner.id);
      const res = await call("PUT", `/api/learners/${learner.id}`, { notes: "changed", billingPlan: [tuition, grad] });
      assert(res.status === 422 && res.json?.code === "NON_RECURRING_FEE_ON_BILLING_PLAN", `status ${res.status}`);
      const row = await prisma.learner.findUnique({ where: { id: learner.id }, select: { notes: true } });
      assert(row?.notes === "original", "learner notes not changed");
      assert((await planOf(S, learner.id)) === before, "plan not changed");
    });

    await test("PATCH adding monthly aftercare -> 200 (recurring fees unaffected)", async () => {
      const res = await call("PATCH", `/api/learners/${learner.id}/billing-plan`, { billingPlan: [tuition, aftercare] });
      assert(res.status === 200 && res.json?.billingPlan?.length === 2, `status ${res.status}`);
    });

    await test("legacy plan already holding graduation: unrelated edit (add aftercare) still saves", async () => {
      const res = await call("PATCH", `/api/learners/${legacy.id}/billing-plan`, {
        billingPlan: [tuition, { description: "Grade R Graduation", amount: 400 }, aftercare],
      });
      assert(res.status === 200 && res.json?.billingPlan?.length === 3, `status ${res.status} ${JSON.stringify(res.json)}`);
    });

    await test("legacy plan: removing graduation saves; re-adding it is blocked", async () => {
      const removed = await call("PATCH", `/api/learners/${legacy.id}/billing-plan`, { billingPlan: [tuition, aftercare] });
      assert(removed.status === 200 && removed.json.billingPlan.length === 2, "removal saved");
      const readd = await call("PATCH", `/api/learners/${legacy.id}/billing-plan`, { billingPlan: [tuition, aftercare, grad] });
      assert(readd.status === 422, "re-adding graduation blocked");
    });

    await test("PUT without billingPlan is unaffected by the guard", async () => {
      const res = await call("PUT", `/api/learners/${learner.id}`, { notes: "changed" });
      assert(res.status === 200, `status ${res.status}`);
    });

    console.log(`learner.billingPlanOnceOff.route.test.ts: OK (${passed} tests)`);
  } finally {
    close();
    await prisma.learnerBillingPlanLine.deleteMany({ where: { schoolId: S } });
    await prisma.learnerBillingPlanCleared.deleteMany({ where: { schoolId: S } });
    await prisma.learner.deleteMany({ where: { schoolId: S } });
    await prisma.feeStructure.deleteMany({ where: { schoolId: S } });
    await prisma.school.deleteMany({ where: { id: S } });
    if (planJsonBackup) fs.writeFileSync(PLAN_JSON, planJsonBackup);
    else if (fs.existsSync(PLAN_JSON)) fs.unlinkSync(PLAN_JSON);
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
