/**
 * Phase 2C — banking tenant isolation + ACCOUNTING-off import persistence.
 * Run: ../frontend/node_modules/.bin/tsx src/middleware/requireBankingAuth.unit.test.ts
 */
import assert from "assert";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";

import { prisma } from "../prisma";
import { STAFF_JWT_SECRET } from "../utils/staffJwt";
import {
  authorizedBankingSchoolId,
  requireBankingAuth,
  type BankingAuthRequest,
} from "./requireBankingAuth";
import { MODULE_NOT_ENTITLED } from "./requireSchoolModule";
import {
  assertNoAccountingBankingMutationWhenDisabled,
  bankImportTransactionTypeForModule,
  persistableBankImportAccountingFields,
} from "../services/bankingModuleFieldPolicy";

const SCHOOL_A = "bank-school-a";
const SCHOOL_B = "bank-school-b";
const OWNER_A = "bank-owner-a";
const OWNER_B = "bank-owner-b";
const VIEWER_A = "bank-viewer-a";

function mockUsers() {
  const entitlements = [
    { schoolId: SCHOOL_A, module: "CORE", enabled: true },
    { schoolId: SCHOOL_A, module: "ACCOUNTING", enabled: false },
    { schoolId: SCHOOL_A, module: "PAYROLL", enabled: false },
    { schoolId: SCHOOL_B, module: "CORE", enabled: true },
    { schoolId: SCHOOL_B, module: "ACCOUNTING", enabled: true },
    { schoolId: SCHOOL_B, module: "PAYROLL", enabled: true },
  ];
  const users: Record<string, any> = {
    [OWNER_A]: {
      id: OWNER_A,
      schoolId: SCHOOL_A,
      email: "a@example.com",
      role: "SCHOOL_ADMIN",
      isActive: true,
      fullName: "Owner A",
    },
    [OWNER_B]: {
      id: OWNER_B,
      schoolId: SCHOOL_B,
      email: "b@example.com",
      role: "SCHOOL_ADMIN",
      isActive: true,
      fullName: "Owner B",
    },
    [VIEWER_A]: {
      id: VIEWER_A,
      schoolId: SCHOOL_A,
      email: "v@example.com",
      role: "STAFF",
      isActive: true,
      fullName: "Viewer A",
    },
  };

  Object.assign(prisma, {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => users[where.id] || null,
    },
    schoolModuleEntitlement: {
      findUnique: async ({
        where,
      }: {
        where: { schoolId_module: { schoolId: string; module: string } };
      }) => {
        const hit = entitlements.find(
          (r) =>
            r.schoolId === where.schoolId_module.schoolId &&
            r.module === where.schoolId_module.module
        );
        return hit ? { enabled: hit.enabled } : null;
      },
      findMany: async () => entitlements,
      createMany: async () => ({ count: 0 }),
    },
    userRbacMeta: {
      findUnique: async ({ where }: { where: { userId: string } }) => {
        if (where.userId === OWNER_A || where.userId === OWNER_B) {
          return {
            userId: where.userId,
            appRole: "Owner",
            permissions: { payments: { view: true, create: true } },
            firstName: "Owner",
            surname: "User",
          };
        }
        if (where.userId === VIEWER_A) {
          return {
            userId: VIEWER_A,
            appRole: "Viewer",
            permissions: { payments: { view: false, create: false } },
            firstName: "Viewer",
            surname: "User",
          };
        }
        return null;
      },
    },
  });
}

function sign(userId: string, schoolId: string) {
  return jwt.sign({ userId, schoolId, role: "SCHOOL_ADMIN", email: "t@x.com" }, STAFF_JWT_SECRET);
}

