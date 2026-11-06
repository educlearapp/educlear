/**
 * Outstanding fees reminder SMS. No WinSMS network and no production files.
 * Run: node --import tsx src/services/outstandingFeesReminderSms.test.ts
 */
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { WinSmsApiError } from "./winSmsClient";
import {
  DA_SILVA_NOVEMBER_2026_STATEMENT_SMS_HOLD,
  HISTORICAL_STATEMENT_SMS_HOLD_CODE,
  claimStatementBulkSmsSend,
  readStatementBulkSmsOperationsForTests,
  setStatementBulkSmsDuplicateGuardDataDirForTests,
} from "./statementBulkSmsDuplicateGuard";
import {
  NEW_CAMPAIGN_AUTHORIZATION_CODE,
  NEW_CAMPAIGN_AUTHORIZATION_TEXT,
  OUTSTANDING_FEES_REMINDER_MESSAGE_TYPE,
  OUTSTANDING_FEES_REMINDER_TEMPLATE,
  buildOutstandingFeesReminderMessage,
  formatReminderAmount,
  hashReminderPhone,
  previewOutstandingFeesReminder,
  renderOutstandingFeesReminderTemplate,
  validateOutstandingFeesReminderTemplate,
  readOutstandingFeesReminderCampaignsForTests,
  sendOutstandingFeesReminder,
  setOutstandingFeesReminderDataDirForTests,
  type ReminderAccountSnapshot,
} from "./outstandingFeesReminderSms";
import { analyseSmsMessage } from "./smsSegmentCalculator";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ofee-reminder-"));
const reminderDir = path.join(root, "reminder");
const statementDir = path.join(root, "statement");
fs.mkdirSync(reminderDir);
fs.mkdirSync(statementDir);
setOutstandingFeesReminderDataDirForTests(reminderDir);
setStatementBulkSmsDuplicateGuardDataDirForTests(statementDir);

function snap(partial: Partial<ReminderAccountSnapshot> & Pick<ReminderAccountSnapshot, "familyAccountId">): ReminderAccountSnapshot {
  return {
    accountNo: partial.accountNo || "A1",
    schoolName: partial.schoolName || "Da Silva Academy",
    balance: partial.balance ?? 1200,
    displayName: partial.displayName || "A Parent",
    mobileNumber: partial.mobileNumber ?? "27821234567",
    mobileMasked: partial.mobileMasked || "•••• 4567",
    familyAccountId: partial.familyAccountId,
  };
}

function resolver(rows: Record<string, ReminderAccountSnapshot | null>) {
  return async (schoolId: string, familyAccountId: string) => {
    if (schoolId !== "school-a" && schoolId !== DA_SILVA_NOVEMBER_2026_STATEMENT_SMS_HOLD.schoolId) return null;
    return rows[`${schoolId}:${familyAccountId}`] ?? null;
  };
}

function testSegmentsAndShortBody() {
  assert.equal(formatReminderAmount(1200), "R1,200");
  assert.equal(formatReminderAmount(10.5), "R10.50");
  const text = buildOutstandingFeesReminderMessage({
    schoolName: "Da Silva Academy",
    accountNo: "DS001",
    balance: 969,
  });
  assert.equal(text.includes("statement"), false);
  assert.equal(text.includes("ledger"), false);
  const counted = analyseSmsMessage(text);
  assert.equal(counted.encoding, "gsm");
  assert.equal(counted.segments, 1);
  assert.equal(counted.credits, 1);
  const unicode = buildOutstandingFeesReminderMessage({
    schoolName: "School ✓",
    accountNo: "E1",
    balance: 10,
  });
  const ucs = analyseSmsMessage(unicode);
  assert.equal(ucs.encoding, "ucs2");
  assert.equal(ucs.credits, ucs.segments);
  console.log("  ✓ short reminder is GSM-7; non-GSM school names switch to UCS-2 credits");
}

