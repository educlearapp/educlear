/**
 * Statement bulk SMS duplicate guard. No WinSMS and no production files.
 * Run: node --import tsx src/services/statementBulkSmsDuplicateGuard.test.ts
 */
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  BULK_SMS_DUPLICATE_CODE,
  BULK_SMS_IN_PROGRESS_STALE_MS,
  BULK_SMS_RESEND_REASON_CODE,
  DA_SILVA_NOVEMBER_2026_STATEMENT_SMS_HOLD,
  HISTORICAL_STATEMENT_SMS_HOLD_CODE,
  bulkSmsRecipientKey,
  bulkSmsSendFingerprint,
  claimStatementBulkSmsSend,
  classifyStoredBulkSmsOutcome,
  completeStatementBulkSmsSend,
  readStatementBulkSmsOperationsForTests,
  setStatementBulkSmsDuplicateGuardDataDirForTests,
  statementSmsBillingPeriod,
} from "./statementBulkSmsDuplicateGuard";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bulk-sms-guard-"));
setStatementBulkSmsDuplicateGuardDataDirForTests(dir);

const base = {
  schoolId: "school-a",
  billingPeriod: "2026-11",
  recipientStrategy: "all_eligible",
  recipientKeys: [bulkSmsRecipientKey("fa-1", ["p2", "p1"]), bulkSmsRecipientKey("fa-2", ["p3"])],
  now: new Date("2026-11-19T18:10:00.000Z"),
};

function testPeriodAndFingerprint() {
  assert.equal(statementSmsBillingPeriod(new Date("2026-11-19T22:30:00.000Z")), "2026-11");
  assert.equal(statementSmsBillingPeriod(new Date("2026-10-31T22:30:00.000Z")), "2026-11");
  const same = bulkSmsSendFingerprint(base);
  const reordered = bulkSmsSendFingerprint({
    ...base,
    recipientKeys: [base.recipientKeys[1], bulkSmsRecipientKey("fa-1", ["p1", "p2"])],
  });
  assert.equal(same, reordered);
  assert.notEqual(same, bulkSmsSendFingerprint({ ...base, schoolId: "school-b" }));
  assert.notEqual(same, bulkSmsSendFingerprint({ ...base, billingPeriod: "2026-12" }));
  console.log("  ✓ period uses Johannesburg month; fingerprint ignores order and isolates schools");
}

function testDoubleSubmitAndSchoolIsolation() {
  const first = claimStatementBulkSmsSend(base);
  assert.equal(first.claimed, true);
  const second = claimStatementBulkSmsSend({ ...base, now: new Date("2026-11-19T18:10:02.000Z") });
  assert.equal(second.claimed, false);
  if (!second.claimed) {
    assert.equal(second.response.code, BULK_SMS_DUPLICATE_CODE);
    assert.equal(second.response.inProgress, true);
    assert.match(second.response.summary, /did not contact WinSMS again/i);
  }
  const otherSchool = claimStatementBulkSmsSend({ ...base, schoolId: "school-b" });
  assert.equal(otherSchool.claimed, true);
  const otherPeriod = claimStatementBulkSmsSend({ ...base, billingPeriod: "2026-12", schoolId: "school-a" });
  assert.equal(otherPeriod.claimed, true);
  console.log("  ✓ double-click blocked; another school and another period are allowed");
}

function testStoredPartialAndUncertainAreNotRetried() {
  const claimed = claimStatementBulkSmsSend({
    ...base,
    schoolId: "school-partial",
    recipientKeys: [bulkSmsRecipientKey("fa-9", ["p9"])],
  });
  assert.equal(claimed.claimed, true);
  if (!claimed.claimed) return;
  completeStatementBulkSmsSend(claimed.operationId, {
    outcome: classifyStoredBulkSmsOutcome({
      successfulDestinations: 4,
      failedDestinations: 2,
      unconfirmedDestinations: 0,
    }),
    attemptedDestinations: 6,
    successfulDestinations: 4,
    failedDestinations: 2,
    unconfirmedDestinations: 0,
    httpStatus: 207,
    summary: "partial",
  });
  const retry = claimStatementBulkSmsSend({
    ...base,
    schoolId: "school-partial",
    recipientKeys: [bulkSmsRecipientKey("fa-9", ["p9"])],
    now: new Date("2026-11-19T18:20:00.000Z"),
  });
  assert.equal(retry.claimed, false);
  if (!retry.claimed) {
    assert.equal(retry.response.successfulDestinations, 4);
    assert.equal(retry.response.failedDestinations, 2);
    assert.equal(retry.response.unconfirmedDestinations, 0);
    assert.match(retry.response.summary, /did not send them again/i);
  }

  const uncertainClaim = claimStatementBulkSmsSend({
    ...base,
    schoolId: "school-unknown",
    recipientKeys: [bulkSmsRecipientKey("fa-8", ["p8"])],
  });
  assert.equal(uncertainClaim.claimed, true);
  if (!uncertainClaim.claimed) return;
  completeStatementBulkSmsSend(uncertainClaim.operationId, {
    outcome: "uncertain",
    attemptedDestinations: 3,
    successfulDestinations: 1,
    failedDestinations: 0,
    unconfirmedDestinations: 2,
    httpStatus: 207,
    summary: "uncertain",
  });
  const uncertainRetry = claimStatementBulkSmsSend({
    ...base,
    schoolId: "school-unknown",
    recipientKeys: [bulkSmsRecipientKey("fa-8", ["p8"])],
    now: new Date("2026-11-19T18:30:00.000Z"),
  });
  assert.equal(uncertainRetry.claimed, false);
  if (!uncertainRetry.claimed) {
    assert.equal(uncertainRetry.response.unconfirmedDestinations, 2);
    assert.match(uncertainRetry.response.summary, /did not send again/i);
  }
  console.log("  ✓ partial and uncertain results are returned and not sent again");
}