/** Build create-row shape using the same helpers as banking.ts POST /import. */
function buildImportPersistRow(input: {
  accountingEnabled: boolean;
  direction: "in" | "out";
  inferredExpenseCategory: string;
  inferredSupplierId: string;
}) {
  const accountingEnabled = input.accountingEnabled;
  const direction = input.direction;
  const accountingPersist = persistableBankImportAccountingFields(accountingEnabled, {
    expenseCategory: input.inferredExpenseCategory,
    suggestedSupplierName: "ACME",
    supplierId: input.inferredSupplierId,
    suggestedInvoiceId: "inv1",
    suggestedInvoiceNumber: "SI-1",
    invoiceMatchScore: 80,
    expenseNotes: "note",
    expenseMatchReason: "matched supplier",
  });
  return {
    transactionType: bankImportTransactionTypeForModule(direction, accountingEnabled),
    expenseCategory: accountingPersist.expenseCategory,
    supplierId: accountingPersist.supplierId,
    suggestedSupplierName: accountingPersist.suggestedSupplierName,
    suggestedInvoiceId: accountingPersist.suggestedInvoiceId,
    suggestedInvoiceNumber: accountingPersist.suggestedInvoiceNumber,
    invoiceMatchScore: accountingPersist.invoiceMatchScore,
    expenseNotes: accountingPersist.expenseNotes,
    suggestedLearnerId: direction === "in" ? "learner-1" : "",
    suggestedAccountNo: direction === "in" ? "ACC-1" : "",
    confidenceScore: direction === "in" ? 90 : 0,
  };
}

