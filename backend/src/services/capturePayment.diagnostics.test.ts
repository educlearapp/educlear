/**
 * Capture Payment stage timings are log-only: identical results, idempotency and allocations
 * with or without diagnostics. Isolated temp ledger only (no production writes).
 * Run: node --import tsx src/services/capturePayment.diagnostics.test.ts
 */
import fs from "fs";
import os from "os";
import path from "path";
import assert from "node:assert/strict";

import {
  captureManualPayment,
  setCapturePaymentFamilyResolverForTests,
  type CapturePaymentDiagnostics,
} from "./capturePaymentService";
import { evaluateCapturePaymentFamily } from "./resolveCapturePaymentFamilyAccount";
import {
  listPayments,
  setBillingLedgerStoreDataDirForTests,
  writeSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import { setFamilyAccountAgeAnalysisStoreDataDirForTests } from "../utils/familyAccountAgeAnalysisStore";
import {
  listPaymentAllocations,
  setPaymentAllocationStoreDataDirForTests,
} from "../utils/paymentAllocationStore";

const SCHOOL = "school-test-capture-diagnostics";
const FAMILY = {
  id: "fa-diag",
  schoolId: SCHOOL,
  accountRef: "DIAG001",
  familyName: "Diag",
  learnerCount: 1,
};

function invoice(amount: number, id: string): BillingLedgerEntry {
  return {
    id,
    schoolId: SCHOOL,
    learnerId: "",
    accountNo: FAMILY.accountRef,
    type: "invoice",
    amount,
    date: "2026-01-15",
    reference: `INV-${id}`,
    description: "Tuition",
    source: "manual",
    createdAt: "2026-01-15T08:00:00.000Z",
  };
}

async function withIsolatedStores<T>(fn: () => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capture-diag-"));
  fs.writeFileSync(path.join(dir, "billing-ledger.json"), "{}", "utf8");
  fs.writeFileSync(path.join(dir, "payment-allocations.json"), "{}", "utf8");
  fs.writeFileSync(path.join(dir, "family-account-age-analysis.json"), "{}", "utf8");
  setBillingLedgerStoreDataDirForTests(dir);
  setPaymentAllocationStoreDataDirForTests(dir);
  setFamilyAccountAgeAnalysisStoreDataDirForTests(dir);
  setCapturePaymentFamilyResolverForTests(async (input) =>
    evaluateCapturePaymentFamily({ family: FAMILY, authorizedSchoolId: input.authorizedSchoolId })
  );
  try {
    return await fn();
  } finally {
    setCapturePaymentFamilyResolverForTests(null);
    setBillingLedgerStoreDataDirForTests(null);
    setPaymentAllocationStoreDataDirForTests(null);
    setFamilyAccountAgeAnalysisStoreDataDirForTests(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function capture(overrides: Record<string, unknown> = {}) {
  return {
    authorizedSchoolId: SCHOOL,
    familyAccountId: FAMILY.id,
    amount: 750,
    date: "2026-10-12",
    method: "EFT",
    description: "School fees",
    bankReference: "BANK-REF-DIAG",
    idempotencyKey: "k-diag-1",
    capturedByUserId: "user-1",
    capturedByEmail: "finance@example.test",
    capturedByName: "Finance",
    allocationLines: [
      { invoiceId: "inv-a", allocatedAmount: 150 },
      { invoiceId: "inv-b", allocatedAmount: 600 },
    ],
    ...overrides,
  };
}

function comparable(result: Awaited<ReturnType<typeof captureManualPayment>>) {
  return {
    success: result.success,
    duplicate: result.duplicate,
    allocationSaved: result.allocationSaved,
    allocationError: result.allocationError,
    amount: result.payment.amount,
    accountNo: result.payment.accountNo,
    balance: result.balance,
    openInvoices: result.openInvoices,
    familyAccountId: result.familyAccountId,
  };
}

async function main() {
  const originalError = console.error;
  console.error = () => {};
  try {
    const withDiagnostics = await withIsolatedStores(async () => {
      writeSchoolLedger(SCHOOL, [invoice(400, "inv-a"), invoice(600, "inv-b")]);
      const diagnostics: CapturePaymentDiagnostics = { stages: {} };
      const first = await captureManualPayment(capture(), diagnostics);
      const replay = await captureManualPayment(capture(), { stages: {} });
      const payments = listPayments(SCHOOL);
      const allocations = listPaymentAllocations(SCHOOL, String(first.payment.id));
      return { first, replay, diagnostics, paymentCount: payments.length, allocationCount: allocations.length };
    });

    const withoutDiagnostics = await withIsolatedStores(async () => {
      writeSchoolLedger(SCHOOL, [invoice(400, "inv-a"), invoice(600, "inv-b")]);
      const first = await captureManualPayment(capture());
      const allocations = listPaymentAllocations(SCHOOL, String(first.payment.id));
      return { first, paymentCount: listPayments(SCHOOL).length, allocationCount: allocations.length };
    });

    assert.deepEqual(
      comparable(withDiagnostics.first),
      comparable(withoutDiagnostics.first),
      "identical payment result with and without diagnostics"
    );
    assert.equal(withDiagnostics.first.balance, 250, "balance unchanged by diagnostics");
    assert.equal(withDiagnostics.allocationCount, 2);
    assert.equal(withoutDiagnostics.allocationCount, 2);
    console.log("  ✓ result, balance and allocations identical with/without stage timings");

    assert.equal(withDiagnostics.replay.duplicate, true, "idempotent replay still detected");
    assert.equal(withDiagnostics.replay.payment.id, withDiagnostics.first.payment.id);
    assert.equal(withDiagnostics.paymentCount, 1, "replay does not create a second payment");
    console.log("  ✓ idempotency key replay → same payment, no duplicate");

    const stages = withDiagnostics.diagnostics.stages;
    for (const key of ["validateMs", "familyResolveMs", "familyGuardMs", "ledgerWriteMs", "allocationWriteMs"]) {
      assert.equal(typeof stages[key], "number", `stage ${key} recorded`);
      assert.ok(stages[key] >= 0);
    }
    assert.ok(
      typeof stages.accountResponseMs === "number" || typeof stages.fallbackResponseMs === "number",
      "response-generation stage recorded"
    );
    const serialised = JSON.stringify(stages);
    for (const needle of ["750", "BANK-REF-DIAG", "finance@example.test", "School fees", "DIAG001"]) {
      assert.ok(!serialised.includes(needle), `stage timings must not contain ${needle}`);
    }
    console.log("  ✓ stage timings recorded (validate, family, ledger, allocation, relink/response) with no payment data");
  } finally {
    console.error = originalError;
  }
  console.log("capturePayment.diagnostics.test.ts: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
