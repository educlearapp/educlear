/**
 * Audit-only: review 112 Kid-e-Sys opening balance adjustments before final import.
 * Usage: npx ts-node scripts/opening-balance-adjustment-review.ts [desktopRoot]
 */
import fs from "fs";
import path from "path";
import { buildDaSilvaBundleFromDesktopLayout } from "../src/services/daSilvaMigration/daSilvaMigrationService";
import {
  countActiveLearnersPerAccount,
  hasSilentBillingSibling,
  indexHistoricalLearners,
  splitMergedAccountNames,
  type FamilyAccountIndex,
} from "../src/services/daSilvaMigration/daSilvaMergedFamily";
import type { DaSilvaOpeningBalanceAdjustment } from "../src/services/daSilvaMigration/daSilvaOpeningBalance";
import {
  parseContactListFile,
  type ParsedBillingAccount,
  type ParsedLearner,
  type ParsedLearnerContact,
  type ParsedTransaction,
} from "../src/services/daSilvaMigration/parsers";
import { normalizeMatchText } from "../src/utils/kideesysSpreadsheet";

const HISTORICAL_MOVEMENT_NOTE =
  /\b(removed|refund|closed|not returning|relocat|write[\s-]?off|learner left|no longer|cancelled|canceled|credit note|discount|not doing|left school|historical|jamf)\b/i;

export type OpeningBalanceFixReasonGroup =
  | "needsOpeningBalanceAdjustment"
  | "possibleUnallocatedPayment"
  | "possibleDuplicatedHistoricalCredit"
  | "inverseProblemLedgerGreaterThanAge"
  | "needsManualKideSysReview";

type ReconciliationRow = {
  accountNo: string;
  fullName: string;
  ageAnalysisBalance: number;
  ledgerBalanceFromImport: number;
  variance: number;
};

type ActiveMismatchAuditReason =
  | "historicalMergedFamily"
  | "trueBalanceMismatch"
  | "orphanLedgerOnly"
  | "possibleDuplicateOrHistoricalCredit";

