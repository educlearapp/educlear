/**
 * Manual invoice line duplicate helpers (sibling-safe catalog fees).
 * Run: npx tsx src/billing/invoiceCreateDuplicate.test.ts
 */

type InvoiceDetailLine = {
  id: string;
  feeId?: string;
  learnerId?: string;
  lineKey?: string;
};

function catalogFeeLineKey(line: InvoiceDetailLine): string {
  const feeId = String(line.feeId || "").trim();
  if (!feeId) return "";
  const learnerId = String(line.learnerId || "").trim();
  const lineKey = String(line.lineKey || line.id || "").trim();
  return `${feeId}|${learnerId || lineKey}`;
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function testFamilyAllowsSameFeeTwice() {
  const lineA: InvoiceDetailLine = {
    id: "line-a",
    lineKey: "line-a",
    feeId: "fee-tuition",
    learnerId: "learner-a",
  };
  const lineB: InvoiceDetailLine = {
    id: "line-b",
    lineKey: "line-b",
    feeId: "fee-tuition",
    learnerId: "learner-b",
  };
  assert(
    catalogFeeLineKey(lineA) !== catalogFeeLineKey(lineB),
    "sibling lines with same catalog fee should not share dedupe key"
  );
  console.log("✓ family account: same catalog fee for two siblings uses distinct keys");
}

function testSameLearnerSameFeeBlocked() {
  const lineA: InvoiceDetailLine = {
    id: "line-a",
    lineKey: "line-a",
    feeId: "fee-tuition",
    learnerId: "learner-a",
  };
  const lineB: InvoiceDetailLine = {
    id: "line-b",
    lineKey: "line-b",
    feeId: "fee-tuition",
    learnerId: "learner-a",
  };
  assert(
    catalogFeeLineKey(lineA) === catalogFeeLineKey(lineB),
    "same learner + same catalog fee should share dedupe key"
  );
  console.log("✓ same learner + same catalog fee shares dedupe key");
}

function main() {
  testFamilyAllowsSameFeeTwice();
  testSameLearnerSameFeeBlocked();
  console.log("\nAll invoice create duplicate helper tests passed.");
}

main();
