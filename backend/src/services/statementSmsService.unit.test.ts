/**
 * Statement SMS Phase A — unit tests.
 * Run: npx ts-node --transpile-only src/services/statementSmsService.unit.test.ts
 */
import assert from "assert";
import {
  buildDefaultStatementSmsMessage,
  buildStatementSmsDestinations,
  classifyStatementSmsBalance,
  formatStatementSmsAmount,
  isStatementSmsBillingContact,
  isValidStatementSmsMobile,
  maskStatementSmsMobile,
  rankStatementSmsContacts,
  sanitiseStatementSmsMessage,
  selectStatementSmsPairs,
  statementSmsContactScore,
  STATEMENT_SMS_MAX_CHARS,
  type StatementSmsParentPair,
} from "./statementSmsService";
import { evaluateStatementSendAuth } from "../middleware/requireStatementSendAuth";

function pair(overrides: {
  id?: string;
  cellNo?: string;
  communicationBilling?: boolean;
  communicationBySMS?: boolean;
  billingStatement?: boolean;
  isPrimary?: boolean;
  isPayingPerson?: boolean;
  firstName?: string;
  surname?: string;
  schoolId?: string;
}): StatementSmsParentPair {
  return {
    parent: {
      id: overrides.id || "p1",
      schoolId: overrides.schoolId || "school-1",
      firstName: overrides.firstName || "Ann",
      surname: overrides.surname || "Parent",
      cellNo: overrides.cellNo ?? "0821234567",
      communicationBilling: overrides.communicationBilling ?? true,
      communicationBySMS: overrides.communicationBySMS ?? true,
    },
    link: {
      billingStatement: overrides.billingStatement ?? true,
      isPrimary: overrides.isPrimary ?? true,
      isPayingPerson: overrides.isPayingPerson ?? false,
      relation: "Mother",
    },
  };
}

function testBalanceClassification() {
  assert.strictEqual(classifyStatementSmsBalance(9000), "outstanding");
  assert.strictEqual(classifyStatementSmsBalance(0.01), "outstanding");
  assert.strictEqual(classifyStatementSmsBalance(0), "settled");
  assert.strictEqual(classifyStatementSmsBalance(-9000), "credit");
  assert.strictEqual(classifyStatementSmsBalance(-0.01), "credit");
}

function testOutstandingWording() {
  const msg = buildDefaultStatementSmsMessage({
    schoolName: "Test School",
    accountNo: "ABC001",
    balance: 1200,
  });
  assert.strictEqual(msg.balanceClass, "outstanding");
  assert.ok(msg.text.includes("outstanding balance"));
  assert.ok(msg.text.includes(formatStatementSmsAmount(1200)));
  assert.ok(msg.text.includes("ABC001"));
  assert.ok(!msg.text.toLowerCase().includes("learner"));
  assert.ok(!/\bID\b/i.test(msg.text));
}

function testZeroNeverOutstanding() {
  const msg = buildDefaultStatementSmsMessage({
    schoolName: "Test School",
    accountNo: "ABC001",
    balance: 0,
  });
  assert.strictEqual(msg.balanceClass, "settled");
  assert.ok(!msg.text.toLowerCase().includes("outstanding"));
  assert.ok(msg.text.includes("is available"));
}

function testCreditNeverOutstanding() {
  const msg = buildDefaultStatementSmsMessage({
    schoolName: "Test School",
    accountNo: "ABC001",
    balance: -9000,
  });
  assert.strictEqual(msg.balanceClass, "credit");
  assert.ok(!msg.text.toLowerCase().includes("outstanding"));
  assert.ok(!msg.text.includes(formatStatementSmsAmount(-9000)) || !msg.text.includes("owes"));
  assert.ok(msg.text.includes("is available"));
}

function testEligibilityFlags() {
  assert.ok(isStatementSmsBillingContact(pair({})));
  assert.ok(!isStatementSmsBillingContact(pair({ billingStatement: false })));
  assert.ok(!isStatementSmsBillingContact(pair({ communicationBilling: false })));
  assert.ok(!isStatementSmsBillingContact(pair({ communicationBySMS: false })));
  assert.ok(!isStatementSmsBillingContact(pair({ cellNo: "" })));
  assert.ok(!isStatementSmsBillingContact(pair({ cellNo: "123" })));
}

function testRecommendedRanking() {
  const primary = pair({
    id: "rec",
    isPrimary: true,
    isPayingPerson: true,
    firstName: "Recommended",
  });
  const secondary = pair({
    id: "other",
    isPrimary: false,
    isPayingPerson: false,
    firstName: "Other",
    cellNo: "0831112233",
  });
  assert.ok(statementSmsContactScore(primary) > statementSmsContactScore(secondary));
  const ranked = rankStatementSmsContacts([secondary, primary]);
  assert.strictEqual(ranked[0].parentId, "rec");
  assert.strictEqual(ranked[0].recommended, true);
  assert.strictEqual(ranked[1].recommended, false);
}

function testSelectParent1Only() {
  const p1 = pair({ id: "p1", cellNo: "0821111111" });
  const p2 = pair({ id: "p2", cellNo: "0822222222", isPrimary: false });
  const selected = selectStatementSmsPairs([p1, p2], { mode: "parentIds", parentIds: ["p1"] });
  assert.ok(selected.ok);
  if (selected.ok) {
    assert.strictEqual(selected.pairs.length, 1);
    assert.strictEqual(selected.pairs[0].parent.id, "p1");
  }
}

function testSelectParent2Only() {
  const p1 = pair({ id: "p1", cellNo: "0821111111" });
  const p2 = pair({ id: "p2", cellNo: "0822222222", isPrimary: false });
  const selected = selectStatementSmsPairs([p1, p2], { mode: "parentIds", parentIds: ["p2"] });
  assert.ok(selected.ok);
  if (selected.ok) {
    assert.strictEqual(selected.pairs.length, 1);
    assert.strictEqual(selected.pairs[0].parent.id, "p2");
  }
}

