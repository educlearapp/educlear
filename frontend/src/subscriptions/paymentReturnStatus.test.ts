/**
 * PayFast return-page UI helpers.
 * Run: npx tsx src/subscriptions/paymentReturnStatus.test.ts
 */
import assert from "assert";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  paymentReturnCopy,
  resolveReturnUiState,
} from "./paymentReturnStatus";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function testActivatedCopy() {
  const state = resolveReturnUiState({
    uiState: "activated",
    paymentStatus: "PAID",
    activationStatus: "ACTIVE",
    commercialSku: "BUSINESS",
  });
  assert.strictEqual(state, "activated");
  const copy = paymentReturnCopy(state);
  assert.strictEqual(copy.title, "Payment Successful");
  assert.match(copy.body, /subscription is now active/i);
  assert.ok(!/confirming/i.test(copy.body));
  console.log("✓ PAID + activation complete → Payment Successful / active");
}

function testPendingCopy() {
  const state = resolveReturnUiState({
    uiState: "pending",
    paymentStatus: "PENDING",
    activationStatus: "PENDING",
  });
  assert.strictEqual(state, "pending");
  const copy = paymentReturnCopy(state);
  assert.strictEqual(copy.title, "Payment received");
  assert.match(copy.body, /confirming your EduClear subscription/i);
  assert.ok(!/now active/i.test(copy.body));
  console.log("✓ ITN pending → Payment received / confirming (no false Active)");
}

function testUnconfirmedCopy() {
  const state = resolveReturnUiState({
    uiState: "unconfirmed",
    activationStatus: "NOT_FOUND",
  });
  assert.strictEqual(state, "unconfirmed");
  const copy = paymentReturnCopy(state);
  assert.match(copy.title, /still confirming/i);
  assert.match(copy.body, /Do not pay again/i);
  assert.ok(copy.showContactCta);
  console.log("✓ unknown/unconfirmed → safe message, never auto re-pay");
}

function testSuccessPageNoLongerAssumesActive() {
  const src = readFileSync(path.join(__dirname, "../pages/BillingPaymentSuccess.tsx"), "utf8");
  assert.ok(src.includes("fetchPaymentReturnStatus"));
  assert.ok(src.includes("resolveReturnUiState"));
  assert.ok(src.includes("payment-return-"));
  assert.ok(src.includes("We're confirming your EduClear subscription"));
  // Must not render only the hard-coded active success block.
  assert.ok(src.includes("paymentReturnCopy"));
  assert.ok(src.includes("showDashboardCta"));
  console.log("✓ BillingPaymentSuccess verifies backend status (no blind success)");
}

function main() {
  testActivatedCopy();
  testPendingCopy();
  testUnconfirmedCopy();
  testSuccessPageNoLongerAssumesActive();
  console.log("\nAll paymentReturnStatus frontend tests passed.");
}

main();
