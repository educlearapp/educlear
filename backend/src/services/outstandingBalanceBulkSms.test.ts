/**
 * Bulk outstanding-balance SMS. No WinSMS network and no production files.
 * Run: node --import tsx src/services/outstandingBalanceBulkSms.test.ts
 */
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { WinSmsApiError } from "./winSmsClient";
import { setOutstandingFeesReminderDataDirForTests } from "./outstandingFeesReminderSms";
import { setStatementBulkSmsDuplicateGuardDataDirForTests } from "./statementBulkSmsDuplicateGuard";
import { analyseSmsMessage, STATEMENT_SMS_MAX_SEGMENTS } from "./smsSegmentCalculator";
import {
  NEW_BALANCE_CAMPAIGN_AUTHORIZATION_CODE,
  NEW_BALANCE_CAMPAIGN_AUTHORIZATION_TEXT,
  OUTSTANDING_BALANCE_SMS_TEMPLATE,
  planOutstandingBalanceSms,
  previewOutstandingBalanceSms,
  sendOutstandingBalanceSms,
  type BalanceSnapshot,
} from "./outstandingBalanceBulkSms";

const FLY_EAGLE = "cmt1e8bjp0jo8lcjeketlynhl";
const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "obal-sms-"));
const balanceDir = path.join(root, "balance");
const statementDir = path.join(root, "statement");
fs.mkdirSync(balanceDir);
fs.mkdirSync(statementDir);
setOutstandingFeesReminderDataDirForTests(balanceDir);
setStatementBulkSmsDuplicateGuardDataDirForTests(statementDir);
const statementFile = path.join(statementDir, "statement-bulk-sms-operations.json");
fs.writeFileSync(statementFile, JSON.stringify({ operations: [{ operationId: "historical-october", schoolId: DA_SILVA }] }));
const historicalBefore = fs.readFileSync(statementFile, "utf8");

function snap(partial: Partial<BalanceSnapshot> & Pick<BalanceSnapshot, "familyAccountId">): BalanceSnapshot {
  const mobile = partial.contacts?.[0]?.mobileNumber ?? "27820000001";
  return {
    accountNo: partial.accountNo || "A1",
    schoolName: partial.schoolName || "Fly Eagle Primary",
    balance: partial.balance ?? 100,
    familyAccountId: partial.familyAccountId,
    contacts:
      partial.contacts ||
      (mobile
        ? [{ mobileNumber: mobile, mobileMasked: "•••• 0001", displayName: "Parent" }]
        : []),
  };
}

function resolver(rows: Record<string, BalanceSnapshot | null>) {
  return async (schoolId: string, familyAccountId: string) => rows[`${schoolId}:${familyAccountId}`] ?? null;
}

function testSharedPhoneKeepsEveryBalance() {
  const planned = planOutstandingBalanceSms({
    familyAccountIds: ["fa-1", "fa-2", "fa-3", "fa-4", "fa-5"],
    snapshots: [
      snap({ familyAccountId: "fa-1", accountNo: "FE001", balance: 150, contacts: [{ mobileNumber: "27821110000", mobileMasked: "•••• 0000", displayName: "Shared Parent" }] }),
      snap({ familyAccountId: "fa-2", accountNo: "FE002", balance: 75.5, contacts: [{ mobileNumber: "27821110000", mobileMasked: "•••• 0000", displayName: "Shared Parent" }] }),
      snap({ familyAccountId: "fa-3", accountNo: "FE003", balance: 0 }),
      snap({ familyAccountId: "fa-4", accountNo: "FE004", balance: -40 }),
      snap({ familyAccountId: "fa-5", accountNo: "FE005", balance: 20, contacts: [] }),
    ],
    template: OUTSTANDING_BALANCE_SMS_TEMPLATE,
  });
  assert.equal(planned.messages.length, 1);
  assert.match(planned.messages[0].message, /FE001/);
  assert.match(planned.messages[0].message, /R150/);
  assert.match(planned.messages[0].message, /FE002/);
  assert.match(planned.messages[0].message, /R75\.50/);
  assert.equal(planned.messages[0].message.includes("statement"), false);
  assert.equal(planned.skipped.some((row) => row.accountNo === "FE001"), false);
  assert.equal(planned.skipped.some((row) => row.accountNo === "FE002"), false);
  const reasons = planned.skipped.map((row) => `${row.accountNo}:${row.reason}`).sort();
  assert.deepEqual(reasons, ["FE003:NOT_OUTSTANDING", "FE004:NOT_OUTSTANDING", "FE005:NO_VALID_MOBILE"]);
  const counted = analyseSmsMessage(planned.messages[0].message);
  assert.equal(counted.encoding, "gsm");
  assert.equal(planned.messages[0].credits, counted.segments);
  console.log("  ✓ shared number lists every balance; zero, credit and invalid numbers are skipped");
}

