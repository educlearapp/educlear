/**
 * Frontend bulk statement SMS helpers + Outstanding Accounts wiring invariants.
 * Run: npx tsx --tsconfig tsconfig.json src/billing/statementBulkSmsFlow.test.ts
 */
import assert from "assert";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  BULK_STATEMENT_SMS_DEFAULT_TEMPLATE,
  collectBulkSmsPreviewRecipients,
  estimateBulkTemplateSegments,
  formatBulkSmsFailureSummary,
  formatBulkSmsPreviewRecipientLine,
  looksLikeFullCellphone,
  outstandingSelectionKey,
  STATEMENT_SMS_MAX_CHARS,
  STATEMENT_SMS_SEGMENT_CHARS,
  summarizeSelectedOutstanding,
  type BulkStatementSmsPreview,
} from "./statementBulkSmsApi.ts";

const here = dirname(fileURLToPath(import.meta.url));

function testSelectionKeyIsAccountBased() {
  const a = outstandingSelectionKey({
    familyAccountId: "fa-1",
    accountRef: "REF1",
  });
  const b = outstandingSelectionKey({
    familyAccountId: "fa-1",
    accountRef: "OTHER",
  });
  assert.strictEqual(a, b);
  assert.ok(a.startsWith("fa:"));
}

function testSelectAllFilteredSummarizes() {
  const rows = [
    { familyAccountId: "fa1", outstandingBalance: 100 },
    { familyAccountId: "fa2", outstandingBalance: 250 },
    { familyAccountId: null, outstandingBalance: 50 },
  ];
  const selected = {
    [outstandingSelectionKey({ familyAccountId: "fa1", accountRef: "A" })]: true,
    [outstandingSelectionKey({ familyAccountId: "fa2", accountRef: "B" })]: true,
    [outstandingSelectionKey({ familyAccountId: null, accountRef: "C" })]: true,
  };
  const summary = summarizeSelectedOutstanding(rows, selected, (row) =>
    outstandingSelectionKey({
      familyAccountId: row.familyAccountId,
      accountRef: String(row.familyAccountId || "x"),
    })
  );
  // With our key helper for null FA:
  const selected2 = {
    "fa:fa1": true,
    "fa:fa2": true,
    "ref:SHELL": true,
  };
  const rows2 = [
    { familyAccountId: "fa1", outstandingBalance: 100 },
    { familyAccountId: "fa2", outstandingBalance: 250 },
    { familyAccountId: null, outstandingBalance: 50 },
  ];
  const summary2 = summarizeSelectedOutstanding(rows2, selected2, (row) =>
    outstandingSelectionKey({
      familyAccountId: row.familyAccountId,
      accountRef: row.familyAccountId ? "x" : "SHELL",
    })
  );
  assert.strictEqual(summary2.count, 3);
  assert.strictEqual(summary2.total, 400);
  assert.deepStrictEqual(summary2.familyAccountIds, ["fa1", "fa2"]);
  void selected;
  void summary;
}

function testSegmentEstimate() {
  assert.strictEqual(estimateBulkTemplateSegments(""), 0);
  assert.strictEqual(estimateBulkTemplateSegments("a"), 1);
  assert.strictEqual(
    estimateBulkTemplateSegments("x".repeat(STATEMENT_SMS_SEGMENT_CHARS + 1)),
    2
  );
  assert.ok(BULK_STATEMENT_SMS_DEFAULT_TEMPLATE.includes("{{amount}}"));
  assert.ok(STATEMENT_SMS_MAX_CHARS === 480);
}

function testFailureSummaryCopyable() {
  const text = formatBulkSmsFailureSummary({
    success: false,
    summary: "Partial",
    successfulDestinations: 1,
    failedDestinations: 1,
    skippedAccountCount: 1,
    results: [
      {
        familyAccountId: "fa1",
        accountNo: "A1",
        parentIds: ["p1"],
        displayNames: ["Ann"],
        mobileMasked: "•••• 1111",
        status: "failed",
        error: "timeout",
      },
    ],
    skippedAccounts: [
      {
        familyAccountId: "fa2",
        accountRef: "R2",
        accountNo: "A2",
        balance: 10,
        status: "skipped",
        skipReason: "NO_ELIGIBLE_CONTACTS",
        skipMessage: "No eligible billing SMS contacts for this account.",
        contacts: [],
        recommendedParentId: null,
        selectedParentIds: [],
        recipients: [],
        destinationCount: 0,
        duplicateMobilesRemoved: 0,
        sampleMessage: null,
        charCount: 0,
        segments: 0,
      },
    ],
  });
  assert.ok(text.includes("Partial"));
  assert.ok(text.includes("timeout"));
  assert.ok(text.includes("No eligible"));
}

