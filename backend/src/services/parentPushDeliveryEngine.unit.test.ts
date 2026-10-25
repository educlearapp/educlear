/**
 * Phase 4B unit checks — quiet hours, backoff, privacy payload, eligibility.
 * Run: npx tsx src/services/parentPushDeliveryEngine.unit.test.ts
 */
import assert from "assert";
import {
  backoffMsForAttempt,
  buildPrivacySafePayload,
  isBillingOrUnsupportedType,
  isPushEligibleType,
  isWithinQuietHours,
  nextQuietHoursEnd,
  PUSH_MAX_ATTEMPTS,
} from "./parentPushDeliveryEngine";
import { sendPushPlaceholder } from "../communication/communicationProviders/pushProvider";
import { MockPushTransport } from "./parentPushTransport";

assert.equal(isPushEligibleType("TEACHER_MESSAGE"), true);
assert.equal(isPushEligibleType("SCHOOL_NOTICE"), true);
assert.equal(isPushEligibleType("SCHOOL_EVENT"), true);
assert.equal(isPushEligibleType("ASSESSMENT"), true);
assert.equal(isBillingOrUnsupportedType("INVOICE_READY"), true);
assert.equal(isBillingOrUnsupportedType("STATEMENT_READY"), true);
assert.equal(isBillingOrUnsupportedType("HOMEWORK"), true);

const noon = new Date();
noon.setHours(12, 0, 0, 0);
assert.equal(isWithinQuietHours(noon, "22:00", "06:00"), false);

const night = new Date();
night.setHours(23, 30, 0, 0);
assert.equal(isWithinQuietHours(night, "22:00", "06:00"), true);
const end = nextQuietHoursEnd(night, "22:00", "06:00");
assert.ok(end);
assert.equal(end!.getHours(), 6);

const dayQuiet = new Date();
dayQuiet.setHours(13, 0, 0, 0);
assert.equal(isWithinQuietHours(dayQuiet, "12:00", "14:00"), true);

assert.equal(backoffMsForAttempt(1), 60_000);
assert.equal(backoffMsForAttempt(2), 5 * 60_000);
assert.ok(backoffMsForAttempt(PUSH_MAX_ATTEMPTS) >= 60_000);

const payload = buildPrivacySafePayload(
  {
    id: "n1",
    type: "TEACHER_MESSAGE",
    title: "New message from teacher",
    message: "Private body about learner Jane Doe balance R500",
  },
  false
);
assert.equal(payload.lockScreenPreview, false);
assert.equal(payload.body, undefined);
assert.ok(!JSON.stringify(payload).includes("Jane"));
assert.ok(!JSON.stringify(payload).includes("R500"));

const preview = buildPrivacySafePayload(
  {
    id: "n1",
    type: "TEACHER_MESSAGE",
    title: "Hello",
    message: "Short preview",
  },
  true
);
assert.equal(preview.body, "Short preview");

async function main() {
  const placeholder = await sendPushPlaceholder({
    schoolId: "s",
    messageId: "m",
    recipient: "x",
    subject: "s",
    body: "b",
  });
  assert.equal(placeholder.ok, false);
  assert.equal(placeholder.simulated, true);

  const mock = new MockPushTransport();
  const mockRes = await mock.send(
    { endpoint: "https://example.com/push", keys: { p256dh: "a", auth: "b" } },
    { title: "t", lockScreenPreview: false, notificationId: "n", type: "SCHOOL_NOTICE" }
  );
  assert.equal(mockRes.ok, true);
  assert.equal(mockRes.externalSent, false);
  assert.equal(mockRes.simulated, true);

  console.log("parentPushDeliveryEngine.unit.test: PASS");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