async function testPreviewDedupesAndSkips() {
  const rows = {
    "school-a:fa-1": snap({ familyAccountId: "fa-1", accountNo: "A1", mobileNumber: "27820000001", balance: 100 }),
    "school-a:fa-2": snap({ familyAccountId: "fa-2", accountNo: "A2", mobileNumber: "27820000001", balance: 50 }),
    "school-a:fa-3": snap({ familyAccountId: "fa-3", accountNo: "A3", mobileNumber: "27820000003", balance: 0 }),
    "school-a:fa-4": snap({ familyAccountId: "fa-4", accountNo: "A4", mobileNumber: "27820000004", balance: -20 }),
    "school-a:fa-5": snap({ familyAccountId: "fa-5", accountNo: "A5", mobileNumber: "", balance: 80 }),
  };
  const preview = await previewOutstandingFeesReminder({
    schoolId: "school-a",
    familyAccountIds: ["fa-1", "fa-1", "fa-2", "fa-3", "fa-4", "fa-5", "fa-missing"],
    now: new Date("2026-11-06T08:00:00.000Z"),
    deps: { resolveAccount: resolver(rows), smsReady: async () => true, outboundDisabled: true },
  });
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.equal(preview.messageType, OUTSTANDING_FEES_REMINDER_MESSAGE_TYPE);
  assert.equal(preview.uniquePhones, 1);
  assert.equal(preview.totalCredits, 1);
  assert.equal(preview.messages[0].message.includes("A1"), true);
  assert.equal(preview.messages[0].encoding, "gsm");
  const reasons = preview.skipped.map((row) => row.reason).sort();
  assert.deepEqual(reasons, ["DUPLICATE_ACCOUNT", "DUPLICATE_PHONE", "NOT_OUTSTANDING", "NOT_OUTSTANDING", "NO_VALID_MOBILE", "ACCOUNT_NOT_FOUND"].sort());
  console.log("  ✓ preview keeps one phone, drops zero/credit/invalid/duplicate accounts");
}

