/**
 * Audit-only: final pass on 6 inverse (ledger > age) + 1 manual (MAR005) accounts.
 * Usage: npx ts-node scripts/inverse-and-manual-adjustment-audit.ts [desktopRoot]
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
  type ParsedLearner,
  type ParsedLearnerContact,
  type ParsedTransaction,
} from "../src/services/daSilvaMigration/parsers";
import { normalizeMatchText } from "../src/utils/kideesysSpreadsheet";

const HISTORICAL_MOVEMENT_NOTE =
  /\b(removed|refund|closed|not returning|relocat|write[\s-]?off|learner left|no longer|cancelled|canceled|credit note|discount|not doing|left school|historical|jamf|paid up|paid-up)\b/i;

const JOURNAL_CORRECTION_NOTE =
  /\b(journal|jnl|correction|correct|adjustment|adj|credit note|cn\b|write[\s-]?off|reversal|reverse|transfer|contra)\b/i;

type AccountCategory = "inverseProblemLedgerGreaterThanAge" | "needsManualKideSysReview";

type LikelyCause =
  | "duplicatedInvoice"
  | "extraLedgerChargesNotReflectedInAge"
  | "agePaidUpOrZeroedLedgerResidual"
  | "misPostedTransaction"
  | "ledgerExportOverstatement"
  | "historicalOrSectionSkew"
  | "cannotDetermine";

type ReviewTarget = {
  accountNo: string;
  fullName: string;
  ageAnalysisBalance: number;
  ledgerBalanceFromImport: number;
  adjustmentAmount: number;
  variance: number;
  category: AccountCategory;
  priorActiveMismatchReason: string;
  reasonDetail: string;
};

type SerializedTxn = {
  date: string;
  kind: "invoice" | "payment";
  transactionNo: string;
  reference: string;
  signedAmount: number;
  runningBalance: number;
  notes: string;
  flags: string[];
};

type AccountAudit = {
  accountNo: string;
  fullName: string;
  ageAnalysisBalance: number;
  ledgerBalanceFromImport: number;
  adjustmentAmount: number;
  category: AccountCategory;
  ledgerExcessOverAge: number;
  timelineSummary: string;
  likelyCause: LikelyCause;
  likelyCauseConfidence: "high" | "medium" | "low";
  likelyCauseDetail: string;
  openingBalanceAdjustmentSafe: boolean;
  openingBalanceAdjustmentSafety: "safe" | "caution" | "unsafe";
  openingBalanceSafetyRationale: string;
  section: string;
  priorActiveMismatchReason: string;
  metrics: {
    invoiceCount: number;
    paymentCount: number;
    invoiceSum: number;
    paymentSum: number;
    computedLedgerFromTxns: number;
    ledgerMatchesImport: boolean;
    duplicateInvoiceFingerprints: string[];
    duplicatePaymentFingerprints: string[];
    misPostedTxnCount: number;
    crossAccountInboundPaymentTotal: number;
    crossAccountOutboundPaymentTotal: number;
    journalOrHistoricalTxnCount: number;
    activeLearnerCount: number;
    inAgeAnalysis: boolean;
  };
  timeline: SerializedTxn[];
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function near(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
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

function isHistoricalNote(t: ParsedTransaction): boolean {
  return HISTORICAL_MOVEMENT_NOTE.test(String(t.notes || ""));
}

function isJournalOrCorrection(t: ParsedTransaction): boolean {
  const note = String(t.notes || "").trim();
  if (!note) return false;
  return JOURNAL_CORRECTION_NOTE.test(note) || HISTORICAL_MOVEMENT_NOTE.test(note);
}

function resolveFamilyAccountNo(txn: ParsedTransaction, index: FamilyAccountIndex): string {
  const byName = index.learnerNameToAccount.get(normalizeMatchText(txn.fullName));
  if (byName) return byName;
  return String(txn.accountNo || "").trim();
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

function buildTimeline(
  txns: ParsedTransaction[],
  accountNo: string,
  familyIndex: FamilyAccountIndex,
  duplicateFps: Set<string>
): SerializedTxn[] {
  const sorted = [...txns].sort((a, b) => {
    const da = parseIsoDate(a.date);
    const db = parseIsoDate(b.date);
    if (da !== db) return da - db;
    if (a.kind !== b.kind) return a.kind === "invoice" ? -1 : 1;
    return a.transactionNo.localeCompare(b.transactionNo);
  });

  let running = 0;
  return sorted.map((t) => {
    running = roundMoney(running + t.signedAmount);
    const flags: string[] = [];
    if (duplicateFps.has(txnFingerprint(t))) flags.push("DUP");
    if (resolveFamilyAccountNo(t, familyIndex) !== accountNo) flags.push("MISPOST");
    if (isHistoricalNote(t)) flags.push("HIST");
    if (isJournalOrCorrection(t)) flags.push("JNL");
    return {
      date: t.date,
      kind: t.kind,
      transactionNo: t.transactionNo,
      reference: t.reference,
      signedAmount: t.signedAmount,
      runningBalance: running,
      notes: t.notes,
      flags,
    };
  });
}

function summarizeTimeline(timeline: SerializedTxn[], section: string): string {
  if (timeline.length === 0) {
    return "No ledger transactions on account.";
  }
  const first = timeline[0];
  const last = timeline[timeline.length - 1];
  const inv = timeline.filter((t) => t.kind === "invoice");
  const pay = timeline.filter((t) => t.kind === "payment");
  const flagged = timeline.filter((t) => t.flags.length > 0);
  const parts: string[] = [
    `${timeline.length} txn(s): ${inv.length} invoice(s) R${roundMoney(inv.reduce((s, t) => s + t.signedAmount, 0))}, ${pay.length} payment(s) R${roundMoney(pay.reduce((s, t) => s + t.signedAmount, 0))}.`,
    `Span ${first.date} → ${last.date}; running ledger R${last.runningBalance}.`,
    `Section "${section || "n/a"}".`,
  ];
  if (flagged.length) {
    parts.push(`${flagged.length} flagged row(s) (dup/mispost/hist/jnl).`);
  }
  const recent = timeline.slice(-3);
  const tail = recent
    .map(
      (t) =>
        `${t.date} ${t.kind} R${t.signedAmount}${t.flags.length ? `[${t.flags.join(",")}]` : ""}`
    )
    .join("; ");
  parts.push(`Recent: ${tail}.`);
  return parts.join(" ");
}

function classifyLikelyCause(opts: {
  row: ReviewTarget;
  section: string;
  txns: ParsedTransaction[];
  ledgerExcess: number;
  duplicateInvoiceFps: string[];
  duplicatePaymentFps: string[];
  misPostedTxnCount: number;
  computedLedger: number;
  invoiceSum: number;
  paymentSum: number;
}): { cause: LikelyCause; confidence: AccountAudit["likelyCauseConfidence"]; detail: string } {
  const {
    row,
    section,
    txns,
    ledgerExcess,
    duplicateInvoiceFps,
    duplicatePaymentFps,
    misPostedTxnCount,
    computedLedger,
    invoiceSum,
    paymentSum,
  } = opts;

  if (row.category === "needsManualKideSysReview" || row.priorActiveMismatchReason === "orphanLedgerOnly") {
    return {
      cause: "agePaidUpOrZeroedLedgerResidual",
      confidence: section === "Paid Up" || row.ageAnalysisBalance < 0.01 ? "high" : "medium",
      detail:
        row.ageAnalysisBalance < 0.01
          ? `Age analysis R0 (${section || "n/a"}) but import ledger R${row.ledgerBalanceFromImport} — residual ledger balance after age cleared/paid up.`
          : "Manual-review account — verify age vs ledger in Kid-e-Sys before any opening entry.",
    };
  }

  if (duplicateInvoiceFps.length > 0) {
    return {
      cause: "duplicatedInvoice",
      confidence: "high",
      detail: `${duplicateInvoiceFps.length} duplicate invoice fingerprint(s); ledger excess R${ledgerExcess} vs age R${row.ageAnalysisBalance}.`,
    };
  }

  if (duplicatePaymentFps.length > 0) {
    return {
      cause: "ledgerExportOverstatement",
      confidence: "medium",
      detail: `Duplicate payment fingerprint(s) present; net ledger R${computedLedger} vs age R${row.ageAnalysisBalance} (excess R${ledgerExcess}).`,
    };
  }

  if (misPostedTxnCount > 0) {
    return {
      cause: "misPostedTransaction",
      confidence: "high",
      detail: `${misPostedTxnCount} transaction(s) resolve to a different family account by learner name — fix allocation before opening credit.`,
    };
  }

  const invoices = txns.filter((t) => t.kind === "invoice");
  const matchingInvoice = invoices.find((t) => near(t.signedAmount, ledgerExcess, 2));
  if (matchingInvoice) {
    return {
      cause: "extraLedgerChargesNotReflectedInAge",
      confidence: "high",
      detail: `Single invoice #${matchingInvoice.transactionNo} R${matchingInvoice.signedAmount} matches ledger excess R${ledgerExcess} — likely billed on ledger but not in age allocation.`,
    };
  }

  const invoiceAmounts = invoices.map((t) => t.signedAmount);
  for (let i = 0; i < invoiceAmounts.length; i++) {
    for (let j = i + 1; j < invoiceAmounts.length; j++) {
      if (near(invoiceAmounts[i] + invoiceAmounts[j], ledgerExcess, 2)) {
        return {
          cause: "extraLedgerChargesNotReflectedInAge",
          confidence: "medium",
          detail: `Pair of invoices (R${invoiceAmounts[i]} + R${invoiceAmounts[j]}) sums to ledger excess R${ledgerExcess}.`,
        };
      }
    }
  }

  if (
    section === "Over Paid" ||
    section === "Paid Up" ||
    (txns.length > 0 && txns.every((t) => !String(t.notes || "").trim() || isHistoricalNote(t)))
  ) {
    return {
      cause: "historicalOrSectionSkew",
      confidence: section === "Over Paid" || section === "Paid Up" ? "high" : "medium",
      detail: `Age section "${section}" vs ledger R${row.ledgerBalanceFromImport} — age R${row.ageAnalysisBalance} may exclude items still on ledger.`,
    };
  }

  if (near(roundMoney(invoiceSum + paymentSum), row.ledgerBalanceFromImport, 2) && ledgerExcess > 50) {
    return {
      cause: "ledgerExportOverstatement",
      confidence: "medium",
      detail: `Lifetime invoices R${invoiceSum} + payments R${paymentSum} reconcile to ledger R${row.ledgerBalanceFromImport}; age R${row.ageAnalysisBalance} is R${ledgerExcess} lower — export/age skew, not missing payments.`,
    };
  }

  if (row.priorActiveMismatchReason === "possibleDuplicateOrHistoricalCredit") {
    return {
      cause: "historicalOrSectionSkew",
      confidence: "medium",
      detail: "Prior audit flagged duplicate/historical credit pattern; ledger exceeds age — opening credit may mask Kid-e-Sys cleanup.",
    };
  }

  return {
    cause: "cannotDetermine",
    confidence: "low",
    detail: `Ledger R${row.ledgerBalanceFromImport} exceeds age R${row.ageAnalysisBalance} by R${ledgerExcess}; ${invoices.length} inv / ${txns.filter((t) => t.kind === "payment").length} pay — no single dominant pattern.`,
  };
}

function assessOpeningBalanceSafety(opts: {
  row: ReviewTarget;
  cause: LikelyCause;
  causeConfidence: AccountAudit["likelyCauseConfidence"];
  ledgerExcess: number;
  ledgerMatchesImport: boolean;
  duplicateInvoiceFps: string[];
  misPostedTxnCount: number;
  section: string;
}): {
  safe: boolean;
  safety: AccountAudit["openingBalanceAdjustmentSafety"];
  rationale: string;
} {
  const {
    row,
    cause,
    causeConfidence,
    ledgerExcess,
    ledgerMatchesImport,
    duplicateInvoiceFps,
    misPostedTxnCount,
    section,
  } = opts;

  if (!ledgerMatchesImport) {
    return {
      safe: false,
      safety: "unsafe",
      rationale: "Computed ledger from transactions does not match import balance — fix source data before any opening entry.",
    };
  }

  if (row.category === "needsManualKideSysReview" || row.priorActiveMismatchReason === "orphanLedgerOnly") {
    return {
      safe: false,
      safety: "unsafe",
      rationale:
        "Age is R0 (Paid Up) while ledger still shows R" +
        `${row.ledgerBalanceFromImport} — opening credit would hide a Kid-e-Sys residual; reconcile or write off in source system first.`,
    };
  }

  if (misPostedTxnCount > 0 || duplicateInvoiceFps.length > 0) {
    return {
      safe: false,
      safety: "unsafe",
      rationale:
        misPostedTxnCount > 0
          ? "Mis-posted transactions detected — re-allocate in Kid-e-Sys instead of masking with opening credit."
          : "Duplicate invoice(s) on ledger — remove duplicates in Kid-e-Sys before opening credit.",
    };
  }

  if (
    cause === "extraLedgerChargesNotReflectedInAge" &&
    (causeConfidence === "high" || causeConfidence === "medium") &&
    near(Math.abs(row.adjustmentAmount), ledgerExcess, 2)
  ) {
    return {
      safe: true,
      safety: "safe",
      rationale:
        "Ledger excess matches identifiable invoice(s) with no dup/mispost signals; opening credit R" +
        `${Math.abs(row.adjustmentAmount)} aligns ledger to age R${row.ageAnalysisBalance}.`,
    };
  }

  if (cause === "duplicatedInvoice" || cause === "misPostedTransaction") {
    return {
      safe: false,
      safety: "unsafe",
      rationale: "Root cause is data quality on ledger — opening credit does not fix underlying duplicate/mispost.",
    };
  }

  if (cause === "historicalOrSectionSkew" || cause === "ledgerExportOverstatement") {
    return {
      safe: false,
      safety: "caution",
      rationale:
        `Section "${section}" / export skew — opening credit R${Math.abs(row.adjustmentAmount)} may align EduClear to age but should be confirmed in Kid-e-Sys (age is lower than ledger by design).`,
    };
  }

  if (cause === "cannotDetermine") {
    return {
      safe: false,
      safety: "caution",
      rationale:
        "Mixed signals on inverse variance — confirm which balance is authoritative before importing opening credit.",
    };
  }

  return {
    safe: false,
    safety: "caution",
    rationale: "Default caution for inverse ledger>age — prefer Kid-e-Sys correction over opening credit unless verified.",
  };
}

const desktopRoot = process.argv[2] || path.join(process.env.HOME || "", "Desktop");
const reviewPath = path.join(__dirname, "..", "opening-balance-adjustment-review.json");
if (!fs.existsSync(reviewPath)) {
  console.error(`Missing ${reviewPath} — run opening-balance-adjustment-review.ts first.`);
  process.exit(1);
}

const review = JSON.parse(fs.readFileSync(reviewPath, "utf8")) as {
  accountsByReasonGroup: {
    inverseProblemLedgerGreaterThanAge: ReviewTarget[];
    needsManualKideSysReview: ReviewTarget[];
  };
};

const inverseRows = review.accountsByReasonGroup?.inverseProblemLedgerGreaterThanAge || [];
const manualRows = review.accountsByReasonGroup?.needsManualKideSysReview || [];

const targets: ReviewTarget[] = [
  ...inverseRows.map((r) => ({
    accountNo: r.accountNo,
    fullName: r.fullName,
    ageAnalysisBalance: r.ageAnalysisBalance,
    ledgerBalanceFromImport: r.ledgerBalanceFromImport,
    adjustmentAmount: r.adjustmentAmount,
    variance: r.variance,
    category: "inverseProblemLedgerGreaterThanAge" as const,
    priorActiveMismatchReason: (r as { priorActiveMismatchReason?: string }).priorActiveMismatchReason || "",
    reasonDetail: (r as { reasonDetail?: string }).reasonDetail || "",
  })),
  ...manualRows
    .filter((r) => r.accountNo === "MAR005")
    .map((r) => ({
      accountNo: r.accountNo,
      fullName: r.fullName,
      ageAnalysisBalance: r.ageAnalysisBalance,
      ledgerBalanceFromImport: r.ledgerBalanceFromImport,
      adjustmentAmount: r.adjustmentAmount,
      variance: r.variance,
      category: "needsManualKideSysReview" as const,
      priorActiveMismatchReason: (r as { priorActiveMismatchReason?: string }).priorActiveMismatchReason || "",
      reasonDetail: (r as { reasonDetail?: string }).reasonDetail || "",
    })),
];

if (inverseRows.length !== 6) {
  console.warn(`Expected 6 inverse accounts, got ${inverseRows.length} (continuing).`);
}
if (!targets.some((t) => t.accountNo === "MAR005")) {
  console.warn("MAR005 not found in manual review group (continuing).");
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

const activeLearnersByAccount = countActiveLearnersPerAccount(
  classLearners,
  bundle.accounts,
  familyIndex
);

const ageAnalysisAccountNos = new Set(bundle.accounts.map((a) => a.accountNo));

const audits: AccountAudit[] = [];

for (const row of targets) {
  const account = bundle.accounts.find((a) => a.accountNo === row.accountNo);
  const txns = bundle.transactions.filter((t) => t.accountNo === row.accountNo);
  const duplicateFps = new Set(findDuplicateFingerprints(txns));
  const duplicateInvoiceFps = [...duplicateFps].filter((fp) => fp.startsWith("invoice|"));
  const duplicatePaymentFps = [...duplicateFps].filter((fp) => fp.startsWith("payment|"));

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

  const timeline = buildTimeline(txns, row.accountNo, familyIndex, duplicateFps);
  const computedLedger = timeline.length ? timeline[timeline.length - 1].runningBalance : 0;
  const ledgerExcess = roundMoney(row.ledgerBalanceFromImport - row.ageAnalysisBalance);
  const section = account?.section || "";

  const { cause, confidence, detail } = classifyLikelyCause({
    row,
    section,
    txns,
    ledgerExcess,
    duplicateInvoiceFps,
    duplicatePaymentFps,
    misPostedTxnCount,
    computedLedger,
    invoiceSum: sumInvoices(txns),
    paymentSum: sumPayments(txns),
  });

  const { safe, safety, rationale } = assessOpeningBalanceSafety({
    row,
    cause,
    causeConfidence: confidence,
    ledgerExcess,
    ledgerMatchesImport: Math.abs(computedLedger - row.ledgerBalanceFromImport) <= 0.02,
    duplicateInvoiceFps,
    misPostedTxnCount,
    section,
  });

  audits.push({
    accountNo: row.accountNo,
    fullName: row.fullName,
    ageAnalysisBalance: row.ageAnalysisBalance,
    ledgerBalanceFromImport: row.ledgerBalanceFromImport,
    adjustmentAmount: row.adjustmentAmount,
    category: row.category,
    ledgerExcessOverAge: ledgerExcess,
    timelineSummary: summarizeTimeline(timeline, section),
    likelyCause: cause,
    likelyCauseConfidence: confidence,
    likelyCauseDetail: detail,
    openingBalanceAdjustmentSafe: safe,
    openingBalanceAdjustmentSafety: safety,
    openingBalanceSafetyRationale: rationale,
    section,
    priorActiveMismatchReason: row.priorActiveMismatchReason,
    metrics: {
      invoiceCount: txns.filter((t) => t.kind === "invoice").length,
      paymentCount: txns.filter((t) => t.kind === "payment").length,
      invoiceSum: sumInvoices(txns),
      paymentSum: sumPayments(txns),
      computedLedgerFromTxns: computedLedger,
      ledgerMatchesImport: Math.abs(computedLedger - row.ledgerBalanceFromImport) <= 0.02,
      duplicateInvoiceFingerprints: duplicateInvoiceFps,
      duplicatePaymentFingerprints: duplicatePaymentFps,
      misPostedTxnCount,
      crossAccountInboundPaymentTotal: roundMoney(crossAccountInbound),
      crossAccountOutboundPaymentTotal: roundMoney(crossAccountOutbound),
      journalOrHistoricalTxnCount: txns.filter((t) => isJournalOrCorrection(t) || isHistoricalNote(t)).length,
      activeLearnerCount: activeLearnersByAccount.get(row.accountNo) || 0,
      inAgeAnalysis: ageAnalysisAccountNos.has(row.accountNo),
    },
    timeline,
  });
}

audits.sort((a, b) => Math.abs(b.adjustmentAmount) - Math.abs(a.adjustmentAmount));

const causeCounts: Record<LikelyCause, number> = {
  duplicatedInvoice: 0,
  extraLedgerChargesNotReflectedInAge: 0,
  agePaidUpOrZeroedLedgerResidual: 0,
  misPostedTransaction: 0,
  ledgerExportOverstatement: 0,
  historicalOrSectionSkew: 0,
  cannotDetermine: 0,
};
for (const a of audits) causeCounts[a.likelyCause]++;

const safetyCounts = { safe: 0, caution: 0, unsafe: 0 };
for (const a of audits) safetyCounts[a.openingBalanceAdjustmentSafety]++;

const report = {
  generatedAt: new Date().toISOString(),
  desktopRoot,
  auditOnly: true,
  noDbWrites: true,
  sourceReview: "opening-balance-adjustment-review.json",
  inverseAccountCount: inverseRows.length,
  manualAccountCount: targets.filter((t) => t.accountNo === "MAR005").length,
  totalAccountCount: audits.length,
  totalAbsAdjustment: roundMoney(audits.reduce((s, a) => s + Math.abs(a.adjustmentAmount), 0)),
  likelyCauseCounts: causeCounts,
  openingBalanceSafetyCounts: safetyCounts,
  accounts: audits.map((a) => ({
    accountNo: a.accountNo,
    fullName: a.fullName,
    ageAnalysisBalance: a.ageAnalysisBalance,
    ledgerBalanceFromImport: a.ledgerBalanceFromImport,
    adjustmentAmount: a.adjustmentAmount,
    category: a.category,
    ledgerExcessOverAge: a.ledgerExcessOverAge,
    timelineSummary: a.timelineSummary,
    likelyCause: a.likelyCause,
    likelyCauseConfidence: a.likelyCauseConfidence,
    likelyCauseDetail: a.likelyCauseDetail,
    openingBalanceAdjustmentSafe: a.openingBalanceAdjustmentSafe,
    openingBalanceAdjustmentSafety: a.openingBalanceAdjustmentSafety,
    openingBalanceSafetyRationale: a.openingBalanceSafetyRationale,
    section: a.section,
    priorActiveMismatchReason: a.priorActiveMismatchReason,
    metrics: a.metrics,
    timeline: a.timeline,
  })),
};

const outJson = path.join(__dirname, "..", "inverse-and-manual-adjustment-audit.json");
const outTxt = path.join(__dirname, "..", "inverse-and-manual-adjustment-audit.txt");

fs.writeFileSync(outJson, JSON.stringify(report, null, 2), "utf8");

const causeLabels: Record<LikelyCause, string> = {
  duplicatedInvoice: "duplicated invoice",
  extraLedgerChargesNotReflectedInAge: "extra ledger charges not in age",
  agePaidUpOrZeroedLedgerResidual: "age paid up / zeroed ledger residual",
  misPostedTransaction: "mis-posted transaction",
  ledgerExportOverstatement: "ledger export overstatement",
  historicalOrSectionSkew: "historical or section skew",
  cannotDetermine: "cannot determine",
};

const lines: string[] = [
  "=== Inverse + manual adjustment audit (7 accounts, audit only — no import) ===",
  `Generated: ${report.generatedAt}`,
  `Desktop: ${desktopRoot}`,
  `Inverse ledger>age: ${report.inverseAccountCount} | Manual (MAR005): ${report.manualAccountCount}`,
  `Sum |adjustment|: R${report.totalAbsAdjustment.toFixed(2)}`,
  "",
  "Likely cause:",
  ...Object.entries(causeCounts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `  ${causeLabels[k as LikelyCause]}: ${n}`),
  "",
  "Opening balance safety:",
  `  safe: ${safetyCounts.safe} | caution: ${safetyCounts.caution} | unsafe: ${safetyCounts.unsafe}`,
  "",
  "accountNo | category | safety | cause | age | ledger | adj | learner",
  "--------- | -------- | ------ | ----- | --- | ------ | --- | -------",
];

for (const a of audits) {
  const name = String(a.fullName || "")
    .replace(/\n/g, " / ")
    .slice(0, 26);
  const cat =
    a.category === "inverseProblemLedgerGreaterThanAge" ? "inverse" : "manual";
  lines.push(
    `${a.accountNo.padEnd(9)} | ${cat.padEnd(8)} | ${a.openingBalanceAdjustmentSafety.padEnd(6)} | ${causeLabels[a.likelyCause].slice(0, 28).padEnd(28)} | ${String(a.ageAnalysisBalance).padStart(5)} | ${String(a.ledgerBalanceFromImport).padStart(6)} | ${String(a.adjustmentAmount).padStart(5)} | ${name}`
  );
}

lines.push("", "Per-account detail:", "");

for (const a of audits) {
  lines.push(`--- ${a.accountNo} ${a.fullName} ---`);
  lines.push(`  age R${a.ageAnalysisBalance} | ledger R${a.ledgerBalanceFromImport} | adjustment R${a.adjustmentAmount} | excess R${a.ledgerExcessOverAge}`);
  lines.push(`  category: ${a.category} | section: ${a.section || "(none)"} | prior: ${a.priorActiveMismatchReason}`);
  lines.push(`  timeline: ${a.timelineSummary}`);
  lines.push(`  likely cause: ${causeLabels[a.likelyCause]} (${a.likelyCauseConfidence}) — ${a.likelyCauseDetail}`);
  lines.push(
    `  opening balance safe: ${a.openingBalanceAdjustmentSafe} [${a.openingBalanceAdjustmentSafety}] — ${a.openingBalanceSafetyRationale}`
  );
  if (a.metrics.duplicateInvoiceFingerprints.length) {
    lines.push(`  duplicate invoices: ${a.metrics.duplicateInvoiceFingerprints.join("; ")}`);
  }
  if (a.metrics.misPostedTxnCount) {
    lines.push(`  mis-posted txns: ${a.metrics.misPostedTxnCount}`);
  }
  lines.push("  full timeline:");
  for (const t of a.timeline) {
    const flagStr = t.flags.length ? ` [${t.flags.join(",")}]` : "";
    lines.push(
      `    ${t.date} ${t.kind.padEnd(7)} #${t.transactionNo} R${t.signedAmount.toFixed(2)} bal R${t.runningBalance.toFixed(2)}${flagStr}${t.notes ? ` — ${t.notes.slice(0, 55)}` : ""}`
    );
  }
  lines.push("");
}

lines.push("Full JSON: inverse-and-manual-adjustment-audit.json");

fs.writeFileSync(outTxt, lines.join("\n"), "utf8");

const tableStart = lines.findIndex((l) => l.startsWith("accountNo | category"));
const summaryLines = [
  lines[0],
  lines[1],
  lines[2],
  lines[3],
  lines[4],
  "",
  ...lines.slice(6, 11),
  "",
  ...lines.slice(11, 14),
  "",
  ...lines.slice(tableStart, tableStart + 2 + audits.length),
  "",
  `Wrote ${outJson}`,
  `Wrote ${outTxt}`,
];

console.log(summaryLines.join("\n"));
