/**
 * Invoice batch save response validation tests.
 * Run: npx tsx src/billing/invoiceBatchSave.test.ts
 */
import { assertInvoiceBatchSaveSucceeded } from "./invoiceBatchSave";

function assertThrows(fn: () => void, includes: string) {
  try {
    fn();
    throw new Error("expected throw");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(includes)) {
      throw new Error(`expected "${includes}" in "${message}"`);
    }
  }
}

function testSuccessWhenCreated() {
  assertInvoiceBatchSaveSucceeded({ success: true, createdCount: 2, invoices: [{}, {}] });
  console.log("✓ assertInvoiceBatchSaveSucceeded accepts createdCount > 0");
}

function testFailsWhenCreatedCountZero() {
  assertThrows(
    () =>
      assertInvoiceBatchSaveSucceeded({
        success: true,
        createdCount: 0,
        skipped: [{ reason: "Could not resolve account" }],
      }),
    "Could not resolve account"
  );
  console.log("✓ assertInvoiceBatchSaveSucceeded rejects createdCount === 0");
}

function testFailsOnExplicitSuccessFalse() {
  assertThrows(
    () => assertInvoiceBatchSaveSucceeded({ success: false, error: "Learner and account do not match" }),
    "Learner and account do not match"
  );
  console.log("✓ assertInvoiceBatchSaveSucceeded surfaces server error");
}

function main() {
  testSuccessWhenCreated();
  testFailsWhenCreatedCountZero();
  testFailsOnExplicitSuccessFalse();
  console.log("\nAll invoiceBatchSave tests passed.");
}

main();
