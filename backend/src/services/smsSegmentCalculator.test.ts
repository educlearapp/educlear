/**
 * GSM 03.38 / UCS-2 segment counts. No network and no WinSMS calls.
 * Run: cd backend && npx tsx src/services/smsSegmentCalculator.test.ts
 */
import assert from "node:assert/strict";
import {
  analyseSmsMessage,
  GSM_CONCAT_SEPTETS,
  GSM_SINGLE_SEPTETS,
  publicSmsProviderError,
  STATEMENT_SMS_MAX_SEGMENTS,
  UCS2_CONCAT_UNITS,
  UCS2_SINGLE_UNITS,
} from "./smsSegmentCalculator";
import { sanitiseStatementSmsMessage } from "./statementSmsService";
import {
  describeBulkMessageLimitBlock,
  renderBulkStatementSmsTemplate,
} from "./statementBulkSmsService";

const NOVEMBER_WINSMS_ERROR =
  "The GSM Encoded segment count of the 'message' parameter is 4. This exceeds the 'maxSegments' value of 3 specified.";

function testGsmBoundaries() {
  assert.equal(analyseSmsMessage("").segments, 0);
  assert.equal(analyseSmsMessage("A".repeat(GSM_SINGLE_SEPTETS)).segments, 1);
  assert.equal(analyseSmsMessage("A".repeat(GSM_SINGLE_SEPTETS)).encoding, "gsm");
  assert.equal(analyseSmsMessage("A".repeat(GSM_SINGLE_SEPTETS + 1)).segments, 2);
  assert.equal(analyseSmsMessage("A".repeat(GSM_CONCAT_SEPTETS * 2)).segments, 2);
  assert.equal(analyseSmsMessage("A".repeat(GSM_CONCAT_SEPTETS * 2 + 1)).segments, 3);
  console.log("  ✓ 160, 161, 306 and 307 GSM septet boundaries");
}

function testExtensionCharacters() {
  const oneSixty = "A".repeat(158) + "^";
  const counted = analyseSmsMessage(oneSixty);
  assert.equal(counted.encoding, "gsm");
  assert.equal(counted.units, 160);
  assert.equal(counted.segments, 1);
  const overflows = analyseSmsMessage("A".repeat(159) + "€");
  assert.equal(overflows.units, 161);
  assert.equal(overflows.segments, 2);
  assert.equal(analyseSmsMessage("[]{}\\~|€").units, 16);
  console.log("  ✓ GSM extension characters count as two septets");
}

function testUnicodeAndEmoji() {
  assert.equal(analyseSmsMessage("é").encoding, "gsm");
  assert.equal(analyseSmsMessage("é").segments, 1);
  const han = "你".repeat(UCS2_SINGLE_UNITS);
  assert.equal(analyseSmsMessage(han).encoding, "ucs2");
  assert.equal(analyseSmsMessage(han).units, 70);
  assert.equal(analyseSmsMessage(han).segments, 1);
  assert.equal(analyseSmsMessage("你".repeat(UCS2_SINGLE_UNITS + 1)).segments, 2);
  assert.equal(analyseSmsMessage("你".repeat(UCS2_CONCAT_UNITS * 2)).segments, 2);
  assert.equal(analyseSmsMessage("你".repeat(UCS2_CONCAT_UNITS * 2 + 1)).segments, 3);

  const emoji = "😀";
  assert.equal(emoji.length, 2, "one emoji is a surrogate pair");
  assert.equal(analyseSmsMessage(emoji.repeat(35)).units, 70);
  assert.equal(analyseSmsMessage(emoji.repeat(35)).segments, 1);
  assert.equal(analyseSmsMessage(emoji.repeat(36)).units, 72);
  assert.equal(analyseSmsMessage(emoji.repeat(36)).segments, 2);
  console.log("  ✓ Unicode and emoji use UCS-2, counting surrogate pairs");
}

function testNovemberMessageIsFourSegments() {
  const original = "A".repeat(460);
  const before = original;
  const counted = analyseSmsMessage(original);
  const previousCounter = Math.ceil(original.length / 160);
  assert.equal(previousCounter, 3, "the old counter is the value WinSMS rejected");
  assert.equal(counted.encoding, "gsm");
  assert.equal(counted.units, 460);
  assert.equal(counted.segments, 4);
  assert.equal(counted.credits, 4);
  assert.equal(original, before, "counting does not change the message");
  const saved = sanitiseStatementSmsMessage(original);
  assert.equal(saved.ok, true);
  if (saved.ok) {
    assert.equal(saved.segments, 4);
    assert.equal(saved.message, original);
    assert.ok(saved.segments <= STATEMENT_SMS_MAX_SEGMENTS);
  }
  console.log("  ✓ November-style 460-septet message is 4 segments and is not rewritten");
}