function testUnicodeCreditsAndOverlongSharedNumber() {
  const unicode = planOutstandingBalanceSms({
    familyAccountIds: ["fa-u"],
    snapshots: [snap({ familyAccountId: "fa-u", accountNo: "U1", schoolName: "学校", balance: 10 })],
    template: OUTSTANDING_BALANCE_SMS_TEMPLATE,
  });
  assert.equal(unicode.messages[0].encoding, "ucs2");
  assert.equal(unicode.messages[0].credits, analyseSmsMessage(unicode.messages[0].message).credits);
  const bulky = `${OUTSTANDING_BALANCE_SMS_TEMPLATE}${"你".repeat(220)}`;
  const over = planOutstandingBalanceSms({
    familyAccountIds: ["fa-a", "fa-b"],
    snapshots: [
      snap({ familyAccountId: "fa-a", accountNo: "LONG1", schoolName: "学校", balance: 10, contacts: [{ mobileNumber: "27822220000", mobileMasked: "•••• 0000", displayName: "P" }] }),
      snap({ familyAccountId: "fa-b", accountNo: "LONG2", schoolName: "学校", balance: 20, contacts: [{ mobileNumber: "27822220000", mobileMasked: "•••• 0000", displayName: "P" }] }),
    ],
    template: bulky,
  });
  assert.equal(over.messages.length, 0);
  assert.equal(over.skipped.length, 2);
  assert.ok(over.skipped.every((row) => row.reason === "MESSAGE_TOO_LONG"));
  assert.match(over.skipped[0].detail, /LONG1/);
  assert.match(over.skipped[0].detail, /LONG2/);
  assert.ok(analyseSmsMessage("你".repeat(180)).segments <= STATEMENT_SMS_MAX_SEGMENTS);
  console.log("  ✓ UCS-2 credits match the counter; an over-long shared SMS skips every account");
}

async function testTenantsPreviewAndHistory() {
  const rows = {
    [`${FLY_EAGLE}:fa-1`]: snap({ familyAccountId: "fa-1", accountNo: "FE100", balance: 500, schoolName: "Fly Eagle Primary" }),
    [`school-b:fa-9`]: snap({ familyAccountId: "fa-9", accountNo: "OT9", balance: 10, schoolName: "Other School" }),
  };
  const fly = await previewOutstandingBalanceSms({
    schoolId: FLY_EAGLE,
    familyAccountIds: ["fa-1", "fa-9"],
    now: new Date("2026-11-06T10:00:00.000Z"),
    deps: { resolveAccount: resolver(rows), smsReady: async () => true, outboundDisabled: true },
  });
  assert.equal(fly.ok, true);
  if (!fly.ok) return;
  assert.equal(fly.messages.length, 1);
  assert.equal(fly.messages[0].accountNo, "FE100");
  assert.match(String(fly.messages[0].message), /Fly Eagle Primary/);
  assert.equal(fly.messages.some((row) => String(row.message).includes("OT9")), false);
  assert.equal(fly.canSend, false);
  assert.equal(fly.outboundDisabled, true);
  assert.equal(fly.skipped.some((row) => row.reason === "ACCOUNT_NOT_FOUND" && row.familyAccountId === "fa-9"), true);
  const other = await previewOutstandingBalanceSms({
    schoolId: "school-b",
    familyAccountIds: ["fa-9"],
    now: new Date("2026-11-06T10:00:00.000Z"),
    deps: { resolveAccount: resolver(rows), smsReady: async () => true, outboundDisabled: true },
  });
  assert.equal(other.ok && other.messages[0].accountNo, "OT9");
  console.log("  ✓ Fly Eagle preview is isolated from another school's account");
}

