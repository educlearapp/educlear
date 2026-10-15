/**
 * Route integration: DELETE /api/payment-allocations/:paymentId requires an active staff user of the same school
 * with payments.create (same permission as saving allocations). Local DB + disposable EduClear Test Schools only;
 * ledger and allocation files live in a temp directory.
 * Run: npx tsx src/routes/paymentAllocations.deleteAuth.route.test.ts
 */
import "dotenv/config";
import crypto from "crypto";
import express from "express";
import fs from "fs";
import http from "http";
import jwt from "jsonwebtoken";
import os from "os";
import path from "path";

import { requireSchoolModule } from "../middleware/requireSchoolModule";
import { prisma } from "../prisma";
import {
  calculateBalanceFromEntries,
  readSchoolLedger,
  setBillingLedgerStoreDataDirForTests,
  writeSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import { listPaymentAllocations, setPaymentAllocationStoreDataDirForTests } from "../utils/paymentAllocationStore";
import { STAFF_JWT_SECRET } from "../utils/staffJwt";
import paymentAllocationsRoutes from "./paymentAllocations";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(String(process.env.DATABASE_URL || ""))) {
  throw new Error("Refusing to run: DATABASE_URL must point at a local database");
}

type Call = (method: string, url: string, token?: string, body?: unknown) => Promise<{ status: number; json: any }>;

