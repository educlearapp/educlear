/**
 * Frontend statement SMS helpers + delivery-flow invariants.
 * Run: npx tsx src/billing/statementSmsFlow.test.ts
 */
import assert from "assert";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  estimateStatementSmsSegments,
  STATEMENT_SMS_MAX_CHARS,
  STATEMENT_SMS_SEGMENT_CHARS,
} from "./statementSmsApi.ts";

const here = dirname(fileURLToPath(import.meta.url));

function testSegmentEstimate() {
  assert.strictEqual(estimateStatementSmsSegments(""), 0);
  assert.strictEqual(estimateStatementSmsSegments("a"), 1);
  assert.strictEqual(
    estimateStatementSmsSegments("x".repeat(STATEMENT_SMS_SEGMENT_CHARS)),
    1
  );
  assert.strictEqual(
    estimateStatementSmsSegments("x".repeat(STATEMENT_SMS_SEGMENT_CHARS + 1)),
    2
  );
}

function testStatementManageUsesDeliveryChooser() {
  const src = readFileSync(join(here, "StatementManage.tsx"), "utf8");
  assert.ok(src.includes("deliveryChooserOpen"), "delivery chooser state present");
  assert.ok(src.includes("chooseDeliveryEmail"), "email path from chooser");
  assert.ok(src.includes("chooseDeliverySms"), "sms path from chooser");
  assert.ok(src.includes("SMS Statement"), "SMS composer title");
  assert.ok(src.includes("Both Parents") || src.includes("All Eligible Parents"), "multi-contact label");
  assert.ok(src.includes("sendStatementSmsRequest"), "uses SMS send API");
  assert.ok(src.includes("fetchStatementSmsPreview"), "uses SMS preview API");
  assert.ok(!/Send SMS Statement/.test(src), "no separate Send SMS Statement toolbar label");
  assert.ok(src.includes('openExportPeriodModal("email")'), "single Send still opens period modal");
  assert.ok(src.includes("Send Email"), "email send button preserved");
  assert.ok(src.includes("confirmSendStatement"), "email confirm preserved");
  assert.ok(STATEMENT_SMS_MAX_CHARS === 480);
}

function main() {
  testSegmentEstimate();
  testStatementManageUsesDeliveryChooser();
  console.log("statementSmsFlow.test.ts: all passed");
}

main();