function testPersonalisedLengthsStaySeparate() {
  const template = `${"A".repeat(450)}{{accountNo}}`;
  const schoolA = renderBulkStatementSmsTemplate(template, {
    schoolName: "Da Silva Academy",
    accountNo: "123456789",
    amount: "R1.00",
    balance: 1,
  });
  const schoolB = renderBulkStatementSmsTemplate(template, {
    schoolName: "Fly Eagle Primary",
    accountNo: "1234567890",
    amount: "R1.00",
    balance: 1,
  });
  assert.equal(analyseSmsMessage(schoolA).segments, 3);
  assert.equal(analyseSmsMessage(schoolB).segments, 4);
  assert.notEqual(schoolA, schoolB);
  const againA = analyseSmsMessage(schoolA);
  const againB = analyseSmsMessage(schoolB);
  assert.equal(againA.segments, 3);
  assert.equal(againB.segments, 4);
  console.log("  ✓ personalised messages are counted separately and repeats stay stable");
}

function testOverLimitStopsWithoutChangingText() {
  const nineSegments = "你".repeat(UCS2_CONCAT_UNITS * STATEMENT_SMS_MAX_SEGMENTS + 1);
  assert.ok(analyseSmsMessage(nineSegments).segments > STATEMENT_SMS_MAX_SEGMENTS);
  const tooLong = "你".repeat(481);
  const saved = sanitiseStatementSmsMessage(tooLong);
  assert.equal(saved.ok, false);
  if (!saved.ok) {
    assert.match(saved.error, /not shortened/);
    assert.equal("message" in saved, false);
  }
  const block = describeBulkMessageLimitBlock([
    { accountNo: "ADA004", skipReason: "NO_VALID_MOBILE", skipMessage: "No mobile" },
    { accountNo: "MOO003", skipReason: "INVALID_MESSAGE", skipMessage: "This message is 9 SMS segments." },
  ]);
  assert.equal(block.blocked, true);
  assert.match(block.error || "", /MOO003/);
  assert.match(block.error || "", /Not sent/);
  const second = describeBulkMessageLimitBlock([
    { accountNo: "MOO003", skipReason: "INVALID_MESSAGE", skipMessage: "This message is 9 SMS segments." },
  ]);
  assert.equal(second.blocked, true);
  assert.equal(describeBulkMessageLimitBlock([{ accountNo: "ADA004", skipReason: "NO_VALID_MOBILE" }]).blocked, false);
  console.log("  ✓ over-limit messages stop the batch and are not shortened");
}

function testProvider422IsShownWithoutSecrets() {
  const shown = publicSmsProviderError(
    `${NOVEMBER_WINSMS_ERROR} api_key=re_live_secret 0821234567`
  );
  assert.match(shown, /GSM Encoded segment count/);
  assert.equal(shown.includes("re_live_secret"), false);
  assert.equal(shown.includes("0821234567"), false);
  assert.match(shown, /\[redacted\]/);
  assert.match(shown, /\[number\]/);
  console.log("  ✓ HTTP 422 text is kept and credentials or numbers are removed");
}

function testSendPathChecksLimitBeforeProvider() {
  const src = require("fs").readFileSync(require("path").join(__dirname, "statementBulkSmsService.ts"), "utf8");
  const limitAt = src.indexOf("describeBulkMessageLimitBlock(skippedAccounts)");
  const providerAt = src.indexOf("await sendSchoolSms");
  assert.ok(limitAt > 0 && providerAt > limitAt, "segment limit is checked before WinSMS");
  console.log("  ✓ bulk send checks the segment limit before contacting WinSMS");
}

function main() {
  console.log("smsSegmentCalculator.test.ts");
  testGsmBoundaries();
  testExtensionCharacters();
  testUnicodeAndEmoji();
  testNovemberMessageIsFourSegments();
  testPersonalisedLengthsStaySeparate();
  testOverLimitStopsWithoutChangingText();
  testProvider422IsShownWithoutSecrets();
  testSendPathChecksLimitBeforeProvider();
  console.log("smsSegmentCalculator.test.ts: OK");
}

main();