async function startServer(): Promise<{ call: Call; close: () => void }> {
  const app = express();
  app.use(express.json());
  app.use("/api/payment-allocations", requireSchoolModule("CORE"), paymentAllocationsRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const call: Call = async (method, url, token, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { call, close: () => server.close() };
}

const sha = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palloc-delete-"));
  fs.writeFileSync(path.join(dir, "billing-ledger.json"), "{}", "utf8");
  setBillingLedgerStoreDataDirForTests(dir);
  setPaymentAllocationStoreDataDirForTests(dir);
  const allocFile = path.join(dir, "payment-allocations.json");
  const ledgerFile = path.join(dir, "billing-ledger.json");

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const schoolA = await prisma.school.create({ data: { name: `EduClear Test School alloc A ${suffix}`, email: `alloc-a-${suffix}@test.local` } });
  const schoolB = await prisma.school.create({ data: { name: `EduClear Test School alloc B ${suffix}`, email: `alloc-b-${suffix}@test.local` } });
  const A = schoolA.id;
  const B = schoolB.id;
  const mkUser = (schoolId: string, role: "FINANCE" | "STAFF" | "SCHOOL_ADMIN", isActive = true) =>
    prisma.user.create({ data: { schoolId, email: `${role.toLowerCase()}-${crypto.randomUUID()}@test.local`, passwordHash: "x", role, isActive } });
  const users = {
    financeA: await mkUser(A, "FINANCE"),
    viewerA: await mkUser(A, "STAFF"),
    adminA: await mkUser(A, "SCHOOL_ADMIN"),
    inactiveFinanceA: await mkUser(A, "FINANCE", false),
    financeB: await mkUser(B, "FINANCE"),
  };
  const token = (u: { id: string; schoolId: string; email: string; role: string }) =>
    jwt.sign({ userId: u.id, schoolId: u.schoolId, email: u.email, role: u.role }, STAFF_JWT_SECRET, { expiresIn: "10m" });

  const row = (schoolId: string, id: string, type: "invoice" | "payment", amount: number): BillingLedgerEntry => ({
    id, schoolId, learnerId: "", accountNo: "ACC001", type, amount, date: "2026-10-01", reference: id.toUpperCase(),
    description: type === "invoice" ? "Fees" : "Payment", source: "manual", createdAt: "2026-10-01T08:00:00.000Z",
  });
  writeSchoolLedger(A, [row(A, "inv-a1", "invoice", 3000), row(A, "pay-a1", "payment", 1000), row(A, "pay-a2", "payment", 500)]);
  writeSchoolLedger(B, [row(B, "inv-b1", "invoice", 2000), row(B, "pay-a1", "payment", 700)]);
  const balanceA = () => calculateBalanceFromEntries(readSchoolLedger(A));
  const balanceB = () => calculateBalanceFromEntries(readSchoolLedger(B));

  const { call, close } = await startServer();
  let passed = 0;
  const test = async (name: string, fn: () => Promise<void>) => {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  };
  const save = async (schoolId: string, paymentId: string, amount: number, tok: string) => {
    const res = await call("POST", `/api/payment-allocations/${paymentId}`, tok, {
      schoolId, accountNo: "ACC001", paymentAmount: amount, lines: [{ invoiceId: schoolId === A ? "inv-a1" : "inv-b1", allocatedAmount: amount }],
    });
    assert(res.status === 200, `save ${paymentId} status ${res.status} ${JSON.stringify(res.json)}`);
  };

  try {
    const tFinA = token(users.financeA);
    const tFinB = token(users.financeB);
    await test("authorised Finance user can still save allocations (POST)", async () => {
      await save(A, "pay-a1", 1000, tFinA);
      await save(A, "pay-a2", 500, tFinA);
      await save(B, "pay-a1", 700, tFinB);
      assert(listPaymentAllocations(A, "pay-a1").length === 1 && listPaymentAllocations(B, "pay-a1").length === 1, "allocations stored");
    });

    const ledgerSha = sha(ledgerFile);
    const balA = balanceA();
    const balB = balanceB();
    const denied = async (name: string, tok: string | undefined, url: string, status: number) => {
      await test(name, async () => {
        const before = sha(allocFile);
        const res = await call("DELETE", url, tok);
        assert(res.status === status, `expected ${status}, got ${res.status} ${JSON.stringify(res.json)}`);
        assert(sha(allocFile) === before, "allocations unchanged");
      });
    };
    await denied("no token -> 401, nothing cleared", undefined, `/api/payment-allocations/pay-a1?schoolId=${A}`, 401);
    await denied("invalid token -> 401", "not-a-jwt", `/api/payment-allocations/pay-a1?schoolId=${A}`, 401);
    await denied("token signed with another secret -> 401", jwt.sign({ userId: users.financeA.id, schoolId: A, email: "x", role: "FINANCE" }, "wrong-secret"), `/api/payment-allocations/pay-a1?schoolId=${A}`, 401);
    await denied("inactive Finance user -> 401", token(users.inactiveFinanceA), `/api/payment-allocations/pay-a1?schoolId=${A}`, 401);
    await denied("Viewer (payments.view only) -> 403", token(users.viewerA), `/api/payment-allocations/pay-a1?schoolId=${A}`, 403);
    await denied("Admin (payments.view only) -> 403", token(users.adminA), `/api/payment-allocations/pay-a1?schoolId=${A}`, 403);
    await denied("other school's Finance user with ?schoolId=A -> 403", tFinB, `/api/payment-allocations/pay-a1?schoolId=${A}`, 403);

    await test("other school's Finance user without schoolId only reaches its own school (school A untouched)", async () => {
      const res = await call("DELETE", `/api/payment-allocations/pay-a1`, tFinB);
      assert(res.status === 200, `status ${res.status}`);
      assert(listPaymentAllocations(A, "pay-a1").length === 1, "school A allocation kept");
      assert(listPaymentAllocations(B, "pay-a1").length === 0, "own school B allocation cleared");
    });

    await test("authorised Finance user clears one payment's allocations; other payment kept; ledger and balances unchanged", async () => {
      const res = await call("DELETE", `/api/payment-allocations/pay-a1?schoolId=${A}`, tFinA);
      assert(res.status === 200 && res.json?.success === true, `status ${res.status}`);
      assert(listPaymentAllocations(A, "pay-a1").length === 0, "pay-a1 cleared");
      assert(listPaymentAllocations(A, "pay-a2").length === 1, "pay-a2 kept");
      assert(sha(ledgerFile) === ledgerSha, "ledger byte-identical");
      assert(balanceA() === balA && balanceB() === balB, "balances unchanged");
    });

    await test("repeated DELETE is idempotent (200, no further change)", async () => {
      const before = sha(allocFile);
      const res = await call("DELETE", `/api/payment-allocations/pay-a1?schoolId=${A}`, tFinA);
      assert(res.status === 200 && sha(allocFile) === before, `status ${res.status}`);
    });

    await test("re-saving after clear works (legitimate allocate -> clear -> allocate flow)", async () => {
      await save(A, "pay-a1", 1000, tFinA);
      assert(listPaymentAllocations(A, "pay-a1").length === 1, "re-saved");
      assert(sha(ledgerFile) === ledgerSha, "ledger still byte-identical");
    });

    console.log(`paymentAllocations.deleteAuth.route.test.ts: OK (${passed} tests)`);
  } finally {
    close();
    setBillingLedgerStoreDataDirForTests(null);
    setPaymentAllocationStoreDataDirForTests(null);
    fs.rmSync(dir, { recursive: true, force: true });
    await prisma.userRbacMeta.deleteMany({ where: { userId: { in: Object.values(users).map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { schoolId: { in: [A, B] } } });
    await prisma.school.deleteMany({ where: { id: { in: [A, B] } } });
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