function testRejectedCanRetryAndResendIsAudited() {
  const rejectedClaim = claimStatementBulkSmsSend({
    ...base,
    schoolId: "school-rejected",
    recipientKeys: [bulkSmsRecipientKey("fa-7", ["p7"])],
  });
  assert.equal(rejectedClaim.claimed, true);
  if (!rejectedClaim.claimed) return;
  completeStatementBulkSmsSend(rejectedClaim.operationId, {
    outcome: "rejected",
    attemptedDestinations: 2,
    successfulDestinations: 0,
    failedDestinations: 2,
    unconfirmedDestinations: 0,
    httpStatus: 502,
    summary: "rejected",
  });
  const again = claimStatementBulkSmsSend({
    ...base,
    schoolId: "school-rejected",
    recipientKeys: [bulkSmsRecipientKey("fa-7", ["p7"])],
    now: new Date("2026-11-19T18:12:00.000Z"),
  });
  assert.equal(again.claimed, true, "an explicit all-rejected result may be submitted again");

  const accepted = claimStatementBulkSmsSend({
    ...base,
    schoolId: "school-resend",
    recipientKeys: [bulkSmsRecipientKey("fa-6", ["p6"])],
  });
  assert.equal(accepted.claimed, true);
  if (!accepted.claimed) return;
  completeStatementBulkSmsSend(accepted.operationId, {
    outcome: "accepted",
    attemptedDestinations: 5,
    successfulDestinations: 5,
    failedDestinations: 0,
    unconfirmedDestinations: 0,
  });
  const shortReason = claimStatementBulkSmsSend({
    ...base,
    schoolId: "school-resend",
    recipientKeys: [bulkSmsRecipientKey("fa-6", ["p6"])],
    now: new Date("2026-11-19T19:00:00.000Z"),
    confirmResend: true,
    resendReason: "too short",
    actorUserId: "user-1",
  });
  assert.equal(shortReason.claimed, false);
  if (!shortReason.claimed) assert.equal(shortReason.response.code, BULK_SMS_RESEND_REASON_CODE);

  const resend = claimStatementBulkSmsSend({
    ...base,
    schoolId: "school-resend",
    recipientKeys: [bulkSmsRecipientKey("fa-6", ["p6"])],
    now: new Date("2026-11-19T19:00:00.000Z"),
    confirmResend: true,
    resendReason: "Operator confirmed the first batch was not received.",
    actorUserId: "user-1",
  });
  assert.equal(resend.claimed, true);
  const stored = readStatementBulkSmsOperationsForTests().find(
    (op) => resend.claimed && op.operationId === resend.operationId
  );
  assert.equal(stored?.resendOf, accepted.operationId);
  assert.equal(stored?.actorUserId, "user-1");
  assert.match(stored?.resendReason || "", /Operator confirmed/);
  const raw = fs.readFileSync(path.join(dir, "statement-bulk-sms-operations.json"), "utf8");
  assert.equal(raw.includes("mobileNumber") || raw.includes("cellNo") || raw.includes("+27"), false);
  console.log("  ✓ rejected sends can be retried; intentional resend is stored and ordinary retries are not");
}

function testConcurrentClaims() {
  const input = {
    ...base,
    schoolId: "school-concurrent",
    recipientKeys: [bulkSmsRecipientKey("fa-5", ["p5"])],
    now: new Date("2026-11-19T18:10:00.000Z"),
  };
  const results = [claimStatementBulkSmsSend(input), claimStatementBulkSmsSend(input)];
  assert.equal(results.filter((result) => result.claimed).length, 1);
  assert.equal(results.filter((result) => !result.claimed).length, 1);
  console.log("  ✓ concurrent claims record one operation");
}