function testRecipientPreviewFormatting() {
  const line = formatBulkSmsPreviewRecipientLine({
    displayName: "Test Parent One",
    mobileMasked: "•••• 0001",
    accountNo: "SYN001",
  });
  assert.strictEqual(line, "Test Parent One — •••• 0001 — SYN001");
  assert.ok(!looksLikeFullCellphone(line));
  assert.ok(looksLikeFullCellphone("0821234567"));
  assert.ok(!looksLikeFullCellphone("•••• 0001"));
}

function testCollectPreviewRecipientsByStrategyShape() {
  const recommended: BulkStatementSmsPreview = {
    success: true,
    requestedAccountCount: 1,
    eligibleAccountCount: 1,
    skippedAccountCount: 0,
    destinationCount: 1,
    duplicateNumbersRemoved: 0,
    totalOutstanding: 1250,
    estimatedSegments: 1,
    recipientStrategy: "recommended",
    messageTemplate: BULK_STATEMENT_SMS_DEFAULT_TEMPLATE,
    defaultMessageTemplate: BULK_STATEMENT_SMS_DEFAULT_TEMPLATE,
    maxChars: STATEMENT_SMS_MAX_CHARS,
    segmentChars: STATEMENT_SMS_SEGMENT_CHARS,
    sampleMessages: [],
    recipients: [
      { displayName: "Test Parent One", mobileMasked: "•••• 0001", accountNo: "SYN001" },
    ],
    accounts: [],
    smsReady: true,
    outboundDisabled: true,
    canSend: false,
    concurrency: 5,
  };
  assert.strictEqual(collectBulkSmsPreviewRecipients(recommended).length, 1);

  const allEligible: BulkStatementSmsPreview = {
    ...recommended,
    recipientStrategy: "all_eligible",
    destinationCount: 2,
    recipients: [
      { displayName: "Test Parent One", mobileMasked: "•••• 0001", accountNo: "SYN001" },
      { displayName: "Test Parent Two", mobileMasked: "•••• 0002", accountNo: "SYN001" },
    ],
  };
  const rows = collectBulkSmsPreviewRecipients(allEligible);
  assert.strictEqual(rows.length, 2);
  for (const row of rows) {
    assert.ok(!looksLikeFullCellphone(row.mobileMasked));
    assert.ok(!looksLikeFullCellphone(formatBulkSmsPreviewRecipientLine(row)));
  }
}

function testOutstandingAccountsWired() {
  const src = readFileSync(join(here, "OutstandingAccountsReport.tsx"), "utf8");
  assert.ok(src.includes("BulkStatementSmsModal"));
  assert.ok(src.includes("Bulk SMS"));
  assert.ok(src.includes("Clear selection"));
  assert.ok(src.includes("outstandingSelectionKey"));
  assert.ok(src.includes("selectedFamilyAccountIds"));
  assert.ok(src.includes("formatMoney(selectedTotal)"));
}

function testModalHasStrategyAndPreview() {
  const src = readFileSync(join(here, "BulkStatementSmsModal.tsx"), "utf8");
  assert.ok(src.includes("Recommended parent only"));
  assert.ok(src.includes("All eligible billing parents"));
  assert.ok(src.includes("fetchBulkStatementSmsPreview"));
  assert.ok(src.includes("sendBulkStatementSmsRequest"));
  assert.ok(src.includes("Outbound SMS is disabled for this environment."));
  assert.ok(src.includes("Copy failure summary"));
  assert.ok(src.includes("Step {step} of 5"));
  assert.ok(src.includes("Recipients who will receive this SMS"));
  assert.ok(src.includes("formatBulkSmsPreviewRecipientLine"));
  assert.ok(src.includes("collectBulkSmsPreviewRecipients"));
  assert.ok(!src.includes("mobileNumber"));
}

function main() {
  testSelectionKeyIsAccountBased();
  testSelectAllFilteredSummarizes();
  testSegmentEstimate();
  testFailureSummaryCopyable();
  testRecipientPreviewFormatting();
  testCollectPreviewRecipientsByStrategyShape();
  testOutstandingAccountsWired();
  testModalHasStrategyAndPreview();
  console.log("statementBulkSmsFlow.test.ts: all passed");
}

main();
