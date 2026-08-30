/**
 * Capture Payment amount ingest tests.
 * Run: npx tsx src/utils/capturePaymentAmount.test.ts
 */
import {
  CAPTURE_PAYMENT_MAX_AMOUNT,
  parseCapturePaymentAmount,
} from "./capturePaymentAmount";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function testValidAmounts() {
  const a = parseCapturePaymentAmount(0.01);
  assert(a.ok && a.amount === 0.01, "R0.01 accepted");
  const b = parseCapturePaymentAmount(10);
  assert(b.ok && b.amount === 10, "R10.00 accepted");
  const c = parseCapturePaymentAmount("1,234.56");
  assert(c.ok && c.amount === 1234.56, "R1,234.56 accepted");
  const d = parseCapturePaymentAmount(50000);
  assert(d.ok && d.amount === 50000, "large valid payment accepted");
  const e = parseCapturePaymentAmount("10.00");
  assert(e.ok && e.amount === 10, "string 10.00 accepted");
  console.log("✓ valid amounts including cents and thousands separators");
}

function testRejects() {
  const z = parseCapturePaymentAmount(0);
  assert(!z.ok && z.code === "AMOUNT_ZERO", "R0 rejected");
  const n = parseCapturePaymentAmount(-10);
  assert(!n.ok && n.code === "AMOUNT_NEGATIVE", "negative rejected");
  const m = parseCapturePaymentAmount("abc");
  assert(!m.ok && m.code === "AMOUNT_MALFORMED", "malformed rejected");
  const nan = parseCapturePaymentAmount(Number.NaN);
  assert(!nan.ok && nan.code === "AMOUNT_NAN", "NaN rejected");
  const inf = parseCapturePaymentAmount(Number.POSITIVE_INFINITY);
  assert(!inf.ok && inf.code === "AMOUNT_INFINITE", "Infinity rejected");
  const big = parseCapturePaymentAmount(CAPTURE_PAYMENT_MAX_AMOUNT + 1);
  assert(!big.ok && big.code === "AMOUNT_TOO_LARGE", "unsupported magnitude rejected");
  const empty = parseCapturePaymentAmount("");
  assert(!empty.ok, "empty rejected");
  console.log("✓ zero / negative / malformed / NaN / Infinity / too-large rejected");
}

function testCentsRounding() {
  const r = parseCapturePaymentAmount(10.005);
  assert(r.ok && r.amount === 10.01, "0.005 rounds to nearest cent");
  const s = parseCapturePaymentAmount(1.234);
  assert(s.ok && s.amount === 1.23, "1.234 rounds to 1.23");
  console.log("✓ cents precision rounding");
}

testValidAmounts();
testRejects();
testCentsRounding();
console.log("\nAll capturePaymentAmount tests passed.");
