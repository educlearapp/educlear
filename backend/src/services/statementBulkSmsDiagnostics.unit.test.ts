/**
 * Bulk Statement SMS diagnostics — counts/codes/timings only, no personal data. No live WinSMS.
 * Run: DISABLE_OUTBOUND_SMS=true node --import tsx src/services/statementBulkSmsDiagnostics.unit.test.ts
 */
import assert from "node:assert/strict";
import {
  buildBulkSmsPreviewCompletedLog,
  buildBulkSmsSendCompletedLog,
  createBulkStatementSmsSendDiagnostics,
  previewBulkStatementSms,
  safeBulkSmsErrorCode,
  sendBulkStatementSms,
  setBulkStatementSmsLoggerForTests,
  summariseWinSmsAcceptance,
  BULK_SMS_UNCONFIRMED_MESSAGE,
  classifyWinSmsDestinationOutcome,
  summariseBulkSmsDestinationOutcome,
} from "./statementBulkSmsService";
import { WinSmsApiError } from "./winSmsClient";

const PII = [
  "0821234567",
  "27821234567",
  "Thandi",
  "Mokoena",
  "parent@example.test",
  "Your account is overdue",
  "re_live_secret",
  "ACC-777",
];

function assertNoPii(value: unknown, label: string) {
  const text = JSON.stringify(value);
  for (const needle of PII) {
    assert.ok(!text.includes(needle), `${label} must not contain "${needle}"`);
  }
}

function testAcceptanceSummary() {
  const single = summariseWinSmsAcceptance({
    statusCode: 200,
    recipients: [
      { accepted: true, apiMessageId: 11, mobileNumber: "27821234567", clientMessageId: "bstmt-x" },
      { accepted: false, apiMessageId: null, acceptError: "BADDEST", mobileNumber: "27821234567" },
      { accepted: false, apiMessageId: null, acceptError: "no credit <b>", mobileNumber: "0821234567" },
      { mobileNumber: "0821234567" },
    ],
  });
  assert.equal(single.accepted, 1);
  assert.equal(single.rejected, 2);
  assert.equal(single.unknown, 1);
  assert.deepEqual(single.rejectCodes, { BADDEST: 1, NOCREDITB: 1 });
  assertNoPii(single, "acceptance summary");

  const multi = summariseWinSmsAcceptance({
    messages: [{ message: "Your account is overdue", recipients: [{ accepted: true }, { accepted: true }] }],
  });
  assert.equal(multi.accepted, 2);
  assertNoPii(multi, "multi-message summary");

  const unknown = summariseWinSmsAcceptance({ statusCode: 200 });
  assert.deepEqual(unknown, { accepted: 0, rejected: 0, unknown: 1, rejectCodes: {} });
  console.log("  ✓ WinSMS acceptance summarised from recipients[].accepted/acceptError (codes only)");
}

function testHttp200OutcomeClassification() {
  const classify = (response: unknown) => classifyWinSmsDestinationOutcome(summariseWinSmsAcceptance(response));

  const rejected = classify({
    statusCode: 200,
    recipients: [{ accepted: false, apiMessageId: null, acceptError: "BADDEST", mobileNumber: "27821234567" }],
  });
  assert.deepEqual(rejected, { status: "failed", error: "WinSMS rejected this number (BADDEST)" });
  assertNoPii(rejected, "rejection outcome");
  assert.deepEqual(classify({ recipients: [{ accepted: false }] }), {
    status: "failed",
    error: "WinSMS rejected this number (UNSPECIFIED)",
  });

  assert.deepEqual(classify({ recipients: [{ accepted: true, apiMessageId: 9 }] }), { status: "sent", error: null });
  assert.equal(classify({ recipients: [{ accepted: true }, { accepted: false }] }).status, "sent");

  for (const unreadable of [{ statusCode: 200 }, {}, null, "OK", { recipients: [] }, { recipients: [{ apiMessageId: 5 }] }]) {
    assert.deepEqual(
      classify(unreadable),
      { status: "unconfirmed", error: BULK_SMS_UNCONFIRMED_MESSAGE },
      "unreadable/unrecognised 200 is never confirmed delivery"
    );
  }
  console.log("  ✓ HTTP 200: accepted → sent; accepted:false → failed (code only); unreadable → unconfirmed");
}

