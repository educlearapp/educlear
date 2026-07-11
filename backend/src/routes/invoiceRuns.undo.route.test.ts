/**
 * HTTP route integration tests for POST /api/invoice-runs/:runId/undo
 * Run: npx tsx src/routes/invoiceRuns.undo.route.test.ts
 */
import express from "express";
import fs from "fs";
import http from "http";
import jwt from "jsonwebtoken";
import path from "path";

import { DA_SILVA_ACADEMY_SCHOOL_ID } from "../services/activateDaSilvaSubscription";
import invoiceRunsRoutes from "./invoiceRuns";
import { prisma } from "../prisma";
import { getUserAccessMeta } from "../utils/userAccessStore";
import { appRoleFromPrismaRole } from "../utils/userPermissions";
import { writeSchoolLedger, type BillingLedgerEntry } from "../utils/billingLedgerStore";

const MBB_SCHOOL_ID = "cmq4xjckq00at60gqg4eb956h";
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const TEST_SCHOOL = "test-school-invoice-run-undo-route";
const RUN_ID = "RUN-UNDO-ROUTE-TEST";
const LEDGER_FILE = path.join(process.cwd(), "data", "billing-ledger.json");
const ALLOCATION_FILE = path.join(process.cwd(), "data", "payment-allocations.json");

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function signToken(input: { userId: string; schoolId: string; email: string; role: string }) {
  return jwt.sign(input, JWT_SECRET, { expiresIn: "1h" });
}