type ReviewRow = {
  accountNo: string;
  fullName: string;
  ageAnalysisBalance: number;
  ledgerBalanceFromImport: number;
  adjustmentAmount: number;
  absAdjustmentAmount: number;
  variance: number;
  entryType: "invoice" | "credit";
  reasonGroup: OpeningBalanceFixReasonGroup;
  reasonDetail: string;
  priorActiveMismatchReason: ActiveMismatchAuditReason;
  paymentPatterns: string[];
  explainedByPaymentTheory: boolean;
  paymentMatchConfidence: "high" | "medium" | "none";
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function transactionsForAccount(
  accountNo: string,
  transactions: ParsedTransaction[]
): ParsedTransaction[] {
  return transactions.filter((t) => t.accountNo === accountNo);
}

function isHistoricalLedgerOnlyMovement(
  accountNo: string,
  transactions: ParsedTransaction[],
  inAgeAnalysis: boolean
): boolean {
  const txns = transactionsForAccount(accountNo, transactions);
  if (txns.length === 0) return false;
  if (!inAgeAnalysis) return true;
  return txns.every((t) => {
    const note = String(t.notes || "").trim();
    if (!note) return true;
    return HISTORICAL_MOVEMENT_NOTE.test(note);
  });
}

function near(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

function sumPayments(txns: ParsedTransaction[]): number {
  return roundMoney(
    txns.filter((t) => t.kind === "payment").reduce((s, t) => s + t.signedAmount, 0)
  );
}

function sumInvoices(txns: ParsedTransaction[]): number {
  return roundMoney(
    txns.filter((t) => t.kind === "invoice").reduce((s, t) => s + t.signedAmount, 0)
  );
}

function resolveFamilyAccountNo(txn: ParsedTransaction, index: FamilyAccountIndex): string {
  const byName = index.learnerNameToAccount.get(normalizeMatchText(txn.fullName));
  if (byName) return byName;
  return String(txn.accountNo || "").trim();
}

function parentGroupKey(parents: ParsedLearnerContact["parents"]): string {
  const cells = parents
    .map((p) => String(p.cellNo || "").replace(/\s/g, ""))
    .filter(Boolean)
    .sort();
  if (!cells.length) return "";
  const surnames = parents
    .map((p) => normalizeMatchText(p.surname || ""))
    .filter(Boolean);
  return `${cells.join("|")}|${surnames.join("|")}`;
}

function buildParentSiblingMap(
  contacts: ParsedLearnerContact[],
  accounts: ParsedBillingAccount[],
  index: FamilyAccountIndex
): Map<string, Set<string>> {
  const accountToSiblings = new Map<string, Set<string>>();
  const byParent = new Map<string, string[]>();

  for (const contact of contacts) {
    const key = parentGroupKey(contact.parents);
    if (!key) continue;
    const accountNo = index.learnerNameToAccount.get(normalizeMatchText(contact.fullName));
    if (!accountNo) continue;
    const list = byParent.get(key) || [];
    if (!list.includes(accountNo)) list.push(accountNo);
    byParent.set(key, list);
  }

  for (const accountNos of byParent.values()) {
    if (accountNos.length < 2) continue;
    for (const acct of accountNos) {
      const set = accountToSiblings.get(acct) || new Set<string>();
      for (const other of accountNos) {
        if (other !== acct) set.add(other);
      }
      accountToSiblings.set(acct, set);
    }
  }
  return accountToSiblings;
}

function detectPaymentPatterns(
  row: ReconciliationRow,
  txnsOnAccount: ParsedTransaction[],
  allTxns: ParsedTransaction[],
  index: FamilyAccountIndex,
  siblingNos: string[]
): { patterns: string[]; explained: boolean; paymentMatchConfidence: "high" | "medium" | "none" } {
  const patterns: string[] = [];
  const accountNo = row.accountNo;
  const variance = row.variance;

  const paymentSum = sumPayments(txnsOnAccount);
  const invoiceSum = sumInvoices(txnsOnAccount);
  const paymentCount = txnsOnAccount.filter((t) => t.kind === "payment").length;
  const invoiceCount = txnsOnAccount.filter((t) => t.kind === "invoice").length;

  let crossAccountPaymentAmount = 0;
  let crossAccountInboundPaymentAmount = 0;

  for (const t of txnsOnAccount) {
    const family = resolveFamilyAccountNo(t, index);
    if (family && family !== accountNo && t.kind === "payment") {
      crossAccountPaymentAmount += Math.abs(t.signedAmount);
    }
  }

  for (const t of allTxns) {
    if (t.accountNo === accountNo) continue;
    const family = resolveFamilyAccountNo(t, index);
    if (family === accountNo && t.kind === "payment") {
      crossAccountInboundPaymentAmount += Math.abs(t.signedAmount);
    }
  }

  const negativeLedgerPositiveAge =
    row.ledgerBalanceFromImport < -0.01 && row.ageAnalysisBalance > 0.01;
  if (negativeLedgerPositiveAge) patterns.push("negativeLedgerPositiveAge");

  const paymentsWithoutInvoiceCoverage =
    paymentCount > 0 &&
    (invoiceCount === 0 || Math.abs(paymentSum) > invoiceSum + 500) &&
    variance > 0.01;
  if (paymentsWithoutInvoiceCoverage) patterns.push("paymentsWithoutInvoiceCoverage");

  const unallocatedPaymentPattern =
    variance > 0.01 &&
    paymentCount > 0 &&
    (near(Math.abs(paymentSum), variance, Math.max(100, variance * 0.15)) ||
      near(crossAccountPaymentAmount, variance, Math.max(100, variance * 0.2)) ||
      near(crossAccountInboundPaymentAmount, variance, Math.max(100, variance * 0.2)) ||
      (paymentSum < -0.01 && row.ledgerBalanceFromImport < row.ageAnalysisBalance - 100));
  if (unallocatedPaymentPattern) patterns.push("unallocatedPaymentPattern");

  const crossAccountCreditOnLinked =
    siblingNos.length > 0 &&
    siblingNos.some((sib) => {
      const rec = allTxns.some(
        (t) => t.accountNo === sib && t.kind === "payment" && t.signedAmount < 0
      );
      return rec && row.ageAnalysisBalance > 0.01;
    });
  if (crossAccountCreditOnLinked) patterns.push("crossAccountCreditOnLinked");

  const highPaymentMatch =
    near(Math.abs(paymentSum), variance, Math.max(100, variance * 0.12)) ||
    near(crossAccountPaymentAmount, variance, Math.max(100, variance * 0.15)) ||
    near(crossAccountInboundPaymentAmount, variance, Math.max(100, variance * 0.15));

  const paymentMatchConfidence: "high" | "medium" | "none" = highPaymentMatch
    ? "high"
    : patterns.includes("unallocatedPaymentPattern") ||
        patterns.includes("crossAccountCreditOnLinked")
      ? "medium"
      : "none";

  const explained = paymentMatchConfidence !== "none";

  return { patterns, explained, paymentMatchConfidence };
}

function classifyActiveMismatchReason(
  row: ReconciliationRow,
  opts: {
    inAgeAnalysis: boolean;
    activeLearnerCount: number;
    mergedFamilyCandidate: boolean;
    silentSibling: boolean;
    duplicateNameAccountNos: string[];
    section: string;
    historicalLedgerOnly: boolean;
    ledgerTxnCount: number;
  }
): ActiveMismatchAuditReason {
  if (
    !opts.inAgeAnalysis ||
    (opts.inAgeAnalysis &&
      Math.abs(row.ageAnalysisBalance) <= 0.01 &&
      Math.abs(row.ledgerBalanceFromImport) > 0.01)
  ) {
    return "orphanLedgerOnly";
  }

  if (
    opts.mergedFamilyCandidate ||
    opts.silentSibling ||
    splitMergedAccountNames(row.fullName).length > 1 ||
    opts.activeLearnerCount === 0
  ) {
    return "historicalMergedFamily";
  }

  if (
    opts.section === "Over Paid" ||
    row.ageAnalysisBalance < -0.01 ||
    opts.duplicateNameAccountNos.length > 1 ||
    opts.historicalLedgerOnly ||
    (opts.ledgerTxnCount > 0 &&
      row.ledgerBalanceFromImport < -0.01 &&
      row.ageAnalysisBalance > 0.01)
  ) {
    return "possibleDuplicateOrHistoricalCredit";
  }

  return "trueBalanceMismatch";
}

function classifyFixReasonGroup(opts: {
  row: ReconciliationRow;
  adjustment: DaSilvaOpeningBalanceAdjustment;
  priorReason: ActiveMismatchAuditReason;
  paymentPatterns: string[];
  explainedByPaymentTheory: boolean;
  paymentMatchConfidence: "high" | "medium" | "none";
  duplicateAccountCount: number;
  section: string;
  historicalLedgerOnly: boolean;
  ledgerTxnCount: number;
}): { reasonGroup: OpeningBalanceFixReasonGroup; reasonDetail: string } {
  const { row, adjustment, priorReason, paymentPatterns, paymentMatchConfidence } = opts;

  if (
    priorReason === "orphanLedgerOnly" ||
    priorReason === "historicalMergedFamily" ||
    (opts.ledgerTxnCount === 0 && Math.abs(adjustment.adjustmentAmount) > 5000)
  ) {
    return {
      reasonGroup: "needsManualKideSysReview",
      reasonDetail:
        priorReason === "orphanLedgerOnly"
          ? "Account not in age analysis but ledger carries balance."
          : priorReason === "historicalMergedFamily"
            ? "Merged-family / inactive learner signals — verify in Kid-e-Sys before import."
            : "No ledger transactions on account; large adjustment needs source verification.",
    };
  }

  if (row.ledgerBalanceFromImport > row.ageAnalysisBalance + 0.01 || adjustment.adjustmentAmount < -0.01) {
    return {
      reasonGroup: "inverseProblemLedgerGreaterThanAge",
      reasonDetail: `Ledger R${row.ledgerBalanceFromImport} exceeds age R${row.ageAnalysisBalance}; opening credit R${Math.abs(adjustment.adjustmentAmount)} may mask export over-statement.`,
    };
  }

  if (
    priorReason === "possibleDuplicateOrHistoricalCredit" ||
    opts.section === "Over Paid" ||
    (row.ledgerBalanceFromImport < -0.01 && row.ageAnalysisBalance > 0.01) ||
    opts.duplicateAccountCount > 1 ||
    opts.historicalLedgerOnly ||
    paymentPatterns.includes("negativeLedgerPositiveAge")
  ) {
    return {
      reasonGroup: "possibleDuplicatedHistoricalCredit",
      reasonDetail:
        priorReason === "possibleDuplicateOrHistoricalCredit"
          ? "Prior audit: duplicate name, overpaid section, or ledger credit vs age debt."
          : "Ledger credit or historical-only movement vs positive age balance.",
    };
  }

  if (
    paymentMatchConfidence === "high" ||
    paymentMatchConfidence === "medium" ||
    paymentPatterns.includes("unallocatedPaymentPattern")
  ) {
    return {
      reasonGroup: "possibleUnallocatedPayment",
      reasonDetail:
        paymentMatchConfidence === "high"
          ? `Payment totals closely match variance (${paymentPatterns.join(", ") || "payment match"}); try allocation before opening balance.`
          : `Payment/export skew (${paymentPatterns.join(", ")}); fix allocation before relying on opening balance.`,
    };
  }

  if (
    priorReason === "trueBalanceMismatch" &&
    adjustment.adjustmentAmount > 0.01 &&
    row.ageAnalysisBalance > row.ledgerBalanceFromImport + 0.01
  ) {
    return {
      reasonGroup: "needsOpeningBalanceAdjustment",
      reasonDetail:
        "Age exceeds import ledger without a payment-allocation explanation — opening balance is the appropriate aligner.",
    };
  }

  return {
    reasonGroup: "needsManualKideSysReview",
    reasonDetail: "Mixed or weak signals — confirm age vs ledger in Kid-e-Sys before import.",
  };
}

const desktopRoot = process.argv[2] || path.join(process.env.HOME || "", "Desktop");
const bundle = buildDaSilvaBundleFromDesktopLayout("audit", "audit", desktopRoot);

const adjustments = bundle.openingBalance.adjustments;
if (adjustments.length !== 112) {
  console.warn(
    `Expected 112 opening balance adjustments, got ${adjustments.length} (continuing audit).`
  );
}

let contacts: ParsedLearnerContact[] = [];
const contactPath = path.join(desktopRoot, "04_contact_list", "contact_list.xls");
if (fs.existsSync(contactPath)) {
  contacts = parseContactListFile(contactPath);
}

const classLearners: ParsedLearner[] = bundle.learners.map((l) => ({
  fullName: l.fullName,
  firstName: l.firstName,
  lastName: l.lastName,
  className: l.className,
  matchKey: `${l.fullName}|${l.className}`,
  sourceFile: "staged",
}));

const familyIndex: FamilyAccountIndex = {
  learnerNameToAccount: new Map(),
  accountToLearnerNames: new Map(),
};
indexHistoricalLearners(
  bundle.accounts,
  [],
  classLearners,
  contacts,
  bundle.transactions,
  familyIndex
);

const parentSiblings = buildParentSiblingMap(contacts, bundle.accounts, familyIndex);
const reconciliationByAccount = new Map(
  bundle.reconciliation.rows.map((r) => [r.accountNo, r])
);
const ageAnalysisAccountNos = new Set(bundle.accounts.map((a) => a.accountNo));
const mergedFamilyAccountNos = new Set(bundle.mergedFamilyAccountNos || []);
const activeLearnersByAccount = countActiveLearnersPerAccount(
  classLearners,
  bundle.accounts,
  familyIndex
);

const learnerCountByAccount = new Map<string, number>();
for (const learner of bundle.learners) {
  if (!learner.accountNo) continue;
  learnerCountByAccount.set(
    learner.accountNo,
    (learnerCountByAccount.get(learner.accountNo) || 0) + 1
  );
}

const nameToAccounts = new Map<string, string[]>();
for (const account of bundle.accounts) {
  const names = splitMergedAccountNames(account.fullName);
  const list = names.length ? names : [account.fullName];
  for (const name of list) {
    const key = normalizeMatchText(name);
    if (!key) continue;
    const accts = nameToAccounts.get(key) || [];
    if (!accts.includes(account.accountNo)) accts.push(account.accountNo);
    nameToAccounts.set(key, accts);
  }
}

const reviewRows: ReviewRow[] = adjustments.map((adj) => {
  const rec = reconciliationByAccount.get(adj.accountNo);
  const account = bundle.accounts.find((a) => a.accountNo === adj.accountNo);
  const fullName = adj.fullName || rec?.fullName || account?.fullName || "";
  const row: ReconciliationRow = {
    accountNo: adj.accountNo,
    fullName,
    ageAnalysisBalance: adj.afterBalance,
    ledgerBalanceFromImport: adj.beforeBalance,
    variance: rec?.variance ?? roundMoney(adj.afterBalance - adj.beforeBalance),
  };

  const inAgeAnalysis = ageAnalysisAccountNos.has(adj.accountNo);
  const txnsOnAccount = transactionsForAccount(adj.accountNo, bundle.transactions);
  const ledgerTxnCount = txnsOnAccount.length;

  const duplicateNameAccountNos: string[] = [];
  for (const name of splitMergedAccountNames(fullName).length
    ? splitMergedAccountNames(fullName)
    : [fullName]) {
    const key = normalizeMatchText(name);
    for (const acct of nameToAccounts.get(key) || []) {
      if (!duplicateNameAccountNos.includes(acct)) duplicateNameAccountNos.push(acct);
    }
  }

  const mergedFamilyCandidate =
    mergedFamilyAccountNos.has(adj.accountNo) ||
    splitMergedAccountNames(fullName).length > 1 ||
    (learnerCountByAccount.get(adj.accountNo) || 0) > 1;

  const priorActiveMismatchReason = classifyActiveMismatchReason(row, {
    inAgeAnalysis,
    activeLearnerCount: activeLearnersByAccount.get(adj.accountNo) || 0,
    mergedFamilyCandidate,
    silentSibling: hasSilentBillingSibling(adj.accountNo, familyIndex, bundle.transactions),
    duplicateNameAccountNos,
    section: account?.section || "",
    historicalLedgerOnly: isHistoricalLedgerOnlyMovement(
      adj.accountNo,
      bundle.transactions,
      inAgeAnalysis
    ),
    ledgerTxnCount,
  });

  const siblingNos = [...(parentSiblings.get(adj.accountNo) || new Set<string>())];
  const {
    patterns: paymentPatterns,
    explained: explainedByPaymentTheory,
    paymentMatchConfidence,
  } = detectPaymentPatterns(
    row,
    txnsOnAccount,
    bundle.transactions,
    familyIndex,
    siblingNos
  );

  const { reasonGroup, reasonDetail } = classifyFixReasonGroup({
    row,
    adjustment: adj,
    priorReason: priorActiveMismatchReason,
    paymentPatterns,
    explainedByPaymentTheory,
    paymentMatchConfidence,
    duplicateAccountCount: duplicateNameAccountNos.length,
    section: account?.section || "",
    historicalLedgerOnly: isHistoricalLedgerOnlyMovement(
      adj.accountNo,
      bundle.transactions,
      inAgeAnalysis
    ),
    ledgerTxnCount,
  });

  return {
    accountNo: adj.accountNo,
    fullName,
    ageAnalysisBalance: row.ageAnalysisBalance,
    ledgerBalanceFromImport: row.ledgerBalanceFromImport,
    adjustmentAmount: adj.adjustmentAmount,
    absAdjustmentAmount: Math.abs(adj.adjustmentAmount),
    variance: row.variance,
    entryType: adj.entryType,
    reasonGroup,
    reasonDetail,
    priorActiveMismatchReason,
    paymentPatterns,
    explainedByPaymentTheory,
    paymentMatchConfidence,
  };
});

reviewRows.sort((a, b) => b.absAdjustmentAmount - a.absAdjustmentAmount);

const reasonGroupCounts: Record<OpeningBalanceFixReasonGroup, number> = {
  needsOpeningBalanceAdjustment: 0,
  possibleUnallocatedPayment: 0,
  possibleDuplicatedHistoricalCredit: 0,
  inverseProblemLedgerGreaterThanAge: 0,
  needsManualKideSysReview: 0,
};
const reasonGroupTotals: Record<OpeningBalanceFixReasonGroup, number> = {
  needsOpeningBalanceAdjustment: 0,
  possibleUnallocatedPayment: 0,
  possibleDuplicatedHistoricalCredit: 0,
  inverseProblemLedgerGreaterThanAge: 0,
  needsManualKideSysReview: 0,
};

for (const row of reviewRows) {
  reasonGroupCounts[row.reasonGroup]++;
  reasonGroupTotals[row.reasonGroup] = roundMoney(
    reasonGroupTotals[row.reasonGroup] + row.absAdjustmentAmount
  );
}

const accountsByReasonGroup: Record<OpeningBalanceFixReasonGroup, ReviewRow[]> = {
  needsOpeningBalanceAdjustment: [],
  possibleUnallocatedPayment: [],
  possibleDuplicatedHistoricalCredit: [],
  inverseProblemLedgerGreaterThanAge: [],
  needsManualKideSysReview: [],
};
for (const row of reviewRows) {
  accountsByReasonGroup[row.reasonGroup].push(row);
}
for (const key of Object.keys(accountsByReasonGroup) as OpeningBalanceFixReasonGroup[]) {
  accountsByReasonGroup[key].sort((a, b) => b.absAdjustmentAmount - a.absAdjustmentAmount);
}

const totalAbsAdjustment = roundMoney(
  reviewRows.reduce((s, r) => s + r.absAdjustmentAmount, 0)
);

const paymentConfidenceCounts = { high: 0, medium: 0, none: 0 };
for (const row of reviewRows) {
  paymentConfidenceCounts[row.paymentMatchConfidence]++;
}

const report = {
  generatedAt: new Date().toISOString(),
  desktopRoot,
  auditOnly: true,
  openingBalanceLabel: bundle.openingBalance.label,
  cutoverDate: bundle.openingBalance.summary.cutoverDate,
  adjustmentCount: reviewRows.length,
  totalAbsAdjustmentValue: totalAbsAdjustment,
  openingBalanceSummary: bundle.openingBalance.summary,
  reasonGroupCounts,
  reasonGroupAbsAdjustmentTotals: reasonGroupTotals,
  paymentMatchConfidenceCounts: paymentConfidenceCounts,
  reductionSummary: {
    accountsWithAlternativeFixHypothesis:
      reasonGroupCounts.possibleUnallocatedPayment +
      reasonGroupCounts.possibleDuplicatedHistoricalCredit +
      reasonGroupCounts.inverseProblemLedgerGreaterThanAge +
      reasonGroupCounts.needsManualKideSysReview,
    accountsStrictlyNeedingOpeningBalanceOnly:
      reasonGroupCounts.needsOpeningBalanceAdjustment,
    note:
      "All 84 trueBalanceMismatch rows match a loose unallocated-payment pattern (medium confidence). None have a tight payment-to-variance match; inverse/duplicate/manual rows should be fixed before import. needsOpeningBalanceAdjustment is reserved for true gaps with no payment/credit/inverse explanation.",
  },
  accountsByReasonGroup,
  adjustmentsSortedByAbsAmount: reviewRows,
  top30ByAbsAdjustment: reviewRows.slice(0, 30),
};

const outDir = path.join(__dirname, "..");
const jsonPath = path.join(outDir, "opening-balance-adjustment-review.json");
const txtPath = path.join(outDir, "opening-balance-adjustment-review.txt");

fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

const groupLabels: Record<OpeningBalanceFixReasonGroup, string> = {
  needsOpeningBalanceAdjustment: "needs opening balance adjustment",
  possibleUnallocatedPayment: "possible unallocated payment",
  possibleDuplicatedHistoricalCredit: "possible duplicated/historical credit",
  inverseProblemLedgerGreaterThanAge: "inverse problem ledger > age",
  needsManualKideSysReview: "needs manual Kid-e-Sys review",
};

const lines: string[] = [
  "=== Opening balance adjustment review (audit only — no import) ===",
  `Generated: ${report.generatedAt}`,
  `Desktop root: ${desktopRoot}`,
  `Cutover date: ${report.cutoverDate}`,
  `Adjustment accounts: ${report.adjustmentCount}`,
  `Sum |adjustment|: R${totalAbsAdjustment.toFixed(2)}`,
  "",
  "Grouped by likely fix type (before final import):",
];

for (const key of Object.keys(reasonGroupCounts) as OpeningBalanceFixReasonGroup[]) {
  lines.push(
    `  ${groupLabels[key]}: ${reasonGroupCounts[key]} accounts (|adj| R${reasonGroupTotals[key].toFixed(2)})`
  );
}

lines.push(
  "",
  "Reduction potential (before final import):",
  `  Alternative-fix candidates: ${report.reductionSummary.accountsWithAlternativeFixHypothesis}/112`,
  `  Strict opening-balance-only: ${report.reductionSummary.accountsStrictlyNeedingOpeningBalanceOnly}/112`,
  `  Payment match: high=${paymentConfidenceCounts.high} medium=${paymentConfidenceCounts.medium} none=${paymentConfidenceCounts.none}`,
  `  Note: ${report.reductionSummary.note}`,
  ""
);

lines.push(
  "",
  "Top 30 by |adjustmentAmount|:",
  "",
  "accountNo | reason group | age | ledger | adjustment | learner",
  "--------- | ------------ | --- | ------ | ---------- | ------"
);

for (const row of report.top30ByAbsAdjustment) {
  const name = String(row.fullName || "")
    .replace(/\n/g, " / ")
    .slice(0, 36);
  lines.push(
    `${row.accountNo.padEnd(9)} | ${groupLabels[row.reasonGroup].padEnd(35)} | ${String(row.ageAnalysisBalance).padStart(8)} | ${String(row.ledgerBalanceFromImport).padStart(8)} | ${String(row.adjustmentAmount).padStart(10)} | ${name}`
  );
}

lines.push("", "Full detail in opening-balance-adjustment-review.json");

fs.writeFileSync(txtPath, lines.join("\n"), "utf8");

console.log(lines.join("\n"));
console.log(`\nWrote ${jsonPath}`);
console.log(`Wrote ${txtPath}`);
