/**
 * Bank Reconciliation Review UI helpers (display only).
 * Run: npx tsx src/banking/bankingReconciliationUi.test.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import type { BankImportRecord, BankTransactionRow } from "./bankingApi";
import {
  canPostBankPaymentToBilling,
  computeBankingStats,
  hasSuggestedPaymentMatch,
} from "./bankingReconciliationUtils";
import {
  allowLearnerAcceptAction,
  buildReviewKpiItems,
  buildStickyPostingModel,
  compactMatchReason,
  countQueueFilters,
  displayStatus,
  filterReviewTransactions,
  formatCompactConfidence,
  kpiReadyLabelCount,
  looksLikeCardSettlement,
  matchColumnView,
  matchesReviewSearch,
  REVIEW_PAGE_SIZE,
} from "./bankingReconciliationUi";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function txn(partial: Partial<BankTransactionRow> & Pick<BankTransactionRow, "id">): BankTransactionRow {
  return {
    date: "2026-03-12",
    description: "EFT PAYMENT",
    reference: "",
    moneyIn: 1000,
    moneyOut: 0,
    direction: "in",
    transactionType: "payment",
    suggestedAccountId: "",
    suggestedAccountNo: "",
    suggestedLearnerId: "",
    suggestedLearnerName: "",
    confidenceScore: 0,
    matchConfidence: "none",
    matchReason: "",
    reviewStatus: "pending",
    matchStatus: "unmatched",
    expenseCategory: "",
    fingerprint: partial.id,
    ...partial,
  };
}

function buildFixture48(): { importRecord: BankImportRecord; txns: BankTransactionRow[] } {
  const matched: BankTransactionRow[] = [
    txn({
      id: "m1",
      description: "TIV001 KAMOGELO",
      moneyIn: 4500,
      suggestedAccountNo: "TIV001",
      suggestedLearnerId: "l-tiv",
      suggestedLearnerName: "Kamogelo Calvin Tivane",
      confidenceScore: 100,
      matchConfidence: "high",
      matchReason: "Exact account number TIV001 found in bank line",
      matchStatus: "matched",
    }),
    txn({
      id: "m2",
      suggestedAccountNo: "ABC001",
      suggestedLearnerId: "l-2",
      suggestedLearnerName: "Ann Example",
      confidenceScore: 100,
      matchConfidence: "high",
      matchReason: "Exact account number ABC001 found in bank line",
      matchStatus: "matched",
    }),
    txn({
      id: "m3",
      suggestedAccountNo: "DEF002",
      suggestedLearnerId: "l-3",
      suggestedLearnerName: "Ben Example",
      confidenceScore: 100,
      matchConfidence: "high",
      matchReason: "Exact account number DEF002 found in bank line",
      matchStatus: "matched",
    }),
    txn({
      id: "m4",
      suggestedAccountNo: "GHI003",
      suggestedLearnerId: "l-4",
      suggestedLearnerName: "Cara Example",
      confidenceScore: 95,
      matchConfidence: "high",
      matchStatus: "matched",
    }),
    txn({
      id: "m5",
      suggestedAccountNo: "JKL004",
      suggestedLearnerId: "l-5",
      suggestedLearnerName: "Dan Example",
      confidenceScore: 100,
      matchConfidence: "high",
      matchStatus: "matched",
    }),
    txn({
      id: "m6",
      suggestedAccountNo: "MNO005",
      suggestedLearnerId: "l-6",
      suggestedLearnerName: "Eve Example",
      confidenceScore: 100,
      matchConfidence: "high",
      matchStatus: "matched",
    }),
    txn({
      id: "m7",
      suggestedAccountNo: "PQR006",
      suggestedLearnerId: "l-7",
      suggestedLearnerName: "Fay Example",
      confidenceScore: 100,
      matchConfidence: "high",
      matchStatus: "matched",
    }),
  ];

  const suggested: BankTransactionRow[] = Array.from({ length: 13 }, (_, i) =>
    txn({
      id: `s${i + 1}`,
      description: i === 0 ? "PHA010 OREFILWE PHAKEDI" : `SUGGESTED ${i + 1}`,
      moneyIn: 2500,
      suggestedAccountNo: i === 0 ? "PHA010" : `SUG${String(i + 1).padStart(3, "0")}`,
      suggestedLearnerId: `l-s${i + 1}`,
      suggestedLearnerName: i === 0 ? "Orefilwe Phakedi" : `Suggested Learner ${i + 1}`,
      confidenceScore: 75,
      matchConfidence: "medium",
      matchReason: "Learner full name matched in bank line",
      matchStatus: "suggested",
      reviewStatus: "pending",
    })
  );

  const speedpoint = [
    "SPEEDPOINT00717665FNB 00000327",
    "SPEEDPOINT00717665FNB 00000328",
    "SPEEDPOINT00717665FNB 00000329",
  ];

  const unmatched: BankTransactionRow[] = Array.from({ length: 28 }, (_, i) =>
    txn({
      id: `u${i + 1}`,
      description: i < 3 ? speedpoint[i] : `UNMATCHED EFT ${i + 1}`,
      moneyIn: 3200,
      confidenceScore: 0,
      matchConfidence: "none",
      matchStatus: "unmatched",
      reviewStatus: "pending",
    })
  );

  const txns = [...matched, ...suggested, ...unmatched];
  assert(txns.length === 48, "fixture must have 48 transactions");

  const importRecord: BankImportRecord = {
    id: "imp-fixture",
    schoolId: "school-test",
    fileName: "fnb-statement.csv",
    format: "csv",
    importedAt: "2026-03-12T10:00:00.000Z",
    totalRows: 48,
    matchedRows: 7,
    unmatchedRows: 28,
    duplicateRows: 0,
    totalAmountImported: 254935,
    transactions: txns,
  };

  return { importRecord, txns };
}

function testFinancialRegressionUnchanged() {
  const { importRecord, txns } = buildFixture48();
  const stats = computeBankingStats([importRecord], importRecord);
  assert(txns.length === 48, "48 transactions");
  assert(stats.matchedPayments === 7, `matched 7, got ${stats.matchedPayments}`);
  assert(stats.suggestedPayments === 13, `suggested 13, got ${stats.suggestedPayments}`);
  assert(stats.unmatched === 28, `unmatched 28, got ${stats.unmatched}`);
  assert(stats.duplicateLines === 0, `duplicates 0, got ${stats.duplicateLines}`);
  assert(stats.readyToPost === 0, `ready 0, got ${stats.readyToPost}`);
  assert(importRecord.totalAmountImported === 254935, "imported total R254,935");
  assert(
    txns.filter(canPostBankPaymentToBilling).length === 0,
    "no fixture row is ready to post until accepted"
  );
  console.log("✓ financial regression fixture 48 / 7 / 13 / 28 / 0 / R254,935.00 / 0 ready");
}

function testCompactKpiStrip() {
  const { txns, importRecord } = buildFixture48();
  const items = buildReviewKpiItems(txns, importRecord.totalAmountImported ?? 0);
  const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
  assert(items.length === 7, "seven KPI items");
  assert(kpiReadyLabelCount(items) === 1, "Ready metric appears once");
  assert(byKey.transactions.value === 48, "48 Transactions");
  assert(byKey.matched.value === 7, "7 Matched");
  assert(byKey.suggested.value === 13, "13 Suggested");
  assert(byKey.unmatched.value === 28, "28 Unmatched");
  assert(byKey.duplicates.value === 0, "0 Duplicates");
  assert(byKey.imported.value === 254935, "imported amount");
  assert(byKey.imported.money === true, "imported is money");
  assert(byKey.ready.value === 0, "0 Ready to Post");
  assert(byKey.ready.label === "Ready to Post", "ready label");
  console.log("✓ compact KPI strip — unique Ready metric");
}

function testFilterCounts() {
  const { txns } = buildFixture48();
  const counts = countQueueFilters(txns);
  assert(counts.all === 48, "All 48");
  assert(counts.matched === 7, "Matched 7");
  assert(counts.suggested === 13, "Suggested 13");
  assert(counts.unmatched === 28, "Unmatched 28");
  assert(counts.duplicate === 0, "Duplicates 0");
  const matchedOnly = filterReviewTransactions(txns, {
    queue: "matched",
    search: "",
    confidence: "all",
    type: "all",
  });
  assert(matchedOnly.length === 7, "matched filter length");
  const searched = filterReviewTransactions(txns, {
    queue: "all",
    search: "PHA010",
    confidence: "all",
    type: "all",
  });
  assert(searched.length === 1, "search finds account number");
  assert(searched[0].suggestedLearnerName === "Orefilwe Phakedi", "search finds family/learner name");
  const nameSearch = txns.filter((t) => matchesReviewSearch(t, "orefilwe"));
  assert(nameSearch.length === 1, "name search");
  const highOnly = filterReviewTransactions(txns, {
    queue: "all",
    search: "",
    confidence: "high",
    type: "all",
  });
  assert(highOnly.length === 7, "confidence filter uses existing bands only");
  const payments = filterReviewTransactions(txns, {
    queue: "all",
    search: "",
    confidence: "all",
    type: "payment",
  });
  assert(payments.length === 48, "type filter payment");
  console.log("✓ filter counts, search, confidence, type");
}

function testExactAndSuggestedMatchDisplay() {
  const { txns } = buildFixture48();
  const exact = txns.find((t) => t.id === "m1")!;
  const suggested = txns.find((t) => t.id === "s1")!;
  const unmatched = txns.find((t) => t.id === "u4")!;

  const exactView = matchColumnView(exact);
  assert(exactView.primary === "TIV001 · Kamogelo Calvin Tivane", exactView.primary);
  assert(exactView.secondary === "Account match", exactView.secondary);
  assert(formatCompactConfidence(exact) === "100%", "exact 100%");
  assert(displayStatus(exact).kind === "matched", "matched badge");
  assert(displayStatus(exact).label === "Matched", "matched label");

  const sugView = matchColumnView(suggested);
  assert(sugView.primary === "PHA010 · Orefilwe Phakedi", sugView.primary);
  assert(sugView.secondary === "Name match", sugView.secondary);
  assert(formatCompactConfidence(suggested) === "75%", "suggested 75%");
  assert(displayStatus(suggested).kind === "suggested", "suggested badge");
  assert(compactMatchReason("Learner full name matched in bank line") === "Name match", "name match compact");

  assert(displayStatus(unmatched).kind === "unmatched", "unmatched badge");
  assert(displayStatus(unmatched).label === "Unmatched", "unmatched label");
  assert(formatCompactConfidence(unmatched) === "—", "unmatched confidence compact");
  console.log("✓ exact / suggested / unmatched compact display");
}

function testCardSettlementClassification() {
  const { txns } = buildFixture48();
  const speed = txns.find((t) => t.id === "u1")!;
  assert(looksLikeCardSettlement(speed), "SPEEDPOINT detected from description");
  assert(!canPostBankPaymentToBilling(speed), "classification does not make it postable");
  assert(!hasSuggestedPaymentMatch(speed), "no learner suggestion on speedpoint fixture");
  assert(!allowLearnerAcceptAction(speed), "UI blocks learner accept on card settlement");
  const status = displayStatus(speed);
  assert(status.kind === "card_settlement", "Card Settlement badge");
  assert(status.label === "Card Settlement", status.label);
  assert(status.helper === "Speedpoint settlement — reconcile separately", status.helper);
  const view = matchColumnView(speed);
  assert(view.primary === "Card settlement", view.primary);
  assert(view.secondary.includes("reconcile separately"), view.secondary);
  const counts = countQueueFilters(txns);
  assert(counts.unmatched === 28, "card settlements remain in unmatched count");
  console.log("✓ Card Settlement visual classification is frontend-only");
}

function testStickyPostingBar() {
  const { txns } = buildFixture48();
  const empty = buildStickyPostingModel(txns);
  assert(empty.selectedCount === 0, "0 selected");
  assert(empty.readyAmount === 0, "R0 ready");
  assert(empty.canPost === false, "post disabled");

  const accepted = txns.map((t) =>
    t.id === "m1" ? { ...t, reviewStatus: "accepted" as const, matchStatus: "ready_to_post" as const } : t
  );
  const ready = buildStickyPostingModel(accepted);
  assert(ready.selectedCount === 1, "1 selected after accept");
  assert(ready.readyAmount === 4500, `ready amount ${ready.readyAmount}`);
  assert(ready.canPost === true, "post enabled");
  assert(canPostBankPaymentToBilling(accepted.find((t) => t.id === "m1")!), "uses existing posting eligibility");
  console.log("✓ sticky posting bar uses existing frontend posting eligibility");
}

function testCompactSourceContract() {
  const src = fs.readFileSync(path.join(__dirname, "BankStatementImport.tsx"), "utf8");
  assert(src.includes('data-testid="recon-kpi-strip"'), "KPI strip test id");
  assert(src.includes('data-testid="recon-filter-toolbar"'), "filter toolbar");
  assert(src.includes('data-testid="recon-txn-table"'), "dense table");
  assert(src.includes('data-testid="recon-posting-bar"'), "sticky posting bar");
  assert(src.includes("Post accepted to Billing"), "post button label");
  assert(src.includes("Date") && src.includes("Confidence") && src.includes("Action"), "table columns");
  assert(!src.includes("accountingCardLabel"), "oversized KPI cards removed");
  assert(!src.includes("accountingCardValue"), "oversized KPI values removed");
  const readyLabels = src.match(/Ready to Post/g) || [];
  assert(readyLabels.length === 0, "Ready to Post KPI label lives in UI helper, not duplicated in JSX");
  assert(src.includes("allowLearnerAcceptAction"), "card settlement cannot auto-accept to learner");
  assert(REVIEW_PAGE_SIZE === 12, "review page shows up to 12 rows");
  const css = fs.readFileSync(path.join(__dirname, "bankingReconciliationReview.css"), "utf8");
  assert(css.includes(".recon-kpi-strip"), "compact KPI css");
  assert(css.includes("position: sticky"), "sticky header/bar");
  assert(css.includes(".recon-table tbody td"), "dense table cells");
  console.log("✓ review source contract — compact KPI, table, sticky bar");
}

function testUtilsFinancialLogicUntouched() {
  const utils = fs.readFileSync(path.join(__dirname, "bankingReconciliationUtils.ts"), "utf8");
  assert(utils.includes('if (txn.reviewStatus !== "accepted") return false'), "posting still requires accept");
  assert(utils.includes("confidenceScore >= 50"), "posting confidence gate unchanged");
  assert(!utils.includes("speedpoint"), "utils have no SPEEDPOINT classification");
  assert(!utils.includes("Card Settlement"), "utils have no card settlement logic");
  console.log("✓ bankingReconciliationUtils posting/matching helpers unchanged");
}

testFinancialRegressionUnchanged();
testCompactKpiStrip();
testFilterCounts();
testExactAndSuggestedMatchDisplay();
testCardSettlementClassification();
testStickyPostingBar();
testCompactSourceContract();
testUtilsFinancialLogicUntouched();
console.log("\nAll bank reconciliation UI tests passed.");