async function testSendProtection() {
  const calls: string[] = [];
  const rows = {
    "school-a:fa-1": snap({ familyAccountId: "fa-1", accountNo: "A1", balance: 80, contacts: [{ mobileNumber: "27823330000", mobileMasked: "•••• 0000", displayName: "A" }] }),
    "school-a:fa-2": snap({ familyAccountId: "fa-2", accountNo: "A2", balance: 90, contacts: [{ mobileNumber: "27823330000", mobileMasked: "•••• 0000", displayName: "A" }] }),
    [`${FLY_EAGLE}:fa-1`]: snap({ familyAccountId: "fa-1", accountNo: "FE1", balance: 40 }),
  };
  const deps = {
    resolveAccount: resolver(rows),
    smsReady: async () => true,
    outboundDisabled: false,
    sendSms: async (schoolId: string) => {
      calls.push(schoolId);
      return { recipients: [{ accepted: true }] };
    },
  };
  const first = await sendOutstandingBalanceSms({
    schoolId: "school-a",
    familyAccountIds: ["fa-1", "fa-2"],
    sendInstanceId: "11111111-1111-4111-8111-111111111111",
    now: new Date("2026-11-06T10:00:00.000Z"),
    deps,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(calls.length, 1);
  assert.match(String(first.messages?.[0].message), /A1/);
  assert.match(String(first.messages?.[0].message), /A2/);
  assert.equal(first.accepted, 1);
  assert.equal(first.handsetDelivered, null);
  const replay = await sendOutstandingBalanceSms({
    schoolId: "school-a",
    familyAccountIds: ["fa-1", "fa-2"],
    sendInstanceId: "11111111-1111-4111-8111-111111111111",
    now: new Date("2026-11-06T10:05:00.000Z"),
    deps,
  });
  assert.equal(replay.ok && replay.replayed, true);
  assert.equal(calls.length, 1);
  const blocked = await sendOutstandingBalanceSms({
    schoolId: "school-a",
    familyAccountIds: ["fa-1", "fa-2"],
    sendInstanceId: "22222222-2222-4222-8222-222222222222",
    now: new Date("2026-11-06T10:06:00.000Z"),
    deps,
  });
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.code, NEW_BALANCE_CAMPAIGN_AUTHORIZATION_CODE);
  assert.equal(calls.length, 1);
  const again = await sendOutstandingBalanceSms({
    schoolId: "school-a",
    familyAccountIds: ["fa-1", "fa-2"],
    sendInstanceId: "33333333-3333-4333-8333-333333333333",
    authorizationText: NEW_BALANCE_CAMPAIGN_AUTHORIZATION_TEXT,
    now: new Date("2026-11-06T10:07:00.000Z"),
    deps,
  });
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.providerCalled, false);
  assert.equal(calls.length, 1);
  assert.match(String(again.summary), /not contacted again/);
  assert.match(String(again.messages?.[0].message), /A1/);
  assert.match(String(again.messages?.[0].message), /A2/);
  const fly = await sendOutstandingBalanceSms({
    schoolId: FLY_EAGLE,
    familyAccountIds: ["fa-1"],
    sendInstanceId: "44444444-4444-4444-8444-444444444444",
    now: new Date("2026-11-06T10:08:00.000Z"),
    deps,
  });
  assert.equal(fly.ok, true);
  assert.deepEqual(calls, ["school-a", FLY_EAGLE]);
  console.log("  ✓ replay, new-campaign confirmation and school isolation do not resend");
}

async function testProviderFailureAndConcurrency() {
  const calls: string[] = [];
  const rows = {
    "school-timeout:fa-f": snap({ familyAccountId: "fa-f", accountNo: "FAIL1", contacts: [{ mobileNumber: "27824440000", mobileMasked: "•••• 0000", displayName: "F" }] }),
  };
  const failed = await sendOutstandingBalanceSms({
    schoolId: "school-timeout",
    familyAccountIds: ["fa-f"],
    sendInstanceId: "55555555-5555-4555-8555-555555555555",
    now: new Date("2026-11-06T11:00:00.000Z"),
    deps: {
      resolveAccount: resolver(rows),
      smsReady: async () => true,
      outboundDisabled: false,
      sendSms: async () => {
        throw new WinSmsApiError("WinSMS request timed out", 408);
      },
    },
  });
  assert.equal(failed.ok, true);
  if (!failed.ok) return;
  assert.equal(failed.pending, 1);
  assert.equal(failed.accepted, 0);
  const retry = await sendOutstandingBalanceSms({
    schoolId: "school-timeout",
    familyAccountIds: ["fa-f"],
    sendInstanceId: "66666666-6666-4666-8666-666666666666",
    authorizationText: NEW_BALANCE_CAMPAIGN_AUTHORIZATION_TEXT,
    now: new Date("2026-11-06T11:05:00.000Z"),
    deps: {
      resolveAccount: resolver(rows),
      smsReady: async () => true,
      outboundDisabled: false,
      sendSms: async () => {
        calls.push("should-not");
        return { recipients: [{ accepted: true }] };
      },
    },
  });
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.providerCalled, false);
  assert.equal(retry.pending, 1);
  assert.equal(calls.length, 0);
  assert.match(String(retry.summary), /not contacted again/);

  let release: (value: unknown) => void = () => undefined;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const concurrentDeps = {
    resolveAccount: resolver({
      "school-c:fa-c": snap({ familyAccountId: "fa-c", accountNo: "C1", contacts: [{ mobileNumber: "27825550000", mobileMasked: "•••• 0000", displayName: "C" }] }),
    }),
    smsReady: async () => true,
    outboundDisabled: false,
    sendSms: async () => {
      calls.push("concurrent");
      return gate;
    },
  };
  const firstPromise = sendOutstandingBalanceSms({
    schoolId: "school-c",
    familyAccountIds: ["fa-c"],
    sendInstanceId: "77777777-7777-4777-8777-777777777777",
    now: new Date("2026-11-06T12:00:00.000Z"),
    deps: concurrentDeps,
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const second = await sendOutstandingBalanceSms({
    schoolId: "school-c",
    familyAccountIds: ["fa-c"],
    sendInstanceId: "77777777-7777-4777-8777-777777777777",
    now: new Date("2026-11-06T12:00:01.000Z"),
    deps: concurrentDeps,
  });
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.code, "BALANCE_SMS_IN_PROGRESS");
  release({ recipients: [{ accepted: false, acceptError: "REJECTED" }] });
  const first = await firstPromise;
  assert.equal(first.ok && first.failed, 1);
  assert.equal(calls.filter((row) => row === "concurrent").length, 1);
  const rejectedAgain = await sendOutstandingBalanceSms({
    schoolId: "school-c",
    familyAccountIds: ["fa-c"],
    sendInstanceId: "88888888-8888-4888-8888-888888888888",
    authorizationText: NEW_BALANCE_CAMPAIGN_AUTHORIZATION_TEXT,
    now: new Date("2026-11-06T12:10:00.000Z"),
    deps: {
      ...concurrentDeps,
      sendSms: async () => {
        calls.push("after-reject");
        return { recipients: [{ accepted: true }] };
      },
    },
  });
  assert.equal(rejectedAgain.ok && rejectedAgain.accepted, 1);
  assert.equal(calls.filter((row) => row === "after-reject").length, 1);
  console.log("  ✓ timeout is unconfirmed and not retried; rejection can be sent only as a new campaign");
}