function testSelectBothParents() {
  const p1 = pair({ id: "p1", cellNo: "0821111111" });
  const p2 = pair({ id: "p2", cellNo: "0822222222", isPrimary: false });
  const selected = selectStatementSmsPairs([p1, p2], { mode: "all" });
  assert.ok(selected.ok);
  if (selected.ok) {
    assert.strictEqual(selected.pairs.length, 2);
  }
  const dest = buildStatementSmsDestinations(selected.ok ? selected.pairs : []);
  assert.strictEqual(dest.length, 2);
}

function testDuplicateMobileDeduped() {
  const p1 = pair({ id: "p1", cellNo: "0825555507", firstName: "Parent1" });
  const p2 = pair({ id: "p2", cellNo: "+27825555507", firstName: "Parent2", isPrimary: false });
  const dest = buildStatementSmsDestinations([p1, p2]);
  assert.strictEqual(dest.length, 1);
  assert.deepStrictEqual(dest[0].parentIds.sort(), ["p1", "p2"]);
}

function testIneligibleCannotSelect() {
  const eligible = pair({ id: "ok" });
  const blocked = pair({ id: "bad", communicationBySMS: false, cellNo: "0839998877" });
  const ranked = rankStatementSmsContacts([eligible, blocked]);
  assert.strictEqual(ranked.length, 1);
  assert.strictEqual(ranked[0].parentId, "ok");
  const selected = selectStatementSmsPairs([eligible, blocked], {
    mode: "parentIds",
    parentIds: ["bad"],
  });
  assert.ok(!selected.ok);
  if (!selected.ok) assert.strictEqual(selected.code, "INVALID_PARENT_SELECTION");
}

function testForeignParentRejected() {
  const local = pair({ id: "local" });
  // Only local is in the eligible set — foreign id is rejected.
  const selected = selectStatementSmsPairs([local], {
    mode: "parentIds",
    parentIds: ["other-family-parent"],
  });
  assert.ok(!selected.ok);
}

function testMessageEditDoesNotAffectAuth() {
  // Message sanitisation is independent of recipient selection.
  const ok = sanitiseStatementSmsMessage("Custom staff message for statement.");
  assert.ok(ok.ok);
  const local = pair({ id: "local" });
  const selected = selectStatementSmsPairs([local], {
    mode: "parentIds",
    parentIds: ["injected-parent"],
  });
  assert.ok(!selected.ok);
}

function testMessageLengthCap() {
  const tooLong = "x".repeat(STATEMENT_SMS_MAX_CHARS + 1);
  const bad = sanitiseStatementSmsMessage(tooLong);
  assert.ok(!bad.ok);
  const ok = sanitiseStatementSmsMessage("x".repeat(STATEMENT_SMS_MAX_CHARS));
  assert.ok(ok.ok);
}

function testMaskMobile() {
  const mask = maskStatementSmsMobile("0821235507");
  assert.ok(mask.masked.includes("5507"));
  assert.ok(!mask.masked.includes("082123"));
  assert.ok(isValidStatementSmsMobile("0821235507"));
  assert.ok(!isValidStatementSmsMobile("12"));
}

function testAuthRequiresStatementsSend() {
  const baseUser = {
    id: "u1",
    schoolId: "school-1",
    role: "ADMIN",
    isActive: true,
  };
  const denied = evaluateStatementSendAuth({
    jwtPayload: { userId: "u1", schoolId: "school-1", email: "a@b.c" } as any,
    user: baseUser,
    appRole: "Viewer",
    permissions: { statements: { view: true, send: false } } as any,
    requestSchoolId: "school-1",
  });
  assert.ok(!denied.allowed);
  if (!denied.allowed) assert.strictEqual(denied.code, "FORBIDDEN_PERMISSION");

  const mismatch = evaluateStatementSendAuth({
    jwtPayload: { userId: "u1", schoolId: "school-1", email: "a@b.c" } as any,
    user: baseUser,
    appRole: "Admin",
    permissions: null,
    requestSchoolId: "other-school",
  });
  assert.ok(!mismatch.allowed);
  if (!mismatch.allowed) assert.strictEqual(mismatch.code, "SCHOOL_MISMATCH");
}

function testSourceNeverTrustsClientPhones() {
  const { readFileSync } = require("fs") as typeof import("fs");
  const { join } = require("path") as typeof import("path");
  const src = readFileSync(join(__dirname, "statementSmsService.ts"), "utf8");
  assert.ok(src.includes("void input.mobileNumbers"));
  assert.ok(src.includes("void input.cellNo"));
  assert.ok(src.includes("sendSchoolSms"));
  assert.ok(src.includes("isSchoolSmsReady"));
  assert.ok(src.includes("isOutboundSmsDisabled"));
  assert.ok(src.includes("normalizeSaPhone"));
  assert.ok(!/simulated:\s*true/.test(src), "must never simulate SMS success");
}

function main() {
  testBalanceClassification();
  testOutstandingWording();
  testZeroNeverOutstanding();
  testCreditNeverOutstanding();
  testEligibilityFlags();
  testRecommendedRanking();
  testSelectParent1Only();
  testSelectParent2Only();
  testSelectBothParents();
  testDuplicateMobileDeduped();
  testIneligibleCannotSelect();
  testForeignParentRejected();
  testMessageEditDoesNotAffectAuth();
  testMessageLengthCap();
  testMaskMobile();
  testAuthRequiresStatementsSend();
  testSourceNeverTrustsClientPhones();
  console.log("statementSmsService.unit.test.ts: all passed");
}

main();