async function testOctoberHistoryAndNewCampaign() {
  const before = readStatementBulkSmsOperationsForTests().length;
  const statement = claimStatementBulkSmsSend({
    schoolId: DA_SILVA_NOVEMBER_2026_STATEMENT_SMS_HOLD.schoolId,
    billingPeriod: "2026-11",
    recipientStrategy: "all_eligible",
    recipientKeys: ["fa-real:parent-real"],
    now: new Date("2026-11-06T08:00:00.000Z"),
  });
  assert.equal(statement.claimed, false);
  if (!statement.claimed) assert.equal(statement.response.code, HISTORICAL_STATEMENT_SMS_HOLD_CODE);

  const rows = {
    [`${DA_SILVA_NOVEMBER_2026_STATEMENT_SMS_HOLD.schoolId}:fa-9`]: snap({
      familyAccountId: "fa-9",
      accountNo: "DS9",
      mobileNumber: "27821111111",
    }),
  };
  const blocked = await sendOutstandingFeesReminder({
    schoolId: DA_SILVA_NOVEMBER_2026_STATEMENT_SMS_HOLD.schoolId,
    familyAccountIds: ["fa-9"],
    sendInstanceId: "11111111-1111-4111-8111-111111111111",
    authorizationText: "bypass",
    now: new Date("2026-11-06T08:00:00.000Z"),
    deps: {
      resolveAccount: resolver(rows),
      smsReady: async () => true,
      outboundDisabled: false,
      sendSms: async () => {
        throw new Error("provider must not be called");
      },
    },
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.code, NEW_CAMPAIGN_AUTHORIZATION_CODE);

  let calls = 0;
  const sent = await sendOutstandingFeesReminder({
    schoolId: DA_SILVA_NOVEMBER_2026_STATEMENT_SMS_HOLD.schoolId,
    familyAccountIds: ["fa-9"],
    sendInstanceId: "22222222-2222-4222-8222-222222222222",
    authorizationText: NEW_CAMPAIGN_AUTHORIZATION_TEXT,
    now: new Date("2026-11-06T08:00:00.000Z"),
    deps: {
      resolveAccount: resolver(rows),
      smsReady: async () => true,
      outboundDisabled: false,
      sendSms: async () => {
        calls += 1;
        return { recipients: [{ accepted: true }] };
      },
    },
  });
  assert.equal(sent.ok, true);
  if (sent.ok) {
    assert.equal(sent.accepted, 1);
    assert.equal(sent.handsetDelivered, null);
    assert.match(sent.summary, /not handset delivery/i);
  }
  assert.equal(calls, 1);
  assert.equal(readStatementBulkSmsOperationsForTests().length, before);
  const statementRaw = fs.existsSync(path.join(statementDir, "statement-bulk-sms-operations.json"))
    ? fs.readFileSync(path.join(statementDir, "statement-bulk-sms-operations.json"), "utf8")
    : "";
  assert.equal(statementRaw.includes("fa-9"), false);
  assert.equal(statementRaw.includes("parent-real"), false);
  const reminderRaw = fs.readFileSync(path.join(reminderDir, "outstanding-fees-reminder-campaigns.json"), "utf8");
  assert.equal(reminderRaw.includes("27821111111"), false);
  assert.equal(reminderRaw.includes(hashReminderPhone("27821111111")), true);
  assert.equal(readOutstandingFeesReminderCampaignsForTests()[0].messageType, OUTSTANDING_FEES_REMINDER_MESSAGE_TYPE);
  console.log("  ✓ October statement hold stays empty of invented recipients; reminder is a separate campaign");
}

async function testRepeatPartialTimeoutAndTenant() {
  const rows = {
    "school-a:fa-1": snap({ familyAccountId: "fa-1", accountNo: "A1", mobileNumber: "27820000001" }),
    "school-a:fa-2": snap({ familyAccountId: "fa-2", accountNo: "A2", mobileNumber: "27820000002" }),
    "school-a:fa-hold": snap({ familyAccountId: "fa-hold", accountNo: "AH", mobileNumber: "27820000077" }),
  };
  let calls = 0;
  const sendSms = async (_schoolId: string, input: { mobileNumber: string }) => {
    calls += 1;
    if (input.mobileNumber.endsWith("1")) return { recipients: [{ accepted: true }] };
    return { recipients: [{ accepted: false, acceptError: "REJECTED" }] };
  };
  const instance = "33333333-3333-4333-8333-333333333333";
  const deps = {
    resolveAccount: resolver(rows),
    smsReady: async () => true,
    outboundDisabled: false,
    sendSms,
  };
  const first = await sendOutstandingFeesReminder({
    schoolId: "school-a",
    familyAccountIds: ["fa-1", "fa-2"],
    sendInstanceId: instance,
    now: new Date("2026-11-06T09:00:00.000Z"),
    deps,
  });
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.accepted, 1);
    assert.equal(first.failed, 1);
    assert.equal(first.pending, 0);
  }
  const second = await sendOutstandingFeesReminder({
    schoolId: "school-a",
    familyAccountIds: ["fa-1", "fa-2"],
    sendInstanceId: instance,
    now: new Date("2026-11-06T09:00:05.000Z"),
    deps,
  });
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.replayed, true);
  assert.equal(calls, 2);

  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const heldInstance = "77777777-7777-4777-8777-777777777777";
  const held = sendOutstandingFeesReminder({
    schoolId: "school-a",
    familyAccountIds: ["fa-hold"],
    sendInstanceId: heldInstance,
    authorizationText: NEW_CAMPAIGN_AUTHORIZATION_TEXT,
    now: new Date("2026-11-06T09:01:00.000Z"),
    deps: {
      ...deps,
      sendSms: () => gate.then(() => ({ recipients: [{ accepted: true }] })),
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const overlap = await sendOutstandingFeesReminder({
    schoolId: "school-a",
    familyAccountIds: ["fa-hold"],
    sendInstanceId: heldInstance,
    authorizationText: NEW_CAMPAIGN_AUTHORIZATION_TEXT,
    now: new Date("2026-11-06T09:01:01.000Z"),
    deps,
  });
  assert.equal(overlap.ok, false);
  if (!overlap.ok) assert.equal(overlap.code, "REMINDER_IN_PROGRESS");
  release();
  const heldResult = await held;
  assert.equal(heldResult.ok, true);

  const timeoutInstance = "44444444-4444-4444-8444-444444444444";
  const timed = await sendOutstandingFeesReminder({
    schoolId: "school-a",
    familyAccountIds: ["fa-2"],
    sendInstanceId: timeoutInstance,
    authorizationText: NEW_CAMPAIGN_AUTHORIZATION_TEXT,
    now: new Date("2026-11-06T09:05:00.000Z"),
    deps: {
      ...deps,
      sendSms: async () => {
        throw new WinSmsApiError("timeout", 408);
      },
    },
  });
  assert.equal(timed.ok, true);
  if (timed.ok) {
    assert.equal(timed.pending, 1);
    assert.equal(timed.providerCalled, true);
  }
  const retryTimeout = await sendOutstandingFeesReminder({
    schoolId: "school-a",
    familyAccountIds: ["fa-2"],
    sendInstanceId: "55555555-5555-4555-8555-555555555555",
    authorizationText: NEW_CAMPAIGN_AUTHORIZATION_TEXT,
    now: new Date("2026-11-06T09:06:00.000Z"),
    deps: {
      ...deps,
      sendSms: async () => {
        throw new Error("silent retry");
      },
    },
  });
  assert.equal(retryTimeout.ok, true);
  if (retryTimeout.ok) {
    assert.equal(retryTimeout.providerCalled, false);
    assert.equal(retryTimeout.pending, 1);
  }

  const otherSchool = await sendOutstandingFeesReminder({
    schoolId: "school-b",
    familyAccountIds: ["fa-1"],
    sendInstanceId: "66666666-6666-4666-8666-666666666666",
    now: new Date("2026-11-06T09:07:00.000Z"),
    deps,
  });
  assert.equal(otherSchool.ok, false);
  if (!otherSchool.ok) assert.equal(otherSchool.code, "NO_ELIGIBLE_DESTINATIONS");
  console.log("  ✓ repeat click, partial acceptance, timeout, and other-school selection stay safe");
}

async function testEditableTemplateStaysSeparate() {
  assert.equal(
    OUTSTANDING_FEES_REMINDER_TEMPLATE,
    "{{schoolName}}: Acc {{accountNo}} owes {{amount}}. Please pay outstanding fees."
  );
  assert.equal(OUTSTANDING_FEES_REMINDER_TEMPLATE.includes("view your statement"), false);
  assert.equal(validateOutstandingFeesReminderTemplate("{{schoolName}} only").ok, false);
  assert.equal(validateOutstandingFeesReminderTemplate("{{schoolName}} {{accountNo}} {{amount}} {{balance}}").ok, false);
  assert.equal(validateOutstandingFeesReminderTemplate(`${"{{schoolName}} {{accountNo}} {{amount}} "}${"x".repeat(280)}`).ok, false);
  const custom = "Please pay {{amount}} for account {{accountNo}} at {{schoolName}}.";
  const rendered = renderOutstandingFeesReminderTemplate(custom, {
    schoolName: "School ✓",
    accountNo: "A9",
    balance: 1200,
  });
  const counted = analyseSmsMessage(rendered);
  assert.equal(counted.encoding, "ucs2");
  assert.equal(counted.credits, counted.segments);
  assert.equal(rendered.includes("R1,200"), true);

  const rows = {
    "school-a:fa-custom": snap({
      familyAccountId: "fa-custom",
      accountNo: "C1",
      mobileNumber: "27820000999",
      balance: 80,
      schoolName: "Local School",
    }),
  };
  const preview = await previewOutstandingFeesReminder({
    schoolId: "school-a",
    familyAccountIds: ["fa-custom"],
    messageTemplate: custom,
    now: new Date("2026-11-06T11:00:00.000Z"),
    deps: { resolveAccount: resolver(rows), smsReady: async () => true, outboundDisabled: true },
  });
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.equal(preview.template, custom);
  assert.equal(preview.messages[0].message, "Please pay R80 for account C1 at Local School.");
  assert.equal(preview.messages[0].encoding, "gsm");
  assert.equal(preview.totalCredits, 1);

  const instance = "99999999-9999-4999-8999-999999999999";
  let sentMessage = "";
  const sent = await sendOutstandingFeesReminder({
    schoolId: "school-a",
    familyAccountIds: ["fa-custom"],
    sendInstanceId: instance,
    messageTemplate: custom,
    authorizationText: NEW_CAMPAIGN_AUTHORIZATION_TEXT,
    now: new Date("2026-11-06T11:01:00.000Z"),
    deps: {
      resolveAccount: resolver(rows),
      smsReady: async () => true,
      outboundDisabled: false,
      sendSms: async (_schoolId, input) => {
        sentMessage = input.message;
        return { recipients: [{ accepted: true }] };
      },
    },
  });
  assert.equal(sent.ok, true);
  assert.equal(sentMessage, preview.messages[0].message);
  const changed = await sendOutstandingFeesReminder({
    schoolId: "school-a",
    familyAccountIds: ["fa-custom"],
    sendInstanceId: instance,
    messageTemplate: "Now due {{amount}} on {{accountNo}} from {{schoolName}}.",
    authorizationText: NEW_CAMPAIGN_AUTHORIZATION_TEXT,
    now: new Date("2026-11-06T11:02:00.000Z"),
    deps: {
      resolveAccount: resolver(rows),
      smsReady: async () => true,
      outboundDisabled: false,
      sendSms: async () => {
        throw new Error("provider must not be called");
      },
    },
  });
  assert.equal(changed.ok, false);
  if (!changed.ok) assert.equal(changed.code, "SEND_INSTANCE_MISMATCH");
  const stored = readOutstandingFeesReminderCampaignsForTests().find((row) => row.sendInstanceId === instance);
  assert.equal(stored?.messageTemplate, custom);
  assert.equal(stored?.recipients[0]?.message, sentMessage);

  let resent = 0;
  const otherWording = await sendOutstandingFeesReminder({
    schoolId: "school-a",
    familyAccountIds: ["fa-custom"],
    sendInstanceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    messageTemplate: "Now due {{amount}} on {{accountNo}} from {{schoolName}}.",
    authorizationText: NEW_CAMPAIGN_AUTHORIZATION_TEXT,
    now: new Date("2026-11-06T11:03:00.000Z"),
    deps: {
      resolveAccount: resolver(rows),
      smsReady: async () => true,
      outboundDisabled: false,
      sendSms: async () => {
        resent += 1;
        return { recipients: [{ accepted: true }] };
      },
    },
  });
  assert.equal(otherWording.ok, true);
  if (otherWording.ok) assert.equal(otherWording.providerCalled, false);
  assert.equal(resent, 0);
  assert.equal(stored?.messageTemplate, custom);
  console.log("  ✓ custom reminder wording is validated, priced, stored, and does not resend accepted numbers");
}

async function main() {
  console.log("outstandingFeesReminderSms.test.ts");
  testSegmentsAndShortBody();
  await testPreviewDedupesAndSkips();
  await testOctoberHistoryAndNewCampaign();
  await testRepeatPartialTimeoutAndTenant();
  await testEditableTemplateStaysSeparate();
  console.log("outstandingFeesReminderSms.test.ts: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