function testUnconfirmedOutcomeSummary() {
  const allUnconfirmed = summariseBulkSmsDestinationOutcome([{ status: "unconfirmed" }, { status: "unconfirmed" }], 2, 0);
  assert.equal(allUnconfirmed.successfulDestinations, 0, "unconfirmed never counted as sent");
  assert.equal(allUnconfirmed.failedDestinations, 0, "unconfirmed not reported as failed (no resend prompt)");
  assert.equal(allUnconfirmed.unconfirmedDestinations, 2);
  assert.equal(allUnconfirmed.ok, true, "client shows the warning summary, not a generic failure");
  assert.equal(allUnconfirmed.status, 207);
  assert.match(allUnconfirmed.summary, /2 SMS not confirmed by WinSMS — check WinSMS sent history before resending/);

  const mixed = summariseBulkSmsDestinationOutcome(
    [{ status: "sent" }, { status: "failed" }, { status: "unconfirmed" }],
    3,
    1
  );
  assert.deepEqual(
    [mixed.successfulDestinations, mixed.failedDestinations, mixed.unconfirmedDestinations, mixed.status],
    [1, 1, 1, 207]
  );
  assert.equal(
    mixed.summary,
    "1 SMS sent. 1 SMS failed. 1 SMS not confirmed by WinSMS — check WinSMS sent history before resending these. 1 account skipped."
  );

  const allSent = summariseBulkSmsDestinationOutcome([{ status: "sent" }, { status: "sent" }], 1, 0);
  assert.deepEqual([allSent.ok, allSent.status], [true, 200]);
  assert.equal(allSent.summary, "Bulk SMS sent successfully to 2 destinations across 1 account.");
  const partial = summariseBulkSmsDestinationOutcome([{ status: "sent" }, { status: "failed" }], 2, 2);
  assert.equal(partial.summary, "1 SMS sent. 1 SMS failed. 2 accounts skipped.");
  const failed = summariseBulkSmsDestinationOutcome([{ status: "failed" }], 1, 0);
  assert.deepEqual([failed.ok, failed.status, failed.summary], [false, 502, "Bulk SMS send failed."]);
  console.log("  ✓ unconfirmed outcomes preserved separately; existing sent/partial/failed results unchanged");
}

function testErrorCodes() {
  assert.equal(safeBulkSmsErrorCode(new WinSmsApiError("Invalid API key re_live_secret", 401)), "WINSMS_401");
  assert.equal(safeBulkSmsErrorCode(new WinSmsApiError("WinSMS request timed out", 408)), "WINSMS_408");
  assert.equal(safeBulkSmsErrorCode(new TypeError("0821234567 bad")), "TypeError");
  assert.equal(safeBulkSmsErrorCode("Thandi"), "UNKNOWN");
  console.log("  ✓ error codes never include provider messages or credentials");
}

