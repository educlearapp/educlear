/**
 * PayFast checkout signature regression (PHP urlencode-compatible).
 * Run: npx tsx src/services/payfastSignature.unit.test.ts
 */
import assert from "assert";
import crypto from "crypto";

import {
  buildParamStringFromOrderedFields,
  encodePayFastValue,
  finalizeCheckoutPayload,
  formatPayFastAmount,
  generatePayFastSignature,
  listCheckoutSignatureFieldNames,
} from "./payfastService";

/** Independent PHP-urlencode replica for cross-check (must stay in sync with encodePayFastValue). */
function independentPhpUrlEncode(value: string): string {
  return encodeURIComponent(String(value).trim())
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A")
    .replace(/~/g, "%7E")
    .replace(/%20/g, "+");
}

const FIXTURE_ORDER = [
  "merchant_id",
  "merchant_key",
  "return_url",
  "cancel_url",
  "notify_url",
  "name_first",
  "name_last",
  "email_address",
  "m_payment_id",
  "amount",
  "item_name",
  "item_description",
  "custom_str1",
  "custom_str2",
  "custom_str3",
] as const;

/** Sandbox-style dummy credentials only — not production secrets. */
const FIXTURE: Record<string, string> = {
  merchant_id: "10000100",
  merchant_key: "46f0cd694581a",
  return_url: "https://www.example.com/success",
  cancel_url: "https://www.example.com/cancel",
  notify_url: "https://www.example.com/notify",
  name_first: "John",
  name_last: "Doe",
  email_address: "john@example.com",
  m_payment_id: "ec-core-1",
  amount: "1000.00",
  item_name: "EduClear Core (Monthly)",
  item_description:
    "School administration + complete school-fee Billing. — Monthly subscription",
  custom_str1: "plog1",
  custom_str2: "inv1",
  custom_str3: "SUBSCRIPTION",
};

const FIXTURE_PASSPHRASE = "jt7NOE43FZPn";

function expectedCanonical(passphrase: string): string {
  const parts = FIXTURE_ORDER.map((key) => `${key}=${independentPhpUrlEncode(FIXTURE[key])}`);
  parts.push(`passphrase=${independentPhpUrlEncode(passphrase)}`);
  return parts.join("&");
}

function testPhpCompatibleEncoding() {
  assert.strictEqual(encodePayFastValue("EduClear Core (Monthly)"), "EduClear+Core+%28Monthly%29");
  assert.strictEqual(
    encodePayFastValue("EduClear Core (Monthly)"),
    independentPhpUrlEncode("EduClear Core (Monthly)")
  );
  // Legacy JS encodeURIComponent leaves () unencoded — that must NOT be used.
  const legacyBroken = encodeURIComponent("EduClear Core (Monthly)").replace(/%20/g, "+");
  assert.strictEqual(legacyBroken, "EduClear+Core+(Monthly)");
  assert.notStrictEqual(encodePayFastValue("EduClear Core (Monthly)"), legacyBroken);
  assert.strictEqual(encodePayFastValue("a b"), "a+b");
  assert.strictEqual(encodePayFastValue("a+b"), "a%2Bb");
  console.log("✓ PHP-compatible encoding; parentheses encoded; spaces as +");
}

function testFixtureCanonicalAndSignature() {
  assert.strictEqual(formatPayFastAmount(100_000), "1000.00");
  assert.strictEqual(FIXTURE.amount, "1000.00");

  const canonical = buildParamStringFromOrderedFields(FIXTURE, FIXTURE_ORDER);
  const withPass = `${canonical}&passphrase=${encodePayFastValue(FIXTURE_PASSPHRASE)}`;
  const expected = expectedCanonical(FIXTURE_PASSPHRASE);

  assert.strictEqual(withPass, expected);
  assert.ok(withPass.includes("item_name=EduClear+Core+%28Monthly%29"));
  assert.ok(withPass.includes("&passphrase="));
  assert.strictEqual((withPass.match(/&passphrase=/g) || []).length, 1);
  assert.ok(!withPass.includes("signature="));

  // Redacted print for operators (no secret value).
  const redacted = withPass.replace(
    encodePayFastValue(FIXTURE_PASSPHRASE),
    "***"
  );
  console.log("ordered field names:", [...FIXTURE_ORDER, "passphrase"].join(","));
  console.log("canonical (passphrase redacted):", redacted);

  const signature = generatePayFastSignature(FIXTURE, FIXTURE_PASSPHRASE);
  const independent = crypto.createHash("md5").update(expected).digest("hex");
  assert.strictEqual(signature, independent);
  assert.strictEqual(signature, "8603eb6cf672a45e8a9c221c0fe1c8cc");
  assert.ok(/^[a-f0-9]{32}$/.test(signature));
  console.log("✓ fixture canonical string + MD5 signature MATCH");
}

function testSubmittedEqualsSigned() {
  const payload = finalizeCheckoutPayload(
    {
      ...FIXTURE,
      cell_number: "",
      custom_int1: "",
    },
    FIXTURE_PASSPHRASE
  );

  const signedNames = listCheckoutSignatureFieldNames(payload);
  const submittedNames = Object.keys(payload).filter((k) => k !== "signature");
  assert.deepStrictEqual(submittedNames, signedNames);
  assert.ok(payload.signature);
  assert.ok(!signedNames.includes("signature"));
  assert.ok(!submittedNames.includes("cell_number"));
  assert.strictEqual(payload.amount, "1000.00");
  assert.strictEqual(payload.item_name, "EduClear Core (Monthly)");

  // Recompute from submitted fields only — must match embedded signature.
  const again = generatePayFastSignature(payload, FIXTURE_PASSPHRASE);
  assert.strictEqual(again, payload.signature);
  console.log("✓ submitted fields === signed fields; empty omitted; signature excluded from hash");
}

function testEmptyFieldsOmittedAndPassphraseOnce() {
  const data = { ...FIXTURE, name_first: "  ", cell_number: "" };
  const names = listCheckoutSignatureFieldNames(data);
  assert.ok(!names.includes("name_first"));
  assert.ok(!names.includes("cell_number"));
  const param = buildParamStringFromOrderedFields(data, FIXTURE_ORDER);
  assert.ok(!param.includes("name_first="));
  const full = `${param}&passphrase=${encodePayFastValue(FIXTURE_PASSPHRASE)}`;
  assert.strictEqual((full.match(/passphrase=/g) || []).length, 1);
  console.log("✓ empty/blank fields omitted; passphrase included once");
}

function main() {
  testPhpCompatibleEncoding();
  testFixtureCanonicalAndSignature();
  testSubmittedEqualsSigned();
  testEmptyFieldsOmittedAndPassphraseOnce();
  console.log("\nAll payfastSignature.unit.test.ts passed.");
}

main();
