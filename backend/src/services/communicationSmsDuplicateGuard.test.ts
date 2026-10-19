/**
 * Communication Centre SMS duplicate guard. No WinSMS and no production files.
 * Run: node --import tsx src/services/communicationSmsDuplicateGuard.test.ts
 */
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  COMMUNICATION_SMS_DUPLICATE_CODE,
  COMMUNICATION_SMS_RESEND_REASON_CODE,
  claimCommunicationSmsSend,
  communicationSmsRecipientKey,
  communicationSmsStoredOutcome,
  completeCommunicationSmsSend,
  readCommunicationSmsOperationsForTests,
  setCommunicationSmsDuplicateGuardDataDirForTests,
} from "./communicationSmsDuplicateGuard";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "communication-sms-guard-"));
setCommunicationSmsDuplicateGuardDataDirForTests(dir);

const phone = "27821234567";
const base = {
  schoolId: "school-a",
  messageId: "sms-1",
  message: "Parents evening is on Friday.",
  recipientKeys: [communicationSmsRecipientKey("contact-1", phone)],
  now: new Date("2026-11-19T18:00:00.000Z"),
};

function testSameMessageBlockedAndNewMessageAllowed() {
  const first = claimCommunicationSmsSend(base);
  assert.equal(first.claimed, true);
  if (!first.claimed) return;
  completeCommunicationSmsSend(first.operationId, {
    outcome: "accepted",
    attemptedDestinations: 1,
    successfulDestinations: 1,
    failedDestinations: 0,
    unconfirmedDestinations: 0,
  });
  const again = claimCommunicationSmsSend({ ...base, now: new Date("2026-11-19T18:05:00.000Z") });
  assert.equal(again.claimed, false);
  if (!again.claimed) assert.equal(again.response.code, COMMUNICATION_SMS_DUPLICATE_CODE);
  const edited = claimCommunicationSmsSend({
    ...base,
    message: "Parents evening has moved to Monday.",
    now: new Date("2026-11-19T18:06:00.000Z"),
  });
  assert.equal(edited.claimed, true);
  const otherSchool = claimCommunicationSmsSend({
    ...base,
    schoolId: "school-b",
    now: new Date("2026-11-19T18:07:00.000Z"),
  });
  assert.equal(otherSchool.claimed, true);
  const raw = fs.readFileSync(path.join(dir, "communication-sms-operations.json"), "utf8");
  assert.equal(raw.includes(phone), false);
  console.log("  ✓ repeat is blocked; a changed message and another school are allowed");
}

function testPartialAndUnknownNeedExplicitResend() {
  for (const outcome of ["partial", "uncertain"] as const) {
    const claimed = claimCommunicationSmsSend({
      ...base,
      schoolId: `school-${outcome}`,
      messageId: `sms-${outcome}`,
    });
    assert.equal(claimed.claimed, true);
    if (!claimed.claimed) return;
    completeCommunicationSmsSend(claimed.operationId, {
      outcome,
      attemptedDestinations: 2,
      successfulDestinations: outcome === "partial" ? 1 : 0,
      failedDestinations: outcome === "partial" ? 1 : 0,
      unconfirmedDestinations: outcome === "uncertain" ? 2 : 0,
    });
    const retry = claimCommunicationSmsSend({
      ...base,
      schoolId: `school-${outcome}`,
      messageId: `sms-${outcome}`,
      now: new Date("2026-11-19T19:00:00.000Z"),
    });
    assert.equal(retry.claimed, false);
  }
  assert.equal(communicationSmsStoredOutcome({ accepted: 1, delivered: 0, rejected: 1, failed: 0, unknown: 0, pending: 0 }), "partial");
  assert.equal(communicationSmsStoredOutcome({ accepted: 0, delivered: 0, rejected: 0, failed: 0, unknown: 1, pending: 0 }), "uncertain");
  assert.equal(communicationSmsStoredOutcome({ accepted: 1, delivered: 0, rejected: 0, failed: 0, unknown: 0, pending: 1 }), "uncertain");
  console.log("  ✓ partial and unknown results are not retried automatically");
}

function testRejectedRetriesAndResendIsAudited() {
  const rejected = claimCommunicationSmsSend({ ...base, schoolId: "school-rejected", messageId: "sms-rejected" });
  assert.equal(rejected.claimed, true);
  if (!rejected.claimed) return;
  completeCommunicationSmsSend(rejected.operationId, {
    outcome: "rejected",
    attemptedDestinations: 1,
    successfulDestinations: 0,
    failedDestinations: 1,
    unconfirmedDestinations: 0,
  });
  const retry = claimCommunicationSmsSend({
    ...base,
    schoolId: "school-rejected",
    messageId: "sms-rejected",
    now: new Date("2026-11-19T19:10:00.000Z"),
  });
  assert.equal(retry.claimed, true);

  const accepted = claimCommunicationSmsSend({ ...base, schoolId: "school-resend", messageId: "sms-resend" });
  assert.equal(accepted.claimed, true);
  if (!accepted.claimed) return;
  completeCommunicationSmsSend(accepted.operationId, {
    outcome: "accepted",
    attemptedDestinations: 1,
    successfulDestinations: 1,
    failedDestinations: 0,
    unconfirmedDestinations: 0,
  });
  const short = claimCommunicationSmsSend({
    ...base,
    schoolId: "school-resend",
    messageId: "sms-resend",
    confirmResend: true,
    resendReason: "too short",
    actorUserId: "user-1",
  });
  assert.equal(short.claimed, false);
  if (!short.claimed) assert.equal(short.response.code, COMMUNICATION_SMS_RESEND_REASON_CODE);
  const resend = claimCommunicationSmsSend({
    ...base,
    schoolId: "school-resend",
    messageId: "sms-resend",
    confirmResend: true,
    resendReason: "Operator confirmed the first copy was not received.",
    actorUserId: "user-1",
  });
  assert.equal(resend.claimed, true);
  const stored = readCommunicationSmsOperationsForTests().find((op) => resend.claimed && op.operationId === resend.operationId);
  assert.equal(stored?.resendOf, accepted.operationId);
  assert.equal(stored?.actorUserId, "user-1");
  console.log("  ✓ rejected sends can be retried; an intentional resend stores the reason");
}

function testConcurrentClaims() {
  const input = { ...base, schoolId: "school-concurrent", messageId: "sms-concurrent" };
  const results = [claimCommunicationSmsSend(input), claimCommunicationSmsSend(input)];
  assert.equal(results.filter((result) => result.claimed).length, 1);
  console.log("  ✓ concurrent claims record one operation");
}

function main() {
  console.log("communicationSmsDuplicateGuard.test.ts");
  testSameMessageBlockedAndNewMessageAllowed();
  testPartialAndUnknownNeedExplicitResend();
  testRejectedRetriesAndResendIsAudited();
  testConcurrentClaims();
  console.log("communicationSmsDuplicateGuard.test.ts: OK");
}

main();
