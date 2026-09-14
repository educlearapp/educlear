/**
 * Phase 2B — employee + banking module field policy hardening.
 * Run: ../frontend/node_modules/.bin/tsx src/services/moduleFieldPolicy.unit.test.ts
 */
import assert from "assert";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";

import { prisma } from "../prisma";
import { STAFF_JWT_SECRET } from "../utils/staffJwt";
import { MODULE_NOT_ENTITLED, requireSchoolModule } from "../middleware/requireSchoolModule";
import {
  assertNoPayrollMutationWhenDisabled,
  CORE_EMPLOYEE_API_FIELDS,
  PAYROLL_EMPLOYEE_API_FIELDS,
  sanitizeEmployeeForModule,
} from "./employeeModuleFieldPolicy";
import {
  ACCOUNTING_BANKING_MUTATION_FIELDS,
  ACCOUNTING_BANKING_READ_FIELDS,
  assertNoAccountingBankingMutationWhenDisabled,
  bankImportTransactionTypeForModule,
  persistableBankImportAccountingFields,
  sanitizeBankTransactionForModule,
  sanitizeBankingStatsForModule,
} from "./bankingModuleFieldPolicy";

const SCHOOL = "school-policy-a";
const OWNER = "user-policy-owner";

function mockEntitlements(opts: { accounting: boolean; payroll: boolean }) {
  const rows = [
    { schoolId: SCHOOL, module: "CORE" as const, enabled: true },
    { schoolId: SCHOOL, module: "ACCOUNTING" as const, enabled: opts.accounting },
    { schoolId: SCHOOL, module: "PAYROLL" as const, enabled: opts.payroll },
  ];
  Object.assign(prisma, {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === OWNER
          ? {
              id: OWNER,
              schoolId: SCHOOL,
              email: "owner@example.com",
              role: "SCHOOL_ADMIN",
              isActive: true,
            }
          : null,
    },
    schoolModuleEntitlement: {
      findUnique: async ({
        where,
      }: {
        where: { schoolId_module: { schoolId: string; module: string } };
      }) => {
        const hit = rows.find(
          (r) =>
            r.schoolId === where.schoolId_module.schoolId &&
            r.module === where.schoolId_module.module
        );
        return hit ? { enabled: hit.enabled } : null;
      },
      findMany: async () => rows,
      createMany: async () => ({ count: 0 }),
    },
  });
}

function sign() {
  return jwt.sign(
    { userId: OWNER, schoolId: SCHOOL, role: "SCHOOL_ADMIN", email: "owner@example.com" },
    STAFF_JWT_SECRET
  );
}

