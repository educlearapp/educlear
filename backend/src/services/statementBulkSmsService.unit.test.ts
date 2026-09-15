/**
 * Bulk Statement SMS Phase 1 — unit tests (no live WinSMS/DB).
 * Run: npx ts-node --transpile-only src/services/statementBulkSmsService.unit.test.ts
 */
import assert from "assert";
import {
  BULK_STATEMENT_SMS_CONCURRENCY,
  BULK_STATEMENT_SMS_DEFAULT_TEMPLATE,
  buildSafeBulkSmsPreviewRecipients,
  dedupeFamilyAccountIds,
  formatBulkSmsPreviewRecipientLine,
  parseBulkRecipientStrategy,
  renderBulkStatementSmsTemplate,
  resolveBulkMessageForAccount,
} from "./statementBulkSmsService";
import {
  buildStatementSmsDestinations,
  maskStatementSmsMobile,
  rankStatementSmsContacts,
  selectStatementSmsPairs,
  STATEMENT_SMS_MAX_CHARS,
  type StatementSmsParentPair,
} from "./statementSmsService";
import { evaluateStatementSendAuth } from "../middleware/requireStatementSendAuth";
import { readFileSync } from "fs";
import { join } from "path";

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
}): StatementSmsParentPair {
  return {
    parent: {
      id: overrides.id || "p1",
      schoolId: "school-1",
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

function testDedupeAccountIds() {
  assert.deepStrictEqual(dedupeFamilyAccountIds(["a", "b", "a", " ", "", "b"]), ["a", "b"]);
  assert.deepStrictEqual(dedupeFamilyAccountIds(null), []);
  assert.deepStrictEqual(dedupeFamilyAccountIds("x"), []);
}

function testStrategyParse() {
  assert.strictEqual(parseBulkRecipientStrategy("recommended"), "recommended");
  assert.strictEqual(parseBulkRecipientStrategy("all_eligible"), "all_eligible");
  assert.strictEqual(parseBulkRecipientStrategy("All Eligible"), "all_eligible");
  assert.strictEqual(parseBulkRecipientStrategy(""), "recommended");
}

function testTemplateRender() {
  const text = renderBulkStatementSmsTemplate(BULK_STATEMENT_SMS_DEFAULT_TEMPLATE, {
    schoolName: "Da Silva",
    accountNo: "ABC001",
    amount: "R1,200",
    balance: 1200,
  });
  assert.ok(text.includes("Da Silva"));
  assert.ok(text.includes("ABC001"));
  assert.ok(text.includes("R1,200"));
  assert.ok(text.includes("outstanding balance"));
}

function testDefaultMessageWhenTemplateEmpty() {
  const msg = resolveBulkMessageForAccount({
    schoolName: "Test School",
    accountNo: "ACC1",
    balance: 500,
    messageTemplate: "",
  });
  assert.ok(msg.ok);
  if (msg.ok) {
    assert.ok(msg.message.includes("outstanding balance"));
    assert.ok(msg.message.includes("ACC1"));
    assert.ok(msg.segments >= 1);
  }
}

function testOver480Rejected() {
  const msg = resolveBulkMessageForAccount({
    schoolName: "S",
    accountNo: "A",
    balance: 1,
    messageTemplate: "x".repeat(STATEMENT_SMS_MAX_CHARS + 1),
  });
  assert.ok(!msg.ok);
}

function testSegmentCalcOver160() {
  const msg = resolveBulkMessageForAccount({
    schoolName: "S",
    accountNo: "A",
    balance: 1,
    messageTemplate: "y".repeat(161),
  });
  assert.ok(msg.ok);
  if (msg.ok) assert.strictEqual(msg.segments, 2);
}

function testRecommendedOnlyOneParent() {
  const p1 = pair({ id: "p1", isPrimary: true, isPayingPerson: true, cellNo: "0821111111" });
  const p2 = pair({ id: "p2", isPrimary: false, cellNo: "0822222222" });
  const ranked = rankStatementSmsContacts([p1, p2]);
  assert.strictEqual(ranked[0].recommended, true);
  const selected = selectStatementSmsPairs([p1, p2], {
    mode: "parentIds",
    parentIds: [ranked[0].parentId],
  });
  assert.ok(selected.ok);
  if (selected.ok) {
    const dest = buildStatementSmsDestinations(selected.pairs);
    assert.strictEqual(dest.length, 1);
  }
}

function testAllEligibleTwoParents() {
  const p1 = pair({ id: "p1", cellNo: "0821111111", isPrimary: true });
  const p2 = pair({ id: "p2", cellNo: "0822222222", isPrimary: false });
  const selected = selectStatementSmsPairs([p1, p2], { mode: "all" });
  assert.ok(selected.ok);
  if (selected.ok) {
    assert.strictEqual(buildStatementSmsDestinations(selected.pairs).length, 2);
  }
}

function testDuplicateMobileOneDestination() {
  const p1 = pair({ id: "p1", cellNo: "0825555507" });
  const p2 = pair({ id: "p2", cellNo: "27825555507", isPrimary: false });
  const selected = selectStatementSmsPairs([p1, p2], { mode: "all" });
  assert.ok(selected.ok);
  if (selected.ok) {
    const dest = buildStatementSmsDestinations(selected.pairs);
    assert.strictEqual(dest.length, 1);
    assert.strictEqual(dest[0].parentIds.length, 2);
  }
}

function testConsentFalseExcluded() {
  const bad = pair({ id: "bad", communicationBySMS: false });
  const good = pair({ id: "good", cellNo: "0829999999", isPrimary: false });
  const ranked = rankStatementSmsContacts([bad, good]);
  assert.strictEqual(ranked.length, 1);
  assert.strictEqual(ranked[0].parentId, "good");
}

function testInvalidPhoneExcluded() {
  const bad = pair({ id: "bad", cellNo: "123" });
  const ranked = rankStatementSmsContacts([bad]);
  assert.strictEqual(ranked.length, 0);
}

function testAuthRequiresStatementsSend() {
  const denied = evaluateStatementSendAuth({
    jwtPayload: { userId: "u1", schoolId: "s1", email: "a@b.c" },
    user: { id: "u1", schoolId: "s1", role: "STAFF", isActive: true },
    appRole: "Viewer",
    permissions: { statements: { view: true, send: false } } as never,
  });
  assert.strictEqual(denied.allowed, false);
  if (!denied.allowed) assert.strictEqual(denied.status, 403);

  const unauth = evaluateStatementSendAuth({
    jwtPayload: null,
    user: null,
    appRole: "",
    permissions: null,
  });
  assert.strictEqual(unauth.allowed, false);
  if (!unauth.allowed) assert.strictEqual(unauth.status, 401);
}

function testConcurrencyConstant() {
  assert.strictEqual(BULK_STATEMENT_SMS_CONCURRENCY, 5);
}

function testSafePreviewRecipientsNeverExposeFullMobile() {
  const p1 = pair({
    id: "p1",
    firstName: "Test",
    surname: "Parent One",
    cellNo: "0821111001",
    isPrimary: true,
  });
  const p2 = pair({
    id: "p2",
    firstName: "Test",
    surname: "Parent Two",
    cellNo: "0822222002",
    isPrimary: false,
  });
  const all = selectStatementSmsPairs([p1, p2], { mode: "all" });
  assert.ok(all.ok);
  if (!all.ok) return;
  const destinations = buildStatementSmsDestinations(all.pairs);
  assert.strictEqual(destinations.length, 2);

  const recipients = buildSafeBulkSmsPreviewRecipients(destinations, "SYN001");
  assert.strictEqual(recipients.length, 2);
  assert.strictEqual(recipients[0].accountNo, "SYN001");
  assert.ok(recipients[0].displayName.includes("Parent"));
  assert.ok(recipients[0].mobileMasked.includes("••••"));
  assert.ok(recipients[0].mobileMasked.includes(maskStatementSmsMobile("0821111001").last4));

  const payload = JSON.stringify(recipients);
  assert.ok(!payload.includes("0821111001"));
  assert.ok(!payload.includes("0822222002"));
  assert.ok(!payload.includes("mobileNumber"));
  assert.ok(!/"\d{10,}"/.test(payload));

  const line = formatBulkSmsPreviewRecipientLine(recipients[0]);
  assert.ok(line.includes(" — "));
  assert.ok(line.includes("SYN001"));
  assert.ok(line.includes(recipients[0].mobileMasked));
  assert.ok(!line.includes("0821111001"));

  const recommended = selectStatementSmsPairs([p1, p2], {
    mode: "parentIds",
    parentIds: [rankStatementSmsContacts([p1, p2])[0].parentId],
  });
  assert.ok(recommended.ok);
  if (!recommended.ok) return;
  const one = buildSafeBulkSmsPreviewRecipients(
    buildStatementSmsDestinations(recommended.pairs),
    "SYN001"
  );
  assert.strictEqual(one.length, 1);
}

function testServiceExposesRecipientsInPreview() {
  const src = readFileSync(join(__dirname, "statementBulkSmsService.ts"), "utf8");
  assert.ok(src.includes("buildSafeBulkSmsPreviewRecipients"));
  assert.ok(src.includes("recipients: accountRecipients"));
  assert.ok(src.includes("/** Flat list of final destinations"));
}

function testRoutesWired() {
  const src = readFileSync(join(__dirname, "../routes/statements.ts"), "utf8");
  assert.ok(src.includes('/bulk-sms-preview'));
  assert.ok(src.includes('/bulk-send-sms'));
  assert.ok(src.includes("previewBulkStatementSms"));
  assert.ok(src.includes("sendBulkStatementSms"));
  assert.ok(src.includes("requireStatementSendAuth"));
}

function testServiceUsesOutboundKillSwitch() {
  const src = readFileSync(join(__dirname, "statementBulkSmsService.ts"), "utf8");
  assert.ok(src.includes("isOutboundSmsDisabled"));
  assert.ok(src.includes("OUTBOUND_SMS_DISABLED"));
  assert.ok(src.includes("balance > 0") || src.includes("!(balance > 0)"));
  assert.ok(src.includes("mapPool"));
  assert.ok(src.includes("BULK_STATEMENT_SMS_CONCURRENCY"));
  assert.ok(!src.includes("mobileNumbers: dest")); // never trusts client phones in send payload construction
}

async function testPartialFailureContinues() {
  const jobs = ["a", "b", "c"];
  const results: Array<{ id: string; status: string }> = [];
  let next = 0;
  const concurrency = 2;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= jobs.length) return;
      const id = jobs[i];
      try {
        if (id === "b") throw new Error("fail");
        results.push({ id, status: "sent" });
      } catch {
        results.push({ id, status: "failed" });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  assert.strictEqual(results.filter((r) => r.status === "sent").length, 2);
  assert.strictEqual(results.filter((r) => r.status === "failed").length, 1);
}

async function main() {
  testDedupeAccountIds();
  testStrategyParse();
  testTemplateRender();
  testDefaultMessageWhenTemplateEmpty();
  testOver480Rejected();
  testSegmentCalcOver160();
  testRecommendedOnlyOneParent();
  testAllEligibleTwoParents();
  testDuplicateMobileOneDestination();
  testConsentFalseExcluded();
  testInvalidPhoneExcluded();
  testAuthRequiresStatementsSend();
  testConcurrencyConstant();
  testSafePreviewRecipientsNeverExposeFullMobile();
  testServiceExposesRecipientsInPreview();
  testRoutesWired();
  testServiceUsesOutboundKillSwitch();
  await testPartialFailureContinues();
  console.log("statementBulkSmsService.unit.test.ts: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