function testHistoricalStatementFileUntouched() {
  assert.equal(fs.readFileSync(statementFile, "utf8"), historicalBefore);
  const raw = fs.readFileSync(path.join(balanceDir, "outstanding-fees-reminder-campaigns.json"), "utf8");
  assert.equal(raw.includes(DA_SILVA), false);
  assert.equal(raw.includes("2782"), false);
  console.log("  ✓ historical statement campaign file was not rewritten and raw mobiles were not stored");
}

async function testLowCreditWarningUsesInjectedBalanceOnly() {
  const calls: string[] = [];
  const low = await previewOutstandingBalanceSms({
    schoolId: "school-credit",
    familyAccountIds: ["fa-credit"],
    now: new Date("2026-11-06T12:00:00.000Z"),
    deps: {
      resolveAccount: resolver({
        "school-credit:fa-credit": snap({
          familyAccountId: "fa-credit",
          accountNo: "CR1",
          contacts: [{ mobileNumber: "27821110000", mobileMasked: "•••• 0000", displayName: "Credit" }],
        }),
      }),
      smsReady: async () => true,
      outboundDisabled: false,
      readCreditBalance: async () => {
        calls.push("balance");
        return { ok: true, creditBalance: 0 };
      },
      sendSms: async () => {
        calls.push("send");
        return { recipients: [{ accepted: true }] };
      },
    },
  });
  assert.equal(low.ok, true);
  if (!low.ok) return;
  assert.equal(low.creditBalanceIsCurrent, true);
  assert.equal(low.creditBalance, 0);
  assert.match(String(low.creditWarning), /exhausted/);
  assert.equal(calls.includes("send"), false);

  const unchecked = await previewOutstandingBalanceSms({
    schoolId: "school-credit",
    familyAccountIds: ["fa-credit"],
    now: new Date("2026-11-06T12:00:00.000Z"),
    deps: {
      resolveAccount: resolver({
        "school-credit:fa-credit": snap({
          familyAccountId: "fa-credit",
          accountNo: "CR1",
          contacts: [{ mobileNumber: "27821110000", mobileMasked: "•••• 0000", displayName: "Credit" }],
        }),
      }),
      smsReady: async () => true,
      outboundDisabled: true,
    },
  });
  assert.equal(unchecked.ok, true);
  if (!unchecked.ok) return;
  assert.equal(unchecked.creditBalance, null);
  assert.equal(unchecked.creditBalanceIsCurrent, false);
  assert.match(String(unchecked.creditWarning), /not this school's current balance/);
  console.log("  ✓ a live zero balance warns, and a disabled check does not reuse a snapshot");
}

async function main() {
  console.log("outstandingBalanceBulkSms.test.ts");
  testSharedPhoneKeepsEveryBalance();
  testUnicodeCreditsAndOverlongSharedNumber();
  await testTenantsPreviewAndHistory();
  await testSendProtection();
  await testProviderFailureAndConcurrency();
  await testLowCreditWarningUsesInjectedBalanceOnly();
  testHistoricalStatementFileUntouched();
  console.log("outstandingBalanceBulkSms.test.ts: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