async function main() {
  mockUsers();

  // Persistence unit proof (mirrors banking.ts POST /import createRows gating)
  const offOut = buildImportPersistRow({
    accountingEnabled: false,
    direction: "out",
    inferredExpenseCategory: "Utilities",
    inferredSupplierId: "sup-1",
  });
  assert.strictEqual(offOut.transactionType, "ignore");
  assert.strictEqual(offOut.expenseCategory, "");
  assert.strictEqual(offOut.supplierId, "");
  assert.strictEqual(offOut.suggestedInvoiceId, "");
  assert.strictEqual(offOut.invoiceMatchScore, 0);

  const offIn = buildImportPersistRow({
    accountingEnabled: false,
    direction: "in",
    inferredExpenseCategory: "Utilities",
    inferredSupplierId: "sup-1",
  });
  assert.strictEqual(offIn.transactionType, "payment");
  assert.strictEqual(offIn.suggestedLearnerId, "learner-1");
  assert.strictEqual(offIn.expenseCategory, "");

  const onOut = buildImportPersistRow({
    accountingEnabled: true,
    direction: "out",
    inferredExpenseCategory: "Utilities",
    inferredSupplierId: "sup-1",
  });
  assert.strictEqual(onOut.transactionType, "expense");
  assert.strictEqual(onOut.expenseCategory, "Utilities");
  assert.strictEqual(onOut.supplierId, "sup-1");

  const app = express();
  app.use(express.json());
  app.use("/api/banking", requireBankingAuth);

  const store = {
    imports: new Map<string, { schoolId: string; id: string }>(),
  };

  app.get("/api/banking/imports", (req: BankingAuthRequest, res) => {
    const schoolId = authorizedBankingSchoolId(req);
    const rows = [...store.imports.values()].filter((r) => r.schoolId === schoolId);
    res.json({ success: true, imports: rows, schoolId });
  });

  app.get("/api/banking/transactions", (req: BankingAuthRequest, res) => {
    res.json({ success: true, schoolId: authorizedBankingSchoolId(req), transactions: [] });
  });

  app.patch("/api/banking/imports/:id/transaction/:tid", (req: BankingAuthRequest, res) => {
    const schoolId = authorizedBankingSchoolId(req);
    const accountingOn = schoolId === SCHOOL_B;
    const violation = assertNoAccountingBankingMutationWhenDisabled(req.body || {}, accountingOn);
    if (violation) {
      return res.status(403).json({
        success: false,
        code: violation.code,
        module: violation.module,
        fields: violation.fields,
      });
    }
    const imp = store.imports.get(String(req.params.id));
    if (!imp || imp.schoolId !== schoolId) {
      return res.status(404).json({ success: false, error: "Import not found" });
    }
    res.json({ success: true, schoolId });
  });

  app.post("/api/banking/imports/:id/post-payments", (req: BankingAuthRequest, res) => {
    const schoolId = authorizedBankingSchoolId(req);
    const imp = store.imports.get(String(req.params.id));
    if (!imp || imp.schoolId !== schoolId) {
      return res.status(404).json({ success: false, error: "Import not found" });
    }
    res.json({ success: true, postedCount: 1, schoolId });
  });

  store.imports.set("imp-a", { id: "imp-a", schoolId: SCHOOL_A });
  store.imports.set("imp-b", { id: "imp-b", schoolId: SCHOOL_B });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api/banking`;

  try {
    const tokenA = sign(OWNER_A, SCHOOL_A);
    const tokenB = sign(OWNER_B, SCHOOL_B);
    const tokenViewer = sign(VIEWER_A, SCHOOL_A);

    // Unauthenticated rejected
    const unauth = await fetch(`${base}/imports?schoolId=${SCHOOL_A}`);
    assert.strictEqual(unauth.status, 401);

    // RBAC: viewer denied
    const viewerDenied = await fetch(`${base}/imports?schoolId=${SCHOOL_A}`, {
      headers: { Authorization: `Bearer ${tokenViewer}` },
    });
    assert.strictEqual(viewerDenied.status, 403);

    // Same-school owner OK
    const okA = await fetch(`${base}/imports?schoolId=${SCHOOL_A}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(okA.status, 200);
    const okABody = (await okA.json()) as { schoolId: string; imports: Array<{ id: string }> };
    assert.strictEqual(okABody.schoolId, SCHOOL_A);
    assert.ok(okABody.imports.every((r) => r.id === "imp-a"));

    // Cross-school list spoof: JWT A + schoolId B → SCHOOL_MISMATCH
    const spoof = await fetch(`${base}/imports?schoolId=${SCHOOL_B}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(spoof.status, 403);
    const spoofBody = (await spoof.json()) as { code?: string };
    assert.strictEqual(spoofBody.code, "SCHOOL_MISMATCH");

    // Cross-school PATCH: A cannot mutate B import
    const patchCross = await fetch(`${base}/imports/imp-b/transaction/t1`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokenA}`, "Content-Type": "application/json" },
      body: JSON.stringify({ schoolId: SCHOOL_A, matchAction: "accept" }),
    });
    // Auth binds to A; imp-b belongs to B → 404 for A
    assert.strictEqual(patchCross.status, 404);

    // Cross-school post-payments
    const postCross = await fetch(`${base}/imports/imp-b/post-payments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}`, "Content-Type": "application/json" },
      body: JSON.stringify({ schoolId: SCHOOL_A }),
    });
    assert.strictEqual(postCross.status, 404);

    // Same-school post OK
    const postOk = await fetch(`${base}/imports/imp-a/post-payments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}`, "Content-Type": "application/json" },
      body: JSON.stringify({ schoolId: SCHOOL_A }),
    });
    assert.strictEqual(postOk.status, 200);

    // ACCOUNTING off: expense PATCH 403
    const expensePatch = await fetch(`${base}/imports/imp-a/transaction/t1`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokenA}`, "Content-Type": "application/json" },
      body: JSON.stringify({ schoolId: SCHOOL_A, expenseCategory: "Utilities" }),
    });
    assert.strictEqual(expensePatch.status, 403);
    const expenseBody = (await expensePatch.json()) as { code?: string; module?: string };
    assert.strictEqual(expenseBody.code, MODULE_NOT_ENTITLED);
    assert.strictEqual(expenseBody.module, "ACCOUNTING");

    // Fee match PATCH OK on Core school
    const feePatch = await fetch(`${base}/imports/imp-a/transaction/t1`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokenA}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: SCHOOL_A,
        matchAction: "accept",
        suggestedLearnerId: "L1",
      }),
    });
    assert.strictEqual(feePatch.status, 200);

    // ACCOUNTING on school can set expense
    const expenseOn = await fetch(`${base}/imports/imp-b/transaction/t1`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokenB}`, "Content-Type": "application/json" },
      body: JSON.stringify({ schoolId: SCHOOL_B, expenseCategory: "Utilities" }),
    });
    assert.strictEqual(expenseOn.status, 200);

    // B cannot read A's imports
    const bReadsA = await fetch(`${base}/imports?schoolId=${SCHOOL_A}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.strictEqual(bReadsA.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }

  console.log("✓ requireBankingAuth.unit.test.ts passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
