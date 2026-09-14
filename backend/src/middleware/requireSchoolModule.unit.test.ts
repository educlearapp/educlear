/**
 * Phase 2 — requireSchoolModule middleware + Core vs Accounting/Payroll matrix.
 * Run: ../frontend/node_modules/.bin/tsx src/middleware/requireSchoolModule.unit.test.ts
 */
import assert from "assert";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { ProductModule } from "@prisma/client";

import { prisma } from "../prisma";
import { STAFF_JWT_SECRET } from "../utils/staffJwt";
import {
  evaluateAnySchoolModuleGate,
  evaluateSchoolModuleGate,
  MODULE_NOT_ENTITLED,
  requireAnySchoolModule,
  requireSchoolModule,
} from "./requireSchoolModule";
import { requireCapturePaymentAuth } from "./requireCapturePaymentAuth";
import {
  assertNoCoreBankingMutationWhenDisabled,
  bankImportTransactionTypeForModule,
  sanitizeBankTransactionForModule,
} from "../services/bankingModuleFieldPolicy";

const SCHOOL_A = "school-mod-a";
const SCHOOL_B = "school-mod-b";
const OWNER_A = "user-owner-a";
const OWNER_B = "user-owner-b";
const VIEWER_A = "user-viewer-a";

type EntRow = {
  schoolId: string;
  module: "CORE" | "ACCOUNTING" | "PAYROLL";
  enabled: boolean;
};

function mockDb(entitlements: EntRow[]) {
  const rows = entitlements.map((r) => ({ ...r }));
  const users: Record<
    string,
    { id: string; schoolId: string; email: string; role: string; isActive: boolean; fullName: string }
  > = {
    [OWNER_A]: {
      id: OWNER_A,
      schoolId: SCHOOL_A,
      email: "owner-a@example.com",
      role: "SCHOOL_ADMIN",
      isActive: true,
      fullName: "Owner A",
    },
    [OWNER_B]: {
      id: OWNER_B,
      schoolId: SCHOOL_B,
      email: "owner-b@example.com",
      role: "SCHOOL_ADMIN",
      isActive: true,
      fullName: "Owner B",
    },
    [VIEWER_A]: {
      id: VIEWER_A,
      schoolId: SCHOOL_A,
      email: "viewer-a@example.com",
      role: "STAFF",
      isActive: true,
      fullName: "Viewer A",
    },
  };

  const store = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => users[where.id] || null,
    },
    schoolModuleEntitlement: {
      findUnique: async ({
        where,
      }: {
        where: { schoolId_module: { schoolId: string; module: EntRow["module"] } };
      }) => {
        const key = where.schoolId_module;
        const hit = rows.find((r) => r.schoolId === key.schoolId && r.module === key.module);
        return hit ? { enabled: hit.enabled } : null;
      },
      findMany: async () => rows.map((r) => ({ ...r, module: r.module })),
      createMany: async () => ({ count: 0 }),
      upsert: async () => null,
    },
    userRbacMeta: {
      findUnique: async ({ where }: { where: { userId: string } }) => {
        if (where.userId === OWNER_A || where.userId === OWNER_B) {
          return {
            userId: where.userId,
            appRole: "Owner",
            permissions: {
              payments: { view: true, create: true },
              payroll: { view: true },
            },
            firstName: "Owner",
            surname: "User",
          };
        }
        if (where.userId === VIEWER_A) {
          return {
            userId: VIEWER_A,
            appRole: "Viewer",
            permissions: {
              payments: { view: false, create: false },
              payroll: { view: false },
            },
            firstName: "Viewer",
            surname: "User",
          };
        }
        return null;
      },
    },
  };

  Object.assign(prisma, store);
  // getUserAccessMeta uses prisma.userRbacMeta in many codepaths — also patch if needed via store
  return { rows, users, store };
}

