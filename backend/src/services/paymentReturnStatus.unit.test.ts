/**
 * Payment return status helpers (pure).
 * Run: npx tsx src/services/paymentReturnStatus.unit.test.ts
 */
import assert from "assert";

import { resolvePaymentReturnStatusView } from "./paymentReturnStatus";

function testActivated() {
  const view = resolvePaymentReturnStatusView({
    paymentFound: true,
    paymentStatus: "PAID",
    subscriptionStatus: "ACTIVE",
    rawRequest: {
      checkoutKind: "MODULAR_COMMERCIAL",
      commercialSku: "BUSINESS",
      billingCycle: "MONTHLY",
      amountCents: 125000,
      schoolId: "school-a",
      modules: { CORE: false, ACCOUNTING: true, PAYROLL: true },
      learnerLimit: null,
      periodMonths: 1,
      legacyCapacityCode: "UNLIMITED",
      itemName: "EduClear Business (Monthly)",
      createdAt: new Date().toISOString(),
    },
  });
  assert.strictEqual(view.uiState, "activated");
  assert.strictEqual(view.paymentStatus, "PAID");
  assert.strictEqual(view.activationStatus, "ACTIVE");
  assert.strictEqual(view.commercialSku, "BUSINESS");
  assert.strictEqual(view.billingCycle, "MONTHLY");
  console.log("✓ PAID + ACTIVE → activated");
}

function testPendingItn() {
  const view = resolvePaymentReturnStatusView({
    paymentFound: true,
    paymentStatus: "PENDING",
    subscriptionStatus: "PENDING_PAYMENT",
    rawRequest: {
      checkoutKind: "MODULAR_COMMERCIAL",
      commercialSku: "BUSINESS",
      billingCycle: "MONTHLY",
      amountCents: 125000,
      schoolId: "school-a",
      modules: { CORE: false, ACCOUNTING: true, PAYROLL: true },
      learnerLimit: null,
      periodMonths: 1,
      legacyCapacityCode: "UNLIMITED",
      itemName: "EduClear Business (Monthly)",
      createdAt: new Date().toISOString(),
    },
  });
  assert.strictEqual(view.uiState, "pending");
  assert.strictEqual(view.activationStatus, "PENDING");
  assert.notStrictEqual(view.uiState, "activated");
  console.log("✓ PENDING payment → pending (no false Active)");
}

function testNotFound() {
  const view = resolvePaymentReturnStatusView({
    paymentFound: false,
    paymentStatus: null,
    subscriptionStatus: null,
    rawRequest: null,
  });
  assert.strictEqual(view.uiState, "unconfirmed");
  assert.strictEqual(view.activationStatus, "NOT_FOUND");
  assert.strictEqual(view.commercialSku, null);
  console.log("✓ unknown payment → unconfirmed / NOT_FOUND");
}

function testFailedPayment() {
  const view = resolvePaymentReturnStatusView({
    paymentFound: true,
    paymentStatus: "FAILED",
    subscriptionStatus: "PENDING_PAYMENT",
    rawRequest: null,
  });
  assert.strictEqual(view.uiState, "unconfirmed");
  assert.strictEqual(view.activationStatus, "FAILED");
  console.log("✓ FAILED payment → unconfirmed");
}

function main() {
  testActivated();
  testPendingItn();
  testNotFound();
  testFailedPayment();
  console.log("\nAll paymentReturnStatus.unit.test.ts passed.");
}

main();
