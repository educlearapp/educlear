/**
 * SMS credit estimate for Communication Centre final recipient selection.
 * Run: npx tsx src/communication/smsRecipientEstimate.unit.test.ts
 */
import assert from "node:assert/strict";
import { estimateSmsCreditsForRecipients } from "./smsRecipientEstimate";

const single = estimateSmsCreditsForRecipients("Hello from school", 1);
assert.equal(single.segments, 1);
assert.equal(single.recipientCount, 1);
assert.equal(single.estimatedCredits, 1);

const many = estimateSmsCreditsForRecipients("Hello from school", 25);
assert.equal(many.estimatedCredits, many.segments * 25);

const none = estimateSmsCreditsForRecipients("Hello", 0);
assert.equal(none.estimatedCredits, 0);

console.log("smsRecipientEstimate.unit.test.ts: ok");