function sign(userId: string, schoolId: string) {
  return jwt.sign({ userId, schoolId, role: "SCHOOL_ADMIN", email: "t@example.com" }, STAFF_JWT_SECRET);
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get("/api/accounting/suppliers", requireSchoolModule("ACCOUNTING"), (_req, res) => {
    res.json({ success: true, area: "accounting" });
  });
  app.post("/api/payroll/run", requireSchoolModule("PAYROLL"), (_req, res) => {
    res.json({ success: true, area: "payroll-run" });
  });
  app.get(
    "/api/payroll/employees/:schoolId",
    requireAnySchoolModule(["CORE", "PAYROLL"]),
    (_req, res) => {
      res.json({ success: true, area: "employees-shared" });
    }
  );
  app.get("/api/educlock/health", requireSchoolModule("CORE"), (_req, res) => {
    res.json({ success: true, area: "educlock-core" });
  });
  app.get("/api/statements", requireSchoolModule("CORE"), (_req, res) => {
    res.json({ success: true, area: "billing-core" });
  });
  app.get("/api/payments", requireSchoolModule("CORE"), requireCapturePaymentAuth, (_req, res) => {
    res.json({ success: true, area: "payments-core" });
  });
  app.get("/api/banking/stats", requireAnySchoolModule(["CORE", "ACCOUNTING"]), (_req, res) => {
    res.json({ success: true, area: "banking" });
  });
  app.get("/api/admissions/settings", requireSchoolModule("CORE"), (_req, res) => {
    res.json({ success: true, area: "admissions-core" });
  });
  app.get(
    "/api/payroll/educlock-import",
    requireSchoolModule("PAYROLL"),
    requireSchoolModule("CORE"),
    (_req, res) => {
      res.json({ success: true, area: "educlock-import" });
    }
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function main() {
  // Product modules locked — no FINANCE product gate.
  assert.ok(!Object.values(ProductModule).includes("FINANCE" as never));
  assert.deepStrictEqual(
    [ProductModule.CORE, ProductModule.ACCOUNTING, ProductModule.PAYROLL].sort(),
    ["ACCOUNTING", "CORE", "PAYROLL"]
  );

  // Core school: ACCOUNTING off, PAYROLL off
  mockDb([
    { schoolId: SCHOOL_A, module: "CORE", enabled: true },
    { schoolId: SCHOOL_A, module: "ACCOUNTING", enabled: false },
    { schoolId: SCHOOL_A, module: "PAYROLL", enabled: false },
    { schoolId: SCHOOL_B, module: "CORE", enabled: true },
    { schoolId: SCHOOL_B, module: "ACCOUNTING", enabled: true },
    { schoolId: SCHOOL_B, module: "PAYROLL", enabled: true },
  ]);

  // Missing-row fail-open for school with no PAYROLL row yet
  const missing = await evaluateSchoolModuleGate({
    authHeader: `Bearer ${sign(OWNER_B, SCHOOL_B)}`,
    module: "ACCOUNTING",
  });
  assert.strictEqual(missing.allowed, true);

  const deniedAccounting = await evaluateSchoolModuleGate({
    authHeader: `Bearer ${sign(OWNER_A, SCHOOL_A)}`,
    requestSchoolId: SCHOOL_A,
    module: "ACCOUNTING",
  });
  assert.strictEqual(deniedAccounting.allowed, false);
  if (!deniedAccounting.allowed) {
    assert.strictEqual(deniedAccounting.status, 403);
    assert.strictEqual(deniedAccounting.code, MODULE_NOT_ENTITLED);
    assert.strictEqual(deniedAccounting.module, "ACCOUNTING");
  }

  const deniedPayroll = await evaluateSchoolModuleGate({
    authHeader: `Bearer ${sign(OWNER_A, SCHOOL_A)}`,
    module: "PAYROLL",
  });
  assert.strictEqual(deniedPayroll.allowed, false);
  if (!deniedPayroll.allowed) {
    assert.strictEqual(deniedPayroll.code, MODULE_NOT_ENTITLED);
    assert.strictEqual(deniedPayroll.module, "PAYROLL");
  }

  // Isolation: school B still entitled
  const bOk = await evaluateSchoolModuleGate({
    authHeader: `Bearer ${sign(OWNER_B, SCHOOL_B)}`,
    module: "ACCOUNTING",
  });
  assert.strictEqual(bOk.allowed, true);

  // School mismatch
  const mismatch = await evaluateSchoolModuleGate({
    authHeader: `Bearer ${sign(OWNER_A, SCHOOL_A)}`,
    requestSchoolId: SCHOOL_B,
    module: "ACCOUNTING",
  });
  assert.strictEqual(mismatch.allowed, false);
  if (!mismatch.allowed) assert.strictEqual(mismatch.code, "SCHOOL_MISMATCH");

  // Missing entitlement row → fail-open enabled
  mockDb([
    { schoolId: SCHOOL_A, module: "CORE", enabled: true },
    // ACCOUNTING row intentionally missing
  ]);
  const failOpen = await evaluateSchoolModuleGate({
    authHeader: `Bearer ${sign(OWNER_A, SCHOOL_A)}`,
    module: "ACCOUNTING",
  });
  assert.strictEqual(failOpen.allowed, true);

  // Restore Core school matrix for HTTP tests
  mockDb([
    { schoolId: SCHOOL_A, module: "CORE", enabled: true },
    { schoolId: SCHOOL_A, module: "ACCOUNTING", enabled: false },
    { schoolId: SCHOOL_A, module: "PAYROLL", enabled: false },
    { schoolId: SCHOOL_B, module: "CORE", enabled: true },
    { schoolId: SCHOOL_B, module: "ACCOUNTING", enabled: true },
    { schoolId: SCHOOL_B, module: "PAYROLL", enabled: true },
  ]);

  // Patch getUserAccessMeta path used by requireCapturePaymentAuth / loadStaffSchoolAuth
  const accessStore = await import("../utils/userAccessStore");
  const originalGet = accessStore.getUserAccessMeta;
  (accessStore as { getUserAccessMeta: typeof originalGet }).getUserAccessMeta = async (
    userId: string
  ) => {
    if (userId === OWNER_A || userId === OWNER_B) {
      return {
        userId,
        appRole: "Owner",
        permissions: {
          payments: { view: true, create: true },
          payroll: { view: true },
        },
        firstName: "Owner",
        surname: "User",
        lastLoginAt: null,
      } as Awaited<ReturnType<typeof originalGet>>;
    }
    if (userId === VIEWER_A) {
      return {
        userId,
        appRole: "Viewer",
        permissions: {
          payments: { view: false, create: false },
          payroll: { view: false },
        },
        firstName: "Viewer",
        surname: "User",
        lastLoginAt: null,
      } as Awaited<ReturnType<typeof originalGet>>;
    }
    return null;
  };

  const server = await startServer();
  try {
    const tokenA = sign(OWNER_A, SCHOOL_A);
    const tokenB = sign(OWNER_B, SCHOOL_B);
    const tokenViewer = sign(VIEWER_A, SCHOOL_A);

    // Core school cannot hit Accounting / Payroll-run
    const accOff = await fetch(`${server.base}/api/accounting/suppliers?schoolId=${SCHOOL_A}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(accOff.status, 403);
    const accBody = (await accOff.json()) as { code?: string; module?: string };
    assert.strictEqual(accBody.code, MODULE_NOT_ENTITLED);
    assert.strictEqual(accBody.module, "ACCOUNTING");

    const payOff = await fetch(`${server.base}/api/payroll/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}`, "Content-Type": "application/json" },
      body: JSON.stringify({ schoolId: SCHOOL_A }),
    });
    assert.strictEqual(payOff.status, 403);
    const payBody = (await payOff.json()) as { code?: string; module?: string };
    assert.strictEqual(payBody.code, MODULE_NOT_ENTITLED);
    assert.strictEqual(payBody.module, "PAYROLL");

    // Core retains Billing, banking (CORE), employees (C||P), EduClock, Admissions
    for (const path of [
      "/api/statements",
      `/api/payroll/employees/${SCHOOL_A}`,
      "/api/educlock/health",
      "/api/banking/stats",
      "/api/admissions/settings",
    ]) {
      const res = await fetch(`${server.base}${path}`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      assert.strictEqual(res.status, 200, path);
    }

    // Payments still subject to RBAC even when Billing is Core
    const payRbac = await fetch(`${server.base}/api/payments?schoolId=${SCHOOL_A}`, {
      headers: { Authorization: `Bearer ${tokenViewer}` },
    });
    assert.strictEqual(payRbac.status, 403);

    const payOwner = await fetch(`${server.base}/api/payments?schoolId=${SCHOOL_A}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(payOwner.status, 200);

    // Full school B preserves Accounting + Payroll access
    const accOn = await fetch(`${server.base}/api/accounting/suppliers?schoolId=${SCHOOL_B}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.strictEqual(accOn.status, 200);

    const payOn = await fetch(`${server.base}/api/payroll/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenB}`, "Content-Type": "application/json" },
      body: JSON.stringify({ schoolId: SCHOOL_B }),
    });
    assert.strictEqual(payOn.status, 200);

    // Unauthenticated module gate
    const unauth = await fetch(`${server.base}/api/accounting/suppliers?schoolId=${SCHOOL_A}`);
    assert.strictEqual(unauth.status, 401);
  } finally {
    (accessStore as { getUserAccessMeta: typeof originalGet }).getUserAccessMeta = originalGet;
    await server.close();
  }

  // --- Phase 5B: CORE gate + combinations ---
  mockDb([
    { schoolId: SCHOOL_A, module: "CORE", enabled: false },
    { schoolId: SCHOOL_A, module: "ACCOUNTING", enabled: true },
    { schoolId: SCHOOL_A, module: "PAYROLL", enabled: false },
  ]);
  const coreOff = await evaluateSchoolModuleGate({
    authHeader: `Bearer ${sign(OWNER_A, SCHOOL_A)}`,
    requestSchoolId: SCHOOL_A,
    module: "CORE",
  });
  assert.strictEqual(coreOff.allowed, false);
  if (!coreOff.allowed) {
    assert.strictEqual(coreOff.code, MODULE_NOT_ENTITLED);
    assert.strictEqual(coreOff.module, "CORE");
  }
  const accOnlyOk = await evaluateSchoolModuleGate({
    authHeader: `Bearer ${sign(OWNER_A, SCHOOL_A)}`,
    module: "ACCOUNTING",
  });
  assert.strictEqual(accOnlyOk.allowed, true);

  const bankingAccOnly = await evaluateAnySchoolModuleGate({
    authHeader: `Bearer ${sign(OWNER_A, SCHOOL_A)}`,
    modules: ["CORE", "ACCOUNTING"],
  });
  assert.strictEqual(bankingAccOnly.allowed, true);

  const employeesAccOnly = await evaluateAnySchoolModuleGate({
    authHeader: `Bearer ${sign(OWNER_A, SCHOOL_A)}`,
    modules: ["CORE", "PAYROLL"],
  });
  assert.strictEqual(employeesAccOnly.allowed, false);

  mockDb([
    { schoolId: SCHOOL_A, module: "CORE", enabled: false },
    { schoolId: SCHOOL_A, module: "ACCOUNTING", enabled: false },
    { schoolId: SCHOOL_A, module: "PAYROLL", enabled: true },
  ]);
  const payrollOnlyEmp = await evaluateAnySchoolModuleGate({
    authHeader: `Bearer ${sign(OWNER_A, SCHOOL_A)}`,
    modules: ["CORE", "PAYROLL"],
  });
  assert.strictEqual(payrollOnlyEmp.allowed, true);
  const payrollOnlyBanking = await evaluateAnySchoolModuleGate({
    authHeader: `Bearer ${sign(OWNER_A, SCHOOL_A)}`,
    modules: ["CORE", "ACCOUNTING"],
  });
  assert.strictEqual(payrollOnlyBanking.allowed, false);

  // Banking matrix helpers
  assert.strictEqual(
    bankImportTransactionTypeForModule("in", { coreEnabled: false, accountingEnabled: true }),
    "ignore"
  );
  assert.strictEqual(
    bankImportTransactionTypeForModule("out", { coreEnabled: false, accountingEnabled: true }),
    "expense"
  );
  assert.strictEqual(
    bankImportTransactionTypeForModule("in", { coreEnabled: true, accountingEnabled: false }),
    "payment"
  );
  const coreFeeBlocked = assertNoCoreBankingMutationWhenDisabled(
    { suggestedLearnerId: "learner-1", matchAction: "accept" },
    false
  );
  assert.ok(coreFeeBlocked);
  assert.strictEqual(coreFeeBlocked?.module, "CORE");
  const sanitizedAccOnly = sanitizeBankTransactionForModule(
    {
      suggestedLearnerId: "L1",
      suggestedLearnerName: "Kid",
      transactionType: "payment",
      expenseCategory: "Utilities",
    },
    true,
    false
  );
  assert.strictEqual(sanitizedAccOnly.suggestedLearnerId, "");
  assert.strictEqual(sanitizedAccOnly.transactionType, "ignore");
  assert.strictEqual(sanitizedAccOnly.expenseCategory, "Utilities");

  // HTTP: Accounting-only school
  mockDb([
    { schoolId: SCHOOL_A, module: "CORE", enabled: false },
    { schoolId: SCHOOL_A, module: "ACCOUNTING", enabled: true },
    { schoolId: SCHOOL_A, module: "PAYROLL", enabled: false },
    { schoolId: SCHOOL_B, module: "CORE", enabled: true },
    { schoolId: SCHOOL_B, module: "ACCOUNTING", enabled: true },
    { schoolId: SCHOOL_B, module: "PAYROLL", enabled: true },
  ]);
  const accessStore2 = await import("../utils/userAccessStore");
  const originalGet2 = accessStore2.getUserAccessMeta;
  (accessStore2 as { getUserAccessMeta: typeof originalGet2 }).getUserAccessMeta = async (
    userId: string
  ) => {
    if (userId === OWNER_A || userId === OWNER_B) {
      return {
        userId,
        appRole: "Owner",
        permissions: {
          payments: { view: true, create: true },
          payroll: { view: true },
        },
        firstName: "Owner",
        surname: "User",
        lastLoginAt: null,
      } as Awaited<ReturnType<typeof originalGet2>>;
    }
    return null;
  };
  const server2 = await startServer();
  try {
    const tokenA = sign(OWNER_A, SCHOOL_A);
    const statementsOff = await fetch(`${server2.base}/api/statements`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(statementsOff.status, 403);
    const stmtBody = (await statementsOff.json()) as { code?: string; module?: string };
    assert.strictEqual(stmtBody.code, MODULE_NOT_ENTITLED);
    assert.strictEqual(stmtBody.module, "CORE");

    const educlockOff = await fetch(`${server2.base}/api/educlock/health`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(educlockOff.status, 403);

    const empOff = await fetch(`${server2.base}/api/payroll/employees/${SCHOOL_A}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(empOff.status, 403);

    const accOn = await fetch(`${server2.base}/api/accounting/suppliers?schoolId=${SCHOOL_A}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(accOn.status, 200);

    const bankOn = await fetch(`${server2.base}/api/banking/stats`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(bankOn.status, 200);

    const importOff = await fetch(`${server2.base}/api/payroll/educlock-import`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(importOff.status, 403);
  } finally {
    (accessStore2 as { getUserAccessMeta: typeof originalGet2 }).getUserAccessMeta = originalGet2;
    await server2.close();
  }

  console.log("✓ requireSchoolModule.unit.test.ts passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