function testStaleInProgressNeedsExplicitResend() {
  const claimed = claimStatementBulkSmsSend({
    ...base,
    schoolId: "school-stale",
    recipientKeys: [bulkSmsRecipientKey("fa-4", ["p4"])],
    now: new Date("2026-11-19T18:00:00.000Z"),
  });
  assert.equal(claimed.claimed, true);
  const later = new Date(Date.parse("2026-11-19T18:00:00.000Z") + BULK_SMS_IN_PROGRESS_STALE_MS + 1000);
  const blocked = claimStatementBulkSmsSend({
    ...base,
    schoolId: "school-stale",
    recipientKeys: [bulkSmsRecipientKey("fa-4", ["p4"])],
    now: later,
  });
  assert.equal(blocked.claimed, false);
  if (!blocked.claimed) assert.match(blocked.response.summary, /no confirmed WinSMS result/i);
  const resend = claimStatementBulkSmsSend({
    ...base,
    schoolId: "school-stale",
    recipientKeys: [bulkSmsRecipientKey("fa-4", ["p4"])],
    now: later,
    confirmResend: true,
    resendReason: "Checked WinSMS history. The first send is not there.",
    actorUserId: "user-2",
  });
  assert.equal(resend.claimed, true);
  console.log("  ✓ a send that never recorded a result stays blocked until an intentional resend");
}

function testHistoricalNovemberHoldHasNoFabricatedRecipients() {
  const before = readStatementBulkSmsOperationsForTests().length;
  const ordinary = claimStatementBulkSmsSend({
    schoolId: DA_SILVA_NOVEMBER_2026_STATEMENT_SMS_HOLD.schoolId,
    billingPeriod: "2026-11",
    recipientStrategy: "all_eligible",
    recipientKeys: [bulkSmsRecipientKey("fa-real", ["parent-real"])],
    now: new Date("2026-11-19T20:00:00.000Z"),
  });
  assert.equal(ordinary.claimed, false);
  if (!ordinary.claimed) {
    assert.equal(ordinary.response.code, HISTORICAL_STATEMENT_SMS_HOLD_CODE);
    assert.equal(ordinary.response.attemptedDestinations, 0);
    assert.match(ordinary.response.summary, /did not keep the recipient list/);
  }
  const resend = claimStatementBulkSmsSend({
    schoolId: DA_SILVA_NOVEMBER_2026_STATEMENT_SMS_HOLD.schoolId,
    billingPeriod: "2026-11",
    recipientStrategy: "all_eligible",
    recipientKeys: [bulkSmsRecipientKey("fa-real", ["parent-real"])],
    now: new Date("2026-11-19T20:00:00.000Z"),
    confirmResend: true,
    resendReason: "Operator asked to send the November statements again.",
    actorUserId: "user-1",
  });
  assert.equal(resend.claimed, false);
  const december = claimStatementBulkSmsSend({
    schoolId: DA_SILVA_NOVEMBER_2026_STATEMENT_SMS_HOLD.schoolId,
    billingPeriod: "2026-12",
    recipientStrategy: "all_eligible",
    recipientKeys: [bulkSmsRecipientKey("fa-real", ["parent-real"])],
    now: new Date("2026-12-01T08:00:00.000Z"),
  });
  assert.equal(december.claimed, true);
  const otherSchool = claimStatementBulkSmsSend({
    ...base,
    schoolId: "school-other",
    billingPeriod: "2026-11",
  });
  assert.equal(otherSchool.claimed, true);
  assert.equal(readStatementBulkSmsOperationsForTests().length, before + 2);
  const raw = fs.readFileSync(path.join(dir, "statement-bulk-sms-operations.json"), "utf8");
  assert.equal(raw.includes("parent-real"), false);
  assert.equal(raw.includes("fa-real"), false);
  console.log("  ✓ Da Silva November statement SMS stays blocked without storing recipient ids");
}

function main() {
  console.log("statementBulkSmsDuplicateGuard.test.ts");
  testPeriodAndFingerprint();
  testDoubleSubmitAndSchoolIsolation();
  testStoredPartialAndUncertainAreNotRetried();
  testRejectedCanRetryAndResendIsAudited();
  testConcurrentClaims();
  testStaleInProgressNeedsExplicitResend();
  testHistoricalNovemberHoldHasNoFabricatedRecipients();
  console.log("statementBulkSmsDuplicateGuard.test.ts: OK");
}

main();
