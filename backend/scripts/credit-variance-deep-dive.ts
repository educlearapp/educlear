/**
 * Audit-only: transaction timelines for 26 possible duplicated/historical credit rows.
 * Usage: npx ts-node scripts/credit-variance-deep-dive.ts [desktopRoot]
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

const JOURNAL_CORRECTION_NOTE =
  /\b(journal|jnl|correction|correct|adjustment|adj|credit note|cn\b|write[\s-]?off|reversal|reverse|transfer|contra)\b/i;

type CreditLedgerCause =
  | "paymentWithoutMatchingInvoice"
  | "duplicatedPayment"
  | "historicalCredit"
  | "transactionPostedToWrongAccount"
  | "familyMergedAccountStillMissed"
  | "cannotDetermine";

type ReviewTarget = {
  accountNo: string;
  fullName: string;
  ageAnalysisBalance: number;
  ledgerBalanceFromImport: number;
  adjustmentAmount: number;
  variance: number;
};

type SerializedTxn = {
  date: string;
  kind: "invoice" | "payment";
  transactionNo: string;
  reference: string;
  accountNo: string;
  fullName: string;
  notes: string;
  amount: number;
  signedAmount: number;
  runningBalance: number;
  flags: {
    historicalNote: boolean;
    journalOrCorrection: boolean;
    misPostedByLearnerName: boolean;
    duplicateFingerprint: boolean;
  };
};

type AccountDeepDive = {
  accountNo: string;
  fullName: string;
  ageAnalysisBalance: number;
  ledgerBalanceFromImport: number;
  adjustmentAmount: number;
  variance: number;
  section: string;
  invoices: SerializedTxn[];
  payments: SerializedTxn[];
  journalCorrectionCreditRows: SerializedTxn[];
  timeline: SerializedTxn[];
  metrics: {
    invoiceCount: number;
    paymentCount: number;
    invoiceSum: number;
    paymentSum: number;
    computedLedgerFromTxns: number;
    ledgerMatchesImport: boolean;
    duplicatePaymentFingerprints: string[];
    misPostedTxnCount: number;
    crossAccountOutboundPaymentTotal: number;
    crossAccountInboundPaymentTotal: number;
    historicalNoteTxnCount: number;
    journalCorrectionTxnCount: number;
    duplicateNameAccountNos: string[];
    siblingAccountNos: string[];
    siblingCombinedVariance: number | null;
    familyVarianceImprovement: number | null;
    mergedFamilySignals: string[];
  };
  negativeCreditLedgerCause: CreditLedgerCause;
  causeConfidence: "high" | "medium" | "low";
  causeDetail: string;
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumSigned(txns: ParsedTransaction[]): number {
  return roundMoney(txns.reduce((s, t) => s + t.signedAmount, 0));
}

function sumInvoices(txns: ParsedTransaction[]): number {
  return roundMoney(
    txns.filter((t) => t.kind === "invoice").reduce((s, t) => s + t.signedAmount, 0)
  );
}

function sumPayments(txns: ParsedTransaction[]): number {
  return roundMoney(
    txns.filter((t) => t.kind === "payment").reduce((s, t) => s + t.signedAmount, 0)
  );
}

function txnFingerprint(t: ParsedTransaction): string {
  return `${t.kind}|${t.transactionNo}|${t.accountNo}|${t.signedAmount.toFixed(2)}|${t.date}`;
}

function parseIsoDate(d: string): number {
  const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return 0;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function isJournalOrCorrection(t: ParsedTransaction): boolean {
  const note = String(t.notes || "").trim();
  if (!note) return false;
  return JOURNAL_CORRECTION_NOTE.test(note) || HISTORICAL_MOVEMENT_NOTE.test(note);
}

function isHistoricalNote(t: ParsedTransaction): boolean {
  return HISTORICAL_MOVEMENT_NOTE.test(String(t.notes || ""));
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

function findDuplicateFingerprints(txns: ParsedTransaction[]): string[] {
  const seen = new Map<string, number>();
  const dups: string[] = [];
  for (const t of txns) {
    const fp = txnFingerprint(t);
    const n = (seen.get(fp) || 0) + 1;
    seen.set(fp, n);
    if (n === 2) dups.push(fp);
  }
  return dups;
}

function near(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

function classifyCreditLedgerCause(opts: {
  row: ReviewTarget;
  section: string;
  txns: ParsedTransaction[];
  duplicateFingerprints: string[];
  misPostedTxnCount: number;
  crossAccountInbound: number;
  crossAccountOutbound: number;
  siblingCombinedVariance: number | null;
  familyVarianceImprovement: number | null;
  mergedFamilySignals: string[];
  historicalOnlyLedger: boolean;
  duplicateNameCount: number;
}): { cause: CreditLedgerCause; confidence: AccountDeepDive["causeConfidence"]; detail: string } {
  const {
    row,
    section,
    txns,
    duplicateFingerprints,
    misPostedTxnCount,
    crossAccountInbound,
    crossAccountOutbound,
    siblingCombinedVariance,
    familyVarianceImprovement,
    mergedFamilySignals,
    historicalOnlyLedger,
    duplicateNameCount,
  } = opts;

  const invoiceCount = txns.filter((t) => t.kind === "invoice").length;
  const paymentCount = txns.filter((t) => t.kind === "payment").length;
  const invoiceSum = sumInvoices(txns);
  const paymentSum = sumPayments(txns);
  const dupPayments = duplicateFingerprints.filter((fp) => fp.startsWith("payment|"));
  const lifetimeOverpayment = roundMoney(Math.abs(paymentSum) - invoiceSum);
  const negativeLedgerPositiveAge =
    row.ledgerBalanceFromImport < -0.01 && row.ageAnalysisBalance > 0.01;

  if (dupPayments.length > 0) {
    return {
      cause: "duplicatedPayment",
      confidence: "high",
      detail: `${dupPayments.length} duplicate payment fingerprint(s) on account; payments R${Math.abs(paymentSum).toFixed(2)} vs invoices R${invoiceSum.toFixed(2)}.`,
    };
  }

  if (misPostedTxnCount > 0 || crossAccountInbound > 200 || crossAccountOutbound > 200) {
    return {
      cause: "transactionPostedToWrongAccount",
      confidence: misPostedTxnCount > 0 ? "high" : "medium",
      detail: `Mis-posted by learner name: ${misPostedTxnCount} txn(s); cross-account outbound R${crossAccountOutbound.toFixed(2)}, inbound R${crossAccountInbound.toFixed(2)}.`,
    };
  }

  if (
    familyVarianceImprovement !== null &&
    familyVarianceImprovement > 200 &&
    (mergedFamilySignals.length > 0 ||
      (siblingCombinedVariance !== null &&
        Math.abs(siblingCombinedVariance) < Math.abs(row.variance) - 100))
  ) {
    return {
      cause: "familyMergedAccountStillMissed",
      confidence: "medium",
      detail: `Sibling/parent-linked accounts still show R${Math.abs(row.variance)} gap; combined family variance R${siblingCombinedVariance ?? "?"} (${mergedFamilySignals.join("; ") || "sibling rollup"}).`,
    };
  }

  const paymentsWithoutInvoice =
    (invoiceCount === 0 && paymentCount > 0) ||
    (paymentCount > 0 &&
      invoiceSum > 0.01 &&
      Math.abs(paymentSum) > invoiceSum + 50 &&
      (negativeLedgerPositiveAge ||
        near(lifetimeOverpayment, Math.abs(row.ledgerBalanceFromImport), 150)));

  if (paymentsWithoutInvoice) {
    return {
      cause: "paymentWithoutMatchingInvoice",
      confidence:
        invoiceCount === 0 || near(lifetimeOverpayment, Math.abs(row.ledgerBalanceFromImport), 50)
          ? "high"
          : "medium",
      detail:
        invoiceCount === 0
          ? `${paymentCount} payment(s), no invoices on account — ledger credit R${Math.abs(row.ledgerBalanceFromImport).toFixed(2)} vs age R${row.ageAnalysisBalance}.`
          : `Lifetime payments (R${Math.abs(paymentSum).toFixed(2)}) exceed invoices (R${invoiceSum.toFixed(2)}) by R${lifetimeOverpayment.toFixed(2)}${near(lifetimeOverpayment, Math.abs(row.ledgerBalanceFromImport), 50) ? ` — matches ledger credit R${Math.abs(row.ledgerBalanceFromImport).toFixed(2)}` : ""}; age analysis still R${row.ageAnalysisBalance}.`,
    };
  }

  if (
    section === "Over Paid" ||
    historicalOnlyLedger ||
    (row.ledgerBalanceFromImport < -0.01 &&
      txns.length > 0 &&
      txns.every((t) => !t.notes.trim() || isHistoricalNote(t)))
  ) {
    return {
      cause: "historicalCredit",
      confidence: section === "Over Paid" ? "high" : "medium",
      detail:
        section === "Over Paid"
          ? "Age analysis section is Over Paid — ledger credit vs age debt."
          : "All ledger movements carry historical/refund/write-off style notes.",
    };
  }

  const historicalPaymentCount = txns.filter(
    (t) => t.kind === "payment" && isHistoricalNote(t)
  ).length;
  if (
    historicalPaymentCount > 0 &&
    (section === "Bad Debt" || row.ageAnalysisBalance > row.ledgerBalanceFromImport + 500)
  ) {
    return {
      cause: "historicalCredit",
      confidence: "medium",
      detail: `${historicalPaymentCount} payment(s) with historical/refund notes; section "${section || "n/a"}".`,
    };
  }

  if (duplicateNameCount > 1) {
    return {
      cause: "cannotDetermine",
      confidence: "low",
      detail: `Duplicate learner name on ${duplicateNameCount} accounts; ledger R${row.ledgerBalanceFromImport} vs age R${row.ageAnalysisBalance} — no single dominant pattern.`,
    };
  }

  return {
    cause: "cannotDetermine",
    confidence: "low",
    detail: `Ledger R${row.ledgerBalanceFromImport} vs age R${row.ageAnalysisBalance} (variance R${row.variance}); ${invoiceCount} inv / ${paymentCount} pay — mixed signals.`,
  };
}

function buildSerializedTimeline(
  txns: ParsedTransaction[],
  accountNo: string,
  familyIndex: FamilyAccountIndex,
  duplicateFps: Set<string>
): { invoices: SerializedTxn[]; payments: SerializedTxn[]; journalCorrectionCreditRows: SerializedTxn[]; timeline: SerializedTxn[] } {
  const sorted = [...txns].sort((a, b) => {
    const da = parseIsoDate(a.date);
    const db = parseIsoDate(b.date);
    if (da !== db) return da - db;
    if (a.kind !== b.kind) return a.kind === "invoice" ? -1 : 1;
    return a.transactionNo.localeCompare(b.transactionNo);
  });

  let running = 0;
  const timeline: SerializedTxn[] = sorted.map((t) => {
    running = roundMoney(running + t.signedAmount);
    const misPosted =
      resolveFamilyAccountNo(t, familyIndex) !== accountNo && normalizeMatchText(t.fullName) !== "";
    const row: SerializedTxn = {
      date: t.date,
      kind: t.kind,
      transactionNo: t.transactionNo,
      reference: t.reference,
      accountNo: t.accountNo,
      fullName: t.fullName,
      notes: t.notes,
      amount: t.amount,
      signedAmount: t.signedAmount,
      runningBalance: running,
      flags: {
        historicalNote: isHistoricalNote(t),
        journalOrCorrection: isJournalOrCorrection(t),
        misPostedByLearnerName: misPosted,
        duplicateFingerprint: duplicateFps.has(txnFingerprint(t)),
      },
    };
    return row;
  });

  const invoices = timeline.filter((t) => t.kind === "invoice");
  const payments = timeline.filter((t) => t.kind === "payment");
  const journalCorrectionCreditRows = timeline.filter(
    (t) => t.flags.journalOrCorrection || t.flags.historicalNote || (t.kind === "payment" && t.signedAmount > 0)
  );

  return { invoices, payments, journalCorrectionCreditRows, timeline };
}

const desktopRoot = process.argv[2] || path.join(process.env.HOME || "", "Desktop");
const reviewPath = path.join(__dirname, "..", "opening-balance-adjustment-review.json");
if (!fs.existsSync(reviewPath)) {
  console.error(`Missing ${reviewPath} — run opening-balance-adjustment-review.ts first.`);
  process.exit(1);
}

const review = JSON.parse(fs.readFileSync(reviewPath, "utf8")) as {
  accountsByReasonGroup: { possibleDuplicatedHistoricalCredit: ReviewTarget[] };
};

const targets: ReviewTarget[] = (
  review.accountsByReasonGroup?.possibleDuplicatedHistoricalCredit || []
).map((r) => ({
  accountNo: r.accountNo,
  fullName: r.fullName,
  ageAnalysisBalance: r.ageAnalysisBalance,
  ledgerBalanceFromImport: r.ledgerBalanceFromImport,
  adjustmentAmount: r.adjustmentAmount ?? r.variance,
  variance: r.variance,
}));

if (targets.length !== 26) {
  console.warn(`Expected 26 credit-variance targets, got ${targets.length} (continuing).`);
}

const bundle = buildDaSilvaBundleFromDesktopLayout("audit", "audit", desktopRoot);

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

const parentSiblings = buildParentSiblingMap(contacts, familyIndex);
const reconciliationByAccount = new Map(
  bundle.reconciliation.rows.map((r) => [
    r.accountNo,
    { age: r.ageAnalysisBalance, ledger: r.ledgerBalanceFromImport, variance: r.variance },
  ])
);
const mergedFamilyAccountNos = new Set(bundle.mergedFamilyAccountNos || []);
const activeLearnersByAccount = countActiveLearnersPerAccount(
  classLearners,
  bundle.accounts,
  familyIndex
);

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

const deepDives: AccountDeepDive[] = [];

for (const row of targets) {
  const account = bundle.accounts.find((a) => a.accountNo === row.accountNo);
  const txns = bundle.transactions.filter((t) => t.accountNo === row.accountNo);
  const duplicateFps = new Set(findDuplicateFingerprints(txns));

  let misPostedTxnCount = 0;
  let crossAccountOutbound = 0;
  let crossAccountInbound = 0;

  for (const t of txns) {
    const family = resolveFamilyAccountNo(t, familyIndex);
    if (family && family !== row.accountNo) {
      misPostedTxnCount++;
      if (t.kind === "payment") crossAccountOutbound += Math.abs(t.signedAmount);
    }
  }

  for (const t of bundle.transactions) {
    if (t.accountNo === row.accountNo) continue;
    const family = resolveFamilyAccountNo(t, familyIndex);
    if (family === row.accountNo && t.kind === "payment") {
      crossAccountInbound += Math.abs(t.signedAmount);
    }
  }

  const duplicateNameAccountNos: string[] = [];
  for (const name of splitMergedAccountNames(row.fullName).length
    ? splitMergedAccountNames(row.fullName)
    : [row.fullName]) {
    const key = normalizeMatchText(name);
    for (const acct of nameToAccounts.get(key) || []) {
      if (!duplicateNameAccountNos.includes(acct)) duplicateNameAccountNos.push(acct);
    }
  }

  const siblingAccountNos = [...(parentSiblings.get(row.accountNo) || new Set<string>())];
  let siblingCombinedVariance: number | null = null;
  let familyVarianceImprovement: number | null = null;
  if (siblingAccountNos.length > 0) {
    let combinedAge = row.ageAnalysisBalance;
    let combinedLedger = row.ledgerBalanceFromImport;
    for (const sib of siblingAccountNos) {
      const rec = reconciliationByAccount.get(sib);
      if (!rec) continue;
      combinedAge += rec.age;
      combinedLedger += rec.ledger;
    }
    siblingCombinedVariance = roundMoney(combinedAge - combinedLedger);
    familyVarianceImprovement = roundMoney(Math.abs(row.variance) - Math.abs(siblingCombinedVariance));
  }

  const mergedFamilySignals: string[] = [];
  if (mergedFamilyAccountNos.has(row.accountNo)) mergedFamilySignals.push("mergedFamilyAccountNos");
  if (splitMergedAccountNames(row.fullName).length > 1) mergedFamilySignals.push("splitMergedAccountName");
  if (hasSilentBillingSibling(row.accountNo, familyIndex, bundle.transactions)) {
    mergedFamilySignals.push("silentBillingSibling");
  }
  if ((activeLearnersByAccount.get(row.accountNo) || 0) === 0) {
    mergedFamilySignals.push("zeroActiveLearnersOnAccount");
  }

  const historicalOnlyLedger =
    txns.length > 0 &&
    txns.every((t) => {
      const note = String(t.notes || "").trim();
      return !note || HISTORICAL_MOVEMENT_NOTE.test(note);
    });

  const { cause, confidence, detail } = classifyCreditLedgerCause({
    row,
    section: account?.section || "",
    txns,
    duplicateFingerprints: [...duplicateFps],
    misPostedTxnCount,
    crossAccountInbound,
    crossAccountOutbound,
    siblingCombinedVariance,
    familyVarianceImprovement,
    mergedFamilySignals,
    historicalOnlyLedger,
    duplicateNameCount: duplicateNameAccountNos.length,
  });

  const { invoices, payments, journalCorrectionCreditRows, timeline } = buildSerializedTimeline(
    txns,
    row.accountNo,
    familyIndex,
    duplicateFps
  );

  const computedLedger = timeline.length ? timeline[timeline.length - 1].runningBalance : 0;

  deepDives.push({
    accountNo: row.accountNo,
    fullName: row.fullName,
    ageAnalysisBalance: row.ageAnalysisBalance,
    ledgerBalanceFromImport: row.ledgerBalanceFromImport,
    adjustmentAmount: row.adjustmentAmount,
    variance: row.variance,
    section: account?.section || "",
    invoices,
    payments,
    journalCorrectionCreditRows,
    timeline,
    metrics: {
      invoiceCount: invoices.length,
      paymentCount: payments.length,
      invoiceSum: sumInvoices(txns),
      paymentSum: sumPayments(txns),
      computedLedgerFromTxns: computedLedger,
      ledgerMatchesImport: Math.abs(computedLedger - row.ledgerBalanceFromImport) <= 0.02,
      duplicatePaymentFingerprints: [...duplicateFps].filter((fp) => fp.startsWith("payment|")),
      misPostedTxnCount,
      crossAccountOutboundPaymentTotal: roundMoney(crossAccountOutbound),
      crossAccountInboundPaymentTotal: roundMoney(crossAccountInbound),
      historicalNoteTxnCount: txns.filter((t) => isHistoricalNote(t)).length,
      journalCorrectionTxnCount: txns.filter((t) => isJournalOrCorrection(t)).length,
      duplicateNameAccountNos,
      siblingAccountNos,
      siblingCombinedVariance,
      familyVarianceImprovement,
      mergedFamilySignals,
    },
    negativeCreditLedgerCause: cause,
    causeConfidence: confidence,
    causeDetail: detail,
  });
}

deepDives.sort((a, b) => Math.abs(b.adjustmentAmount) - Math.abs(a.adjustmentAmount));

const causeCounts: Record<CreditLedgerCause, number> = {
  paymentWithoutMatchingInvoice: 0,
  duplicatedPayment: 0,
  historicalCredit: 0,
  transactionPostedToWrongAccount: 0,
  familyMergedAccountStillMissed: 0,
  cannotDetermine: 0,
};
for (const d of deepDives) causeCounts[d.negativeCreditLedgerCause]++;

const report = {
  generatedAt: new Date().toISOString(),
  desktopRoot,
  auditOnly: true,
  sourceReview: "opening-balance-adjustment-review.json",
  reasonGroup: "possibleDuplicatedHistoricalCredit",
  accountCount: deepDives.length,
  totalAbsAdjustment: roundMoney(deepDives.reduce((s, d) => s + Math.abs(d.adjustmentAmount), 0)),
  negativeCreditLedgerCauseCounts: causeCounts,
  accounts: deepDives,
};

const outJson = path.join(__dirname, "..", "credit-variance-deep-dive.json");
const outTxt = path.join(__dirname, "..", "credit-variance-deep-dive.txt");

fs.writeFileSync(outJson, JSON.stringify(report, null, 2), "utf8");

const causeLabels: Record<CreditLedgerCause, string> = {
  paymentWithoutMatchingInvoice: "payment without matching invoice",
  duplicatedPayment: "duplicated payment",
  historicalCredit: "historical credit",
  transactionPostedToWrongAccount: "transaction posted to wrong account",
  familyMergedAccountStillMissed: "family/merged account still missed",
  cannotDetermine: "cannot determine",
};

const lines: string[] = [
  "=== Credit variance deep dive (26 rows, audit only — no import) ===",
  `Generated: ${report.generatedAt}`,
  `Desktop: ${desktopRoot}`,
  `Accounts: ${report.accountCount} | Sum |adjustment|: R${report.totalAbsAdjustment.toFixed(2)}`,
  "",
  "Negative/credit ledger cause summary:",
  ...Object.entries(causeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `  ${causeLabels[k as CreditLedgerCause]}: ${n}`),
  "",
  "Top 10 by |adjustmentAmount|:",
  "accountNo | cause | conf | age | ledger | adj | inv | pay | learner",
  "--------- | ----- | ---- | --- | ------ | --- | --- | --- | -------",
];

for (const d of deepDives.slice(0, 10)) {
  const name = String(d.fullName || "")
    .replace(/\n/g, " / ")
    .slice(0, 28);
  lines.push(
    `${d.accountNo.padEnd(9)} | ${causeLabels[d.negativeCreditLedgerCause].padEnd(35)} | ${d.causeConfidence.padEnd(4)} | ${String(d.ageAnalysisBalance).padStart(5)} | ${String(d.ledgerBalanceFromImport).padStart(6)} | ${String(d.adjustmentAmount).padStart(5)} | ${String(d.metrics.invoiceCount).padStart(3)} | ${String(d.metrics.paymentCount).padStart(3)} | ${name}`
  );
}

lines.push("", "Per-account timelines (abbreviated):", "");

for (const d of deepDives) {
  lines.push(`--- ${d.accountNo} ${d.fullName} ---`);
  lines.push(
    `  age R${d.ageAnalysisBalance} | ledger R${d.ledgerBalanceFromImport} | adjustment R${d.adjustmentAmount} | section: ${d.section || "(none)"}`
  );
  lines.push(`  cause: ${causeLabels[d.negativeCreditLedgerCause]} (${d.causeConfidence}) — ${d.causeDetail}`);
  lines.push(
    `  invoices: ${d.metrics.invoiceCount} (R${d.metrics.invoiceSum}) | payments: ${d.metrics.paymentCount} (R${d.metrics.paymentSum}) | journal/credit flagged: ${d.journalCorrectionCreditRows.length}`
  );
  if (d.metrics.duplicatePaymentFingerprints.length) {
    lines.push(`  duplicate payments: ${d.metrics.duplicatePaymentFingerprints.join("; ")}`);
  }
  if (d.metrics.siblingAccountNos.length) {
    lines.push(
      `  siblings: ${d.metrics.siblingAccountNos.join(", ")} | combined variance: ${d.metrics.siblingCombinedVariance}`
    );
  }
  lines.push("  timeline:");
  for (const t of d.timeline) {
    const flags: string[] = [];
    if (t.flags.duplicateFingerprint) flags.push("DUP");
    if (t.flags.misPostedByLearnerName) flags.push("MISPOST");
    if (t.flags.historicalNote) flags.push("HIST");
    if (t.flags.journalOrCorrection) flags.push("JNL");
    const flagStr = flags.length ? ` [${flags.join(",")}]` : "";
    lines.push(
      `    ${t.date} ${t.kind.padEnd(7)} #${t.transactionNo} R${t.signedAmount.toFixed(2)} bal R${t.runningBalance.toFixed(2)}${flagStr} ${t.notes ? `— ${t.notes.slice(0, 60)}` : ""}`
    );
  }
  lines.push("");
}

lines.push("Full JSON: credit-variance-deep-dive.json");

fs.writeFileSync(outTxt, lines.join("\n"), "utf8");

console.log(
  [
    lines[0],
    lines[1],
    lines[2],
    lines[3],
    "",
    lines[5],
    ...lines.slice(6, 6 + Object.keys(causeCounts).length),
    "",
    ...lines.filter((l) => l.startsWith("Top 10") || l === "accountNo | cause" || l === "--------- |" || (l.length > 9 && deepDives.slice(0, 10).some((d) => l.startsWith(d.accountNo)))),
    "",
    `Wrote ${outJson}`,
    `Wrote ${outTxt}`,
  ].join("\n")
);