async function startMiniApp() {
  const app = express();
  app.use(express.json());

  // Simulated employee handlers using the same policy helpers as routes
  app.get("/api/payroll/employees/:schoolId", async (req, res) => {
    const { isSchoolModuleEnabled } = await import("./schoolModuleEntitlements");
    const payrollOn = await isSchoolModuleEnabled(String(req.params.schoolId), "PAYROLL");
    const employee = {
      id: "e1",
      schoolId: SCHOOL,
      firstName: "Ada",
      lastName: "Lovelace",
      employeeNumber: "E001",
      isActive: true,
      basicSalary: 12000,
      taxNumber: "TAX1",
      bankAccountNumber: "123",
      jobTitle: "Teacher",
    };
    res.json([sanitizeEmployeeForModule(employee, payrollOn)]);
  });

  app.put("/api/payroll/employee/:id", async (req, res) => {
    const { isSchoolModuleEnabled } = await import("./schoolModuleEntitlements");
    const payrollOn = await isSchoolModuleEnabled(String(req.body.schoolId), "PAYROLL");
    const violation = assertNoPayrollMutationWhenDisabled(req.body, payrollOn);
    if (violation) {
      return res.status(403).json({
        code: violation.code,
        module: violation.module,
        fields: violation.fields,
        error: violation.error,
      });
    }
    return res.json(
      sanitizeEmployeeForModule(
        {
          id: req.params.id,
          schoolId: SCHOOL,
          firstName: req.body.firstName,
          lastName: req.body.lastName,
          jobTitle: req.body.jobTitle,
          basicSalary: payrollOn ? req.body.basicSalary ?? 0 : undefined,
        },
        payrollOn
      )
    );
  });

  app.post("/api/payroll/run", requireSchoolModule("PAYROLL"), (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/payroll/school/:schoolId", requireSchoolModule("PAYROLL"), (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/payroll/runs", requireSchoolModule("PAYROLL"), (_req, res) => {
    res.json({ ok: true });
  });

  app.patch("/api/banking/txn", async (req, res) => {
    const { isSchoolModuleEnabled } = await import("./schoolModuleEntitlements");
    const accountingOn = await isSchoolModuleEnabled(String(req.body.schoolId), "ACCOUNTING");
    const violation = assertNoAccountingBankingMutationWhenDisabled(req.body, accountingOn);
    if (violation) {
      return res.status(403).json({
        code: violation.code,
        module: violation.module,
        fields: violation.fields,
        error: violation.error,
      });
    }
    const row = sanitizeBankTransactionForModule(
      {
        id: "t1",
        suggestedLearnerId: req.body.suggestedLearnerId || "L1",
        reviewStatus: "accepted",
        expenseCategory: accountingOn ? req.body.expenseCategory || "Salaries" : "Utilities",
        supplierId: accountingOn ? "sup1" : "sup-hidden",
        transactionType: accountingOn ? req.body.transactionType || "payment" : "expense",
        direction: "out",
      },
      accountingOn
    );
    return res.json({ success: true, transaction: row });
  });

  app.get("/api/accounting/suppliers", requireSchoolModule("ACCOUNTING"), (_req, res) => {
    res.json({ ok: true });
  });

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
  assert.ok(CORE_EMPLOYEE_API_FIELDS.includes("employeeNumber"));
  assert.ok(CORE_EMPLOYEE_API_FIELDS.includes("isActive"));
  assert.ok(PAYROLL_EMPLOYEE_API_FIELDS.includes("basicSalary"));
  assert.ok(PAYROLL_EMPLOYEE_API_FIELDS.includes("taxNumber"));
  assert.ok(PAYROLL_EMPLOYEE_API_FIELDS.includes("bankAccountNumber"));
  assert.ok(!CORE_EMPLOYEE_API_FIELDS.includes("basicSalary" as never));
  assert.ok(ACCOUNTING_BANKING_MUTATION_FIELDS.includes("expenseCategory"));
  assert.ok(ACCOUNTING_BANKING_READ_FIELDS.includes("supplierId"));

  // Unit: sanitize / assert helpers
  const stripped = sanitizeEmployeeForModule(
    {
      id: "1",
      firstName: "A",
      lastName: "B",
      basicSalary: 99,
      taxNumber: "X",
      bankName: "FNB",
      jobTitle: "Admin",
    },
    false
  );
  assert.strictEqual(stripped.basicSalary, undefined);
  assert.strictEqual(stripped.taxNumber, undefined);
  assert.strictEqual(stripped.bankName, undefined);
  assert.strictEqual(stripped.jobTitle, "Admin");

  const payViol = assertNoPayrollMutationWhenDisabled({ firstName: "A", basicSalary: 1 }, false);
  assert.ok(payViol);
  assert.strictEqual(payViol!.code, MODULE_NOT_ENTITLED);
  assert.ok(payViol!.fields.includes("basicSalary"));

  const coreOk = assertNoPayrollMutationWhenDisabled(
    { firstName: "A", lastName: "B", jobTitle: "Teacher", isActive: true },
    false
  );
  assert.strictEqual(coreOk, null);

  const accViol = assertNoAccountingBankingMutationWhenDisabled(
    { schoolId: SCHOOL, expenseCategory: "Salaries" },
    false
  );
  assert.ok(accViol);
  assert.strictEqual(accViol!.module, "ACCOUNTING");

  const feeOk = assertNoAccountingBankingMutationWhenDisabled(
    {
      schoolId: SCHOOL,
      matchAction: "accept",
      suggestedLearnerId: "L1",
      suggestedAccountNo: "ACC1",
    },
    false
  );
  assert.strictEqual(feeOk, null);

  const expenseTypeViol = assertNoAccountingBankingMutationWhenDisabled(
    { transactionType: "expense" },
    false
  );
  assert.ok(expenseTypeViol);

  const sanitizedTxn = sanitizeBankTransactionForModule(
    {
      expenseCategory: "Utilities",
      supplierId: "s1",
      transactionType: "expense",
      direction: "out",
      suggestedLearnerId: "",
    },
    false
  );
  assert.strictEqual(sanitizedTxn.expenseCategory, "");
  assert.strictEqual(sanitizedTxn.supplierId, "");
  assert.strictEqual(sanitizedTxn.transactionType, "ignore");

  const stats = sanitizeBankingStatsForModule({ expenseCandidates: 4, matched: 2 }, false);
  assert.strictEqual(stats.expenseCandidates, 0);

  // Import persistence gate (same helpers used by banking.ts createRows)
  assert.strictEqual(bankImportTransactionTypeForModule("in", false), "payment");
  assert.strictEqual(bankImportTransactionTypeForModule("out", false), "ignore");
  assert.strictEqual(bankImportTransactionTypeForModule("out", true), "expense");
  const importStripped = persistableBankImportAccountingFields(false, {
    expenseCategory: "Utilities",
    suggestedSupplierName: "ACME",
    supplierId: "sup-1",
    suggestedInvoiceId: "inv-1",
    suggestedInvoiceNumber: "SI-9",
    invoiceMatchScore: 88,
    expenseNotes: "note",
    expenseMatchReason: "supplier hit",
  });
  assert.deepStrictEqual(importStripped, {
    expenseCategory: "",
    suggestedSupplierName: "",
    supplierId: "",
    suggestedInvoiceId: "",
    suggestedInvoiceNumber: "",
    invoiceMatchScore: 0,
    expenseNotes: "",
    expenseMatchReason: "",
  });
  const importKept = persistableBankImportAccountingFields(true, {
    expenseCategory: "Utilities",
    suggestedSupplierName: "ACME",
    supplierId: "sup-1",
    suggestedInvoiceId: "inv-1",
    suggestedInvoiceNumber: "SI-9",
    invoiceMatchScore: 88,
    expenseNotes: "note",
    expenseMatchReason: "supplier hit",
  });
  assert.strictEqual(importKept.expenseCategory, "Utilities");
  assert.strictEqual(importKept.supplierId, "sup-1");
  assert.strictEqual(importKept.invoiceMatchScore, 88);

  // HTTP matrix
  mockEntitlements({ accounting: false, payroll: false });
  const accessStore = await import("../utils/userAccessStore");
  const originalGet = accessStore.getUserAccessMeta;
  (accessStore as { getUserAccessMeta: typeof originalGet }).getUserAccessMeta = async () =>
    ({
      userId: OWNER,
      appRole: "Owner",
      permissions: { payroll: { view: true }, payments: { view: true, create: true } },
      firstName: "O",
      surname: "W",
      lastLoginAt: null,
      schoolId: SCHOOL,
    }) as Awaited<ReturnType<typeof originalGet>>;

  const server = await startMiniApp();
  try {
    const token = sign();

    const list = await fetch(`${server.base}/api/payroll/employees/${SCHOOL}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(list.status, 200);
    const employees = (await list.json()) as Array<Record<string, unknown>>;
    assert.strictEqual(employees[0].firstName, "Ada");
    assert.strictEqual(employees[0].basicSalary, undefined);
    assert.strictEqual(employees[0].taxNumber, undefined);
    assert.strictEqual(employees[0].bankAccountNumber, undefined);
    assert.strictEqual(employees[0].jobTitle, "Teacher");

    const coreUpdate = await fetch(`${server.base}/api/payroll/employee/e1`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: SCHOOL,
        firstName: "Ada",
        lastName: "Lovelace",
        jobTitle: "Lead Teacher",
      }),
    });
    assert.strictEqual(coreUpdate.status, 200);

    const salaryBlocked = await fetch(`${server.base}/api/payroll/employee/e1`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: SCHOOL,
        firstName: "Ada",
        lastName: "Lovelace",
        basicSalary: 15000,
      }),
    });
    assert.strictEqual(salaryBlocked.status, 403);
    const salaryBody = (await salaryBlocked.json()) as { code?: string; module?: string };
    assert.strictEqual(salaryBody.code, MODULE_NOT_ENTITLED);
    assert.strictEqual(salaryBody.module, "PAYROLL");

    for (const path of ["/api/payroll/run", `/api/payroll/school/${SCHOOL}`, "/api/payroll/runs"]) {
      const res = await fetch(`${server.base}${path}`, {
        method: path.includes("run") && !path.includes("runs") ? "POST" : "GET",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: path.includes("run") && !path.includes("runs") ? "{}" : undefined,
      });
      assert.strictEqual(res.status, 403, path);
    }

    const feePatch = await fetch(`${server.base}/api/banking/txn`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: SCHOOL,
        matchAction: "accept",
        suggestedLearnerId: "L9",
      }),
    });
    assert.strictEqual(feePatch.status, 200);
    const feeBody = (await feePatch.json()) as { transaction: Record<string, unknown> };
    assert.strictEqual(feeBody.transaction.expenseCategory, "");
    assert.strictEqual(feeBody.transaction.supplierId, "");

    const expensePatch = await fetch(`${server.base}/api/banking/txn`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: SCHOOL,
        expenseCategory: "Utilities",
      }),
    });
    assert.strictEqual(expensePatch.status, 403);
    const expenseBody = (await expensePatch.json()) as { code?: string; module?: string };
    assert.strictEqual(expenseBody.code, MODULE_NOT_ENTITLED);
    assert.strictEqual(expenseBody.module, "ACCOUNTING");

    const supplierPatch = await fetch(`${server.base}/api/banking/txn`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schoolId: SCHOOL, supplierId: "sup-1" }),
    });
    assert.strictEqual(supplierPatch.status, 403);

    const acc = await fetch(`${server.base}/api/accounting/suppliers?schoolId=${SCHOOL}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(acc.status, 403);

    // PAYROLL ON / ACCOUNTING ON preserves payroll + accounting mutations
    mockEntitlements({ accounting: true, payroll: true });
    const salaryOk = await fetch(`${server.base}/api/payroll/employee/e1`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: SCHOOL,
        firstName: "Ada",
        lastName: "Lovelace",
        basicSalary: 15000,
      }),
    });
    assert.strictEqual(salaryOk.status, 200);
    const salaryOkBody = (await salaryOk.json()) as { basicSalary?: number };
    assert.strictEqual(salaryOkBody.basicSalary, 15000);

    const expenseOk = await fetch(`${server.base}/api/banking/txn`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: SCHOOL,
        expenseCategory: "Utilities",
        transactionType: "expense",
      }),
    });
    assert.strictEqual(expenseOk.status, 200);
  } finally {
    (accessStore as { getUserAccessMeta: typeof originalGet }).getUserAccessMeta = originalGet;
    await server.close();
  }

  console.log("✓ moduleFieldPolicy.unit.test.ts passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