async function startTestServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/invoice-runs", invoiceRunsRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/api/invoice-runs`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function postUndo(
  baseUrl: string,
  runId: string,
  body: Record<string, unknown>,
  token?: string
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}/${encodeURIComponent(runId)}/undo`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

function backupFile(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
}

function restoreFile(filePath: string, raw: string) {
  if (!raw) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return;
  }
  fs.writeFileSync(filePath, raw, "utf8");
}

function invoice(partial: Partial<BillingLedgerEntry>): BillingLedgerEntry {
  return {
    id: partial.id || "inv-route-1",
    schoolId: TEST_SCHOOL,
    learnerId: partial.learnerId || "learner-1",
    accountNo: partial.accountNo || "TST001",
    type: "invoice",
    amount: partial.amount ?? 1000,
    date: partial.date || "2026-08-15",
    reference: partial.reference || "INV-ROUTE",
    description: partial.description || "Route test",
    runId: partial.runId || RUN_ID,
    invoicePeriod: partial.invoicePeriod || "2026-08",
    billedLearnerId: partial.billedLearnerId || partial.learnerId || "learner-1",
    lineKey: partial.lineKey || partial.learnerId || "learner-1",
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

async function resolveDaSilvaFinanceUser() {
  const user = await prisma.user.findFirst({
    where: { schoolId: DA_SILVA_ACADEMY_SCHOOL_ID, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, schoolId: true, email: true, role: true, isActive: true },
  });
  if (!user) throw new Error("No active Da Silva user found for undo route test");
  const meta = await getUserAccessMeta(user.id);
  const appRole = String(meta?.appRole || appRoleFromPrismaRole(user.role));
  return { user, appRole };
}

async function runRouteTests() {
  const ledgerBackup = backupFile(LEDGER_FILE);
  const allocationBackup = backupFile(ALLOCATION_FILE);
  const { baseUrl, close } = await startTestServer();

  try {
    const owner = await resolveDaSilvaFinanceUser();
    const ownerToken = signToken({
      userId: owner.user.id,
      schoolId: owner.user.schoolId,
      email: owner.user.email,
      role: owner.user.role,
    });

    // --- Auth rejection (no ledger writes) ---
    const unauth = await postUndo(baseUrl, RUN_ID, { schoolId: TEST_SCHOOL });
    assert(unauth.status === 401, `unauthenticated → 401 got ${unauth.status}`);

    const badUserToken = signToken({
      userId: "nonexistent-user-id",
      schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
      email: "missing@example.com",
      role: "SCHOOL_ADMIN",
    });
    const badUser = await postUndo(baseUrl, RUN_ID, { schoolId: TEST_SCHOOL }, badUserToken);
    assert(badUser.status === 401, `invalid user token → 401 got ${badUser.status}`);

    const mbbToken = signToken({
      userId: owner.user.id,
      schoolId: MBB_SCHOOL_ID,
      email: owner.user.email,
      role: owner.user.role,
    });
    const mbbReq = await postUndo(baseUrl, RUN_ID, { schoolId: MBB_SCHOOL_ID }, mbbToken);
    assert(mbbReq.status === 403, `JWT school != user school → 403 got ${mbbReq.status}`);

    if (["Owner", "Admin", "Finance"].includes(owner.appRole)) {
      const spoof = await postUndo(
        baseUrl,
        RUN_ID,
        { schoolId: MBB_SCHOOL_ID },
        ownerToken
      );
      assert(spoof.status === 403, `authenticated School A spoofing School B → 403 got ${spoof.status}`);
    } else {
      console.log(`⚠ Da Silva test user role is ${owner.appRole}; skipping authorized success paths`);
      return;
    }

    // --- Authorized service behaviour via HTTP ---
    writeSchoolLedger(TEST_SCHOOL, [invoice({ id: "inv-route-a", amount: 1000 })]);

    const first = await postUndo(baseUrl, RUN_ID, { schoolId: TEST_SCHOOL }, ownerToken);
    assert(first.status === 403, `cross-school run on Da Silva token → 403 got ${first.status}`);

    writeSchoolLedger(TEST_SCHOOL, [invoice({ id: "inv-route-b", amount: 1500 })]);
    const daSilvaRun = `RUN-UNDO-DS-${Date.now()}`;
    writeSchoolLedger(DA_SILVA_ACADEMY_SCHOOL_ID, [
      invoice({
        id: `inv-${daSilvaRun}`,
        schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
        runId: daSilvaRun,
        amount: 500,
        accountNo: "TST001",
        learnerId: "learner-ds",
        billedLearnerId: "learner-ds",
        lineKey: "learner-ds",
      }),
    ]);

    const ok = await postUndo(
      baseUrl,
      daSilvaRun,
      { schoolId: DA_SILVA_ACADEMY_SCHOOL_ID, expectedCount: 1, expectedTotal: 500 },
      ownerToken
    );
    assert(ok.status === 200 && ok.json.success === true, `authorized undo → 200 got ${ok.status}`);
    assert(Number(ok.json.removedCount) === 1, "removedCount === 1");

    const second = await postUndo(
      baseUrl,
      daSilvaRun,
      { schoolId: DA_SILVA_ACADEMY_SCHOOL_ID },
      ownerToken
    );
    assert(second.status === 200 && second.json.success === true, "second undo HTTP 200");
    assert(second.json.alreadyUndone === true, "second undo alreadyUndone");
    assert(Number(second.json.removedCount) === 0, "second undo removedCount 0");

    const unknown = await postUndo(
      baseUrl,
      "RUN-DOES-NOT-EXIST",
      { schoolId: DA_SILVA_ACADEMY_SCHOOL_ID },
      ownerToken
    );
    assert(unknown.status === 200 && unknown.json.alreadyUndone === true, "unknown run idempotent after auth");

    // Allocation conflict
    const allocRun = `RUN-UNDO-ALLOC-${Date.now()}`;
    const allocInvoiceId = `inv-${allocRun}`;
    writeSchoolLedger(DA_SILVA_ACADEMY_SCHOOL_ID, [
      invoice({
        id: allocInvoiceId,
        schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
        runId: allocRun,
        amount: 300,
        accountNo: "TST002",
        learnerId: "learner-alloc",
        billedLearnerId: "learner-alloc",
        lineKey: "learner-alloc",
      }),
    ]);
    const allAlloc = allocationBackup
      ? (JSON.parse(allocationBackup) as Record<string, unknown>)
      : {};
    allAlloc[DA_SILVA_ACADEMY_SCHOOL_ID] = {
      TST002: [{ invoiceId: allocInvoiceId, amount: 300 }],
    };
    fs.writeFileSync(ALLOCATION_FILE, JSON.stringify(allAlloc, null, 2), "utf8");

    const allocConflict = await postUndo(
      baseUrl,
      allocRun,
      { schoolId: DA_SILVA_ACADEMY_SCHOOL_ID },
      ownerToken
    );
    assert(allocConflict.status === 409, `allocation conflict → 409 got ${allocConflict.status}`);
    assert(allocConflict.json.errorCode === "ALLOCATION_CONFLICT", "ALLOCATION_CONFLICT code");

    // Production guard
    const prevNodeEnv = process.env.NODE_ENV;
    const prevRender = process.env.RENDER;
    process.env.NODE_ENV = "production";
    delete process.env.RENDER;
    const prodRun = `RUN-UNDO-PROD-${Date.now()}`;
    writeSchoolLedger(DA_SILVA_ACADEMY_SCHOOL_ID, [
      invoice({
        id: `inv-${prodRun}`,
        schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
        runId: prodRun,
        amount: 100,
        accountNo: "TST003",
        learnerId: "learner-prod",
        billedLearnerId: "learner-prod",
        lineKey: "learner-prod",
      }),
    ]);
    const prodBlocked = await postUndo(
      baseUrl,
      prodRun,
      { schoolId: DA_SILVA_ACADEMY_SCHOOL_ID },
      ownerToken
    );
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevRender !== undefined) process.env.RENDER = prevRender;
    assert(prodBlocked.status === 403, `production guard → 403 got ${prodBlocked.status}`);
    assert(
      prodBlocked.json.errorCode === "PRODUCTION_UNDO_BLOCKED",
      "PRODUCTION_UNDO_BLOCKED code"
    );

    console.log("✓ HTTP invoice run undo route checks passed");
  } finally {
    restoreFile(LEDGER_FILE, ledgerBackup);
    restoreFile(ALLOCATION_FILE, allocationBackup);
    await close();
  }
}

async function main() {
  await runRouteTests();
  console.log("invoiceRuns.undo.route.test.ts: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