function testLogBuildersArePrivacySafe() {
  const diagnostics = createBulkStatementSmsSendDiagnostics();
  diagnostics.stage = "provider";
  diagnostics.providerAccepted = 3;
  diagnostics.providerRejected = 1;
  diagnostics.providerRejectCodes = { BADDEST: 1 };
  diagnostics.errorCodes = { WINSMS_401: 2 };
  diagnostics.resolveMs = 1200;
  diagnostics.providerMs = 900;

  const sendResult = {
    ok: true,
    status: 207,
    requestedAccountCount: 5,
    eligibleAccountCount: 4,
    skippedAccountCount: 1,
    attemptedDestinations: 6,
    successfulDestinations: 4,
    failedDestinations: 2,
    skippedAccounts: [
      { accountNo: "ACC-777", skipReason: "NOT_OUTSTANDING", contacts: [{ name: "Thandi Mokoena" }] },
    ],
    results: [
      {
        accountNo: "ACC-777",
        displayNames: ["Thandi Mokoena"],
        mobileMasked: "•••• 4567",
        status: "failed",
        error: "Invalid API key re_live_secret for 0821234567",
      },
    ],
    summary: "Your account is overdue",
  };
  const sendLog = buildBulkSmsSendCompletedLog("school-1", sendResult, diagnostics, 2500);
  assertNoPii(sendLog, "send completed log");
  assert.equal(sendLog.providerAccepted, 3);
  assert.equal(sendLog.providerRejected, 1);
  assert.equal(sendLog.failedDestinations, 2);
  assert.deepEqual(sendLog.skipReasons, { NOT_OUTSTANDING: 1 });
  assert.deepEqual(sendLog.errorCodes, { WINSMS_401: 2 });
  assert.equal(sendLog.durationMs, 2500);
  assert.equal(sendLog.resolveMs, 1200);
  assert.equal(sendLog.providerMs, 900);

  const previewResult = {
    ok: true,
    requestedAccountCount: 120,
    eligibleAccountCount: 100,
    skippedAccountCount: 20,
    destinationCount: 130,
    smsReady: true,
    outboundDisabled: false,
    canSend: true,
    sampleMessages: ["Your account is overdue"],
    recipients: [{ displayName: "Thandi Mokoena", mobileMasked: "•••• 4567", accountNo: "ACC-777" }],
    accounts: [
      { accountNo: "ACC-777", status: "skipped", skipReason: "NO_VALID_MOBILE", contacts: [{ email: "parent@example.test" }] },
      { accountNo: "ACC-777", status: "eligible", skipReason: null },
    ],
  };
  const previewLog = buildBulkSmsPreviewCompletedLog("school-1", previewResult, 14000);
  assertNoPii(previewLog, "preview completed log");
  assert.equal(previewLog.destinationCount, 130);
  assert.deepEqual(previewLog.skipReasons, { NO_VALID_MOBILE: 1 });
  assert.equal(previewLog.durationMs, 14000);
  console.log("  ✓ preview/send summary logs contain counts, codes, stages and timings only");
}

async function testWrappersEmitStartAndCompletion() {
  const events: Array<{ event: string; fields: Record<string, unknown> }> = [];
  setBulkStatementSmsLoggerForTests((event, fields) => events.push({ event, fields }));
  try {
    const preview = await previewBulkStatementSms({ schoolId: "school-1", familyAccountIds: [] });
    assert.equal(preview.ok, false);
    assert.deepEqual(
      events.map((e) => e.event),
      ["bulk_sms_preview_started", "bulk_sms_preview_completed"]
    );
    assert.equal(events[1].fields.code, "NO_ACCOUNTS_SELECTED");
    assert.equal(typeof events[1].fields.durationMs, "number");

    events.length = 0;
    const previous = process.env.DISABLE_OUTBOUND_SMS;
    process.env.DISABLE_OUTBOUND_SMS = "true";
    const send = await sendBulkStatementSms({
      schoolId: "school-1",
      familyAccountIds: ["fa-1", "fa-1", "fa-2"],
      messageTemplate: "Your account is overdue",
      mobileNumbers: ["0821234567"],
    });
    if (previous === undefined) delete process.env.DISABLE_OUTBOUND_SMS;
    else process.env.DISABLE_OUTBOUND_SMS = previous;
    assert.equal(send.ok, false);
    assert.equal(send.code, "OUTBOUND_SMS_DISABLED", "kill switch honoured — nothing sent");
    assert.deepEqual(
      events.map((e) => e.event),
      ["bulk_sms_send_started", "bulk_sms_send_completed"]
    );
    assert.equal(events[0].fields.requestedAccountCount, 2, "deduped account count");
    assert.equal(events[1].fields.code, "OUTBOUND_SMS_DISABLED");
    assert.equal(events[1].fields.httpStatus, 503);
    assert.equal(events[1].fields.attemptedDestinations, 0);
    assertNoPii(events, "emitted events");

    setBulkStatementSmsLoggerForTests(() => {
      throw new Error("logger down");
    });
    const stillWorks = await previewBulkStatementSms({ schoolId: "school-1", familyAccountIds: [] });
    assert.equal(stillWorks.ok, false, "a failing logger never breaks the request");
  } finally {
    setBulkStatementSmsLoggerForTests(null);
  }
  console.log("  ✓ preview/send emit started + completed events; kill switch path sends nothing");
}

async function main() {
  console.log("statementBulkSmsDiagnostics.unit.test.ts");
  testAcceptanceSummary();
  testHttp200OutcomeClassification();
  testUnconfirmedOutcomeSummary();
  testErrorCodes();
  testLogBuildersArePrivacySafe();
  await testWrappersEmitStartAndCompletion();
  console.log("statementBulkSmsDiagnostics.unit.test.ts: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
